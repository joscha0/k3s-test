import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import "@fastify/sensible";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import type { UserRole } from "./database";
import "./config";

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export default fp(async (fastify) => {
  await fastify.register(cookie);
  await fastify.register(jwt, {
    secret: fastify.config.jwtSecret,
    sign: { expiresIn: "15m" },
  });
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  fastify.decorate("authenticate", async (request) => {
    await request.jwtVerify();
  });

  fastify.decorate("requireAdmin", async (request) => {
    await request.jwtVerify();
    if (request.user.role !== "admin") {
      throw fastify.httpErrors.forbidden("Admin role required");
    }
  });

  fastify.decorate("signAccessToken", (user) => {
    if (user._id === undefined)
      throw new Error("Cannot sign a token for a user without an id");
    return fastify.jwt.sign({
      sub: user._id.toHexString(),
      username: user.username,
      role: user.role,
    });
  });
}, { name: "auth", dependencies: ["config"] });

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: import("fastify").FastifyRequest) => Promise<void>;
    requireAdmin: (request: import("fastify").FastifyRequest) => Promise<void>;
    signAccessToken: (user: {
      _id?: ObjectId;
      username: string;
      role: UserRole;
    }) => string;
  }
}
