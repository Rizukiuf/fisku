import { test, expect, type Page } from '@playwright/test'
import { mockCloud, userA } from './fixtures/cloud'

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const repo = await import('/src/lib/repository.ts')
    return { workspace: await repo.readWorkspace(store.getScope()), backups: await repo.listBackups(store.getScope()) }
  })
}
async function upload(page: Page, json: string, replace = true) {
  await page.locator('input[type="file"]').setInputFiles({ name: 'cadangan.json', mimeType: 'application/json', buffer: Buffer.from(json) })
  if (replace) await page.getByRole('dialog').getByRole('button', { name: 'Ganti (Replace)', exact: true }).click()
}
async function makePurgedBackup(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const state = store.getState()
    await store.actions.addTransaction({ type: 'income', accountId: state.accounts[0].id, categoryId: state.categories.find(c => c.type === 'income')!.id, amount: 100, date: '2026-11-16' })
    await store.actions.addTransaction({ type: 'expense', accountId: state.accounts[0].id, categoryId: state.categories.find(c => c.type === 'expense')!.id, amount: 30, date: '2026-11-16' })
    await store.actions.addTransaction({ type: 'transfer', accountId: state.accounts[0].id, targetAccountId: state.accounts[1].id, amount: 20, date: '2026-11-16' })
    await store.actions.setBudget(state.categories.find(c => c.type === 'expense')!.id, 300)
    const json = store.actions.exportJSON()
    await store.actions.reset(); await store.actions.purgeDeleted()
    return json
  })
}
async function startLocal(page: Page) {
  await page.goto('http://127.0.0.1:5176/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function restore(page: Page, json: string) {
  await upload(page, json)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('pernah dimusnahkan')
  await dialog.getByRole('button', { name: 'Pulihkan sebagai data baru', exact: true }).click()
  await expect(page.getByText('Data berhasil diimpor', { exact: true }).last()).toBeVisible()
}

test('file recovery can be cancelled and then restores linked data after purge without reviving old IDs', async ({ page }) => {
  await startLocal(page); const json = await makePurgedBackup(page)
  const before = await snapshot(page)
  await upload(page, json)
  await expect(page.getByRole('dialog')).toContainText('14 data dalam cadangan pernah dimusnahkan')
  await page.getByRole('dialog').getByRole('button', { name: 'Batal', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await restore(page, json)
  const restored = await snapshot(page); const state = restored.workspace.state
  expect(state.purged).toEqual(before.workspace.state.purged)
  expect(state.accounts).toHaveLength(3)
  expect(state.categories).toHaveLength(7)
  expect(state.transactions).toHaveLength(3)
  expect(state.budgets).toHaveLength(1)
  for (const account of state.accounts) expect(state.purged.accounts).not.toContain(account.id)
  const balances = await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); const state = store.getState()
    return state.accounts.map(account => store.accountBalance(account, state.transactions))
  })
  expect(balances).toEqual([50, 20, 0])
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(restored)
  await restore(page, json)
  expect(await snapshot(page)).toEqual(restored)
})

test('a normal file import still preserves identities when no purge collision exists', async ({ page }) => {
  await startLocal(page)
  const json = await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    await store.actions.updateAccount(store.getState().accounts[0].id, { initialBalance: 100 })
    const json = store.actions.exportJSON()
    await store.actions.updateAccount(store.getState().accounts[0].id, { initialBalance: 200 })
    return json
  })
  const before = await snapshot(page)
  await upload(page, json)
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Pulihkan sebagai data baru', exact: true })).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(page.getByText('Data berhasil diimpor', { exact: true })).toBeVisible()
  const after = await snapshot(page)
  expect(after.workspace.state.accounts[0].initialBalance).toBe(100)
  expect(after.workspace.state.accounts.map(row => row.id)).toEqual(before.workspace.state.accounts.map(row => row.id))
  expect(after.workspace.importIds).toBeUndefined()
  expect(after.backups[0].state).toEqual(before.workspace.state)
})

test('failed recovery writes preserve the old workspace, purge history, mapping and backups', async ({ page }) => {
  await startLocal(page); const json = await makePurgedBackup(page)
  const before = await snapshot(page)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; let fail = true
    IDBObjectStore.prototype.put = function (...args) {
      if (fail) { fail = false; throw new DOMException('Import recovery quota', 'QuotaExceededError') }
      return put.apply(this, args)
    }
  })
  await upload(page, json)
  await page.getByRole('dialog').getByRole('button', { name: 'Pulihkan sebagai data baru', exact: true }).click()
  await expect(page.getByText('Import recovery quota', { exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(before)
  await restore(page, json)
  expect((await snapshot(page)).workspace.state.accounts).toHaveLength(3)
})

test('invalid backup files are rejected before confirmation without changing data', async ({ page }) => {
  await startLocal(page); const before = await snapshot(page)
  await upload(page, '{"format":"fisku-backup","version":99}', false)
  await expect(page.getByText('Versi backup tidak didukung.', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)
})

test('a cached user workspace can recover a file offline and later sync without clearing server deletion markers', async ({ page, context }) => {
  const cloud = await mockCloud(context)
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const json = await makePurgedBackup(page)
  await page.evaluate(async () => { await (await import('/src/lib/sync.ts')).runSync() })
  const before = structuredClone(cloud.snapshots.get(userA)!.state)
  await context.setOffline(true)
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    await store.switchWorkspace(store.getScope().slice(5))
  })
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).hasLoadedCloud())).toBe(false)
  await restore(page, json)
  expect(cloud.snapshots.get(userA)!.state.accounts).toHaveLength(0)
  await context.setOffline(false)
  await page.evaluate(async () => { await (await import('/src/lib/sync.ts')).runSync() })
  const remote = cloud.snapshots.get(userA)!.state
  expect(remote.purged).toEqual(before.purged)
  expect(remote.accounts).toHaveLength(3)
  expect(remote.categories).toHaveLength(7)
  expect(remote.transactions).toHaveLength(3)
  expect(remote.budgets).toHaveLength(1)
  expect(remote.accounts.every((row: { id: string }) => !remote.purged.accounts.includes(row.id))).toBe(true)
  expect(remote.importIds).toBeUndefined()
})

test('guest adoption offers the same recovery when the user has purged shared seed IDs', async ({ page, context }) => {
  await mockCloud(context)
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const guest = await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); const state = store.getState()
    await store.actions.addTransaction({ type: 'income', amount: 123, accountId: state.accounts[0].id, categoryId: state.categories.find(c => c.type === 'income')!.id, date: '2026-11-16' })
    return await (await import('/src/lib/repository.ts')).readWorkspace('guest')
  })
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    await store.actions.reset(); await store.actions.purgeDeleted()
    await (await import('/src/lib/sync.ts')).runSync()
  })
  const before = await snapshot(page)
  await page.getByRole('button', { name: 'Impor data tamu ke akun ini', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Ganti (Replace)', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Pulihkan data terhapus sebagai salinan', exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Batal', exact: true }).click()
  expect((await snapshot(page)).workspace.state).toEqual(before.workspace.state)
  await page.getByRole('button', { name: 'Impor data tamu ke akun ini', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pulihkan data terhapus sebagai salinan', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(page.getByText('Data berhasil diimpor', { exact: true })).toBeVisible()
  expect((await snapshot(page)).workspace.state.transactions).toHaveLength(1)
  expect((await snapshot(page)).workspace.state.purged).toEqual(before.workspace.state.purged)
  expect(await page.evaluate(async () => (await (await import('/src/lib/repository.ts')).readWorkspace('guest')))).toEqual(guest)
})
