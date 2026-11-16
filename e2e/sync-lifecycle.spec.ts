import { test, expect, type Page } from '@playwright/test'
import { mockCloud, userA } from './fixtures/cloud'

async function start(page: Page) {
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).getSyncStatus().status)).toBe('ok')
}

for (const mode of ['session', 'rpc-auth'] as const) {
  test(`a stalled ${mode} wait stops spinning, rejects late continuation and can retry without clearing data`, async ({ page, context }) => {
    const cloud = await mockCloud(context); await start(page); await page.clock.install()
    const before = cloud.calls.length
    await page.evaluate(async mode => {
      const { supabase } = await import('/src/lib/supabase.ts'); const auth = supabase!.auth
      const original = auth.getSession.bind(auth)
      let release!: (value: unknown) => void
      const held = new Promise(resolve => { release = resolve }); let calls = 0
      auth.getSession = (() => ++calls === 1 && mode === 'rpc-auth' ? original() : held) as typeof auth.getSession
      ;(window as any).restoreSession = async () => { auth.getSession = original; release(await original()) }
      await (await import('/src/lib/store.ts')).actions.addAccount({ name: 'Pending account', type: 'cash', initialBalance: 10 })
      ;(window as any).syncAttempt = (await import('/src/lib/sync.ts')).runSync().catch(error => error.message)
      ;(window as any).sessionWaitCount = () => calls
    }, mode)
    await expect.poll(() => page.evaluate(() => (window as any).sessionWaitCount())).toBeGreaterThanOrEqual(mode === 'rpc-auth' ? 2 : 1)
    const progress = page.getByRole('status').filter({ hasText: /^Tahap:/ })
    await expect(progress).toContainText(mode === 'session' ? 'memeriksa sesi' : 'membaca data cloud')
    await page.clock.fastForward(1000)
    await expect(progress).toHaveText(/· [1-9]\d* dtk$/)
    await page.clock.fastForward(14001)
    await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toContainText('Sinkronisasi belum berhasil')
    const result = await page.evaluate(() => (window as any).syncAttempt)
    expect(result).toContain(mode === 'session' ? 'memeriksa sesi' : 'membaca data cloud')
    expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).getState().accounts.some(row => row.name === 'Pending account'))).toBe(true)
    const reached = cloud.calls.length
    await page.evaluate(() => (window as any).restoreSession())
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    expect(cloud.calls.length).toBe(reached)
    if (mode === 'session') expect(reached).toBe(before)
    await page.getByRole('region', { name: 'Pemberitahuan data', exact: true }).getByRole('button', { name: 'Coba lagi', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await import('/src/lib/store.ts')).isDirty())).toBe(false)
    await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toHaveCount(0)
  })
}

for (const status of ['error', 'syncing'] as const) {
  test(`a same-owner auth refresh cannot overwrite the active ${status} sync status`, async ({ page, context }) => {
    await mockCloud(context); await start(page)
    const result = await page.evaluate(async status => {
      const sync = await import('/src/lib/syncStatus.ts')
      sync.setSyncStatus({ status, error: status === 'error' ? 'Synthetic timeout' : null })
      const { supabase } = await import('/src/lib/supabase.ts')
      await supabase!.auth.refreshSession()
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      return sync.getSyncStatus()
    }, status)
    expect(result.status).toBe(status)
    expect(result.error).toBe(status === 'error' ? 'Synthetic timeout' : null)
  })
}

test('a timeout stays stopped across focus, interval and local edits until manual retry', async ({ page, context }) => {
  await mockCloud(context); await start(page); await page.clock.install()
  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts'); const auth = supabase!.auth
    const original = auth.getSession.bind(auth)
    let calls = 0; let release!: (value: unknown) => void
    const held = new Promise(resolve => { release = resolve })
    auth.getSession = (() => { calls++; return held }) as typeof auth.getSession
    ;(window as any).sessionWaitCount = () => calls
    ;(window as any).restoreSession = async () => { auth.getSession = original; release(await original()) }
    await (await import('/src/lib/store.ts')).actions.addAccount({ name: 'Stop retry test', type: 'cash', initialBalance: 10 })
    ;(window as any).syncAttempt = (await import('/src/lib/sync.ts')).runSync().catch(error => error.message)
  })
  await expect.poll(() => page.evaluate(() => (window as any).sessionWaitCount())).toBe(1)
  await page.clock.fastForward(15001)
  await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toContainText('Sinkronisasi belum berhasil')
  await page.clock.fastForward(120000)
  await context.setOffline(true)
  await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toContainText('otomatis dijeda')
  await context.setOffline(false)
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('focus'))
    const store = await import('/src/lib/store.ts')
    await store.actions.updateAccount(store.getState().accounts[0].id, { initialBalance: 20 })
  })
  await page.clock.fastForward(10000)
  expect(await page.evaluate(() => (window as any).sessionWaitCount())).toBe(1)
  await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toContainText('otomatis dijeda')
  const settings = page.getByRole('region', { name: 'Cloud Sync', exact: true })
  await expect(settings).toContainText('Sinkronisasi otomatis dijeda setelah timeout')
  await expect(settings).not.toContainText('Sync otomatis berjalan 2 detik')
  await page.evaluate(() => (window as any).restoreSession())
  await page.getByRole('region', { name: 'Pemberitahuan data', exact: true }).getByRole('button', { name: 'Coba lagi', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/store.ts')).isDirty())).toBe(false)
  await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toHaveCount(0)
  expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).getState().accounts[0].initialBalance)).toBe(20)
})

test('a timeout pause is cleared on owner switch and cannot disable the next user sync', async ({ page, context }) => {
  await mockCloud(context); await start(page)
  await page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).setSyncStatus({ status: 'error', error: 'Synthetic timeout', autoRetryBlocked: true }))
  await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toContainText('otomatis dijeda')
  await page.getByRole('button', { name: 'Keluar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keluar', exact: true }).click()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('b@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).getSyncStatus().status)).toBe('ok')
  expect(await page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).getSyncStatus().autoRetryBlocked)).toBe(false)
  await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toHaveCount(0)
})

for (const conflicting of [false, true]) {
  test(`a PT409 RPC rejection rereads cloud and ${conflicting ? 'preserves a same-account conflict' : 'merges independent edits without replaying the rejected request'}`, async ({ page, context }) => {
    const cloud = await mockCloud(context); await start(page); await page.clock.install()
    await page.evaluate(async () => {
      const store = await import('/src/lib/store.ts')
      await store.actions.addAccount({ name: 'Alpha', type: 'cash', initialBalance: 0 })
      await store.actions.addAccount({ name: 'Beta', type: 'bank', initialBalance: 0 })
      await (await import('/src/lib/sync.ts')).runSync()
    })
    const events: string[] = []; const operations: string[] = []; let rejectOnce = true
    await page.route('**/rest/v1/rpc/finance_read', async route => { events.push('read'); await route.fallback() })
    await page.route('**/rest/v1/rpc/finance_push', async route => {
      const request = route.request().postDataJSON()
      events.push('push'); operations.push(request.p_operation_id)
      if (!rejectOnce) { await route.fallback(); return }
      rejectOnce = false
      const remote = structuredClone(cloud.snapshots.get(userA)!)
      remote.revision++
      remote.state.accounts.find((row: { name: string }) => row.name === (conflicting ? 'Alpha' : 'Beta')).initialBalance = 200
      cloud.snapshots.set(userA, remote)
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PT409', message: 'Cloud changed; reconcile first', details: null, hint: null }) })
    })
    const result = await page.evaluate(async () => {
      const store = await import('/src/lib/store.ts')
      await store.actions.updateAccount(store.getState().accounts.find(row => row.name === 'Alpha')!.id, { initialBalance: 100 })
      try { await (await import('/src/lib/sync.ts')).runSync(); return 'ok' }
      catch (error) { return (error as Error).name }
    })
    if (conflicting) {
      expect(result).toBe('DataConflict')
      expect(events).toEqual(['read', 'push', 'read'])
      await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toContainText('konflik')
      const workspace = await page.evaluate(async () => (await import('/src/lib/store.ts')).getWorkspace())
      expect(workspace?.state.accounts.find(row => row.name === 'Alpha')?.initialBalance).toBe(100)
      expect(workspace?.conflict?.remote.accounts.find(row => row.name === 'Alpha')?.initialBalance).toBe(200)
      expect(workspace?.pending).toBeNull()
    } else {
      expect(result).toBe('ok')
      expect(events).toEqual(['read', 'push', 'read', 'push', 'read'])
      expect(operations[0]).not.toBe(operations[1])
      expect(cloud.snapshots.get(userA)!.state.accounts.find((row: { name: string }) => row.name === 'Alpha').initialBalance).toBe(100)
      expect(cloud.snapshots.get(userA)!.state.accounts.find((row: { name: string }) => row.name === 'Beta').initialBalance).toBe(200)
      expect(await page.evaluate(async () => (await import('/src/lib/store.ts')).isDirty())).toBe(false)
      await expect(page.getByRole('region', { name: 'Pemberitahuan data', exact: true })).toHaveCount(0)
    }
    await page.clock.fastForward(120000)
    expect(operations).toHaveLength(conflicting ? 1 : 2)
  })
}
