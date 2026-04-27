import type { CalculateCollectionResult, ExpenseShareRuleInput } from "../calculation";

export type UserStatus = "active" | "blocked" | "deleted";
export type VerificationLevel = "phone" | "bank_id" | "kyc";
export type FriendshipStatus = "pending" | "accepted" | "blocked";
export type GroupRole = "owner" | "admin" | "member";
export type GroupMemberStatus = "active" | "invited" | "left" | "removed";
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
export type ParticipantType = "registered_user" | "invited_phone" | "guest" | "child" | "external_person" | "group_proxy";
export type ParticipantStatus = "invited" | "joined" | "declined" | "confirmed" | "disputed" | "removed" | "active";
export type ParticipantPaymentStatus = "not_required" | "pending" | "paid" | "failed" | "manual_marked_paid" | "disputed";
export type ExpenseType = "expense" | "prepayment" | "deposit" | "refund" | "discount" | "correction" | "service_fee" | "tax" | "other";
export type PaymentSource = "card" | "cash" | "sbp" | "bonus" | "certificate" | "other";
export type CalculationVersionStatus = "draft" | "sent_to_review" | "final" | "superseded";

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

export interface Collection {
  id: string;
  title: string;
  type: "picnic" | "restaurant" | "gift" | "trip" | "office" | "rent" | "kids" | "dacha" | "other";
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

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

