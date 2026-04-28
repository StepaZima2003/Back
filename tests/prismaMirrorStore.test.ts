import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaMirrorStore } from "../src/store";

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  const mock = {
    auditLog: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([])
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
      upsert: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([])
    },
    expensePayment: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    expenseShareRule: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    friendship: {
      upsert: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([])
    },
    group: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([])
    },
    groupMember: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([])
    },
    collection: {
      create: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([])
    },
    collectionParticipant: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    collectionTemplate: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([])
    },
    expenseCategory: {
      create: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    manualPaymentProof: {
      upsert: vi.fn().mockResolvedValue(undefined)
    },
    notification: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([])
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
  return { ...mock, ...overrides };
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

  it("hydrates persisted state from Prisma into memory on startup", async () => {
    const createdAt = new Date("2026-04-28T00:00:00.000Z");
    const updatedAt = new Date("2026-04-28T01:00:00.000Z");
    const organizerId = "11111111-1111-1111-1111-111111111111";
    const participantUserId = "22222222-2222-2222-2222-222222222222";
    const groupId = "33333333-3333-3333-3333-333333333333";
    const collectionId = "44444444-4444-4444-4444-444444444444";
    const organizerParticipantId = "55555555-5555-5555-5555-555555555555";
    const participantId = "66666666-6666-6666-6666-666666666666";
    const templateId = "77777777-7777-7777-7777-777777777777";
    const calculationVersionId = "88888888-8888-8888-8888-888888888888";
    const manualPaymentId = "99999999-9999-9999-9999-999999999999";
    const disputeId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const notificationId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const prisma = createMockPrisma({
      user: {
        upsert: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([
          {
            id: organizerId,
            phone: "+79990000201",
            displayName: "Organizer",
            avatarUrl: null,
            status: "active",
            verificationLevel: "phone",
            createdAt,
            updatedAt
          },
          {
            id: participantUserId,
            phone: "+79990000202",
            displayName: "Friend",
            avatarUrl: null,
            status: "active",
            verificationLevel: "phone",
            createdAt,
            updatedAt
          }
        ])
      },
      friendship: {
        upsert: vi.fn().mockResolvedValue(undefined),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "friendship-1",
            userId: organizerId,
            friendId: participantUserId,
            status: "accepted",
            createdAt
          }
        ])
      },
      group: {
        create: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([
          {
            id: groupId,
            title: "Trip",
            emoji: null,
            ownerId: organizerId,
            visibility: "private",
            groupType: "trip",
            createdAt,
            updatedAt
          }
        ])
      },
      groupMember: {
        upsert: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "member-1",
            groupId,
            userId: organizerId,
            role: "owner",
            status: "active",
            joinedAt: createdAt
          },
          {
            id: "member-2",
            groupId,
            userId: participantUserId,
            role: "member",
            status: "active",
            joinedAt: createdAt
          }
        ])
      },
      collectionTemplate: {
        create: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([
          {
            id: templateId,
            groupId,
            ownerUserId: organizerId,
            title: "Trip template",
            collectionType: "trip",
            paymentMode: "manual",
            createdAt,
            updatedAt,
            categories: [
              {
                id: "template-category-1",
                templateId,
                title: "Transport",
                emoji: "🚗",
                requiresManualConfirmation: false,
                autopayAllowedByDefault: true,
                sortOrder: 0
              }
            ]
          }
        ])
      },
      collection: {
        create: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([
          {
            id: collectionId,
            title: "Demo trip",
            type: "trip",
            groupId,
            organizerId,
            currency: "RUB",
            status: "review",
            paymentMode: "manual",
            totalAmountMinor: 10000,
            reviewDeadlineAt: null,
            paymentDeadlineAt: null,
            createdAt,
            updatedAt,
            participants: [
              {
                id: organizerParticipantId,
                collectionId,
                participantType: "registered_user",
                linkedUserId: organizerId,
                invitedPhone: "+79990000201",
                displayNameSnapshot: "Organizer",
                invitedByUserId: organizerId,
                paymentResponsibleParticipantId: null,
                relationshipHint: "self",
                defaultWeight: new Prisma.Decimal("1"),
                status: "active",
                finalShareAmountMinor: 5000,
                paymentStatus: "pending",
                createdAt,
                updatedAt
              },
              {
                id: participantId,
                collectionId,
                participantType: "registered_user",
                linkedUserId: participantUserId,
                invitedPhone: "+79990000202",
                displayNameSnapshot: "Friend",
                invitedByUserId: organizerId,
                paymentResponsibleParticipantId: null,
                relationshipHint: "other",
                defaultWeight: new Prisma.Decimal("1"),
                status: "confirmed",
                finalShareAmountMinor: 5000,
                paymentStatus: "manual_marked_paid",
                createdAt,
                updatedAt
              }
            ],
            categories: [
              {
                id: "category-1",
                collectionId,
                title: "Stay",
                emoji: "🏨",
                requiresManualConfirmation: false,
                autopayAllowedByDefault: true,
                createdAt
              }
            ],
            expenses: [
              {
                id: "expense-1",
                collectionId,
                title: "Hotel",
                amountMinor: 10000,
                currency: "RUB",
                expenseType: "expense",
                categoryId: "category-1",
                receiptUrl: null,
                comment: null,
                createdAt,
                updatedAt,
                payments: [
                  {
                    id: "payment-1",
                    expenseId: "expense-1",
                    paidByParticipantId: organizerParticipantId,
                    amountMinor: 10000,
                    currency: "RUB",
                    paymentSource: "card",
                    comment: null,
                    createdAt
                  }
                ],
                shareRules: []
              }
            ],
            calculationVersions: [
              {
                id: calculationVersionId,
                collectionId,
                version: 1,
                status: "draft",
                totalAmountMinor: 10000,
                createdByUserId: organizerId,
                createdAt,
                result: {
                  collectionId,
                  currency: "RUB",
                  totalAmountMinor: 10000,
                  participantCalculations: [
                    {
                      participantId: organizerParticipantId,
                      displayName: "Organizer",
                      responsiblePayerId: organizerParticipantId,
                      owesAmountMinor: 5000,
                      paidAmountMinor: 10000,
                      netBalanceMinor: 5000,
                      explanation: { included: [], excluded: [] }
                    },
                    {
                      participantId,
                      displayName: "Friend",
                      responsiblePayerId: participantId,
                      owesAmountMinor: 5000,
                      paidAmountMinor: 0,
                      netBalanceMinor: -5000,
                      explanation: { included: [], excluded: [] }
                    }
                  ],
                  responsiblePayerCalculations: [
                    {
                      responsiblePayerId: organizerParticipantId,
                      totalOwesAmountMinor: 5000,
                      totalPaidAmountMinor: 10000,
                      netBalanceMinor: 5000,
                      coveredParticipantIds: [organizerParticipantId],
                      explanationSummary: { "expense-1": 5000 }
                    },
                    {
                      responsiblePayerId: participantId,
                      totalOwesAmountMinor: 5000,
                      totalPaidAmountMinor: 0,
                      netBalanceMinor: -5000,
                      coveredParticipantIds: [participantId],
                      explanationSummary: { "expense-1": 5000 }
                    }
                  ],
                  transferPlan: [
                    {
                      fromResponsiblePayerId: participantId,
                      toResponsiblePayerId: organizerParticipantId,
                      amountMinor: 5000,
                      status: "pending",
                      confirmationRequiredBy: "recipient"
                    }
                  ],
                  warnings: []
                }
              }
            ],
            disputes: [
              {
                id: disputeId,
                collectionId,
                participantId,
                createdByUserId: participantUserId,
                targetParticipantId: null,
                type: "partial_time",
                message: "Joined later",
                status: "resolved_by_recalculation",
                resolutionComment: "Adjusted",
                createdAt,
                resolvedAt: updatedAt
              }
            ],
            manualPaymentProofs: [
              {
                id: manualPaymentId,
                transferPlanId: null,
                collectionId,
                payerUserId: participantUserId,
                payerParticipantId: participantId,
                receiverUserId: organizerId,
                receiverParticipantId: organizerParticipantId,
                amountMinor: 5000,
                method: "sbp",
                comment: "Paid",
                proofUrl: null,
                status: "confirmed",
                createdAt,
                updatedAt
              }
            ],
            auditLogs: [
              {
                id: "audit-1",
                actorUserId: organizerId,
                entityType: "collection",
                entityId: collectionId,
                collectionId,
                action: "recalculated",
                metadata: { calculationVersionId },
                ipAddress: null,
                userAgent: null,
                createdAt
              }
            ],
            notifications: [
              {
                id: notificationId,
                userId: participantUserId,
                collectionId,
                type: "collection_review_requested",
                title: "Review requested",
                body: "Please review",
                status: "unread",
                createdAt,
                readAt: null
              }
            ]
          }
        ])
      },
      notification: {
        upsert: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([
          {
            id: notificationId,
            userId: participantUserId,
            collectionId,
            type: "collection_review_requested",
            title: "Review requested",
            body: "Please review",
            status: "unread",
            createdAt,
            readAt: null
          }
        ])
      }
    });

    const store = await PrismaMirrorStore.create(prisma as never);

    const organizerCollections = await store.listCollections(organizerId);
    expect(organizerCollections).toHaveLength(1);
    expect(organizerCollections[0]?.id).toBe(collectionId);

    const latestCalculation = await store.getLatestCalculation(organizerId, collectionId);
    expect(latestCalculation.version).toBe(1);
    expect(latestCalculation.result.transferPlan).toHaveLength(1);

    const templates = await store.listGroupTemplates(organizerId, groupId);
    expect(templates).toHaveLength(1);
    expect(templates[0]?.id).toBe(templateId);

    const notifications = await store.listNotifications(participantUserId);
    expect(notifications.some((notification) => notification.id === notificationId)).toBe(true);

    const auth = await store.verifyOtp("+79990000201", "000000");
    expect(auth.user.id).toBe(organizerId);
    expect(prisma.user.upsert).toHaveBeenCalled();
  });
});
