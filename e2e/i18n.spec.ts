import { test, expect, type Page } from '@playwright/test'
import { mockCloud } from './fixtures/cloud'

async function open(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('all sync indicators and stages follow the selected language immediately', async ({ page, context }) => {
  await mockCloud(context); await open(page)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).getSyncStatus().status)).toBe('ok')
  await page.clock.install()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  for (const row of [
    { status: 'syncing', lastSync: null, phase: 'membaca data cloud', label: 'Syncing...' },
    { status: 'error', lastSync: null, phase: null, label: 'Sync failed' },
    { status: 'offline', lastSync: null, phase: null, label: 'Offline' },
    { status: 'ok', lastSync: '2026-11-17T01:00:00Z', phase: null, label: 'Synced' },
    { status: 'ok', lastSync: null, phase: null, label: 'Not synced' },
  ]) {
    await page.evaluate(async row => {
      const sync = await import('/src/lib/syncStatus.ts')
      sync.setSyncStatus({ ...row, error: null } as any)
      if (row.phase) sync.setSyncStatus({ phase: row.phase })
    }, row)
    await expect(page.getByText(row.label, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    if (row.phase) await expect(page.getByRole('status').filter({ hasText: 'Stage:' })).toContainText('reading cloud data')
  }
  await page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).setSyncStatus({ status: 'ok', error: null }))
  await page.getByRole('button', { name: 'Bahasa Indonesia', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'id')
  await expect(page.getByRole('button', { name: 'Tambah', exact: true }).filter({ visible: true }).first()).toBeVisible()
})

test('chart month labels and accessible names change language without changing financial data', async ({ page, context }) => {
  await mockCloud(context); await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z')); await open(page)
  const before = await page.evaluate(async () => { const s = await import('/src/lib/store.ts'); return s.dataOf(s.getState()) })
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.evaluate(() => { window.location.hash = '/dashboard' })
  await expect(page.getByRole('img', { name: /cash flow/i })).toBeVisible()
  await expect(page.getByText('May', { exact: true })).toBeVisible()
  await expect(page.getByText('Oct', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add', exact: true }).filter({ visible: true }).first()).toBeVisible()
  await page.evaluate(() => { window.location.hash = '/settings' })
  await page.getByRole('button', { name: 'Bahasa Indonesia', exact: true }).click()
  await page.evaluate(() => { window.location.hash = '/dashboard' })
  await expect(page.getByRole('img', { name: /Arus kas/ })).toBeVisible()
  await expect(page.getByText('Mei', { exact: true })).toBeVisible()
  expect(await page.evaluate(async () => { const s = await import('/src/lib/store.ts'); return s.dataOf(s.getState()) })).toEqual(before)
})

test('domain validation toasts use the active language and retain their meaning after switching back', async ({ page, context }) => {
  await mockCloud(context); await open(page)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.evaluate(async () => {
    const { perform } = await import('/src/lib/ui.ts'); const s = await import('/src/lib/store.ts')
    await perform(() => s.actions.addAccount({ name: 'Invalid amount fixture', type: 'cash', initialBalance: Number.MAX_SAFE_INTEGER + 1 }))
  })
  await expect(page.getByText('Opening balance: use a whole rupiah amount within the safe integer range.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Bahasa Indonesia', exact: true }).click()
  await expect(page.getByText('Saldo awal: gunakan bilangan rupiah bulat dalam batas aman.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tutup', exact: true }).first()).toBeVisible()
})

test('English import preview localizes domain errors while preserving user-created names', async ({ page, context }) => {
  await mockCloud(context); await open(page)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  const source = await page.evaluate(async () => {
    const s = await import('/src/lib/store.ts'); const state = s.createSeed(true)
    state.accounts[0].name = 'Tunai'; state.accounts[0].type = 'credit'
    return JSON.stringify(state)
  })
  await page.locator('input[type="file"]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(source) })
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Account mapping Tunai', { exact: true }).selectOption('new')
  await expect(dialog.getByRole('alert')).toContainText('Duplicate account name; choose the data mapping first.')
  await expect(dialog.getByText('Tunai', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('English preference persists across reload and page navigation', async ({ page, context }) => {
  await mockCloud(context); await open(page)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  for (const route of ['dashboard', 'transactions', 'budgets']) {
    await page.evaluate(route => { window.location.hash = '/' + route }, route)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('button', { name: 'Add', exact: true }).filter({ visible: true }).first()).toBeVisible()
  }
})

test('recovery startup uses browser language when stored preferences cannot be loaded', async ({ page, context }) => {
  await mockCloud(context)
  await page.addInitScript(() => { localStorage.setItem('finance.v3', '{invalid') })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Legacy local data is invalid.')
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export recovery data', exact: true })).toBeVisible()
})
