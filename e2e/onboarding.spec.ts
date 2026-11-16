import { test, expect, type Page } from '@playwright/test'
import { createSeed, dataOf } from '../src/lib/model'
import { mockCloud, userA } from './fixtures/cloud'

const title = 'Bagaimana Anda ingin memulai?'
const wizard = (page: Page) => page.getByRole('dialog', { name: title, exact: true })
async function openLocal(page: Page) { await page.goto('http://127.0.0.1:5176/#/settings') }
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    return { workspace: store.getWorkspace(), backups: await (await import('/src/lib/repository.ts')).listBackups(store.getScope()) }
  })
}
async function login(page: Page) {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByText('a@example.test', { exact: true })).toBeVisible()
}

test('first-use template choice fits mobile, saves exactly once, and does not reappear after reset', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openLocal(page)
  await expect(wizard(page)).toBeVisible()
  await expect(wizard(page).getByText('3 akun bersaldo nol dan 7 kategori. Semuanya dapat diubah atau dihapus.', { exact: true })).toBeVisible()
  const bounds = await wizard(page).boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect((await snapshot(page)).workspace?.state.accounts).toHaveLength(0)
  await wizard(page).getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
  const chosen = await snapshot(page)
  expect(chosen.workspace?.onboarding).toBe('template')
  expect(chosen.workspace?.state.accounts).toHaveLength(3)
  expect(chosen.workspace?.state.categories).toHaveLength(7)
  expect(chosen.backups).toHaveLength(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  await expect(wizard(page)).toHaveCount(0)
  expect(await snapshot(page)).toEqual(chosen)
  await page.locator('summary').filter({ hasText: 'Alat lanjutan' }).click()
  await page.getByRole('button', { name: 'Reset semua data', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reset semua data', exact: true }).click()
  await expect(page.getByText('Data aktif dikosongkan', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  await expect(wizard(page)).toHaveCount(0)
  expect((await snapshot(page)).workspace?.state.accounts.filter(row => !row.deletedAt)).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Gunakan template bawaan', exact: true })).toBeVisible()
})

test('starting empty persists without a backup and retains the manual template option', async ({ page }) => {
  await openLocal(page)
  await wizard(page).getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
  const chosen = await snapshot(page)
  expect(chosen.workspace?.onboarding).toBe('empty')
  expect(chosen.workspace?.state.accounts).toHaveLength(0)
  expect(chosen.backups).toHaveLength(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(chosen)
  await expect(wizard(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(page.getByText('BCA', { exact: true })).toBeVisible()
  expect((await snapshot(page)).workspace?.onboarding).toBe('template')
})

test('choose later, Escape, and backdrop close without writes and prompt again on next load', async ({ page }) => {
  await openLocal(page); await expect(wizard(page)).toBeVisible()
  const before = await snapshot(page)
  await wizard(page).getByRole('button', { name: 'Pilih nanti', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)
  await page.reload(); await expect(wizard(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(wizard(page)).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)
  await page.reload(); await expect(wizard(page)).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(wizard(page)).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)
  await page.reload(); await expect(wizard(page)).toBeVisible()
})

test('a choice in one tab closes the pending dialog in another tab without duplicating data', async ({ page, context }) => {
  await openLocal(page); await expect(wizard(page)).toBeVisible()
  const other = await context.newPage(); await openLocal(other)
  await expect(wizard(other)).toBeVisible()
  await wizard(page).getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
  await expect(wizard(other)).toHaveCount(0)
  expect(await snapshot(other)).toEqual(await snapshot(page))
  expect((await snapshot(other)).workspace?.state.accounts).toHaveLength(3)
})

for (const [label, choice] of [['Mulai kosong', 'empty'], ['Gunakan template bawaan', 'template']] as const) {
  test(`failed ${choice} choice keeps the dialog open and its choice uncommitted`, async ({ page }) => {
    await openLocal(page); await expect(wizard(page)).toBeVisible()
    const before = await snapshot(page)
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put; let fail = true
      IDBObjectStore.prototype.put = function (...args) {
        if (fail) { fail = false; throw new DOMException('Onboarding quota failure', 'QuotaExceededError') }
        return put.apply(this, args)
      }
    })
    await wizard(page).getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByText('Onboarding quota failure', { exact: true })).toBeVisible()
    await expect(wizard(page)).toBeVisible()
    await expect(wizard(page).getByRole('button', { name: label, exact: true })).toBeEnabled()
    expect(await snapshot(page)).toEqual(before)
    await wizard(page).getByRole('button', { name: label, exact: true }).click()
    await expect(wizard(page)).toHaveCount(0)
    expect((await snapshot(page)).workspace?.onboarding).toBe(choice)
  })
}

test('existing local data skips onboarding and stays unchanged', async ({ page }) => {
  const seed = createSeed()
  await page.addInitScript(seed => { if (!localStorage.getItem('finance.v3')) localStorage.setItem('finance.v3', JSON.stringify(seed)) }, seed)
  await openLocal(page)
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  await expect(wizard(page)).toHaveCount(0)
  expect((await snapshot(page)).workspace?.state).toEqual(seed)
  expect((await snapshot(page)).workspace?.onboarding).toBe('existing')
})

for (const existing of [false, true]) {
  test(`cloud ${existing ? 'existing' : 'empty'} workspace waits for the initial read before deciding whether to prompt`, async ({ page, context }) => {
    const cloud = await mockCloud(context)
    if (existing) cloud.snapshots.set(userA, { revision: 1, state: dataOf(createSeed()) })
    let release!: () => void; let entered!: () => void
    const paused = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    await context.route('**/rest/v1/rpc/finance_read', async route => { entered(); await paused; await route.fallback() })
    await page.goto('/#/settings')
    await wizard(page).getByRole('button', { name: 'Mulai kosong', exact: true }).click()
    await expect(wizard(page)).toHaveCount(0)
    await login(page); await started
    await expect(wizard(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Gunakan template bawaan', exact: true })).toHaveCount(0)
    expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).hasLoadedCloud())).toBe(false)
    release()
    await expect.poll(() => page.evaluate(async () => (await import('/src/lib/store.ts')).hasLoadedCloud())).toBe(true)
    if (existing) {
      await expect(wizard(page)).toHaveCount(0)
      await expect(page.getByText('BCA', { exact: true })).toBeVisible()
      expect((await snapshot(page)).workspace?.onboarding).toBe('existing')
    } else {
      await expect(wizard(page)).toBeVisible()
      await wizard(page).getByRole('button', { name: 'Mulai kosong', exact: true }).click()
      await expect(wizard(page)).toHaveCount(0)
      expect((await snapshot(page)).workspace?.onboarding).toBe('empty')
    }
    expect(cloud.operations.size).toBe(0)
    expect(await page.evaluate(async () => (await (await import('/src/lib/repository.ts')).readWorkspace('guest')).onboarding)).toBe('empty')
  })
}

test('failed initial cloud read keeps setup blocked until retry succeeds', async ({ page, context }) => {
  await mockCloud(context)
  const failRead = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Initial read unavailable' }) })
  await context.route('**/rest/v1/rpc/finance_read', failRead)
  await page.goto('/#/settings')
  await wizard(page).getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
  await login(page)
  await expect(page.getByText('Initial read unavailable', { exact: true })).toBeVisible()
  await expect(wizard(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Gunakan template bawaan', exact: true })).toHaveCount(0)
  expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).hasLoadedCloud())).toBe(false)
  await context.unroute('**/rest/v1/rpc/finance_read', failRead)
  await page.evaluate(async () => { await (await import('/src/lib/sync.ts')).runSync() })
  await expect(wizard(page)).toBeVisible()
  await wizard(page).getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(wizard(page)).toHaveCount(0)
  expect((await snapshot(page)).workspace?.onboarding).toBe('empty')
})
