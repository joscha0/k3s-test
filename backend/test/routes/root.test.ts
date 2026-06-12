import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'

test('default root route', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/api'
  })
  assert.deepStrictEqual(JSON.parse(res.payload), { service: 'k3s-auth-backend', status: 'ok' })
})
