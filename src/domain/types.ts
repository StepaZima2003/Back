import type { CalculateCollectionResult, ExpenseShareRuleInput } from "../calculation";

export type UserStatus = "active" | "blocked" | "deleted";
export type VerificationLevel = "phone" | "bank_id" | "kyc";
export type FriendshipStatus = "pending" | "accepted" | "blocked";
export type GroupRole = "owner" | "admin" | "member";
export type GroupMemberStatus = "active" | "invited" | "left" | "removed";
export type CollectionType = "picnic" | "restaurant" | "gift" | "trip" | "office" | "rent" | "kids" | "dacha" | "other";
export type CollectionStatus =
  | "draft"
  | "participants_selected"
  | "expenses_added"
  | "rules_configured"
  | "review"
  | "dispute_pending"
  | "finalized"
  | "payment_pending"
  | "partially_paid"
  | "paid"
  | "closed"
  | "cancelled"
  | "blocked";
export type PaymentMode = "manual" | "confirm_each" | "auto_for_trusted" | "calculation_only";
export type PaymentProvider = "yookassa" | "bank" | "sbp" | "manual" | "other";
export type ParticipantType = "registered_user" | "invited_phone" | "guest" | "child" | "external_person" | "group_proxy";
export type ParticipantStatus = "invited" | "joined" | "declined" | "confirmed" | "disputed" | "removed" | "active";
export type ParticipantPaymentStatus = "not_required" | "pending" | "paid" | "failed" | "manual_marked_paid" | "disputed";
export type ExpenseType = "expense" | "prepayment" | "deposit" | "refund" | "discount" | "correction" | "service_fee" | "tax" | "other";
export type PaymentSource = "card" | "cash" | "sbp" | "bonus" | "certificate" | "other";
export type CalculationVersionStatus = "draft" | "sent_to_review" | "final" | "superseded";
export type DisputeStatus = "created" | "under_review" | "accepted" | "rejected" | "resolved_by_recalculation" | "cancelled";
export type DisputeType =
  | "not_eat"
  | "not_drink"
  | "partial_time"
  | "already_paid"
  | "bought_something"
  | "absent"
  | "guest_absent"
  | "payer_changed"
  | "other";
export type ManualPaymentMethod = "sbp" | "cash" | "card" | "other";
export type ManualPaymentProofStatus = "submitted" | "confirmed" | "rejected";
export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled" | "refunded" | "manual_marked_paid" | "disputed";
export type PaymentMethodStatus = "pending_binding" | "active" | "failed" | "expired" | "revoked" | "requires_confirmation";
export type PaymentCardBrand = "visa" | "mastercard" | "mir" | "unknown";
export type PaymentProviderWebhookEventType = "payment.succeeded" | "payment.failed" | "payment.refunded";
export type PaymentWebhookProcessingStatus = "received" | "processed" | "ignored" | "failed" | "dead_lettered";
export type AuditEntityType =
  | "collection"
  | "payment"
  | "group"
  | "user"
  | "dispute"
  | "autopay_rule"
  | "participant"
  | "share_rule"
  | "manual_payment"
  | "notification";
export type AuditAction =
  | "created"
  | "updated"
  | "deleted"
  | "confirmed"
  | "paid"
  | "disputed"
  | "blocked"
  | "recalculated"
  | "accepted"
  | "rejected"
  | "sent_to_review"
  | "read";
export type NotificationStatus = "unread" | "read";
export type NotificationType =
  | "collection_review_requested"
  | "participant_confirmed"
  | "dispute_created"
  | "dispute_updated"
  | "manual_payment_submitted"
  | "manual_payment_confirmed"
  | "manual_payment_rejected";

export interface User {
  id: string;
  phone: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  verificationLevel: VerificationLevel;
  createdAt: string;
  updatedAt: string;
}

export interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  status: FriendshipStatus;
  createdAt: string;
}

export interface Group {
  id: string;
  title: string;
  emoji: string | null;
  ownerId: string;
  visibility: "private" | "invite_link";
  groupType: "friends" | "family" | "work" | "trip" | "event" | "other";
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
  status: GroupMemberStatus;
  joinedAt: string;
}

export interface GroupParticipantProfile {
  id: string;
  groupId: string;
  ownerUserId: string;
  linkedUserId: string | null;
  invitedPhone: string | null;
  participantType: ParticipantType;
  displayName: string;
  relationshipHint: "self" | "partner" | "child" | "guest" | "family" | "colleague" | "other";
  defaultWeight: number;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  title: string;
  type: CollectionType;
  groupId: string | null;
  organizerId: string;
  currency: "RUB";
  status: CollectionStatus;
  paymentMode: PaymentMode;
  totalAmountMinor: number;
  reviewDeadlineAt: string | null;
  paymentDeadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  provider: string;
  providerPaymentMethodId: string;
  providerMetadata: Record<string, unknown>;
  maskedPan: string;
  brand: PaymentCardBrand;
  status: PaymentMethodStatus;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionParticipant {
  id: string;
  collectionId: string;
  participantType: ParticipantType;
  linkedUserId: string | null;
  invitedPhone: string | null;
  displayNameSnapshot: string;
  invitedByUserId: string | null;
  paymentResponsibleParticipantId: string | null;
  relationshipHint: "self" | "partner" | "child" | "guest" | "family" | "colleague" | "other";
  defaultWeight: number;
  status: ParticipantStatus;
  finalShareAmountMinor: number;
  paymentStatus: ParticipantPaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  collectionId: string;
  participantId: string | null;
  responsibleUserId: string;
  paymentMethodId: string | null;
  amountMinor: number;
  currency: "RUB";
  provider: PaymentProvider;
  providerPaymentId: string | null;
  providerStatus: string | null;
  providerMetadata: Record<string, unknown>;
  status: PaymentStatus;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  attemptCount: number;
  lastWebhookEventId: string | null;
  lastWebhookReceivedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentWebhookEvent {
  id: string;
  provider: PaymentProvider;
  externalEventId: string;
  providerPaymentId: string;
  paymentId: string | null;
  eventType: PaymentProviderWebhookEventType;
  status: PaymentWebhookProcessingStatus;
  payload: Record<string, unknown>;
  processingError: string | null;
  attemptCount: number;
  lastAttemptedAt: string | null;
  nextRetryAt: string | null;
  deadLetteredAt: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface Expense {
  id: string;
  collectionId: string;
  title: string;
  amountMinor: number;
  currency: "RUB";
  expenseType: ExpenseType;
  categoryId: string | null;
  receiptUrl: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutoPaymentRule {
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
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseItem {
  id: string;
  expenseId: string;
  title: string;
  amountMinor: number;
  currency: "RUB";
  categoryId: string | null;
  splitMode: ExpenseShareRuleInput["splitMode"];
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCategory {
  id: string;
  collectionId: string;
  title: string;
  emoji: string | null;
  requiresManualConfirmation: boolean;
  autopayAllowedByDefault: boolean;
  createdAt: string;
}

export interface ExpensePayment {
  id: string;
  expenseId: string;
  paidByParticipantId: string;
  amountMinor: number;
  currency: "RUB";
  paymentSource: PaymentSource;
  comment: string | null;
  createdAt: string;
}

export interface ExpenseShareRule extends ExpenseShareRuleInput {
  id: string;
  expenseId: string;
  expenseItemId: string | null;
}

export interface CalculationVersion {
  id: string;
  collectionId: string;
  version: number;
  status: CalculationVersionStatus;
  totalAmountMinor: number;
  createdByUserId: string;
  createdAt: string;
  result: CalculateCollectionResult;
}

export interface Dispute {
  id: string;
  collectionId: string;
  participantId: string;
  createdByUserId: string;
  targetParticipantId: string | null;
  type: DisputeType;
  message: string;
  status: DisputeStatus;
  resolutionComment: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ManualPaymentProof {
  id: string;
  idempotencyKey: string | null;
  transferPlanId: string | null;
  collectionId: string;
  payerUserId: string;
  payerParticipantId: string | null;
  receiverUserId: string | null;
  receiverParticipantId: string | null;
  amountMinor: number;
  method: ManualPaymentMethod;
  comment: string | null;
  proofUrl: string | null;
  status: ManualPaymentProofStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  collectionId: string | null;
  action: AuditAction;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  collectionId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  status: NotificationStatus;
  createdAt: string;
  readAt: string | null;
}

export interface CollectionTemplateCategory {
  id: string;
  templateId: string;
  title: string;
  emoji: string | null;
  requiresManualConfirmation: boolean;
  autopayAllowedByDefault: boolean;
  sortOrder: number;
}

export interface CollectionTemplate {
  id: string;
  groupId: string;
  ownerUserId: string;
  title: string;
  collectionType: CollectionType;
  paymentMode: PaymentMode;
  createdAt: string;
  updatedAt: string;
  categories: CollectionTemplateCategory[];
}

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}
