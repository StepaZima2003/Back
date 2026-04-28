import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Notification } from "../domain";
import type { AppStore } from "./appStore";
import { InMemoryStore } from "./inMemoryStore";

type PrismaMirrorClient = Pick<
  PrismaClient,
  | "auditLog"
  | "calculationVersion"
  | "collection"
  | "collectionParticipant"
  | "collectionTemplate"
  | "dispute"
  | "expense"
  | "expenseCategory"
  | "expensePayment"
  | "expenseShareRule"
  | "friendship"
  | "group"
  | "groupMember"
  | "manualPaymentProof"
  | "notification"
  | "participantCalculation"
  | "responsiblePayerCalculation"
  | "transferPlan"
  | "user"
>;

export class PrismaMirrorStore implements AppStore {
  private readonly memory = new InMemoryStore();

  constructor(private readonly client: PrismaMirrorClient) {}

  requestOtp(phone: string) {
    return this.memory.requestOtp(phone);
  }

  async verifyOtp(phone: string, otp: string) {
    const result = this.memory.verifyOtp(phone, otp);
    await this.upsertUser(result.user);
    return result;
  }

  authenticate(accessToken: string | undefined) {
    return this.memory.authenticate(accessToken);
  }

  getUser(userId: string) {
    return this.memory.getUser(userId);
  }

  async updateUser(userId: string, patch: Parameters<InMemoryStore["updateUser"]>[1]) {
    const user = this.memory.updateUser(userId, patch);
    await this.upsertUser(user);
    return user;
  }

  listFriends(userId: string) {
    return this.memory.listFriends(userId);
  }

  async inviteFriend(userId: string, phone: string) {
    const friendship = this.memory.inviteFriend(userId, phone);
    await this.client.friendship.upsert({
      where: { id: friendship.id },
      update: {
        userId: friendship.userId,
        friendId: friendship.friendId,
        status: friendship.status,
        createdAt: asDate(friendship.createdAt)
      },
      create: {
        id: friendship.id,
        userId: friendship.userId,
        friendId: friendship.friendId,
        status: friendship.status,
        createdAt: asDate(friendship.createdAt)
      }
    });
    return friendship;
  }

  async acceptFriendship(userId: string, friendshipId: string) {
    const friendship = this.memory.acceptFriendship(userId, friendshipId);
    await this.client.friendship.upsert({
      where: { id: friendship.id },
      update: { status: friendship.status },
      create: {
        id: friendship.id,
        userId: friendship.userId,
        friendId: friendship.friendId,
        status: friendship.status,
        createdAt: asDate(friendship.createdAt)
      }
    });
    return friendship;
  }

  async declineFriendship(userId: string, friendshipId: string) {
    const friendship = this.memory.listFriends(userId).find((candidate) => candidate.id === friendshipId);
    this.memory.declineFriendship(userId, friendshipId);
    if (friendship) {
      await this.client.friendship.deleteMany({
        where: { id: friendship.id }
      });
    }
  }

  listGroups(userId: string) {
    return this.memory.listGroups(userId);
  }

  async createGroup(userId: string, data: Parameters<InMemoryStore["createGroup"]>[1]) {
    const group = this.memory.createGroup(userId, data);
    await this.client.group.create({
      data: {
        id: group.id,
        title: group.title,
        emoji: group.emoji,
        ownerId: group.ownerId,
        visibility: group.visibility,
        groupType: group.groupType,
        createdAt: asDate(group.createdAt),
        updatedAt: asDate(group.updatedAt),
        members: {
          create: {
            userId: group.ownerId,
            role: "owner",
            status: "active",
            joinedAt: asDate(group.createdAt)
          }
        }
      }
    });
    return group;
  }

  async addGroupMember(actorUserId: string, groupId: string, userId: string) {
    const member = this.memory.addGroupMember(actorUserId, groupId, userId);
    await this.client.groupMember.upsert({
      where: {
        groupId_userId: {
          groupId: member.groupId,
          userId: member.userId
        }
      },
      update: {
        role: member.role,
        status: member.status,
        joinedAt: asDate(member.joinedAt)
      },
      create: {
        id: member.id,
        groupId: member.groupId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        joinedAt: asDate(member.joinedAt)
      }
    });
    return member;
  }

  async createCollection(userId: string, data: Parameters<InMemoryStore["createCollection"]>[1]) {
    const result = this.memory.createCollection(userId, data);
    await this.syncCollectionState(result.collection.id);
    return result;
  }

  listCollections(userId: string) {
    return this.memory.listCollections(userId);
  }

  getCollectionForUser(userId: string, collectionId: string) {
    return this.memory.getCollectionForUser(userId, collectionId);
  }

  async updateCollectionStatus(userId: string, collectionId: string, status: Parameters<InMemoryStore["updateCollectionStatus"]>[2]) {
    const collection = this.memory.updateCollectionStatus(userId, collectionId, status);
    await this.syncCollectionState(collectionId);
    return collection;
  }

  listParticipants(userId: string, collectionId: string) {
    return this.memory.listParticipants(userId, collectionId);
  }

  async addParticipant(userId: string, collectionId: string, data: Parameters<InMemoryStore["addParticipant"]>[2]) {
    const participant = this.memory.addParticipant(userId, collectionId, data);
    await this.syncCollectionState(collectionId);
    return participant;
  }

  async addGuest(userId: string, collectionId: string, data: Parameters<InMemoryStore["addGuest"]>[2]) {
    const participant = this.memory.addGuest(userId, collectionId, data);
    await this.syncCollectionState(collectionId);
    return participant;
  }

  async addChild(userId: string, collectionId: string, data: Parameters<InMemoryStore["addChild"]>[2]) {
    const participant = this.memory.addChild(userId, collectionId, data);
    await this.syncCollectionState(collectionId);
    return participant;
  }

  async setResponsiblePayer(
    userId: string,
    collectionId: string,
    participantId: string,
    responsiblePayerParticipantId: string | null
  ) {
    const participant = this.memory.setResponsiblePayer(userId, collectionId, participantId, responsiblePayerParticipantId);
    await this.syncCollectionState(collectionId);
    return participant;
  }

  listExpenses(userId: string, collectionId: string) {
    return this.memory.listExpenses(userId, collectionId);
  }

  listCategories(userId: string, collectionId: string) {
    return this.memory.listCategories(userId, collectionId);
  }

  async createCategory(userId: string, collectionId: string, data: Parameters<InMemoryStore["createCategory"]>[2]) {
    const category = this.memory.createCategory(userId, collectionId, data);
    await this.syncCollectionState(collectionId);
    return category;
  }

  async createExpense(userId: string, collectionId: string, data: Parameters<InMemoryStore["createExpense"]>[2]) {
    const result = this.memory.createExpense(userId, collectionId, data);
    await this.syncCollectionState(collectionId);
    return result;
  }

  async addExpensePayment(userId: string, expenseId: string, data: Parameters<InMemoryStore["addExpensePayment"]>[2]) {
    const payment = this.memory.addExpensePayment(userId, expenseId, data);
    const expense = this.memory.debugGetExpense(payment.expenseId);
    await this.syncCollectionState(expense.collectionId);
    return payment;
  }

  async addShareRule(userId: string, expenseId: string, data: Parameters<InMemoryStore["addShareRule"]>[2]) {
    const rule = this.memory.addShareRule(userId, expenseId, data);
    const expense = this.memory.debugGetExpense(rule.expenseId);
    await this.syncCollectionState(expense.collectionId);
    return rule;
  }

  async calculateCollection(userId: string, collectionId: string) {
    const version = this.memory.calculateCollection(userId, collectionId);
    await this.syncCollectionState(collectionId);
    return version;
  }

  getLatestCalculation(userId: string, collectionId: string) {
    return this.memory.getLatestCalculation(userId, collectionId);
  }

  async confirmParticipantReview(userId: string, collectionId: string, participantId: string) {
    const participant = this.memory.confirmParticipantReview(userId, collectionId, participantId);
    await this.syncCollectionState(collectionId);
    return participant;
  }

  async createDispute(userId: string, collectionId: string, data: Parameters<InMemoryStore["createDispute"]>[2]) {
    const dispute = this.memory.createDispute(userId, collectionId, data);
    await this.syncCollectionState(collectionId);
    return dispute;
  }

  listDisputes(userId: string, collectionId: string) {
    return this.memory.listDisputes(userId, collectionId);
  }

  async acceptDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    const dispute = this.memory.acceptDispute(userId, disputeId, resolutionComment);
    await this.syncCollectionState(dispute.collectionId);
    return dispute;
  }

  async rejectDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    const dispute = this.memory.rejectDispute(userId, disputeId, resolutionComment);
    await this.syncCollectionState(dispute.collectionId);
    return dispute;
  }

  async resolveDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    const result = this.memory.resolveDispute(userId, disputeId, resolutionComment);
    await this.syncCollectionState(result.dispute.collectionId);
    return result;
  }

  async markManualPaymentPaid(userId: string, collectionId: string, data: Parameters<InMemoryStore["markManualPaymentPaid"]>[2]) {
    const proof = this.memory.markManualPaymentPaid(userId, collectionId, data);
    await this.syncCollectionState(collectionId);
    return proof;
  }

  async uploadManualPaymentProof(userId: string, proofId: string, data: Parameters<InMemoryStore["uploadManualPaymentProof"]>[2]) {
    const proof = this.memory.uploadManualPaymentProof(userId, proofId, data);
    await this.syncCollectionState(proof.collectionId);
    return proof;
  }

  async confirmManualPayment(userId: string, proofId: string) {
    const proof = this.memory.confirmManualPayment(userId, proofId);
    await this.syncCollectionState(proof.collectionId);
    return proof;
  }

  async rejectManualPayment(userId: string, proofId: string) {
    const proof = this.memory.rejectManualPayment(userId, proofId);
    await this.syncCollectionState(proof.collectionId);
    return proof;
  }

  listManualPayments(userId: string, collectionId: string) {
    return this.memory.listManualPayments(userId, collectionId);
  }

  listAuditLogs(userId: string, collectionId: string) {
    return this.memory.listAuditLogs(userId, collectionId);
  }

  listGroupTemplates(userId: string, groupId: string) {
    return this.memory.listGroupTemplates(userId, groupId);
  }

  async createGroupTemplate(userId: string, groupId: string, data: Parameters<InMemoryStore["createGroupTemplate"]>[2]) {
    const template = this.memory.createGroupTemplate(userId, groupId, data);
    await this.client.collectionTemplate.create({
      data: {
        id: template.id,
        groupId: template.groupId,
        ownerUserId: template.ownerUserId,
        title: template.title,
        collectionType: template.collectionType,
        paymentMode: template.paymentMode,
        createdAt: asDate(template.createdAt),
        updatedAt: asDate(template.updatedAt),
        categories: {
          create: template.categories.map((category) => ({
            id: category.id,
            title: category.title,
            emoji: category.emoji,
            requiresManualConfirmation: category.requiresManualConfirmation,
            autopayAllowedByDefault: category.autopayAllowedByDefault,
            sortOrder: category.sortOrder
          }))
        }
      }
    });
    return template;
  }

  listNotifications(userId: string) {
    return this.memory.listNotifications(userId);
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const notification = this.memory.markNotificationRead(userId, notificationId);
    if (notification.collectionId) {
      await this.syncCollectionState(notification.collectionId);
    } else {
      await this.upsertNotification(notification);
    }
    return notification;
  }

  private async syncCollectionState(collectionId: string) {
    const state = this.memory.debugGetCollectionState(collectionId);

    await this.client.collection.upsert({
      where: { id: state.collection.id },
      update: {
        title: state.collection.title,
        type: state.collection.type,
        groupId: state.collection.groupId,
        organizerId: state.collection.organizerId,
        currency: state.collection.currency,
        status: state.collection.status,
        paymentMode: state.collection.paymentMode,
        totalAmountMinor: state.collection.totalAmountMinor,
        reviewDeadlineAt: asOptionalDate(state.collection.reviewDeadlineAt),
        paymentDeadlineAt: asOptionalDate(state.collection.paymentDeadlineAt),
        updatedAt: asDate(state.collection.updatedAt)
      },
      create: {
        id: state.collection.id,
        title: state.collection.title,
        type: state.collection.type,
        groupId: state.collection.groupId,
        organizerId: state.collection.organizerId,
        currency: state.collection.currency,
        status: state.collection.status,
        paymentMode: state.collection.paymentMode,
        totalAmountMinor: state.collection.totalAmountMinor,
        reviewDeadlineAt: asOptionalDate(state.collection.reviewDeadlineAt),
        paymentDeadlineAt: asOptionalDate(state.collection.paymentDeadlineAt),
        createdAt: asDate(state.collection.createdAt),
        updatedAt: asDate(state.collection.updatedAt)
      }
    });

    for (const participant of state.participants) {
      await this.client.collectionParticipant.upsert({
        where: { id: participant.id },
        update: {
          participantType: participant.participantType,
          linkedUserId: participant.linkedUserId,
          invitedPhone: participant.invitedPhone,
          displayNameSnapshot: participant.displayNameSnapshot,
          invitedByUserId: participant.invitedByUserId,
          paymentResponsibleParticipantId: participant.paymentResponsibleParticipantId,
          relationshipHint: participant.relationshipHint,
          defaultWeight: toDecimal(participant.defaultWeight),
          status: participant.status,
          finalShareAmountMinor: participant.finalShareAmountMinor,
          paymentStatus: participant.paymentStatus,
          updatedAt: asDate(participant.updatedAt)
        },
        create: {
          id: participant.id,
          collectionId: participant.collectionId,
          participantType: participant.participantType,
          linkedUserId: participant.linkedUserId,
          invitedPhone: participant.invitedPhone,
          displayNameSnapshot: participant.displayNameSnapshot,
          invitedByUserId: participant.invitedByUserId,
          paymentResponsibleParticipantId: participant.paymentResponsibleParticipantId,
          relationshipHint: participant.relationshipHint,
          defaultWeight: toDecimal(participant.defaultWeight),
          status: participant.status,
          finalShareAmountMinor: participant.finalShareAmountMinor,
          paymentStatus: participant.paymentStatus,
          createdAt: asDate(participant.createdAt),
          updatedAt: asDate(participant.updatedAt)
        }
      });
    }

    for (const category of state.categories) {
      await this.client.expenseCategory.upsert({
        where: { id: category.id },
        update: {
          title: category.title,
          emoji: category.emoji,
          requiresManualConfirmation: category.requiresManualConfirmation,
          autopayAllowedByDefault: category.autopayAllowedByDefault
        },
        create: {
          id: category.id,
          collectionId: category.collectionId,
          title: category.title,
          emoji: category.emoji,
          requiresManualConfirmation: category.requiresManualConfirmation,
          autopayAllowedByDefault: category.autopayAllowedByDefault,
          createdAt: asDate(category.createdAt)
        }
      });
    }

    for (const expense of state.expenses) {
      const primaryPayment = state.expensePayments.find((payment) => payment.expenseId === expense.id);
      await this.client.expense.upsert({
        where: { id: expense.id },
        update: {
          title: expense.title,
          amountMinor: expense.amountMinor,
          currency: expense.currency,
          expenseType: expense.expenseType,
          primaryPaidByParticipantId: primaryPayment?.paidByParticipantId ?? null,
          categoryId: expense.categoryId,
          receiptUrl: expense.receiptUrl,
          comment: expense.comment,
          updatedAt: asDate(expense.updatedAt)
        },
        create: {
          id: expense.id,
          collectionId: expense.collectionId,
          title: expense.title,
          amountMinor: expense.amountMinor,
          currency: expense.currency,
          expenseType: expense.expenseType,
          primaryPaidByParticipantId: primaryPayment?.paidByParticipantId ?? null,
          categoryId: expense.categoryId,
          receiptUrl: expense.receiptUrl,
          comment: expense.comment,
          createdAt: asDate(expense.createdAt),
          updatedAt: asDate(expense.updatedAt)
        }
      });
    }

    for (const payment of state.expensePayments) {
      await this.client.expensePayment.upsert({
        where: { id: payment.id },
        update: {
          paidByParticipantId: payment.paidByParticipantId,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          paymentSource: payment.paymentSource,
          comment: payment.comment
        },
        create: {
          id: payment.id,
          expenseId: payment.expenseId,
          paidByParticipantId: payment.paidByParticipantId,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          paymentSource: payment.paymentSource,
          comment: payment.comment,
          createdAt: asDate(payment.createdAt)
        }
      });
    }

    for (const rule of state.shareRules) {
      await this.client.expenseShareRule.upsert({
        where: { id: rule.id },
        update: {
          expenseId: rule.expenseId,
          expenseItemId: rule.expenseItemId,
          categoryId: rule.categoryId,
          participantId: rule.participantId,
          splitMode: rule.splitMode,
          weight: asOptionalDecimal(rule.weight),
          fixedAmountMinor: rule.fixedAmountMinor ?? null,
          percent: asOptionalDecimal(rule.percent),
          capAmountMinor: rule.capAmountMinor ?? null,
          excluded: rule.excluded ?? false,
          reason: rule.reason ?? null
        },
        create: {
          id: rule.id,
          expenseId: rule.expenseId,
          expenseItemId: rule.expenseItemId,
          categoryId: rule.categoryId,
          participantId: rule.participantId,
          splitMode: rule.splitMode,
          weight: asOptionalDecimal(rule.weight),
          fixedAmountMinor: rule.fixedAmountMinor ?? null,
          percent: asOptionalDecimal(rule.percent),
          capAmountMinor: rule.capAmountMinor ?? null,
          excluded: rule.excluded ?? false,
          reason: rule.reason ?? null
        }
      });
    }

    for (const version of state.calculationVersions) {
      await this.client.calculationVersion.upsert({
        where: { id: version.id },
        update: {
          version: version.version,
          status: version.status,
          totalAmountMinor: version.totalAmountMinor,
          createdByUserId: version.createdByUserId,
          result: asJson(version.result)
        },
        create: {
          id: version.id,
          collectionId: version.collectionId,
          version: version.version,
          status: version.status,
          totalAmountMinor: version.totalAmountMinor,
          createdByUserId: version.createdByUserId,
          result: asJson(version.result),
          createdAt: asDate(version.createdAt)
        }
      });

      await this.client.participantCalculation.deleteMany({
        where: { calculationVersionId: version.id }
      });
      if (version.result.participantCalculations.length > 0) {
        await this.client.participantCalculation.createMany({
          data: version.result.participantCalculations.map((item) => ({
            id: stableUuid(`${version.id}:participant:${item.participantId}`),
            calculationVersionId: version.id,
            participantId: item.participantId,
            paymentResponsibleParticipantId: item.responsiblePayerId,
            owesAmountMinor: item.owesAmountMinor,
            paidAmountMinor: item.paidAmountMinor,
            netBalanceMinor: item.netBalanceMinor,
            explanation: asJson(item.explanation)
          }))
        });
      }

      await this.client.responsiblePayerCalculation.deleteMany({
        where: { calculationVersionId: version.id }
      });
      if (version.result.responsiblePayerCalculations.length > 0) {
        await this.client.responsiblePayerCalculation.createMany({
          data: version.result.responsiblePayerCalculations.map((item) => ({
            id: stableUuid(`${version.id}:responsible:${item.responsiblePayerId}`),
            calculationVersionId: version.id,
            responsibleUserId: state.participants.find((participant) => participant.id === item.responsiblePayerId)?.linkedUserId ?? null,
            responsibleParticipantId: item.responsiblePayerId,
            totalOwesAmountMinor: item.totalOwesAmountMinor,
            totalPaidAmountMinor: item.totalPaidAmountMinor,
            netBalanceMinor: item.netBalanceMinor,
            coveredParticipantIds: item.coveredParticipantIds,
            explanationSummary: asJson(item.explanationSummary)
          }))
        });
      }

      await this.client.transferPlan.deleteMany({
        where: { calculationVersionId: version.id }
      });
      if (version.result.transferPlan.length > 0) {
        await this.client.transferPlan.createMany({
          data: version.result.transferPlan.map((item, index) => ({
            id: stableUuid(`${version.id}:transfer:${index}:${item.fromResponsiblePayerId}:${item.toResponsiblePayerId}:${item.amountMinor}`),
            calculationVersionId: version.id,
            fromResponsibleParticipantId: item.fromResponsiblePayerId,
            toResponsibleParticipantId: item.toResponsiblePayerId,
            amountMinor: item.amountMinor,
            status: item.status,
            confirmationRequiredBy: item.confirmationRequiredBy,
            confirmedByUserId: null,
            proofUrl: null,
            comment: null
          }))
        });
      }
    }

    for (const dispute of state.disputes) {
      await this.client.dispute.upsert({
        where: { id: dispute.id },
        update: {
          participantId: dispute.participantId,
          createdByUserId: dispute.createdByUserId,
          targetParticipantId: dispute.targetParticipantId,
          type: dispute.type,
          message: dispute.message,
          status: dispute.status,
          resolutionComment: dispute.resolutionComment,
          resolvedAt: asOptionalDate(dispute.resolvedAt)
        },
        create: {
          id: dispute.id,
          collectionId: dispute.collectionId,
          participantId: dispute.participantId,
          createdByUserId: dispute.createdByUserId,
          targetParticipantId: dispute.targetParticipantId,
          type: dispute.type,
          message: dispute.message,
          status: dispute.status,
          resolutionComment: dispute.resolutionComment,
          createdAt: asDate(dispute.createdAt),
          resolvedAt: asOptionalDate(dispute.resolvedAt)
        }
      });
    }

    for (const proof of state.manualPaymentProofs) {
      await this.client.manualPaymentProof.upsert({
        where: { id: proof.id },
        update: {
          transferPlanId: proof.transferPlanId,
          payerUserId: proof.payerUserId,
          payerParticipantId: proof.payerParticipantId,
          receiverUserId: proof.receiverUserId,
          receiverParticipantId: proof.receiverParticipantId,
          amountMinor: proof.amountMinor,
          method: proof.method,
          comment: proof.comment,
          proofUrl: proof.proofUrl,
          status: proof.status,
          updatedAt: asDate(proof.updatedAt)
        },
        create: {
          id: proof.id,
          transferPlanId: proof.transferPlanId,
          collectionId: proof.collectionId,
          payerUserId: proof.payerUserId,
          payerParticipantId: proof.payerParticipantId,
          receiverUserId: proof.receiverUserId,
          receiverParticipantId: proof.receiverParticipantId,
          amountMinor: proof.amountMinor,
          method: proof.method,
          comment: proof.comment,
          proofUrl: proof.proofUrl,
          status: proof.status,
          createdAt: asDate(proof.createdAt),
          updatedAt: asDate(proof.updatedAt)
        }
      });
    }

    for (const log of state.auditLogs) {
      await this.client.auditLog.upsert({
        where: { id: log.id },
        update: {
          actorUserId: log.actorUserId,
          entityType: log.entityType,
          entityId: log.entityId,
          action: log.action,
          metadata: asJson(log.metadata),
          ipAddress: log.ipAddress,
          userAgent: log.userAgent
        },
        create: {
          id: log.id,
          actorUserId: log.actorUserId,
          entityType: log.entityType,
          entityId: log.entityId,
          collectionId: log.collectionId,
          action: log.action,
          metadata: asJson(log.metadata),
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          createdAt: asDate(log.createdAt)
        }
      });
    }

    for (const notification of state.notifications) {
      await this.upsertNotification(notification);
    }
  }

  private async upsertNotification(notification: Notification) {
    await this.client.notification.upsert({
      where: { id: notification.id },
      update: {
        userId: notification.userId,
        collectionId: notification.collectionId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        status: notification.status,
        readAt: asOptionalDate(notification.readAt)
      },
      create: {
        id: notification.id,
        userId: notification.userId,
        collectionId: notification.collectionId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        status: notification.status,
        createdAt: asDate(notification.createdAt),
        readAt: asOptionalDate(notification.readAt)
      }
    });
  }

  private async upsertUser(user: ReturnType<InMemoryStore["getUser"]>) {
    await this.client.user.upsert({
      where: { id: user.id },
      update: {
        phone: user.phone,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        verificationLevel: user.verificationLevel,
        updatedAt: asDate(user.updatedAt)
      },
      create: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        verificationLevel: user.verificationLevel,
        createdAt: asDate(user.createdAt),
        updatedAt: asDate(user.updatedAt)
      }
    });
  }
}

function asDate(value: string): Date {
  return new Date(value);
}

function asOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function asOptionalDecimal(value: number | null | undefined): Prisma.Decimal | null {
  return value === null || value === undefined ? null : new Prisma.Decimal(value.toString());
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stableUuid(key: string): string {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}
