import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { mockCloud } from './fixtures/cloud'

for (const scenario of [
  { timezone: 'Asia/Jakarta', instant: '2026-11-16T18:30:00.000Z', localDate: '2026-11-17' },
  { timezone: 'America/Los_Angeles', instant: '2026-11-17T01:30:00.000Z', localDate: '2026-11-16' },
]) {
  test(`export filename uses Fisku and the current local date in ${scenario.timezone}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: scenario.timezone })
    try {
      await mockCloud(context)
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date(scenario.instant))
      await page.goto('/#/settings')
      await page.getByRole('dialog').getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const downloadEvent = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Ekspor data', exact: true }).click()
      const download = await downloadEvent
      expect(download.suggestedFilename()).toBe(`fisku-backup-${scenario.localDate}.json`)
      const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
      expect(exported.format).toBe('fisku-backup')
      expect(exported.exportedAt).toBe(scenario.instant)
      expect(exported.data.accounts).toHaveLength(3)
      await page.getByRole('button', { name: 'Tambah', exact: true }).first().click()
      await expect(page.locator('input[type="date"]')).toHaveValue(scenario.localDate)
    } finally { await context.close() }
  })
}
