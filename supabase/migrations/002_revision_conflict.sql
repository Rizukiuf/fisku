-- Upgrade an existing Fisku database; preserves tables, revisions, receipts and ACLs.
-- Existing PostgREST retry loops need separate termination; see docs/SUPABASE_SETUP.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if to_regprocedure('public.finance_push(bigint,uuid,jsonb)') is null then
    raise exception 'Fisku finance_push is missing. Use 001_init.sql only for a new empty database.';
  end if;
end;
$$;

create or replace function public.finance_push(p_expected_revision bigint, p_operation_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_revision bigint; v_applied bigint; v_hash text;
  v_kind text; v_missing boolean;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_operation_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid operation' using errcode='22023'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid data' using errcode='22023'; end if;
  foreach v_kind in array array['accounts','categories','transactions','budgets'] loop
    if jsonb_typeof(p_data->v_kind) is distinct from 'array' or jsonb_typeof(p_data->'purged'->v_kind) is distinct from 'array' then
      raise exception 'Invalid data arrays' using errcode='22023';
    end if;
  end loop;
  insert into public.finance_heads(user_id) values (v_uid) on conflict do nothing;
  select revision into v_revision from public.finance_heads where user_id=v_uid for update;
  select revision, request_hash into v_applied, v_hash from public.finance_operations where user_id=v_uid and operation_id=p_operation_id;
  if found then
    if v_hash<>md5(p_expected_revision::text || ':' || p_data::text) then raise exception 'Operation ID reused with different data' using errcode='22023'; end if;
    return jsonb_build_object('revision',v_applied);
  end if;
  -- CAS conflicts require a fresh client read. SQLSTATE 40001 can cause
  -- PostgREST to replay the same stale request indefinitely inside the server.
  if p_expected_revision<>v_revision then raise exception 'Cloud changed; reconcile first' using errcode='PT409'; end if;
  foreach v_kind in array array['accounts','categories','transactions','budgets'] loop
    -- Omission is never interpreted as deletion. A tombstone or purge marker
    -- must explicitly account for every previously stored identity.
    execute format('select exists(select 1 from public.%I old where old.user_id=$1 and not exists(select 1 from jsonb_array_elements($2) row where (row->>''id'')::uuid=old.id) and not exists(select 1 from jsonb_array_elements_text($3) grave where grave::uuid=old.id))',v_kind)
      into v_missing using v_uid,p_data->v_kind,p_data->'purged'->v_kind;
    if v_missing then raise exception 'Missing identities; explicit deletion required' using errcode='23514'; end if;
    if exists(select 1 from public.finance_purged where user_id=v_uid and kind=v_kind and id not in (select value::uuid from jsonb_array_elements_text(p_data->'purged'->v_kind))) then
      raise exception 'Purge markers cannot be removed' using errcode='23514';
    end if;
    insert into public.finance_purged(user_id,kind,id) select v_uid,v_kind,value::uuid from jsonb_array_elements_text(p_data->'purged'->v_kind) on conflict do nothing;
    if exists(select 1 from jsonb_array_elements(p_data->v_kind) row join public.finance_purged grave on grave.user_id=v_uid and grave.kind=v_kind and grave.id=(row->>'id')::uuid) then
      raise exception 'Permanently removed identity cannot be restored' using errcode='23514';
    end if;
  end loop;
  -- A complete owner snapshot is committed atomically. API row limits cannot
  -- truncate the JSON scalar returned by finance_read. No client wall clocks
  -- participate in concurrency decisions.
  delete from public.transactions where user_id=v_uid;
  delete from public.budgets where user_id=v_uid;
  delete from public.accounts where user_id=v_uid;
  delete from public.categories where user_id=v_uid;
  insert into public.accounts(user_id,id,name,type,initial_balance,updated_at,deleted_at)
    select v_uid,(r->>'id')::uuid,r->>'name',r->>'type',(r->>'initialBalance')::bigint,(r->>'updatedAt')::timestamptz,(r->>'deletedAt')::timestamptz from jsonb_array_elements(p_data->'accounts') r;
  insert into public.categories(user_id,id,name,type,updated_at,deleted_at)
    select v_uid,(r->>'id')::uuid,r->>'name',r->>'type',(r->>'updatedAt')::timestamptz,(r->>'deletedAt')::timestamptz from jsonb_array_elements(p_data->'categories') r;
  insert into public.transactions(user_id,id,account_id,category_id,target_account_id,type,amount,date,note,updated_at,deleted_at)
    select v_uid,(r->>'id')::uuid,(r->>'accountId')::uuid,(r->>'categoryId')::uuid,(r->>'targetAccountId')::uuid,r->>'type',(r->>'amount')::bigint,(r->>'date')::date,r->>'note',(r->>'updatedAt')::timestamptz,(r->>'deletedAt')::timestamptz from jsonb_array_elements(p_data->'transactions') r;
  insert into public.budgets(user_id,id,category_id,limit_amount,updated_at,deleted_at)
    select v_uid,(r->>'id')::uuid,(r->>'categoryId')::uuid,(r->>'limit')::bigint,(r->>'updatedAt')::timestamptz,(r->>'deletedAt')::timestamptz from jsonb_array_elements(p_data->'budgets') r;
  perform public.finance_check(v_uid);
  v_revision := v_revision+1;
  update public.finance_heads set revision=v_revision where user_id=v_uid;
  insert into public.finance_operations(user_id,operation_id,request_hash,revision) values(v_uid,p_operation_id,md5(p_expected_revision::text || ':' || p_data::text),v_revision);
  return jsonb_build_object('revision',v_revision);
end;
$$;

notify pgrst, 'reload schema';
commit;
