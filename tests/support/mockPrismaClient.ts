export function createSharedMockPrismaClient() {
  const state = {
    users: [] as Array<Record<string, unknown>>,
    paymentMethods: [] as Array<Record<string, unknown>>,
    friendships: [] as Array<Record<string, unknown>>,
    groups: [] as Array<Record<string, unknown>>,
    groupMembers: [] as Array<Record<string, unknown>>,
    groupParticipantProfiles: [] as Array<Record<string, unknown>>,
    templates: [] as Array<Record<string, unknown>>,
    collections: [] as Array<Record<string, unknown>>,
    payments: [] as Array<Record<string, unknown>>,
    paymentWebhookEvents: [] as Array<Record<string, unknown>>,
    autoPaymentRules: [] as Array<Record<string, unknown>>,
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
      paymentMethod: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.paymentMethods.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.paymentMethods.push({ ...create });
          return create;
        },
        findMany: async () => state.paymentMethods
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
      groupParticipantProfile: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.groupParticipantProfiles.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.groupParticipantProfiles.push({ ...create });
          return create;
        },
        findMany: async () => state.groupParticipantProfiles
      },
      collectionTemplate: {
        create: async ({
          data
        }: {
          data: Record<string, unknown> & { categories?: { create?: Array<Record<string, unknown>> } };
        }) => {
          const template = {
            ...data,
            categories: data.categories?.create ?? []
          };
          state.templates.push(template);
          return template;
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
        },
        findMany: async () =>
          state.collections.flatMap((collection) => (collection.participants as Array<Record<string, unknown>> | undefined) ?? [])
      },
      payment: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.payments.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.payments.push({ ...create });
          return create;
        },
        findMany: async () => state.payments
      },
      paymentWebhookEvent: {
        upsert: async ({
          where,
          create,
          update
        }: {
          where: { externalEventId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = state.paymentWebhookEvents.find((item) => item.externalEventId === where.externalEventId);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.paymentWebhookEvents.push({ ...create });
          return create;
        },
        findMany: async () => state.paymentWebhookEvents
      },
      autoPaymentRule: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = state.autoPaymentRules.find((item) => item.id === where.id);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.autoPaymentRules.push({ ...create });
          return create;
        },
        findMany: async () => state.autoPaymentRules
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
        },
        findMany: async () =>
          state.collections.flatMap((collection) => (collection.categories as Array<Record<string, unknown>> | undefined) ?? [])
      },
      expense: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const collection =
            state.collections.find((item) => item.id === create.collectionId) ??
            state.collections.find((item) => ((item.expenses as Array<Record<string, unknown>> | undefined) ?? []).some((expense) => expense.id === where.id));
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
          expenses.push({ ...create, items: [], payments: [], shareRules: [] });
          collection.expenses = expenses;
          return create;
        }
      },
      expenseItem: {
        upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          for (const collection of state.collections) {
            const expenses = (collection.expenses as Array<Record<string, unknown>>) ?? [];
            const expense = expenses.find((item) => item.id === create.expenseId || item.id === update.expenseId);
            if (!expense) {
              continue;
            }
            const items = (expense.items as Array<Record<string, unknown>>) ?? [];
            const existing = items.find((item) => item.id === where.id);
            if (existing) {
              Object.assign(existing, update);
              expense.items = items;
              return existing;
            }
            items.push({ ...create });
            expense.items = items;
            return create;
          }
          return create;
        },
        findMany: async () =>
          state.collections.flatMap((collection) =>
            ((collection.expenses as Array<Record<string, unknown>> | undefined) ?? []).flatMap(
              (expense) => (expense.items as Array<Record<string, unknown>> | undefined) ?? []
            )
          )
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
