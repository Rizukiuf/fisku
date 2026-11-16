import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { mockCloud, userA } from './fixtures/cloud'

async function setup(page: Page, context: BrowserContext) {
  const cloud = await mockCloud(context)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/syncStatus.ts')).getSyncStatus().status)).toBe('ok')
  await page.clock.install()
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    await store.actions.replaceAll(store.createSeed())
    await (await import('/src/lib/sync.ts')).runSync()
  })
  return cloud
}
const comparison = (page: Page) => page.getByRole('region', { name: 'Perbandingan konflik', exact: true })

test('transaction and budget differences use readable values, escape notes and fit mobile in both languages', async ({ page, context }, testInfo) => {
  const cloud = await setup(page, context)
  const ids = await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); const state = structuredClone(store.getState())
    const tx = store.uid(); const budget = store.uid(); const category = state.categories.find(row => row.type === 'expense')!.id
    state.transactions.push({ id: tx, accountId: state.accounts[0].id, categoryId: category, type: 'expense', amount: 100, date: '2026-11-17', note: 'Base note', deletedAt: null, updatedAt: store.now() })
    state.budgets.push({ id: budget, categoryId: category, limit: 100, deletedAt: null, updatedAt: store.now() })
    await store.actions.replaceAll(state); await (await import('/src/lib/sync.ts')).runSync()
    return { tx, budget, category }
  })
  const remote = structuredClone(cloud.snapshots.get(userA)!)
  Object.assign(remote.state.transactions[0], { type: 'transfer', amount: 300, date: '2026-11-19', targetAccountId: remote.state.accounts[1].id, categoryId: undefined, note: 'Cloud note' })
  remote.state.budgets[0].limit = 300; remote.revision++; cloud.snapshots.set(userA, remote)
  await page.evaluate(async ids => {
    const store = await import('/src/lib/store.ts')
    await store.actions.updateTransaction(ids.tx, { amount: 200, date: '2026-11-18', note: '<img src=x onerror=alert(1)>' + 'x'.repeat(300) })
    await store.actions.setBudget(ids.category, 200)
    await (await import('/src/lib/sync.ts')).runSync().catch(() => {})
  }, ids)
  await expect(comparison(page)).toContainText('Cloud note')
  await expect(comparison(page)).toContainText('<img src=x onerror=alert(1)>')
  await expect(comparison(page).locator('img')).toHaveCount(0)
  await expect(comparison(page)).toContainText('Akun Tujuan')
  await expect(comparison(page)).toContainText('BCA')
  await expect(comparison(page).getByRole('heading', { name: /Anggaran/ })).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await comparison(page).screenshot({ path: testInfo.outputPath('conflict-mobile.png') })
  await page.evaluate(async () => (await import('/src/lib/store.ts')).actions.updateSettings({ lang: 'en' }))
  const english = page.getByRole('region', { name: 'Conflict comparison', exact: true })
  await expect(english).toContainText('To Account')
  await expect(english).toContainText('Cloud version')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('a relational conflict shows the parent and missing child differences with a dataset explanation', async ({ page, context }) => {
  const cloud = await setup(page, context)
  const remote = structuredClone(cloud.snapshots.get(userA)!); remote.revision++
  remote.state.transactions.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', accountId: remote.state.accounts[0].id, categoryId: remote.state.categories[0].id, type: 'income', amount: 100, date: '2026-11-17', deletedAt: null, updatedAt: '2026-11-17T00:00:00Z' })
  cloud.snapshots.set(userA, remote)
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts'); await store.actions.deleteAccount(store.getState().accounts[0].id)
    await (await import('/src/lib/sync.ts')).runSync().catch(() => {})
  })
  await expect(comparison(page)).toContainText('Hubungan antar-data tidak dapat digabung')
  await expect(comparison(page)).toContainText('Di Sampah')
  await expect(comparison(page)).toContainText('Tidak tersedia')
  await expect(comparison(page).getByRole('heading', { name: /Transaksi/ })).toHaveCount(1)
})

test('purge conflicts show permanent deletion and keep technical IDs collapsed', async ({ page, context }) => {
  const cloud = await setup(page, context)
  const remote = structuredClone(cloud.snapshots.get(userA)!); remote.revision++
  const removed = remote.state.accounts.shift(); remote.state.purged.accounts.push(removed.id); cloud.snapshots.set(userA, remote)
  await page.evaluate(async id => {
    const store = await import('/src/lib/store.ts'); await store.actions.updateAccount(id, { initialBalance: 200 })
    await (await import('/src/lib/sync.ts')).runSync().catch(() => {})
  }, removed.id)
  await expect(comparison(page)).toContainText('Dimusnahkan')
  await expect(comparison(page).locator('details')).not.toHaveAttribute('open')
  await expect(comparison(page).locator('li').filter({ hasText: removed.id })).toBeHidden()
  await comparison(page).getByText('Detail teknis (ID)', { exact: true }).click()
  await expect(comparison(page).locator('li').filter({ hasText: removed.id })).toBeVisible()
})

test('comparison paginates many conflicts instead of rendering all tables at once', async ({ page, context }) => {
  const cloud = await setup(page, context)
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    for (let i = 0; i < 21; i++) await store.actions.addAccount({ name: `Conflict ${String(i).padStart(2, '0')}`, type: 'cash', initialBalance: 0 })
    await (await import('/src/lib/sync.ts')).runSync()
  })
  const remote = structuredClone(cloud.snapshots.get(userA)!); remote.revision++
  remote.state.accounts.filter((row: { name: string }) => row.name.startsWith('Conflict ')).forEach((row: { initialBalance: number }) => { row.initialBalance = 100 })
  cloud.snapshots.set(userA, remote)
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    for (const account of store.getState().accounts.filter(row => row.name.startsWith('Conflict '))) await store.actions.updateAccount(account.id, { initialBalance: 200 })
    await (await import('/src/lib/sync.ts')).runSync().catch(() => {})
  })
  await expect(comparison(page).getByRole('table')).toHaveCount(20)
  await comparison(page).getByRole('button', { name: 'Halaman berikutnya', exact: true }).click()
  await expect(comparison(page).getByRole('table')).toHaveCount(1)
  await expect(comparison(page)).toContainText('2 / 2')
})

test('a changed comparison cannot be applied from an already open confirmation', async ({ page, context }) => {
  const cloud = await setup(page, context)
  const remote = structuredClone(cloud.snapshots.get(userA)!); remote.revision++
  const id = remote.state.accounts[0].id; remote.state.accounts[0].initialBalance = 100; cloud.snapshots.set(userA, remote)
  await page.evaluate(async id => {
    const store = await import('/src/lib/store.ts'); await store.actions.updateAccount(id, { initialBalance: 200 })
    await (await import('/src/lib/sync.ts')).runSync().catch(() => {})
  }, id)
  await page.getByRole('button', { name: 'Gunakan versi cloud', exact: true }).click()
  await page.evaluate(async id => (await import('/src/lib/store.ts')).actions.updateAccount(id, { initialBalance: 300 }), id)
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('Data konflik berubah. Periksa perbandingan terbaru sebelum memilih kembali.', { exact: true })).toBeVisible()
  expect(await page.evaluate(async id => (await import('/src/lib/store.ts')).getState().accounts.find(row => row.id === id)?.initialBalance, id)).toBe(300)
  await expect(comparison(page)).toBeVisible()
  await page.getByRole('button', { name: 'Gunakan versi cloud', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(comparison(page)).toHaveCount(0)
  await expect.poll(() => cloud.snapshots.get(userA)?.state.accounts.find((row: { id: string }) => row.id === id).initialBalance).toBe(100)
})

test('a later edit can add another conflicting row to the comparison before the decision', async ({ page, context }) => {
  const cloud = await setup(page, context)
  const remote = structuredClone(cloud.snapshots.get(userA)!); remote.revision++
  const [first, second] = remote.state.accounts
  first.initialBalance = 100; second.initialBalance = 100; cloud.snapshots.set(userA, remote)
  await page.evaluate(async id => {
    const store = await import('/src/lib/store.ts'); await store.actions.updateAccount(id, { initialBalance: 200 })
    await (await import('/src/lib/sync.ts')).runSync().catch(() => {})
  }, first.id)
  await expect(comparison(page).getByRole('heading', { name: /BCA/ })).toHaveCount(0)
  await page.evaluate(async id => (await import('/src/lib/store.ts')).actions.updateAccount(id, { initialBalance: 200 }), second.id)
  await expect(comparison(page).getByRole('heading', { name: /BCA/ })).toHaveCount(1)
  await expect(comparison(page)).toContainText('2 bagian perlu diperiksa')
  await page.getByRole('button', { name: 'Gunakan versi cloud', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(comparison(page)).toHaveCount(0)
  expect(await page.evaluate(async ids => (await import('/src/lib/store.ts')).getState().accounts.filter(row => ids.includes(row.id)).map(row => row.initialBalance), [first.id, second.id])).toEqual([100, 100])
})

test('a row conflict that requires dataset fallback also displays its cloud-only child before applying the choice', async ({ page, context }) => {
  const cloud = await setup(page, context)
  const remote = structuredClone(cloud.snapshots.get(userA)!); remote.revision++
  const id = remote.state.accounts[0].id; remote.state.accounts[0].initialBalance = 100
  const child = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  remote.state.transactions.push({ id: child, accountId: id, categoryId: remote.state.categories[0].id, type: 'income', amount: 75, date: '2026-11-17', note: 'Cloud child affected by choice', deletedAt: null, updatedAt: '2026-11-17T00:00:00Z' })
  cloud.snapshots.set(userA, remote)
  await page.evaluate(async id => {
    const store = await import('/src/lib/store.ts'); await store.actions.deleteAccount(id)
    await (await import('/src/lib/sync.ts')).runSync().catch(() => {})
  }, id)
  await expect(comparison(page)).toContainText('Hubungan antar-data tidak dapat digabung')
  await expect(comparison(page)).toContainText('Cloud child affected by choice')
  await expect(comparison(page).getByRole('heading', { name: /Transaksi/ })).toHaveCount(1)
  await page.getByRole('button', { name: 'Gunakan versi lokal', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(comparison(page)).toHaveCount(0)
  const result = await page.evaluate(async () => (await import('/src/lib/store.ts')).getState())
  expect(result.transactions).toHaveLength(0)
  expect(result.purged.transactions).toContain(child)
})
