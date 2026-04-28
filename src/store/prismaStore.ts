import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type {
  AuthResult,
  Collection,
  CollectionParticipant,
  CollectionTemplate,
  Expense,
  ExpenseCategory,
  ExpensePayment,
  ExpenseShareRule,
  Friendship,
  Group,
  GroupMember,
  Notification,
  User
} from "../domain";
import type { AppStore } from "./appStore";
import { AppError, DEFAULT_COLLECTION_CATEGORIES } from "./inMemoryStore";
import { PrismaMirrorStore } from "./prismaMirrorStore";

type PrismaStoreClient = ConstructorParameters<typeof PrismaMirrorStore>[0];

export class PrismaStore implements AppStore {
  private readonly otpRequests = new Map<string, string>();

  private constructor(
    private readonly client: PrismaStoreClient,
    private readonly mirror: PrismaMirrorStore
  ) {}

  static async create(client: PrismaStoreClient): Promise<PrismaStore> {
    const mirror = await PrismaMirrorStore.create(client);
    return new PrismaStore(client, mirror);
  }

  requestOtp(phone: string) {
    const otp = "000000";
    this.otpRequests.set(phone, otp);
    return { phone, otp, expiresInSeconds: 300 };
  }

  async verifyOtp(phone: string, otp: string): Promise<AuthResult> {
    const expectedOtp = this.otpRequests.get(phone);
    if (expectedOtp && expectedOtp !== otp) {
      throw new AppError(401, "Invalid OTP.");
    }

    const existingUser = (await this.client.user.findMany()).find((user) => user.phone === phone);
    const user = existingUser
      ? mapUserRecord(existingUser)
      : mapUserRecord(
          await this.client.user.upsert({
            where: { id: randomUUID() },
            update: {},
            create: {
              id: randomUUID(),
              phone,
              displayName: `User ${phone.slice(-4)}`,
              avatarUrl: null,
              status: "active",
              verificationLevel: "phone",
              createdAt: new Date(),
              updatedAt: new Date()
            }
          })
        );

    this.otpRequests.delete(phone);

    return {
      user,
      accessToken: createDevToken(user.id),
      refreshToken: createDevToken(user.id, "refresh")
    };
  }

  async authenticate(accessToken: string | undefined): Promise<User> {
    if (!accessToken) {
      throw new AppError(401, "Missing bearer token.");
    }

    const userId = parseDevToken(accessToken);
    if (!userId) {
      throw new AppError(401, "Invalid bearer token.");
    }

    const user = await this.getUser(userId);
    if (user.status !== "active") {
      throw new AppError(401, "Invalid bearer token.");
    }

    return user;
  }

  async getUser(userId: string): Promise<User> {
    const user = (await this.client.user.findMany()).find((item) => item.id === userId);
    if (!user) {
      throw new AppError(404, "User not found.");
    }
    return mapUserRecord(user);
  }

  async updateUser(userId: string, patch: { displayName?: string; avatarUrl?: string | null }): Promise<User> {
    const current = await this.getUser(userId);
    const updated = await this.client.user.upsert({
      where: { id: userId },
      update: {
        displayName: patch.displayName ?? current.displayName,
        avatarUrl: patch.avatarUrl === undefined ? current.avatarUrl : patch.avatarUrl,
        updatedAt: new Date()
      },
      create: {
        id: current.id,
        phone: current.phone,
        displayName: patch.displayName ?? current.displayName,
        avatarUrl: patch.avatarUrl === undefined ? current.avatarUrl : patch.avatarUrl,
        status: current.status,
        verificationLevel: current.verificationLevel,
        createdAt: new Date(current.createdAt),
        updatedAt: new Date()
      }
    });
    return mapUserRecord(updated);
  }

  async listFriends(userId: string): Promise<Friendship[]> {
    await this.getUser(userId);
    return (await this.client.friendship.findMany())
      .filter((friendship) => friendship.userId === userId || friendship.friendId === userId)
      .map(mapFriendshipRecord);
  }

  async inviteFriend(userId: string, phone: string): Promise<Friendship> {
    const actor = await this.getUser(userId);
    const friend = (await this.client.user.findMany()).find((user) => user.phone === phone);
    const friendUser =
      friend
        ? mapUserRecord(friend)
        : mapUserRecord(
            await this.client.user.upsert({
              where: { id: randomUUID() },
              update: {},
              create: {
                id: randomUUID(),
                phone,
                displayName: `User ${phone.slice(-4)}`,
                avatarUrl: null,
                status: "active",
                verificationLevel: "phone",
                createdAt: new Date(),
                updatedAt: new Date()
              }
            })
          );

    if (friendUser.id === actor.id) {
      throw new AppError(400, "Cannot invite yourself.");
    }

    const existing = (await this.client.friendship.findMany()).find((friendship) => {
      const samePair =
        (friendship.userId === userId && friendship.friendId === friendUser.id) ||
        (friendship.userId === friendUser.id && friendship.friendId === userId);
      return samePair && friendship.status !== "blocked";
    });
    if (existing) {
      return mapFriendshipRecord(existing);
    }

    const created = await this.client.friendship.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        userId,
        friendId: friendUser.id,
        status: "pending",
        createdAt: new Date()
      }
    });
    return mapFriendshipRecord(created);
  }

  async acceptFriendship(userId: string, friendshipId: string): Promise<Friendship> {
    const friendship = await this.getFriendshipForUser(userId, friendshipId);
    const updated = await this.client.friendship.upsert({
      where: { id: friendship.id },
      update: { status: "accepted" },
      create: {
        id: friendship.id,
        userId: friendship.userId,
        friendId: friendship.friendId,
        status: "accepted",
        createdAt: new Date(friendship.createdAt)
      }
    });
    return mapFriendshipRecord(updated);
  }

  async declineFriendship(userId: string, friendshipId: string): Promise<void> {
    await this.getFriendshipForUser(userId, friendshipId);
    await this.client.friendship.deleteMany({ where: { id: friendshipId } });
  }

  async listGroups(userId: string): Promise<Group[]> {
    await this.getUser(userId);
    const memberGroupIds = new Set(
      (await this.client.groupMember.findMany())
        .filter((member) => member.userId === userId && member.status === "active")
        .map((member) => member.groupId)
    );
    return (await this.client.group.findMany())
      .filter((group) => memberGroupIds.has(group.id))
      .map(mapGroupRecord);
  }

  async createGroup(userId: string, data: { title: string; emoji?: string | null; groupType?: Group["groupType"] }): Promise<Group> {
    await this.getUser(userId);
    const now = new Date();
    const groupId = randomUUID();
    const group = await this.client.group.create({
      data: {
        id: groupId,
        title: data.title,
        emoji: data.emoji ?? null,
        ownerId: userId,
        visibility: "private",
        groupType: data.groupType ?? "other",
        createdAt: now,
        updatedAt: now,
        members: {
          create: {
            id: randomUUID(),
            userId,
            role: "owner",
            status: "active",
            joinedAt: now
          }
        }
      }
    });
    return mapGroupRecord(group);
  }

  async addGroupMember(actorUserId: string, groupId: string, userId: string): Promise<GroupMember> {
    const group = await this.getGroupForUser(actorUserId, groupId);
    if (group.ownerId !== actorUserId) {
      throw new AppError(403, "Only group owner can add members in MVP.");
    }
    await this.getUser(userId);

    const existing = (await this.client.groupMember.findMany()).find((member) => member.groupId === groupId && member.userId === userId);
    if (existing) {
      return mapGroupMemberRecord(existing);
    }

    const created = await this.client.groupMember.upsert({
      where: {
        groupId_userId: {
          groupId,
          userId
        }
      },
      update: {
        role: "member",
        status: "active",
        joinedAt: new Date()
      },
      create: {
        id: randomUUID(),
        groupId,
        userId,
        role: "member",
        status: "active",
        joinedAt: new Date()
      }
    });
    return mapGroupMemberRecord(created);
  }

  async createCollection(
    userId: string,
    data: {
      title: string;
      type?: Collection["type"];
      groupId?: string | null;
      paymentMode?: Collection["paymentMode"];
      templateId?: string | null;
    }
  ): Promise<{ collection: Collection; organizerParticipant: CollectionParticipant }> {
    const template = data.templateId ? await this.getCollectionTemplate(data.templateId) : null;
    const targetGroupId = data.groupId ?? template?.groupId ?? null;

    if (targetGroupId) {
      await this.getGroupForUser(userId, targetGroupId);
    }
    if (template && template.ownerUserId !== userId) {
      throw new AppError(403, "Template is not available to this user.");
    }

    const createdAt = new Date();
    const collectionId = randomUUID();
    const collectionType = data.type ?? template?.collectionType ?? "other";
    const paymentMode = data.paymentMode ?? template?.paymentMode ?? "manual";

    const collectionRecord = await this.client.collection.upsert({
      where: { id: collectionId },
      update: {},
      create: {
        id: collectionId,
        title: data.title,
        type: collectionType,
        groupId: targetGroupId,
        organizerId: userId,
        currency: "RUB",
        status: "draft",
        paymentMode,
        totalAmountMinor: 0,
        reviewDeadlineAt: null,
        paymentDeadlineAt: null,
        createdAt,
        updatedAt: createdAt
      }
    });

    const user = await this.getUser(userId);
    const organizerParticipantRecord = await this.client.collectionParticipant.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        collectionId,
        participantType: "registered_user",
        linkedUserId: userId,
        invitedPhone: user.phone,
        displayNameSnapshot: user.displayName,
        invitedByUserId: userId,
        paymentResponsibleParticipantId: null,
        relationshipHint: "self",
        defaultWeight: 1,
        status: "active",
        finalShareAmountMinor: 0,
        paymentStatus: "pending",
        createdAt,
        updatedAt: createdAt
      }
    });

    const categorySeeds =
      template?.categories.map((category) => ({
        title: category.title,
        emoji: category.emoji,
        requiresManualConfirmation: category.requiresManualConfirmation,
        autopayAllowedByDefault: category.autopayAllowedByDefault
      })) ?? DEFAULT_COLLECTION_CATEGORIES[collectionType];

    for (const category of categorySeeds) {
      await this.client.expenseCategory.upsert({
        where: { id: randomUUID() },
        update: {},
        create: {
          id: randomUUID(),
          collectionId,
          title: category.title,
          emoji: category.emoji ?? null,
          requiresManualConfirmation: category.requiresManualConfirmation,
          autopayAllowedByDefault: category.autopayAllowedByDefault,
          createdAt
        }
      });
    }

    return {
      collection: mapCollectionRecord(collectionRecord),
      organizerParticipant: mapParticipantRecord(organizerParticipantRecord)
    };
  }

  async listCollections(userId: string): Promise<Collection[]> {
    await this.getUser(userId);
    const collections = await this.client.collection.findMany({
      include: {
        participants: true
      }
    });

    return collections
      .filter(
        (collection) =>
          collection.organizerId === userId || collection.participants.some((participant) => participant.linkedUserId === userId)
      )
      .map(mapCollectionRecord);
  }

  async getCollectionForUser(userId: string, collectionId: string): Promise<Collection> {
    await this.getUser(userId);
    const collection = await this.getCollectionRecord(collectionId);
    if (collection.organizerId === userId) {
      return mapCollectionRecord(collection);
    }

    const hasAccess = collection.participants.some((participant) => participant.linkedUserId === userId);
    if (!hasAccess) {
      throw new AppError(403, "Collection is not available to this user.");
    }

    return mapCollectionRecord(collection);
  }

  async updateCollectionStatus(userId: string, collectionId: string, status: Collection["status"]): Promise<Collection> {
    const collection = await this.getOrganizerCollectionRecord(userId, collectionId);
    const updated = await this.client.collection.upsert({
      where: { id: collectionId },
      update: {
        status,
        updatedAt: new Date()
      },
      create: collectionCreateInputFromRecord(collection, { status, updatedAt: new Date() })
    });

    if (status === "review") {
      const participants = await this.listParticipants(userId, collectionId);
      const targets = new Set<string>();
      for (const participant of participants) {
        if (participant.linkedUserId) {
          targets.add(participant.linkedUserId);
        }
      }

      for (const targetUserId of targets) {
        await this.client.notification.upsert({
          where: { id: randomUUID() },
          update: {},
          create: {
            id: randomUUID(),
            userId: targetUserId,
            collectionId,
            type: "collection_review_requested",
            title: "Calculation sent to review",
            body: "Organizer sent the collection calculation to review.",
            status: "unread",
            createdAt: new Date(),
            readAt: null
          }
        });
      }
    }

    return mapCollectionRecord(updated);
  }

  async listParticipants(userId: string, collectionId: string): Promise<CollectionParticipant[]> {
    await this.getCollectionForUser(userId, collectionId);
    return (await this.client.collection.findMany({ include: { participants: true } }))
      .find((collection) => collection.id === collectionId)
      ?.participants.map(mapParticipantRecord) ?? [];
  }

  async addParticipant(
    userId: string,
    collectionId: string,
    data: {
      linkedUserId?: string | null;
      invitedPhone?: string | null;
      displayName?: string | null;
      defaultWeight?: number;
      responsiblePayerParticipantId?: string | null;
    }
  ): Promise<CollectionParticipant> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    const linkedUser = data.linkedUserId ? await this.getUser(data.linkedUserId) : null;
    const displayName = data.displayName ?? linkedUser?.displayName ?? data.invitedPhone ?? "Участник";

    const participant = await this.client.collectionParticipant.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        collectionId,
        participantType: linkedUser ? "registered_user" : data.invitedPhone ? "invited_phone" : "external_person",
        linkedUserId: linkedUser?.id ?? null,
        invitedPhone: data.invitedPhone ?? linkedUser?.phone ?? null,
        displayNameSnapshot: displayName,
        invitedByUserId: userId,
        paymentResponsibleParticipantId: data.responsiblePayerParticipantId ?? null,
        relationshipHint: "other",
        defaultWeight: data.defaultWeight ?? 1,
        status: "active",
        finalShareAmountMinor: 0,
        paymentStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await this.bumpCollectionStatus(collectionId, "participants_selected");
    return mapParticipantRecord(participant);
  }

  async addGuest(
    userId: string,
    collectionId: string,
    data: { displayName: string; responsiblePayerParticipantId?: string | null; defaultWeight?: number }
  ): Promise<CollectionParticipant> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    if (data.responsiblePayerParticipantId) {
      await this.getParticipantRecord(collectionId, data.responsiblePayerParticipantId);
    }

    const participant = await this.client.collectionParticipant.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        collectionId,
        participantType: "guest",
        linkedUserId: null,
        invitedPhone: null,
        displayNameSnapshot: data.displayName,
        invitedByUserId: userId,
        paymentResponsibleParticipantId: data.responsiblePayerParticipantId ?? null,
        relationshipHint: "guest",
        defaultWeight: data.defaultWeight ?? 1,
        status: "active",
        finalShareAmountMinor: 0,
        paymentStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await this.bumpCollectionStatus(collectionId, "participants_selected");
    return mapParticipantRecord(participant);
  }

  async addChild(
    userId: string,
    collectionId: string,
    data: { displayName: string; responsiblePayerParticipantId: string; defaultWeight?: number }
  ): Promise<CollectionParticipant> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    await this.getParticipantRecord(collectionId, data.responsiblePayerParticipantId);

    const participant = await this.client.collectionParticipant.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        collectionId,
        participantType: "child",
        linkedUserId: null,
        invitedPhone: null,
        displayNameSnapshot: data.displayName,
        invitedByUserId: userId,
        paymentResponsibleParticipantId: data.responsiblePayerParticipantId,
        relationshipHint: "child",
        defaultWeight: data.defaultWeight ?? 0.5,
        status: "active",
        finalShareAmountMinor: 0,
        paymentStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await this.bumpCollectionStatus(collectionId, "participants_selected");
    return mapParticipantRecord(participant);
  }

  async setResponsiblePayer(
    userId: string,
    collectionId: string,
    participantId: string,
    responsiblePayerParticipantId: string | null
  ): Promise<CollectionParticipant> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    const participant = await this.getParticipantRecord(collectionId, participantId);
    if (responsiblePayerParticipantId) {
      await this.getParticipantRecord(collectionId, responsiblePayerParticipantId);
    }

    const updated = await this.client.collectionParticipant.upsert({
      where: { id: participantId },
      update: {
        paymentResponsibleParticipantId: responsiblePayerParticipantId,
        updatedAt: new Date()
      },
      create: {
        ...participant,
        paymentResponsibleParticipantId: responsiblePayerParticipantId,
        updatedAt: new Date()
      }
    });
    return mapParticipantRecord(updated);
  }

  async listExpenses(userId: string, collectionId: string): Promise<Expense[]> {
    await this.getCollectionForUser(userId, collectionId);
    const collection = (await this.client.collection.findMany({ include: { expenses: true } })).find((item) => item.id === collectionId);
    return collection?.expenses.map(mapExpenseRecord) ?? [];
  }

  async listCategories(userId: string, collectionId: string): Promise<ExpenseCategory[]> {
    await this.getCollectionForUser(userId, collectionId);
    const collection = (await this.client.collection.findMany({ include: { categories: true } })).find((item) => item.id === collectionId);
    return collection?.categories.map(mapCategoryRecord).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title)) ?? [];
  }

  async createCategory(
    userId: string,
    collectionId: string,
    data: { title: string; emoji?: string | null; requiresManualConfirmation?: boolean; autopayAllowedByDefault?: boolean }
  ): Promise<ExpenseCategory> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    const category = await this.client.expenseCategory.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        collectionId,
        title: data.title,
        emoji: data.emoji ?? null,
        requiresManualConfirmation: data.requiresManualConfirmation ?? false,
        autopayAllowedByDefault: data.autopayAllowedByDefault ?? false,
        createdAt: new Date()
      }
    });
    return mapCategoryRecord(category);
  }

  async createExpense(userId: string, collectionId: string, data: Parameters<AppStore["createExpense"]>[2]) {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    if (data.categoryId) {
      await this.getCategoryRecord(collectionId, data.categoryId);
    }

    const now = new Date();
    const expenseId = randomUUID();
    const expense = await this.client.expense.upsert({
      where: { id: expenseId },
      update: {},
      create: {
        id: expenseId,
        collectionId,
        title: data.title,
        amountMinor: data.amountMinor,
        currency: "RUB",
        expenseType: data.expenseType ?? "expense",
        primaryPaidByParticipantId: data.payments?.[0]?.paidByParticipantId ?? null,
        categoryId: data.categoryId ?? null,
        receiptUrl: null,
        comment: data.comment ?? null,
        createdAt: now,
        updatedAt: now
      }
    });

    const payments: ExpensePayment[] = [];
    for (const payment of data.payments ?? []) {
      const createdPayment = await this.addExpensePayment(userId, expense.id, payment);
      payments.push(createdPayment);
    }

    await this.recalculateCollectionTotalDirect(collectionId);
    await this.bumpCollectionStatus(collectionId, "expenses_added");

    return {
      expense: mapExpenseRecord(expense),
      payments
    };
  }

  async addExpensePayment(userId: string, expenseId: string, data: Parameters<AppStore["addExpensePayment"]>[2]): Promise<ExpensePayment> {
    const expense = await this.getExpenseRecord(expenseId);
    await this.getOrganizerCollectionRecord(userId, expense.collectionId);
    await this.getParticipantRecord(expense.collectionId, data.paidByParticipantId);

    const payment = await this.client.expensePayment.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        expenseId,
        paidByParticipantId: data.paidByParticipantId,
        amountMinor: data.amountMinor,
        currency: "RUB",
        paymentSource: data.paymentSource ?? "other",
        comment: data.comment ?? null,
        createdAt: new Date()
      }
    });

    await this.bumpCollectionStatus(expense.collectionId, "expenses_added");
    return mapExpensePaymentRecord(payment);
  }

  async addShareRule(userId: string, expenseId: string, data: Parameters<AppStore["addShareRule"]>[2]): Promise<ExpenseShareRule> {
    const expense = await this.getExpenseRecord(expenseId);
    await this.getOrganizerCollectionRecord(userId, expense.collectionId);
    await this.getParticipantRecord(expense.collectionId, data.participantId);

    const rule = await this.client.expenseShareRule.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        expenseId,
        expenseItemId: null,
        categoryId: data.categoryId ?? null,
        participantId: data.participantId,
        splitMode: data.splitMode,
        weight: data.weight ?? null,
        fixedAmountMinor: data.fixedAmountMinor ?? null,
        percent: data.percent ?? null,
        capAmountMinor: data.capAmountMinor ?? null,
        excluded: data.excluded ?? false,
        reason: data.reason ?? null
      }
    });

    await this.bumpCollectionStatus(expense.collectionId, "rules_configured");
    return mapShareRuleRecord({
      ...rule,
      expenseId: rule.expenseId ?? expenseId
    });
  }

  async calculateCollection(userId: string, collectionId: string) {
    await this.refresh();
    return await this.mirror.calculateCollection(userId, collectionId);
  }

  async getLatestCalculation(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.getLatestCalculation(userId, collectionId);
  }

  async confirmParticipantReview(userId: string, collectionId: string, participantId: string) {
    await this.refresh();
    return await this.mirror.confirmParticipantReview(userId, collectionId, participantId);
  }

  async createDispute(userId: string, collectionId: string, data: Parameters<AppStore["createDispute"]>[2]) {
    await this.refresh();
    return await this.mirror.createDispute(userId, collectionId, data);
  }

  async listDisputes(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.listDisputes(userId, collectionId);
  }

  async acceptDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    await this.refresh();
    return await this.mirror.acceptDispute(userId, disputeId, resolutionComment);
  }

  async rejectDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    await this.refresh();
    return await this.mirror.rejectDispute(userId, disputeId, resolutionComment);
  }

  async resolveDispute(userId: string, disputeId: string, resolutionComment?: string | null) {
    await this.refresh();
    return await this.mirror.resolveDispute(userId, disputeId, resolutionComment);
  }

  async markManualPaymentPaid(userId: string, collectionId: string, data: Parameters<AppStore["markManualPaymentPaid"]>[2]) {
    await this.refresh();
    return await this.mirror.markManualPaymentPaid(userId, collectionId, data);
  }

  async uploadManualPaymentProof(userId: string, proofId: string, data: Parameters<AppStore["uploadManualPaymentProof"]>[2]) {
    await this.refresh();
    return await this.mirror.uploadManualPaymentProof(userId, proofId, data);
  }

  async confirmManualPayment(userId: string, proofId: string) {
    await this.refresh();
    return await this.mirror.confirmManualPayment(userId, proofId);
  }

  async rejectManualPayment(userId: string, proofId: string) {
    await this.refresh();
    return await this.mirror.rejectManualPayment(userId, proofId);
  }

  async listManualPayments(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.listManualPayments(userId, collectionId);
  }

  async listAuditLogs(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.listAuditLogs(userId, collectionId);
  }

  async listGroupTemplates(userId: string, groupId: string): Promise<CollectionTemplate[]> {
    await this.getGroupForUser(userId, groupId);
    return (await this.client.collectionTemplate.findMany({ include: { categories: true } }))
      .filter((template) => template.groupId === groupId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapTemplateRecord);
  }

  async createGroupTemplate(
    userId: string,
    groupId: string,
    data: {
      title: string;
      collectionType: Collection["type"];
      paymentMode?: Collection["paymentMode"];
      categories?: Array<{
        title: string;
        emoji?: string | null;
        requiresManualConfirmation?: boolean;
        autopayAllowedByDefault?: boolean;
      }>;
    }
  ): Promise<CollectionTemplate> {
    await this.getGroupForUser(userId, groupId);

    const templateId = randomUUID();
    const seeds =
      data.categories?.map((category, index) => ({
        id: randomUUID(),
        templateId,
        title: category.title,
        emoji: category.emoji ?? null,
        requiresManualConfirmation: category.requiresManualConfirmation ?? false,
        autopayAllowedByDefault: category.autopayAllowedByDefault ?? false,
        sortOrder: index
      })) ??
      DEFAULT_COLLECTION_CATEGORIES[data.collectionType].map((category, index) => ({
        id: randomUUID(),
        templateId,
        title: category.title,
        emoji: category.emoji ?? null,
        requiresManualConfirmation: category.requiresManualConfirmation,
        autopayAllowedByDefault: category.autopayAllowedByDefault,
        sortOrder: index
      }));

    const template = await this.client.collectionTemplate.create({
      data: {
        id: templateId,
        groupId,
        ownerUserId: userId,
        title: data.title,
        collectionType: data.collectionType,
        paymentMode: data.paymentMode ?? "manual",
        createdAt: new Date(),
        updatedAt: new Date(),
        categories: {
          create: seeds
        }
      }
    });

    return mapTemplateRecord({
      ...template,
      categories: seeds
    });
  }

  async listNotifications(userId: string): Promise<Notification[]> {
    await this.getUser(userId);
    return (await this.client.notification.findMany())
      .filter((notification) => notification.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(mapNotificationRecord);
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<Notification> {
    const notification = (await this.client.notification.findMany()).find((item) => item.id === notificationId);
    if (!notification || notification.userId !== userId) {
      throw new AppError(404, "Notification not found.");
    }

    const updated = await this.client.notification.upsert({
      where: { id: notificationId },
      update: {
        status: "read",
        readAt: new Date()
      },
      create: {
        ...notification,
        status: "read",
        readAt: new Date()
      }
    });

    return mapNotificationRecord(updated);
  }

  private async refresh(): Promise<void> {
    await this.mirror.hydrateFromDatabase();
  }

  private async getFriendshipForUser(userId: string, friendshipId: string): Promise<Friendship> {
    const friendship = (await this.client.friendship.findMany()).find((item) => item.id === friendshipId);
    if (!friendship || (friendship.userId !== userId && friendship.friendId !== userId)) {
      throw new AppError(404, "Friendship not found.");
    }
    return mapFriendshipRecord(friendship);
  }

  private async getGroupForUser(userId: string, groupId: string): Promise<Group> {
    const group = (await this.client.group.findMany()).find((item) => item.id === groupId);
    if (!group) {
      throw new AppError(404, "Group not found.");
    }

    const isMember = (await this.client.groupMember.findMany()).some(
      (member) => member.groupId === groupId && member.userId === userId && member.status === "active"
    );
    if (!isMember) {
      throw new AppError(403, "Group is not available to this user.");
    }

    return mapGroupRecord(group);
  }

  private async getCollectionRecord(collectionId: string) {
    const collection = (await this.client.collection.findMany({ include: { participants: true } })).find((item) => item.id === collectionId);
    if (!collection) {
      throw new AppError(404, "Collection not found.");
    }
    return collection;
  }

  private async getOrganizerCollectionRecord(userId: string, collectionId: string) {
    const collection = await this.getCollectionRecord(collectionId);
    if (collection.organizerId !== userId) {
      throw new AppError(403, "Only organizer can change collection in MVP.");
    }
    return collection;
  }

  private async getParticipantRecord(collectionId: string, participantId: string) {
    const collection = (await this.client.collection.findMany({ include: { participants: true } })).find((item) => item.id === collectionId);
    const participant = collection?.participants.find((item) => item.id === participantId);
    if (!participant) {
      throw new AppError(404, "Participant not found.");
    }
    return participant;
  }

  private async getCollectionTemplate(templateId: string): Promise<CollectionTemplate> {
    const template = (await this.client.collectionTemplate.findMany({ include: { categories: true } })).find((item) => item.id === templateId);
    if (!template) {
      throw new AppError(404, "Collection template not found.");
    }
    return mapTemplateRecord(template);
  }

  private async getCategoryRecord(collectionId: string, categoryId: string) {
    const collection = (await this.client.collection.findMany({ include: { categories: true } })).find((item) => item.id === collectionId);
    const category = collection?.categories.find((item) => item.id === categoryId);
    if (!category) {
      throw new AppError(404, "Category not found.");
    }
    return category;
  }

  private async getExpenseRecord(expenseId: string) {
    const collection = (await this.client.collection.findMany({ include: { expenses: true } })).find((item) =>
      item.expenses.some((expense) => expense.id === expenseId)
    );
    const expense = collection?.expenses.find((item) => item.id === expenseId);
    if (!expense) {
      throw new AppError(404, "Expense not found.");
    }
    return expense;
  }

  private async bumpCollectionStatus(collectionId: string, status: Collection["status"]): Promise<void> {
    const collection = await this.getCollectionRecord(collectionId);
    if (collection.status === "cancelled" || collection.status === "closed") {
      return;
    }
    await this.client.collection.upsert({
      where: { id: collectionId },
      update: {
        status,
        updatedAt: new Date()
      },
      create: collectionCreateInputFromRecord(collection, { status, updatedAt: new Date() })
    });
  }

  private async recalculateCollectionTotalDirect(collectionId: string): Promise<void> {
    const collection = (await this.client.collection.findMany({ include: { expenses: true } })).find((item) => item.id === collectionId);
    if (!collection) {
      throw new AppError(404, "Collection not found.");
    }

    const totalAmountMinor = collection.expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
    await this.client.collection.upsert({
      where: { id: collectionId },
      update: {
        totalAmountMinor,
        updatedAt: new Date()
      },
      create: {
        ...collectionCreateInputFromRecord(collection, { updatedAt: new Date() }),
        totalAmountMinor
      }
    });
  }
}

function mapUserRecord(record: {
  id: string;
  phone: string;
  displayName: string;
  avatarUrl: string | null;
  status: User["status"];
  verificationLevel: User["verificationLevel"];
  createdAt: Date;
  updatedAt: Date;
}): User {
  return {
    id: record.id,
    phone: record.phone,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    status: record.status,
    verificationLevel: record.verificationLevel,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapFriendshipRecord(record: {
  id: string;
  userId: string;
  friendId: string;
  status: Friendship["status"];
  createdAt: Date;
}): Friendship {
  return {
    id: record.id,
    userId: record.userId,
    friendId: record.friendId,
    status: record.status,
    createdAt: record.createdAt.toISOString()
  };
}

function mapGroupRecord(record: {
  id: string;
  title: string;
  emoji: string | null;
  ownerId: string;
  visibility: Group["visibility"];
  groupType: Group["groupType"];
  createdAt: Date;
  updatedAt: Date;
}): Group {
  return {
    id: record.id,
    title: record.title,
    emoji: record.emoji,
    ownerId: record.ownerId,
    visibility: record.visibility,
    groupType: record.groupType,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapGroupMemberRecord(record: {
  id: string;
  groupId: string;
  userId: string;
  role: GroupMember["role"];
  status: GroupMember["status"];
  joinedAt: Date;
}): GroupMember {
  return {
    id: record.id,
    groupId: record.groupId,
    userId: record.userId,
    role: record.role,
    status: record.status,
    joinedAt: record.joinedAt.toISOString()
  };
}

function mapCollectionRecord(record: {
  id: string;
  title: string;
  type: Collection["type"];
  groupId: string | null;
  organizerId: string;
  currency: string;
  status: Collection["status"];
  paymentMode: Collection["paymentMode"];
  totalAmountMinor: number;
  reviewDeadlineAt: Date | null;
  paymentDeadlineAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Collection {
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    groupId: record.groupId,
    organizerId: record.organizerId,
    currency: "RUB",
    status: record.status,
    paymentMode: record.paymentMode,
    totalAmountMinor: record.totalAmountMinor,
    reviewDeadlineAt: record.reviewDeadlineAt?.toISOString() ?? null,
    paymentDeadlineAt: record.paymentDeadlineAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapParticipantRecord(record: {
  id: string;
  collectionId: string;
  participantType: CollectionParticipant["participantType"];
  linkedUserId: string | null;
  invitedPhone: string | null;
  displayNameSnapshot: string;
  invitedByUserId: string | null;
  paymentResponsibleParticipantId: string | null;
  relationshipHint: string;
  defaultWeight: { toNumber?: () => number } | number;
  status: CollectionParticipant["status"];
  finalShareAmountMinor: number;
  paymentStatus: CollectionParticipant["paymentStatus"];
  createdAt: Date;
  updatedAt: Date;
}): CollectionParticipant {
  const defaultWeight = typeof record.defaultWeight === "number" ? record.defaultWeight : (record.defaultWeight.toNumber?.() ?? 1);
  return {
    id: record.id,
    collectionId: record.collectionId,
    participantType: record.participantType,
    linkedUserId: record.linkedUserId,
    invitedPhone: record.invitedPhone,
    displayNameSnapshot: record.displayNameSnapshot,
    invitedByUserId: record.invitedByUserId,
    paymentResponsibleParticipantId: record.paymentResponsibleParticipantId,
    relationshipHint: normalizeRelationshipHint(record.relationshipHint),
    defaultWeight,
    status: record.status,
    finalShareAmountMinor: record.finalShareAmountMinor,
    paymentStatus: record.paymentStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapCategoryRecord(record: {
  id: string;
  collectionId: string;
  title: string;
  emoji: string | null;
  requiresManualConfirmation: boolean;
  autopayAllowedByDefault: boolean;
  createdAt: Date;
}): ExpenseCategory {
  return {
    id: record.id,
    collectionId: record.collectionId,
    title: record.title,
    emoji: record.emoji,
    requiresManualConfirmation: record.requiresManualConfirmation,
    autopayAllowedByDefault: record.autopayAllowedByDefault,
    createdAt: record.createdAt.toISOString()
  };
}

function mapExpenseRecord(record: {
  id: string;
  collectionId: string;
  title: string;
  amountMinor: number;
  currency: string;
  expenseType: Expense["expenseType"];
  categoryId: string | null;
  receiptUrl: string | null;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Expense {
  return {
    id: record.id,
    collectionId: record.collectionId,
    title: record.title,
    amountMinor: record.amountMinor,
    currency: "RUB",
    expenseType: record.expenseType,
    categoryId: record.categoryId,
    receiptUrl: record.receiptUrl,
    comment: record.comment,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapExpensePaymentRecord(record: {
  id: string;
  expenseId: string;
  paidByParticipantId: string;
  amountMinor: number;
  currency: string;
  paymentSource: ExpensePayment["paymentSource"];
  comment: string | null;
  createdAt: Date;
}): ExpensePayment {
  return {
    id: record.id,
    expenseId: record.expenseId,
    paidByParticipantId: record.paidByParticipantId,
    amountMinor: record.amountMinor,
    currency: "RUB",
    paymentSource: record.paymentSource,
    comment: record.comment,
    createdAt: record.createdAt.toISOString()
  };
}

function mapShareRuleRecord(record: {
  id: string;
  expenseId: string;
  expenseItemId: string | null;
  categoryId: string | null;
  participantId: string;
  splitMode: ExpenseShareRule["splitMode"];
  weight: { toNumber?: () => number } | number | null;
  fixedAmountMinor: number | null;
  percent: { toNumber?: () => number } | number | null;
  capAmountMinor: number | null;
  excluded: boolean;
  reason: string | null;
}): ExpenseShareRule {
  return {
    id: record.id,
    expenseId: record.expenseId,
    expenseItemId: record.expenseItemId,
    categoryId: record.categoryId,
    participantId: record.participantId,
    splitMode: record.splitMode,
    weight: typeof record.weight === "number" ? record.weight : (record.weight?.toNumber?.() ?? null),
    fixedAmountMinor: record.fixedAmountMinor,
    percent: typeof record.percent === "number" ? record.percent : (record.percent?.toNumber?.() ?? null),
    capAmountMinor: record.capAmountMinor,
    excluded: record.excluded,
    reason: record.reason
  };
}

function mapTemplateRecord(record: {
  id: string;
  groupId: string;
  ownerUserId: string;
  title: string;
  collectionType: CollectionTemplate["collectionType"];
  paymentMode: CollectionTemplate["paymentMode"];
  createdAt: Date;
  updatedAt: Date;
  categories: Array<{
    id: string;
    templateId: string;
    title: string;
    emoji: string | null;
    requiresManualConfirmation: boolean;
    autopayAllowedByDefault: boolean;
    sortOrder: number;
  }>;
}): CollectionTemplate {
  return {
    id: record.id,
    groupId: record.groupId,
    ownerUserId: record.ownerUserId,
    title: record.title,
    collectionType: record.collectionType,
    paymentMode: record.paymentMode,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    categories: record.categories.map((category) => ({
      id: category.id,
      templateId: category.templateId,
      title: category.title,
      emoji: category.emoji,
      requiresManualConfirmation: category.requiresManualConfirmation,
      autopayAllowedByDefault: category.autopayAllowedByDefault,
      sortOrder: category.sortOrder
    }))
  };
}

function mapNotificationRecord(record: {
  id: string;
  userId: string;
  collectionId: string | null;
  type: Notification["type"];
  title: string;
  body: string;
  status: Notification["status"];
  createdAt: Date;
  readAt: Date | null;
}): Notification {
  return {
    id: record.id,
    userId: record.userId,
    collectionId: record.collectionId,
    type: record.type,
    title: record.title,
    body: record.body,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    readAt: record.readAt?.toISOString() ?? null
  };
}

function normalizeRelationshipHint(value: string): CollectionParticipant["relationshipHint"] {
  switch (value) {
    case "self":
    case "partner":
    case "child":
    case "guest":
    case "family":
    case "colleague":
    case "other":
      return value;
    default:
      return "other";
  }
}

function createDevToken(userId: string, kind = "access"): string {
  return Buffer.from(`socialsplit:${kind}:${userId}`, "utf8").toString("base64url");
}

function parseDevToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [namespace, _kind, userId] = decoded.split(":");
    return namespace === "socialsplit" && userId ? userId : null;
  } catch {
    return null;
  }
}

function collectionCreateInputFromRecord(
  collection: {
    id: string;
    title: string;
    type: Collection["type"];
    groupId: string | null;
    organizerId: string;
    currency: string;
    status: Collection["status"];
    paymentMode: Collection["paymentMode"];
    totalAmountMinor: number;
    reviewDeadlineAt: Date | null;
    paymentDeadlineAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  overrides?: Partial<{
    status: Collection["status"];
    updatedAt: Date;
  }>
) {
  return {
    id: collection.id,
    title: collection.title,
    type: collection.type,
    groupId: collection.groupId,
    organizerId: collection.organizerId,
    currency: collection.currency,
    status: overrides?.status ?? collection.status,
    paymentMode: collection.paymentMode,
    totalAmountMinor: collection.totalAmountMinor,
    reviewDeadlineAt: collection.reviewDeadlineAt,
    paymentDeadlineAt: collection.paymentDeadlineAt,
    createdAt: collection.createdAt,
    updatedAt: overrides?.updatedAt ?? collection.updatedAt
  };
}
