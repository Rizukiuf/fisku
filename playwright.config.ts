import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5175', channel: process.env.CI ? undefined : 'chrome', trace: 'retain-on-failure' },
  webServer: [{
    command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'test-public-key' },
  }, {
    command: 'npm run dev -- --host 127.0.0.1 --port 5176 --strictPort', url: 'http://127.0.0.1:5176', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  }],
})
