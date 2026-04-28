import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import type { AppStore } from "../../store";

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  avatarUrl: z.string().url().nullable().optional()
});

export function registerUserRoutes(app: FastifyInstance, store: AppStore): void {
  app.get("/me", async (request) => {
    return await requireUser(request, store);
  });

  app.patch("/me", async (request) => {
    const user = await requireUser(request, store);
    const body = updateProfileSchema.parse(request.body);
    return await store.updateUser(user.id, body);
  });

  app.get("/users/:id", async (request) => {
    await requireUser(request, store);
    const params = z.object({ id: z.string() }).parse(request.params);
    return await store.getUser(params.id);
  });
}
