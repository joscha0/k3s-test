import fp from 'fastify-plugin'
import './config'
import './database'

const TRACE_TTL_MS = 24 * 60 * 60 * 1000

function shouldTrace (route: string): boolean {
  return route.startsWith('/api') &&
    !route.startsWith('/api/health/') &&
    !route.startsWith('/api/dashboard/')
}

export default fp(async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    request.traceStartedAt = Date.now()
  })

  fastify.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url
    if (route === undefined) return
    if (!shouldTrace(route)) return

    const startedAt = new Date(request.traceStartedAt)
    const accessedMongoDB = route.startsWith('/api/auth/')
    try {
      await fastify.collections.requestTraces.insertOne({
        method: request.method,
        route,
        status: reply.statusCode,
        startedAt,
        durationMs: Date.now() - request.traceStartedAt,
        backendPod: fastify.config.podName,
        accessedMongoDB,
        expiresAt: new Date(startedAt.getTime() + TRACE_TTL_MS)
      })
    } catch (error) {
      request.log.warn({ err: error }, 'Could not store request trace')
    }
  })
}, { name: 'tracing', dependencies: ['config', 'database'] })

declare module 'fastify' {
  interface FastifyRequest {
    traceStartedAt: number
  }
}
