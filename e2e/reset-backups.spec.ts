import { test, expect, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  await page.goto('http://127.0.0.1:5176/#/settings')
  await expect(page.locator('h1').filter({ hasText: 'Pengaturan' })).toBeVisible()
  if (await page.evaluate(async () => (await import('/src/lib/store.ts')).getWorkspace()?.onboarding === 'pending')) {
    await page.getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  }
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const repo = await import('/src/lib/repository.ts')
    return { workspace: await repo.readWorkspace(store.getScope()), backups: await repo.listBackups(store.getScope()) }
  })
}
async function reset(page: Page) {
  const advanced = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Alat lanjutan' }) })
  if (!await advanced.evaluate(element => (element as HTMLDetailsElement).open)) await advanced.locator('summary').click()
  await page.getByRole('button', { name: 'Reset semua data', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Reset semua data', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
async function makeBackups(page: Page, count: number) {
  await page.evaluate(async count => {
    const store = await import('/src/lib/store.ts')
    const account = await store.actions.addAccount({ name: 'Backup fixture', type: 'cash', initialBalance: 1 })
    for (let amount = 1; amount <= count; amount++) {
      await store.commitWorkspace(store.getScope(), store.getGeneration(), (workspace, backup) => {
        backup('before-change')
        workspace.state.accounts.find(row => row.id === account.id)!.initialBalance = amount + 1
      })
    }
  }, count)
}
function backupsSection(page: Page) {
  return page.locator('details').filter({ has: page.getByText('Cadangan otomatis', { exact: true }) })
}
async function openBackups(page: Page) {
  const section = backupsSection(page)
  await section.locator('summary').click()
  return section
}

test('fresh reset stays unchanged across repeated confirmations and reload', async ({ page }) => {
  await openSettings(page)
  const before = await snapshot(page)
  for (let i = 0; i < 3; i++) {
    await reset(page)
    await expect(page.getByText('Data aktif sudah kosong', { exact: true }).last()).toBeVisible()
    expect(await snapshot(page)).toEqual(before)
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(before)
  await expect(backupsSection(page)).toHaveCount(0)
})

test('reset clears presets, preserves old trash, backs up once, and stays empty after reload', async ({ page }) => {
  await openSettings(page)
  await page.getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const old = await store.actions.addCategory({ name: 'Old trash', type: 'expense' })
    await store.actions.deleteCategory(old.id)
    await store.actions.addAccount({ name: 'Extra account', type: 'cash', initialBalance: 123 })
    await store.actions.updateAccount(store.getState().accounts[0].id, { initialBalance: 456 })
  })
  const before = await snapshot(page)
  await reset(page)
  await expect(page.getByText('Data aktif dikosongkan', { exact: true })).toBeVisible()
  const after = await snapshot(page)
  expect(after.backups).toHaveLength(1)
  expect(after.backups[0].state).toEqual(before.workspace.state)
  expect(after.workspace.state.accounts.filter(row => !row.deletedAt)).toHaveLength(0)
  expect(after.workspace.state.categories.filter(row => !row.deletedAt)).toHaveLength(0)
  expect(after.workspace.state.accounts.map(row => row.id)).toEqual(before.workspace.state.accounts.map(row => row.id))
  expect(after.workspace.state.accounts.filter(row => row.deletedAt)).toHaveLength(4)
  expect(after.workspace.state.categories.find(row => row.name === 'Old trash')).toEqual(before.workspace.state.categories.find(row => row.name === 'Old trash'))
  await reset(page)
  await expect(page.getByText('Data aktif sudah kosong', { exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(after)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(after)
})

test('backup retention is bounded, download works, and deletion supports cancel, one, and all across tabs', async ({ page, context }) => {
  await openSettings(page); await makeBackups(page, 8)
  const before = await snapshot(page)
  expect(before.backups).toHaveLength(5)
  const other = await context.newPage(); await openSettings(other)
  const section = await openBackups(page)
  const otherSection = await openBackups(other)
  await expect(section.locator('li')).toHaveCount(5)
  const downloadEvent = page.waitForEvent('download')
  await section.getByRole('button', { name: 'Ekspor data', exact: true }).first().click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^fisku-recovery-.*\.json$/)
  await section.getByRole('button', { name: 'Hapus cadangan', exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Batal', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await section.getByRole('button', { name: 'Hapus cadangan', exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Hapus cadangan', exact: true }).click()
  await expect(section.locator('li')).toHaveCount(4)
  await expect(otherSection.locator('li')).toHaveCount(4)
  await section.getByRole('button', { name: 'Hapus semua cadangan', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Hapus semua cadangan', exact: true }).click()
  await expect(section).toHaveCount(0)
  await expect(otherSection).toHaveCount(0)
  const after = await snapshot(page)
  expect(after.workspace.state).toEqual(before.workspace.state)
  expect(after.workspace.base).toEqual(before.workspace.base)
  expect(after.workspace.pending).toEqual(before.workspace.pending)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  expect((await snapshot(page)).backups).toHaveLength(0)
})

test('unresolved conflict copies stay protected when ordinary backups are deleted', async ({ page }) => {
  await openSettings(page); await makeBackups(page, 1)
  await page.evaluate(async () => {
    const store = await import('/src/lib/store.ts')
    const model = await import('/src/lib/model.ts')
    await store.commitWorkspace(store.getScope(), store.getGeneration(), (workspace, backup) => {
      backup('sync-conflict-local')
      const remote = model.createSeed(); remote.accounts[0].initialBalance = 999
      backup('sync-conflict-cloud', remote)
      workspace.conflict = { remote: model.dataOf(remote), revision: 1, ids: ['accounts/conflict'] }
    })
  })
  const section = await openBackups(page)
  const before = await snapshot(page)
  expect(before.backups.filter(row => row.protected)).toHaveLength(2)
  await expect(section.locator('li button:disabled')).toHaveCount(2)
  await section.getByRole('button', { name: 'Hapus semua cadangan', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Hapus semua cadangan', exact: true }).click()
  await expect(section.locator('li')).toHaveCount(2)
  await expect(section.getByRole('button', { name: 'Hapus semua cadangan', exact: true })).toBeDisabled()
  expect((await snapshot(page)).workspace.state).toEqual(before.workspace.state)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  expect((await snapshot(page)).backups.filter(row => row.protected).map(row => row.id)).toEqual(before.backups.filter(row => row.protected).map(row => row.id))
})
