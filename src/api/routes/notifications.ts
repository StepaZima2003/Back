import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import type { InMemoryStore } from "../../store";

const idParamsSchema = z.object({
  id: z.string()
});

export function registerNotificationRoutes(app: FastifyInstance, store: InMemoryStore): void {
  app.get("/notifications", async (request) => {
    const user = requireUser(request, store);
    return store.listNotifications(user.id);
  });

  app.post("/notifications/:id/read", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.markNotificationRead(user.id, params.id);
  });
}

