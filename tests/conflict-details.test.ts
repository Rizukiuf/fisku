import { describe, expect, it } from 'vitest'
import { buildConflictDetails as compareConflictDetails } from '../src/lib/conflictDetails'
import { createSeed, dataOf, uid, type Data, type Transaction } from '../src/lib/model'
import { DataConflict, reconcile } from '../src/lib/reconcile'

const seed = () => dataOf(createSeed())
const buildConflictDetails = (local: Data, remote: Data, ids: string[], base = seed()) => compareConflictDetails(local, remote, ids, base)
const transaction = (state: Data): Transaction => ({ id: uid(), accountId: state.accounts[0].id, categoryId: state.categories[0].id, type: 'income', amount: 100, date: '2026-11-17', note: 'Original note', updatedAt: '2026-11-17T01:00:00.000Z', deletedAt: null })
describe('read-only conflict comparison', () => {
  it('includes a new conflicting edit made after the original conflict IDs were saved', () => {
    const base = seed(); const local = seed(); const remote = seed()
    local.accounts[0].initialBalance = 200; remote.accounts[0].initialBalance = 100
    remote.accounts[1].initialBalance = 100
    const savedIds = [`accounts/${local.accounts[0].id}`]
    local.accounts[1].initialBalance = 200
    const result = buildConflictDetails(local, remote, savedIds, base)
    expect(result.items.map(row => row.name)).toEqual(['Tunai', 'BCA'])
  })
  it('reveals a cloud-only child affected by dataset fallback even when the original conflict was only the parent', () => {
    const base = seed(); const local = seed(); const remote = seed()
    local.accounts[0].deletedAt = '2026-11-17T01:00:00Z'
    remote.accounts[0].initialBalance = 100
    remote.transactions.push(transaction(remote))
    const savedIds = [`accounts/${local.accounts[0].id}`]
    expect(reconcile(base, local, remote, 'local').purged.transactions).toContain(remote.transactions[0].id)
    const result = buildConflictDetails(local, remote, savedIds, base)
    expect(result.wholeDataset).toBe(true)
    expect(result.items.map(row => row.kind)).toEqual(['accounts', 'transactions'])
  })
  it('shows the conflicting account name and changed fields while excluding unrelated edits and timestamps', () => {
    const local = seed(); const remote = seed(); const id = local.accounts[0].id
    local.accounts[0].initialBalance = -100; remote.accounts[0].initialBalance = 200
    remote.accounts[0].updatedAt = '2026-11-17T01:00:00.000Z'
    remote.accounts[1].name = 'Unrelated rename'
    const result = buildConflictDetails(local, remote, [`accounts/${id}`, `accounts/${id}`])
    expect(result.wholeDataset).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ name: 'Tunai', kind: 'accounts', fields: [{ field: 'initialBalance', local: { kind: 'money', value: -100 }, remote: { kind: 'money', value: 200 } }] })
  })
  it('compares category names and types with the appropriate value kinds', () => {
    const local = seed(); const remote = seed(); const id = local.categories[0].id
    remote.categories[0].name = 'Income revised'; remote.categories[0].type = 'expense'
    const item = buildConflictDetails(local, remote, [`categories/${id}`]).items[0]
    expect(item.fields.map(row => row.field)).toEqual(['name', 'type'])
    expect(item.fields[1].remote).toEqual({ kind: 'txType', value: 'expense' })
  })
  it('resolves transaction references using the correct snapshot and compares amount, date and note', () => {
    const local = seed(); local.transactions.push(transaction(local)); const remote = structuredClone(local)
    remote.transactions[0].accountId = remote.accounts[1].id
    remote.accounts[1].name = 'Remote bank'
    remote.transactions[0].categoryId = remote.categories[1].id
    remote.transactions[0].amount = 250; remote.transactions[0].date = '2026-11-18'; remote.transactions[0].note = '<b>Literal note</b>'
    const item = buildConflictDetails(local, remote, [`transactions/${local.transactions[0].id}`]).items[0]
    expect(item.name).toContain('2026-11-17'); expect(item.name).toContain('Tunai')
    expect(item.fields.map(row => row.field)).toEqual(['amount', 'date', 'accountId', 'categoryId', 'note'])
    expect(item.fields.find(row => row.field === 'accountId')).toMatchObject({ local: { value: 'Tunai' }, remote: { value: 'Remote bank' } })
    expect(item.fields.find(row => row.field === 'categoryId')?.remote.value).toBe('Bonus')
    expect(item.fields.find(row => row.field === 'note')?.remote.value).toBe('<b>Literal note</b>')
  })
  it('shows transfer destinations and supports the absence of a category', () => {
    const local = seed(); const tx = transaction(local)
    tx.type = 'transfer'; delete tx.categoryId; tx.targetAccountId = local.accounts[1].id; local.transactions.push(tx)
    const remote = structuredClone(local); remote.transactions[0].targetAccountId = remote.accounts[2].id
    const item = buildConflictDetails(local, remote, [`transactions/${tx.id}`]).items[0]
    expect(item.fields).toEqual([{ field: 'targetAccountId', local: { kind: 'text', value: 'BCA' }, remote: { kind: 'text', value: 'GoPay' } }])
  })
  it('names budgets by category and shows the limit without adding balances', () => {
    const local = seed(); const id = uid()
    local.budgets.push({ id, categoryId: local.categories[2].id, limit: 100, deletedAt: null, updatedAt: '2026-11-17T00:00:00Z' })
    const remote = structuredClone(local); remote.budgets[0].limit = 300
    const item = buildConflictDetails(local, remote, [`budgets/${id}`]).items[0]
    expect(item.name).toBe('Makan & Minum')
    expect(item.fields).toEqual([{ field: 'limit', local: { kind: 'money', value: 100 }, remote: { kind: 'money', value: 300 } }])
  })
  it('distinguishes active, trash, missing and purged states without inventing rows', () => {
    const local = seed(); const remote = seed(); const id = local.accounts[0].id
    remote.accounts.shift(); remote.purged.accounts.push(id)
    const item = buildConflictDetails(local, remote, [`accounts/${id} (dimusnahkan di cloud)`]).items[0]
    expect(item.name).toBe('Tunai')
    expect(item.fields[0]).toEqual({ field: 'status', local: { kind: 'status', value: 'active' }, remote: { kind: 'status', value: 'purged' } })
    remote.purged.accounts = []
    expect(buildConflictDetails(local, remote, [`accounts/${id}`]).items[0].fields[0].remote.value).toBe('missing')
    remote.accounts.push({ ...local.accounts[0], deletedAt: '2026-11-17T01:00:00Z' })
    expect(buildConflictDetails(local, remote, [`accounts/${id}`]).items[0].fields[0].remote.value).toBe('deleted')
  })
  it('shows deletion time differences even if both versions are already in Trash', () => {
    const local = seed(); const remote = seed(); const id = local.accounts[0].id
    local.accounts[0].deletedAt = '2026-11-17T01:00:00Z'; remote.accounts[0].deletedAt = '2026-11-17T02:00:00Z'
    expect(buildConflictDetails(local, remote, [`accounts/${id}`]).items[0].fields.map(row => row.field)).toEqual(['deletedAt'])
  })
  it('explains a real relational conflict by comparing the differing parent and child graph', () => {
    const base = seed(); const local = seed(); const remote = seed()
    local.accounts[0].deletedAt = '2026-11-17T01:00:00Z'
    remote.transactions.push(transaction(remote))
    let ids: string[] = []
    try { reconcile(base, local, remote) } catch (error) { expect(error).toBeInstanceOf(DataConflict); ids = (error as DataConflict).ids }
    expect(ids[0]).toContain('relasi:')
    const result = buildConflictDetails(local, remote, ids)
    expect(result.wholeDataset).toBe(true)
    expect(result.items.map(row => row.kind)).toEqual(['accounts', 'transactions'])
    expect(result.items[0].fields[0]).toMatchObject({ field: 'status', local: { value: 'deleted' }, remote: { value: 'active' } })
    expect(result.items[1].fields[0]).toMatchObject({ field: 'status', local: { value: 'missing' }, remote: { value: 'active' } })
  })
  it('handles unknown historical IDs conservatively and leaves both snapshots unchanged', () => {
    const local = seed(); const remote = seed(); remote.accounts[0].name = 'Cloud rename'
    const before = JSON.stringify({ local, remote })
    const result = buildConflictDetails(local, remote, ['data'])
    expect(result.wholeDataset).toBe(true); expect(result.items).toHaveLength(1)
    expect(JSON.stringify({ local, remote })).toBe(before)
  })
  it('keeps an identifiable conflict visible when subsequent local edits already match cloud', () => {
    const local = seed(); const remote = seed(); remote.accounts[0].updatedAt = '2026-11-17T01:00:00Z'
    const result = buildConflictDetails(local, remote, [`accounts/${local.accounts[0].id}`])
    expect(result.items).toHaveLength(1); expect(result.items[0].fields).toEqual([])
  })
  it('disambiguates different reference IDs with identical names across snapshots', () => {
    const local = seed(); local.transactions.push(transaction(local)); const remote = structuredClone(local)
    remote.accounts[0].name = 'Other cash'; remote.accounts[1].name = 'Tunai'; remote.transactions[0].accountId = remote.accounts[1].id
    const field = buildConflictDetails(local, remote, [`transactions/${local.transactions[0].id}`]).items[0].fields[0]
    expect(field.local.value).toContain(local.accounts[0].id)
    expect(field.remote.value).toContain(remote.accounts[1].id)
  })
})
