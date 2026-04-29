import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAccess } from "../internalAuth";
import type { AppStore } from "../../store";

const retryFailedWebhooksSchema = z.object({
  ignoreSchedule: z.boolean().optional(),
  maxEvents: z.number().int().positive().max(1000).optional()
});

const listWebhookEventsQuerySchema = z.object({
  status: z.enum(["received", "processed", "ignored", "failed", "dead_lettered"]).optional(),
  provider: z.enum(["yookassa", "bank", "sbp", "manual", "other"]).optional(),
  collectionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

const replayWebhookParamsSchema = z.object({
  eventId: z.string().min(1)
});

export function registerInternalRoutes(app: FastifyInstance, store: AppStore): void {
  app.post("/internal/autopay/run-due", async (request) => {
    requireInternalAccess(request);
    return await store.runAutoPaymentSweep();
  });

  app.get("/internal/payments/webhooks/events", async (request) => {
    requireInternalAccess(request);
    const query = listWebhookEventsQuerySchema.parse(request.query ?? {});
    return await store.listPaymentWebhookEvents(query);
  });

  app.post("/internal/payments/webhooks/retry-failed", async (request) => {
    requireInternalAccess(request);
    const body = retryFailedWebhooksSchema.parse(request.body ?? {});
    return await store.retryFailedPaymentWebhooks(body);
  });

  app.post("/internal/payments/webhooks/:eventId/replay", async (request) => {
    requireInternalAccess(request);
    const params = replayWebhookParamsSchema.parse(request.params ?? {});
    return await store.replayPaymentWebhookEvent(params.eventId);
  });
}
