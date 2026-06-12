import { test } from 'node:test'
import * as assert from 'node:assert'
import { parseCpuMillicores, parseMemoryMiB } from '../../src/plugins/kubernetes'
import { build } from '../helper'

test('dashboard requires an admin account and returns a partial snapshot outside Kubernetes', async (t) => {
  const app = await build(t, {
    BOOTSTRAP_ADMIN_USERNAME: 'dashboard_admin',
    BOOTSTRAP_ADMIN_PASSWORD: 'dashboard-admin-password'
  })

  const unauthenticated = await app.inject({ url: '/api/dashboard/snapshot' })
  assert.equal(unauthenticated.statusCode, 401)

  const signup = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { username: 'dashboard_user', password: 'dashboard-user-password' }
  })
  const userToken = JSON.parse(signup.payload).accessToken
  const forbidden = await app.inject({
    url: '/api/dashboard/snapshot',
    headers: { authorization: `Bearer ${userToken}` }
  })
  assert.equal(forbidden.statusCode, 403)

  const signin = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: { username: 'dashboard_admin', password: 'dashboard-admin-password' }
  })
  const adminToken = JSON.parse(signin.payload).accessToken
  const snapshot = await app.inject({
    url: '/api/dashboard/snapshot',
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(snapshot.statusCode, 200)
  const body = JSON.parse(snapshot.payload)
  assert.deepEqual(body.pods, [])
  assert.ok(body.errors.some((error: { component: string }) => error.component === 'kubernetes'))
  assert.ok(body.errors.some((error: { component: string }) => error.component === 'metrics'))
})

test('Kubernetes resource quantities convert to dashboard units', () => {
  assert.equal(parseCpuMillicores('500m'), 500)
  assert.equal(parseCpuMillicores('250000n'), 0.25)
  assert.equal(parseCpuMillicores('2'), 2000)
  assert.equal(parseMemoryMiB('256Mi'), 256)
  assert.equal(parseMemoryMiB('1Gi'), 1024)
  assert.ok(Math.abs(parseMemoryMiB('100M') - 95.367) < 0.001)
})
