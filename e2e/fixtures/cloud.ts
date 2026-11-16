import type { BrowserContext } from '@playwright/test'

export const userA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const userB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
export function session(id: string, email: string) {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const payload = Buffer.from(JSON.stringify({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp: expires })).toString('base64url')
  return { access_token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.test-signature`, refresh_token: `refresh-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: expires, user: { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }
}
type MockCloud = { snapshots: Map<string, { revision: number; state: any }>; operations: Map<string, number>; calls: string[] }
export async function mockCloud(context: BrowserContext, shared?: MockCloud) {
  const snapshots = shared?.snapshots ?? new Map<string, { revision: number; state: any }>()
  const operations = shared?.operations ?? new Map<string, number>()
  const calls: string[] = shared?.calls ?? []
  await context.route('http://127.0.0.1:54321/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const body = request.postDataJSON() ?? {}
    calls.push(`${request.method()} ${url.pathname}`)
    const response = (json: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) })
    const token = request.headers().authorization?.replace('Bearer ', '')
    const claims = token?.split('.')[1]
    let id = userA
    try { if (claims) id = JSON.parse(Buffer.from(claims, 'base64url').toString()).sub } catch { /* Public key is not a user session. */ }
    const email = id === userB ? 'b@example.test' : 'a@example.test'
    if (url.pathname.endsWith('/token')) {
      if (body.password === 'wrong-password') return response({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400)
      const isB = body.email === 'b@example.test' || body.refresh_token === `refresh-${userB}`
      return response(session(isB ? userB : userA, isB ? 'b@example.test' : 'a@example.test'))
    }
    if (url.pathname.endsWith('/signup')) return response({ ...session(userA, body.email).user, identities: [] })
    if (url.pathname.endsWith('/recover')) return response({})
    if (url.pathname.endsWith('/user')) return response(session(id, email).user)
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/finance_read')) return response(snapshots.get(id) ?? { revision: 0, state: { accounts: [], categories: [], transactions: [], budgets: [], purged: { accounts: [], categories: [], transactions: [], budgets: [] } } })
    if (url.pathname.endsWith('/finance_push')) {
      const key = `${id}:${body.p_operation_id}`
      if (operations.has(key)) return response({ revision: operations.get(key) })
      const revision = snapshots.get(id)?.revision ?? 0
      if (revision !== body.p_expected_revision) return response({ code: 'PT409', message: 'Cloud changed; reconcile first', details: null, hint: null }, 409)
      snapshots.set(id, { revision: revision + 1, state: body.p_data }); operations.set(key, revision + 1)
      return response({ revision: revision + 1 })
    }
    return response({ message: `Unexpected test request: ${url.pathname}` }, 500)
  })
  return { snapshots, operations, calls }
}
