import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { createSeed, dataOf, uid, type Data } from '../src/lib/model'
import { synchronize } from '../src/lib/syncEngine'
import { newWorkspace } from '../src/lib/repository'
import { resetToEmpty } from '../src/lib/reset'
import { restoreImport } from '../src/lib/imports'
import { allocateMergeIds, buildMergePlan } from '../src/lib/mergeImport'

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`)
  // Execute the complete fresh-database schema unchanged, just as in SQL Editor.
  await db.exec(await readFile(new URL('../supabase/migrations/001_init.sql', import.meta.url), 'utf8'))
}, 60000)
afterAll(async () => { await db?.close() })
async function user(): Promise<string> { const id = uid(); await db.query('insert into auth.users(id) values($1)', [id]); return id }
async function asUser<T>(id: string, action: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  try { return await action() } finally { await db.exec('reset role') }
}
async function push(id: string, state: Data, revision = 0, operationId = uid()) {
  return asUser(id, async () => (await db.query<{ result: { revision: number } }>('select public.finance_push($1,$2,$3::jsonb) as result', [revision, operationId, JSON.stringify(state)])).rows[0].result)
}
async function read(id: string) {
  return asUser(id, async () => (await db.query<{ result: { revision: number; state: Data } }>('select public.finance_read() as result')).rows[0].result)
}
describe('PostgreSQL constraints, authorization, and atomic sync RPC', () => {
  it('supports identical seed IDs for different owners and enforces read isolation', async () => {
    const a = await user(); const b = await user(); const state = dataOf(createSeed())
    await push(a, state); await push(b, state)
    expect((await read(a)).state.accounts).toHaveLength(3)
    const count = await asUser(a, () => db.query<{ count: number }>('select count(*)::int as count from public.accounts'))
    expect(count.rows[0].count).toBe(3)
    const other = await asUser(a, () => db.query('select * from public.accounts where user_id=$1', [b]))
    expect(other.rows).toHaveLength(0)
  })
  it('forbids direct writes, anonymous RPC, and unauthenticated calls', async () => {
    const id = await user(); await push(id, dataOf(createSeed()))
    await expect(asUser(id, () => db.exec('delete from public.accounts'))).rejects.toThrow('permission denied')
    await db.exec('set role anon')
    try { await expect(db.exec('select public.finance_read()')).rejects.toThrow('permission denied') }
    finally { await db.exec('reset role') }
    await db.query("select set_config('request.jwt.claim.sub','',false)")
    await expect(db.exec('select public.finance_read()')).rejects.toThrow('Authentication required')
  })
  it('rejects stale revisions and accepts idempotent retries exactly once', async () => {
    const id = await user(); const state = dataOf(createSeed()); const operation = uid()
    expect((await push(id, state, 0, operation)).revision).toBe(1)
    expect((await push(id, state, 0, operation)).revision).toBe(1)
    await expect(push(id, state, 0)).rejects.toMatchObject({ code: 'PT409' })
    state.accounts[0].initialBalance = 20
    await expect(push(id, state, 0, operation)).rejects.toThrow('different data')
    expect((await read(id)).revision).toBe(1)
  })
  it('rolls back a whole snapshot when any child or nominal is invalid', async () => {
    const id = await user(); const original = dataOf(createSeed()); await push(id, original)
    const bad = structuredClone(original); bad.accounts[0].name = 'Must rollback'
    bad.transactions.push({ id: uid(), accountId: bad.accounts[0].id, categoryId: bad.categories[0].id, type: 'income', amount: -10, date: '2026-11-15', updatedAt: new Date().toISOString(), deletedAt: null })
    await expect(push(id, bad, 1)).rejects.toThrow()
    const after = await read(id)
    expect(after.revision).toBe(1)
    expect(after.state.accounts[0].name).toBe(original.accounts[0].name)
  })
  it('rejects cross-owner parent references, category type mismatch, and duplicate budgets', async () => {
    const a = await user(); const b = await user(); const stateB = dataOf(createSeed()); const foreign = uid()
    stateB.accounts.push({ ...stateB.accounts[0], id: foreign, name: 'B private' }); await push(b, stateB)
    const state = dataOf(createSeed())
    state.transactions.push({ id: uid(), accountId: foreign, categoryId: state.categories[0].id, type: 'income', amount: 10, date: '2026-11-15', updatedAt: new Date().toISOString(), deletedAt: null })
    await expect(push(a, state)).rejects.toThrow()
    state.transactions[0].accountId = state.accounts[0].id; state.transactions[0].categoryId = state.categories[2].id
    await expect(push(a, state)).rejects.toThrow()
    state.transactions = []; state.budgets = [0, 1].map(() => ({ id: uid(), categoryId: state.categories[2].id, limit: 100, updatedAt: new Date().toISOString(), deletedAt: null }))
    await expect(push(a, state)).rejects.toThrow('duplicate key')
    expect((await read(a)).revision).toBe(0)
  })
  it('requires explicit deletion and preserves purge identities forever', async () => {
    const id = await user(); const state = dataOf(createSeed()); await push(id, state)
    const removed = state.accounts.shift()!
    await expect(push(id, state, 1)).rejects.toThrow('Missing identities')
    state.purged.accounts.push(removed.id)
    await push(id, state, 1)
    const stale = structuredClone(state); stale.accounts.push(removed)
    await expect(push(id, stale, 2)).rejects.toThrow('removed identity')
    const lostMarker = structuredClone(state); lostMarker.purged.accounts = []
    await expect(push(id, lostMarker, 2)).rejects.toThrow('cannot be removed')
    expect((await read(id)).state.accounts.some(a => a.id === removed.id)).toBe(false)
  })
  it('returns a complete snapshot beyond common table API page sizes', async () => {
    const id = await user(); const state = dataOf(createSeed())
    state.transactions = Array.from({ length: 1501 }, () => ({ id: uid(), accountId: state.accounts[0].id, categoryId: state.categories[0].id, type: 'income' as const, amount: 1, date: '2026-11-15', updatedAt: new Date().toISOString(), deletedAt: null }))
    await push(id, state)
    expect((await read(id)).state.transactions).toHaveLength(1501)
  })
  it('rejects nonfinite timestamps and unsafe aggregate balances', async () => {
    const id = await user(); const state = dataOf(createSeed())
    state.accounts[0].updatedAt = 'infinity'
    await expect(push(id, state)).rejects.toThrow('finite_time')
    state.accounts[0].updatedAt = new Date().toISOString()
    state.accounts[0].initialBalance = Number.MAX_SAFE_INTEGER; state.accounts[1].initialBalance = 1
    await expect(push(id, state)).rejects.toThrow('Total saldo')
    expect((await read(id)).revision).toBe(0)
  })
  it('roundtrips the sync engine against the real PostgreSQL RPC and decodes SQL timestamps', async () => {
    const id = await user(); let workspace = newWorkspace(`user:${id}`, createSeed())
    workspace.state.accounts[0].initialBalance = 750
    await synchronize({
      active: () => true,
      read: async () => structuredClone(workspace),
      update: async apply => { const copy = structuredClone(workspace); const result = apply(copy, () => {}); workspace = copy; return result },
    }, { read: () => read(id), push: (revision, operation, state) => push(id, state, revision, operation) })
    expect(workspace.pending).toBeNull()
    expect(workspace.revision).toBe(1)
    expect(workspace.state.accounts[0].initialBalance).toBe(750)
    expect(workspace.state.accounts[0].updatedAt).toMatch(/Z$/)
  })
  it('persists reset tombstones in PostgreSQL and pulls them onto a new empty device without seeds', async () => {
    const id = await user(); const initial = createSeed()
    await push(id, dataOf(initial))
    const reset = resetToEmpty(initial).state
    await push(id, dataOf(reset), 1)
    let workspace = newWorkspace(`user:${id}`)
    await synchronize({
      active: () => true,
      read: async () => structuredClone(workspace),
      update: async apply => { const copy = structuredClone(workspace); const result = apply(copy, () => {}); workspace = copy; return result },
    }, { read: () => read(id), push: (revision, operation, state) => push(id, state, revision, operation) })
    expect(workspace.state.accounts.filter(a => !a.deletedAt)).toHaveLength(0)
    expect(workspace.state.categories.filter(c => !c.deletedAt)).toHaveLength(0)
    expect(workspace.state.accounts.map(a => a.id)).toEqual(initial.accounts.map(a => a.id))
    expect(workspace.revision).toBe(2)
    expect((await read(id)).revision).toBe(2)
  })
  it('accepts a restored graph while retaining server purge markers and rejecting the old IDs', async () => {
    const id = await user(); const original = createSeed()
    original.transactions.push({ id: uid(), type: 'transfer', amount: 50, accountId: original.accounts[0].id, targetAccountId: original.accounts[1].id, date: '2026-11-16', updatedAt: new Date().toISOString(), deletedAt: null })
    original.budgets.push({ id: uid(), categoryId: original.categories.find(c => c.type === 'expense')!.id, limit: 100, updatedAt: new Date().toISOString(), deletedAt: null })
    await push(id, dataOf(original))
    const purged = resetToEmpty(original).state
    for (const key of ['transactions', 'budgets', 'accounts', 'categories'] as const) {
      purged.purged[key] = purged[key].map(row => row.id)
      purged[key] = []
    }
    await push(id, dataOf(purged), 1)
    await expect(push(id, dataOf(original), 2)).rejects.toThrow()
    const restored = restoreImport(purged, original).state
    await push(id, dataOf(restored), 2)
    const remote = await read(id)
    expect(remote.revision).toBe(3)
    expect(remote.state.purged).toEqual(dataOf(purged).purged)
    expect(remote.state.accounts).toHaveLength(3)
    expect(remote.state.transactions[0].accountId).toBe(restored.transactions[0].accountId)
    expect(remote.state.transactions[0].targetAccountId).toBe(restored.transactions[0].targetAccountId)
    expect(remote.state.budgets[0].categoryId).toBe(restored.budgets[0].categoryId)
  })
  it('persists a case-mapped merge with an existing budget and transfer without duplicate categories or summed limits', async () => {
    const id = await user(); const local = createSeed()
    const expense = local.categories.find(c => c.type === 'expense')!
    const budgetId = uid()
    local.transactions.push({ id: uid(), type: 'income', accountId: local.accounts[0].id, categoryId: local.categories[0].id, amount: 100, date: '2026-11-16', updatedAt: new Date().toISOString(), deletedAt: null })
    local.budgets.push({ id: budgetId, categoryId: expense.id, limit: 200, updatedAt: new Date().toISOString(), deletedAt: null })
    await push(id, dataOf(local))
    const source = createSeed(true); const sourceExpense = source.categories.find(c => c.type === 'expense')!
    source.categories.forEach(row => { row.name = row.name.toUpperCase() })
    source.transactions.push({ id: uid(), type: 'expense', accountId: source.accounts[0].id, categoryId: sourceExpense.id, amount: 50, date: '2026-11-16', updatedAt: new Date().toISOString(), deletedAt: null })
    source.transactions.push({ id: uid(), type: 'transfer', accountId: source.accounts[0].id, targetAccountId: source.accounts[1].id, amount: 20, date: '2026-11-16', updatedAt: new Date().toISOString(), deletedAt: null })
    const sourceBudgetId = uid()
    source.budgets.push({ id: sourceBudgetId, categoryId: sourceExpense.id, limit: 100, updatedAt: new Date().toISOString(), deletedAt: null })
    const plan = buildMergePlan(newWorkspace(`user:${id}`, local), source, { values: { [`budget:${expense.id}`]: `source:${sourceBudgetId}` } }, allocateMergeIds(local, source))
    expect(plan.unresolved).toBe(0); expect(plan.errors).toEqual([])
    await push(id, dataOf(plan.state), 1)
    const remote = await read(id)
    expect(remote.state.accounts).toHaveLength(3)
    expect(remote.state.categories).toHaveLength(7)
    expect(remote.state.transactions).toHaveLength(3)
    expect(remote.state.budgets).toHaveLength(1)
    expect(remote.state.budgets[0]).toMatchObject({ id: budgetId, categoryId: expense.id, limit: 100 })
    expect(remote.state.transactions.find(row => row.type === 'transfer')?.targetAccountId).toBe(local.accounts[1].id)
  })
  it('restores a PostgreSQL fixture backup without losing its schema, permissions, or revision', async () => {
    const id = await user(); const state = dataOf(createSeed()); state.accounts[0].initialBalance = 100
    await push(id, state)
    const backup = await db.dumpDataDir()
    state.accounts[0].initialBalance = 200; await push(id, state, 1)
    const restored = new PGlite({ loadDataDir: backup })
    try {
      await restored.exec('set role authenticated')
      await restored.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
      const result = (await restored.query<{ result: { revision: number; state: Data } }>('select public.finance_read() as result')).rows[0].result
      expect(result.revision).toBe(1)
      expect(result.state.accounts[0].initialBalance).toBe(100)
      await expect(restored.exec('delete from public.accounts')).rejects.toThrow('permission denied')
      expect((await read(id)).state.accounts[0].initialBalance).toBe(200)
    } finally { await restored.close() }
  }, 60000)
  it('upgrades a used RPC from 40001 to PT409 without changing data, operation receipts or privileges', async () => {
    const definition = async () => (await db.query<{ definition: string }>("select pg_get_functiondef('public.finance_push(bigint,uuid,jsonb)'::regprocedure) as definition")).rows[0].definition
    const privileges = async () => (await db.query("select oid, proowner, proacl::text, prosecdef, proconfig from pg_proc where oid='public.finance_push(bigint,uuid,jsonb)'::regprocedure")).rows
    const original = await definition()
    const migration = await readFile(new URL('../supabase/migrations/002_revision_conflict.sql', import.meta.url), 'utf8')
    const id = await user(); const operation = uid(); const state = dataOf(createSeed())
    const removed = state.accounts.pop()!; state.purged.accounts.push(removed.id)
    state.transactions.push({ id: uid(), accountId: state.accounts[0].id, categoryId: state.categories[0].id, type: 'income', amount: 25, date: '2026-11-17', updatedAt: new Date().toISOString(), deletedAt: null })
    state.budgets.push({ id: uid(), categoryId: state.categories.find(row => row.type === 'expense')!.id, limit: 100, updatedAt: new Date().toISOString(), deletedAt: null })
    const first = structuredClone(state)
    await push(id, first, 0, operation)
    state.accounts[0].initialBalance = 250; await push(id, state, 1)
    const before = await read(id); const access = await privileges()
    const receipts = (await db.query('select * from public.finance_operations where user_id=$1 order by revision', [id])).rows
    try {
      // Recreate the deployed legacy body on a populated fixture, then run the upgrade file unchanged.
      await db.exec(original.replace("errcode='PT409'", "errcode='40001'"))
      await expect(push(id, state, 0)).rejects.toMatchObject({ code: '40001' })
      await db.exec(migration)
      await expect(push(id, state, 0)).rejects.toMatchObject({ code: 'PT409' })
      expect(await privileges()).toEqual(access)
      expect(await read(id)).toEqual(before)
      expect((await db.query('select * from public.finance_operations where user_id=$1 order by revision', [id])).rows).toEqual(receipts)
      expect((await push(id, first, 0, operation)).revision).toBe(1)
      expect((await push(id, state, 2)).revision).toBe(3)
      await expect(asUser(id, () => db.exec('delete from public.accounts'))).rejects.toThrow('permission denied')
      await db.exec(migration)
      expect(await privileges()).toEqual(access)
      expect((await read(id)).revision).toBe(3)
      expect((await read(id)).state).toEqual(before.state)
      expect((await definition()).replaceAll('\r\n', '\n')).toBe(original.replaceAll('\r\n', '\n'))
    } finally { await db.exec(original) }
  })
})
