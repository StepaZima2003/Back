import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import type { AppStore } from "../../store";

const inviteFriendSchema = z.object({
  phone: z.string().min(5)
});

const idParamsSchema = z.object({
  id: z.string()
});

export function registerFriendRoutes(app: FastifyInstance, store: AppStore): void {
  app.get("/friends", async (request) => {
    const user = await requireUser(request, store);
    return await store.listFriends(user.id);
  });

  app.post("/friends/invite", async (request, reply) => {
    const user = await requireUser(request, store);
    const body = inviteFriendSchema.parse(request.body);
    const friendship = await store.inviteFriend(user.id, body.phone);
    reply.status(201).send(friendship);
  });

  app.post("/friends/:id/accept", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.acceptFriendship(user.id, params.id);
  });

  app.post("/friends/:id/decline", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    await store.declineFriendship(user.id, params.id);
    reply.status(204).send();
  });

  app.delete("/friends/:id", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    await store.declineFriendship(user.id, params.id);
    reply.status(204).send();
  });
}
