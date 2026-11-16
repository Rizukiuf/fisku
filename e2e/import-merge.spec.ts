import { test, expect, type Page } from '@playwright/test'
import { createSeed, now, uid } from '../src/lib/model'
import { mockCloud } from './fixtures/cloud'

async function start(page: Page) {
  await page.goto('http://127.0.0.1:5176/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('BCA', { exact: true })).toBeVisible()
}
async function upload(page: Page, state: ReturnType<typeof createSeed>) {
  await page.locator('input[type="file"]').setInputFiles({ name: 'merge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) })
}
function source(amount = 25) {
  const state = createSeed(true)
  state.transactions.push({ id: uid(), type: 'expense', accountId: state.accounts[0].id, categoryId: state.categories.find(row => row.type === 'expense')!.id, amount, date: '2026-11-16', updatedAt: now(), deletedAt: null })
  return state
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); const repo = await import('/src/lib/repository.ts')
    return { workspace: await repo.readWorkspace(store.getScope()), backups: await repo.listBackups(store.getScope()) }
  })
}
async function localTransaction(page: Page, amount = 25) {
  return page.evaluate(async amount => {
    const store = await import('/src/lib/store.ts'); const state = store.getState()
    await store.actions.addTransaction({ type: 'expense', amount, date: '2026-11-16', accountId: state.accounts[0].id, categoryId: state.categories.find(row => row.type === 'expense')!.id })
    return store.getState().transactions[0].id
  }, amount)
}
test('default Merge previews mapped entities and preserves unrelated local data before committing a file', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await start(page)
  await page.evaluate(async () => { await (await import('/src/lib/store.ts')).actions.addAccount({ name: 'Local savings', type: 'cash', initialBalance: 1000 }) })
  const source = createSeed(true)
  source.accounts.forEach(row => { row.name = row.name.toLowerCase() })
  source.transactions.push({ id: uid(), type: 'expense', accountId: source.accounts[0].id, categoryId: source.categories.find(row => row.type === 'expense')!.id, amount: 25, date: '2026-11-16', updatedAt: now(), deletedAt: null })
  await upload(page, source)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Gabungkan (Merge)', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByLabel('Pemetaan akun tunai', { exact: true })).toHaveValue('11111111-1111-4111-8111-111111111111')
  expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).getState().transactions.length)).toBe(0)
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const state = await page.evaluate(async () => (await import('/src/lib/store.ts')).getState())
  expect(state.accounts.filter(row => !row.deletedAt)).toHaveLength(4)
  expect(state.transactions[0].accountId).toBe('11111111-1111-4111-8111-111111111111')
  expect(state.accounts.some(row => row.name === 'Local savings' && !row.deletedAt)).toBe(true)
})

test('a possible duplicate can be kept as a real second purchase and repeated imports do not duplicate it again', async ({ page }) => {
  await start(page); await localTransaction(page)
  const imported = source(); await upload(page, imported)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeDisabled()
  await dialog.getByLabel(`Pilihan transaksi ${imported.transactions[0].id}`, { exact: true }).selectOption('add')
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const after = await snapshot(page)
  expect(after.workspace.state.transactions.filter(row => !row.deletedAt)).toHaveLength(2)
  await upload(page, imported)
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await snapshot(page)).toEqual(after)
})

test('a possible duplicate can explicitly match a local transaction without changing finance or creating a backup', async ({ page }) => {
  await start(page); const localId = await localTransaction(page)
  const before = await snapshot(page); const imported = source()
  await upload(page, imported)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(`Pilihan transaksi ${imported.transactions[0].id}`, { exact: true }).selectOption(`match:${localId}`)
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const after = await snapshot(page)
  expect(after.workspace.state).toEqual(before.workspace.state)
  expect(after.backups).toEqual(before.backups)
})

test('opening balance and budget conflicts use explicit values and show the resulting total balance', async ({ page }) => {
  await start(page)
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); const state = store.getState()
    await store.actions.updateAccount(state.accounts[0].id, { initialBalance: 100 })
    await store.actions.setBudget(state.categories.find(row => row.type === 'expense')!.id, 100)
  })
  const imported = source(); imported.accounts[0].initialBalance = 200
  const sourceBudget = uid(); const categoryId = imported.categories.find(row => row.type === 'expense')!.id
  imported.budgets.push({ id: sourceBudget, categoryId, limit: 200, updatedAt: now(), deletedAt: null })
  await upload(page, imported)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeDisabled()
  await dialog.getByLabel('Saldo awal Tunai', { exact: true }).selectOption('local')
  await dialog.getByLabel('Batas anggaran Makan & Minum', { exact: true }).selectOption(`source:${sourceBudget}`)
  await expect(dialog.getByRole('status', { name: 'Pratinjau total saldo', exact: true })).toContainText('75')
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const after = await snapshot(page)
  expect(after.workspace.state.accounts[0].initialBalance).toBe(100)
  expect(after.workspace.state.budgets).toHaveLength(1)
  expect(after.workspace.state.budgets[0].limit).toBe(200)
})

for (const [choice, amount, count] of [['local', 25, 1], ['incoming', 40, 1], ['copy', 65, 2]] as const) {
  test(`same-ID transaction conflict supports ${choice} without an automatic overwrite`, async ({ page }) => {
    await start(page); const id = await localTransaction(page)
    const imported = (await snapshot(page)).workspace.state; imported.transactions[0].amount = 40
    await upload(page, imported)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeDisabled()
    await dialog.getByLabel(`Pilihan transaksi ${id}`, { exact: true }).selectOption(choice)
    await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const after = await snapshot(page)
    expect(after.workspace.state.transactions.filter(row => !row.deletedAt)).toHaveLength(count)
    expect(after.workspace.state.transactions.filter(row => !row.deletedAt).reduce((sum, row) => sum + row.amount, 0)).toBe(amount)
  })
}

test('purged identities require an explicit recovery choice in Merge and remain retired afterward', async ({ page }) => {
  await start(page); const imported = (await snapshot(page)).workspace.state
  await page.evaluate(async () => { const store = await import('/src/lib/store.ts'); await store.actions.reset(); await store.actions.purgeDeleted() })
  const before = await snapshot(page)
  await upload(page, imported)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Pulihkan data terhapus sebagai salinan', exact: true }).click()
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const after = await snapshot(page)
  expect(after.workspace.state.purged).toEqual(before.workspace.state.purged)
  expect(after.workspace.state.accounts).toHaveLength(3)
  expect(after.workspace.state.accounts.every(row => !imported.accounts.some(old => old.id === row.id))).toBe(true)
})

test('mapping two transfer accounts to one target requires skipping the invalid transfer or changing the mapping', async ({ page }) => {
  await start(page); const imported = createSeed(true)
  imported.transactions.push({ id: uid(), type: 'transfer', accountId: imported.accounts[0].id, targetAccountId: imported.accounts[1].id, amount: 10, date: '2026-11-16', updatedAt: now(), deletedAt: null })
  await upload(page, imported)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Pemetaan akun BCA', { exact: true }).selectOption('11111111-1111-4111-8111-111111111111')
  await expect(dialog.getByText('Asal dan tujuan menjadi akun yang sama. Ubah pemetaan akun atau lewati transfer.', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeDisabled()
  await dialog.getByLabel(`Pilihan transaksi ${imported.transactions[0].id}`, { exact: true }).selectOption('skip')
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await snapshot(page)).workspace.state.transactions).toHaveLength(0)
})

test('a newer edit from a second tab forces a refreshed preview before committing', async ({ page, context }) => {
  await start(page); const other = await context.newPage()
  await other.goto('http://127.0.0.1:5176/#/settings')
  await expect(other.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  await upload(page, source())
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeEnabled()
  await other.evaluate(async () => { const store = await import('/src/lib/store.ts'); await store.actions.updateAccount(store.getState().accounts[0].id, { initialBalance: 100 }) })
  await expect(dialog.getByText('Data berubah sejak pratinjau. Perbarui pratinjau dan periksa pilihan kembali.', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Perbarui pratinjau', exact: true }).click()
  await dialog.getByLabel('Saldo awal Tunai', { exact: true }).selectOption('local')
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await snapshot(page)).workspace.state.accounts[0].initialBalance).toBe(100)
})

test('merge write failure keeps the review open and rolls back data, aliases and backups', async ({ page }) => {
  await start(page); const before = await snapshot(page); await upload(page, source())
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; let fail = true
    IDBObjectStore.prototype.put = function (...args) { if (fail) { fail = false; throw new Error('Merge write failure') }; return put.apply(this, args) }
  })
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Merge write failure')
  expect(await snapshot(page)).toEqual(before)
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await snapshot(page)).workspace.state.transactions).toHaveLength(1)
})

test('transaction review is paginated and can exclude one of 51 genuine source transactions', async ({ page }) => {
  await start(page); const imported = createSeed(true)
  for (let i = 0; i < 51; i++) imported.transactions.push({ id: uid(), type: 'expense', amount: 1, accountId: imported.accounts[0].id, categoryId: imported.categories.find(row => row.type === 'expense')!.id, date: '2026-11-16', note: `Purchase ${i}`, updatedAt: now(), deletedAt: null })
  await upload(page, imported)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Lihat semua transaksi', exact: true }).click()
  await expect(dialog.locator('select[aria-label^="Pilihan transaksi"]')).toHaveCount(25)
  await dialog.getByRole('button', { name: 'Halaman berikutnya', exact: true }).click()
  await expect(dialog.locator('select[aria-label^="Pilihan transaksi"]')).toHaveCount(25)
  await dialog.getByRole('button', { name: 'Halaman berikutnya', exact: true }).click()
  await expect(dialog.locator('select[aria-label^="Pilihan transaksi"]')).toHaveCount(1)
  await dialog.locator('select[aria-label^="Pilihan transaksi"]').selectOption('skip')
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await snapshot(page)).workspace.state.transactions).toHaveLength(50)
})

test('cancel and Escape never write the preview or its proposed aliases', async ({ page }) => {
  await start(page); const before = await snapshot(page)
  await upload(page, source()); await expect(page.getByRole('dialog').getByRole('button', { name: 'Gabungkan (Merge)', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)
})

test('guest Merge retains transactions already recorded in the user workspace', async ({ page, context }) => {
  await mockCloud(context)
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await localTransaction(page, 25)
  const guest = await snapshot(page)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await localTransaction(page, 100)
  await page.getByRole('button', { name: 'Impor data tamu ke akun ini', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await snapshot(page)).workspace.state.transactions).toHaveLength(2)
  expect(await page.evaluate(async () => (await (await import('/src/lib/repository.ts')).readWorkspace('guest')))).toEqual(guest.workspace)
})

test('an original-and-copy export merges as a no-op and the original import file still recognizes its copy', async ({ page }) => {
  await start(page); const originalId = await localTransaction(page)
  const originalFile = (await snapshot(page)).workspace.state
  originalFile.transactions[0].amount = 40
  await upload(page, originalFile)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(`Pilihan transaksi ${originalId}`, { exact: true }).selectOption('copy')
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const copied = await snapshot(page)
  await upload(page, copied.workspace.state)
  await expect(dialog.getByRole('button', { name: 'Impor data', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await snapshot(page)).toEqual(copied)
  await upload(page, originalFile)
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await snapshot(page)).toEqual(copied)
})
