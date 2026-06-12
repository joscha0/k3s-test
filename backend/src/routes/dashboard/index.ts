import { type FastifyPluginAsync } from 'fastify'
import '../../plugins/auth'
import '../../plugins/kubernetes'

const dashboard: FastifyPluginAsync = async (fastify) => {
  fastify.get('/snapshot', { preHandler: fastify.requireAdmin }, async () => await fastify.dashboardSnapshot())

  fastify.get('/events', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })

    let closed = false
    request.raw.on('close', () => { closed = true })
    const stopAt = Date.now() + 10 * 60 * 1000
    while (!closed && Date.now() < stopAt) {
      reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(await fastify.dashboardSnapshot())}\n\n`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    reply.raw.end()
  })

  fastify.delete<{ Params: { name: string } }>('/pods/:name', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    await fastify.deleteDashboardPod(request.params.name)
    return await reply.code(202).send({ deleting: request.params.name })
  })
}

export default dashboard
