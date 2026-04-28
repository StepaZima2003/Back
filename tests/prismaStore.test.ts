import { describe, expect, it } from "vitest";
import { PrismaStore } from "../src/store";
import { createSharedMockPrismaClient } from "./support/mockPrismaClient";

describe("PrismaStore", () => {
  it("reloads persisted state before operations so a second instance sees the first instance writes", async () => {
    const shared = createSharedMockPrismaClient();
    const writer = await PrismaStore.create(shared.client as never);
    const reader = await PrismaStore.create(shared.client as never);

    writer.requestOtp("+79990000301");
    const auth = await writer.verifyOtp("+79990000301", "000000");
    const group = await writer.createGroup(auth.user.id, {
      title: "Weekend",
      groupType: "friends"
    });
    await writer.createCollection(auth.user.id, {
      title: "Trip",
      groupId: group.id,
      type: "trip"
    });

    const persistedUser = await reader.getUser(auth.user.id);
    expect(persistedUser.id).toBe(auth.user.id);

    const collections = await reader.listCollections(auth.user.id);
    expect(collections).toHaveLength(1);
    expect(collections[0]?.title).toBe("Trip");
  });

  it("persists expenses and share rules through direct Prisma path", async () => {
    const shared = createSharedMockPrismaClient();
    const writer = await PrismaStore.create(shared.client as never);
    const reader = await PrismaStore.create(shared.client as never);

    writer.requestOtp("+79990000311");
    const auth = await writer.verifyOtp("+79990000311", "000000");
    const group = await writer.createGroup(auth.user.id, {
      title: "Trip",
      groupType: "trip"
    });
    const collectionResult = await writer.createCollection(auth.user.id, {
      title: "Trip",
      groupId: group.id,
      type: "trip"
    });

    const category = await writer.createCategory(auth.user.id, collectionResult.collection.id, {
      title: "Stay"
    });

    const expenseResult = await writer.createExpense(auth.user.id, collectionResult.collection.id, {
      title: "Hotel",
      amountMinor: 10000,
      categoryId: category.id,
      payments: [{ paidByParticipantId: collectionResult.organizerParticipant.id, amountMinor: 10000, paymentSource: "card" }]
    });

    const rule = await writer.addShareRule(auth.user.id, expenseResult.expense.id, {
      participantId: collectionResult.organizerParticipant.id,
      splitMode: "equal"
    });

    const expenses = await reader.listExpenses(auth.user.id, collectionResult.collection.id);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.title).toBe("Hotel");

    const storedCollection = shared.state.collections[0];
    const storedExpense = (storedCollection?.expenses as Array<Record<string, unknown>> | undefined)?.[0];
    expect(storedExpense?.id).toBe(expenseResult.expense.id);
    expect((storedExpense?.payments as Array<Record<string, unknown>> | undefined)?.length).toBe(1);
    expect((storedExpense?.shareRules as Array<Record<string, unknown>> | undefined)?.[0]?.id).toBe(rule.id);
  });

  it("persists calculations, disputes, manual payments and audit logs through direct Prisma path", async () => {
    const shared = createSharedMockPrismaClient();
    const organizerStore = await PrismaStore.create(shared.client as never);
    const participantStore = await PrismaStore.create(shared.client as never);
    const reader = await PrismaStore.create(shared.client as never);

    organizerStore.requestOtp("+79990000401");
    const organizerAuth = await organizerStore.verifyOtp("+79990000401", "000000");

    participantStore.requestOtp("+79990000402");
    const participantAuth = await participantStore.verifyOtp("+79990000402", "000000");

    const group = await organizerStore.createGroup(organizerAuth.user.id, {
      title: "Trip",
      groupType: "trip"
    });
    const collectionResult = await organizerStore.createCollection(organizerAuth.user.id, {
      title: "Big trip",
      groupId: group.id,
      type: "trip"
    });
    const participant = await organizerStore.addParticipant(organizerAuth.user.id, collectionResult.collection.id, {
      linkedUserId: participantAuth.user.id
    });
    const category = await organizerStore.createCategory(organizerAuth.user.id, collectionResult.collection.id, {
      title: "Food"
    });
    const expenseResult = await organizerStore.createExpense(organizerAuth.user.id, collectionResult.collection.id, {
      title: "Dinner",
      amountMinor: 10000,
      categoryId: category.id,
      payments: [{ paidByParticipantId: collectionResult.organizerParticipant.id, amountMinor: 10000, paymentSource: "card" }]
    });

    await organizerStore.addShareRule(organizerAuth.user.id, expenseResult.expense.id, {
      participantId: collectionResult.organizerParticipant.id,
      splitMode: "equal"
    });
    await organizerStore.addShareRule(organizerAuth.user.id, expenseResult.expense.id, {
      participantId: participant.id,
      splitMode: "equal"
    });

    const initialCalculation = await organizerStore.calculateCollection(organizerAuth.user.id, collectionResult.collection.id);
    expect(initialCalculation.version).toBe(1);

    const dispute = await participantStore.createDispute(participantAuth.user.id, collectionResult.collection.id, {
      participantId: participant.id,
      type: "not_eat",
      message: "I should not pay full share"
    });

    const resolved = await organizerStore.resolveDispute(organizerAuth.user.id, dispute.id, "Recalculated after review");
    expect(resolved.calculationVersion.version).toBe(2);

    const latestCalculation = await reader.getLatestCalculation(organizerAuth.user.id, collectionResult.collection.id);
    expect(latestCalculation.version).toBe(2);

    const proof = await participantStore.markManualPaymentPaid(participantAuth.user.id, collectionResult.collection.id, {
      payerParticipantId: participant.id,
      receiverParticipantId: collectionResult.organizerParticipant.id,
      amountMinor: 5000,
      method: "sbp",
      transferPlanId: latestCalculation.result.transferPlan[0]?.fromResponsiblePayerId ? "plan-1" : null
    });

    await organizerStore.confirmManualPayment(organizerAuth.user.id, proof.id);

    const manualPayments = await reader.listManualPayments(organizerAuth.user.id, collectionResult.collection.id);
    expect(manualPayments).toHaveLength(1);
    expect(manualPayments[0]?.status).toBe("confirmed");

    const disputes = await reader.listDisputes(organizerAuth.user.id, collectionResult.collection.id);
    expect(disputes).toHaveLength(1);
    expect(disputes[0]?.status).toBe("resolved_by_recalculation");

    const auditLogs = await reader.listAuditLogs(organizerAuth.user.id, collectionResult.collection.id);
    expect(auditLogs.length).toBeGreaterThanOrEqual(5);

    const storedCollection = shared.state.collections[0];
    const storedVersions = (storedCollection?.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [];
    expect(storedVersions).toHaveLength(2);
    expect(storedVersions[0]?.status).toBe("superseded");
    expect(((storedCollection?.manualPaymentProofs as Array<Record<string, unknown>> | undefined) ?? [])[0]?.status).toBe("confirmed");
  });
});
