import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import { AppError, type AppStore } from "../../store";

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

const createParticipantProfileSchema = z.object({
  linkedUserId: z.string().nullable().optional(),
  invitedPhone: z.string().nullable().optional(),
  participantType: z.enum(["registered_user", "invited_phone", "guest", "child", "external_person"]).optional(),
  displayName: z.string().min(1).max(120).optional(),
  relationshipHint: z.enum(["self", "partner", "child", "guest", "family", "colleague", "other"]).optional(),
  defaultWeight: z.number().positive().optional()
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

export function registerGroupRoutes(app: FastifyInstance, store: AppStore): void {
  app.get("/groups", async (request) => {
    const user = await requireUser(request, store);
    return await store.listGroups(user.id);
  });

  app.post("/groups", async (request, reply) => {
    const user = await requireUser(request, store);
    const body = createGroupSchema.parse(request.body);
    const group = await store.createGroup(user.id, body);
    reply.status(201).send(group);
  });

  app.get("/groups/:id", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const group = (await store.listGroups(user.id)).find((item) => item.id === params.id);
    if (!group) {
      throw new AppError(404, "Group not found.");
    }
    return group;
  });

  app.post("/groups/:id/members", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addMemberSchema.parse(request.body);
    const member = await store.addGroupMember(user.id, params.id, body.userId);
    reply.status(201).send(member);
  });

  app.get("/groups/:id/participant-profiles", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listGroupParticipantProfiles(user.id, params.id);
  });

  app.post("/groups/:id/participant-profiles", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createParticipantProfileSchema.parse(request.body);
    const profile = await store.createGroupParticipantProfile(user.id, params.id, body);
    reply.status(201).send(profile);
  });

  app.get("/groups/:id/templates", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listGroupTemplates(user.id, params.id);
  });

  app.post("/groups/:id/templates", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createTemplateSchema.parse(request.body);
    const template = await store.createGroupTemplate(user.id, params.id, body);
    reply.status(201).send(template);
  });
}
