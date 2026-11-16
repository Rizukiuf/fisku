import { test, expect, type Locator, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  await page.goto('http://127.0.0.1:5176/#/settings')
  await page.getByRole('button', { name: 'Gunakan template bawaan', exact: true }).click()
}
async function transactionAmount(page: Page) {
  await openSettings(page)
  await page.locator('aside').getByRole('button', { name: 'Tambah', exact: true }).click()
  return page.locator('form').filter({ has: page.getByRole('heading', { name: 'Tambah transaksi', exact: true }) })
}
async function typeTenMillion(input: Locator) {
  for (const [digit, expected] of [['1', '1'], ['0', '10'], ['0', '100'], ['0', '1.000'], ['0', '10.000'], ['0', '100.000'], ['0', '1.000.000'], ['0', '10.000.000']]) {
    await input.pressSequentially(digit)
    await expect(input).toHaveValue(expected)
  }
}
test('transaction amount regroups each keystroke and saves the exact integer after reload', async ({ page }) => {
  const form = await transactionAmount(page)
  await typeTenMillion(form.locator('input[inputmode="numeric"]'))
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(form).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pengaturan', exact: true })).toBeVisible()
  const amounts = await page.evaluate(async () => (await import('/src/lib/store.ts')).getState().transactions.map(tx => tx.amount))
  expect(amounts).toEqual([10000000])
})
test('deleting digits regroups immediately and middle edits preserve the caret', async ({ page }) => {
  const form = await transactionAmount(page)
  const input = form.locator('input[inputmode="numeric"]')
  await input.fill('10000000')
  for (const expected of ['1.000.000', '100.000', '10.000', '1.000', '100', '10', '1', '']) {
    await input.press('Backspace')
    await expect(input).toHaveValue(expected)
  }
  await input.fill('123456')
  await input.press('Home'); await input.press('ArrowRight'); await input.pressSequentially('9')
  await expect(input).toHaveValue('1.923.456')
  await expect.poll(() => input.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(3)
  await input.pressSequentially('8')
  await expect(input).toHaveValue('19.823.456')
})
test('opening balance uses the same live grouping and retains the negative sign', async ({ page }) => {
  await openSettings(page)
  await page.getByRole('button', { name: 'Tambah akun', exact: true }).click()
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Tambah akun', exact: true }) })
  const input = form.locator('input[inputmode="numeric"]')
  await typeTenMillion(input)
  await input.fill(''); await input.pressSequentially('-10000')
  await expect(input).toHaveValue('-10.000')
})

test('formatting cannot overwrite a newer select-all before the next animation frame', async ({ page }) => {
  const form = await transactionAmount(page)
  const input = form.locator('input[inputmode="numeric"]')
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  await input.fill('1000')
  await expect(input).toHaveValue('1.000')
  await input.selectText()
  await page.clock.runFor(20)
  await input.press('Backspace')
  await expect(input).toHaveValue('')
})
test('new and inline budget amounts regroup while typing', async ({ page }) => {
  await openSettings(page)
  await page.goto('http://127.0.0.1:5176/#/budgets')
  await page.getByRole('button', { name: 'Tambah anggaran', exact: true }).click()
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Tambah anggaran', exact: true }) })
  await typeTenMillion(form.locator('input[inputmode="numeric"]'))
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(form).toHaveCount(0)
  await page.getByRole('button', { name: 'Atur anggaran', exact: true }).first().click()
  const input = page.locator('input[inputmode="numeric"]')
  await input.fill('')
  await typeTenMillion(input)
})
test('a manually typed decimal is rejected instead of becoming a different integer', async ({ page }) => {
  const form = await transactionAmount(page)
  const input = form.locator('input[inputmode="numeric"]')
  await input.pressSequentially('1.5')
  await expect(input).toHaveValue('1.5')
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('Gunakan nominal rupiah bulat; angka desimal atau format ini tidak didukung.', { exact: true })).toBeVisible()
  await expect(form).toBeVisible()
})
