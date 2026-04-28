import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import { getPaymentProviderAdapter } from "../../payments/providerAdapter";
import { AppError } from "../../store";
import type { AppStore } from "../../store";

const idParamsSchema = z.object({
  id: z.string()
});

const autopayRuleParamsSchema = z.object({
  id: z.string()
});

const listAutoPaymentRulesQuerySchema = z.object({
  collectionId: z.string().optional(),
  groupId: z.string().optional()
});

const bindMockPaymentMethodSchema = z.object({
  provider: z.string().min(1).max(40).optional(),
  maskedPan: z.string().min(4).max(32),
  brand: z.enum(["visa", "mastercard", "mir", "unknown"]).optional(),
  setAsDefault: z.boolean().optional()
});

const upsertAutoPaymentRuleSchema = z.object({
  collectionId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  singleCollectionLimitMinor: z.number().int().nonnegative().optional(),
  dailyLimitMinor: z.number().int().nonnegative().optional(),
  monthlyLimitMinor: z.number().int().nonnegative().optional(),
  requiresObjectionWindow: z.boolean().optional(),
  objectionWindowHours: z.number().int().min(0).max(168).optional(),
  allowGuests: z.boolean().optional(),
  allowChildren: z.boolean().optional(),
  allowPartner: z.boolean().optional(),
  maxCoveredParticipants: z.number().int().positive().max(100).optional()
});

const createMockPaymentSchema = z.object({
  participantId: z.string(),
  amountMinor: z.number().int().positive(),
  provider: z.enum(["yookassa", "bank", "sbp", "manual", "other"]).optional(),
  paymentMethodId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1).max(120)
});

const paymentActionSchema = z.object({
  reason: z.string().nullable().optional()
});

const webhookProviderParamsSchema = z.object({
  provider: z.enum(["yookassa", "bank", "sbp", "manual", "other"])
});

const executeAutopaySchema = z.object({
  dryRun: z.boolean().optional()
});

export function registerPaymentRoutes(app: FastifyInstance, store: AppStore): void {
  app.get("/payment-methods", async (request) => {
    const user = await requireUser(request, store);
    return await store.listPaymentMethods(user.id);
  });

  app.post("/payment-methods/mock-bind", async (request, reply) => {
    const user = await requireUser(request, store);
    const body = bindMockPaymentMethodSchema.parse(request.body);
    const method = await store.bindMockPaymentMethod(user.id, body);
    reply.status(201).send(method);
  });

  app.post("/payment-methods/:id/revoke", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.revokePaymentMethod(user.id, params.id);
  });

  app.get("/autopay-rules", async (request) => {
    const user = await requireUser(request, store);
    const query = listAutoPaymentRulesQuerySchema.parse(request.query ?? {});
    return await store.listAutoPaymentRules(user.id, query);
  });

  app.post("/autopay-rules", async (request, reply) => {
    const user = await requireUser(request, store);
    const body = upsertAutoPaymentRuleSchema.parse(request.body);
    const rule = await store.upsertAutoPaymentRule(user.id, body);
    reply.status(201).send(rule);
  });

  app.patch("/autopay-rules/:id", async (request) => {
    const user = await requireUser(request, store);
    const params = autopayRuleParamsSchema.parse(request.params);
    const body = upsertAutoPaymentRuleSchema.parse(request.body);
    return await store.upsertAutoPaymentRule(user.id, { ...body, id: params.id });
  });

  app.get("/collections/:id/payments", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listPayments(user.id, params.id);
  });

  app.get("/collections/:id/autopay/preview", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.previewAutoPayments(user.id, params.id);
  });

  app.post("/collections/:id/autopay/execute", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = executeAutopaySchema.parse(request.body ?? {});
    return await store.executeAutoPayments(user.id, params.id, body);
  });

  app.post("/collections/:id/payments/mock-intents", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createMockPaymentSchema.parse(request.body);
    const payment = await store.createMockPayment(user.id, params.id, body);
    reply.status(201).send(payment);
  });

  app.post("/payments/:id/simulate-success", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.confirmMockPayment(user.id, params.id);
  });

  app.post("/payments/:id/simulate-failure", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = paymentActionSchema.parse(request.body ?? {});
    return await store.failMockPayment(user.id, params.id, body);
  });

  app.post("/payments/:id/refund", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = paymentActionSchema.parse(request.body ?? {});
    return await store.refundPayment(user.id, params.id, body);
  });

  app.post("/payments/webhooks/:provider", async (request) => {
    const params = webhookProviderParamsSchema.parse(request.params);
    const adapter = getPaymentProviderAdapter(params.provider);
    try {
      const event = adapter.verifyAndNormalizeWebhook({
        headers: request.headers,
        body: request.body
      });
      return await store.applyPaymentWebhook(event);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(401, error instanceof Error ? error.message : "Invalid payment provider webhook.");
    }
  });

  app.post("/payments/webhooks/mock-provider", async (request) => {
    const adapter = getPaymentProviderAdapter("bank");
    try {
      const event = adapter.verifyAndNormalizeWebhook({
        headers: request.headers,
        body: request.body
      });
      return await store.applyPaymentWebhook(event);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(401, error instanceof Error ? error.message : "Invalid mock provider signature.");
    }
  });
}
