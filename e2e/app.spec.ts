import { test, expect, type Page } from '@playwright/test'
import { mockCloud, session, userA, userB } from './fixtures/cloud'

async function openSettings(page: Page) {
  await page.goto('/#/settings')
  await expect(page.locator('h1').filter({ hasText: 'Pengaturan' })).toBeVisible()
  const template = page.getByRole('button', { name: 'Gunakan template bawaan', exact: true })
  if (await page.evaluate(async () => (await import('/src/lib/store.ts')).getWorkspace()?.onboarding === 'pending') || await template.isVisible()) await template.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('BCA', { exact: true })).toBeVisible()
}
async function login(page: Page, email = 'a@example.test', waitForSetup = true) {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  if (!waitForSetup) return
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/store.ts')).hasLoadedCloud())).toBe(true)
  const template = page.getByRole('button', { name: 'Gunakan template bawaan', exact: true })
  if (await page.evaluate(async () => (await import('/src/lib/store.ts')).getWorkspace()?.onboarding === 'pending') || await template.isVisible()) await template.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('BCA', { exact: true })).toBeVisible()
}
async function addAccount(page: Page, name: string) {
  await page.getByRole('button', { name: 'Tambah akun', exact: true }).click()
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Tambah akun', exact: true }) })
  await form.locator('input').first().fill(name)
  await form.locator('input[inputmode="numeric"]').fill('500')
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

test('local CRUD persists after reload and broadcasts changes to another tab', async ({ page, context }) => {
  await mockCloud(context); await openSettings(page)
  const second = await context.newPage(); await openSettings(second)
  await addAccount(page, 'Cash regression')
  await expect(second.getByText('Cash regression', { exact: true })).toBeVisible()
  await second.reload()
  await expect(second.getByText('Cash regression', { exact: true })).toBeVisible()
  // A real browser transaction is used for import validation, not an in-memory mock.
  const unchanged = await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const before = store.actions.exportJSON()
    try { await store.actions.importJSON('{}') } catch { /* Expected invalid backup. */ }
    return JSON.parse(before).data.accounts.length === store.getState().accounts.length
  })
  expect(unchanged).toBe(true)
})

test('failed durable writes keep the form open and do not show a success toast', async ({ page, context }) => {
  await mockCloud(context); await openSettings(page)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    let fail = true
    IDBObjectStore.prototype.put = function (...args) {
      if (fail) { fail = false; throw new DOMException('Quota test failure', 'QuotaExceededError') }
      return put.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Tambah akun', exact: true }).click()
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Tambah akun', exact: true }) })
  await form.locator('input').first().fill('Must not disappear')
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('Quota test failure', { exact: true })).toBeVisible()
  await expect(form).toBeVisible()
  await expect(page.getByText('Perubahan disimpan', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Must not disappear', { exact: true })).toHaveCount(0)
})

test('guest, email/password user A, and user B keep separate durable datasets', async ({ page, context }) => {
  const cloud = await mockCloud(context); await openSettings(page)
  await addAccount(page, 'Guest private')
  await login(page)
  await expect(page.getByText('Guest private', { exact: true })).toHaveCount(0)
  await addAccount(page, 'A private')
  await page.getByRole('button', { name: 'Keluar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keluar', exact: true }).click()
  await expect(page.getByText('Guest private', { exact: true })).toBeVisible()
  await login(page, 'b@example.test')
  await expect(page.getByText('A private', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Guest private', { exact: true })).toHaveCount(0)
  await expect.poll(() => cloud.snapshots.get(userB)?.state.accounts.length).toBe(3)
  expect(cloud.snapshots.get(userB)?.state.accounts.some((row: { name: string }) => row.name === 'A private')).toBe(false)
})

test('password failures, signup confirmation, and reset requests are handled', async ({ page, context }) => {
  const cloud = await mockCloud(context); await openSettings(page)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByText('Email atau kata sandi salah.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Daftar', exact: true }).click()
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('new-password-123')
  await page.getByRole('textbox', { name: 'Konfirmasi kata sandi', exact: true }).fill('new-password-123')
  await page.getByRole('button', { name: 'Daftar', exact: true }).click()
  await expect(page.getByText('Permintaan pendaftaran diproses. Jika email ini dapat didaftarkan, periksa email konfirmasi. Jika sudah terdaftar, silakan masuk atau gunakan Lupa kata sandi.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Lupa kata sandi', exact: true }).click()
  await page.getByRole('button', { name: 'Kirim tautan pemulihan', exact: true }).click()
  await expect(page.getByText('Jika alamat terdaftar, tautan pemulihan akan dikirim. Periksa email Anda.', { exact: true })).toBeVisible()
  expect(cloud.calls.some(call => call.endsWith('/recover'))).toBe(true)
})

test('recovery callback survives hash navigation and refresh before changing password', async ({ page, context }) => {
  const cloud = await mockCloud(context)
  const recovery = session(userA, 'a@example.test')
  await page.goto(`/?auth=recovery#access_token=${recovery.access_token}&refresh_token=${recovery.refresh_token}&token_type=bearer&expires_in=3600&type=recovery`)
  await expect(page.getByRole('button', { name: 'Simpan kata sandi baru', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Simpan kata sandi baru', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('recovered-password-123')
  await page.getByRole('textbox', { name: 'Konfirmasi kata sandi', exact: true }).fill('recovered-password-123')
  await page.getByRole('button', { name: 'Simpan kata sandi baru', exact: true }).click()
  await expect(page.getByText('Kata sandi berhasil diperbarui.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Simpan kata sandi baru', exact: true })).toHaveCount(0)
  expect(cloud.calls.some(call => call === 'PUT /auth/v1/user')).toBe(true)
})

test('corrupt legacy data is preserved and startup offers recovery export', async ({ page, context }) => {
  await mockCloud(context)
  await page.addInitScript(() => localStorage.setItem('finance.v3', '{broken'))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('The original source is preserved')
  await expect(page.getByRole('button', { name: 'Export recovery data', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('finance.v3'))).toBe('{broken')
})

test('an editor opened before another tab changed the record cannot overwrite that change', async ({ page, context }) => {
  await mockCloud(context); await openSettings(page)
  const accountRow = page.locator('li').filter({ has: page.getByText('Tunai', { exact: true }) })
  await accountRow.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Edit akun', exact: true }) })
  await editor.locator('input').first().fill('Stale draft')
  const other = await context.newPage(); await openSettings(other)
  await other.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    await store.actions.updateAccount(store.getState().accounts.find(row => row.name === 'Tunai')!.id, { initialBalance: 800 })
  })
  await expect(accountRow).toContainText('800')
  await editor.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('Data berubah di tab lain. Periksa versi terbaru sebelum menyimpan kembali.', { exact: true })).toBeVisible()
  await expect(editor).toBeVisible()
  await page.reload()
  await expect(page.getByText('Stale draft', { exact: true })).toHaveCount(0)
})

test('editing transfer to income through the original UI keeps the old destination unchanged', async ({ page, context }) => {
  await mockCloud(context); await openSettings(page)
  await page.locator('aside').getByRole('button', { name: 'Tambah', exact: true }).click()
  let form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Tambah transaksi', exact: true }) })
  await form.getByRole('button', { name: 'Transfer', exact: true }).click()
  await form.locator('input[inputmode="numeric"]').fill('900')
  await form.locator('select').nth(0).selectOption('11111111-1111-4111-8111-111111111111')
  await form.locator('select').nth(1).selectOption('22222222-2222-4222-8222-222222222222')
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(form).toHaveCount(0)
  await page.goto('/#/transactions')
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Edit transaksi', exact: true }) })
  await form.getByRole('button', { name: 'Pemasukan', exact: true }).click()
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(form).toHaveCount(0)
  const balances = await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); const state = store.getState()
    return state.accounts.slice(0, 2).map(account => store.accountBalance(account, state.transactions))
  })
  expect(balances).toEqual([900, 0])
})

test('local use requires no Supabase configuration and works offline while the app is open', async ({ page, context }) => {
  let cloudRequests = 0
  await context.route('http://127.0.0.1:54321/**', route => { cloudRequests++; return route.abort() })
  await page.goto('http://127.0.0.1:5176/#/settings')
  await page.getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByText('Sinkronisasi cloud belum tersedia. Pencatatan lokal tetap dapat digunakan.', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await addAccount(page, 'Offline local')
  await context.setOffline(false)
  await page.reload()
  await expect(page.getByText('Offline local', { exact: true })).toBeVisible()
  expect(cloudRequests).toBe(0)
})

test('a delayed user A sync result cannot enter user B after switching accounts', async ({ page, context }) => {
  const cloud = await mockCloud(context)
  let release!: () => void; let entered!: () => void
  const paused = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  let held = false
  await context.route('**/rest/v1/rpc/finance_read', async route => {
    const token = route.request().headers().authorization?.split('.')[1]
    const id = token ? JSON.parse(Buffer.from(token, 'base64url').toString()).sub : null
    if (id === userA && !held) { held = true; entered(); await paused }
    await route.fallback()
  })
  await openSettings(page); await login(page, 'a@example.test', false); await started
  await addAccount(page, 'A delayed private')
  await page.getByRole('button', { name: 'Keluar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keluar', exact: true }).click()
  await login(page, 'b@example.test')
  // The previous user's paused request must not block this user's sync either.
  await expect.poll(() => cloud.snapshots.get(userB)?.state.accounts.length).toBe(3)
  release()
  await expect(page.getByText('A delayed private', { exact: true })).toHaveCount(0)
  expect(cloud.snapshots.get(userB)?.state.accounts.some((row: { name: string }) => row.name === 'A delayed private')).toBe(false)
})

test('two devices preserve a conflict and explicitly resolve it while retaining independent edits', async ({ page, context, browser }) => {
  const cloud = await mockCloud(context)
  const secondContext = await browser.newContext()
  try {
    await mockCloud(secondContext, cloud)
    const other = await secondContext.newPage()
    await openSettings(page); await login(page)
    await expect(page.getByRole('button', { name: 'Berhasil', exact: true })).toBeVisible()
    await openSettings(other); await login(other)
    await expect(other.getByRole('button', { name: 'Berhasil', exact: true })).toBeVisible()
    await secondContext.setOffline(true)
    await other.evaluate(async () => {
      const store = await import('/src/lib/store.ts')
      await store.actions.updateAccount('11111111-1111-4111-8111-111111111111', { initialBalance: 200 })
      await store.actions.updateAccount('22222222-2222-4222-8222-222222222222', { name: 'Independent local edit' })
    })
    await page.evaluate(async () => {
      const store = await import('/src/lib/store.ts')
      await store.actions.updateAccount('11111111-1111-4111-8111-111111111111', { initialBalance: 100 })
      await (await import('/src/lib/sync.ts')).runSync()
    })
    await secondContext.setOffline(false)
    await expect(other.getByRole('button', { name: 'Gunakan versi cloud', exact: true })).toBeVisible()
    await expect(other.getByText('200', { exact: false }).first()).toBeVisible()
    await other.evaluate(() => { window.location.hash = '/transactions' })
    await expect(other.getByRole('heading', { name: 'Pengaturan', exact: true })).toHaveCount(0)
    const notice = other.getByRole('region', { name: 'Pemberitahuan data', exact: true })
    await expect(notice).toContainText('Perubahan lokal dan cloud perlu diperiksa')
    await notice.getByRole('button', { name: 'Periksa konflik', exact: true }).click()
    await expect(other.locator('#cloud-sync-section')).toBeFocused()
    await other.getByRole('button', { name: 'Gunakan versi cloud', exact: true }).click()
    await other.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(other.getByRole('button', { name: 'Gunakan versi cloud', exact: true })).toHaveCount(0)
    await expect(other.getByRole('button', { name: 'Berhasil', exact: true })).toBeVisible()
    expect(cloud.snapshots.get(userA)?.state.accounts.find((row: { id: string }) => row.id === '11111111-1111-4111-8111-111111111111').initialBalance).toBe(100)
    expect(cloud.snapshots.get(userA)?.state.accounts.some((row: { name: string }) => row.name === 'Independent local edit')).toBe(true)
    await expect(other.getByText('Cadangan otomatis', { exact: true })).toBeVisible()
  } finally { await secondContext.close() }
})

test('expired auth callback reports its error without blocking local data entry', async ({ page, context }) => {
  await mockCloud(context)
  await page.goto('/?auth=recovery#error=access_denied&error_description=Link%20expired&error_code=otp_expired')
  await page.getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Link expired')
  await addAccount(page, 'After expired link')
})
