import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import type { Collection, Expense, ExpensePayment } from "../../domain";
import type { InMemoryStore } from "../../store";

const idParamsSchema = z.object({
  id: z.string()
});

const participantParamsSchema = z.object({
  id: z.string(),
  participantId: z.string()
});

const createCollectionSchema = z.object({
  title: z.string().min(1).max(160),
  type: z.enum(["picnic", "restaurant", "gift", "trip", "office", "rent", "kids", "dacha", "other"]).optional(),
  groupId: z.string().nullable().optional(),
  paymentMode: z.enum(["manual", "confirm_each", "auto_for_trusted", "calculation_only"]).optional()
});

const addParticipantSchema = z.object({
  linkedUserId: z.string().nullable().optional(),
  invitedPhone: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  defaultWeight: z.number().positive().optional(),
  responsiblePayerParticipantId: z.string().nullable().optional()
});

const addGuestSchema = z.object({
  displayName: z.string().min(1),
  responsiblePayerParticipantId: z.string().nullable().optional(),
  defaultWeight: z.number().positive().optional()
});

const addChildSchema = z.object({
  displayName: z.string().min(1),
  responsiblePayerParticipantId: z.string(),
  defaultWeight: z.number().positive().optional()
});

const createExpenseSchema = z.object({
  title: z.string().min(1).max(160),
  amountMinor: z.number().int().nonnegative(),
  categoryId: z.string().nullable().optional(),
  expenseType: z.enum(["expense", "prepayment", "deposit", "refund", "discount", "correction", "service_fee", "tax", "other"]).optional(),
  comment: z.string().nullable().optional(),
  payments: z
    .array(
      z.object({
        paidByParticipantId: z.string(),
        amountMinor: z.number().int().nonnegative(),
        paymentSource: z.enum(["card", "cash", "sbp", "bonus", "certificate", "other"]).optional(),
        comment: z.string().nullable().optional()
      })
    )
    .optional()
});

const addPaymentSchema = z.object({
  paidByParticipantId: z.string(),
  amountMinor: z.number().int().nonnegative(),
  paymentSource: z.enum(["card", "cash", "sbp", "bonus", "certificate", "other"]).optional(),
  comment: z.string().nullable().optional()
});

const addShareRuleSchema = z.object({
  participantId: z.string(),
  splitMode: z.enum(["equal", "weights", "fixed", "percent", "excluded", "cap"]),
  categoryId: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
  fixedAmountMinor: z.number().int().nonnegative().nullable().optional(),
  percent: z.number().min(0).max(100).nullable().optional(),
  capAmountMinor: z.number().int().nonnegative().nullable().optional(),
  excluded: z.boolean().nullable().optional(),
  reason: z.string().nullable().optional()
});

export function registerCollectionRoutes(app: FastifyInstance, store: InMemoryStore): void {
  app.get("/collections", async (request) => {
    const user = requireUser(request, store);
    return store.listCollections(user.id);
  });

  app.post("/collections", async (request, reply) => {
    const user = requireUser(request, store);
    const body = createCollectionSchema.parse(request.body);
    const result = store.createCollection(user.id, body);
    reply.status(201).send(result);
  });

  app.get("/collections/:id", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.getCollectionForUser(user.id, params.id);
  });

  app.post("/collections/:id/send-to-review", async (request) => updateCollectionStatus(request, store, "review"));
  app.post("/collections/:id/finalize", async (request) => updateCollectionStatus(request, store, "finalized"));
  app.post("/collections/:id/cancel", async (request) => updateCollectionStatus(request, store, "cancelled"));
  app.post("/collections/:id/close", async (request) => updateCollectionStatus(request, store, "closed"));

  app.get("/collections/:id/participants", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.listParticipants(user.id, params.id);
  });

  app.post("/collections/:id/participants", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addParticipantSchema.parse(request.body);
    const participant = store.addParticipant(user.id, params.id, body);
    reply.status(201).send(participant);
  });

  app.post("/collections/:id/participants/add-guest", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addGuestSchema.parse(request.body);
    const participant = store.addGuest(user.id, params.id, body);
    reply.status(201).send(participant);
  });

  app.post("/collections/:id/participants/add-child", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addChildSchema.parse(request.body);
    const participant = store.addChild(user.id, params.id, body);
    reply.status(201).send(participant);
  });

  app.post("/collections/:id/participants/:participantId/set-responsible-payer", async (request) => {
    const user = requireUser(request, store);
    const params = participantParamsSchema.parse(request.params);
    const body = z.object({ responsiblePayerParticipantId: z.string().nullable() }).parse(request.body);
    return store.setResponsiblePayer(user.id, params.id, params.participantId, body.responsiblePayerParticipantId);
  });

  app.get("/collections/:id/expenses", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.listExpenses(user.id, params.id);
  });

  app.post("/collections/:id/expenses", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createExpenseSchema.parse(request.body);
    const result = store.createExpense(user.id, params.id, body);
    reply.status(201).send(result);
  });

  app.post("/expenses/:id/payments", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addPaymentSchema.parse(request.body);
    const payment = store.addExpensePayment(user.id, params.id, body);
    reply.status(201).send(payment);
  });

  app.post("/expenses/:id/share-rules", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addShareRuleSchema.parse(request.body);
    const rule = store.addShareRule(user.id, params.id, body);
    reply.status(201).send(rule);
  });

  app.post("/collections/:id/calculate", async (request, reply) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const version = store.calculateCollection(user.id, params.id);
    reply.status(201).send(version);
  });

  app.get("/collections/:id/calculations/latest", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.getLatestCalculation(user.id, params.id);
  });

  app.get("/collections/:id/transfer-plan", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.getLatestCalculation(user.id, params.id).result.transferPlan;
  });

  app.get("/collections/:id/responsible-payer-summary", async (request) => {
    const user = requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return store.getLatestCalculation(user.id, params.id).result.responsiblePayerCalculations;
  });
}

function updateCollectionStatus(request: FastifyRequest, store: InMemoryStore, status: Collection["status"]) {
  const user = requireUser(request, store);
  const params = idParamsSchema.parse(request.params);
  return store.updateCollectionStatus(user.id, params.id, status);
}
