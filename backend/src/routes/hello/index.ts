import { type FastifyPluginAsync } from 'fastify'

const hello: FastifyPluginAsync = async (fastify) => {
  fastify.get('/world', async () => ({ message: 'Hello world' }))

  fastify.get('/user', { preHandler: fastify.authenticate }, async (request) => ({
    message: `Hello ${request.user.username}`
  }))

  fastify.get('/admin', { preHandler: fastify.requireAdmin }, async (request) => ({
    message: `Hello admin ${request.user.username}`
  }))
}

export default hello
