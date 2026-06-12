import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'

const user = { username: 'test_user', password: 'correct-horse-battery-staple' }

test('hello routes expose public and protected responses', async (t) => {
  const app = await build(t)

  const world = await app.inject({ url: '/api/hello/world' })
  assert.equal(world.statusCode, 200)

  const protectedUser = await app.inject({ url: '/api/hello/user' })
  assert.equal(protectedUser.statusCode, 401)

  const protectedAdmin = await app.inject({ url: '/api/hello/admin' })
  assert.equal(protectedAdmin.statusCode, 401)
})

test('signup, protected routes, refresh rotation, and signout', async (t) => {
  const app = await build(t)

  const signup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: user })
  assert.equal(signup.statusCode, 201)
  const signupBody = JSON.parse(signup.payload)
  assert.equal(signupBody.user.role, 'user')
  assert.ok(signupBody.accessToken)
  const refreshCookie = signup.cookies.find((cookie: { name: string, value: string }) => cookie.name === 'refreshToken')
  assert.ok(refreshCookie)

  const duplicate = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: user })
  assert.equal(duplicate.statusCode, 409)

  const hello = await app.inject({
    url: '/api/hello/user',
    headers: { authorization: `Bearer ${signupBody.accessToken}` }
  })
  assert.equal(hello.statusCode, 200)
  assert.equal(JSON.parse(hello.payload).message, 'Hello test_user')

  const admin = await app.inject({
    url: '/api/hello/admin',
    headers: { authorization: `Bearer ${signupBody.accessToken}` }
  })
  assert.equal(admin.statusCode, 403)

  const refreshed = await app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    cookies: { refreshToken: refreshCookie.value }
  })
  assert.equal(refreshed.statusCode, 200)
  assert.ok(JSON.parse(refreshed.payload).accessToken)
  const rotatedCookie = refreshed.cookies.find((cookie: { name: string, value: string }) => cookie.name === 'refreshToken')
  assert.ok(rotatedCookie)

  const reused = await app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    cookies: { refreshToken: refreshCookie.value }
  })
  assert.equal(reused.statusCode, 401)

  const signout = await app.inject({
    method: 'POST',
    url: '/api/auth/signout',
    cookies: { refreshToken: rotatedCookie.value }
  })
  assert.equal(signout.statusCode, 200)

  const signedOutRefresh = await app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    cookies: { refreshToken: rotatedCookie.value }
  })
  assert.equal(signedOutRefresh.statusCode, 401)
})

test('signin rejects invalid credentials', async (t) => {
  const app = await build(t)
  await app.inject({ method: 'POST', url: '/api/auth/signup', payload: user })

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: { ...user, password: 'definitely-wrong' }
  })
  assert.equal(response.statusCode, 401)
})

test('bootstrap account has admin access', async (t) => {
  const app = await build(t, {
    BOOTSTRAP_ADMIN_USERNAME: 'cluster_admin',
    BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-admin-password'
  })

  const signin = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: { username: 'cluster_admin', password: 'bootstrap-admin-password' }
  })
  assert.equal(signin.statusCode, 200)

  const token = JSON.parse(signin.payload).accessToken
  const response = await app.inject({
    url: '/api/hello/admin',
    headers: { authorization: `Bearer ${token}` }
  })
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(response.payload).message, 'Hello admin cluster_admin')
})
