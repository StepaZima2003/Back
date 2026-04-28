import type { FastifyRequest } from "fastify";
import type { User } from "../domain";
import type { AppStore } from "../store";

export async function requireUser(request: FastifyRequest, store: AppStore): Promise<User> {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  return await store.authenticate(token);
}
