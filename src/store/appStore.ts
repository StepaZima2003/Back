import type { InMemoryStore } from "./inMemoryStore";

type Awaitable<T> = T | Promise<T>;

type AsyncifyMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Awaitable<Awaited<R>> : never;
};

type AppStoreMethodName =
  | "requestOtp"
  | "verifyOtp"
  | "authenticate"
  | "getUser"
  | "updateUser"
  | "listFriends"
  | "inviteFriend"
  | "acceptFriendship"
  | "declineFriendship"
  | "listGroups"
  | "createGroup"
  | "addGroupMember"
  | "createCollection"
  | "listCollections"
  | "getCollectionForUser"
  | "updateCollectionStatus"
  | "listParticipants"
  | "addParticipant"
  | "addGuest"
  | "addChild"
  | "setResponsiblePayer"
  | "listExpenses"
  | "listCategories"
  | "createCategory"
  | "createExpense"
  | "addExpensePayment"
  | "addShareRule"
  | "calculateCollection"
  | "getLatestCalculation"
  | "confirmParticipantReview"
  | "createDispute"
  | "listDisputes"
  | "acceptDispute"
  | "rejectDispute"
  | "resolveDispute"
  | "markManualPaymentPaid"
  | "uploadManualPaymentProof"
  | "confirmManualPayment"
  | "rejectManualPayment"
  | "listManualPayments"
  | "listAuditLogs"
  | "listGroupTemplates"
  | "createGroupTemplate"
  | "listNotifications"
  | "markNotificationRead";

export type AppStore = Pick<AsyncifyMethods<InMemoryStore>, AppStoreMethodName>;
