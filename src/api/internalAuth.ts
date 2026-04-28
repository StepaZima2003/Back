import type { FastifyRequest } from "fastify";
import { AppError } from "../store";

export function requireInternalAccess(request: FastifyRequest): void {
  const providedToken = request.headers["x-internal-token"];
  const expectedToken = process.env.INTERNAL_API_TOKEN?.trim() || "dev-internal-token";
  const token = Array.isArray(providedToken) ? providedToken[0] : providedToken;

  if (!token || token !== expectedToken) {
    throw new AppError(401, "Invalid internal token.");
  }
}
