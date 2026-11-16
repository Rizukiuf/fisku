import { test, expect, type Page } from '@playwright/test'
import { mockCloud } from './fixtures/cloud'

const guestButton = (page: Page) => page.getByRole('button', { name: 'Impor data tamu ke akun ini', exact: true })
async function start(page: Page, template = true) {
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: template ? 'Gunakan template bawaan' : 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function login(page: Page, email = 'a@example.test') {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function importGuest(page: Page) {
  await guestButton(page).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Ganti (Replace)', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(guestButton(page)).toHaveCount(0)
}

test('guest import only merges, preserves account transactions and budgets, and stays hidden after reload', async ({ page, context }) => {
  await mockCloud(context); await start(page); await login(page)
  const before = await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const account = await store.actions.addAccount({ name: 'User bank', type: 'bank', initialBalance: 1000 })
    const category = await store.actions.addCategory({ name: 'User expense', type: 'expense' })
    await store.actions.addTransaction({ type: 'expense', amount: 100, date: '2026-11-16', accountId: account.id, categoryId: category.id })
    await store.actions.setBudget(category.id, 200)
    return store.getState()
  })
  await guestButton(page).click()
  await expect(page.getByRole('dialog')).toContainText('Data tamu tetap disimpan')
  await page.getByRole('dialog').getByRole('button', { name: 'Batal', exact: true }).click()
  await expect(guestButton(page)).toBeVisible()
  await importGuest(page)
  const after = await page.evaluate(async () => (await import('/src/lib/store.ts')).getState())
  expect(after.transactions).toEqual(before.transactions); expect(after.budgets).toEqual(before.budgets)
  await page.reload()
  await expect(page.getByText('a@example.test', { exact: true })).toBeVisible()
  await expect(guestButton(page)).toHaveCount(0)
  const saved = await page.evaluate(async () => (await import('/src/lib/repository.ts')).readWorkspace('guest'))
  expect(saved.state.accounts).toHaveLength(3)
})

test('empty guest data never offers replacement of a populated account', async ({ page, context }) => {
  await mockCloud(context); await start(page, false); await login(page)
  await page.evaluate(async () => (await import('/src/lib/store.ts')).actions.addAccount({ name: 'Only user data', type: 'cash', initialBalance: 10 }))
  await expect(page.getByText('Only user data', { exact: true })).toBeVisible()
  await expect(guestButton(page)).toHaveCount(0)
  expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).actions.guestImportAvailable())).toBe(false)
})

test('changed guest content in another tab makes the button available again', async ({ page, context }) => {
  await mockCloud(context); await start(page); await login(page); await importGuest(page)
  const tab = await context.newPage(); await tab.goto('/#/settings')
  await expect(tab.getByText('a@example.test', { exact: true })).toBeVisible()
  await tab.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    await store.switchWorkspace(null)
    await store.actions.addAccount({ name: 'New guest data', type: 'bank', initialBalance: 7 })
  })
  await expect(guestButton(page)).toBeVisible()
  await expect(page.getByText('New guest data', { exact: true })).toHaveCount(0)
  await importGuest(page)
  await expect(page.getByText('New guest data', { exact: true })).toBeVisible()
})
