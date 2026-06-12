import fp from 'fastify-plugin'

export interface AppConfig {
  mongodbUri: string
  mongodbDatabase: string
  jwtSecret: string
  refreshCookieName: string
  bootstrapAdminUsername?: string
  bootstrapAdminPassword?: string
  isProduction: boolean
  cookieSecure: boolean
}

function required (name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be configured`)
  }
  return value
}

export default fp(async (fastify) => {
  const isProduction = process.env.NODE_ENV === 'production'
  const config: AppConfig = {
    mongodbUri: required('MONGODB_URI', 'mongodb://localhost:27017'),
    mongodbDatabase: process.env.MONGODB_DATABASE ?? 'k3s_auth',
    jwtSecret: required('JWT_SECRET', isProduction ? undefined : 'development-only-secret-change-me'),
    refreshCookieName: 'refreshToken',
    bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME,
    bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    isProduction,
    cookieSecure: process.env.COOKIE_SECURE === undefined
      ? isProduction
      : process.env.COOKIE_SECURE === 'true'
  }

  if ((config.bootstrapAdminUsername === undefined) !== (config.bootstrapAdminPassword === undefined)) {
    throw new Error('BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be configured together')
  }

  fastify.decorate('config', config)
})

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
  }
}
