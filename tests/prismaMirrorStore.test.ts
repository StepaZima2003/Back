import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaMirrorStore } from "../src/store";

function createMockPrisma() {
  return {
    auditLog: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    calculationVersion: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    dispute: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    expense: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    user: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    expensePayment: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    expenseShareRule: {
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
      create: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    collectionParticipant: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    collectionTemplate: {
      create: vi.fn().mockResolvedValue(undefined)
    },
    expenseCategory: {
      create: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    manualPaymentProof: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    notification: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    participantCalculation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    responsiblePayerCalculation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    transferPlan: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 })
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
    expect(prisma.collection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: result.collection.id },
        create: expect.objectContaining({
          id: result.collection.id,
          title: "Saturday BBQ"
        })
      })
    );
    expect(prisma.collectionParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: result.organizerParticipant.id }
      })
    );
    expect(prisma.expenseCategory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ collectionId: result.collection.id })
      })
    );
  });

  it("mirrors expenses, calculations, disputes, manual payments, audit log, and notifications", async () => {
    const prisma = createMockPrisma();
    const store = new PrismaMirrorStore(prisma as never);

    store.requestOtp("+79990000121");
    const organizer = await store.verifyOtp("+79990000121", "000000");
    store.requestOtp("+79990000122");
    const participantUser = await store.verifyOtp("+79990000122", "000000");

    const group = await store.createGroup(organizer.user.id, {
      title: "Trip",
      groupType: "trip"
    });
    const collectionResult = await store.createCollection(organizer.user.id, {
      title: "Demo trip",
      groupId: group.id,
      type: "trip"
    });
    const participant = await store.addParticipant(organizer.user.id, collectionResult.collection.id, {
      linkedUserId: participantUser.user.id,
      displayName: "Friend"
    });
    await store.createExpense(organizer.user.id, collectionResult.collection.id, {
      title: "Hotel",
      amountMinor: 10000,
      payments: [{ paidByParticipantId: collectionResult.organizerParticipant.id, amountMinor: 10000 }]
    });
    await store.calculateCollection(organizer.user.id, collectionResult.collection.id);
    await store.updateCollectionStatus(organizer.user.id, collectionResult.collection.id, "review");
    await store.confirmParticipantReview(participantUser.user.id, collectionResult.collection.id, participant.id);
    const dispute = await store.createDispute(participantUser.user.id, collectionResult.collection.id, {
      participantId: participant.id,
      type: "partial_time",
      message: "Joined for half only"
    });
    await store.resolveDispute(organizer.user.id, dispute.id, "Recalculated");
    const proof = await store.markManualPaymentPaid(participantUser.user.id, collectionResult.collection.id, {
      payerParticipantId: participant.id,
      receiverParticipantId: collectionResult.organizerParticipant.id,
      amountMinor: 5000,
      method: "sbp",
      comment: "Paid"
    });
    await store.confirmManualPayment(organizer.user.id, proof.id);

    expect(prisma.expense.upsert).toHaveBeenCalled();
    expect(prisma.expensePayment.upsert).toHaveBeenCalled();
    expect(prisma.calculationVersion.upsert).toHaveBeenCalled();
    expect(prisma.participantCalculation.createMany).toHaveBeenCalled();
    expect(prisma.responsiblePayerCalculation.createMany).toHaveBeenCalled();
    expect(prisma.transferPlan.createMany).toHaveBeenCalled();
    expect(prisma.dispute.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: dispute.id }
      })
    );
    expect(prisma.manualPaymentProof.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: proof.id }
      })
    );
    expect(prisma.auditLog.upsert).toHaveBeenCalled();
    expect(prisma.notification.upsert).toHaveBeenCalled();
  });
});
