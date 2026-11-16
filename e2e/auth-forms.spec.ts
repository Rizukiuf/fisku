import { test, expect, type Page } from '@playwright/test'
import { mockCloud, session, userA } from './fixtures/cloud'

const signupNotice = 'Permintaan pendaftaran diproses. Jika email ini dapat didaftarkan, periksa email konfirmasi. Jika sudah terdaftar, silakan masuk atau gunakan Lupa kata sandi.'
async function settings(page: Page) {
  await page.goto('/#/settings')
  await page.getByRole('dialog').getByRole('button', { name: 'Mulai kosong', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

for (const existing of [false, true]) {
  test(`signup ${existing ? 'obfuscated existing account' : 'confirmation-required account'} returns to login without claiming a new account or delivered email`, async ({ page, context }) => {
    await mockCloud(context)
    await context.route('**/auth/v1/signup**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...session(userA, 'a@example.test').user, identities: existing ? [] : [{ id: userA, provider: 'email', user_id: userA }] }) }))
    await settings(page)
    await page.getByRole('button', { name: 'Daftar', exact: true }).click()
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
    await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('new-password-123')
    await page.getByRole('textbox', { name: 'Konfirmasi kata sandi', exact: true }).fill('new-password-123')
    await page.getByRole('button', { name: 'Daftar', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: signupNotice })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Konfirmasi kata sandi', exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('a@example.test')
    await expect(page.getByRole('textbox', { name: 'Kata sandi', exact: true })).toHaveValue('')
    await expect(page.getByRole('textbox', { name: 'Kata sandi', exact: true })).toHaveAttribute('autocomplete', 'current-password')
  })
}

test('short signup password and mismatching confirmation use app validation without sending signup', async ({ page, context }) => {
  const cloud = await mockCloud(context); await settings(page)
  await page.getByRole('button', { name: 'Daftar', exact: true }).click()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('short')
  await page.getByRole('textbox', { name: 'Konfirmasi kata sandi', exact: true }).fill('short')
  await page.getByRole('button', { name: 'Daftar', exact: true }).click()
  await expect(page.getByText('Kata sandi minimal 8 karakter.', { exact: true })).toBeVisible({ timeout: 2000 })
  expect(cloud.calls.some(call => call.endsWith('/signup'))).toBe(false)
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('long-password')
  await page.getByRole('button', { name: 'Daftar', exact: true }).click()
  await expect(page.getByText('Konfirmasi kata sandi tidak cocok.', { exact: true })).toBeVisible()
  expect(cloud.calls.some(call => call.endsWith('/signup'))).toBe(false)
})

test('short recovery password uses app validation and never updates the provider', async ({ page, context }) => {
  const cloud = await mockCloud(context); const recovery = session(userA, 'a@example.test')
  await page.goto(`/?auth=recovery#access_token=${recovery.access_token}&refresh_token=${recovery.refresh_token}&token_type=bearer&expires_in=3600&type=recovery`)
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('short')
  await page.getByRole('textbox', { name: 'Konfirmasi kata sandi', exact: true }).fill('short')
  await page.getByRole('button', { name: 'Simpan kata sandi baru', exact: true }).click()
  await expect(page.getByText('Kata sandi minimal 8 karakter.', { exact: true })).toBeVisible({ timeout: 2000 })
  expect(cloud.calls).not.toContain('PUT /auth/v1/user')
  await expect(page.getByRole('textbox', { name: 'Kata sandi', exact: true })).toHaveValue('short')
})

test('required and invalid auth fields use app messages without native validation bubbles', async ({ page, context }) => {
  const cloud = await mockCloud(context); await settings(page)
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByText('Masukkan alamat email.', { exact: true })).toBeVisible({ timeout: 2000 })
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('invalid-email')
  await page.getByRole('button', { name: 'Lupa kata sandi', exact: true }).click()
  await page.getByRole('button', { name: 'Kirim tautan pemulihan', exact: true }).click()
  await expect(page.getByText('Format alamat email tidak valid.', { exact: true })).toBeVisible()
  expect(cloud.calls.some(call => /\/token$|\/signup$|\/recover$/.test(call))).toBe(false)
})

test('login delegates an existing short password to the provider instead of applying the signup minimum', async ({ page, context }) => {
  const cloud = await mockCloud(context); await settings(page)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('a@example.test')
  await page.getByRole('textbox', { name: 'Kata sandi', exact: true }).fill('short')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByText('a@example.test', { exact: true })).toBeVisible()
  expect(cloud.calls).toContain('POST /auth/v1/token')
  await expect(page.getByText('Kata sandi minimal 8 karakter.', { exact: true })).toHaveCount(0)
})
