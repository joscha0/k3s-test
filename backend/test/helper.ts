// This file contains code that we reuse between our tests.
import * as path from 'node:path'
import * as test from 'node:test'
import { MongoMemoryServer } from 'mongodb-memory-server'
const helper = require('fastify-cli/helper.js')

export type TestContext = {
  after: typeof test.after
}

const AppPath = path.join(__dirname, '..', 'src', 'app.ts')

// Fill in this config with all the configurations
// needed for testing the application
function config () {
  return {
    skipOverride: true // Register our application with fastify-plugin
  }
}

// Automatically build and tear down our instance
async function build (t: TestContext, environment: Record<string, string> = {}) {
  const mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  process.env.MONGODB_DATABASE = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`
  process.env.JWT_SECRET = 'test-secret-with-enough-randomness'
  delete process.env.BOOTSTRAP_ADMIN_USERNAME
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD
  Object.assign(process.env, environment)

  // you can set all the options supported by the fastify CLI command
  const argv = [AppPath]

  // fastify-plugin ensures that all decorators
  // are exposed for testing purposes, this is
  // different from the production setup
  let app
  try {
    app = await helper.build(argv, config())
  } catch (error) {
    await mongo.stop()
    throw error
  }

  // Tear down our app after we are done
  // eslint-disable-next-line no-void
  t.after(async () => {
    await app.close()
    await mongo.stop()
  })

  return app
}

export {
  config,
  build
}
