import type { AppStore } from "./appStore";
import { PrismaMirrorStore } from "./prismaMirrorStore";

export class PrismaStore implements AppStore {
  private constructor(private readonly mirror: PrismaMirrorStore) {}

  static async create(client: ConstructorParameters<typeof PrismaMirrorStore>[0]): Promise<PrismaStore> {
    const mirror = await PrismaMirrorStore.create(client);
    return new PrismaStore(mirror);
  }

  requestOtp(phone: string) {
    return this.mirror.requestOtp(phone);
  }

  async verifyOtp(phone: string, otp: string) {
    await this.refresh();
    return await this.mirror.verifyOtp(phone, otp);
  }

  async authenticate(accessToken: string | undefined) {
    await this.refresh();
    return this.mirror.authenticate(accessToken);
  }

  async getUser(userId: string) {
    await this.refresh();
    return this.mirror.getUser(userId);
  }

  async updateUser(userId: string, patch: Parameters<AppStore["updateUser"]>[1]) {
    await this.refresh();
    return await this.mirror.updateUser(userId, patch);
  }

  async listFriends(userId: string) {
    await this.refresh();
    return this.mirror.listFriends(userId);
  }

  async inviteFriend(userId: string, phone: string) {
    await this.refresh();
    return await this.mirror.inviteFriend(userId, phone);
  }

  async acceptFriendship(userId: string, friendshipId: string) {
    await this.refresh();
    return await this.mirror.acceptFriendship(userId, friendshipId);
  }

  async declineFriendship(userId: string, friendshipId: string) {
    await this.refresh();
    await this.mirror.declineFriendship(userId, friendshipId);
  }

  async listGroups(userId: string) {
    await this.refresh();
    return this.mirror.listGroups(userId);
  }

  async createGroup(userId: string, data: Parameters<AppStore["createGroup"]>[1]) {
    await this.refresh();
    return await this.mirror.createGroup(userId, data);
  }

  async addGroupMember(actorUserId: string, groupId: string, userId: string) {
    await this.refresh();
    return await this.mirror.addGroupMember(actorUserId, groupId, userId);
  }

  async createCollection(userId: string, data: Parameters<AppStore["createCollection"]>[1]) {
    await this.refresh();
    return await this.mirror.createCollection(userId, data);
  }

  async listCollections(userId: string) {
    await this.refresh();
    return this.mirror.listCollections(userId);
  }

  async getCollectionForUser(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.getCollectionForUser(userId, collectionId);
  }

  async updateCollectionStatus(userId: string, collectionId: string, status: Parameters<AppStore["updateCollectionStatus"]>[2]) {
    await this.refresh();
    return await this.mirror.updateCollectionStatus(userId, collectionId, status);
  }

  async listParticipants(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.listParticipants(userId, collectionId);
  }

  async addParticipant(userId: string, collectionId: string, data: Parameters<AppStore["addParticipant"]>[2]) {
    await this.refresh();
    return await this.mirror.addParticipant(userId, collectionId, data);
  }

  async addGuest(userId: string, collectionId: string, data: Parameters<AppStore["addGuest"]>[2]) {
    await this.refresh();
    return await this.mirror.addGuest(userId, collectionId, data);
  }

  async addChild(userId: string, collectionId: string, data: Parameters<AppStore["addChild"]>[2]) {
    await this.refresh();
    return await this.mirror.addChild(userId, collectionId, data);
  }

  async setResponsiblePayer(
    userId: string,
    collectionId: string,
    participantId: string,
    responsiblePayerParticipantId: string | null
  ) {
    await this.refresh();
    return await this.mirror.setResponsiblePayer(userId, collectionId, participantId, responsiblePayerParticipantId);
  }

  async listExpenses(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.listExpenses(userId, collectionId);
  }

  async listCategories(userId: string, collectionId: string) {
    await this.refresh();
    return this.mirror.listCategories(userId, collectionId);
  }

  async createCategory(userId: string, collectionId: string, data: Parameters<AppStore["createCategory"]>[2]) {
    await this.refresh();
    return await this.mirror.createCategory(userId, collectionId, data);
  }

  async createExpense(userId: string, collectionId: string, data: Parameters<AppStore["createExpense"]>[2]) {
    await this.refresh();
    return await this.mirror.createExpense(userId, collectionId, data);
  }

  async addExpensePayment(userId: string, expenseId: string, data: Parameters<AppStore["addExpensePayment"]>[2]) {
    await this.refresh();
    return await this.mirror.addExpensePayment(userId, expenseId, data);
  }

  async addShareRule(userId: string, expenseId: string, data: Parameters<AppStore["addShareRule"]>[2]) {
    await this.refresh();
    return await this.mirror.addShareRule(userId, expenseId, data);
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

  async listGroupTemplates(userId: string, groupId: string) {
    await this.refresh();
    return this.mirror.listGroupTemplates(userId, groupId);
  }

  async createGroupTemplate(userId: string, groupId: string, data: Parameters<AppStore["createGroupTemplate"]>[2]) {
    await this.refresh();
    return await this.mirror.createGroupTemplate(userId, groupId, data);
  }

  async listNotifications(userId: string) {
    await this.refresh();
    return this.mirror.listNotifications(userId);
  }

  async markNotificationRead(userId: string, notificationId: string) {
    await this.refresh();
    return await this.mirror.markNotificationRead(userId, notificationId);
  }

  private async refresh(): Promise<void> {
    await this.mirror.hydrateFromDatabase();
  }
}
