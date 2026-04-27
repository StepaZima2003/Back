import { randomUUID } from "node:crypto";
import { calculateCollection } from "../calculation";
import type {
  AuthResult,
  CalculationVersion,
  Collection,
  CollectionParticipant,
  Expense,
  ExpensePayment,
  ExpenseShareRule,
  Friendship,
  Group,
  GroupMember,
  User
} from "../domain";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

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
  private readonly expensePayments = new Map<string, ExpensePayment>();
  private readonly shareRules = new Map<string, ExpenseShareRule>();
  private readonly calculationVersions = new Map<string, CalculationVersion>();

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
    data: { title: string; type?: Collection["type"]; groupId?: string | null; paymentMode?: Collection["paymentMode"] }
  ): { collection: Collection; organizerParticipant: CollectionParticipant } {
    if (data.groupId) {
      this.getGroupForUser(userId, data.groupId);
    }

    const collection: Collection = {
      id: randomUUID(),
      title: data.title,
      type: data.type ?? "other",
      groupId: data.groupId ?? null,
      organizerId: userId,
      currency: "RUB",
      status: "draft",
      paymentMode: data.paymentMode ?? "manual",
      totalAmountMinor: 0,
      reviewDeadlineAt: null,
      paymentDeadlineAt: null,
      createdAt: now(),
      updatedAt: now()
    };
    this.collections.set(collection.id, collection);

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

