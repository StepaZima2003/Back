import { Prisma, PrismaClient } from "@prisma/client";
import type { AppStore } from "./appStore";
import { InMemoryStore } from "./inMemoryStore";

type PrismaMirrorClient = Pick<
  PrismaClient,
  "collection" | "collectionParticipant" | "collectionTemplate" | "expenseCategory" | "friendship" | "group" | "groupMember" | "user"
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
    const categories = this.memory.listCategories(userId, result.collection.id);

    await this.client.collection.create({
      data: {
        id: result.collection.id,
        title: result.collection.title,
        type: result.collection.type,
        groupId: result.collection.groupId,
        organizerId: result.collection.organizerId,
        currency: result.collection.currency,
        status: result.collection.status,
        paymentMode: result.collection.paymentMode,
        totalAmountMinor: result.collection.totalAmountMinor,
        reviewDeadlineAt: asOptionalDate(result.collection.reviewDeadlineAt),
        paymentDeadlineAt: asOptionalDate(result.collection.paymentDeadlineAt),
        createdAt: asDate(result.collection.createdAt),
        updatedAt: asDate(result.collection.updatedAt),
        participants: {
          create: {
            id: result.organizerParticipant.id,
            participantType: result.organizerParticipant.participantType,
            linkedUserId: result.organizerParticipant.linkedUserId,
            invitedPhone: result.organizerParticipant.invitedPhone,
            displayNameSnapshot: result.organizerParticipant.displayNameSnapshot,
            invitedByUserId: result.organizerParticipant.invitedByUserId,
            paymentResponsibleParticipantId: result.organizerParticipant.paymentResponsibleParticipantId,
            relationshipHint: result.organizerParticipant.relationshipHint,
            defaultWeight: toDecimal(result.organizerParticipant.defaultWeight),
            status: result.organizerParticipant.status,
            finalShareAmountMinor: result.organizerParticipant.finalShareAmountMinor,
            paymentStatus: result.organizerParticipant.paymentStatus,
            createdAt: asDate(result.organizerParticipant.createdAt),
            updatedAt: asDate(result.organizerParticipant.updatedAt)
          }
        },
        categories: {
          create: categories.map((category) => ({
            id: category.id,
            title: category.title,
            emoji: category.emoji,
            requiresManualConfirmation: category.requiresManualConfirmation,
            autopayAllowedByDefault: category.autopayAllowedByDefault,
            createdAt: asDate(category.createdAt)
          }))
        }
      }
    });

    return result;
  }

  listCollections(userId: string) {
    return this.memory.listCollections(userId);
  }

  getCollectionForUser(userId: string, collectionId: string) {
    return this.memory.getCollectionForUser(userId, collectionId);
  }

  updateCollectionStatus(userId: string, collectionId: string, status: Parameters<InMemoryStore["updateCollectionStatus"]>[2]) {
    return this.memory.updateCollectionStatus(userId, collectionId, status);
  }

  listParticipants(userId: string, collectionId: string) {
    return this.memory.listParticipants(userId, collectionId);
  }

  addParticipant(userId: string, collectionId: string, data: Parameters<InMemoryStore["addParticipant"]>[2]) {
    return this.memory.addParticipant(userId, collectionId, data);
  }

  addGuest(userId: string, collectionId: string, data: Parameters<InMemoryStore["addGuest"]>[2]) {
    return this.memory.addGuest(userId, collectionId, data);
  }

  addChild(userId: string, collectionId: string, data: Parameters<InMemoryStore["addChild"]>[2]) {
    return this.memory.addChild(userId, collectionId, data);
  }

  setResponsiblePayer(
    userId: string,
    collectionId: string,
    participantId: string,
    responsiblePayerParticipantId: string | null
  ) {
    return this.memory.setResponsiblePayer(userId, collectionId, participantId, responsiblePayerParticipantId);
  }

  listExpenses(userId: string, collectionId: string) {
    return this.memory.listExpenses(userId, collectionId);
  }

  listCategories(userId: string, collectionId: string) {
    return this.memory.listCategories(userId, collectionId);
  }

  async createCategory(userId: string, collectionId: string, data: Parameters<InMemoryStore["createCategory"]>[2]) {
    const category = this.memory.createCategory(userId, collectionId, data);
    await this.client.expenseCategory.create({
      data: {
        id: category.id,
        collectionId: category.collectionId,
        title: category.title,
        emoji: category.emoji,
        requiresManualConfirmation: category.requiresManualConfirmation,
        autopayAllowedByDefault: category.autopayAllowedByDefault,
        createdAt: asDate(category.createdAt)
      }
    });
    return category;
  }

  createExpense(userId: string, collectionId: string, data: Parameters<InMemoryStore["createExpense"]>[2]) {
    return this.memory.createExpense(userId, collectionId, data);
  }

  addExpensePayment(userId: string, expenseId: string, data: Parameters<InMemoryStore["addExpensePayment"]>[2]) {
    return this.memory.addExpensePayment(userId, expenseId, data);
  }

  addShareRule(userId: string, expenseId: string, data: Parameters<InMemoryStore["addShareRule"]>[2]) {
    return this.memory.addShareRule(userId, expenseId, data);
  }

  calculateCollection(userId: string, collectionId: string) {
    return this.memory.calculateCollection(userId, collectionId);
  }

  getLatestCalculation(userId: string, collectionId: string) {
    return this.memory.getLatestCalculation(userId, collectionId);
  }

  confirmParticipantReview(userId: string, collectionId: string, participantId: string) {
    return this.memory.confirmParticipantReview(userId, collectionId, participantId);
  }

  createDispute(userId: string, collectionId: string, data: Parameters<InMemoryStore["createDispute"]>[2]) {
    return this.memory.createDispute(userId, collectionId, data);
  }

  listDisputes(userId: string, collectionId: string) {
    return this.memory.listDisputes(userId, collectionId);
  }

  acceptDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    return this.memory.acceptDispute(userId, disputeId, resolutionComment);
  }

  rejectDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    return this.memory.rejectDispute(userId, disputeId, resolutionComment);
  }

  resolveDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    return this.memory.resolveDispute(userId, disputeId, resolutionComment);
  }

  markManualPaymentPaid(userId: string, collectionId: string, data: Parameters<InMemoryStore["markManualPaymentPaid"]>[2]) {
    return this.memory.markManualPaymentPaid(userId, collectionId, data);
  }

  uploadManualPaymentProof(userId: string, proofId: string, data: Parameters<InMemoryStore["uploadManualPaymentProof"]>[2]) {
    return this.memory.uploadManualPaymentProof(userId, proofId, data);
  }

  confirmManualPayment(userId: string, proofId: string) {
    return this.memory.confirmManualPayment(userId, proofId);
  }

  rejectManualPayment(userId: string, proofId: string) {
    return this.memory.rejectManualPayment(userId, proofId);
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

  markNotificationRead(userId: string, notificationId: string) {
    return this.memory.markNotificationRead(userId, notificationId);
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
