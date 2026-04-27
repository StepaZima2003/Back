export type SplitMode = "equal" | "weights" | "fixed" | "percent" | "excluded" | "cap";

export type CalculationWarningCode =
  | "ZERO_TOTAL"
  | "EXPENSE_WITHOUT_PAYER"
  | "EXPENSE_WITHOUT_PARTICIPANTS"
  | "ZERO_WEIGHT_SUM"
  | "PARTICIPANT_EXCLUDED_FROM_ALL_CATEGORIES"
  | "GUEST_WITHOUT_RESPONSIBLE_PAYER"
  | "ROUNDING_MISMATCH"
  | "INCOMPLETE_EXPENSE_PAYMENT"
  | "SPLIT_RULES_CONFLICT"
  | "UNKNOWN_PARTICIPANT";

export interface CalculationParticipantInput {
  id: string;
  displayName: string;
  participantType?: "registered_user" | "invited_phone" | "guest" | "child" | "external_person" | "group_proxy";
  defaultWeight?: number;
  responsiblePayerId?: string | null;
}

export interface ExpensePaymentInput {
  participantId: string;
  amountMinor: number;
}

export interface ExpenseShareRuleInput {
  participantId: string;
  splitMode: SplitMode;
  categoryId?: string | null;
  weight?: number | null;
  fixedAmountMinor?: number | null;
  percent?: number | null;
  capAmountMinor?: number | null;
  excluded?: boolean | null;
  reason?: string | null;
}

export interface ExpenseInput {
  id: string;
  title: string;
  amountMinor: number;
  currency?: string;
  categoryId?: string | null;
  payments: ExpensePaymentInput[];
  shareRules?: ExpenseShareRuleInput[];
}

export interface CalculateCollectionInput {
  collectionId: string;
  currency: string;
  participants: CalculationParticipantInput[];
  expenses: ExpenseInput[];
}

export interface CalculationExplanationLine {
  expenseId: string;
  expenseTitle: string;
  categoryId?: string | null;
  amountMinor: number;
  reason?: string | null;
}

export interface ParticipantCalculationResult {
  participantId: string;
  displayName: string;
  responsiblePayerId: string;
  owesAmountMinor: number;
  paidAmountMinor: number;
  netBalanceMinor: number;
  explanation: {
    included: CalculationExplanationLine[];
    excluded: CalculationExplanationLine[];
  };
}

export interface ResponsiblePayerCalculationResult {
  responsiblePayerId: string;
  totalOwesAmountMinor: number;
  totalPaidAmountMinor: number;
  netBalanceMinor: number;
  coveredParticipantIds: string[];
  explanationSummary: Record<string, number>;
}

export interface TransferPlanItem {
  fromResponsiblePayerId: string;
  toResponsiblePayerId: string;
  amountMinor: number;
  status: "pending";
  confirmationRequiredBy: "recipient" | "organizer" | "both" | "none";
}

export interface CalculationWarning {
  code: CalculationWarningCode;
  message: string;
  expenseId?: string;
  participantId?: string;
}

export interface CalculateCollectionResult {
  collectionId: string;
  currency: string;
  totalAmountMinor: number;
  participantCalculations: ParticipantCalculationResult[];
  responsiblePayerCalculations: ResponsiblePayerCalculationResult[];
  transferPlan: TransferPlanItem[];
  warnings: CalculationWarning[];
}

