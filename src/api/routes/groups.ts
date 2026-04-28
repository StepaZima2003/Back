import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import { AppError, type InMemoryStore } from "../../store";

const createGroupSchema = z.object({
  title: z.string().min(1).max(120),
  emoji: z.string().nullable().optional(),
  groupType: z.enum(["friends", "family", "work", "trip", "event", "other"]).optional()
});

const idParamsSchema = z.object({
  id: z.string()
});

const addMemberSchema = z.object({
  userId: z.string()
});

const createTemplateSchema = z.object({
  title: z.string().min(1).max(120),
  collectionType: z.enum(["picnic", "restaurant", "gift", "trip", "office", "rent", "kids", "dacha", "other"]),
  paymentMode: z.enum(["manual", "confirm_each", "auto_for_trusted", "calculation_only"]).optional(),
  categories: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        emoji: z.string().nullable().optional(),
        requiresManualConfirmation: z.boolean().optional(),
        autopayAllowedByDefault: z.boolean().optional()
      })
    )
    .optional()
});

export function registerGroupRoutes(app: FastifyInstance, store: InMemoryStore): void {
  app.get("/groups", async (request) => {
    const user = requireUser(request, store);
    return store.listGroups(user.id);
  });

  app.post("/groups", async (request, reply) => {
    const user = requireUser(request, store);
    const body = createGroupSchema.parse(request.body);
    const group = store.createGroup(user.id, body);
    reply.status(201).send(group);
  });

  app.get("/groups/:id", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const group = store.listGroups(user.id).find((item) => item.id === params.id);
    if (!group) {
      throw new AppError(404, "Group not found.");
    }
    return group;
  });

  app.post("/groups/:id/members", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addMemberSchema.parse(request.body);
    const member = store.addGroupMember(user.id, params.id, body.userId);
    reply.status(201).send(member);
  });

  app.get("/groups/:id/templates", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.listGroupTemplates(user.id, params.id);
  });

  app.post("/groups/:id/templates", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createTemplateSchema.parse(request.body);
    const template = store.createGroupTemplate(user.id, params.id, body);
    reply.status(201).send(template);
  });
}
