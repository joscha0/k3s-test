import { createHash, randomBytes } from "node:crypto";
import "@fastify/sensible";
import argon2 from "argon2";
import { type FastifyPluginAsync, type FastifyReply } from "fastify";
import { MongoServerError, ObjectId } from "mongodb";
import type { UserDocument } from "../../plugins/database";

const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CredentialsBody {
  username: string;
  password: string;
}

function normalizeCredentials(body: CredentialsBody): CredentialsBody {
  return {
    username: body.username?.trim().toLowerCase(),
    password: body.password,
  };
}

function validateCredentials(body: CredentialsBody): string | undefined {
  if (!USERNAME_PATTERN.test(body.username))
    return "Username must be 3-32 characters using letters, numbers, _ or -";
  if (
    typeof body.password !== "string" ||
    body.password.length < 8 ||
    body.password.length > 128
  ) {
    return "Password must be 8-128 characters";
  }
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicUser(user: UserDocument): { username: string; role: string } {
  return { username: user.username, role: user.role };
}

const auth: FastifyPluginAsync = async (fastify) => {
  async function issueSession(
    user: UserDocument,
    reply: FastifyReply,
  ): Promise<{ accessToken: string; user: ReturnType<typeof publicUser> }> {
    if (user._id === undefined)
      throw new Error("Cannot create a session for a user without an id");

    const refreshToken = randomBytes(48).toString("base64url");
    await fastify.collections.sessions.insertOne({
      userId: user._id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      createdAt: new Date(),
    });

    reply.setCookie(fastify.config.refreshCookieName, refreshToken, {
      path: "/api/auth",
      httpOnly: true,
      sameSite: "strict",
      secure: fastify.config.cookieSecure,
      maxAge: REFRESH_TOKEN_TTL_MS / 1000,
    });

    return {
      accessToken: fastify.signAccessToken(user),
      user: publicUser(user),
    };
  }

  fastify.post<{ Body: CredentialsBody }>(
    "/signup",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const credentials = normalizeCredentials(request.body);
      const validationError = validateCredentials(credentials);
      if (validationError !== undefined)
        return await reply.badRequest(validationError);

      const now = new Date();
      const user: UserDocument = {
        username: credentials.username,
        passwordHash: await argon2.hash(credentials.password, {
          type: argon2.argon2id,
        }),
        role: "user",
        createdAt: now,
        updatedAt: now,
      };

      try {
        const result = await fastify.collections.users.insertOne(user);
        user._id = result.insertedId;
        return await reply.code(201).send(await issueSession(user, reply));
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          return await reply.conflict("Username already exists");
        }
        throw error;
      }
    },
  );

  fastify.post<{ Body: CredentialsBody }>(
    "/signin",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const credentials = normalizeCredentials(request.body);
      const user = await fastify.collections.users.findOne({
        username: credentials.username,
      });
      if (
        user === null ||
        !(await argon2.verify(user.passwordHash, credentials.password ?? ""))
      ) {
        return await reply.unauthorized("Invalid username or password");
      }
      return await issueSession(user, reply);
    },
  );

  fastify.post("/refresh", async (request, reply) => {
    const refreshToken = request.cookies[fastify.config.refreshCookieName];
    if (refreshToken === undefined)
      return await reply.unauthorized("Refresh token required");

    const session = await fastify.collections.sessions.findOneAndDelete({
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: { $gt: new Date() },
    });
    if (session === null) {
      reply.clearCookie(fastify.config.refreshCookieName, {
        path: "/api/auth",
      });
      return await reply.unauthorized("Invalid or expired refresh token");
    }

    const user = await fastify.collections.users.findOne({
      _id: session.userId,
    });
    if (user === null) return await reply.unauthorized("User no longer exists");
    return await issueSession(user, reply);
  });

  fastify.post("/signout", async (request, reply) => {
    const refreshToken = request.cookies[fastify.config.refreshCookieName];
    if (refreshToken !== undefined) {
      await fastify.collections.sessions.deleteOne({
        tokenHash: hashRefreshToken(refreshToken),
      });
    }
    reply.clearCookie(fastify.config.refreshCookieName, { path: "/api/auth" });
    return { signedOut: true };
  });

  fastify.get("/me", { preHandler: fastify.authenticate }, async (request) => {
    const user = await fastify.collections.users.findOne({
      _id: new ObjectId(request.user.sub),
    });
    if (user === null)
      throw fastify.httpErrors.unauthorized("User no longer exists");
    return { user: publicUser(user) };
  });
};

export default auth;
