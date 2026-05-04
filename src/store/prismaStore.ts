import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { calculateCollection } from "../calculation";
import { buildAutoPaymentPlan, type AutoPaymentExecutionPlan, type AutoPaymentPreviewItem } from "../payments/autopay";
import type { MockProviderPaymentMethodSetupWebhookPayload, MockProviderWebhookPayload } from "../payments/mockProvider";
import {
  getPaymentProviderAdapter,
  normalizePaymentProvider,
  type NormalizedPaymentWebhookEvent
} from "../payments/providerAdapter";
import type {
  AutoPaymentRule,
  AuditAction,
  AuditEntityType,
  AuditLog,
  AuthResult,
  CalculationVersion,
  Collection,
  CollectionParticipant,
  CollectionTemplate,
  Dispute,
  Expense,
  ExpenseItem,
  ExpenseCategory,
  ExpensePayment,
  ExpenseShareRule,
  Friendship,
  Group,
  GroupMember,
  GroupParticipantProfile,
  Payment,
  PaymentCardBrand,
  PaymentWebhookEvent,
  PaymentMethod,
  ManualPaymentProof,
  Notification,
  NotificationType,
  User
} from "../domain";
import type { AppStore } from "./appStore";
import { AppError, DEFAULT_COLLECTION_CATEGORIES } from "./inMemoryStore";

type PrismaStoreClient = PrismaClient | Prisma.TransactionClient;

export class PrismaStore implements AppStore {
  private constructor(
    private readonly client: PrismaStoreClient,
    private readonly rootClient: PrismaClient,
    private readonly otpRequests: Map<string, string> = new Map()
  ) {}

  static async create(client: PrismaStoreClient): Promise<PrismaStore> {
    return new PrismaStore(client, client as PrismaClient);
  }

  private fork(client: PrismaStoreClient): PrismaStore {
    return new PrismaStore(client, this.rootClient, this.otpRequests);
  }

  private async withAdvisoryLock<T>(key: string, callback: (store: PrismaStore) => Promise<T>): Promise<T> {
    if (!("$transaction" in this.rootClient)) {
      return await callback(this);
    }

    return await this.rootClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext(${toSqlLiteral(key)}))`);
      return await callback(this.fork(tx));
    });
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

  async listGroupParticipantProfiles(userId: string, groupId: string): Promise<GroupParticipantProfile[]> {
    await this.getGroupForUser(userId, groupId);
    return (await this.client.groupParticipantProfile.findMany())
      .filter((profile) => profile.groupId === groupId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.displayName.localeCompare(b.displayName))
      .map(mapGroupParticipantProfileRecord);
  }

  async createGroupParticipantProfile(
    userId: string,
    groupId: string,
    data: Parameters<AppStore["createGroupParticipantProfile"]>[2]
  ): Promise<GroupParticipantProfile> {
    const group = await this.getGroupForUser(userId, groupId);
    if (group.ownerId !== userId) {
      throw new AppError(403, "Only group owner can manage participant profiles in MVP.");
    }

    const linkedUser = data.linkedUserId ? await this.getUser(data.linkedUserId) : null;
    const participantType = linkedUser ? "registered_user" : data.invitedPhone ? "invited_phone" : (data.participantType ?? "external_person");
    const displayName = data.displayName ?? linkedUser?.displayName ?? data.invitedPhone;
    if (!displayName) {
      throw new AppError(400, "Participant profile display name is required.");
    }

    const profile = await this.client.groupParticipantProfile.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        groupId,
        ownerUserId: userId,
        linkedUserId: linkedUser?.id ?? null,
        invitedPhone: data.invitedPhone ?? linkedUser?.phone ?? null,
        participantType,
        displayName,
        relationshipHint: data.relationshipHint ?? (participantType === "child" ? "child" : participantType === "guest" ? "guest" : "other"),
        defaultWeight: data.defaultWeight ?? (participantType === "child" ? 0.5 : 1),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await this.addAuditDirect(userId, "group", profile.id, null, "created", { groupId, profileId: profile.id });
    return mapGroupParticipantProfileRecord(profile);
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
            title: "Расчет отправлен на согласование",
            body: "Организатор отправил расчет сбора на согласование.",
            status: "unread",
            createdAt: new Date(),
            readAt: null
          }
        });
      }
    }

    return mapCollectionRecord(updated);
  }

  async listPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    await this.getUser(userId);
    return (await this.client.paymentMethod.findMany())
      .filter((method) => method.userId === userId)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapPaymentMethodRecord);
  }

  async createMockPaymentMethodSetup(
    userId: string,
    data: { provider?: string; setAsDefault?: boolean }
  ): Promise<PaymentMethod> {
    await this.getUser(userId);
    const provider = normalizePaymentProvider(data.provider);
    const activeMethods = (await this.listPaymentMethods(userId)).filter((method) => method.status === "active");
    const setup = getPaymentProviderAdapter(provider).createPaymentMethodSetup({
      provider,
      userId,
      existingProviderCustomerId: await this.findProviderCustomerIdDirect(userId, provider)
    });

    const createdAt = new Date();
    const method = await this.client.paymentMethod.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        userId,
        provider,
        providerCustomerId: setup.providerCustomerId,
        providerSetupId: setup.providerSetupId,
        providerPaymentMethodId: `${provider}_pm_pending_${randomUUID()}`,
        providerMetadata: asJson({
          ...setup.providerMetadata,
          requestedDefault: data.setAsDefault ?? activeMethods.length === 0
        }),
        maskedPan: "pending",
        brand: "unknown",
        status: setup.providerStatus,
        isDefault: false,
        lastSetupErrorCode: null,
        lastSetupErrorMessage: null,
        confirmedAt: null,
        createdAt,
        updatedAt: createdAt
      }
    });
    await this.addAuditDirect(userId, "user", method.id, null, "created", {
      kind: "payment_method_setup",
      provider,
      providerCustomerId: method.providerCustomerId,
      providerSetupId: method.providerSetupId
    });
    return mapPaymentMethodRecord(method);
  }

  async confirmMockPaymentMethodSetup(
    userId: string,
    paymentMethodId: string,
    data: { maskedPan: string; brand?: PaymentCardBrand; setAsDefault?: boolean }
  ): Promise<PaymentMethod> {
    const method = await this.getPaymentMethodForUserDirect(userId, paymentMethodId);
    if (method.status === "active") {
      return method;
    }
    if (method.status === "revoked") {
      throw new AppError(409, "Revoked payment method cannot be confirmed.");
    }

    const activeMethods = (await this.listPaymentMethods(userId)).filter((item) => item.status === "active");
    const shouldSetDefault =
      data.setAsDefault ??
      (typeof method.providerMetadata.requestedDefault === "boolean"
        ? method.providerMetadata.requestedDefault
        : activeMethods.length === 0);
    if (shouldSetDefault) {
      await this.clearDefaultPaymentMethodDirect(userId);
    }

    const binding = getPaymentProviderAdapter(method.provider).createPaymentMethodBinding({
      provider: method.provider,
      userId,
      maskedPan: data.maskedPan,
      brand: data.brand ?? "unknown",
      existingProviderCustomerId: method.providerCustomerId
    });

    const confirmedAt = new Date();
    const updated = await this.client.paymentMethod.upsert({
      where: { id: method.id },
      update: {
        providerCustomerId: binding.providerCustomerId,
        providerSetupId: binding.providerSetupId ?? method.providerSetupId,
        providerPaymentMethodId: binding.providerPaymentMethodId,
        providerMetadata: asJson({
          ...method.providerMetadata,
          ...binding.providerMetadata,
          requestedDefault: shouldSetDefault
        }),
        maskedPan: data.maskedPan,
        brand: data.brand ?? "unknown",
        status: "active",
        isDefault: shouldSetDefault,
        lastSetupErrorCode: null,
        lastSetupErrorMessage: null,
        confirmedAt,
        updatedAt: confirmedAt
      },
      create: paymentMethodCreateInputFromRecord(method, {
        providerCustomerId: binding.providerCustomerId,
        providerSetupId: binding.providerSetupId ?? method.providerSetupId,
        providerPaymentMethodId: binding.providerPaymentMethodId,
        providerMetadata: {
          ...method.providerMetadata,
          ...binding.providerMetadata,
          requestedDefault: shouldSetDefault
        },
        maskedPan: data.maskedPan,
        brand: data.brand ?? "unknown",
        status: "active",
        isDefault: shouldSetDefault,
        lastSetupErrorCode: null,
        lastSetupErrorMessage: null,
        confirmedAt,
        updatedAt: confirmedAt
      })
    });
    await this.addAuditDirect(userId, "user", method.id, null, "confirmed", {
      kind: "payment_method_setup",
      provider: updated.provider,
      providerCustomerId: updated.providerCustomerId,
      providerPaymentMethodId: updated.providerPaymentMethodId,
      isDefault: updated.isDefault
    });
    return mapPaymentMethodRecord(updated);
  }

  async failMockPaymentMethodSetup(
    userId: string,
    paymentMethodId: string,
    data: { errorCode?: string; reason?: string | null }
  ): Promise<PaymentMethod> {
    const method = await this.getPaymentMethodForUserDirect(userId, paymentMethodId);
    if (method.status === "active" || method.status === "revoked") {
      return method;
    }

    const updatedAt = new Date();
    const updated = await this.client.paymentMethod.upsert({
      where: { id: method.id },
      update: {
        status: "failed",
        isDefault: false,
        lastSetupErrorCode: data.errorCode ?? "mock_setup_failed",
        lastSetupErrorMessage: data.reason ?? "Не удалось выполнить тестовую привязку.",
        updatedAt
      },
      create: paymentMethodCreateInputFromRecord(method, {
        status: "failed",
        isDefault: false,
        lastSetupErrorCode: data.errorCode ?? "mock_setup_failed",
        lastSetupErrorMessage: data.reason ?? "Не удалось выполнить тестовую привязку.",
        updatedAt
      })
    });
    await this.addAuditDirect(userId, "user", method.id, null, "updated", {
      kind: "payment_method_setup",
      status: "failed",
      errorCode: updated.lastSetupErrorCode,
      reason: updated.lastSetupErrorMessage
    });
    return mapPaymentMethodRecord(updated);
  }

  async bindMockPaymentMethod(
    userId: string,
    data: { provider?: string; maskedPan: string; brand?: PaymentCardBrand; setAsDefault?: boolean }
  ): Promise<PaymentMethod> {
    const pending = await this.createMockPaymentMethodSetup(userId, {
      provider: data.provider,
      setAsDefault: data.setAsDefault
    });
    return await this.confirmMockPaymentMethodSetup(userId, pending.id, {
      maskedPan: data.maskedPan,
      brand: data.brand,
      setAsDefault: data.setAsDefault
    });
  }

  async revokePaymentMethod(userId: string, paymentMethodId: string): Promise<PaymentMethod> {
    const method = await this.getPaymentMethodForUserDirect(userId, paymentMethodId);
    if (method.status === "revoked") {
      return method;
    }

    const updated = await this.client.paymentMethod.upsert({
      where: { id: method.id },
      update: {
        status: "revoked",
        isDefault: false,
        updatedAt: new Date()
      },
      create: paymentMethodCreateInputFromRecord(method, {
        status: "revoked",
        isDefault: false,
        updatedAt: new Date()
      })
    });
    if (method.isDefault) {
      await this.promoteFallbackDefaultPaymentMethodDirect(userId, method.id);
    }
    await this.addAuditDirect(userId, "user", method.id, null, "updated", {
      kind: "payment_method",
      status: "revoked"
    });
    return mapPaymentMethodRecord(updated);
  }

  async listAutoPaymentRules(userId: string, scope?: { collectionId?: string; groupId?: string }): Promise<AutoPaymentRule[]> {
    await this.getUser(userId);
    return (await this.client.autoPaymentRule.findMany())
      .filter((rule) => rule.userId === userId)
      .filter((rule) => !scope?.collectionId || rule.collectionId === scope.collectionId)
      .filter((rule) => !scope?.groupId || rule.groupId === scope.groupId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapAutoPaymentRuleRecord);
  }

  async upsertAutoPaymentRule(
    userId: string,
    data: {
      id?: string | null;
      collectionId?: string | null;
      groupId?: string | null;
      category?: string | null;
      enabled?: boolean;
      singleCollectionLimitMinor?: number;
      dailyLimitMinor?: number;
      monthlyLimitMinor?: number;
      requiresObjectionWindow?: boolean;
      objectionWindowHours?: number;
      allowGuests?: boolean;
      allowChildren?: boolean;
      allowPartner?: boolean;
      maxCoveredParticipants?: number;
    }
  ): Promise<AutoPaymentRule> {
    await this.getUser(userId);
    if (data.collectionId) {
      await this.getCollectionForUser(userId, data.collectionId);
    }
    if (data.groupId) {
      await this.getGroupForUser(userId, data.groupId);
    }

    const existing = data.id ? await this.getOwnAutoPaymentRuleDirect(userId, data.id) : null;
    const rule = await this.client.autoPaymentRule.upsert({
      where: { id: existing?.id ?? randomUUID() },
      update: {
        collectionId: data.collectionId === undefined ? existing?.collectionId ?? undefined : data.collectionId,
        groupId: data.groupId === undefined ? existing?.groupId ?? undefined : data.groupId,
        category: data.category === undefined ? existing?.category ?? undefined : data.category,
        enabled: data.enabled ?? existing?.enabled ?? true,
        singleCollectionLimitMinor: data.singleCollectionLimitMinor ?? existing?.singleCollectionLimitMinor ?? 0,
        dailyLimitMinor: data.dailyLimitMinor ?? existing?.dailyLimitMinor ?? 0,
        monthlyLimitMinor: data.monthlyLimitMinor ?? existing?.monthlyLimitMinor ?? 0,
        requiresObjectionWindow: data.requiresObjectionWindow ?? existing?.requiresObjectionWindow ?? true,
        objectionWindowHours: data.objectionWindowHours ?? existing?.objectionWindowHours ?? 2,
        allowGuests: data.allowGuests ?? existing?.allowGuests ?? false,
        allowChildren: data.allowChildren ?? existing?.allowChildren ?? true,
        allowPartner: data.allowPartner ?? existing?.allowPartner ?? false,
        maxCoveredParticipants: data.maxCoveredParticipants ?? existing?.maxCoveredParticipants ?? 2,
        updatedAt: new Date()
      },
      create: {
        id: existing?.id ?? randomUUID(),
        userId,
        collectionId: data.collectionId ?? existing?.collectionId ?? null,
        groupId: data.groupId ?? existing?.groupId ?? null,
        category: data.category ?? existing?.category ?? null,
        enabled: data.enabled ?? existing?.enabled ?? true,
        singleCollectionLimitMinor: data.singleCollectionLimitMinor ?? existing?.singleCollectionLimitMinor ?? 0,
        dailyLimitMinor: data.dailyLimitMinor ?? existing?.dailyLimitMinor ?? 0,
        monthlyLimitMinor: data.monthlyLimitMinor ?? existing?.monthlyLimitMinor ?? 0,
        requiresObjectionWindow: data.requiresObjectionWindow ?? existing?.requiresObjectionWindow ?? true,
        objectionWindowHours: data.objectionWindowHours ?? existing?.objectionWindowHours ?? 2,
        allowGuests: data.allowGuests ?? existing?.allowGuests ?? false,
        allowChildren: data.allowChildren ?? existing?.allowChildren ?? true,
        allowPartner: data.allowPartner ?? existing?.allowPartner ?? false,
        maxCoveredParticipants: data.maxCoveredParticipants ?? existing?.maxCoveredParticipants ?? 2,
        createdAt: existing ? new Date(existing.createdAt) : new Date(),
        updatedAt: new Date()
      }
    });
    await this.addAuditDirect(userId, "autopay_rule", rule.id, rule.collectionId, existing ? "updated" : "created", {
      groupId: rule.groupId,
      category: rule.category,
      enabled: rule.enabled,
      singleCollectionLimitMinor: rule.singleCollectionLimitMinor,
      monthlyLimitMinor: rule.monthlyLimitMinor
    });
    return mapAutoPaymentRuleRecord(rule);
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

  async addParticipantFromProfile(
    userId: string,
    collectionId: string,
    data: Parameters<AppStore["addParticipantFromProfile"]>[2]
  ): Promise<CollectionParticipant> {
    const collection = await this.getOrganizerCollectionRecord(userId, collectionId);
    const profile = await this.getGroupParticipantProfileRecord(data.profileId);
    if (!collection.groupId || collection.groupId !== profile.groupId) {
      throw new AppError(400, "Participant profile group does not match collection group.");
    }

    if (profile.participantType === "child") {
      if (!data.responsiblePayerParticipantId) {
        throw new AppError(400, "Child participant profile requires a responsible payer.");
      }
      return await this.addChild(userId, collectionId, {
        displayName: profile.displayName,
        responsiblePayerParticipantId: data.responsiblePayerParticipantId,
        defaultWeight: typeof profile.defaultWeight === "number" ? profile.defaultWeight : (profile.defaultWeight.toNumber?.() ?? 0.5)
      });
    }

    if (profile.participantType === "guest") {
      return await this.addGuest(userId, collectionId, {
        displayName: profile.displayName,
        responsiblePayerParticipantId: data.responsiblePayerParticipantId ?? null,
        defaultWeight: typeof profile.defaultWeight === "number" ? profile.defaultWeight : (profile.defaultWeight.toNumber?.() ?? 1)
      });
    }

    return await this.addParticipant(userId, collectionId, {
      linkedUserId: profile.linkedUserId,
      invitedPhone: profile.invitedPhone,
      displayName: profile.displayName,
      defaultWeight: typeof profile.defaultWeight === "number" ? profile.defaultWeight : (profile.defaultWeight.toNumber?.() ?? 1),
      responsiblePayerParticipantId: data.responsiblePayerParticipantId ?? null
    });
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

  async updateParticipant(
    userId: string,
    collectionId: string,
    participantId: string,
    data: {
      relationshipHint?: CollectionParticipant["relationshipHint"];
      defaultWeight?: number;
    }
  ): Promise<CollectionParticipant> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    const participant = await this.getParticipantRecord(collectionId, participantId);

    const updated = await this.client.collectionParticipant.upsert({
      where: { id: participantId },
      update: {
        relationshipHint: data.relationshipHint ?? participant.relationshipHint,
        defaultWeight: data.defaultWeight ?? participant.defaultWeight,
        updatedAt: new Date()
      },
      create: {
        ...participant,
        relationshipHint: data.relationshipHint ?? normalizeRelationshipHint(participant.relationshipHint),
        defaultWeight: data.defaultWeight ?? (typeof participant.defaultWeight === "number" ? participant.defaultWeight : (participant.defaultWeight.toNumber?.() ?? 1)),
        updatedAt: new Date()
      }
    });
    return mapParticipantRecord(updated);
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

  async listExpenseItems(userId: string, expenseId: string): Promise<ExpenseItem[]> {
    const expense = await this.getExpenseRecord(expenseId);
    await this.getCollectionForUser(userId, expense.collectionId);
    return (await this.client.expenseItem.findMany())
      .filter((item) => item.expenseId === expenseId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.title.localeCompare(b.title))
      .map(mapExpenseItemRecord);
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
    if (data.items?.some((item) => item.categoryId)) {
      for (const item of data.items) {
        if (item.categoryId) {
          await this.getCategoryRecord(collectionId, item.categoryId);
        }
      }
    }
    if (data.items && data.items.reduce((sum, item) => sum + item.amountMinor, 0) !== data.amountMinor) {
      throw new AppError(400, "Expense items total must match expense amount.");
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
    for (const item of data.items ?? []) {
      await this.client.expenseItem.upsert({
        where: { id: randomUUID() },
        update: {},
        create: {
          id: randomUUID(),
          expenseId: expense.id,
          title: item.title,
          amountMinor: item.amountMinor,
          currency: "RUB",
          categoryId: item.categoryId ?? null,
          splitMode: item.splitMode ?? "equal",
          createdAt: now,
          updatedAt: now
        }
      });
    }

    await this.recalculateCollectionTotalDirect(collectionId);
    await this.bumpCollectionStatus(collectionId, "expenses_added");

    return {
      expense: mapExpenseRecord(expense),
      payments
    };
  }

  async createExpenseItem(
    userId: string,
    expenseId: string,
    data: Parameters<AppStore["createExpenseItem"]>[2]
  ): Promise<ExpenseItem> {
    const expense = await this.getExpenseRecord(expenseId);
    await this.getOrganizerCollectionRecord(userId, expense.collectionId);
    if (data.categoryId) {
      await this.getCategoryRecord(expense.collectionId, data.categoryId);
    }

    const item = await this.client.expenseItem.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        expenseId,
        title: data.title,
        amountMinor: data.amountMinor,
        currency: "RUB",
        categoryId: data.categoryId ?? null,
        splitMode: data.splitMode ?? "equal",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    await this.recalculateExpenseAmountFromItemsDirect(expenseId);
    await this.recalculateCollectionTotalDirect(expense.collectionId);
    await this.bumpCollectionStatus(expense.collectionId, "expenses_added");
    return mapExpenseItemRecord(item);
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
    if (data.expenseItemId) {
      await this.getExpenseItemRecord(expenseId, data.expenseItemId);
    }

    const rule = await this.client.expenseShareRule.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        expenseId,
        expenseItemId: data.expenseItemId ?? null,
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

  async calculateCollection(userId: string, collectionId: string): Promise<CalculationVersion> {
    return await this.withAdvisoryLock(`collection:${collectionId}:calculate`, async (store) => {
      return await store.calculateCollectionLocked(userId, collectionId, false);
    });
  }

  private async calculateCollectionLocked(
    userId: string,
    collectionId: string,
    forceVersion: boolean
  ): Promise<CalculationVersion> {
    const collection = await this.getOrganizerCollectionRecord(userId, collectionId);
    const state = await this.getCollectionStateRecord(collectionId);
    const previousVersions = await this.getCalculationVersionRecords(collectionId);

    const result = calculateCollection({
      collectionId,
      currency: collection.currency,
      participants: state.participants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayNameSnapshot,
        participantType: participant.participantType,
        defaultWeight:
          typeof participant.defaultWeight === "number" ? participant.defaultWeight : (participant.defaultWeight.toNumber?.() ?? 1),
        responsiblePayerId: participant.paymentResponsibleParticipantId
      })),
      expenses: state.expenses.map((expense) => ({
        id: expense.id,
        title: expense.title,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        categoryId: expense.categoryId,
        payments: (expense.payments ?? []).map((payment) => ({
          participantId: payment.paidByParticipantId,
          amountMinor: payment.amountMinor
        })),
        items: (expense.items ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          amountMinor: item.amountMinor,
          currency: item.currency,
          categoryId: item.categoryId,
          splitMode: item.splitMode
        })),
        shareRules: (expense.shareRules ?? []).map((rule) => ({
          participantId: rule.participantId,
          expenseItemId: rule.expenseItemId,
          splitMode: rule.splitMode,
          categoryId: rule.categoryId,
          weight: typeof rule.weight === "number" ? rule.weight : (rule.weight?.toNumber?.() ?? null),
          fixedAmountMinor: rule.fixedAmountMinor,
          percent: typeof rule.percent === "number" ? rule.percent : (rule.percent?.toNumber?.() ?? null),
          capAmountMinor: rule.capAmountMinor,
          excluded: rule.excluded,
          reason: rule.reason
        }))
      }))
    });

    const latestVersion = previousVersions.at(-1);
    if (!forceVersion && latestVersion && stableJson(latestVersion.result) === stableJson(result)) {
      return latestVersion;
    }

    for (const version of previousVersions) {
      await this.client.calculationVersion.upsert({
        where: { id: version.id },
        update: {
          status: "superseded",
          result: asJson(version.result)
        },
        create: calculationVersionCreateInputFromRecord(version, { status: "superseded" })
      });
    }

    const updatedAt = new Date();
    const participantById = new Map(state.participants.map((participant) => [participant.id, participant]));
    for (const participantCalculation of result.participantCalculations) {
      const participant = participantById.get(participantCalculation.participantId);
      if (!participant) {
        continue;
      }

      await this.client.collectionParticipant.upsert({
        where: { id: participant.id },
        update: {
          finalShareAmountMinor: participantCalculation.owesAmountMinor,
          updatedAt
        },
        create: {
          ...participantCreateInputFromRecord(participant),
          finalShareAmountMinor: participantCalculation.owesAmountMinor,
          updatedAt
        }
      });
    }

    const versionRecord = {
      id: randomUUID(),
      collectionId,
      version: previousVersions.reduce((max, item) => Math.max(max, item.version), 0) + 1,
      status: "draft" as const,
      totalAmountMinor: result.totalAmountMinor,
      createdByUserId: userId,
      result,
      createdAt: new Date()
    };

    await this.client.calculationVersion.upsert({
      where: { id: versionRecord.id },
      update: {
        version: versionRecord.version,
        status: versionRecord.status,
        totalAmountMinor: versionRecord.totalAmountMinor,
        createdByUserId: versionRecord.createdByUserId,
        result: asJson(versionRecord.result)
      },
      create: {
        id: versionRecord.id,
        collectionId: versionRecord.collectionId,
        version: versionRecord.version,
        status: versionRecord.status,
        totalAmountMinor: versionRecord.totalAmountMinor,
        createdByUserId: versionRecord.createdByUserId,
        result: asJson(versionRecord.result),
        createdAt: versionRecord.createdAt
      }
    });

    await this.client.participantCalculation.deleteMany({
      where: { calculationVersionId: versionRecord.id }
    });
    if (result.participantCalculations.length > 0) {
      await this.client.participantCalculation.createMany({
        data: result.participantCalculations.map((item) => ({
          id: randomUUID(),
          calculationVersionId: versionRecord.id,
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
      where: { calculationVersionId: versionRecord.id }
    });
    if (result.responsiblePayerCalculations.length > 0) {
      await this.client.responsiblePayerCalculation.createMany({
        data: result.responsiblePayerCalculations.map((item) => ({
          id: randomUUID(),
          calculationVersionId: versionRecord.id,
          responsibleUserId: participantById.get(item.responsiblePayerId)?.linkedUserId ?? null,
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
      where: { calculationVersionId: versionRecord.id }
    });
    if (result.transferPlan.length > 0) {
      await this.client.transferPlan.createMany({
        data: result.transferPlan.map((item) => ({
          id: randomUUID(),
          calculationVersionId: versionRecord.id,
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

    await this.bumpCollectionStatus(collectionId, "rules_configured");
    await this.addAuditDirect(userId, "collection", collectionId, collectionId, "recalculated", {
      calculationVersionId: versionRecord.id,
      version: versionRecord.version
    });

    return {
      id: versionRecord.id,
      collectionId: versionRecord.collectionId,
      version: versionRecord.version,
      status: versionRecord.status,
      totalAmountMinor: versionRecord.totalAmountMinor,
      createdByUserId: versionRecord.createdByUserId,
      result: versionRecord.result,
      createdAt: versionRecord.createdAt.toISOString()
    };
  }

  async getLatestCalculation(userId: string, collectionId: string): Promise<CalculationVersion> {
    await this.getCollectionForUser(userId, collectionId);
    const latest = (await this.getCalculationVersionRecords(collectionId)).at(-1);
    if (!latest) {
      throw new AppError(404, "Calculation version not found.");
    }
    return latest;
  }

  async confirmParticipantReview(userId: string, collectionId: string, participantId: string): Promise<CollectionParticipant> {
    await this.getCollectionForUser(userId, collectionId);
    const participant = await this.getParticipantRecord(collectionId, participantId);

    if (!(await this.canActForParticipant(userId, participant))) {
      throw new AppError(403, "User cannot confirm this participant share.");
    }

    const updated = await this.client.collectionParticipant.upsert({
      where: { id: participant.id },
      update: {
        status: "confirmed",
        updatedAt: new Date()
      },
      create: {
        ...participantCreateInputFromRecord(participant),
        status: "confirmed",
        updatedAt: new Date()
      }
    });

    await this.addAuditDirect(userId, "participant", participant.id, collectionId, "confirmed", { participantId });

    const collection = await this.getCollectionRecord(collectionId);
    await this.addNotificationDirect(
      collection.organizerId,
      collectionId,
      "participant_confirmed",
      "Расчет подтвержден",
      `${updated.displayNameSnapshot} подтвердил расчет.`
    );

    return mapParticipantRecord(updated);
  }

  async createDispute(userId: string, collectionId: string, data: Parameters<AppStore["createDispute"]>[2]): Promise<Dispute> {
    const collection = await this.getCollectionForUser(userId, collectionId);
    const participant = await this.getParticipantRecord(collectionId, data.participantId);

    if (!(await this.canActForParticipant(userId, participant))) {
      throw new AppError(403, "User cannot dispute this participant share.");
    }

    if (data.targetParticipantId) {
      await this.getParticipantRecord(collectionId, data.targetParticipantId);
    }

    const now = new Date();
    const dispute = await this.client.dispute.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        collectionId,
        participantId: data.participantId,
        createdByUserId: userId,
        targetParticipantId: data.targetParticipantId ?? null,
        type: data.type,
        message: data.message,
        status: "created",
        resolutionComment: null,
        createdAt: now,
        resolvedAt: null
      }
    });

    await this.client.collectionParticipant.upsert({
      where: { id: participant.id },
      update: {
        status: "disputed",
        paymentStatus: "disputed",
        updatedAt: now
      },
      create: {
        ...participantCreateInputFromRecord(participant),
        status: "disputed",
        paymentStatus: "disputed",
        updatedAt: now
      }
    });

    await this.bumpCollectionStatus(collectionId, "dispute_pending");
    await this.addAuditDirect(userId, "dispute", dispute.id, collectionId, "disputed", {
      participantId: data.participantId,
      type: data.type
    });
    await this.addNotificationDirect(
      collection.organizerId,
      collectionId,
      "dispute_created",
      "Новый спор",
      `${participant.displayNameSnapshot} оспорил расчет.`
    );

    return mapDisputeRecord(dispute);
  }

  async listDisputes(userId: string, collectionId: string): Promise<Dispute[]> {
    await this.getCollectionForUser(userId, collectionId);
    return (await this.client.dispute.findMany())
      .filter((dispute) => dispute.collectionId === collectionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapDisputeRecord);
  }

  async acceptDispute(userId: string, disputeId: string, resolutionComment?: string | null): Promise<Dispute> {
    const dispute = await this.getDisputeRecord(disputeId);
    await this.getOrganizerCollectionRecord(userId, dispute.collectionId);
    const updated = await this.updateDisputeDirect(dispute, "accepted", resolutionComment ?? null);
    await this.addAuditDirect(userId, "dispute", dispute.id, dispute.collectionId, "accepted", {
      resolutionComment: updated.resolutionComment
    });
    await this.addNotificationDirect(
      dispute.createdByUserId,
      dispute.collectionId,
      "dispute_updated",
      "Спор принят",
      "Организатор принял ваш спор."
    );
    return updated;
  }

  async rejectDispute(userId: string, disputeId: string, resolutionComment?: string | null): Promise<Dispute> {
    const dispute = await this.getDisputeRecord(disputeId);
    await this.getOrganizerCollectionRecord(userId, dispute.collectionId);
    const updated = await this.updateDisputeDirect(dispute, "rejected", resolutionComment ?? null);
    const participant = await this.getParticipantRecord(dispute.collectionId, dispute.participantId);
    await this.client.collectionParticipant.upsert({
      where: { id: participant.id },
      update: {
        status: "active",
        paymentStatus: "pending",
        updatedAt: new Date()
      },
      create: {
        ...participantCreateInputFromRecord(participant),
        status: "active",
        paymentStatus: "pending",
        updatedAt: new Date()
      }
    });
    await this.addAuditDirect(userId, "dispute", dispute.id, dispute.collectionId, "rejected", {
      resolutionComment: updated.resolutionComment
    });
    await this.addNotificationDirect(
      dispute.createdByUserId,
      dispute.collectionId,
      "dispute_updated",
      "Спор отклонен",
      "Организатор отклонил ваш спор."
    );
    return updated;
  }

  async resolveDispute(
    userId: string,
    disputeId: string,
    resolutionComment?: string | null
  ): Promise<{ dispute: Dispute; calculationVersion: CalculationVersion }> {
    const dispute = await this.getDisputeRecord(disputeId);
    await this.getOrganizerCollectionRecord(userId, dispute.collectionId);
    const updated = await this.updateDisputeDirect(dispute, "resolved_by_recalculation", resolutionComment ?? null);
    const calculationVersion = await this.withAdvisoryLock(`collection:${dispute.collectionId}:calculate`, async (store) => {
      return await store.calculateCollectionLocked(userId, dispute.collectionId, true);
    });
    await this.addAuditDirect(userId, "dispute", dispute.id, dispute.collectionId, "recalculated", {
      calculationVersionId: calculationVersion.id
    });
    await this.addNotificationDirect(
      dispute.createdByUserId,
      dispute.collectionId,
      "dispute_updated",
      "Спор решен",
      "Организатор пересчитал сбор после разбора спора."
    );
    return { dispute: updated, calculationVersion };
  }

  async markManualPaymentPaid(
    userId: string,
    collectionId: string,
    data: Parameters<AppStore["markManualPaymentPaid"]>[2]
  ): Promise<ManualPaymentProof> {
    return await this.withAdvisoryLock(`collection:${collectionId}:manual-payment`, async (store) => {
      return await store.markManualPaymentPaidLocked(userId, collectionId, data);
    });
  }

  private async markManualPaymentPaidLocked(
    userId: string,
    collectionId: string,
    data: Parameters<AppStore["markManualPaymentPaid"]>[2]
  ): Promise<ManualPaymentProof> {
    await this.getCollectionForUser(userId, collectionId);
    const payerParticipant = data.payerParticipantId ? await this.getParticipantRecord(collectionId, data.payerParticipantId) : null;
    const receiverParticipant = data.receiverParticipantId ? await this.getParticipantRecord(collectionId, data.receiverParticipantId) : null;

    if (payerParticipant && !(await this.canActForParticipant(userId, payerParticipant))) {
      throw new AppError(403, "User cannot mark payment for this participant.");
    }

    const idempotencyKey = resolveManualPaymentIdempotencyKey(userId, collectionId, data);
    const existing = await this.findManualPaymentByIdempotencyKeyDirect(collectionId, idempotencyKey);
    if (existing) {
      if (!isSameManualPaymentRequest(existing, userId, payerParticipant?.id ?? null, receiverParticipant?.id ?? null, data, idempotencyKey)) {
        throw new AppError(409, "Manual payment idempotency key is already used for another request.");
      }
      return existing;
    }

    const now = new Date();
    const proof = await this.client.manualPaymentProof.upsert({
      where: { id: randomUUID() },
      update: {},
      create: {
        id: randomUUID(),
        idempotencyKey,
        transferPlanId: data.transferPlanId ?? null,
        collectionId,
        payerUserId: userId,
        payerParticipantId: payerParticipant?.id ?? null,
        receiverUserId: receiverParticipant?.linkedUserId ?? null,
        receiverParticipantId: receiverParticipant?.id ?? null,
        amountMinor: data.amountMinor,
        method: data.method,
        comment: data.comment ?? null,
        proofUrl: data.proofUrl ?? null,
        status: "submitted",
        createdAt: now,
        updatedAt: now
      }
    });

    if (payerParticipant) {
      await this.client.collectionParticipant.upsert({
        where: { id: payerParticipant.id },
        update: {
          paymentStatus: "manual_marked_paid",
          updatedAt: now
        },
        create: {
          ...participantCreateInputFromRecord(payerParticipant),
          paymentStatus: "manual_marked_paid",
          updatedAt: now
        }
      });
    }

    await this.bumpCollectionStatus(collectionId, "partially_paid");
    await this.addAuditDirect(userId, "manual_payment", proof.id, collectionId, "paid", {
      amountMinor: data.amountMinor,
      method: data.method,
      idempotencyKey
    });
    await this.notifyManualPaymentReviewersDirect(
      collectionId,
      mapManualPaymentProofRecord(proof),
      "manual_payment_submitted",
      "Ручная оплата отправлена",
      "Участник отметил ручную оплату как выполненную."
    );

    return mapManualPaymentProofRecord(proof);
  }

  async uploadManualPaymentProof(
    userId: string,
    proofId: string,
    data: Parameters<AppStore["uploadManualPaymentProof"]>[2]
  ): Promise<ManualPaymentProof> {
    return await this.withAdvisoryLock(`manual-payment:${proofId}`, async (store) => {
      return await store.uploadManualPaymentProofLocked(userId, proofId, data);
    });
  }

  private async uploadManualPaymentProofLocked(
    userId: string,
    proofId: string,
    data: Parameters<AppStore["uploadManualPaymentProof"]>[2]
  ): Promise<ManualPaymentProof> {
    const proof = await this.getManualPaymentForUserDirect(userId, proofId);
    const nextProofUrl = data.proofUrl === undefined ? proof.proofUrl : data.proofUrl;
    const nextComment = data.comment === undefined ? proof.comment : data.comment;
    if (nextProofUrl === proof.proofUrl && nextComment === proof.comment) {
      return proof;
    }

    const updated = await this.client.manualPaymentProof.upsert({
      where: { id: proof.id },
      update: {
        proofUrl: nextProofUrl,
        comment: nextComment,
        updatedAt: new Date()
      },
      create: manualPaymentCreateInputFromRecord(proof, {
        proofUrl: nextProofUrl,
        comment: nextComment,
        updatedAt: new Date()
      })
    });
    await this.addAuditDirect(userId, "manual_payment", proof.id, proof.collectionId, "updated", {
      proofUrlChanged: data.proofUrl !== undefined
    });
    return mapManualPaymentProofRecord(updated);
  }

  async confirmManualPayment(userId: string, proofId: string): Promise<ManualPaymentProof> {
    return await this.withAdvisoryLock(`manual-payment:${proofId}`, async (store) => {
      return await store.confirmManualPaymentLocked(userId, proofId);
    });
  }

  private async confirmManualPaymentLocked(userId: string, proofId: string): Promise<ManualPaymentProof> {
    const proof = await this.getManualPaymentForReviewerDirect(userId, proofId);
    if (proof.status === "confirmed") {
      return proof;
    }
    if (proof.status === "rejected") {
      throw new AppError(409, "Rejected manual payment cannot be confirmed.");
    }
    const updated = await this.client.manualPaymentProof.upsert({
      where: { id: proof.id },
      update: {
        status: "confirmed",
        updatedAt: new Date()
      },
      create: manualPaymentCreateInputFromRecord(proof, {
        status: "confirmed",
        updatedAt: new Date()
      })
    });

    await this.bumpCollectionStatus(proof.collectionId, (await this.hasOnlyConfirmedManualPaymentsDirect(proof.collectionId)) ? "paid" : "partially_paid");
    await this.addAuditDirect(userId, "manual_payment", proof.id, proof.collectionId, "confirmed", {
      amountMinor: proof.amountMinor
    });
    await this.addNotificationDirect(
      proof.payerUserId,
      proof.collectionId,
      "manual_payment_confirmed",
      "Ручная оплата подтверждена",
      "Ваша ручная оплата подтверждена."
    );
    return mapManualPaymentProofRecord(updated);
  }

  async rejectManualPayment(userId: string, proofId: string): Promise<ManualPaymentProof> {
    return await this.withAdvisoryLock(`manual-payment:${proofId}`, async (store) => {
      return await store.rejectManualPaymentLocked(userId, proofId);
    });
  }

  private async rejectManualPaymentLocked(userId: string, proofId: string): Promise<ManualPaymentProof> {
    const proof = await this.getManualPaymentForReviewerDirect(userId, proofId);
    if (proof.status === "rejected") {
      return proof;
    }
    if (proof.status === "confirmed") {
      throw new AppError(409, "Confirmed manual payment cannot be rejected.");
    }
    const updated = await this.client.manualPaymentProof.upsert({
      where: { id: proof.id },
      update: {
        status: "rejected",
        updatedAt: new Date()
      },
      create: manualPaymentCreateInputFromRecord(proof, {
        status: "rejected",
        updatedAt: new Date()
      })
    });
    await this.bumpCollectionStatus(proof.collectionId, "payment_pending");
    await this.addAuditDirect(userId, "manual_payment", proof.id, proof.collectionId, "rejected", {
      amountMinor: proof.amountMinor
    });
    await this.addNotificationDirect(
      proof.payerUserId,
      proof.collectionId,
      "manual_payment_rejected",
      "Ручная оплата отклонена",
      "Подтверждение ручной оплаты отклонено."
    );
    return mapManualPaymentProofRecord(updated);
  }

  async listManualPayments(userId: string, collectionId: string): Promise<ManualPaymentProof[]> {
    await this.getCollectionForUser(userId, collectionId);
    return (await this.client.manualPaymentProof.findMany())
      .filter((proof) => proof.collectionId === collectionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapManualPaymentProofRecord);
  }

  async listPayments(userId: string, collectionId: string): Promise<Payment[]> {
    await this.getCollectionForUser(userId, collectionId);
    return (await this.client.payment.findMany())
      .filter((payment) => payment.collectionId === collectionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapPaymentRecord);
  }

  async createMockPayment(
    userId: string,
    collectionId: string,
    data: {
      participantId: string;
      amountMinor: number;
      provider?: Payment["provider"];
      paymentMethodId?: string | null;
      idempotencyKey: string;
    }
  ): Promise<Payment> {
    return await this.withAdvisoryLock(`collection:${collectionId}:payment-intent`, async (store) => {
      return await store.createMockPaymentLocked(userId, collectionId, data);
    });
  }

  private async createMockPaymentLocked(
    userId: string,
    collectionId: string,
    data: {
      participantId: string;
      amountMinor: number;
      provider?: Payment["provider"];
      paymentMethodId?: string | null;
      idempotencyKey: string;
    }
  ): Promise<Payment> {
    await this.getCollectionForUser(userId, collectionId);
    const participant = await this.getParticipantRecord(collectionId, data.participantId);
    if (!(await this.canActForParticipant(userId, participant))) {
      throw new AppError(403, "User cannot create payment for this participant.");
    }

    const paymentMethod = data.paymentMethodId ? await this.getPaymentMethodForUserDirect(userId, data.paymentMethodId) : null;
    if (paymentMethod && paymentMethod.status !== "active") {
      throw new AppError(409, "Payment method is not active.");
    }

    const normalizedIdempotencyKey = resolveMockPaymentIdempotencyKey(userId, collectionId, data.idempotencyKey);
    const existing = await this.findPaymentByIdempotencyKeyDirect(collectionId, normalizedIdempotencyKey);
    if (existing) {
      if (!isSameMockPaymentRequest(existing, userId, data, normalizedIdempotencyKey)) {
        throw new AppError(409, "Payment idempotency key is already used for another request.");
      }
      return existing;
    }

    const provider = normalizePaymentProvider(data.provider ?? paymentMethod?.provider);
    const paymentId = randomUUID();
    const intent = getPaymentProviderAdapter(provider).createPaymentIntent({
      provider,
      paymentId,
      collectionId,
      participantId: participant.id,
      responsibleUserId: userId,
      amountMinor: data.amountMinor,
      currency: "RUB",
      idempotencyKey: normalizedIdempotencyKey,
      paymentMethod
    });

    const createdAt = new Date();
    const payment = await this.client.payment.upsert({
      where: { id: paymentId },
      update: {},
      create: {
        id: paymentId,
        collectionId,
        participantId: participant.id,
        responsibleUserId: userId,
        paymentMethodId: paymentMethod?.id ?? null,
        amountMinor: data.amountMinor,
        currency: "RUB",
        provider,
        providerPaymentId: intent.providerPaymentId,
        providerStatus: intent.providerStatus,
        providerMetadata: asJson(intent.providerMetadata),
        status: "pending",
        lastErrorCode: null,
        lastErrorMessage: null,
        attemptCount: 1,
        lastWebhookEventId: null,
        lastWebhookReceivedAt: null,
        idempotencyKey: normalizedIdempotencyKey,
        createdAt,
        updatedAt: createdAt
      }
    });
    await this.setParticipantPaymentStatusDirect(collectionId, participant.id, "pending");
    await this.bumpCollectionStatus(collectionId, "payment_pending");
    await this.addAuditDirect(userId, "payment", payment.id, collectionId, "created", {
      amountMinor: payment.amountMinor,
      provider: payment.provider,
      participantId: payment.participantId,
      paymentMethodId: paymentMethod?.id ?? null,
      simulated: true
    });
    return mapPaymentRecord(payment);
  }

  async confirmMockPayment(userId: string, paymentId: string): Promise<Payment> {
    return await this.withAdvisoryLock(`payment:${paymentId}`, async (store) => {
      return await store.confirmMockPaymentLocked(userId, paymentId);
    });
  }

  private async confirmMockPaymentLocked(userId: string, paymentId: string): Promise<Payment> {
    const payment = await this.getPaymentForActorDirect(userId, paymentId);
    if (payment.status === "succeeded") {
      return payment;
    }
    if (payment.status === "refunded") {
      throw new AppError(409, "Refunded payment cannot be confirmed.");
    }
    if (payment.status === "failed" || payment.status === "cancelled") {
      throw new AppError(409, "Terminal payment cannot be confirmed.");
    }

    const updated = await this.client.payment.upsert({
      where: { id: payment.id },
      update: {
        status: "succeeded",
        providerStatus: "succeeded",
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date()
      },
      create: paymentCreateInputFromRecord(payment, {
        status: "succeeded",
        providerStatus: "succeeded",
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date()
      })
    });
    if (payment.participantId) {
      await this.setParticipantPaymentStatusDirect(payment.collectionId, payment.participantId, "paid");
    }
    await this.syncCollectionPaymentStatusDirect(payment.collectionId);
    await this.addAuditDirect(userId, "payment", payment.id, payment.collectionId, "paid", {
      status: "succeeded",
      simulated: true
    });
    return mapPaymentRecord(updated);
  }

  async failMockPayment(userId: string, paymentId: string, data?: { reason?: string | null }): Promise<Payment> {
    return await this.withAdvisoryLock(`payment:${paymentId}`, async (store) => {
      return await store.failMockPaymentLocked(userId, paymentId, data);
    });
  }

  private async failMockPaymentLocked(userId: string, paymentId: string, data?: { reason?: string | null }): Promise<Payment> {
    const payment = await this.getPaymentForActorDirect(userId, paymentId);
    if (payment.status === "failed") {
      return payment;
    }
    if (payment.status === "succeeded" || payment.status === "refunded") {
      throw new AppError(409, "Completed payment cannot be failed.");
    }

    const updated = await this.client.payment.upsert({
      where: { id: payment.id },
      update: {
        status: "failed",
        providerStatus: "failed",
        lastErrorCode: "mock_failure",
        lastErrorMessage: data?.reason ?? "Mock provider failure.",
        updatedAt: new Date()
      },
      create: paymentCreateInputFromRecord(payment, {
        status: "failed",
        providerStatus: "failed",
        lastErrorCode: "mock_failure",
        lastErrorMessage: data?.reason ?? "Mock provider failure.",
        updatedAt: new Date()
      })
    });
    if (payment.participantId) {
      await this.setParticipantPaymentStatusDirect(payment.collectionId, payment.participantId, "failed");
    }
    await this.syncCollectionPaymentStatusDirect(payment.collectionId);
    await this.addAuditDirect(userId, "payment", payment.id, payment.collectionId, "updated", {
      status: "failed",
      reason: data?.reason ?? null,
      simulated: true
    });
    return mapPaymentRecord(updated);
  }

  async refundPayment(userId: string, paymentId: string, data?: { reason?: string | null }): Promise<Payment> {
    return await this.withAdvisoryLock(`payment:${paymentId}`, async (store) => {
      return await store.refundPaymentLocked(userId, paymentId, data);
    });
  }

  private async refundPaymentLocked(userId: string, paymentId: string, data?: { reason?: string | null }): Promise<Payment> {
    const payment = await this.getPaymentForActorDirect(userId, paymentId);
    if (payment.status === "refunded") {
      return payment;
    }
    if (payment.status !== "succeeded") {
      throw new AppError(409, "Only succeeded payment can be refunded.");
    }

    const updated = await this.client.payment.upsert({
      where: { id: payment.id },
      update: {
        status: "refunded",
        providerStatus: "refunded",
        lastErrorCode: null,
        lastErrorMessage: data?.reason ?? null,
        updatedAt: new Date()
      },
      create: paymentCreateInputFromRecord(payment, {
        status: "refunded",
        providerStatus: "refunded",
        lastErrorCode: null,
        lastErrorMessage: data?.reason ?? null,
        updatedAt: new Date()
      })
    });
    if (payment.participantId) {
      await this.setParticipantPaymentStatusDirect(payment.collectionId, payment.participantId, "pending");
    }
    await this.syncCollectionPaymentStatusDirect(payment.collectionId);
    await this.addAuditDirect(userId, "payment", payment.id, payment.collectionId, "updated", {
      status: "refunded",
      reason: data?.reason ?? null,
      simulated: true
    });
    return mapPaymentRecord(updated);
  }

  async previewAutoPayments(userId: string, collectionId: string): Promise<AutoPaymentPreviewItem[]> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    return (await this.buildAutoPaymentExecutionPlan(collectionId)).preview;
  }

  async executeAutoPayments(
    userId: string,
    collectionId: string,
    options?: { dryRun?: boolean }
  ): Promise<{ createdPayments: Payment[]; skipped: AutoPaymentPreviewItem[]; preview: AutoPaymentPreviewItem[] }> {
    await this.getOrganizerCollectionRecord(userId, collectionId);
    return await this.withAdvisoryLock(`collection:${collectionId}:autopay-execute`, async (store) => {
      const plan = await store.buildAutoPaymentExecutionPlan(collectionId);
      if (options?.dryRun) {
        return {
          createdPayments: [],
          skipped: plan.preview.filter((item) => item.status !== "eligible"),
          preview: plan.preview
        };
      }

      const createdPayments: Payment[] = [];
      for (const item of plan.eligible) {
        const responsibleUserId = item.responsibleUserId;
        if (!responsibleUserId || !item.idempotencyKey) {
          continue;
        }
        const paymentMethod = item.paymentMethodId ? await store.getPaymentMethodForUserDirect(responsibleUserId, item.paymentMethodId) : null;
        const existing = await store.findPaymentByIdempotencyKeyDirect(collectionId, item.idempotencyKey);
        if (existing) {
          createdPayments.push(existing);
          continue;
        }

        const payment = await store.createAutoPaymentDirect({
          collectionId,
          participantId: item.participantId,
          responsibleUserId,
          amountMinor: item.amountMinor,
          provider: normalizePaymentProvider(paymentMethod?.provider),
          paymentMethod,
          idempotencyKey: item.idempotencyKey
        });
        await store.addAuditDirect(userId, "payment", payment.id, collectionId, "created", {
          amountMinor: payment.amountMinor,
          provider: payment.provider,
          participantId: payment.participantId,
          paymentMethodId: paymentMethod?.id ?? null,
          ruleId: item.ruleId,
          category: item.category,
          simulated: true,
          autoTriggered: true
        });
        createdPayments.push(payment);
      }

      return {
        createdPayments,
        skipped: plan.preview.filter((item) => item.status !== "eligible"),
        preview: plan.preview
      };
    });
  }

  async runAutoPaymentSweep(): Promise<{
    collectionsScanned: number;
    collectionsWithEligibleItems: number;
    paymentsCreated: number;
    affectedCollectionIds: string[];
  }> {
    const candidates = (await this.client.collection.findMany())
      .filter((collection) => !["draft", "cancelled", "closed", "blocked", "paid"].includes(collection.status));

    const affectedCollectionIds = new Set<string>();
    let collectionsWithEligibleItems = 0;
    let paymentsCreated = 0;

    for (const collection of candidates) {
      const calculations = await this.getCalculationVersionRecords(collection.id);
      if (calculations.length === 0) {
        continue;
      }

      const preview = await this.buildAutoPaymentExecutionPlan(collection.id);
      if (preview.preview.some((item) => item.status === "eligible")) {
        collectionsWithEligibleItems += 1;
      }

      const result = await this.executeAutoPayments(collection.organizerId, collection.id);
      if (result.createdPayments.length > 0) {
        affectedCollectionIds.add(collection.id);
        paymentsCreated += result.createdPayments.length;
      }
    }

    return {
      collectionsScanned: candidates.length,
      collectionsWithEligibleItems,
      paymentsCreated,
      affectedCollectionIds: [...affectedCollectionIds]
    };
  }

  async applyMockProviderWebhook(payload: MockProviderWebhookPayload): Promise<Payment> {
    return await this.applyPaymentWebhook({
      provider: "bank",
      eventId: payload.eventId,
      providerPaymentId: payload.providerPaymentId,
      eventType: payload.eventType,
      occurredAt: payload.occurredAt ?? null,
      reason: payload.reason ?? null,
      providerStatus: payload.providerStatus ?? defaultProviderStatusForEvent(payload.eventType),
      metadata: payload.metadata ?? {},
      rawPayload: payload as unknown as Record<string, unknown>
    });
  }

  async applyMockProviderPaymentMethodSetupWebhook(payload: MockProviderPaymentMethodSetupWebhookPayload): Promise<PaymentMethod> {
    return await this.applyPaymentMethodSetupWebhook({
      provider: "bank",
      eventId: payload.eventId,
      providerPaymentId: payload.providerSetupId,
      eventType: payload.eventType,
      occurredAt: payload.occurredAt ?? null,
      reason: payload.reason ?? null,
      providerStatus: payload.providerStatus ?? defaultProviderStatusForEvent(payload.eventType),
      providerPaymentMethodId: payload.providerPaymentMethodId ?? null,
      maskedPan: payload.maskedPan ?? null,
      brand: payload.brand ?? null,
      metadata: payload.metadata ?? {},
      rawPayload: payload as unknown as Record<string, unknown>
    });
  }

  async retryFailedPaymentWebhooks(options?: {
    ignoreSchedule?: boolean;
    maxEvents?: number;
  }): Promise<{
    dueEvents: number;
    retried: number;
    processed: number;
    failed: number;
    deadLettered: number;
    eventIds: string[];
  }> {
    const dueEvents = await this.getRetryableWebhookEventsDirect(options);
    let retried = 0;
    let processed = 0;
    let failed = 0;
    let deadLettered = 0;
    const eventIds: string[] = [];

    for (const webhookEvent of dueEvents) {
      const event = this.toNormalizedWebhookEvent(webhookEvent);
      eventIds.push(webhookEvent.externalEventId);

      try {
        await this.applyStoredWebhookEvent(event);
      } catch {
        // The persisted webhook record carries the final retry status.
      }

      const updatedEvent = await this.findPaymentWebhookEventByExternalIdDirect(webhookEvent.externalEventId);
      retried += 1;
      if (updatedEvent?.status === "processed") {
        processed += 1;
      } else if (updatedEvent?.status === "dead_lettered") {
        deadLettered += 1;
      } else {
        failed += 1;
      }
    }

    return {
      dueEvents: dueEvents.length,
      retried,
      processed,
      failed,
      deadLettered,
      eventIds
    };
  }

  async listPaymentWebhookEvents(filters?: {
    status?: PaymentWebhookEvent["status"];
    provider?: PaymentWebhookEvent["provider"];
    collectionId?: string;
    limit?: number;
  }): Promise<PaymentWebhookEvent[]> {
    let events = (await this.client.paymentWebhookEvent.findMany()).map(mapPaymentWebhookEventRecord);

    if (filters?.status) {
      events = events.filter((event) => event.status === filters.status);
    }

    if (filters?.provider) {
      events = events.filter((event) => event.provider === filters.provider);
    }

    if (filters?.collectionId) {
      const payments = await this.client.payment.findMany();
      const paymentIds = new Set(
        payments.filter((payment) => payment.collectionId === filters.collectionId).map((payment) => payment.id)
      );
      events = events.filter((event) => event.paymentId && paymentIds.has(event.paymentId));
    }

    events.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
    if (filters?.limit && filters.limit > 0) {
      return events.slice(0, filters.limit);
    }
    return events;
  }

  async replayPaymentWebhookEvent(externalEventId: string): Promise<PaymentWebhookEvent> {
    const existingEvent = await this.findPaymentWebhookEventByExternalIdDirect(externalEventId);
    if (!existingEvent) {
      throw new AppError(404, "Payment webhook event not found.");
    }
    if (existingEvent.status === "processed") {
      return existingEvent;
    }

    try {
      await this.applyStoredWebhookEvent(this.toNormalizedWebhookEvent(existingEvent));
    } catch {
      // The persisted webhook event row below reflects the latest replay attempt result.
    }

    const updatedEvent = await this.findPaymentWebhookEventByExternalIdDirect(externalEventId);
    if (!updatedEvent) {
      throw new AppError(500, "Payment webhook event disappeared after replay.");
    }
    return updatedEvent;
  }

  private async applyStoredWebhookEvent(event: NormalizedPaymentWebhookEvent): Promise<Payment | PaymentMethod> {
    if (event.eventType.startsWith("payment_method.")) {
      return await this.applyPaymentMethodSetupWebhook(event);
    }
    return await this.applyPaymentWebhook(event);
  }

  async applyPaymentWebhook(event: NormalizedPaymentWebhookEvent): Promise<Payment> {
    try {
      return await this.withAdvisoryLock(`payment-provider:${event.providerPaymentId}`, async (store) => {
        return await store.applyPaymentWebhookLocked(event);
      });
    } catch (error) {
      if (error instanceof AppError) {
        const payment = await this.findPaymentByProviderPaymentIdDirect(event.providerPaymentId);
        await this.failPaymentWebhookEventDirect(event, payment?.id ?? null, error);
      }
      throw error;
    }
  }

  async applyPaymentMethodSetupWebhook(event: NormalizedPaymentWebhookEvent): Promise<PaymentMethod> {
    try {
      return await this.withAdvisoryLock(`payment-method-setup:${event.providerPaymentId}`, async (store) => {
        return await store.applyPaymentMethodSetupWebhookLocked(event);
      });
    } catch (error) {
      if (error instanceof AppError) {
        await this.failPaymentWebhookEventDirect(event, null, error);
      }
      throw error;
    }
  }

  private async applyPaymentWebhookLocked(event: NormalizedPaymentWebhookEvent): Promise<Payment> {
    const existingEvent = await this.findPaymentWebhookEventByExternalIdDirect(event.eventId);
    if (existingEvent?.status === "processed" && existingEvent.paymentId) {
      const existingPayment = (await this.client.payment.findMany()).find((item) => item.id === existingEvent.paymentId);
      if (existingPayment) {
        return mapPaymentRecord(existingPayment);
      }
    }

    const payment = await this.findPaymentByProviderPaymentIdDirect(event.providerPaymentId);
    if (!payment) {
      throw new AppError(404, "Payment not found for provider payment id.");
    }

    let nextStatus: Payment["status"];
    let participantPaymentStatus: CollectionParticipant["paymentStatus"] | null;
    let action: AuditAction;

    switch (event.eventType) {
      case "payment.succeeded":
        if (payment.status === "succeeded") {
          await this.recordPaymentWebhookEventDirect(event, payment.id, "processed");
          return payment;
        }
        nextStatus = "succeeded";
        participantPaymentStatus = "paid";
        action = "paid";
        break;
      case "payment.failed":
        if (payment.status === "failed") {
          await this.recordPaymentWebhookEventDirect(event, payment.id, "processed");
          return payment;
        }
        if (payment.status === "refunded") {
          throw new AppError(409, "Refunded payment cannot be marked as failed.");
        }
        nextStatus = "failed";
        participantPaymentStatus = "failed";
        action = "updated";
        break;
      case "payment.refunded":
        if (payment.status === "refunded") {
          await this.recordPaymentWebhookEventDirect(event, payment.id, "processed");
          return payment;
        }
        if (payment.status !== "succeeded") {
          throw new AppError(409, "Only succeeded payment can be refunded.");
        }
        nextStatus = "refunded";
        participantPaymentStatus = "pending";
        action = "updated";
        break;
      default:
        throw new AppError(400, "Unsupported payment webhook event.");
    }

    const updated = await this.client.payment.upsert({
      where: { id: payment.id },
      update: {
        status: nextStatus,
        providerStatus: event.providerStatus,
        providerMetadata: asJson({
          ...payment.providerMetadata,
          ...event.metadata
        }),
        lastErrorCode: event.eventType === "payment.failed" ? "provider_webhook_failure" : null,
        lastErrorMessage: event.reason ?? null,
        lastWebhookEventId: event.eventId,
        lastWebhookReceivedAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
        updatedAt: new Date()
      },
      create: paymentCreateInputFromRecord(payment, {
        status: nextStatus,
        providerStatus: event.providerStatus,
        providerMetadata: {
          ...payment.providerMetadata,
          ...event.metadata
        },
        lastErrorCode: event.eventType === "payment.failed" ? "provider_webhook_failure" : null,
        lastErrorMessage: event.reason ?? null,
        lastWebhookEventId: event.eventId,
        lastWebhookReceivedAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
        updatedAt: new Date()
      })
    });
    if (payment.participantId && participantPaymentStatus) {
      await this.setParticipantPaymentStatusDirect(payment.collectionId, payment.participantId, participantPaymentStatus);
    }
    await this.syncCollectionPaymentStatusDirect(payment.collectionId);
    await this.recordPaymentWebhookEventDirect(event, payment.id, "processed");
    await this.addAuditDirect(null, "payment", payment.id, payment.collectionId, action, {
      providerPaymentId: payment.providerPaymentId,
      eventId: event.eventId,
      eventType: event.eventType,
      provider: event.provider,
      providerStatus: event.providerStatus,
      reason: event.reason ?? null,
      occurredAt: event.occurredAt ?? null,
      webhook: true
    });
    return mapPaymentRecord(updated);
  }

  private async applyPaymentMethodSetupWebhookLocked(event: NormalizedPaymentWebhookEvent): Promise<PaymentMethod> {
    const existingEvent = await this.findPaymentWebhookEventByExternalIdDirect(event.eventId);
    if (existingEvent?.status === "processed") {
      const existingMethod = await this.findPaymentMethodByProviderSetupIdDirect(event.providerPaymentId);
      if (existingMethod) {
        return existingMethod;
      }
    }

    const method = await this.findPaymentMethodByProviderSetupIdDirect(event.providerPaymentId);
    if (!method) {
      throw new AppError(404, "Payment method not found for provider setup id.");
    }

    switch (event.eventType) {
      case "payment_method.setup_succeeded": {
        if (method.status === "active") {
          await this.recordPaymentWebhookEventDirect(event, null, "processed");
          return method;
        }
        if (method.status === "revoked") {
          throw new AppError(409, "Revoked payment method cannot be reactivated.");
        }

        const activeMethods = (await this.listPaymentMethods(method.userId)).filter((item) => item.status === "active");
        const shouldSetDefault =
          typeof method.providerMetadata.requestedDefault === "boolean"
            ? method.providerMetadata.requestedDefault
            : activeMethods.length === 0;
        if (shouldSetDefault) {
          await this.clearDefaultPaymentMethodDirect(method.userId);
        }

        const confirmedAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
        const updated = await this.client.paymentMethod.upsert({
          where: { id: method.id },
          update: {
            providerPaymentMethodId: event.providerPaymentMethodId ?? method.providerPaymentMethodId,
            providerMetadata: asJson({
              ...method.providerMetadata,
              ...event.metadata,
              webhookReconciled: true,
              lastSetupWebhookEventId: event.eventId,
              requestedDefault: shouldSetDefault
            }),
            maskedPan: event.maskedPan ?? method.maskedPan,
            brand: event.brand ?? method.brand,
            status: "active",
            isDefault: shouldSetDefault,
            lastSetupErrorCode: null,
            lastSetupErrorMessage: null,
            confirmedAt,
            updatedAt: confirmedAt
          },
          create: paymentMethodCreateInputFromRecord(method, {
            providerPaymentMethodId: event.providerPaymentMethodId ?? method.providerPaymentMethodId,
            providerMetadata: {
              ...method.providerMetadata,
              ...event.metadata,
              webhookReconciled: true,
              lastSetupWebhookEventId: event.eventId,
              requestedDefault: shouldSetDefault
            },
            maskedPan: event.maskedPan ?? method.maskedPan,
            brand: event.brand ?? method.brand,
            status: "active",
            isDefault: shouldSetDefault,
            lastSetupErrorCode: null,
            lastSetupErrorMessage: null,
            confirmedAt,
            updatedAt: confirmedAt
          })
        });

        await this.recordPaymentWebhookEventDirect(event, null, "processed");
        await this.addAuditDirect(null, "user", method.id, null, "confirmed", {
          kind: "payment_method_setup",
          provider: method.provider,
          providerSetupId: method.providerSetupId,
          providerPaymentMethodId: updated.providerPaymentMethodId,
          status: "active",
          isDefault: updated.isDefault,
          eventId: event.eventId,
          eventType: event.eventType,
          webhook: true
        });
        return mapPaymentMethodRecord(updated);
      }
      case "payment_method.setup_failed": {
        if (method.status === "failed" || method.status === "revoked") {
          await this.recordPaymentWebhookEventDirect(event, null, "processed");
          return method;
        }

        const updatedAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
        const updated = await this.client.paymentMethod.upsert({
          where: { id: method.id },
          update: {
            providerMetadata: asJson({
              ...method.providerMetadata,
              ...event.metadata,
              webhookReconciled: true,
              lastSetupWebhookEventId: event.eventId
            }),
            status: "failed",
            isDefault: false,
            lastSetupErrorCode: "provider_setup_failed",
            lastSetupErrorMessage: event.reason ?? "Не удалось завершить привязку карты.",
            updatedAt
          },
          create: paymentMethodCreateInputFromRecord(method, {
            providerMetadata: {
              ...method.providerMetadata,
              ...event.metadata,
              webhookReconciled: true,
              lastSetupWebhookEventId: event.eventId
            },
            status: "failed",
            isDefault: false,
            lastSetupErrorCode: "provider_setup_failed",
            lastSetupErrorMessage: event.reason ?? "Не удалось завершить привязку карты.",
            updatedAt
          })
        });

        await this.recordPaymentWebhookEventDirect(event, null, "processed");
        await this.addAuditDirect(null, "user", method.id, null, "updated", {
          kind: "payment_method_setup",
          provider: method.provider,
          providerSetupId: method.providerSetupId,
          status: "failed",
          reason: event.reason ?? null,
          eventId: event.eventId,
          eventType: event.eventType,
          webhook: true
        });
        return mapPaymentMethodRecord(updated);
      }
      default:
        throw new AppError(400, "Unsupported payment method setup webhook event.");
    }
  }

  async listAuditLogs(userId: string, collectionId: string): Promise<AuditLog[]> {
    await this.getCollectionForUser(userId, collectionId);
    return (await this.client.auditLog.findMany())
      .filter((log) => log.collectionId === collectionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapAuditLogRecord);
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
        title: category.title,
        emoji: category.emoji ?? null,
        requiresManualConfirmation: category.requiresManualConfirmation ?? false,
        autopayAllowedByDefault: category.autopayAllowedByDefault ?? false,
        sortOrder: index
      })) ??
      DEFAULT_COLLECTION_CATEGORIES[data.collectionType].map((category, index) => ({
        id: randomUUID(),
        title: category.title,
        emoji: category.emoji ?? null,
        requiresManualConfirmation: category.requiresManualConfirmation,
        autopayAllowedByDefault: category.autopayAllowedByDefault,
        sortOrder: index
      }));

    const template = await this.client.collectionTemplate.create({
      include: {
        categories: true
      },
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

    return mapTemplateRecord(template);
  }

  async applyTemplateCategoriesToCollection(userId: string, collectionId: string, templateId: string): Promise<ExpenseCategory[]> {
    const collection = await this.getOrganizerCollectionRecord(userId, collectionId);
    const template = await this.getCollectionTemplate(templateId);
    if (!collection.groupId || collection.groupId !== template.groupId) {
      throw new AppError(400, "Template group does not match collection group.");
    }

    const existingTitles = new Set((await this.listCategories(userId, collectionId)).map((category) => category.title.toLowerCase()));
    let createdCount = 0;
    for (const category of template.categories) {
      if (existingTitles.has(category.title.toLowerCase())) {
        continue;
      }
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
          createdAt: new Date()
        }
      });
      existingTitles.add(category.title.toLowerCase());
      createdCount += 1;
    }

    await this.addAuditDirect(userId, "collection", collectionId, collectionId, "updated", { templateId, appliedCategoryCount: createdCount });
    return await this.listCategories(userId, collectionId);
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

  private async getCollectionStateRecord(collectionId: string) {
    const collection = (
      await this.client.collection.findMany({
        include: {
          participants: true,
            expenses: {
              include: {
                items: true,
                payments: true,
                shareRules: true
              }
          }
        }
      })
    ).find((item) => item.id === collectionId);
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

  private async getGroupParticipantProfileRecord(profileId: string) {
    const profile = (await this.client.groupParticipantProfile.findMany()).find((item) => item.id === profileId);
    if (!profile) {
      throw new AppError(404, "Participant profile not found.");
    }
    return profile;
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
    const collection = (await this.client.collection.findMany({ include: { expenses: { include: { items: true } } } })).find((item) =>
      item.expenses.some((expense) => expense.id === expenseId)
    );
    const expense = collection?.expenses.find((item) => item.id === expenseId);
    if (!expense) {
      throw new AppError(404, "Expense not found.");
    }
    return expense;
  }

  private async getExpenseItemRecord(expenseId: string, expenseItemId: string) {
    const item = (await this.client.expenseItem.findMany()).find((entry) => entry.id === expenseItemId && entry.expenseId === expenseId);
    if (!item) {
      throw new AppError(404, "Expense item not found.");
    }
    return item;
  }

  private async getCalculationVersionRecords(collectionId: string): Promise<CalculationVersion[]> {
    return (await this.client.calculationVersion.findMany())
      .filter((item) => item.collectionId === collectionId)
      .sort((a, b) => a.version - b.version || a.createdAt.getTime() - b.createdAt.getTime())
      .map(mapCalculationVersionRecord);
  }

  private async getDisputeRecord(disputeId: string): Promise<Dispute> {
    const dispute = (await this.client.dispute.findMany()).find((item) => item.id === disputeId);
    if (!dispute) {
      throw new AppError(404, "Dispute not found.");
    }
    return mapDisputeRecord(dispute);
  }

  private async updateDisputeDirect(
    dispute: Dispute,
    status: Dispute["status"],
    resolutionComment: string | null
  ): Promise<Dispute> {
    const resolvedAt = ["accepted", "rejected", "resolved_by_recalculation", "cancelled"].includes(status) ? new Date() : null;
    const updated = await this.client.dispute.upsert({
      where: { id: dispute.id },
      update: {
        status,
        resolutionComment,
        resolvedAt
      },
      create: disputeCreateInputFromRecord(dispute, {
        status,
        resolutionComment,
        resolvedAt
      })
    });
    return mapDisputeRecord(updated);
  }

  private async getManualPaymentForUserDirect(userId: string, proofId: string): Promise<ManualPaymentProof> {
    const proof = (await this.client.manualPaymentProof.findMany()).find((item) => item.id === proofId);
    if (!proof || proof.payerUserId !== userId) {
      throw new AppError(404, "Manual payment proof not found.");
    }
    return mapManualPaymentProofRecord(proof);
  }

  private async getManualPaymentForReviewerDirect(userId: string, proofId: string): Promise<ManualPaymentProof> {
    const proof = (await this.client.manualPaymentProof.findMany()).find((item) => item.id === proofId);
    if (!proof) {
      throw new AppError(404, "Manual payment proof not found.");
    }

    const collection = await this.getCollectionRecord(proof.collectionId);
    if (collection.organizerId === userId || proof.receiverUserId === userId) {
      return mapManualPaymentProofRecord(proof);
    }

    throw new AppError(403, "User cannot review this manual payment.");
  }

  private async hasOnlyConfirmedManualPaymentsDirect(collectionId: string): Promise<boolean> {
    const proofs = (await this.client.manualPaymentProof.findMany()).filter((proof) => proof.collectionId === collectionId);
    return proofs.length > 0 && proofs.every((proof) => proof.status === "confirmed");
  }

  private async findManualPaymentByIdempotencyKeyDirect(
    collectionId: string,
    idempotencyKey: string
  ): Promise<ManualPaymentProof | null> {
    const proof = (await this.client.manualPaymentProof.findMany()).find(
      (item) => item.collectionId === collectionId && item.idempotencyKey === idempotencyKey
    );

    return proof ? mapManualPaymentProofRecord(proof) : null;
  }

  private async getPaymentMethodForUserDirect(userId: string, paymentMethodId: string): Promise<PaymentMethod> {
    const method = (await this.client.paymentMethod.findMany()).find((item) => item.id === paymentMethodId);
    if (!method || method.userId !== userId) {
      throw new AppError(404, "Payment method not found.");
    }
    return mapPaymentMethodRecord(method);
  }

  private async findProviderCustomerIdDirect(userId: string, provider: PaymentMethod["provider"]): Promise<string | null> {
    return (
      (await this.client.paymentMethod.findMany())
        .map(mapPaymentMethodRecord)
        .find((method) => method.userId === userId && method.provider === provider && Boolean(method.providerCustomerId))
        ?.providerCustomerId ?? null
    );
  }

  private async getOwnAutoPaymentRuleDirect(userId: string, ruleId: string): Promise<AutoPaymentRule> {
    const rule = (await this.client.autoPaymentRule.findMany()).find((item) => item.id === ruleId);
    if (!rule || rule.userId !== userId) {
      throw new AppError(404, "Auto payment rule not found.");
    }
    return mapAutoPaymentRuleRecord(rule);
  }

  private async clearDefaultPaymentMethodDirect(userId: string): Promise<void> {
    const methods = (await this.client.paymentMethod.findMany()).filter((method) => method.userId === userId && method.isDefault);
    for (const method of methods) {
      await this.client.paymentMethod.upsert({
        where: { id: method.id },
        update: {
          isDefault: false,
          updatedAt: new Date()
        },
        create: paymentMethodCreateInputFromRecord(mapPaymentMethodRecord(method), {
          isDefault: false,
          updatedAt: new Date()
        })
      });
    }
  }

  private async promoteFallbackDefaultPaymentMethodDirect(userId: string, excludedPaymentMethodId: string): Promise<void> {
    const fallback = (await this.client.paymentMethod.findMany())
      .filter((method) => method.userId === userId && method.id !== excludedPaymentMethodId && method.status === "active")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!fallback) {
      return;
    }
    await this.client.paymentMethod.upsert({
      where: { id: fallback.id },
      update: {
        isDefault: true,
        updatedAt: new Date()
      },
      create: paymentMethodCreateInputFromRecord(mapPaymentMethodRecord(fallback), {
        isDefault: true,
        updatedAt: new Date()
      })
    });
  }

  private async buildAutoPaymentExecutionPlan(collectionId: string): Promise<AutoPaymentExecutionPlan> {
    const collection = await this.getCollectionRecord(collectionId);
    const calculationVersion = (await this.getCalculationVersionRecords(collectionId)).at(-1);
    if (!calculationVersion) {
      throw new AppError(409, "Auto payment execution requires a calculation.");
    }

    return buildAutoPaymentPlan({
      collectionId,
      collectionGroupId: collection.groupId,
      nowIso: new Date().toISOString(),
      calculationVersion,
      participants: await this.listParticipants(collection.organizerId, collectionId),
      categories: (await this.client.expenseCategory.findMany())
        .filter((category) => category.collectionId === collectionId)
        .map(mapCategoryRecord),
      paymentMethods: (await this.client.paymentMethod.findMany()).map(mapPaymentMethodRecord),
      autoPaymentRules: (await this.client.autoPaymentRule.findMany()).map(mapAutoPaymentRuleRecord),
      payments: (await this.client.payment.findMany())
        .filter((payment) => payment.collectionId === collectionId)
        .map(mapPaymentRecord)
    });
  }

  private async findPaymentByIdempotencyKeyDirect(collectionId: string, idempotencyKey: string): Promise<Payment | null> {
    const payment = (await this.client.payment.findMany()).find(
      (item) => item.collectionId === collectionId && item.idempotencyKey === idempotencyKey
    );
    return payment ? mapPaymentRecord(payment) : null;
  }

  private async createAutoPaymentDirect(data: {
    collectionId: string;
    participantId: string;
    responsibleUserId: string;
    amountMinor: number;
    provider: Payment["provider"];
    paymentMethod: PaymentMethod | null;
    idempotencyKey: string;
  }): Promise<Payment> {
    const paymentId = randomUUID();
    const intent = getPaymentProviderAdapter(data.provider).createPaymentIntent({
      provider: data.provider,
      paymentId,
      collectionId: data.collectionId,
      participantId: data.participantId,
      responsibleUserId: data.responsibleUserId,
      amountMinor: data.amountMinor,
      currency: "RUB",
      idempotencyKey: data.idempotencyKey,
      paymentMethod: data.paymentMethod
    });
    const createdAt = new Date();
    const payment = await this.client.payment.upsert({
      where: { id: paymentId },
      update: {},
      create: {
        id: paymentId,
        collectionId: data.collectionId,
        participantId: data.participantId,
        responsibleUserId: data.responsibleUserId,
        paymentMethodId: data.paymentMethod?.id ?? null,
        amountMinor: data.amountMinor,
        currency: "RUB",
        provider: data.provider,
        providerPaymentId: intent.providerPaymentId,
        providerStatus: intent.providerStatus,
        providerMetadata: asJson(intent.providerMetadata),
        status: "pending",
        lastErrorCode: null,
        lastErrorMessage: null,
        attemptCount: 1,
        lastWebhookEventId: null,
        lastWebhookReceivedAt: null,
        idempotencyKey: data.idempotencyKey,
        createdAt,
        updatedAt: createdAt
      }
    });
    await this.setParticipantPaymentStatusDirect(data.collectionId, data.participantId, "pending");
    await this.bumpCollectionStatus(data.collectionId, "payment_pending");
    return mapPaymentRecord(payment);
  }

  private async findPaymentByProviderPaymentIdDirect(providerPaymentId: string): Promise<Payment | null> {
    const payment = (await this.client.payment.findMany()).find((item) => item.providerPaymentId === providerPaymentId);
    return payment ? mapPaymentRecord(payment) : null;
  }

  private async findPaymentMethodByProviderSetupIdDirect(providerSetupId: string): Promise<PaymentMethod | null> {
    const method = (await this.client.paymentMethod.findMany()).find((item) => item.providerSetupId === providerSetupId);
    return method ? mapPaymentMethodRecord(method) : null;
  }

  private async findPaymentWebhookEventByExternalIdDirect(externalEventId: string): Promise<PaymentWebhookEvent | null> {
    const event = (await this.client.paymentWebhookEvent.findMany()).find((item) => item.externalEventId === externalEventId);
    return event ? mapPaymentWebhookEventRecord(event) : null;
  }

  private async recordPaymentWebhookEventDirect(
    event: NormalizedPaymentWebhookEvent,
    paymentId: string | null,
    status: PaymentWebhookEvent["status"],
    processingError: string | null = null
  ): Promise<PaymentWebhookEvent> {
    const existing = await this.findPaymentWebhookEventByExternalIdDirect(event.eventId);
    const attemptedAt = new Date();
    const attemptCount = (existing?.attemptCount ?? 0) + 1;
    const record = await this.client.paymentWebhookEvent.upsert({
      where: { externalEventId: event.eventId },
      update: {
        paymentId,
        status,
        processingError,
        attemptCount,
        lastAttemptedAt: attemptedAt,
        nextRetryAt: null,
        deadLetteredAt: null,
        processedAt: attemptedAt,
        payload: asJson(event.rawPayload)
      },
      create: {
        id: existing?.id ?? randomUUID(),
        provider: event.provider,
        externalEventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
        paymentId,
        eventType: event.eventType,
        status,
        payload: asJson(event.rawPayload),
        processingError,
        attemptCount,
        lastAttemptedAt: attemptedAt,
        nextRetryAt: null,
        deadLetteredAt: null,
        receivedAt: existing?.receivedAt ? new Date(existing.receivedAt) : attemptedAt,
        processedAt: attemptedAt
      }
    });
    return mapPaymentWebhookEventRecord(record);
  }

  private async failPaymentWebhookEventDirect(
    event: NormalizedPaymentWebhookEvent,
    paymentId: string | null,
    error: AppError
  ): Promise<never> {
    const existing = await this.findPaymentWebhookEventByExternalIdDirect(event.eventId);
    const attemptCount = (existing?.attemptCount ?? 0) + 1;
    const attemptedAt = new Date();
    const retryable = isRetryableWebhookError(error);
    const deadLettered = !retryable || attemptCount >= WEBHOOK_RETRY_MAX_ATTEMPTS;
    const nextRetryAt = !deadLettered && retryable ? new Date(attemptedAt.getTime() + getWebhookRetryDelayMs(attemptCount)) : null;

    await this.client.paymentWebhookEvent.upsert({
      where: { externalEventId: event.eventId },
      update: {
        paymentId,
        status: deadLettered ? "dead_lettered" : "failed",
        processingError: error.message,
        attemptCount,
        lastAttemptedAt: attemptedAt,
        nextRetryAt,
        deadLetteredAt: deadLettered ? attemptedAt : null,
        processedAt: attemptedAt,
        payload: asJson(event.rawPayload)
      },
      create: {
        id: existing?.id ?? randomUUID(),
        provider: event.provider,
        externalEventId: event.eventId,
        providerPaymentId: event.providerPaymentId,
        paymentId,
        eventType: event.eventType,
        status: deadLettered ? "dead_lettered" : "failed",
        payload: asJson(event.rawPayload),
        processingError: error.message,
        attemptCount,
        lastAttemptedAt: attemptedAt,
        nextRetryAt,
        deadLetteredAt: deadLettered ? attemptedAt : null,
        receivedAt: existing?.receivedAt ? new Date(existing.receivedAt) : attemptedAt,
        processedAt: attemptedAt
      }
    });

    throw error;
  }

  private async getRetryableWebhookEventsDirect(options?: {
    ignoreSchedule?: boolean;
    maxEvents?: number;
  }): Promise<PaymentWebhookEvent[]> {
    const nowIso = new Date().toISOString();
    const candidates = (await this.client.paymentWebhookEvent.findMany())
      .map(mapPaymentWebhookEventRecord)
      .filter((event) => event.status === "failed")
      .filter((event) => options?.ignoreSchedule || !event.nextRetryAt || event.nextRetryAt <= nowIso)
      .sort((left, right) => (left.nextRetryAt ?? left.receivedAt).localeCompare(right.nextRetryAt ?? right.receivedAt));

    if (!options?.maxEvents || options.maxEvents <= 0) {
      return candidates;
    }

    return candidates.slice(0, options.maxEvents);
  }

  private toNormalizedWebhookEvent(event: PaymentWebhookEvent): NormalizedPaymentWebhookEvent {
    return {
      provider: event.provider,
      eventId: event.externalEventId,
      providerPaymentId: event.providerPaymentId,
      eventType: event.eventType,
      occurredAt: event.processedAt ?? event.receivedAt,
      reason: typeof event.payload.reason === "string" ? event.payload.reason : null,
      providerStatus:
        typeof event.payload.providerStatus === "string" ? event.payload.providerStatus : defaultProviderStatusForEvent(event.eventType),
      providerPaymentMethodId:
        typeof event.payload.providerPaymentMethodId === "string" ? event.payload.providerPaymentMethodId : null,
      maskedPan: typeof event.payload.maskedPan === "string" ? event.payload.maskedPan : null,
      brand: isPaymentCardBrand(event.payload.brand) ? event.payload.brand : null,
      metadata: isPlainRecord(event.payload.metadata) ? event.payload.metadata : {},
      rawPayload: event.payload
    };
  }

  private async getPaymentForActorDirect(userId: string, paymentId: string): Promise<Payment> {
    const payment = (await this.client.payment.findMany()).find((item) => item.id === paymentId);
    if (!payment) {
      throw new AppError(404, "Payment not found.");
    }

    const collection = await this.getCollectionRecord(payment.collectionId);
    if (payment.responsibleUserId === userId || collection.organizerId === userId) {
      return mapPaymentRecord(payment);
    }

    throw new AppError(403, "User cannot access this payment.");
  }

  private async setParticipantPaymentStatusDirect(
    collectionId: string,
    participantId: string,
    paymentStatus: CollectionParticipant["paymentStatus"]
  ): Promise<void> {
    const participant = await this.getParticipantRecord(collectionId, participantId);
    await this.client.collectionParticipant.upsert({
      where: { id: participant.id },
      update: {
        paymentStatus,
        updatedAt: new Date()
      },
      create: participantCreateInputFromRecord(participant, {
        paymentStatus,
        updatedAt: new Date()
      })
    });
  }

  private async syncCollectionPaymentStatusDirect(collectionId: string): Promise<void> {
    const participants = (await this.client.collectionParticipant.findMany()).filter(
      (participant) => participant.collectionId === collectionId && participant.finalShareAmountMinor > 0
    );
    if (participants.length === 0) {
      await this.bumpCollectionStatus(collectionId, "finalized");
      return;
    }

    const paidCount = participants.filter(
      (participant) => participant.paymentStatus === "paid" || participant.paymentStatus === "manual_marked_paid"
    ).length;
    if (paidCount === 0) {
      await this.bumpCollectionStatus(collectionId, "payment_pending");
      return;
    }
    if (paidCount === participants.length) {
      await this.bumpCollectionStatus(collectionId, "paid");
      return;
    }
    await this.bumpCollectionStatus(collectionId, "partially_paid");
  }

  private async canActForParticipant(userId: string, participant: CollectionParticipant | Awaited<ReturnType<PrismaStore["getParticipantRecord"]>>): Promise<boolean> {
    const collection = await this.getCollectionRecord(participant.collectionId);
    if (collection.organizerId === userId || participant.linkedUserId === userId) {
      return true;
    }

    if (!participant.paymentResponsibleParticipantId) {
      return false;
    }

    const responsibleParticipant = await this.getParticipantRecord(participant.collectionId, participant.paymentResponsibleParticipantId);
    return responsibleParticipant.linkedUserId === userId;
  }

  private async notifyManualPaymentReviewersDirect(
    collectionId: string,
    proof: ManualPaymentProof,
    type: NotificationType,
    title: string,
    body: string
  ): Promise<void> {
    const collection = await this.getCollectionRecord(collectionId);
    const userIds = new Set<string>([collection.organizerId]);
    if (proof.receiverUserId) {
      userIds.add(proof.receiverUserId);
    }
    userIds.delete(proof.payerUserId);

    for (const targetUserId of userIds) {
      await this.addNotificationDirect(targetUserId, collectionId, type, title, body);
    }
  }

  private async addNotificationDirect(
    userId: string,
    collectionId: string | null,
    type: NotificationType,
    title: string,
    body: string
  ): Promise<Notification> {
    const id = randomUUID();
    const created = await this.client.notification.upsert({
      where: { id },
      update: {},
      create: {
        id,
        userId,
        collectionId,
        type,
        title,
        body,
        status: "unread",
        createdAt: new Date(),
        readAt: null
      }
    });
    return mapNotificationRecord(created);
  }

  private async addAuditDirect(
    actorUserId: string | null,
    entityType: AuditEntityType,
    entityId: string,
    collectionId: string | null,
    action: AuditAction,
    metadata: Record<string, unknown>
  ): Promise<AuditLog> {
    const id = randomUUID();
    const created = await this.client.auditLog.upsert({
      where: { id },
      update: {},
      create: {
        id,
        actorUserId,
        entityType,
        entityId,
        collectionId,
        action,
        metadata: asJson(metadata),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date()
      }
    });
    return mapAuditLogRecord(created);
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

  private async recalculateExpenseAmountFromItemsDirect(expenseId: string): Promise<void> {
    const expense = await this.getExpenseRecord(expenseId);
    const amountMinor = (await this.client.expenseItem.findMany())
      .filter((item) => item.expenseId === expenseId)
      .reduce((sum, item) => sum + item.amountMinor, 0);
    await this.client.expense.upsert({
      where: { id: expenseId },
      update: {
        amountMinor,
        updatedAt: new Date()
      },
      create: {
        ...expenseCreateInputFromRecord(expense, { amountMinor, updatedAt: new Date() })
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

function mapGroupParticipantProfileRecord(record: {
  id: string;
  groupId: string;
  ownerUserId: string;
  linkedUserId: string | null;
  invitedPhone: string | null;
  participantType: GroupParticipantProfile["participantType"];
  displayName: string;
  relationshipHint: string;
  defaultWeight: { toNumber?: () => number } | number;
  createdAt: Date;
  updatedAt: Date;
}): GroupParticipantProfile {
  return {
    id: record.id,
    groupId: record.groupId,
    ownerUserId: record.ownerUserId,
    linkedUserId: record.linkedUserId,
    invitedPhone: record.invitedPhone,
    participantType: record.participantType,
    displayName: record.displayName,
    relationshipHint: normalizeRelationshipHint(record.relationshipHint),
    defaultWeight: typeof record.defaultWeight === "number" ? record.defaultWeight : (record.defaultWeight.toNumber?.() ?? 1),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
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

function mapPaymentMethodRecord(record: {
  id: string;
  userId: string;
  provider: string;
  providerCustomerId: string | null;
  providerSetupId: string | null;
  providerPaymentMethodId: string;
  providerMetadata: Prisma.JsonValue;
  maskedPan: string;
  brand: PaymentMethod["brand"];
  status: PaymentMethod["status"];
  isDefault: boolean;
  lastSetupErrorCode: string | null;
  lastSetupErrorMessage: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentMethod {
  return {
    id: record.id,
    userId: record.userId,
    provider: normalizePaymentProvider(record.provider),
    providerCustomerId: record.providerCustomerId,
    providerSetupId: record.providerSetupId,
    providerPaymentMethodId: record.providerPaymentMethodId,
    providerMetadata: (record.providerMetadata ?? {}) as Record<string, unknown>,
    maskedPan: record.maskedPan,
    brand: record.brand,
    status: record.status,
    isDefault: record.isDefault,
    lastSetupErrorCode: record.lastSetupErrorCode,
    lastSetupErrorMessage: record.lastSetupErrorMessage,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
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

function mapPaymentRecord(record: {
  id: string;
  collectionId: string;
  participantId: string | null;
  responsibleUserId: string;
  paymentMethodId: string | null;
  amountMinor: number;
  currency: string;
  provider: Payment["provider"];
  providerPaymentId: string | null;
  providerStatus: string | null;
  providerMetadata: Prisma.JsonValue;
  status: Payment["status"];
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  attemptCount: number;
  lastWebhookEventId: string | null;
  lastWebhookReceivedAt: Date | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}): Payment {
  return {
    id: record.id,
    collectionId: record.collectionId,
    participantId: record.participantId,
    responsibleUserId: record.responsibleUserId,
    paymentMethodId: record.paymentMethodId,
    amountMinor: record.amountMinor,
    currency: "RUB",
    provider: record.provider,
    providerPaymentId: record.providerPaymentId,
    providerStatus: record.providerStatus,
    providerMetadata: (record.providerMetadata ?? {}) as Record<string, unknown>,
    status: record.status,
    lastErrorCode: record.lastErrorCode,
    lastErrorMessage: record.lastErrorMessage,
    attemptCount: record.attemptCount,
    lastWebhookEventId: record.lastWebhookEventId,
    lastWebhookReceivedAt: record.lastWebhookReceivedAt?.toISOString() ?? null,
    idempotencyKey: record.idempotencyKey,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapPaymentWebhookEventRecord(record: {
  id: string;
  provider: string;
  externalEventId: string;
  providerPaymentId: string;
  paymentId: string | null;
  eventType: string;
  status: string;
  payload: Prisma.JsonValue;
  processingError: string | null;
  attemptCount: number;
  lastAttemptedAt: Date | null;
  nextRetryAt: Date | null;
  deadLetteredAt: Date | null;
  receivedAt: Date;
  processedAt: Date | null;
}): PaymentWebhookEvent {
  return {
    id: record.id,
    provider: normalizePaymentProvider(record.provider),
    externalEventId: record.externalEventId,
    providerPaymentId: record.providerPaymentId,
    paymentId: record.paymentId,
    eventType: record.eventType as PaymentWebhookEvent["eventType"],
    status: record.status as PaymentWebhookEvent["status"],
    payload: (record.payload ?? {}) as Record<string, unknown>,
    processingError: record.processingError,
    attemptCount: record.attemptCount,
    lastAttemptedAt: record.lastAttemptedAt?.toISOString() ?? null,
    nextRetryAt: record.nextRetryAt?.toISOString() ?? null,
    deadLetteredAt: record.deadLetteredAt?.toISOString() ?? null,
    receivedAt: record.receivedAt.toISOString(),
    processedAt: record.processedAt?.toISOString() ?? null
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

function mapAutoPaymentRuleRecord(record: {
  id: string;
  userId: string;
  collectionId: string | null;
  groupId: string | null;
  category: string | null;
  enabled: boolean;
  singleCollectionLimitMinor: number;
  dailyLimitMinor: number;
  monthlyLimitMinor: number;
  requiresObjectionWindow: boolean;
  objectionWindowHours: number;
  allowGuests: boolean;
  allowChildren: boolean;
  allowPartner: boolean;
  maxCoveredParticipants: number;
  createdAt: Date;
  updatedAt: Date;
}): AutoPaymentRule {
  return {
    id: record.id,
    userId: record.userId,
    collectionId: record.collectionId,
    groupId: record.groupId,
    category: record.category,
    enabled: record.enabled,
    singleCollectionLimitMinor: record.singleCollectionLimitMinor,
    dailyLimitMinor: record.dailyLimitMinor,
    monthlyLimitMinor: record.monthlyLimitMinor,
    requiresObjectionWindow: record.requiresObjectionWindow,
    objectionWindowHours: record.objectionWindowHours,
    allowGuests: record.allowGuests,
    allowChildren: record.allowChildren,
    allowPartner: record.allowPartner,
    maxCoveredParticipants: record.maxCoveredParticipants,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
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

function mapExpenseItemRecord(record: {
  id: string;
  expenseId: string;
  title: string;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  splitMode: ExpenseItem["splitMode"];
  createdAt: Date;
  updatedAt: Date;
}): ExpenseItem {
  return {
    id: record.id,
    expenseId: record.expenseId,
    title: record.title,
    amountMinor: record.amountMinor,
    currency: "RUB",
    categoryId: record.categoryId,
    splitMode: record.splitMode,
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

function mapCalculationVersionRecord(record: {
  id: string;
  collectionId: string;
  version: number;
  status: CalculationVersion["status"];
  totalAmountMinor: number;
  createdByUserId: string;
  result: Prisma.JsonValue;
  createdAt: Date;
}): CalculationVersion {
  return {
    id: record.id,
    collectionId: record.collectionId,
    version: record.version,
    status: record.status,
    totalAmountMinor: record.totalAmountMinor,
    createdByUserId: record.createdByUserId,
    result: record.result as unknown as CalculationVersion["result"],
    createdAt: record.createdAt.toISOString()
  };
}

function mapDisputeRecord(record: {
  id: string;
  collectionId: string;
  participantId: string;
  createdByUserId: string;
  targetParticipantId: string | null;
  type: Dispute["type"];
  message: string;
  status: Dispute["status"];
  resolutionComment: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}): Dispute {
  return {
    id: record.id,
    collectionId: record.collectionId,
    participantId: record.participantId,
    createdByUserId: record.createdByUserId,
    targetParticipantId: record.targetParticipantId,
    type: record.type,
    message: record.message,
    status: record.status,
    resolutionComment: record.resolutionComment,
    createdAt: record.createdAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null
  };
}

function mapManualPaymentProofRecord(record: {
  id: string;
  idempotencyKey: string | null;
  transferPlanId: string | null;
  collectionId: string;
  payerUserId: string;
  payerParticipantId: string | null;
  receiverUserId: string | null;
  receiverParticipantId: string | null;
  amountMinor: number;
  method: ManualPaymentProof["method"];
  comment: string | null;
  proofUrl: string | null;
  status: ManualPaymentProof["status"];
  createdAt: Date;
  updatedAt: Date;
}): ManualPaymentProof {
  return {
    id: record.id,
    idempotencyKey: record.idempotencyKey,
    transferPlanId: record.transferPlanId,
    collectionId: record.collectionId,
    payerUserId: record.payerUserId,
    payerParticipantId: record.payerParticipantId,
    receiverUserId: record.receiverUserId,
    receiverParticipantId: record.receiverParticipantId,
    amountMinor: record.amountMinor,
    method: record.method,
    comment: record.comment,
    proofUrl: record.proofUrl,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapAuditLogRecord(record: {
  id: string;
  actorUserId: string | null;
  entityType: AuditLog["entityType"];
  entityId: string;
  collectionId: string | null;
  action: AuditLog["action"];
  metadata: Prisma.JsonValue;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}): AuditLog {
  return {
    id: record.id,
    actorUserId: record.actorUserId,
    entityType: record.entityType,
    entityId: record.entityId,
    collectionId: record.collectionId,
    action: record.action,
    metadata: (record.metadata ?? {}) as Record<string, unknown>,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    createdAt: record.createdAt.toISOString()
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

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;
const WEBHOOK_RETRY_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length;

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }
  return value;
}

function resolveManualPaymentIdempotencyKey(
  userId: string,
  collectionId: string,
  data: {
    payerParticipantId?: string | null;
    receiverParticipantId?: string | null;
    amountMinor: number;
    method: ManualPaymentProof["method"];
    comment?: string | null;
    proofUrl?: string | null;
    transferPlanId?: string | null;
    idempotencyKey?: string | null;
  }
): string {
  if (data.idempotencyKey?.trim()) {
    return `manual:${collectionId}:${userId}:${data.idempotencyKey.trim()}`;
  }

  return createHash("sha256")
    .update(
      stableJson({
        kind: "manual-payment",
        collectionId,
        userId,
        payerParticipantId: data.payerParticipantId ?? null,
        receiverParticipantId: data.receiverParticipantId ?? null,
        amountMinor: data.amountMinor,
        method: data.method,
        comment: data.comment ?? null,
        proofUrl: data.proofUrl ?? null,
        transferPlanId: data.transferPlanId ?? null
      })
    )
    .digest("hex");
}

function isSameManualPaymentRequest(
  proof: ManualPaymentProof,
  userId: string,
  payerParticipantId: string | null,
  receiverParticipantId: string | null,
  data: {
    amountMinor: number;
    method: ManualPaymentProof["method"];
    comment?: string | null;
    proofUrl?: string | null;
    transferPlanId?: string | null;
  },
  idempotencyKey: string
): boolean {
  return (
    proof.idempotencyKey === idempotencyKey &&
    proof.payerUserId === userId &&
    proof.payerParticipantId === payerParticipantId &&
    proof.receiverParticipantId === receiverParticipantId &&
    proof.amountMinor === data.amountMinor &&
    proof.method === data.method &&
    proof.comment === (data.comment ?? null) &&
    proof.proofUrl === (data.proofUrl ?? null) &&
    proof.transferPlanId === (data.transferPlanId ?? null)
  );
}

function resolveMockPaymentIdempotencyKey(userId: string, collectionId: string, idempotencyKey: string): string {
  return `payment:${collectionId}:${userId}:${idempotencyKey.trim()}`;
}

function isSameMockPaymentRequest(
  payment: Payment,
  userId: string,
  data: {
    participantId: string;
    amountMinor: number;
    provider?: Payment["provider"];
    paymentMethodId?: string | null;
  },
  normalizedIdempotencyKey: string
): boolean {
  return (
    payment.idempotencyKey === normalizedIdempotencyKey &&
    payment.responsibleUserId === userId &&
    payment.participantId === data.participantId &&
    payment.amountMinor === data.amountMinor &&
    payment.paymentMethodId === (data.paymentMethodId ?? null) &&
    payment.provider === normalizePaymentProvider(data.provider ?? payment.provider)
  );
}

function toSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getWebhookRetryDelayMs(attemptCount: number): number {
  return WEBHOOK_RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), WEBHOOK_RETRY_DELAYS_MS.length - 1)];
}

function isRetryableWebhookError(error: AppError): boolean {
  return error.statusCode === 404 || error.statusCode >= 500;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function defaultProviderStatusForEvent(eventType: PaymentWebhookEvent["eventType"]): string {
  switch (eventType) {
    case "payment.succeeded":
      return "succeeded";
    case "payment.failed":
      return "failed";
    case "payment.refunded":
      return "refunded";
    case "payment_method.setup_succeeded":
      return "active";
    case "payment_method.setup_failed":
      return "failed";
  }
}

function isPaymentCardBrand(value: unknown): value is PaymentCardBrand {
  return value === "visa" || value === "mastercard" || value === "mir" || value === "unknown";
}

function participantCreateInputFromRecord(
  participant: {
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
  },
  overrides?: Partial<{
    paymentResponsibleParticipantId: string | null;
    status: CollectionParticipant["status"];
    finalShareAmountMinor: number;
    paymentStatus: CollectionParticipant["paymentStatus"];
    updatedAt: Date;
  }>
) {
  return {
    id: participant.id,
    collectionId: participant.collectionId,
    participantType: participant.participantType,
    linkedUserId: participant.linkedUserId,
    invitedPhone: participant.invitedPhone,
    displayNameSnapshot: participant.displayNameSnapshot,
    invitedByUserId: participant.invitedByUserId,
    paymentResponsibleParticipantId: overrides?.paymentResponsibleParticipantId ?? participant.paymentResponsibleParticipantId,
    relationshipHint: normalizeRelationshipHint(participant.relationshipHint),
    defaultWeight: typeof participant.defaultWeight === "number" ? participant.defaultWeight : (participant.defaultWeight.toNumber?.() ?? 1),
    status: overrides?.status ?? participant.status,
    finalShareAmountMinor: overrides?.finalShareAmountMinor ?? participant.finalShareAmountMinor,
    paymentStatus: overrides?.paymentStatus ?? participant.paymentStatus,
    createdAt: participant.createdAt,
    updatedAt: overrides?.updatedAt ?? participant.updatedAt
  };
}

function calculationVersionCreateInputFromRecord(
  version: CalculationVersion,
  overrides?: Partial<{
    status: CalculationVersion["status"];
  }>
) {
  return {
    id: version.id,
    collectionId: version.collectionId,
    version: version.version,
    status: overrides?.status ?? version.status,
    totalAmountMinor: version.totalAmountMinor,
    createdByUserId: version.createdByUserId,
    result: asJson(version.result),
    createdAt: new Date(version.createdAt)
  };
}

function disputeCreateInputFromRecord(
  dispute: Dispute,
  overrides?: Partial<{
    status: Dispute["status"];
    resolutionComment: string | null;
    resolvedAt: Date | null;
  }>
) {
  return {
    id: dispute.id,
    collectionId: dispute.collectionId,
    participantId: dispute.participantId,
    createdByUserId: dispute.createdByUserId,
    targetParticipantId: dispute.targetParticipantId,
    type: dispute.type,
    message: dispute.message,
    status: overrides?.status ?? dispute.status,
    resolutionComment: overrides?.resolutionComment ?? dispute.resolutionComment,
    createdAt: new Date(dispute.createdAt),
    resolvedAt: overrides?.resolvedAt ?? (dispute.resolvedAt ? new Date(dispute.resolvedAt) : null)
  };
}

function manualPaymentCreateInputFromRecord(
  proof: ManualPaymentProof,
  overrides?: Partial<{
    comment: string | null;
    proofUrl: string | null;
    status: ManualPaymentProof["status"];
    updatedAt: Date;
  }>
) {
  return {
    id: proof.id,
    idempotencyKey: proof.idempotencyKey,
    transferPlanId: proof.transferPlanId,
    collectionId: proof.collectionId,
    payerUserId: proof.payerUserId,
    payerParticipantId: proof.payerParticipantId,
    receiverUserId: proof.receiverUserId,
    receiverParticipantId: proof.receiverParticipantId,
    amountMinor: proof.amountMinor,
    method: proof.method,
    comment: overrides?.comment ?? proof.comment,
    proofUrl: overrides?.proofUrl ?? proof.proofUrl,
    status: overrides?.status ?? proof.status,
    createdAt: new Date(proof.createdAt),
    updatedAt: overrides?.updatedAt ?? new Date(proof.updatedAt)
  };
}

function paymentMethodCreateInputFromRecord(
  method: PaymentMethod,
  overrides?: Partial<{
    status: PaymentMethod["status"];
    isDefault: boolean;
    providerCustomerId: string | null;
    providerSetupId: string | null;
    providerPaymentMethodId: string;
    providerMetadata: Record<string, unknown>;
    maskedPan: string;
    brand: PaymentMethod["brand"];
    lastSetupErrorCode: string | null;
    lastSetupErrorMessage: string | null;
    confirmedAt: Date | null;
    updatedAt: Date;
  }>
) {
  return {
    id: method.id,
    userId: method.userId,
    provider: method.provider,
    providerCustomerId: overrides?.providerCustomerId ?? method.providerCustomerId,
    providerSetupId: overrides?.providerSetupId ?? method.providerSetupId,
    providerPaymentMethodId: overrides?.providerPaymentMethodId ?? method.providerPaymentMethodId,
    providerMetadata: asJson(overrides?.providerMetadata ?? method.providerMetadata),
    maskedPan: overrides?.maskedPan ?? method.maskedPan,
    brand: overrides?.brand ?? method.brand,
    status: overrides?.status ?? method.status,
    isDefault: overrides?.isDefault ?? method.isDefault,
    lastSetupErrorCode: overrides?.lastSetupErrorCode ?? method.lastSetupErrorCode,
    lastSetupErrorMessage: overrides?.lastSetupErrorMessage ?? method.lastSetupErrorMessage,
    confirmedAt:
      overrides?.confirmedAt !== undefined
        ? overrides.confirmedAt
        : method.confirmedAt
          ? new Date(method.confirmedAt)
          : null,
    createdAt: new Date(method.createdAt),
    updatedAt: overrides?.updatedAt ?? new Date(method.updatedAt)
  };
}

function paymentCreateInputFromRecord(
  payment: Payment,
  overrides?: Partial<{
    status: Payment["status"];
    providerStatus: string | null;
    providerMetadata: Record<string, unknown>;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    attemptCount: number;
    lastWebhookEventId: string | null;
    lastWebhookReceivedAt: Date | null;
    updatedAt: Date;
  }>
) {
  return {
    id: payment.id,
    collectionId: payment.collectionId,
    participantId: payment.participantId,
    responsibleUserId: payment.responsibleUserId,
    paymentMethodId: payment.paymentMethodId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    providerStatus: overrides?.providerStatus ?? payment.providerStatus,
    providerMetadata: asJson(overrides?.providerMetadata ?? payment.providerMetadata),
    status: overrides?.status ?? payment.status,
    lastErrorCode: overrides?.lastErrorCode ?? payment.lastErrorCode,
    lastErrorMessage: overrides?.lastErrorMessage ?? payment.lastErrorMessage,
    attemptCount: overrides?.attemptCount ?? payment.attemptCount,
    lastWebhookEventId: overrides?.lastWebhookEventId ?? payment.lastWebhookEventId,
    lastWebhookReceivedAt:
      overrides?.lastWebhookReceivedAt !== undefined
        ? overrides.lastWebhookReceivedAt
        : payment.lastWebhookReceivedAt
          ? new Date(payment.lastWebhookReceivedAt)
          : null,
    idempotencyKey: payment.idempotencyKey,
    createdAt: new Date(payment.createdAt),
    updatedAt: overrides?.updatedAt ?? new Date(payment.updatedAt)
  };
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

function expenseCreateInputFromRecord(
  expense: {
    id: string;
    collectionId: string;
    title: string;
    amountMinor: number;
    currency: string;
    expenseType: Expense["expenseType"];
    primaryPaidByParticipantId?: string | null;
    categoryId: string | null;
    receiptUrl: string | null;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  overrides?: Partial<{
    amountMinor: number;
    updatedAt: Date;
  }>
) {
  return {
    id: expense.id,
    collectionId: expense.collectionId,
    title: expense.title,
    amountMinor: overrides?.amountMinor ?? expense.amountMinor,
    currency: expense.currency,
    expenseType: expense.expenseType,
    primaryPaidByParticipantId: expense.primaryPaidByParticipantId ?? null,
    categoryId: expense.categoryId,
    receiptUrl: expense.receiptUrl,
    comment: expense.comment,
    createdAt: expense.createdAt,
    updatedAt: overrides?.updatedAt ?? expense.updatedAt
  };
}
