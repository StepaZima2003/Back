import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import type { AppStore } from "../../store";

const idParamsSchema = z.object({
  id: z.string()
});

export function registerNotificationRoutes(app: FastifyInstance, store: AppStore): void {
  app.get("/notifications", async (request) => {
    const user = await requireUser(request, store);
    return await store.listNotifications(user.id);
  });

  app.post("/notifications/:id/read", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.markNotificationRead(user.id, params.id);
  });
}
