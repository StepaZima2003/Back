import { describe, expect, it } from "vitest";
import { PrismaStore } from "../src/store";

function createSharedPrismaState() {
  const state = {
    users: [] as Array<Record<string, unknown>>,
    friendships: [] as Array<Record<string, unknown>>,
    groups: [] as Array<Record<string, unknown>>,
    groupMembers: [] as Array<Record<string, unknown>>,
    templates: [] as Array<Record<string, unknown>>,
    collections: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>
  };

  return {
    state,
    client: {
      user: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.users.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.users.push({ ...create });
          return create;
        },
        findMany: async () => state.users
      },
      friendship: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.friendships.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.friendships.push({ ...create });
          return create;
        },
        deleteMany: async ({ where }: { where: { id: string } }) => {
          const before = state.friendships.length;
          state.friendships = state.friendships.filter((item) => item.id !== where.id);
          return { count: before - state.friendships.length };
        },
        findMany: async () => state.friendships
      },
      group: {
        create: async ({ data }: { data: Record<string, unknown> & { members?: { create?: Record<string, unknown> } } }) => {
          state.groups.push({
            ...data,
            members: undefined
          });
          if (data.members?.create) {
            state.groupMembers.push({
              id: data.members.create.id ?? `${data.id}-owner`,
              groupId: data.id,
              ...data.members.create
            });
          }
          return data;
        },
        findMany: async () => state.groups
      },
      groupMember: {
        upsert: async ({
          where,
          create,
          update
        }: {
          where: { groupId_userId: { groupId: string; userId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = state.groupMembers.find(
            (item) => item.groupId === where.groupId_userId.groupId && item.userId === where.groupId_userId.userId
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.groupMembers.push({ ...create });
          return create;
        },
        findMany: async () => state.groupMembers
      },
      collectionTemplate: {
        create: async ({ data }: { data: Record<string, unknown> & { categories?: { create?: Array<Record<string, unknown>> } } }) => {
          state.templates.push({
            ...data,
            categories: data.categories?.create ?? []
          });
          return data;
        },
        findMany: async () => state.templates
      },
      collection: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.collections.push({
            ...data,
            participants: [],
            categories: [],
            expenses: [],
            calculationVersions: [],
            disputes: [],
            manualPaymentProofs: [],
            auditLogs: [],
            notifications: []
          });
          return data;
        },
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.collections.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.collections.push({
            ...create,
            participants: [],
            categories: [],
            expenses: [],
            calculationVersions: [],
            disputes: [],
            manualPaymentProofs: [],
            auditLogs: [],
            notifications: []
          });
          return create;
        },
        findMany: async () => state.collections
      },
      collectionParticipant: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection = state.collections.find((item) => item.id === create.collectionId || item.id === update.collectionId);
          if (!collection) {
            return create;
          }
          const participants = (collection.participants as Array<Record<string, unknown>>) ?? [];
          const existing = participants.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            collection.participants = participants;
            return existing;
          }
          participants.push({ ...create });
          collection.participants = participants;
          return create;
        }
      },
      expenseCategory: {
        create: async ({ data }: { data: Record<string, unknown> }) => data,
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection = state.collections.find((item) => item.id === create.collectionId);
          if (!collection) {
            return create;
          }
          const categories = (collection.categories as Array<Record<string, unknown>>) ?? [];
          const existing = categories.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            collection.categories = categories;
            return existing;
          }
          categories.push({ ...create });
          collection.categories = categories;
          return create;
        }
      },
      expense: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection =
            state.collections.find((item) => item.id === create.collectionId) ??
            state.collections.find((item) => (item.expenses as Array<Record<string, unknown>>).some((expense) => expense.id === where.id));
          if (!collection) {
            return create;
          }
          const expenses = (collection.expenses as Array<Record<string, unknown>>) ?? [];
          const existing = expenses.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            collection.expenses = expenses;
            return existing;
          }
          expenses.push({ ...create, payments: [], shareRules: [] });
          collection.expenses = expenses;
          return create;
        }
      },
      expensePayment: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          for (const collection of state.collections) {
            const expenses = (collection.expenses as Array<Record<string, unknown>>) ?? [];
            const expense = expenses.find((item) => item.id === create.expenseId || item.id === update.expenseId);
            if (!expense) {
              continue;
            }
            const payments = (expense.payments as Array<Record<string, unknown>>) ?? [];
            const existing = payments.find((item) => item.id === where.id);
            if (existing) {
              Object.assign(existing, update);
              expense.payments = payments;
              return existing;
            }
            payments.push({ ...create });
            expense.payments = payments;
            return create;
          }
          return create;
        }
      },
      expenseShareRule: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          for (const collection of state.collections) {
            const expenses = (collection.expenses as Array<Record<string, unknown>>) ?? [];
            const expense = expenses.find((item) => item.id === create.expenseId || item.id === update.expenseId);
            if (!expense) {
              continue;
            }
            const shareRules = (expense.shareRules as Array<Record<string, unknown>>) ?? [];
            const existing = shareRules.find((item) => item.id === where.id);
            if (existing) {
              Object.assign(existing, update);
              expense.shareRules = shareRules;
              return existing;
            }
            shareRules.push({ ...create });
            expense.shareRules = shareRules;
            return create;
          }
          return create;
        }
      },
      calculationVersion: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection =
            state.collections.find((item) => item.id === create.collectionId) ??
            state.collections.find((item) =>
              ((item.calculationVersions as Array<Record<string, unknown>> | undefined) ?? []).some((version) => version.id === where.id)
            );
          if (!collection) {
            return create;
          }
          const versions = (collection.calculationVersions as Array<Record<string, unknown>>) ?? [];
          const existing = versions.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            collection.calculationVersions = versions;
            return existing;
          }
          versions.push({ participantCalculations: [], responsiblePayerCalculations: [], transferPlan: [], ...create });
          collection.calculationVersions = versions;
          return create;
        },
        findMany: async () =>
          state.collections.flatMap((collection) => (collection.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [])
      },
      participantCalculation: {
        deleteMany: async ({ where }: { where: { calculationVersionId: string } }) => {
          for (const collection of state.collections) {
            const versions = (collection.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [];
            const version = versions.find((item) => item.id === where.calculationVersionId);
            if (version) {
              const before = ((version.participantCalculations as Array<Record<string, unknown>> | undefined) ?? []).length;
              version.participantCalculations = [];
              return { count: before };
            }
          }
          return { count: 0 };
        },
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          let count = 0;
          for (const row of data) {
            for (const collection of state.collections) {
              const versions = (collection.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [];
              const version = versions.find((item) => item.id === row.calculationVersionId);
              if (!version) {
                continue;
              }
              const rows = (version.participantCalculations as Array<Record<string, unknown>>) ?? [];
              rows.push({ ...row });
              version.participantCalculations = rows;
              count += 1;
            }
          }
          return { count };
        }
      },
      responsiblePayerCalculation: {
        deleteMany: async ({ where }: { where: { calculationVersionId: string } }) => {
          for (const collection of state.collections) {
            const versions = (collection.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [];
            const version = versions.find((item) => item.id === where.calculationVersionId);
            if (version) {
              const before = ((version.responsiblePayerCalculations as Array<Record<string, unknown>> | undefined) ?? []).length;
              version.responsiblePayerCalculations = [];
              return { count: before };
            }
          }
          return { count: 0 };
        },
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          let count = 0;
          for (const row of data) {
            for (const collection of state.collections) {
              const versions = (collection.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [];
              const version = versions.find((item) => item.id === row.calculationVersionId);
              if (!version) {
                continue;
              }
              const rows = (version.responsiblePayerCalculations as Array<Record<string, unknown>>) ?? [];
              rows.push({ ...row });
              version.responsiblePayerCalculations = rows;
              count += 1;
            }
          }
          return { count };
        }
      },
      transferPlan: {
        deleteMany: async ({ where }: { where: { calculationVersionId: string } }) => {
          for (const collection of state.collections) {
            const versions = (collection.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [];
            const version = versions.find((item) => item.id === where.calculationVersionId);
            if (version) {
              const before = ((version.transferPlan as Array<Record<string, unknown>> | undefined) ?? []).length;
              version.transferPlan = [];
              return { count: before };
            }
          }
          return { count: 0 };
        },
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          let count = 0;
          for (const row of data) {
            for (const collection of state.collections) {
              const versions = (collection.calculationVersions as Array<Record<string, unknown>> | undefined) ?? [];
              const version = versions.find((item) => item.id === row.calculationVersionId);
              if (!version) {
                continue;
              }
              const rows = (version.transferPlan as Array<Record<string, unknown>>) ?? [];
              rows.push({ ...row });
              version.transferPlan = rows;
              count += 1;
            }
          }
          return { count };
        }
      },
      dispute: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection =
            state.collections.find((item) => item.id === create.collectionId) ??
            state.collections.find((item) => ((item.disputes as Array<Record<string, unknown>> | undefined) ?? []).some((dispute) => dispute.id === where.id));
          if (!collection) {
            return create;
          }
          const disputes = (collection.disputes as Array<Record<string, unknown>>) ?? [];
          const existing = disputes.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            collection.disputes = disputes;
            return existing;
          }
          disputes.push({ ...create });
          collection.disputes = disputes;
          return create;
        },
        findMany: async () => state.collections.flatMap((collection) => (collection.disputes as Array<Record<string, unknown>> | undefined) ?? [])
      },
      manualPaymentProof: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection =
            state.collections.find((item) => item.id === create.collectionId) ??
            state.collections.find((item) =>
              ((item.manualPaymentProofs as Array<Record<string, unknown>> | undefined) ?? []).some((proof) => proof.id === where.id)
            );
          if (!collection) {
            return create;
          }
          const proofs = (collection.manualPaymentProofs as Array<Record<string, unknown>>) ?? [];
          const existing = proofs.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            collection.manualPaymentProofs = proofs;
            return existing;
          }
          proofs.push({ ...create });
          collection.manualPaymentProofs = proofs;
          return create;
        },
        findMany: async () =>
          state.collections.flatMap((collection) => (collection.manualPaymentProofs as Array<Record<string, unknown>> | undefined) ?? [])
      },
      auditLog: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection =
            state.collections.find((item) => item.id === create.collectionId) ??
            state.collections.find((item) => ((item.auditLogs as Array<Record<string, unknown>> | undefined) ?? []).some((log) => log.id === where.id));
          if (!collection) {
            return create;
          }
          const logs = (collection.auditLogs as Array<Record<string, unknown>>) ?? [];
          const existing = logs.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            collection.auditLogs = logs;
            return existing;
          }
          logs.push({ ...create });
          collection.auditLogs = logs;
          return create;
        },
        findMany: async () => state.collections.flatMap((collection) => (collection.auditLogs as Array<Record<string, unknown>> | undefined) ?? [])
      },
      notification: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.notifications.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.notifications.push({ ...create });
          return create;
        },
        findMany: async () => state.notifications
      }
    }
  };
}

describe("PrismaStore", () => {
  it("reloads persisted state before operations so a second instance sees the first instance writes", async () => {
    const shared = createSharedPrismaState();
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
    const shared = createSharedPrismaState();
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
    const shared = createSharedPrismaState();
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
