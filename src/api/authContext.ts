import type { FastifyRequest } from "fastify";
import type { User } from "../domain";
import type { InMemoryStore } from "../store";

export function requireUser(request: FastifyRequest, store: InMemoryStore): User {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  return store.authenticate(token);
}

