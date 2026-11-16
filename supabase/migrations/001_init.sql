-- Fisku - skema awal lengkap untuk proyek Supabase baru.
-- Jalankan file ini satu kali pada database kosong melalui Supabase SQL Editor.
-- Mencakup tabel, constraint, indeks, RLS, revision, dan RPC sinkronisasi.
-- Tidak menghapus atau mereset skema yang sudah ada; kegagalan membatalkan transaksi.
begin;

-- ------------------------------------------------------------
-- TABEL
-- ------------------------------------------------------------

create table public.accounts (
  id uuid not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text not null,
  initial_balance bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table public.categories (
  id uuid not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table public.transactions (
  id uuid not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  account_id uuid not null,
  category_id uuid,
  target_account_id uuid,
  type text not null,
  amount bigint not null,
  date date not null,
  note text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table public.budgets (
  id uuid not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  category_id uuid not null,
  limit_amount bigint not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- ------------------------------------------------------------
-- INDEKS
-- ------------------------------------------------------------

create index accounts_user_idx            on public.accounts(user_id);
create index accounts_user_updated_idx    on public.accounts(user_id, updated_at);

create index categories_user_idx          on public.categories(user_id);
create index categories_user_updated_idx  on public.categories(user_id, updated_at);

create index transactions_user_idx          on public.transactions(user_id);
create index transactions_user_updated_idx  on public.transactions(user_id, updated_at);
create index transactions_date_idx          on public.transactions(user_id, date desc);

create index budgets_user_idx             on public.budgets(user_id);
create index budgets_user_updated_idx     on public.budgets(user_id, updated_at);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.accounts     enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets      enable row level security;

-- ------------------------------------------------------------
-- POLICY (hanya akses data milik user sendiri)
-- ------------------------------------------------------------


create policy "accounts_own"     on public.accounts     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "categories_own"   on public.categories   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "transactions_own" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "budgets_own"      on public.budgets      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Validasi domain dan protokol sinkronisasi
alter table public.accounts add constraint accounts_domain check (
  type in ('cash','bank','ewallet','credit') and name = btrim(name) and length(name) between 1 and 200
  and initial_balance between -9007199254740991 and 9007199254740991
);
alter table public.categories add constraint categories_domain check (
  type in ('income','expense') and name = btrim(name) and length(name) between 1 and 200
);
alter table public.transactions add constraint transactions_domain check (
  type in ('income','expense','transfer') and amount between 1 and 9007199254740991
  and date between date '0001-01-01' and date '9999-12-31' and (note is null or length(note) <= 2000)
  and ((type = 'transfer' and category_id is null and target_account_id is not null and target_account_id <> account_id)
    or (type in ('income','expense') and category_id is not null and target_account_id is null))
);
alter table public.budgets add constraint budgets_domain check (
  limit_amount between 0 and 9007199254740991 and (deleted_at is not null or limit_amount > 0)
);
alter table public.accounts add constraint accounts_finite_time check (isfinite(updated_at) and (deleted_at is null or isfinite(deleted_at)));
alter table public.categories add constraint categories_finite_time check (isfinite(updated_at) and (deleted_at is null or isfinite(deleted_at)));
alter table public.transactions add constraint transactions_finite_time check (isfinite(updated_at) and (deleted_at is null or isfinite(deleted_at)));
alter table public.budgets add constraint budgets_finite_time check (isfinite(updated_at) and (deleted_at is null or isfinite(deleted_at)));
alter table public.transactions add constraint transactions_account_fk foreign key (user_id, account_id) references public.accounts(user_id,id) deferrable initially deferred;
alter table public.transactions add constraint transactions_target_fk foreign key (user_id, target_account_id) references public.accounts(user_id,id) deferrable initially deferred;
alter table public.transactions add constraint transactions_category_fk foreign key (user_id, category_id) references public.categories(user_id,id) deferrable initially deferred;
alter table public.budgets add constraint budgets_category_fk foreign key (user_id, category_id) references public.categories(user_id,id) deferrable initially deferred;
alter table public.budgets add constraint budgets_one_category unique (user_id, category_id);
create unique index accounts_active_name on public.accounts(user_id, lower(name)) where deleted_at is null;
create unique index categories_active_name on public.categories(user_id, type, lower(name)) where deleted_at is null;

create table public.finance_heads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991)
);
create table public.finance_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null,
  revision bigint not null,
  primary key (user_id, operation_id)
);
-- Only identities survive purge, never financial payloads. Keep these markers
-- indefinitely so an old/offline device cannot recreate a permanently removed ID.
create table public.finance_purged (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('accounts','categories','transactions','budgets')),
  id uuid not null,
  primary key (user_id, kind, id)
);
alter table public.finance_heads enable row level security;
alter table public.finance_operations enable row level security;
alter table public.finance_purged enable row level security;
create policy finance_heads_own on public.finance_heads for select to authenticated using (auth.uid() = user_id);
create policy finance_operations_own on public.finance_operations for select to authenticated using (auth.uid() = user_id);
create policy finance_purged_own on public.finance_purged for select to authenticated using (auth.uid() = user_id);

-- Internal helpers are not callable from the Data API by application roles.
create function public.finance_snapshot(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'initialBalance',initial_balance,'updatedAt',updated_at,'deletedAt',deleted_at) order by id) from public.accounts where user_id = p_uid),'[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'updatedAt',updated_at,'deletedAt',deleted_at) order by id) from public.categories where user_id = p_uid),'[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'categoryId',category_id,'targetAccountId',target_account_id,'type',type,'amount',amount,'date',date,'note',note,'updatedAt',updated_at,'deletedAt',deleted_at) order by id) from public.transactions where user_id = p_uid),'[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object('id',id,'categoryId',category_id,'limit',limit_amount,'updatedAt',updated_at,'deletedAt',deleted_at) order by id) from public.budgets where user_id = p_uid),'[]'::jsonb),
    'purged', jsonb_build_object(
      'accounts', coalesce((select jsonb_agg(id order by id) from public.finance_purged where user_id=p_uid and kind='accounts'),'[]'::jsonb),
      'categories', coalesce((select jsonb_agg(id order by id) from public.finance_purged where user_id=p_uid and kind='categories'),'[]'::jsonb),
      'transactions', coalesce((select jsonb_agg(id order by id) from public.finance_purged where user_id=p_uid and kind='transactions'),'[]'::jsonb),
      'budgets', coalesce((select jsonb_agg(id order by id) from public.finance_purged where user_id=p_uid and kind='budgets'),'[]'::jsonb))
  );
$$;

create function public.finance_check(p_uid uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.transactions t
    left join public.accounts a on (a.user_id,a.id)=(t.user_id,t.account_id)
    left join public.accounts target on (target.user_id,target.id)=(t.user_id,t.target_account_id)
    left join public.categories c on (c.user_id,c.id)=(t.user_id,t.category_id)
    where t.user_id=p_uid and (
      a.id is null or (t.deleted_at is null and a.deleted_at is not null)
      or (t.type='transfer' and (target.id is null or (t.deleted_at is null and target.deleted_at is not null)))
      or (t.type<>'transfer' and (c.id is null or c.type<>t.type or (t.deleted_at is null and c.deleted_at is not null)))
    )
  ) then raise exception 'Relasi atau jenis transaksi tidak valid' using errcode='23514'; end if;
  if exists (
    select 1 from public.budgets b left join public.categories c on (c.user_id,c.id)=(b.user_id,b.category_id)
    where b.user_id=p_uid and (c.id is null or c.type<>'expense' or (b.deleted_at is null and c.deleted_at is not null))
  ) then raise exception 'Relasi anggaran tidak valid' using errcode='23514'; end if;
  if exists (
    select 1 from (
      select a.id, a.deleted_at, a.initial_balance::numeric + coalesce((select sum(
        case when t.type='income' then t.amount::numeric when t.type='expense' then -t.amount::numeric
        when t.account_id=a.id then -t.amount::numeric else t.amount::numeric end)
        from public.transactions t where t.user_id=p_uid and t.deleted_at is null
        and (t.account_id=a.id or (t.type='transfer' and t.target_account_id=a.id))),0) balance
      from public.accounts a where a.user_id=p_uid
    ) balances where abs(balance)>9007199254740991
  ) then raise exception 'Saldo melampaui batas aman' using errcode='23514'; end if;
  if exists (
    select 1 from public.transactions where user_id=p_uid and deleted_at is null and type<>'transfer'
    group by type having sum(amount::numeric)>9007199254740991
  ) then raise exception 'Total nominal melampaui batas aman' using errcode='23514'; end if;
  if abs(coalesce((select sum(initial_balance::numeric) from public.accounts where user_id=p_uid and deleted_at is null),0)
    + coalesce((select sum(case when type='income' then amount::numeric else -amount::numeric end) from public.transactions where user_id=p_uid and deleted_at is null and type<>'transfer'),0))>9007199254740991 then
    raise exception 'Total saldo melampaui batas aman' using errcode='23514';
  end if;
  if coalesce((select sum(limit_amount::numeric) from public.budgets where user_id=p_uid and deleted_at is null),0)>9007199254740991 then
    raise exception 'Total anggaran melampaui batas aman' using errcode='23514';
  end if;
end;
$$;

create function public.finance_read() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_revision bigint;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.finance_heads(user_id) values (v_uid) on conflict do nothing;
  -- All writers take this lock, so the revision and the complete snapshot agree.
  select revision into v_revision from public.finance_heads where user_id=v_uid for update;
  return jsonb_build_object('revision',v_revision,'state',public.finance_snapshot(v_uid));
end;
$$;

create function public.finance_push(p_expected_revision bigint, p_operation_id uuid, p_data jsonb) returns jsonb
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

-- Domain tables remain readable under RLS but all application writes go through
-- the versioned RPC. SECURITY DEFINER functions explicitly enforce auth.uid().
revoke all on public.accounts, public.categories, public.transactions, public.budgets, public.finance_heads, public.finance_operations, public.finance_purged from public, anon, authenticated;
grant select on public.accounts, public.categories, public.transactions, public.budgets, public.finance_heads, public.finance_purged to authenticated;
revoke all on function public.finance_snapshot(uuid), public.finance_check(uuid), public.finance_read(), public.finance_push(bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.finance_read(), public.finance_push(bigint,uuid,jsonb) to authenticated;
commit;
