import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaMirrorStore } from "../src/store";

function createMockPrisma() {
  return {
    user: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    friendship: {
      upsert: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    group: {
      create: vi.fn().mockResolvedValue(undefined)
    },
    groupMember: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    collection: {
      create: vi.fn().mockResolvedValue(undefined)
    },
    collectionParticipant: {},
    collectionTemplate: {
      create: vi.fn().mockResolvedValue(undefined)
    },
    expenseCategory: {
      create: vi.fn().mockResolvedValue(undefined)
    }
  };
}

describe("PrismaMirrorStore", () => {
  beforeEach(() => {
    delete process.env.STORE_PROVIDER;
  });

  it("mirrors OTP auth user creation into Prisma", async () => {
    const prisma = createMockPrisma();
    const store = new PrismaMirrorStore(prisma as never);

    store.requestOtp("+79990000111");
    const auth = await store.verifyOtp("+79990000111", "000000");

    expect(auth.user.phone).toBe("+79990000111");
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: auth.user.id },
        create: expect.objectContaining({
          phone: "+79990000111",
          displayName: expect.stringContaining("0111")
        })
      })
    );
  });

  it("mirrors group template creation and collection bootstrap into Prisma", async () => {
    const prisma = createMockPrisma();
    const store = new PrismaMirrorStore(prisma as never);

    store.requestOtp("+79990000112");
    const auth = await store.verifyOtp("+79990000112", "000000");
    const group = await store.createGroup(auth.user.id, {
      title: "Weekend",
      groupType: "friends"
    });

    const template = await store.createGroupTemplate(auth.user.id, group.id, {
      title: "BBQ",
      collectionType: "picnic",
      categories: [
        { title: "Food", emoji: "🍖" },
        { title: "Alcohol", emoji: "🍺", requiresManualConfirmation: true }
      ]
    });

    const result = await store.createCollection(auth.user.id, {
      title: "Saturday BBQ",
      groupId: group.id,
      templateId: template.id
    });

    expect(prisma.group.create).toHaveBeenCalledTimes(1);
    expect(prisma.collectionTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: template.id,
          categories: {
            create: expect.arrayContaining([
              expect.objectContaining({ title: "Food" }),
              expect.objectContaining({ title: "Alcohol", requiresManualConfirmation: true })
            ])
          }
        })
      })
    );
    expect(prisma.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: result.collection.id,
          title: "Saturday BBQ",
          participants: {
            create: expect.objectContaining({
              id: result.organizerParticipant.id,
              linkedUserId: auth.user.id
            })
          },
          categories: {
            create: expect.arrayContaining([
              expect.objectContaining({ title: "Food" }),
              expect.objectContaining({ title: "Alcohol" })
            ])
          }
        })
      })
    );
  });
});
