import argon2 from 'argon2'
import fp from 'fastify-plugin'
import { Collection, Db, MongoClient, MongoServerError, ObjectId } from 'mongodb'
import './config'

export type UserRole = 'user' | 'admin'

export interface UserDocument {
  _id?: ObjectId
  username: string
  passwordHash: string
  role: UserRole
  createdAt: Date
  updatedAt: Date
}

export interface SessionDocument {
  _id?: ObjectId
  userId: ObjectId
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

export interface RequestTraceDocument {
  _id?: ObjectId
  method: string
  route: string
  status: number
  startedAt: Date
  durationMs: number
  backendPod: string
  accessedMongoDB: boolean
  expiresAt: Date
}

export interface DatabaseCollections {
  users: Collection<UserDocument>
  sessions: Collection<SessionDocument>
  requestTraces: Collection<RequestTraceDocument>
}

async function bootstrapAdmin (collections: DatabaseCollections, username: string, password: string): Promise<void> {
  const normalizedUsername = username.toLowerCase()
  const now = new Date()
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })

  const update = {
    $set: { passwordHash, role: 'admin' as const, updatedAt: now },
    $setOnInsert: { username: normalizedUsername, createdAt: now }
  }

  try {
    await collections.users.updateOne({ username: normalizedUsername }, update, { upsert: true })
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) throw error
    await collections.users.updateOne({ username: normalizedUsername }, update)
  }
}

export default fp(async (fastify) => {
  const client = new MongoClient(fastify.config.mongodbUri)
  await client.connect()

  const db: Db = client.db(fastify.config.mongodbDatabase)
  const collections: DatabaseCollections = {
    users: db.collection<UserDocument>('users'),
    sessions: db.collection<SessionDocument>('sessions'),
    requestTraces: db.collection<RequestTraceDocument>('request_traces')
  }

  await Promise.all([
    collections.users.createIndex({ username: 1 }, { unique: true }),
    collections.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.requestTraces.createIndex({ startedAt: -1 }),
    collections.requestTraces.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ])

  if (fastify.config.bootstrapAdminUsername !== undefined && fastify.config.bootstrapAdminPassword !== undefined) {
    await bootstrapAdmin(
      collections,
      fastify.config.bootstrapAdminUsername,
      fastify.config.bootstrapAdminPassword
    )
  }

  fastify.decorate('db', db)
  fastify.decorate('collections', collections)
  fastify.addHook('onClose', async () => await client.close())
}, { name: 'database', dependencies: ['config'] })

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
    collections: DatabaseCollections
  }
}
