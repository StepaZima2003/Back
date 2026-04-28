import { randomUUID } from "node:crypto";
import { calculateCollection } from "../calculation";
import { buildAutoPaymentPlan, type AutoPaymentExecutionPlan, type AutoPaymentPreviewItem } from "../payments/autopay";
import type { MockProviderWebhookPayload } from "../payments/mockProvider";
import type {
  AutoPaymentRule,
  AuthResult,
  AuditAction,
  AuditEntityType,
  AuditLog,
  CalculationVersion,
  Collection,
  CollectionParticipant,
  CollectionTemplate,
  CollectionTemplateCategory,
  Dispute,
  DisputeType,
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
  PaymentMethod,
  ManualPaymentMethod,
  ManualPaymentProof,
  Notification,
  NotificationType,
  User
} from "../domain";

export interface InMemoryStoreSnapshot {
  users: User[];
  friendships: Friendship[];
  groups: Group[];
  groupMembers: GroupMember[];
  groupParticipantProfiles: GroupParticipantProfile[];
  collections: Collection[];
  participants: CollectionParticipant[];
  expenses: Expense[];
  expenseItems: ExpenseItem[];
  expenseCategories: ExpenseCategory[];
  expensePayments: ExpensePayment[];
  shareRules: ExpenseShareRule[];
  calculationVersions: CalculationVersion[];
  collectionTemplates: CollectionTemplate[];
  disputes: Dispute[];
  manualPaymentProofs: ManualPaymentProof[];
  paymentMethods?: PaymentMethod[];
  payments?: Payment[];
  autoPaymentRules?: AutoPaymentRule[];
  auditLogs: AuditLog[];
  notifications: Notification[];
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const DEFAULT_COLLECTION_CATEGORIES: Record<Collection["type"], Array<Pick<ExpenseCategory, "title" | "emoji" | "requiresManualConfirmation" | "autopayAllowedByDefault">>> = {
  picnic: [
    { title: "Food", emoji: "🍖", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Drinks", emoji: "🥤", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Alcohol", emoji: "🍺", requiresManualConfirmation: true, autopayAllowedByDefault: false }
  ],
  restaurant: [
    { title: "Food", emoji: "🍽️", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Drinks", emoji: "🥤", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Alcohol", emoji: "🍷", requiresManualConfirmation: true, autopayAllowedByDefault: false }
  ],
  gift: [
    { title: "Gift", emoji: "🎁", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Card", emoji: "✉️", requiresManualConfirmation: false, autopayAllowedByDefault: true }
  ],
  trip: [
    { title: "Transport", emoji: "🚗", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Stay", emoji: "🏨", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Food", emoji: "🍜", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Alcohol", emoji: "🍹", requiresManualConfirmation: true, autopayAllowedByDefault: false }
  ],
  office: [
    { title: "Food", emoji: "🥐", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Supplies", emoji: "🧻", requiresManualConfirmation: false, autopayAllowedByDefault: true }
  ],
  rent: [
    { title: "Rent", emoji: "🏠", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Utilities", emoji: "💡", requiresManualConfirmation: false, autopayAllowedByDefault: true }
  ],
  kids: [
    { title: "Food", emoji: "🍼", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Entertainment", emoji: "🎠", requiresManualConfirmation: false, autopayAllowedByDefault: true }
  ],
  dacha: [
    { title: "Food", emoji: "🥗", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Household", emoji: "🪵", requiresManualConfirmation: false, autopayAllowedByDefault: true },
    { title: "Alcohol", emoji: "🍾", requiresManualConfirmation: true, autopayAllowedByDefault: false }
  ],
  other: [{ title: "General", emoji: "🧾", requiresManualConfirmation: false, autopayAllowedByDefault: true }]
};

export class InMemoryStore {
  private readonly otpRequests = new Map<string, string>();
  private readonly users = new Map<string, User>();
  private readonly usersByPhone = new Map<string, string>();
  private readonly friendships = new Map<string, Friendship>();
  private readonly groups = new Map<string, Group>();
  private readonly groupMembers = new Map<string, GroupMember>();
  private readonly groupParticipantProfiles = new Map<string, GroupParticipantProfile>();
  private readonly collections = new Map<string, Collection>();
  private readonly participants = new Map<string, CollectionParticipant>();
  private readonly expenses = new Map<string, Expense>();
  private readonly expenseItems = new Map<string, ExpenseItem>();
  private readonly expenseCategories = new Map<string, ExpenseCategory>();
  private readonly expensePayments = new Map<string, ExpensePayment>();
  private readonly shareRules = new Map<string, ExpenseShareRule>();
  private readonly calculationVersions = new Map<string, CalculationVersion>();
  private readonly collectionTemplates = new Map<string, CollectionTemplate>();
  private readonly disputes = new Map<string, Dispute>();
  private readonly manualPaymentProofs = new Map<string, ManualPaymentProof>();
  private readonly paymentMethods = new Map<string, PaymentMethod>();
  private readonly payments = new Map<string, Payment>();
  private readonly autoPaymentRules = new Map<string, AutoPaymentRule>();
  private readonly auditLogs = new Map<string, AuditLog>();
  private readonly notifications = new Map<string, Notification>();

  requestOtp(phone: string): { phone: string; otp: string; expiresInSeconds: number } {
    const otp = "000000";
    this.otpRequests.set(phone, otp);
    return { phone, otp, expiresInSeconds: 300 };
  }

  verifyOtp(phone: string, otp: string): AuthResult {
    const expectedOtp = this.otpRequests.get(phone);
    if (expectedOtp && expectedOtp !== otp) {
      throw new AppError(401, "Invalid OTP.");
    }

    const user = this.findOrCreateUserByPhone(phone);
    this.otpRequests.delete(phone);

    return {
      user,
      accessToken: createDevToken(user.id),
      refreshToken: createDevToken(user.id, "refresh")
    };
  }

  authenticate(accessToken: string | undefined): User {
    if (!accessToken) {
      throw new AppError(401, "Missing bearer token.");
    }

    const userId = parseDevToken(accessToken);
    const user = userId ? this.users.get(userId) : undefined;

    if (!user || user.status !== "active") {
      throw new AppError(401, "Invalid bearer token.");
    }

    return user;
  }

  getUser(userId: string): User {
    const user = this.users.get(userId);
    if (!user) {
      throw new AppError(404, "User not found.");
    }
    return user;
  }

  updateUser(userId: string, patch: { displayName?: string; avatarUrl?: string | null }): User {
    const user = this.getUser(userId);
    const updated: User = {
      ...user,
      displayName: patch.displayName ?? user.displayName,
      avatarUrl: patch.avatarUrl === undefined ? user.avatarUrl : patch.avatarUrl,
      updatedAt: now()
    };
    this.users.set(userId, updated);
    return updated;
  }

  listFriends(userId: string): Friendship[] {
    return [...this.friendships.values()].filter((friendship) => friendship.userId === userId || friendship.friendId === userId);
  }

  inviteFriend(userId: string, phone: string): Friendship {
    const friend = this.findOrCreateUserByPhone(phone);
    if (friend.id === userId) {
      throw new AppError(400, "Cannot invite yourself.");
    }

    const existing = [...this.friendships.values()].find((friendship) => {
      const samePair =
        (friendship.userId === userId && friendship.friendId === friend.id) ||
        (friendship.userId === friend.id && friendship.friendId === userId);
      return samePair && friendship.status !== "blocked";
    });

    if (existing) {
      return existing;
    }

    const friendship: Friendship = {
      id: randomUUID(),
      userId,
      friendId: friend.id,
      status: "pending",
      createdAt: now()
    };
    this.friendships.set(friendship.id, friendship);
    return friendship;
  }

  acceptFriendship(userId: string, friendshipId: string): Friendship {
    const friendship = this.getFriendshipForUser(userId, friendshipId);
    const updated: Friendship = { ...friendship, status: "accepted" };
    this.friendships.set(friendshipId, updated);
    return updated;
  }

  declineFriendship(userId: string, friendshipId: string): void {
    this.getFriendshipForUser(userId, friendshipId);
    this.friendships.delete(friendshipId);
  }

  listGroups(userId: string): Group[] {
    const groupIds = new Set(
      [...this.groupMembers.values()]
        .filter((member) => member.userId === userId && member.status === "active")
        .map((member) => member.groupId)
    );
    return [...groupIds].map((groupId) => this.groups.get(groupId)).filter((group): group is Group => Boolean(group));
  }

  createGroup(userId: string, data: { title: string; emoji?: string | null; groupType?: Group["groupType"] }): Group {
    const group: Group = {
      id: randomUUID(),
      title: data.title,
      emoji: data.emoji ?? null,
      ownerId: userId,
      visibility: "private",
      groupType: data.groupType ?? "other",
      createdAt: now(),
      updatedAt: now()
    };
    this.groups.set(group.id, group);

    const member: GroupMember = {
      id: randomUUID(),
      groupId: group.id,
      userId,
      role: "owner",
      status: "active",
      joinedAt: now()
    };
    this.groupMembers.set(member.id, member);
    return group;
  }

  addGroupMember(actorUserId: string, groupId: string, userId: string): GroupMember {
    const group = this.getGroupForUser(actorUserId, groupId);
    if (group.ownerId !== actorUserId) {
      throw new AppError(403, "Only group owner can add members in MVP.");
    }
    this.getUser(userId);

    const existing = [...this.groupMembers.values()].find((member) => member.groupId === groupId && member.userId === userId);
    if (existing) {
      return existing;
    }

    const member: GroupMember = {
      id: randomUUID(),
      groupId,
      userId,
      role: "member",
      status: "active",
      joinedAt: now()
    };
    this.groupMembers.set(member.id, member);
    return member;
  }

  listGroupParticipantProfiles(userId: string, groupId: string): GroupParticipantProfile[] {
    this.getGroupForUser(userId, groupId);
    return [...this.groupParticipantProfiles.values()]
      .filter((profile) => profile.groupId === groupId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.displayName.localeCompare(b.displayName));
  }

  createGroupParticipantProfile(
    userId: string,
    groupId: string,
    data: {
      linkedUserId?: string | null;
      invitedPhone?: string | null;
      participantType?: GroupParticipantProfile["participantType"];
      displayName?: string;
      relationshipHint?: GroupParticipantProfile["relationshipHint"];
      defaultWeight?: number;
    }
  ): GroupParticipantProfile {
    const group = this.getGroupForUser(userId, groupId);
    if (group.ownerId !== userId) {
      throw new AppError(403, "Only group owner can manage participant profiles in MVP.");
    }

    const linkedUser = data.linkedUserId ? this.getUser(data.linkedUserId) : null;
    const participantType = linkedUser ? "registered_user" : data.invitedPhone ? "invited_phone" : (data.participantType ?? "external_person");
    const displayName = data.displayName ?? linkedUser?.displayName ?? data.invitedPhone;
    if (!displayName) {
      throw new AppError(400, "Participant profile display name is required.");
    }

    const profile: GroupParticipantProfile = {
      id: randomUUID(),
      groupId,
      ownerUserId: userId,
      linkedUserId: linkedUser?.id ?? null,
      invitedPhone: data.invitedPhone ?? linkedUser?.phone ?? null,
      participantType,
      displayName,
      relationshipHint: data.relationshipHint ?? (participantType === "child" ? "child" : participantType === "guest" ? "guest" : "other"),
      defaultWeight: data.defaultWeight ?? (participantType === "child" ? 0.5 : 1),
      createdAt: now(),
      updatedAt: now()
    };
    this.groupParticipantProfiles.set(profile.id, profile);
    this.addAudit(userId, "group", profile.id, null, "created", { groupId, profileId: profile.id });
    return profile;
  }

  createCollection(
    userId: string,
    data: {
      title: string;
      type?: Collection["type"];
      groupId?: string | null;
      paymentMode?: Collection["paymentMode"];
      templateId?: string | null;
    }
  ): { collection: Collection; organizerParticipant: CollectionParticipant } {
    const template = data.templateId ? this.getCollectionTemplate(data.templateId) : null;
    const targetGroupId = data.groupId ?? template?.groupId ?? null;

    if (targetGroupId) {
      this.getGroupForUser(userId, targetGroupId);
    }
    if (template && template.ownerUserId !== userId) {
      throw new AppError(403, "Template is not available to this user.");
    }

    const collection: Collection = {
      id: randomUUID(),
      title: data.title,
      type: data.type ?? template?.collectionType ?? "other",
      groupId: targetGroupId,
      organizerId: userId,
      currency: "RUB",
      status: "draft",
      paymentMode: data.paymentMode ?? template?.paymentMode ?? "manual",
      totalAmountMinor: 0,
      reviewDeadlineAt: null,
      paymentDeadlineAt: null,
      createdAt: now(),
      updatedAt: now()
    };
    this.collections.set(collection.id, collection);

    const categorySeeds =
      template?.categories.map((category) => ({
        title: category.title,
        emoji: category.emoji,
        requiresManualConfirmation: category.requiresManualConfirmation,
        autopayAllowedByDefault: category.autopayAllowedByDefault
      })) ?? DEFAULT_COLLECTION_CATEGORIES[collection.type];
    for (const categorySeed of categorySeeds) {
      this.createCategoryRecord(collection.id, categorySeed);
    }
    this.addAudit(userId, "collection", collection.id, collection.id, "created", {
      templateId: data.templateId ?? null,
      categoryCount: categorySeeds.length
    });

    const user = this.getUser(userId);
    const organizerParticipant = this.createParticipant(collection.id, {
      participantType: "registered_user",
      linkedUserId: userId,
      invitedPhone: user.phone,
      displayNameSnapshot: user.displayName,
      invitedByUserId: userId,
      paymentResponsibleParticipantId: null,
      relationshipHint: "self",
      defaultWeight: 1
    });

    return { collection, organizerParticipant };
  }

  listCollections(userId: string): Collection[] {
    const accessibleCollectionIds = new Set<string>();

    for (const collection of this.collections.values()) {
      if (collection.organizerId === userId) {
        accessibleCollectionIds.add(collection.id);
      }
    }

    for (const participant of this.participants.values()) {
      if (participant.linkedUserId === userId) {
        accessibleCollectionIds.add(participant.collectionId);
      }
    }

    return [...accessibleCollectionIds].map((collectionId) => this.getCollection(collectionId));
  }

  getCollectionForUser(userId: string, collectionId: string): Collection {
    const collection = this.getCollection(collectionId);
    if (collection.organizerId === userId) {
      return collection;
    }

    const hasParticipantAccess = [...this.participants.values()].some(
      (participant) => participant.collectionId === collectionId && participant.linkedUserId === userId
    );

    if (!hasParticipantAccess) {
      throw new AppError(403, "Collection is not available to this user.");
    }

    return collection;
  }

  updateCollectionStatus(userId: string, collectionId: string, status: Collection["status"]): Collection {
    const collection = this.getOrganizerCollection(userId, collectionId);
    const updated: Collection = { ...collection, status, updatedAt: now() };
    this.collections.set(collection.id, updated);

    const action: AuditAction = status === "review" ? "sent_to_review" : "updated";
    this.addAudit(userId, "collection", collection.id, collectionId, action, { status });

    if (status === "review") {
      this.notifyCollectionParticipants(collectionId, "collection_review_requested", "Calculation sent to review", "Organizer sent the collection calculation to review.");
    }

    return updated;
  }

  listPaymentMethods(userId: string): PaymentMethod[] {
    this.getUser(userId);
    return [...this.paymentMethods.values()]
      .filter((method) => method.userId === userId)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt));
  }

  bindMockPaymentMethod(
    userId: string,
    data: { provider?: string; maskedPan: string; brand?: PaymentCardBrand; setAsDefault?: boolean }
  ): PaymentMethod {
    this.getUser(userId);
    const createdAt = now();
    const isDefault = data.setAsDefault ?? this.listPaymentMethods(userId).length === 0;
    if (isDefault) {
      this.clearDefaultPaymentMethod(userId);
    }

    const method: PaymentMethod = {
      id: randomUUID(),
      userId,
      provider: data.provider?.trim() || "mock_bank",
      providerPaymentMethodId: `mock_pm_${randomUUID()}`,
      maskedPan: data.maskedPan,
      brand: data.brand ?? "unknown",
      status: "active",
      isDefault,
      createdAt,
      updatedAt: createdAt
    };
    this.paymentMethods.set(method.id, method);
    this.addAudit(userId, "user", method.id, null, "created", {
      kind: "payment_method",
      provider: method.provider,
      brand: method.brand,
      isDefault: method.isDefault
    });
    return method;
  }

  revokePaymentMethod(userId: string, paymentMethodId: string): PaymentMethod {
    const method = this.getPaymentMethodForUser(userId, paymentMethodId);
    if (method.status === "revoked") {
      return method;
    }

    const updated: PaymentMethod = {
      ...method,
      status: "revoked",
      isDefault: false,
      updatedAt: now()
    };
    this.paymentMethods.set(method.id, updated);
    if (method.isDefault) {
      this.promoteFallbackDefaultPaymentMethod(userId, method.id);
    }
    this.addAudit(userId, "user", method.id, null, "updated", {
      kind: "payment_method",
      status: "revoked"
    });
    return updated;
  }

  listAutoPaymentRules(userId: string, scope?: { collectionId?: string; groupId?: string }): AutoPaymentRule[] {
    this.getUser(userId);
    return [...this.autoPaymentRules.values()]
      .filter((rule) => rule.userId === userId)
      .filter((rule) => !scope?.collectionId || rule.collectionId === scope.collectionId)
      .filter((rule) => !scope?.groupId || rule.groupId === scope.groupId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  upsertAutoPaymentRule(
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
  ): AutoPaymentRule {
    this.getUser(userId);

    if (data.collectionId) {
      this.getCollectionForUser(userId, data.collectionId);
    }
    if (data.groupId) {
      this.getGroupForUser(userId, data.groupId);
    }

    const existing = data.id ? this.getOwnAutoPaymentRule(userId, data.id) : null;
    const createdAt = existing?.createdAt ?? now();
    const rule: AutoPaymentRule = {
      id: existing?.id ?? randomUUID(),
      userId,
      collectionId: data.collectionId === undefined ? existing?.collectionId ?? null : data.collectionId,
      groupId: data.groupId === undefined ? existing?.groupId ?? null : data.groupId,
      category: data.category === undefined ? existing?.category ?? null : data.category,
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
      createdAt,
      updatedAt: now()
    };

    this.autoPaymentRules.set(rule.id, rule);
    this.addAudit(userId, "autopay_rule", rule.id, rule.collectionId, existing ? "updated" : "created", {
      groupId: rule.groupId,
      category: rule.category,
      enabled: rule.enabled,
      singleCollectionLimitMinor: rule.singleCollectionLimitMinor,
      monthlyLimitMinor: rule.monthlyLimitMinor
    });
    return rule;
  }

  listParticipants(userId: string, collectionId: string): CollectionParticipant[] {
    this.getCollectionForUser(userId, collectionId);
    return this.getParticipants(collectionId);
  }

  addParticipant(
    userId: string,
    collectionId: string,
    data: {
      linkedUserId?: string | null;
      invitedPhone?: string | null;
      displayName?: string | null;
      defaultWeight?: number;
      responsiblePayerParticipantId?: string | null;
    }
  ): CollectionParticipant {
    this.getOrganizerCollection(userId, collectionId);
    const linkedUser = data.linkedUserId ? this.getUser(data.linkedUserId) : null;
    const displayName = data.displayName ?? linkedUser?.displayName ?? data.invitedPhone ?? "Участник";

    return this.createParticipant(collectionId, {
      participantType: linkedUser ? "registered_user" : data.invitedPhone ? "invited_phone" : "external_person",
      linkedUserId: linkedUser?.id ?? null,
      invitedPhone: data.invitedPhone ?? linkedUser?.phone ?? null,
      displayNameSnapshot: displayName,
      invitedByUserId: userId,
      paymentResponsibleParticipantId: data.responsiblePayerParticipantId ?? null,
      relationshipHint: "other",
      defaultWeight: data.defaultWeight ?? 1
    });
  }

  addParticipantFromProfile(
    userId: string,
    collectionId: string,
    data: { profileId: string; responsiblePayerParticipantId?: string | null }
  ): CollectionParticipant {
    const collection = this.getOrganizerCollection(userId, collectionId);
    const profile = this.getGroupParticipantProfile(data.profileId);
    if (!collection.groupId || collection.groupId !== profile.groupId) {
      throw new AppError(400, "Participant profile group does not match collection group.");
    }

    if (profile.participantType === "child") {
      if (!data.responsiblePayerParticipantId) {
        throw new AppError(400, "Child participant profile requires a responsible payer.");
      }
      return this.addChild(userId, collectionId, {
        displayName: profile.displayName,
        responsiblePayerParticipantId: data.responsiblePayerParticipantId,
        defaultWeight: profile.defaultWeight
      });
    }

    if (profile.participantType === "guest") {
      return this.addGuest(userId, collectionId, {
        displayName: profile.displayName,
        responsiblePayerParticipantId: data.responsiblePayerParticipantId ?? null,
        defaultWeight: profile.defaultWeight
      });
    }

    return this.addParticipant(userId, collectionId, {
      linkedUserId: profile.linkedUserId,
      invitedPhone: profile.invitedPhone,
      displayName: profile.displayName,
      defaultWeight: profile.defaultWeight,
      responsiblePayerParticipantId: data.responsiblePayerParticipantId ?? null
    });
  }

  addGuest(
    userId: string,
    collectionId: string,
    data: { displayName: string; responsiblePayerParticipantId?: string | null; defaultWeight?: number }
  ): CollectionParticipant {
    this.getOrganizerCollection(userId, collectionId);
    if (data.responsiblePayerParticipantId) {
      this.getParticipant(collectionId, data.responsiblePayerParticipantId);
    }

    return this.createParticipant(collectionId, {
      participantType: "guest",
      linkedUserId: null,
      invitedPhone: null,
      displayNameSnapshot: data.displayName,
      invitedByUserId: userId,
      paymentResponsibleParticipantId: data.responsiblePayerParticipantId ?? null,
      relationshipHint: "guest",
      defaultWeight: data.defaultWeight ?? 1
    });
  }

  addChild(
    userId: string,
    collectionId: string,
    data: { displayName: string; responsiblePayerParticipantId: string; defaultWeight?: number }
  ): CollectionParticipant {
    this.getOrganizerCollection(userId, collectionId);
    this.getParticipant(collectionId, data.responsiblePayerParticipantId);

    return this.createParticipant(collectionId, {
      participantType: "child",
      linkedUserId: null,
      invitedPhone: null,
      displayNameSnapshot: data.displayName,
      invitedByUserId: userId,
      paymentResponsibleParticipantId: data.responsiblePayerParticipantId,
      relationshipHint: "child",
      defaultWeight: data.defaultWeight ?? 0.5
    });
  }

  setResponsiblePayer(
    userId: string,
    collectionId: string,
    participantId: string,
    responsiblePayerParticipantId: string | null
  ): CollectionParticipant {
    this.getOrganizerCollection(userId, collectionId);
    const participant = this.getParticipant(collectionId, participantId);
    if (responsiblePayerParticipantId) {
      this.getParticipant(collectionId, responsiblePayerParticipantId);
    }

    const updated: CollectionParticipant = {
      ...participant,
      paymentResponsibleParticipantId: responsiblePayerParticipantId,
      updatedAt: now()
    };
    this.participants.set(participant.id, updated);
    return updated;
  }

  listExpenses(userId: string, collectionId: string): Expense[] {
    this.getCollectionForUser(userId, collectionId);
    return this.getExpenses(collectionId);
  }

  listExpenseItems(userId: string, expenseId: string): ExpenseItem[] {
    const expense = this.getExpense(expenseId);
    this.getCollectionForUser(userId, expense.collectionId);
    return this.getExpenseItems(expenseId);
  }

  listCategories(userId: string, collectionId: string): ExpenseCategory[] {
    this.getCollectionForUser(userId, collectionId);
    return this.getCategories(collectionId);
  }

  createCategory(
    userId: string,
    collectionId: string,
    data: { title: string; emoji?: string | null; requiresManualConfirmation?: boolean; autopayAllowedByDefault?: boolean }
  ): ExpenseCategory {
    this.getOrganizerCollection(userId, collectionId);
    const category = this.createCategoryRecord(collectionId, {
      title: data.title,
      emoji: data.emoji ?? null,
      requiresManualConfirmation: data.requiresManualConfirmation ?? false,
      autopayAllowedByDefault: data.autopayAllowedByDefault ?? false
    });
    this.addAudit(userId, "collection", collectionId, collectionId, "updated", { createdCategoryId: category.id });
    return category;
  }

  applyTemplateCategoriesToCollection(userId: string, collectionId: string, templateId: string): ExpenseCategory[] {
    const collection = this.getOrganizerCollection(userId, collectionId);
    const template = this.getCollectionTemplate(templateId);
    if (!collection.groupId || collection.groupId !== template.groupId) {
      throw new AppError(400, "Template group does not match collection group.");
    }

    const existingTitles = new Set(this.getCategories(collectionId).map((category) => category.title.toLowerCase()));
    let createdCount = 0;
    for (const category of template.categories) {
      if (existingTitles.has(category.title.toLowerCase())) {
        continue;
      }
      this.createCategoryRecord(collectionId, {
        title: category.title,
        emoji: category.emoji,
        requiresManualConfirmation: category.requiresManualConfirmation,
        autopayAllowedByDefault: category.autopayAllowedByDefault
      });
      existingTitles.add(category.title.toLowerCase());
      createdCount += 1;
    }

    this.addAudit(userId, "collection", collectionId, collectionId, "updated", { templateId, appliedCategoryCount: createdCount });
    return this.getCategories(collectionId);
  }

  createExpense(
    userId: string,
    collectionId: string,
    data: {
      title: string;
      amountMinor: number;
      categoryId?: string | null;
      expenseType?: Expense["expenseType"];
      comment?: string | null;
      items?: Array<{ title: string; amountMinor: number; categoryId?: string | null; splitMode?: ExpenseItem["splitMode"] }>;
      payments?: Array<{ paidByParticipantId: string; amountMinor: number; paymentSource?: ExpensePayment["paymentSource"]; comment?: string | null }>;
    }
  ): { expense: Expense; payments: ExpensePayment[] } {
    this.getOrganizerCollection(userId, collectionId);
    if (data.categoryId) {
      this.getCategory(collectionId, data.categoryId);
    }
    if (data.items?.some((item) => item.categoryId)) {
      for (const item of data.items) {
        if (item.categoryId) {
          this.getCategory(collectionId, item.categoryId);
        }
      }
    }
    if (data.items && data.items.reduce((sum, item) => sum + item.amountMinor, 0) !== data.amountMinor) {
      throw new AppError(400, "Expense items total must match expense amount.");
    }

    const expense: Expense = {
      id: randomUUID(),
      collectionId,
      title: data.title,
      amountMinor: data.amountMinor,
      currency: "RUB",
      expenseType: data.expenseType ?? "expense",
      categoryId: data.categoryId ?? null,
      receiptUrl: null,
      comment: data.comment ?? null,
      createdAt: now(),
      updatedAt: now()
    };
    this.expenses.set(expense.id, expense);
    for (const item of data.items ?? []) {
      this.createExpenseItemRecord(expense.id, item);
    }

    const payments = (data.payments ?? []).map((payment) => this.addExpensePayment(userId, expense.id, payment));
    this.recalculateCollectionTotal(collectionId);
    this.markCollectionStatus(collectionId, "expenses_added");

    return { expense, payments };
  }

  createExpenseItem(
    userId: string,
    expenseId: string,
    data: { title: string; amountMinor: number; categoryId?: string | null; splitMode?: ExpenseItem["splitMode"] }
  ): ExpenseItem {
    const expense = this.getExpense(expenseId);
    this.getOrganizerCollection(userId, expense.collectionId);
    if (data.categoryId) {
      this.getCategory(expense.collectionId, data.categoryId);
    }

    const item = this.createExpenseItemRecord(expenseId, data);
    this.recalculateExpenseAmountFromItems(expenseId);
    this.recalculateCollectionTotal(expense.collectionId);
    this.markCollectionStatus(expense.collectionId, "expenses_added");
    return item;
  }

  addExpensePayment(
    userId: string,
    expenseId: string,
    data: { paidByParticipantId: string; amountMinor: number; paymentSource?: ExpensePayment["paymentSource"]; comment?: string | null }
  ): ExpensePayment {
    const expense = this.getExpense(expenseId);
    this.getOrganizerCollection(userId, expense.collectionId);
    this.getParticipant(expense.collectionId, data.paidByParticipantId);

    const payment: ExpensePayment = {
      id: randomUUID(),
      expenseId,
      paidByParticipantId: data.paidByParticipantId,
      amountMinor: data.amountMinor,
      currency: "RUB",
      paymentSource: data.paymentSource ?? "other",
      comment: data.comment ?? null,
      createdAt: now()
    };
    this.expensePayments.set(payment.id, payment);
    return payment;
  }

  addShareRule(
    userId: string,
    expenseId: string,
    data: {
      expenseItemId?: string | null;
      categoryId?: string | null;
      participantId: string;
      splitMode: ExpenseShareRule["splitMode"];
      weight?: number | null;
      fixedAmountMinor?: number | null;
      percent?: number | null;
      capAmountMinor?: number | null;
      excluded?: boolean | null;
      reason?: string | null;
    }
  ): ExpenseShareRule {
    const expense = this.getExpense(expenseId);
    this.getOrganizerCollection(userId, expense.collectionId);
    this.getParticipant(expense.collectionId, data.participantId);
    if (data.expenseItemId) {
      this.getExpenseItem(expenseId, data.expenseItemId);
    }

    const rule: ExpenseShareRule = {
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
    };
    this.shareRules.set(rule.id, rule);
    this.markCollectionStatus(expense.collectionId, "rules_configured");
    return rule;
  }

  calculateCollection(userId: string, collectionId: string): CalculationVersion {
    return this.calculateCollectionInternal(userId, collectionId, false);
  }

  private calculateCollectionInternal(userId: string, collectionId: string, forceVersion: boolean): CalculationVersion {
    const collection = this.getOrganizerCollection(userId, collectionId);
    const participants = this.getParticipants(collectionId);
    const expenses = this.getExpenses(collectionId);
    const previousVersions = this.getCalculationVersions(collectionId);

    const result = calculateCollection({
      collectionId,
      currency: collection.currency,
      participants: participants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayNameSnapshot,
        participantType: participant.participantType,
        defaultWeight: participant.defaultWeight,
        responsiblePayerId: participant.paymentResponsibleParticipantId
      })),
      expenses: expenses.map((expense) => ({
        id: expense.id,
        title: expense.title,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        categoryId: expense.categoryId,
        payments: this.getExpensePayments(expense.id).map((payment) => ({
          participantId: payment.paidByParticipantId,
          amountMinor: payment.amountMinor
        })),
        items: this.getExpenseItems(expense.id).map((item) => ({
          id: item.id,
          title: item.title,
          amountMinor: item.amountMinor,
          currency: item.currency,
          categoryId: item.categoryId,
          splitMode: item.splitMode
        })),
        shareRules: this.getExpenseShareRules(expense.id).map((rule) => ({
          participantId: rule.participantId,
          expenseItemId: rule.expenseItemId,
          splitMode: rule.splitMode,
          categoryId: rule.categoryId,
          weight: rule.weight,
          fixedAmountMinor: rule.fixedAmountMinor,
          percent: rule.percent,
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
      this.calculationVersions.set(version.id, { ...version, status: "superseded" });
    }

    for (const participantCalculation of result.participantCalculations) {
      const participant = this.participants.get(participantCalculation.participantId);
      if (participant) {
        this.participants.set(participant.id, {
          ...participant,
          finalShareAmountMinor: participantCalculation.owesAmountMinor,
          updatedAt: now()
        });
      }
    }

    const version: CalculationVersion = {
      id: randomUUID(),
      collectionId,
      version: previousVersions.length + 1,
      status: "draft",
      totalAmountMinor: result.totalAmountMinor,
      createdByUserId: userId,
      createdAt: now(),
      result
    };
    this.calculationVersions.set(version.id, version);
    this.markCollectionStatus(collectionId, "rules_configured");
    this.addAudit(userId, "collection", collectionId, collectionId, "recalculated", { calculationVersionId: version.id, version: version.version });
    return version;
  }

  getLatestCalculation(userId: string, collectionId: string): CalculationVersion {
    this.getCollectionForUser(userId, collectionId);
    const latest = this.getCalculationVersions(collectionId).at(-1);
    if (!latest) {
      throw new AppError(404, "Calculation version not found.");
    }
    return latest;
  }

  confirmParticipantReview(userId: string, collectionId: string, participantId: string): CollectionParticipant {
    this.getCollectionForUser(userId, collectionId);
    const participant = this.getParticipant(collectionId, participantId);

    if (!this.canActForParticipant(userId, participant)) {
      throw new AppError(403, "User cannot confirm this participant share.");
    }

    const updated: CollectionParticipant = {
      ...participant,
      status: "confirmed",
      updatedAt: now()
    };
    this.participants.set(participant.id, updated);
    this.addAudit(userId, "participant", participant.id, collectionId, "confirmed", { participantId });

    const collection = this.getCollection(collectionId);
    this.addNotification(collection.organizerId, collectionId, "participant_confirmed", "Participant confirmed calculation", `${updated.displayNameSnapshot} confirmed the calculation.`);

    return updated;
  }

  createDispute(
    userId: string,
    collectionId: string,
    data: { participantId: string; targetParticipantId?: string | null; type: DisputeType; message: string }
  ): Dispute {
    const collection = this.getCollectionForUser(userId, collectionId);
    const participant = this.getParticipant(collectionId, data.participantId);

    if (!this.canActForParticipant(userId, participant)) {
      throw new AppError(403, "User cannot dispute this participant share.");
    }

    if (data.targetParticipantId) {
      this.getParticipant(collectionId, data.targetParticipantId);
    }

    const dispute: Dispute = {
      id: randomUUID(),
      collectionId,
      participantId: data.participantId,
      createdByUserId: userId,
      targetParticipantId: data.targetParticipantId ?? null,
      type: data.type,
      message: data.message,
      status: "created",
      resolutionComment: null,
      createdAt: now(),
      resolvedAt: null
    };
    this.disputes.set(dispute.id, dispute);
    this.participants.set(participant.id, { ...participant, status: "disputed", paymentStatus: "disputed", updatedAt: now() });
    this.markCollectionStatus(collectionId, "dispute_pending");
    this.addAudit(userId, "dispute", dispute.id, collectionId, "disputed", { participantId: data.participantId, type: data.type });
    this.addNotification(collection.organizerId, collectionId, "dispute_created", "New dispute", `${participant.displayNameSnapshot} disputed the calculation.`);

    return dispute;
  }

  listDisputes(userId: string, collectionId: string): Dispute[] {
    this.getCollectionForUser(userId, collectionId);
    return [...this.disputes.values()].filter((dispute) => dispute.collectionId === collectionId);
  }

  acceptDispute(userId: string, disputeId: string, resolutionComment?: string | null): Dispute {
    const dispute = this.getDispute(disputeId);
    this.getOrganizerCollection(userId, dispute.collectionId);
    const updated = this.updateDispute(dispute, "accepted", resolutionComment ?? null);
    this.addAudit(userId, "dispute", dispute.id, dispute.collectionId, "accepted", { resolutionComment: updated.resolutionComment });
    this.addNotification(dispute.createdByUserId, dispute.collectionId, "dispute_updated", "Dispute accepted", "Organizer accepted your dispute.");
    return updated;
  }

  rejectDispute(userId: string, disputeId: string, resolutionComment?: string | null): Dispute {
    const dispute = this.getDispute(disputeId);
    this.getOrganizerCollection(userId, dispute.collectionId);
    const updated = this.updateDispute(dispute, "rejected", resolutionComment ?? null);
    const participant = this.participants.get(dispute.participantId);
    if (participant) {
      this.participants.set(participant.id, { ...participant, status: "active", paymentStatus: "pending", updatedAt: now() });
    }
    this.addAudit(userId, "dispute", dispute.id, dispute.collectionId, "rejected", { resolutionComment: updated.resolutionComment });
    this.addNotification(dispute.createdByUserId, dispute.collectionId, "dispute_updated", "Dispute rejected", "Organizer rejected your dispute.");
    return updated;
  }

  resolveDispute(userId: string, disputeId: string, resolutionComment?: string | null): { dispute: Dispute; calculationVersion: CalculationVersion } {
    const dispute = this.getDispute(disputeId);
    this.getOrganizerCollection(userId, dispute.collectionId);
    const updated = this.updateDispute(dispute, "resolved_by_recalculation", resolutionComment ?? null);
    const calculationVersion = this.calculateCollectionInternal(userId, dispute.collectionId, true);
    this.addAudit(userId, "dispute", dispute.id, dispute.collectionId, "recalculated", { calculationVersionId: calculationVersion.id });
    this.addNotification(dispute.createdByUserId, dispute.collectionId, "dispute_updated", "Dispute resolved", "Organizer recalculated the collection after dispute review.");
    return { dispute: updated, calculationVersion };
  }

  markManualPaymentPaid(
    userId: string,
    collectionId: string,
    data: {
      payerParticipantId?: string | null;
      receiverParticipantId?: string | null;
      amountMinor: number;
      method: ManualPaymentMethod;
      comment?: string | null;
      proofUrl?: string | null;
      transferPlanId?: string | null;
      idempotencyKey?: string | null;
    }
  ): ManualPaymentProof {
    this.getCollectionForUser(userId, collectionId);
    const payerParticipant = data.payerParticipantId ? this.getParticipant(collectionId, data.payerParticipantId) : null;
    const receiverParticipant = data.receiverParticipantId ? this.getParticipant(collectionId, data.receiverParticipantId) : null;

    if (payerParticipant && !this.canActForParticipant(userId, payerParticipant)) {
      throw new AppError(403, "User cannot mark payment for this participant.");
    }

    const idempotencyKey = resolveManualPaymentIdempotencyKey(userId, collectionId, data);
    const existing = this.findManualPaymentByIdempotencyKey(collectionId, idempotencyKey);
    if (existing) {
      if (!isSameManualPaymentRequest(existing, userId, payerParticipant?.id ?? null, receiverParticipant?.id ?? null, data, idempotencyKey)) {
        throw new AppError(409, "Manual payment idempotency key is already used for another request.");
      }
      return existing;
    }

    const proof: ManualPaymentProof = {
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
      createdAt: now(),
      updatedAt: now()
    };
    this.manualPaymentProofs.set(proof.id, proof);

    if (payerParticipant) {
      this.participants.set(payerParticipant.id, { ...payerParticipant, paymentStatus: "manual_marked_paid", updatedAt: now() });
    }

    this.markCollectionStatus(collectionId, "partially_paid");
    this.addAudit(userId, "manual_payment", proof.id, collectionId, "paid", { amountMinor: data.amountMinor, method: data.method });
    this.notifyManualPaymentReviewers(collectionId, proof, "manual_payment_submitted", "Manual payment submitted", "A participant marked a manual payment as paid.");

    return proof;
  }

  uploadManualPaymentProof(userId: string, proofId: string, data: { proofUrl?: string | null; comment?: string | null }): ManualPaymentProof {
    const proof = this.getManualPaymentForUser(userId, proofId);
    const nextProofUrl = data.proofUrl === undefined ? proof.proofUrl : data.proofUrl;
    const nextComment = data.comment === undefined ? proof.comment : data.comment;
    if (nextProofUrl === proof.proofUrl && nextComment === proof.comment) {
      return proof;
    }

    const updated: ManualPaymentProof = {
      ...proof,
      proofUrl: nextProofUrl,
      comment: nextComment,
      updatedAt: now()
    };
    this.manualPaymentProofs.set(proof.id, updated);
    this.addAudit(userId, "manual_payment", proof.id, proof.collectionId, "updated", { proofUrlChanged: data.proofUrl !== undefined });
    return updated;
  }

  confirmManualPayment(userId: string, proofId: string): ManualPaymentProof {
    const proof = this.getManualPaymentForReviewer(userId, proofId);
    if (proof.status === "confirmed") {
      return proof;
    }
    if (proof.status === "rejected") {
      throw new AppError(409, "Rejected manual payment cannot be confirmed.");
    }
    const updated: ManualPaymentProof = { ...proof, status: "confirmed", updatedAt: now() };
    this.manualPaymentProofs.set(proof.id, updated);
    this.markCollectionStatus(proof.collectionId, this.hasOnlyConfirmedManualPayments(proof.collectionId) ? "paid" : "partially_paid");
    this.addAudit(userId, "manual_payment", proof.id, proof.collectionId, "confirmed", { amountMinor: proof.amountMinor });
    this.addNotification(proof.payerUserId, proof.collectionId, "manual_payment_confirmed", "Manual payment confirmed", "Your manual payment was confirmed.");
    return updated;
  }

  rejectManualPayment(userId: string, proofId: string): ManualPaymentProof {
    const proof = this.getManualPaymentForReviewer(userId, proofId);
    if (proof.status === "rejected") {
      return proof;
    }
    if (proof.status === "confirmed") {
      throw new AppError(409, "Confirmed manual payment cannot be rejected.");
    }
    const updated: ManualPaymentProof = { ...proof, status: "rejected", updatedAt: now() };
    this.manualPaymentProofs.set(proof.id, updated);
    this.markCollectionStatus(proof.collectionId, "payment_pending");
    this.addAudit(userId, "manual_payment", proof.id, proof.collectionId, "rejected", { amountMinor: proof.amountMinor });
    this.addNotification(proof.payerUserId, proof.collectionId, "manual_payment_rejected", "Manual payment rejected", "Your manual payment proof was rejected.");
    return updated;
  }

  listManualPayments(userId: string, collectionId: string): ManualPaymentProof[] {
    this.getCollectionForUser(userId, collectionId);
    return [...this.manualPaymentProofs.values()].filter((proof) => proof.collectionId === collectionId);
  }

  listPayments(userId: string, collectionId: string): Payment[] {
    this.getCollectionForUser(userId, collectionId);
    return this.getPayments(collectionId);
  }

  createMockPayment(
    userId: string,
    collectionId: string,
    data: {
      participantId: string;
      amountMinor: number;
      provider?: Payment["provider"];
      paymentMethodId?: string | null;
      idempotencyKey: string;
    }
  ): Payment {
    this.getCollectionForUser(userId, collectionId);
    const participant = this.getParticipant(collectionId, data.participantId);
    if (!this.canActForParticipant(userId, participant)) {
      throw new AppError(403, "User cannot create payment for this participant.");
    }

    const paymentMethod = data.paymentMethodId ? this.getPaymentMethodForUser(userId, data.paymentMethodId) : null;
    if (paymentMethod && paymentMethod.status !== "active") {
      throw new AppError(409, "Payment method is not active.");
    }

    const normalizedIdempotencyKey = resolveMockPaymentIdempotencyKey(userId, collectionId, data.idempotencyKey);
    const existing = this.findPaymentByIdempotencyKey(collectionId, normalizedIdempotencyKey);
    if (existing) {
      if (!isSameMockPaymentRequest(existing, userId, data, normalizedIdempotencyKey)) {
        throw new AppError(409, "Payment idempotency key is already used for another request.");
      }
      return existing;
    }

    const payment: Payment = {
      id: randomUUID(),
      collectionId,
      participantId: participant.id,
      responsibleUserId: userId,
      amountMinor: data.amountMinor,
      currency: "RUB",
      provider: data.provider ?? normalizeMockPaymentProvider(paymentMethod?.provider),
      providerPaymentId: `mock_pay_${randomUUID()}`,
      status: "pending",
      idempotencyKey: normalizedIdempotencyKey,
      createdAt: now(),
      updatedAt: now()
    };
    this.payments.set(payment.id, payment);
    this.setParticipantPaymentStatus(collectionId, participant.id, "pending");
    this.markCollectionStatus(collectionId, "payment_pending");
    this.addAudit(userId, "payment", payment.id, collectionId, "created", {
      amountMinor: payment.amountMinor,
      provider: payment.provider,
      participantId: payment.participantId,
      paymentMethodId: paymentMethod?.id ?? null,
      simulated: true
    });
    return payment;
  }

  confirmMockPayment(userId: string, paymentId: string): Payment {
    const payment = this.getPaymentForActor(userId, paymentId);
    if (payment.status === "succeeded") {
      return payment;
    }
    if (payment.status === "refunded") {
      throw new AppError(409, "Refunded payment cannot be confirmed.");
    }
    if (payment.status === "failed" || payment.status === "cancelled") {
      throw new AppError(409, "Terminal payment cannot be confirmed.");
    }

    const updated = this.updatePayment(payment, { status: "succeeded", updatedAt: now() });
    if (updated.participantId) {
      this.setParticipantPaymentStatus(updated.collectionId, updated.participantId, "paid");
    }
    this.syncCollectionPaymentStatus(updated.collectionId);
    this.addAudit(userId, "payment", updated.id, updated.collectionId, "paid", {
      status: updated.status,
      simulated: true
    });
    return updated;
  }

  failMockPayment(userId: string, paymentId: string, data?: { reason?: string | null }): Payment {
    const payment = this.getPaymentForActor(userId, paymentId);
    if (payment.status === "failed") {
      return payment;
    }
    if (payment.status === "succeeded" || payment.status === "refunded") {
      throw new AppError(409, "Completed payment cannot be failed.");
    }

    const updated = this.updatePayment(payment, { status: "failed", updatedAt: now() });
    if (updated.participantId) {
      this.setParticipantPaymentStatus(updated.collectionId, updated.participantId, "failed");
    }
    this.syncCollectionPaymentStatus(updated.collectionId);
    this.addAudit(userId, "payment", updated.id, updated.collectionId, "updated", {
      status: updated.status,
      reason: data?.reason ?? null,
      simulated: true
    });
    return updated;
  }

  refundPayment(userId: string, paymentId: string, data?: { reason?: string | null }): Payment {
    const payment = this.getPaymentForActor(userId, paymentId);
    if (payment.status === "refunded") {
      return payment;
    }
    if (payment.status !== "succeeded") {
      throw new AppError(409, "Only succeeded payment can be refunded.");
    }

    const updated = this.updatePayment(payment, { status: "refunded", updatedAt: now() });
    if (updated.participantId) {
      this.setParticipantPaymentStatus(updated.collectionId, updated.participantId, "pending");
    }
    this.syncCollectionPaymentStatus(updated.collectionId);
    this.addAudit(userId, "payment", updated.id, updated.collectionId, "updated", {
      status: updated.status,
      reason: data?.reason ?? null,
      simulated: true
    });
    return updated;
  }

  previewAutoPayments(userId: string, collectionId: string): AutoPaymentPreviewItem[] {
    this.getOrganizerCollection(userId, collectionId);
    return this.buildAutoPaymentExecutionPlan(collectionId).preview;
  }

  executeAutoPayments(
    userId: string,
    collectionId: string,
    options?: { dryRun?: boolean }
  ): { createdPayments: Payment[]; skipped: AutoPaymentPreviewItem[]; preview: AutoPaymentPreviewItem[] } {
    this.getOrganizerCollection(userId, collectionId);
    const plan = this.buildAutoPaymentExecutionPlan(collectionId);
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
      const paymentMethod = item.paymentMethodId ? this.paymentMethods.get(item.paymentMethodId) ?? null : null;
      const existing = this.findPaymentByIdempotencyKey(collectionId, item.idempotencyKey);
      if (existing) {
        createdPayments.push(existing);
        continue;
      }

      const payment = this.createAutoPaymentRecord({
        collectionId,
        participantId: item.participantId,
        responsibleUserId,
        amountMinor: item.amountMinor,
        provider: normalizeMockPaymentProvider(paymentMethod?.provider),
        idempotencyKey: item.idempotencyKey
      });
      this.addAudit(userId, "payment", payment.id, collectionId, "created", {
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
  }

  runAutoPaymentSweep(): {
    collectionsScanned: number;
    collectionsWithEligibleItems: number;
    paymentsCreated: number;
    affectedCollectionIds: string[];
  } {
    const candidates = [...this.collections.values()].filter((collection) =>
      !["draft", "cancelled", "closed", "blocked", "paid"].includes(collection.status)
    );

    const affectedCollectionIds = new Set<string>();
    let collectionsWithEligibleItems = 0;
    let paymentsCreated = 0;

    for (const collection of candidates) {
      if (this.getCalculationVersions(collection.id).length === 0) {
        continue;
      }
      const result = this.executeAutoPayments(collection.organizerId, collection.id);
      if (result.preview.some((item) => item.status === "eligible")) {
        collectionsWithEligibleItems += 1;
      }
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

  applyMockProviderWebhook(payload: MockProviderWebhookPayload): Payment {
    const payment = this.findPaymentByProviderPaymentId(payload.providerPaymentId);
    if (!payment) {
      throw new AppError(404, "Payment not found for provider payment id.");
    }

    let nextStatus: Payment["status"];
    let participantPaymentStatus: CollectionParticipant["paymentStatus"] | null;
    let action: AuditAction;

    switch (payload.eventType) {
      case "payment.succeeded":
        if (payment.status === "succeeded") {
          return payment;
        }
        nextStatus = "succeeded";
        participantPaymentStatus = "paid";
        action = "paid";
        break;
      case "payment.failed":
        if (payment.status === "failed") {
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
          return payment;
        }
        if (payment.status !== "succeeded") {
          throw new AppError(409, "Only succeeded payment can be refunded.");
        }
        nextStatus = "refunded";
        participantPaymentStatus = "pending";
        action = "updated";
        break;
    }

    const updated = this.updatePayment(payment, { status: nextStatus, updatedAt: now() });
    if (updated.participantId && participantPaymentStatus) {
      this.setParticipantPaymentStatus(updated.collectionId, updated.participantId, participantPaymentStatus);
    }
    this.syncCollectionPaymentStatus(updated.collectionId);
    this.addAudit(null, "payment", updated.id, updated.collectionId, action, {
      providerPaymentId: updated.providerPaymentId,
      eventType: payload.eventType,
      reason: payload.reason ?? null,
      occurredAt: payload.occurredAt ?? null,
      webhook: true
    });
    return updated;
  }

  listAuditLogs(userId: string, collectionId: string): AuditLog[] {
    this.getCollectionForUser(userId, collectionId);
    return [...this.auditLogs.values()].filter((log) => log.collectionId === collectionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listGroupTemplates(userId: string, groupId: string): CollectionTemplate[] {
    this.getGroupForUser(userId, groupId);
    return [...this.collectionTemplates.values()]
      .filter((template) => template.groupId === groupId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  createGroupTemplate(
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
  ): CollectionTemplate {
    this.getGroupForUser(userId, groupId);

    const templateId = randomUUID();
    const categories =
      data.categories?.map((category, index) => this.createTemplateCategoryRecord(templateId, index, category)) ??
      DEFAULT_COLLECTION_CATEGORIES[data.collectionType].map((category, index) => this.createTemplateCategoryRecord(templateId, index, category));

    const template: CollectionTemplate = {
      id: templateId,
      groupId,
      ownerUserId: userId,
      title: data.title,
      collectionType: data.collectionType,
      paymentMode: data.paymentMode ?? "manual",
      createdAt: now(),
      updatedAt: now(),
      categories
    };
    this.collectionTemplates.set(template.id, template);
    this.addAudit(userId, "group", groupId, null, "created", { templateId: template.id, categoryCount: categories.length });
    return template;
  }

  listNotifications(userId: string): Notification[] {
    this.getUser(userId);
    return [...this.notifications.values()].filter((notification) => notification.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markNotificationRead(userId: string, notificationId: string): Notification {
    const notification = this.notifications.get(notificationId);
    if (!notification || notification.userId !== userId) {
      throw new AppError(404, "Notification not found.");
    }

    const updated: Notification = { ...notification, status: "read", readAt: now() };
    this.notifications.set(notification.id, updated);
    this.addAudit(userId, "notification", notification.id, notification.collectionId, "read", {});
    return updated;
  }

  debugGetCollectionState(collectionId: string): {
    collection: Collection;
      participants: CollectionParticipant[];
      categories: ExpenseCategory[];
      expenses: Expense[];
      expenseItems: ExpenseItem[];
      expensePayments: ExpensePayment[];
      shareRules: ExpenseShareRule[];
    calculationVersions: CalculationVersion[];
    disputes: Dispute[];
    manualPaymentProofs: ManualPaymentProof[];
    payments: Payment[];
    auditLogs: AuditLog[];
    notifications: Notification[];
  } {
    const expenses = this.getExpenses(collectionId);
    return {
      collection: this.getCollection(collectionId),
        participants: this.getParticipants(collectionId),
        categories: this.getCategories(collectionId),
        expenses,
        expenseItems: expenses.flatMap((expense) => this.getExpenseItems(expense.id)),
        expensePayments: expenses.flatMap((expense) => this.getExpensePayments(expense.id)),
        shareRules: expenses.flatMap((expense) => this.getExpenseShareRules(expense.id)),
      calculationVersions: this.getCalculationVersions(collectionId),
      disputes: [...this.disputes.values()].filter((dispute) => dispute.collectionId === collectionId),
      manualPaymentProofs: [...this.manualPaymentProofs.values()].filter((proof) => proof.collectionId === collectionId),
      payments: this.getPayments(collectionId),
      auditLogs: [...this.auditLogs.values()].filter((log) => log.collectionId === collectionId),
      notifications: [...this.notifications.values()].filter((notification) => notification.collectionId === collectionId)
    };
  }

  debugGetNotification(notificationId: string): Notification | null {
    return this.notifications.get(notificationId) ?? null;
  }

  debugGetExpense(expenseId: string): Expense {
    return this.getExpense(expenseId);
  }

  debugLoadSnapshot(snapshot: InMemoryStoreSnapshot, options?: { preserveOtpRequests?: boolean }): void {
    if (!options?.preserveOtpRequests) {
      this.otpRequests.clear();
    }
    this.users.clear();
    this.usersByPhone.clear();
    this.friendships.clear();
    this.groups.clear();
    this.groupMembers.clear();
    this.groupParticipantProfiles.clear();
    this.collections.clear();
    this.participants.clear();
    this.expenses.clear();
    this.expenseItems.clear();
    this.expenseCategories.clear();
    this.expensePayments.clear();
    this.shareRules.clear();
    this.calculationVersions.clear();
    this.collectionTemplates.clear();
    this.disputes.clear();
    this.manualPaymentProofs.clear();
    this.paymentMethods.clear();
    this.payments.clear();
    this.autoPaymentRules.clear();
    this.auditLogs.clear();
    this.notifications.clear();

    for (const user of snapshot.users) {
      this.users.set(user.id, user);
      this.usersByPhone.set(user.phone, user.id);
    }
    for (const friendship of snapshot.friendships) {
      this.friendships.set(friendship.id, friendship);
    }
    for (const group of snapshot.groups) {
      this.groups.set(group.id, group);
    }
    for (const member of snapshot.groupMembers) {
      this.groupMembers.set(member.id, member);
    }
    for (const profile of snapshot.groupParticipantProfiles ?? []) {
      this.groupParticipantProfiles.set(profile.id, profile);
    }
    for (const collection of snapshot.collections) {
      this.collections.set(collection.id, collection);
    }
    for (const participant of snapshot.participants) {
      this.participants.set(participant.id, participant);
    }
    for (const expense of snapshot.expenses) {
      this.expenses.set(expense.id, expense);
    }
    for (const item of snapshot.expenseItems) {
      this.expenseItems.set(item.id, item);
    }
    for (const category of snapshot.expenseCategories) {
      this.expenseCategories.set(category.id, category);
    }
    for (const payment of snapshot.expensePayments) {
      this.expensePayments.set(payment.id, payment);
    }
    for (const rule of snapshot.shareRules) {
      this.shareRules.set(rule.id, rule);
    }
    for (const version of snapshot.calculationVersions) {
      this.calculationVersions.set(version.id, version);
    }
    for (const template of snapshot.collectionTemplates) {
      this.collectionTemplates.set(template.id, template);
    }
    for (const dispute of snapshot.disputes) {
      this.disputes.set(dispute.id, dispute);
    }
    for (const proof of snapshot.manualPaymentProofs) {
      this.manualPaymentProofs.set(proof.id, proof);
    }
    for (const method of snapshot.paymentMethods ?? []) {
      this.paymentMethods.set(method.id, method);
    }
    for (const payment of snapshot.payments ?? []) {
      this.payments.set(payment.id, payment);
    }
    for (const rule of snapshot.autoPaymentRules ?? []) {
      this.autoPaymentRules.set(rule.id, rule);
    }
    for (const log of snapshot.auditLogs) {
      this.auditLogs.set(log.id, log);
    }
    for (const notification of snapshot.notifications) {
      this.notifications.set(notification.id, notification);
    }
  }

  private getDispute(disputeId: string): Dispute {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) {
      throw new AppError(404, "Dispute not found.");
    }
    return dispute;
  }

  private updateDispute(dispute: Dispute, status: Dispute["status"], resolutionComment: string | null): Dispute {
    const updated: Dispute = {
      ...dispute,
      status,
      resolutionComment,
      resolvedAt: ["accepted", "rejected", "resolved_by_recalculation", "cancelled"].includes(status) ? now() : dispute.resolvedAt
    };
    this.disputes.set(dispute.id, updated);
    return updated;
  }

  private getManualPaymentForUser(userId: string, proofId: string): ManualPaymentProof {
    const proof = this.manualPaymentProofs.get(proofId);
    if (!proof || proof.payerUserId !== userId) {
      throw new AppError(404, "Manual payment proof not found.");
    }
    return proof;
  }

  private getManualPaymentForReviewer(userId: string, proofId: string): ManualPaymentProof {
    const proof = this.manualPaymentProofs.get(proofId);
    if (!proof) {
      throw new AppError(404, "Manual payment proof not found.");
    }

    const collection = this.getCollection(proof.collectionId);
    if (collection.organizerId === userId || proof.receiverUserId === userId) {
      return proof;
    }

    throw new AppError(403, "User cannot review this manual payment.");
  }

  private hasOnlyConfirmedManualPayments(collectionId: string): boolean {
    const proofs = [...this.manualPaymentProofs.values()].filter((proof) => proof.collectionId === collectionId);
    return proofs.length > 0 && proofs.every((proof) => proof.status === "confirmed");
  }

  private findManualPaymentByIdempotencyKey(collectionId: string, idempotencyKey: string): ManualPaymentProof | null {
    return (
      [...this.manualPaymentProofs.values()].find(
        (proof) => proof.collectionId === collectionId && proof.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  private getPaymentMethodForUser(userId: string, paymentMethodId: string): PaymentMethod {
    const method = this.paymentMethods.get(paymentMethodId);
    if (!method || method.userId !== userId) {
      throw new AppError(404, "Payment method not found.");
    }
    return method;
  }

  private getOwnAutoPaymentRule(userId: string, ruleId: string): AutoPaymentRule {
    const rule = this.autoPaymentRules.get(ruleId);
    if (!rule || rule.userId !== userId) {
      throw new AppError(404, "Auto payment rule not found.");
    }
    return rule;
  }

  private clearDefaultPaymentMethod(userId: string): void {
    for (const method of this.paymentMethods.values()) {
      if (method.userId === userId && method.isDefault) {
        this.paymentMethods.set(method.id, { ...method, isDefault: false, updatedAt: now() });
      }
    }
  }

  private promoteFallbackDefaultPaymentMethod(userId: string, excludedPaymentMethodId: string): void {
    const fallback = this.listPaymentMethods(userId).find((method) => method.id !== excludedPaymentMethodId && method.status === "active");
    if (!fallback) {
      return;
    }
    this.paymentMethods.set(fallback.id, { ...fallback, isDefault: true, updatedAt: now() });
  }

  private getPayments(collectionId: string): Payment[] {
    return [...this.payments.values()]
      .filter((payment) => payment.collectionId === collectionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private findPaymentByIdempotencyKey(collectionId: string, idempotencyKey: string): Payment | null {
    return this.getPayments(collectionId).find((payment) => payment.idempotencyKey === idempotencyKey) ?? null;
  }

  private findPaymentByProviderPaymentId(providerPaymentId: string): Payment | null {
    return [...this.payments.values()].find((payment) => payment.providerPaymentId === providerPaymentId) ?? null;
  }

  private createAutoPaymentRecord(data: {
    collectionId: string;
    participantId: string;
    responsibleUserId: string;
    amountMinor: number;
    provider: Payment["provider"];
    idempotencyKey: string;
  }): Payment {
    const payment: Payment = {
      id: randomUUID(),
      collectionId: data.collectionId,
      participantId: data.participantId,
      responsibleUserId: data.responsibleUserId,
      amountMinor: data.amountMinor,
      currency: "RUB",
      provider: data.provider,
      providerPaymentId: `mock_pay_${randomUUID()}`,
      status: "pending",
      idempotencyKey: data.idempotencyKey,
      createdAt: now(),
      updatedAt: now()
    };
    this.payments.set(payment.id, payment);
    this.setParticipantPaymentStatus(data.collectionId, data.participantId, "pending");
    this.markCollectionStatus(data.collectionId, "payment_pending");
    return payment;
  }

  private buildAutoPaymentExecutionPlan(collectionId: string): AutoPaymentExecutionPlan {
    const collection = this.getCollection(collectionId);
    const calculationVersion = this.getCalculationVersions(collectionId).at(-1);
    if (!calculationVersion) {
      throw new AppError(409, "Auto payment execution requires a calculation.");
    }

    return buildAutoPaymentPlan({
      collectionId,
      collectionGroupId: collection.groupId,
      nowIso: now(),
      calculationVersion,
      participants: this.getParticipants(collectionId),
      categories: this.getCategories(collectionId),
      paymentMethods: [...this.paymentMethods.values()],
      autoPaymentRules: [...this.autoPaymentRules.values()],
      payments: this.getPayments(collectionId)
    });
  }

  private getPaymentForActor(userId: string, paymentId: string): Payment {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new AppError(404, "Payment not found.");
    }

    const collection = this.getCollection(payment.collectionId);
    if (payment.responsibleUserId === userId || collection.organizerId === userId) {
      return payment;
    }

    throw new AppError(403, "User cannot access this payment.");
  }

  private updatePayment(payment: Payment, patch: Partial<Payment>): Payment {
    const updated: Payment = { ...payment, ...patch };
    this.payments.set(payment.id, updated);
    return updated;
  }

  private setParticipantPaymentStatus(
    collectionId: string,
    participantId: string,
    paymentStatus: CollectionParticipant["paymentStatus"]
  ): void {
    const participant = this.getParticipant(collectionId, participantId);
    this.participants.set(participant.id, {
      ...participant,
      paymentStatus,
      updatedAt: now()
    });
  }

  private syncCollectionPaymentStatus(collectionId: string): void {
    const payableParticipants = this.getParticipants(collectionId).filter((participant) => participant.finalShareAmountMinor > 0);
    if (payableParticipants.length === 0) {
      this.markCollectionStatus(collectionId, "finalized");
      return;
    }

    const paidCount = payableParticipants.filter((participant) => participant.paymentStatus === "paid" || participant.paymentStatus === "manual_marked_paid").length;
    if (paidCount === 0) {
      this.markCollectionStatus(collectionId, "payment_pending");
      return;
    }
    if (paidCount === payableParticipants.length) {
      this.markCollectionStatus(collectionId, "paid");
      return;
    }
    this.markCollectionStatus(collectionId, "partially_paid");
  }

  private canActForParticipant(userId: string, participant: CollectionParticipant): boolean {
    const collection = this.getCollection(participant.collectionId);
    if (collection.organizerId === userId || participant.linkedUserId === userId) {
      return true;
    }

    if (!participant.paymentResponsibleParticipantId) {
      return false;
    }

    const responsibleParticipant = this.participants.get(participant.paymentResponsibleParticipantId);
    return responsibleParticipant?.linkedUserId === userId;
  }

  private notifyCollectionParticipants(collectionId: string, type: NotificationType, title: string, body: string): void {
    const collection = this.getCollection(collectionId);
    const userIds = new Set<string>();
    userIds.add(collection.organizerId);

    for (const participant of this.getParticipants(collectionId)) {
      if (participant.linkedUserId) {
        userIds.add(participant.linkedUserId);
      }
      if (participant.paymentResponsibleParticipantId) {
        const responsibleParticipant = this.participants.get(participant.paymentResponsibleParticipantId);
        if (responsibleParticipant?.linkedUserId) {
          userIds.add(responsibleParticipant.linkedUserId);
        }
      }
    }

    for (const targetUserId of userIds) {
      this.addNotification(targetUserId, collectionId, type, title, body);
    }
  }

  private notifyManualPaymentReviewers(collectionId: string, proof: ManualPaymentProof, type: NotificationType, title: string, body: string): void {
    const collection = this.getCollection(collectionId);
    const userIds = new Set<string>([collection.organizerId]);
    if (proof.receiverUserId) {
      userIds.add(proof.receiverUserId);
    }
    userIds.delete(proof.payerUserId);

    for (const targetUserId of userIds) {
      this.addNotification(targetUserId, collectionId, type, title, body);
    }
  }

  private addNotification(userId: string, collectionId: string | null, type: NotificationType, title: string, body: string): Notification {
    const notification: Notification = {
      id: randomUUID(),
      userId,
      collectionId,
      type,
      title,
      body,
      status: "unread",
      createdAt: now(),
      readAt: null
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  private addAudit(
    actorUserId: string | null,
    entityType: AuditEntityType,
    entityId: string,
    collectionId: string | null,
    action: AuditAction,
    metadata: Record<string, unknown>
  ): AuditLog {
    const log: AuditLog = {
      id: randomUUID(),
      actorUserId,
      entityType,
      entityId,
      collectionId,
      action,
      metadata,
      ipAddress: null,
      userAgent: null,
      createdAt: now()
    };
    this.auditLogs.set(log.id, log);
    return log;
  }

  private findOrCreateUserByPhone(phone: string): User {
    const existingUserId = this.usersByPhone.get(phone);
    if (existingUserId) {
      return this.getUser(existingUserId);
    }

    const createdAt = now();
    const user: User = {
      id: randomUUID(),
      phone,
      displayName: `User ${phone.slice(-4)}`,
      avatarUrl: null,
      status: "active",
      verificationLevel: "phone",
      createdAt,
      updatedAt: createdAt
    };
    this.users.set(user.id, user);
    this.usersByPhone.set(phone, user.id);
    return user;
  }

  private getFriendshipForUser(userId: string, friendshipId: string): Friendship {
    const friendship = this.friendships.get(friendshipId);
    if (!friendship || (friendship.userId !== userId && friendship.friendId !== userId)) {
      throw new AppError(404, "Friendship not found.");
    }
    return friendship;
  }

  private getGroupForUser(userId: string, groupId: string): Group {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new AppError(404, "Group not found.");
    }

    const isMember = [...this.groupMembers.values()].some(
      (member) => member.groupId === groupId && member.userId === userId && member.status === "active"
    );
    if (!isMember) {
      throw new AppError(403, "Group is not available to this user.");
    }
    return group;
  }

  private getCollection(collectionId: string): Collection {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new AppError(404, "Collection not found.");
    }
    return collection;
  }

  private getOrganizerCollection(userId: string, collectionId: string): Collection {
    const collection = this.getCollection(collectionId);
    if (collection.organizerId !== userId) {
      throw new AppError(403, "Only organizer can change collection in MVP.");
    }
    return collection;
  }

  private createParticipant(
    collectionId: string,
    data: Omit<CollectionParticipant, "id" | "collectionId" | "status" | "finalShareAmountMinor" | "paymentStatus" | "createdAt" | "updatedAt">
  ): CollectionParticipant {
    const createdAt = now();
    const participant: CollectionParticipant = {
      id: randomUUID(),
      collectionId,
      status: "active",
      finalShareAmountMinor: 0,
      paymentStatus: "pending",
      createdAt,
      updatedAt: createdAt,
      ...data
    };
    this.participants.set(participant.id, participant);
    this.markCollectionStatus(collectionId, "participants_selected");
    return participant;
  }

  private getParticipants(collectionId: string): CollectionParticipant[] {
    return [...this.participants.values()].filter((participant) => participant.collectionId === collectionId);
  }

  private getParticipant(collectionId: string, participantId: string): CollectionParticipant {
    const participant = this.participants.get(participantId);
    if (!participant || participant.collectionId !== collectionId) {
      throw new AppError(404, "Participant not found.");
    }
    return participant;
  }

  private getExpense(expenseId: string): Expense {
    const expense = this.expenses.get(expenseId);
    if (!expense) {
      throw new AppError(404, "Expense not found.");
    }
    return expense;
  }

  private getExpenses(collectionId: string): Expense[] {
    return [...this.expenses.values()].filter((expense) => expense.collectionId === collectionId);
  }

  private getExpenseItems(expenseId: string): ExpenseItem[] {
    return [...this.expenseItems.values()]
      .filter((item) => item.expenseId === expenseId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title));
  }

  private getExpenseItem(expenseId: string, expenseItemId: string): ExpenseItem {
    const item = this.expenseItems.get(expenseItemId);
    if (!item || item.expenseId !== expenseId) {
      throw new AppError(404, "Expense item not found.");
    }
    return item;
  }

  private getCategory(collectionId: string, categoryId: string): ExpenseCategory {
    const category = this.expenseCategories.get(categoryId);
    if (!category || category.collectionId !== collectionId) {
      throw new AppError(404, "Category not found.");
    }
    return category;
  }

  private getCategories(collectionId: string): ExpenseCategory[] {
    return [...this.expenseCategories.values()]
      .filter((category) => category.collectionId === collectionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title));
  }

  private getExpensePayments(expenseId: string): ExpensePayment[] {
    return [...this.expensePayments.values()].filter((payment) => payment.expenseId === expenseId);
  }

  private getExpenseShareRules(expenseId: string): ExpenseShareRule[] {
    return [...this.shareRules.values()].filter((rule) => rule.expenseId === expenseId);
  }

  private createExpenseItemRecord(
    expenseId: string,
    data: { title: string; amountMinor: number; categoryId?: string | null; splitMode?: ExpenseItem["splitMode"] }
  ): ExpenseItem {
    const item: ExpenseItem = {
      id: randomUUID(),
      expenseId,
      title: data.title,
      amountMinor: data.amountMinor,
      currency: "RUB",
      categoryId: data.categoryId ?? null,
      splitMode: data.splitMode ?? "equal",
      createdAt: now(),
      updatedAt: now()
    };
    this.expenseItems.set(item.id, item);
    return item;
  }

  private getCalculationVersions(collectionId: string): CalculationVersion[] {
    return [...this.calculationVersions.values()]
      .filter((version) => version.collectionId === collectionId)
      .sort((a, b) => a.version - b.version);
  }

  private getCollectionTemplate(templateId: string): CollectionTemplate {
    const template = this.collectionTemplates.get(templateId);
    if (!template) {
      throw new AppError(404, "Collection template not found.");
    }
    return template;
  }

  private getGroupParticipantProfile(profileId: string): GroupParticipantProfile {
    const profile = this.groupParticipantProfiles.get(profileId);
    if (!profile) {
      throw new AppError(404, "Participant profile not found.");
    }
    return profile;
  }

  private createCategoryRecord(
    collectionId: string,
    data: Pick<ExpenseCategory, "title" | "emoji" | "requiresManualConfirmation" | "autopayAllowedByDefault">
  ): ExpenseCategory {
    const category: ExpenseCategory = {
      id: randomUUID(),
      collectionId,
      title: data.title,
      emoji: data.emoji,
      requiresManualConfirmation: data.requiresManualConfirmation,
      autopayAllowedByDefault: data.autopayAllowedByDefault,
      createdAt: now()
    };
    this.expenseCategories.set(category.id, category);
    return category;
  }

  private createTemplateCategoryRecord(
    templateId: string,
    sortOrder: number,
    data: {
      title: string;
      emoji?: string | null;
      requiresManualConfirmation?: boolean;
      autopayAllowedByDefault?: boolean;
    }
  ): CollectionTemplateCategory {
    return {
      id: randomUUID(),
      templateId,
      title: data.title,
      emoji: data.emoji ?? null,
      requiresManualConfirmation: data.requiresManualConfirmation ?? false,
      autopayAllowedByDefault: data.autopayAllowedByDefault ?? false,
      sortOrder
    };
  }

  private recalculateCollectionTotal(collectionId: string): void {
    const collection = this.getCollection(collectionId);
    const totalAmountMinor = this.getExpenses(collectionId).reduce((sum, expense) => sum + expense.amountMinor, 0);
    this.collections.set(collectionId, { ...collection, totalAmountMinor, updatedAt: now() });
  }

  private recalculateExpenseAmountFromItems(expenseId: string): void {
    const expense = this.getExpense(expenseId);
    const amountMinor = this.getExpenseItems(expenseId).reduce((sum, item) => sum + item.amountMinor, 0);
    this.expenses.set(expenseId, { ...expense, amountMinor, updatedAt: now() });
  }

  private markCollectionStatus(collectionId: string, status: Collection["status"]): void {
    const collection = this.collections.get(collectionId);
    if (!collection || collection.status === "cancelled" || collection.status === "closed") {
      return;
    }
    this.collections.set(collectionId, { ...collection, status, updatedAt: now() });
  }
}

function now(): string {
  return new Date().toISOString();
}

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
    method: ManualPaymentMethod;
    comment?: string | null;
    proofUrl?: string | null;
    transferPlanId?: string | null;
    idempotencyKey?: string | null;
  }
): string {
  if (data.idempotencyKey?.trim()) {
    return `manual:${collectionId}:${userId}:${data.idempotencyKey.trim()}`;
  }

  return stableJson({
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
  });
}

function resolveMockPaymentIdempotencyKey(userId: string, collectionId: string, idempotencyKey: string): string {
  return `payment:${collectionId}:${userId}:${idempotencyKey.trim()}`;
}

function normalizeMockPaymentProvider(provider: string | undefined | null): Payment["provider"] {
  switch (provider) {
    case "yookassa":
    case "bank":
    case "sbp":
    case "manual":
    case "other":
      return provider;
    default:
      return "other";
  }
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
    payment.provider === (data.provider ?? payment.provider)
  );
}

function isSameManualPaymentRequest(
  proof: ManualPaymentProof,
  userId: string,
  payerParticipantId: string | null,
  receiverParticipantId: string | null,
  data: {
    amountMinor: number;
    method: ManualPaymentMethod;
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
