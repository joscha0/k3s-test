import { type FastifyPluginAsync } from 'fastify'

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.get('/', async function (request, reply) {
    return { service: 'k3s-auth-backend', status: 'ok' }
  })

  fastify.get('/health/live', async function () {
    return { status: 'ok' }
  })

  fastify.get('/health/ready', async function () {
    await fastify.db.command({ ping: 1 })
    return { status: 'ok' }
  })
}

export default root
