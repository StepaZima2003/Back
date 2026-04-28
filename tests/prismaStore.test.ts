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
      expense: { upsert: async () => undefined },
      expensePayment: { upsert: async () => undefined },
      expenseShareRule: { upsert: async () => undefined },
      calculationVersion: { upsert: async () => undefined },
      participantCalculation: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
      responsiblePayerCalculation: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
      transferPlan: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
      dispute: { upsert: async () => undefined },
      manualPaymentProof: { upsert: async () => undefined },
      auditLog: { upsert: async () => undefined, findMany: async () => [] },
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
});
