import { test, expect, type Page } from '@playwright/test'
import { mockCloud } from './fixtures/cloud'

async function open(page: Page) {
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(async () => {
    const s = await import('/src/lib/store.ts'); const state = s.getState()
    await s.actions.addTransaction({ accountId: state.accounts[0].id, categoryId: state.categories[0].id, type: 'income', amount: 100, date: '2026-11-17' })
    await s.actions.addTransaction({ accountId: state.accounts[0].id, targetAccountId: state.accounts[1].id, type: 'transfer', amount: 25, date: '2026-11-17' })
    await s.actions.setBudget(state.categories.find(row => row.type === 'expense')!.id, 100)
    await s.actions.reset()
  })
  await page.locator('summary').filter({ hasText: 'Sampah' }).click()
}
const snapshot = (page: Page) => page.evaluate(async () => {
  const s = await import('/src/lib/store.ts'); const r = await import('/src/lib/repository.ts')
  return { state: s.getState(), backups: await r.listBackups(s.getScope()) }
})

test('restore all restores parents, transactions and budgets in one action and survives reload', async ({ page, context }) => {
  await mockCloud(context); await open(page)
  await expect(page.getByRole('button', { name: 'Pulihkan semua', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await expect(page.getByText('13 data dipulihkan.', { exact: true })).toBeVisible()
  const restored = await snapshot(page)
  expect(restored.state.accounts.filter(row => !row.deletedAt)).toHaveLength(3)
  expect(restored.state.categories.filter(row => !row.deletedAt)).toHaveLength(7)
  expect(restored.state.transactions.filter(row => !row.deletedAt)).toHaveLength(2)
  expect(restored.state.budgets.filter(row => !row.deletedAt)).toHaveLength(1)
  await page.reload(); expect((await snapshot(page)).state).toEqual(restored.state)
})

test('name collisions and dependent transfers stay in Trash with an English explanation', async ({ page, context }) => {
  await mockCloud(context); await open(page)
  await page.evaluate(async () => (await import('/src/lib/store.ts')).actions.addAccount({ name: 'bca', type: 'bank', initialBalance: 0 }))
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Restore all', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Restore all', exact: true }).click()
  await expect(page.getByText('11 items restored.', { exact: true })).toBeVisible()
  await expect(page.getByText('2 items remain in Trash.', { exact: true })).toBeVisible()
  await expect(page.getByText(/1.*name.*already in use/i)).toBeVisible()
  const result = await snapshot(page)
  expect(result.state.accounts.filter(row => row.deletedAt)).toHaveLength(1)
  expect(result.state.transactions.filter(row => row.deletedAt)).toHaveLength(1)
})

test('a removed zero-limit budget remains in Trash while other data is restored', async ({ page, context }) => {
  await mockCloud(context); await open(page)
  await page.evaluate(async () => { const s = await import('/src/lib/store.ts'); await s.actions.removeBudget(s.getState().budgets[0].categoryId) })
  await page.getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await expect(page.getByText('12 data dipulihkan.', { exact: true })).toBeVisible()
  await expect(page.getByText('1 data tetap di Sampah.', { exact: true })).toBeVisible()
  await expect(page.getByText(/batas.*positif.*Anggaran/)).toBeVisible()
  expect((await snapshot(page)).state.budgets[0].deletedAt).toBeTruthy()
})

test('cancelling and then confirming a stale Trash snapshot cannot restore changed data', async ({ page, context }) => {
  await mockCloud(context); await open(page); const before = await snapshot(page)
  await page.getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Batal', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await page.evaluate(async () => (await import('/src/lib/store.ts')).actions.addAccount({ name: 'New while reviewing', type: 'cash', initialBalance: 0 }))
  await page.getByRole('dialog').getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await expect(page.getByText('Data berubah sejak konfirmasi. Periksa Sampah terbaru sebelum memulihkan semua.', { exact: true })).toBeVisible()
  expect((await snapshot(page)).state.transactions.every(row => row.deletedAt)).toBe(true)
})

test('a failed restore commit preserves Trash and backups and does not report success', async ({ page, context }) => {
  await mockCloud(context); await open(page); const before = await snapshot(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put; let fail = true
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (fail) { fail = false; throw new DOMException('Restore UI quota fixture', 'QuotaExceededError') }
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Pulihkan semua', exact: true }).click()
  await expect(page.getByText('Restore UI quota fixture', { exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(before)
  await expect(page.getByText('13 data dipulihkan.', { exact: true })).toHaveCount(0)
})
