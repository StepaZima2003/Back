import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../authContext";
import type { Collection, Expense, ExpensePayment } from "../../domain";
import type { AppStore } from "../../store";

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
  paymentMode: z.enum(["manual", "confirm_each", "auto_for_trusted", "calculation_only"]).optional(),
  templateId: z.string().nullable().optional()
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

const createExpenseItemSchema = z.object({
  title: z.string().min(1).max(160),
  amountMinor: z.number().int().nonnegative(),
  categoryId: z.string().nullable().optional(),
  splitMode: z.enum(["equal", "weights", "fixed", "percent", "excluded", "cap"]).optional()
});

const createExpenseSchema = z.object({
  title: z.string().min(1).max(160),
  amountMinor: z.number().int().nonnegative(),
  categoryId: z.string().nullable().optional(),
  expenseType: z.enum(["expense", "prepayment", "deposit", "refund", "discount", "correction", "service_fee", "tax", "other"]).optional(),
  comment: z.string().nullable().optional(),
  items: z.array(createExpenseItemSchema).optional(),
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
  expenseItemId: z.string().nullable().optional(),
  splitMode: z.enum(["equal", "weights", "fixed", "percent", "excluded", "cap"]),
  categoryId: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
  fixedAmountMinor: z.number().int().nonnegative().nullable().optional(),
  percent: z.number().min(0).max(100).nullable().optional(),
  capAmountMinor: z.number().int().nonnegative().nullable().optional(),
  excluded: z.boolean().nullable().optional(),
  reason: z.string().nullable().optional()
});

const createDisputeSchema = z.object({
  participantId: z.string(),
  targetParticipantId: z.string().nullable().optional(),
  type: z.enum(["not_eat", "not_drink", "partial_time", "already_paid", "bought_something", "absent", "guest_absent", "payer_changed", "other"]),
  message: z.string().min(1).max(1000)
});

const disputeResolutionSchema = z.object({
  resolutionComment: z.string().nullable().optional()
});

const markManualPaymentSchema = z.object({
  payerParticipantId: z.string().nullable().optional(),
  receiverParticipantId: z.string().nullable().optional(),
  amountMinor: z.number().int().positive(),
  method: z.enum(["sbp", "cash", "card", "other"]),
  comment: z.string().nullable().optional(),
  proofUrl: z.string().url().nullable().optional(),
  transferPlanId: z.string().nullable().optional()
});

const uploadManualPaymentProofSchema = z.object({
  proofUrl: z.string().url().nullable().optional(),
  comment: z.string().nullable().optional()
});

const createCategorySchema = z.object({
  title: z.string().min(1).max(80),
  emoji: z.string().nullable().optional(),
  requiresManualConfirmation: z.boolean().optional(),
  autopayAllowedByDefault: z.boolean().optional()
});

export function registerCollectionRoutes(app: FastifyInstance, store: AppStore): void {
  app.get("/collections", async (request) => {
    const user = await requireUser(request, store);
    return await store.listCollections(user.id);
  });

  app.post("/collections", async (request, reply) => {
    const user = await requireUser(request, store);
    const body = createCollectionSchema.parse(request.body);
    const result = await store.createCollection(user.id, body);
    reply.status(201).send(result);
  });

  app.get("/collections/:id", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.getCollectionForUser(user.id, params.id);
  });

  app.get("/collections/:id/categories", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listCategories(user.id, params.id);
  });

  app.post("/collections/:id/categories", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createCategorySchema.parse(request.body);
    const category = await store.createCategory(user.id, params.id, body);
    reply.status(201).send(category);
  });

  app.post("/collections/:id/send-to-review", async (request) => updateCollectionStatus(request, store, "review"));
  app.post("/collections/:id/finalize", async (request) => updateCollectionStatus(request, store, "finalized"));
  app.post("/collections/:id/cancel", async (request) => updateCollectionStatus(request, store, "cancelled"));
  app.post("/collections/:id/close", async (request) => updateCollectionStatus(request, store, "closed"));

  app.get("/collections/:id/participants", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listParticipants(user.id, params.id);
  });

  app.post("/collections/:id/participants", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addParticipantSchema.parse(request.body);
    const participant = await store.addParticipant(user.id, params.id, body);
    reply.status(201).send(participant);
  });

  app.post("/collections/:id/participants/add-guest", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addGuestSchema.parse(request.body);
    const participant = await store.addGuest(user.id, params.id, body);
    reply.status(201).send(participant);
  });

  app.post("/collections/:id/participants/add-child", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addChildSchema.parse(request.body);
    const participant = await store.addChild(user.id, params.id, body);
    reply.status(201).send(participant);
  });

  app.post("/collections/:id/participants/:participantId/set-responsible-payer", async (request) => {
    const user = await requireUser(request, store);
    const params = participantParamsSchema.parse(request.params);
    const body = z.object({ responsiblePayerParticipantId: z.string().nullable() }).parse(request.body);
    return await store.setResponsiblePayer(user.id, params.id, params.participantId, body.responsiblePayerParticipantId);
  });

  app.post("/collections/:id/participants/:participantId/confirm-review", async (request) => {
    const user = await requireUser(request, store);
    const params = participantParamsSchema.parse(request.params);
    return await store.confirmParticipantReview(user.id, params.id, params.participantId);
  });

  app.get("/collections/:id/expenses", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listExpenses(user.id, params.id);
  });

  app.post("/collections/:id/expenses", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createExpenseSchema.parse(request.body);
    const result = await store.createExpense(user.id, params.id, body);
    reply.status(201).send(result);
  });

  app.get("/expenses/:id/items", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listExpenseItems(user.id, params.id);
  });

  app.post("/expenses/:id/items", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createExpenseItemSchema.parse(request.body);
    const item = await store.createExpenseItem(user.id, params.id, body);
    reply.status(201).send(item);
  });

  app.post("/expenses/:id/payments", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addPaymentSchema.parse(request.body);
    const payment = await store.addExpensePayment(user.id, params.id, body);
    reply.status(201).send(payment);
  });

  app.post("/expenses/:id/share-rules", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = addShareRuleSchema.parse(request.body);
    const rule = await store.addShareRule(user.id, params.id, body);
    reply.status(201).send(rule);
  });

  app.post("/collections/:id/calculate", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const version = await store.calculateCollection(user.id, params.id);
    reply.status(201).send(version);
  });

  app.get("/collections/:id/calculations/latest", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.getLatestCalculation(user.id, params.id);
  });

  app.get("/collections/:id/transfer-plan", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return (await store.getLatestCalculation(user.id, params.id)).result.transferPlan;
  });

  app.get("/collections/:id/responsible-payer-summary", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return (await store.getLatestCalculation(user.id, params.id)).result.responsiblePayerCalculations;
  });

  app.post("/collections/:id/disputes", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = createDisputeSchema.parse(request.body);
    const dispute = await store.createDispute(user.id, params.id, body);
    reply.status(201).send(dispute);
  });

  app.get("/collections/:id/disputes", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listDisputes(user.id, params.id);
  });

  app.post("/disputes/:id/accept", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = disputeResolutionSchema.parse(request.body ?? {});
    return await store.acceptDispute(user.id, params.id, body.resolutionComment);
  });

  app.post("/disputes/:id/reject", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = disputeResolutionSchema.parse(request.body ?? {});
    return await store.rejectDispute(user.id, params.id, body.resolutionComment);
  });

  app.post("/disputes/:id/resolve", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = disputeResolutionSchema.parse(request.body ?? {});
    return await store.resolveDispute(user.id, params.id, body.resolutionComment);
  });

  app.post("/collections/:id/manual-payments/mark-paid", async (request, reply) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = markManualPaymentSchema.parse(request.body);
    const proof = await store.markManualPaymentPaid(user.id, params.id, body);
    reply.status(201).send(proof);
  });

  app.get("/collections/:id/manual-payments", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listManualPayments(user.id, params.id);
  });

  app.post("/manual-payments/:id/upload-proof", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    const body = uploadManualPaymentProofSchema.parse(request.body);
    return await store.uploadManualPaymentProof(user.id, params.id, body);
  });

  app.post("/manual-payments/:id/confirm", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.confirmManualPayment(user.id, params.id);
  });

  app.post("/manual-payments/:id/reject", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.rejectManualPayment(user.id, params.id);
  });

  app.get("/collections/:id/audit-log", async (request) => {
    const user = await requireUser(request, store);
    const params = idParamsSchema.parse(request.params);
    return await store.listAuditLogs(user.id, params.id);
  });
}

async function updateCollectionStatus(request: FastifyRequest, store: AppStore, status: Collection["status"]) {
  const user = await requireUser(request, store);
  const params = idParamsSchema.parse(request.params);
  return await store.updateCollectionStatus(user.id, params.id, status);
}
