import { randomUUID } from "node:crypto";
import { calculateCollection } from "../calculation";
import type {
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
  ExpenseCategory,
  ExpensePayment,
  ExpenseShareRule,
  Friendship,
  Group,
  GroupMember,
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
  collections: Collection[];
  participants: CollectionParticipant[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  expensePayments: ExpensePayment[];
  shareRules: ExpenseShareRule[];
  calculationVersions: CalculationVersion[];
  collectionTemplates: CollectionTemplate[];
  disputes: Dispute[];
  manualPaymentProofs: ManualPaymentProof[];
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

const DEFAULT_COLLECTION_CATEGORIES: Record<Collection["type"], Array<Pick<ExpenseCategory, "title" | "emoji" | "requiresManualConfirmation" | "autopayAllowedByDefault">>> = {
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
  private readonly collections = new Map<string, Collection>();
  private readonly participants = new Map<string, CollectionParticipant>();
  private readonly expenses = new Map<string, Expense>();
  private readonly expenseCategories = new Map<string, ExpenseCategory>();
  private readonly expensePayments = new Map<string, ExpensePayment>();
  private readonly shareRules = new Map<string, ExpenseShareRule>();
  private readonly calculationVersions = new Map<string, CalculationVersion>();
  private readonly collectionTemplates = new Map<string, CollectionTemplate>();
  private readonly disputes = new Map<string, Dispute>();
  private readonly manualPaymentProofs = new Map<string, ManualPaymentProof>();
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

  createExpense(
    userId: string,
    collectionId: string,
    data: {
      title: string;
      amountMinor: number;
      categoryId?: string | null;
      expenseType?: Expense["expenseType"];
      comment?: string | null;
      payments?: Array<{ paidByParticipantId: string; amountMinor: number; paymentSource?: ExpensePayment["paymentSource"]; comment?: string | null }>;
    }
  ): { expense: Expense; payments: ExpensePayment[] } {
    this.getOrganizerCollection(userId, collectionId);
    if (data.categoryId) {
      this.getCategory(collectionId, data.categoryId);
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

    const payments = (data.payments ?? []).map((payment) => this.addExpensePayment(userId, expense.id, payment));
    this.recalculateCollectionTotal(collectionId);
    this.markCollectionStatus(collectionId, "expenses_added");

    return { expense, payments };
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
    data: Omit<ExpenseShareRule, "id" | "expenseId" | "expenseItemId">
  ): ExpenseShareRule {
    const expense = this.getExpense(expenseId);
    this.getOrganizerCollection(userId, expense.collectionId);
    this.getParticipant(expense.collectionId, data.participantId);

    const rule: ExpenseShareRule = {
      id: randomUUID(),
      expenseId,
      expenseItemId: null,
      ...data
    };
    this.shareRules.set(rule.id, rule);
    this.markCollectionStatus(expense.collectionId, "rules_configured");
    return rule;
  }

  calculateCollection(userId: string, collectionId: string): CalculationVersion {
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
        shareRules: this.getExpenseShareRules(expense.id).map((rule) => ({
          participantId: rule.participantId,
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
    const calculationVersion = this.calculateCollection(userId, dispute.collectionId);
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
    }
  ): ManualPaymentProof {
    this.getCollectionForUser(userId, collectionId);
    const payerParticipant = data.payerParticipantId ? this.getParticipant(collectionId, data.payerParticipantId) : null;
    const receiverParticipant = data.receiverParticipantId ? this.getParticipant(collectionId, data.receiverParticipantId) : null;

    if (payerParticipant && !this.canActForParticipant(userId, payerParticipant)) {
      throw new AppError(403, "User cannot mark payment for this participant.");
    }

    const proof: ManualPaymentProof = {
      id: randomUUID(),
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
    const updated: ManualPaymentProof = {
      ...proof,
      proofUrl: data.proofUrl === undefined ? proof.proofUrl : data.proofUrl,
      comment: data.comment === undefined ? proof.comment : data.comment,
      updatedAt: now()
    };
    this.manualPaymentProofs.set(proof.id, updated);
    this.addAudit(userId, "manual_payment", proof.id, proof.collectionId, "updated", { proofUrlChanged: data.proofUrl !== undefined });
    return updated;
  }

  confirmManualPayment(userId: string, proofId: string): ManualPaymentProof {
    const proof = this.getManualPaymentForReviewer(userId, proofId);
    const updated: ManualPaymentProof = { ...proof, status: "confirmed", updatedAt: now() };
    this.manualPaymentProofs.set(proof.id, updated);
    this.markCollectionStatus(proof.collectionId, this.hasOnlyConfirmedManualPayments(proof.collectionId) ? "paid" : "partially_paid");
    this.addAudit(userId, "manual_payment", proof.id, proof.collectionId, "confirmed", { amountMinor: proof.amountMinor });
    this.addNotification(proof.payerUserId, proof.collectionId, "manual_payment_confirmed", "Manual payment confirmed", "Your manual payment was confirmed.");
    return updated;
  }

  rejectManualPayment(userId: string, proofId: string): ManualPaymentProof {
    const proof = this.getManualPaymentForReviewer(userId, proofId);
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
    expensePayments: ExpensePayment[];
    shareRules: ExpenseShareRule[];
    calculationVersions: CalculationVersion[];
    disputes: Dispute[];
    manualPaymentProofs: ManualPaymentProof[];
    auditLogs: AuditLog[];
    notifications: Notification[];
  } {
    const expenses = this.getExpenses(collectionId);
    return {
      collection: this.getCollection(collectionId),
      participants: this.getParticipants(collectionId),
      categories: this.getCategories(collectionId),
      expenses,
      expensePayments: expenses.flatMap((expense) => this.getExpensePayments(expense.id)),
      shareRules: expenses.flatMap((expense) => this.getExpenseShareRules(expense.id)),
      calculationVersions: this.getCalculationVersions(collectionId),
      disputes: [...this.disputes.values()].filter((dispute) => dispute.collectionId === collectionId),
      manualPaymentProofs: [...this.manualPaymentProofs.values()].filter((proof) => proof.collectionId === collectionId),
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
    this.collections.clear();
    this.participants.clear();
    this.expenses.clear();
    this.expenseCategories.clear();
    this.expensePayments.clear();
    this.shareRules.clear();
    this.calculationVersions.clear();
    this.collectionTemplates.clear();
    this.disputes.clear();
    this.manualPaymentProofs.clear();
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
    for (const collection of snapshot.collections) {
      this.collections.set(collection.id, collection);
    }
    for (const participant of snapshot.participants) {
      this.participants.set(participant.id, participant);
    }
    for (const expense of snapshot.expenses) {
      this.expenses.set(expense.id, expense);
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
