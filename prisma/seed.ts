import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await clearData();

  const organizerId = "11111111-1111-1111-1111-111111111111";
  const friendId = "22222222-2222-2222-2222-222222222222";
  const collectionId = "33333333-3333-3333-3333-333333333333";
  const organizerParticipantId = "44444444-4444-4444-4444-444444444444";
  const friendParticipantId = "55555555-5555-5555-5555-555555555555";
  const childParticipantId = "66666666-6666-6666-6666-666666666666";
  const expenseId = "77777777-7777-7777-7777-777777777777";

  await prisma.user.createMany({
    data: [
      {
        id: organizerId,
        phone: "+79990000001",
        displayName: "Organizer",
        verificationLevel: "phone"
      },
      {
        id: friendId,
        phone: "+79990000002",
        displayName: "Friend",
        verificationLevel: "phone"
      }
    ]
  });

  await prisma.friendship.create({
    data: {
      userId: organizerId,
      friendId,
      status: "accepted"
    }
  });

  await prisma.collection.create({
    data: {
      id: collectionId,
      title: "Demo trip",
      type: "trip",
      organizerId,
      status: "expenses_added",
      paymentMode: "manual",
      totalAmountMinor: 150000
    }
  });

  await prisma.collectionParticipant.createMany({
    data: [
      {
        id: organizerParticipantId,
        collectionId,
        participantType: "registered_user",
        linkedUserId: organizerId,
        invitedPhone: "+79990000001",
        displayNameSnapshot: "Organizer",
        relationshipHint: "self",
        defaultWeight: new Prisma.Decimal("1.0")
      },
      {
        id: friendParticipantId,
        collectionId,
        participantType: "registered_user",
        linkedUserId: friendId,
        invitedPhone: "+79990000002",
        displayNameSnapshot: "Friend",
        relationshipHint: "friend",
        defaultWeight: new Prisma.Decimal("1.0")
      },
      {
        id: childParticipantId,
        collectionId,
        participantType: "child",
        displayNameSnapshot: "Child",
        paymentResponsibleParticipantId: organizerParticipantId,
        relationshipHint: "child",
        defaultWeight: new Prisma.Decimal("0.5")
      }
    ]
  });

  await prisma.expense.create({
    data: {
      id: expenseId,
      collectionId,
      title: "Hotel",
      amountMinor: 150000,
      expenseType: "expense",
      primaryPaidByParticipantId: organizerParticipantId,
      payments: {
        create: {
          paidByParticipantId: organizerParticipantId,
          amountMinor: 150000,
          paymentSource: "card"
        }
      }
    }
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: organizerId,
      collectionId,
      entityType: "collection",
      entityId: collectionId,
      action: "created",
      metadata: { seed: true }
    }
  });
}

async function clearData() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.shareRuleChangeLog.deleteMany(),
    prisma.autoPaymentRule.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.manualPaymentProof.deleteMany(),
    prisma.dispute.deleteMany(),
    prisma.transferPlan.deleteMany(),
    prisma.responsiblePayerCalculation.deleteMany(),
    prisma.participantCalculation.deleteMany(),
    prisma.calculationVersion.deleteMany(),
    prisma.expenseShareRule.deleteMany(),
    prisma.expensePayment.deleteMany(),
    prisma.expenseItem.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.expenseCategory.deleteMany(),
    prisma.collectionParticipant.deleteMany(),
    prisma.collection.deleteMany(),
    prisma.groupMember.deleteMany(),
    prisma.group.deleteMany(),
    prisma.friendship.deleteMany(),
    prisma.paymentMethod.deleteMany(),
    prisma.user.deleteMany()
  ]);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

