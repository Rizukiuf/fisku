import { test, expect, type Page } from '@playwright/test'
import { mockCloud, userA } from './fixtures/cloud'

const notice = (page: Page) => page.getByRole('region', { name: 'Pemberitahuan data', exact: true })
async function start(page: Page, guest = false) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: guest ? 'Gunakan template bawaan' : 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function login(page: Page, email = 'a@example.test') {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function dashboard(page: Page) {
  await page.evaluate(() => { window.location.hash = '/dashboard' })
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toHaveCount(0)
}
async function userAccount(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const account = await store.actions.addAccount({ name: 'Notice account', type: 'cash', initialBalance: 0 })
    await (await import('/src/lib/sync.ts')).runSync()
    return account.id
  })
}

test('guest notice is available outside Settings, opens Merge on request and disappears after durable import', async ({ page, context }) => {
  await mockCloud(context); await start(page, true); await login(page); await dashboard(page)
  await expect(notice(page)).toContainText('Ada data tamu di browser ini')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await notice(page).getByRole('button', { name: 'Tinjau data tamu', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Ganti (Replace)', exact: true })).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Batal', exact: true }).click()
  await expect(notice(page)).toBeVisible()
  await notice(page).getByRole('button', { name: 'Tinjau data tamu', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Impor data', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(notice(page)).toHaveCount(0)
  expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).getWorkspace()?.guestImport)).toMatch(/^[a-f0-9]{64}$/)
})

test('deferring guest does not import it, keeps Settings available, and a changed source reopens the notice', async ({ page, context }) => {
  await mockCloud(context); await start(page, true); await login(page); await dashboard(page)
  await notice(page).getByRole('button', { name: 'Nanti', exact: true }).click()
  await expect(notice(page)).toHaveCount(0)
  expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).getWorkspace()?.guestImport)).toBeUndefined()
  await page.evaluate(() => { window.location.hash = '/settings' })
  await expect(page.getByRole('button', { name: 'Impor data tamu ke akun ini', exact: true })).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  const tab = await context.newPage(); await tab.goto('/#/settings')
  await expect(tab.getByText('a@example.test', { exact: true })).toBeVisible()
  await tab.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); await store.switchWorkspace(null)
    await store.actions.addAccount({ name: 'Guest changed', type: 'bank', initialBalance: 1 })
  })
  await expect(notice(page)).toBeVisible()
})

test('guest deferral cannot hide the notice for another owner and guest mode has no account notice', async ({ page, context }) => {
  await mockCloud(context); await start(page, true); await login(page)
  await notice(page).getByRole('button', { name: 'Nanti', exact: true }).click()
  await page.getByRole('button', { name: 'Keluar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keluar', exact: true }).click()
  await expect(notice(page)).toHaveCount(0)
  await login(page, 'b@example.test')
  await expect(notice(page)).toBeVisible()
})

for (const choice of ['local', 'remote'] as const) {
  test(`conflict notice overrides guest, opens the conflict controls and disappears after choosing ${choice}`, async ({ page, context }) => {
    const cloud = await mockCloud(context); await start(page, true); await login(page)
    const id = await userAccount(page)
    const remote = structuredClone(cloud.snapshots.get(userA)!)
    remote.state.accounts.find((row: { id: string }) => row.id === id).initialBalance = 100
    remote.revision++; cloud.snapshots.set(userA, remote)
    await page.evaluate(async id => {
      const store = await import('/src/lib/store.ts')
      await store.actions.updateAccount(id, { initialBalance: 200 })
      try { await (await import('/src/lib/sync.ts')).runSync() } catch { /* Deliberate conflict. */ }
    }, id)
    await dashboard(page)
    await expect(notice(page)).toContainText('Perubahan lokal dan cloud perlu diperiksa')
    await expect(notice(page).getByRole('button', { name: 'Tinjau data tamu', exact: true })).toHaveCount(0)
    await notice(page).getByRole('button', { name: 'Periksa konflik', exact: true }).click()
    await expect(page.locator('#cloud-sync-section')).toBeFocused()
    const comparison = page.getByRole('region', { name: 'Perbandingan konflik', exact: true })
    await expect(comparison).toContainText('Notice account')
    await expect(comparison).toContainText('Saldo awal')
    await expect(comparison.getByRole('cell', { name: /200/ })).toHaveCount(1)
    await expect(comparison.getByRole('cell', { name: /100/ })).toHaveCount(1)
    await page.getByRole('button', { name: choice === 'local' ? 'Gunakan versi lokal' : 'Gunakan versi cloud', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(notice(page)).not.toContainText('Perubahan lokal dan cloud perlu diperiksa')
    await expect(notice(page)).toContainText('Ada data tamu di browser ini')
    await expect.poll(() => cloud.snapshots.get(userA)?.state.accounts.find((row: { id: string }) => row.id === id).initialBalance).toBe(choice === 'local' ? 200 : 100)
    await expect.poll(() => page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).getSyncStatus().status)).toBe('ok')
  })
}

test('a failed push exposes retry outside Settings and clears after a successful retry', async ({ page, context }) => {
  const cloud = await mockCloud(context); await start(page); await login(page); const id = await userAccount(page)
  await context.route('**/rest/v1/rpc/finance_push', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable' }) }))
  await page.evaluate(async id => {
    const store = await import('/src/lib/store.ts'); await store.actions.updateAccount(id, { initialBalance: 20 })
    try { await (await import('/src/lib/sync.ts')).runSync() } catch { /* Deliberate network error. */ }
  }, id)
  await dashboard(page)
  await expect(notice(page)).toContainText('Sinkronisasi belum berhasil')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const afterEdit = await page.evaluate(async id => {
    await (await import('/src/lib/store.ts')).actions.updateAccount(id, { initialBalance: 21 })
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    return { status: (await import('/src/lib/syncStatus.ts')).getSyncStatus().status, notice: document.querySelector('[aria-label="Pemberitahuan data"]')?.textContent }
  }, id)
  expect(afterEdit.status).toBe('idle')
  expect(afterEdit.notice).toContain('Sinkronisasi belum berhasil')
  await context.unroute('**/rest/v1/rpc/finance_push')
  await notice(page).getByRole('button', { name: 'Coba lagi', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/store.ts')).isDirty())).toBe(false)
  await expect(notice(page)).toHaveCount(0)
  expect(cloud.snapshots.get(userA)?.state.accounts.find((row: { id: string }) => row.id === id).initialBalance).toBe(21)
})

test('offline edits remain saved and notify until reconnect, without an automatic modal', async ({ page, context }) => {
  await mockCloud(context); await start(page); await login(page); const id = await userAccount(page)
  await context.setOffline(true)
  await page.evaluate(async id => (await import('/src/lib/store.ts')).actions.updateAccount(id, { initialBalance: 30 }), id)
  await dashboard(page)
  await expect(notice(page)).toContainText('Perubahan tersimpan di perangkat ini')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await context.setOffline(false)
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/store.ts')).isDirty())).toBe(false)
  await expect(notice(page)).toHaveCount(0)
})

test('an ordinary in-flight change uses the status indicator without an alert banner', async ({ page, context }) => {
  await mockCloud(context); await start(page); await login(page); const id = await userAccount(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  await context.route('**/rest/v1/rpc/finance_push', async route => { entered(); await gate; await route.fallback() })
  try {
    await page.evaluate(async id => {
      const store = await import('/src/lib/store.ts'); await store.actions.updateAccount(id, { initialBalance: 40 })
      void (await import('/src/lib/sync.ts')).runSync().catch(() => {})
    }, id)
    await reached
    await dashboard(page)
    expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).isDirty())).toBe(true)
    await expect(notice(page)).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally { release() }
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/store.ts')).isDirty())).toBe(false)
})
