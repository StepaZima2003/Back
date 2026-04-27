import { allocateByWeights, type WeightedAllocationInput } from "./money";
import type {
  CalculateCollectionInput,
  CalculateCollectionResult,
  CalculationParticipantInput,
  CalculationWarning,
  ExpenseInput,
  ExpenseShareRuleInput,
  ParticipantCalculationResult,
  ResponsiblePayerCalculationResult,
  TransferPlanItem
} from "./types";

interface ParticipantAccumulator extends ParticipantCalculationResult {
  excludedCount: number;
}

export function calculateCollection(input: CalculateCollectionInput): CalculateCollectionResult {
  const participantsById = new Map(input.participants.map((participant) => [participant.id, participant]));
  const warnings: CalculationWarning[] = [];
  const totalAmountMinor = input.expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);

  if (totalAmountMinor === 0) {
    warnings.push({
      code: "ZERO_TOTAL",
      message: "Total expense amount is zero."
    });
  }

  const participantCalculations = new Map<string, ParticipantAccumulator>();

  for (const participant of input.participants) {
    if (participant.participantType === "guest" && !participant.responsiblePayerId) {
      warnings.push({
        code: "GUEST_WITHOUT_RESPONSIBLE_PAYER",
        message: "Guest participant has no responsible payer.",
        participantId: participant.id
      });
    }

    participantCalculations.set(participant.id, {
      participantId: participant.id,
      displayName: participant.displayName,
      responsiblePayerId: resolveResponsiblePayerId(participant),
      owesAmountMinor: 0,
      paidAmountMinor: 0,
      netBalanceMinor: 0,
      excludedCount: 0,
      explanation: {
        included: [],
        excluded: []
      }
    });
  }

  for (const expense of input.expenses) {
    applyExpensePayments(expense, participantCalculations, participantsById, warnings);
    applyExpenseShares(expense, input.participants, participantCalculations, warnings);
  }

  for (const calculation of participantCalculations.values()) {
    calculation.netBalanceMinor = calculation.paidAmountMinor - calculation.owesAmountMinor;

    if (input.expenses.length > 0 && calculation.owesAmountMinor === 0 && calculation.excludedCount === input.expenses.length) {
      warnings.push({
        code: "PARTICIPANT_EXCLUDED_FROM_ALL_CATEGORIES",
        message: "Participant is excluded from all expenses.",
        participantId: calculation.participantId
      });
    }
  }

  const participantResults = [...participantCalculations.values()].map(({ excludedCount: _excludedCount, ...result }) => result);
  const responsiblePayerCalculations = calculateResponsiblePayers(input.participants, participantResults);
  const transferPlan = calculateTransferPlan(responsiblePayerCalculations);

  return {
    collectionId: input.collectionId,
    currency: input.currency,
    totalAmountMinor,
    participantCalculations: participantResults,
    responsiblePayerCalculations,
    transferPlan,
    warnings
  };
}

function applyExpensePayments(
  expense: ExpenseInput,
  participantCalculations: Map<string, ParticipantAccumulator>,
  participantsById: Map<string, CalculationParticipantInput>,
  warnings: CalculationWarning[]
): void {
  if (expense.payments.length === 0) {
    warnings.push({
      code: "EXPENSE_WITHOUT_PAYER",
      message: "Expense has no payer.",
      expenseId: expense.id
    });
    return;
  }

  let paidAmountMinor = 0;

  for (const payment of expense.payments) {
    paidAmountMinor += payment.amountMinor;
    const participant = participantsById.get(payment.participantId);
    const calculation = participantCalculations.get(payment.participantId);

    if (!participant || !calculation) {
      warnings.push({
        code: "UNKNOWN_PARTICIPANT",
        message: "Expense payment references an unknown participant.",
        expenseId: expense.id,
        participantId: payment.participantId
      });
      continue;
    }

    calculation.paidAmountMinor += payment.amountMinor;
  }

  if (paidAmountMinor !== expense.amountMinor) {
    warnings.push({
      code: "INCOMPLETE_EXPENSE_PAYMENT",
      message: "Expense payment total does not match expense amount.",
      expenseId: expense.id
    });
  }
}

function applyExpenseShares(
  expense: ExpenseInput,
  participants: CalculationParticipantInput[],
  participantCalculations: Map<string, ParticipantAccumulator>,
  warnings: CalculationWarning[]
): void {
  const fixedShares = new Map<string, { amountMinor: number; reason?: string | null }>();
  const percentShares = new Map<string, { amountMinor: number; reason?: string | null }>();
  const excludedParticipantIds = new Set<string>();
  const weightedItems: WeightedAllocationInput[] = [];

  for (const participant of participants) {
    const rule = selectRule(expense, participant.id);

    if (rule?.excluded || rule?.splitMode === "excluded") {
      excludedParticipantIds.add(participant.id);
      continue;
    }

    if (rule?.splitMode === "fixed") {
      fixedShares.set(participant.id, {
        amountMinor: Math.max(0, rule.fixedAmountMinor ?? 0),
        reason: rule.reason
      });
      continue;
    }

    if (rule?.splitMode === "percent") {
      const percent = Math.max(0, rule.percent ?? 0);
      percentShares.set(participant.id, {
        amountMinor: Math.round((expense.amountMinor * percent) / 100),
        reason: rule.reason
      });
      continue;
    }

    const defaultWeight = participant.defaultWeight ?? 1;
    const weight = rule?.weight ?? defaultWeight;

    if (weight <= 0) {
      excludedParticipantIds.add(participant.id);
      continue;
    }

    weightedItems.push({
      id: participant.id,
      weight,
      capAmountMinor: rule?.splitMode === "cap" ? rule.capAmountMinor : undefined
    });
  }

  for (const participantId of excludedParticipantIds) {
    const calculation = participantCalculations.get(participantId);
    if (!calculation) {
      continue;
    }

    calculation.excludedCount += 1;
    calculation.explanation.excluded.push({
      expenseId: expense.id,
      expenseTitle: expense.title,
      categoryId: expense.categoryId,
      amountMinor: 0,
      reason: selectRule(expense, participantId)?.reason ?? "Participant excluded from expense."
    });
  }

  let allocatedMinor = 0;

  for (const [participantId, fixed] of fixedShares) {
    allocatedMinor += fixed.amountMinor;
    addOwedShare(expense, participantId, fixed.amountMinor, fixed.reason, participantCalculations);
  }

  for (const [participantId, percent] of percentShares) {
    allocatedMinor += percent.amountMinor;
    addOwedShare(expense, participantId, percent.amountMinor, percent.reason, participantCalculations);
  }

  let remainingMinor = expense.amountMinor - allocatedMinor;

  if (remainingMinor < 0) {
    warnings.push({
      code: "SPLIT_RULES_CONFLICT",
      message: "Fixed and percent split rules exceed expense amount.",
      expenseId: expense.id
    });
    remainingMinor = 0;
  }

  if (weightedItems.length === 0 && remainingMinor > 0) {
    warnings.push({
      code: "EXPENSE_WITHOUT_PARTICIPANTS",
      message: "Expense has no eligible participants.",
      expenseId: expense.id
    });
    return;
  }

  if (weightedItems.length > 0 && weightedItems.every((item) => item.weight <= 0)) {
    warnings.push({
      code: "ZERO_WEIGHT_SUM",
      message: "Expense split weight sum is zero.",
      expenseId: expense.id
    });
    return;
  }

  const allocation = allocateByWeights(remainingMinor, weightedItems);

  if (allocation.unallocatedMinor !== 0) {
    warnings.push({
      code: "SPLIT_RULES_CONFLICT",
      message: "Caps leave part of expense unallocated.",
      expenseId: expense.id
    });
  }

  let allocatedByWeights = 0;
  for (const [participantId, amountMinor] of allocation.allocations) {
    allocatedByWeights += amountMinor;
    addOwedShare(expense, participantId, amountMinor, selectRule(expense, participantId)?.reason, participantCalculations);
  }

  if (allocatedMinor + allocatedByWeights + allocation.unallocatedMinor !== expense.amountMinor) {
    warnings.push({
      code: "ROUNDING_MISMATCH",
      message: "Allocated amount does not match expense amount.",
      expenseId: expense.id
    });
  }
}

function addOwedShare(
  expense: ExpenseInput,
  participantId: string,
  amountMinor: number,
  reason: string | null | undefined,
  participantCalculations: Map<string, ParticipantAccumulator>
): void {
  const calculation = participantCalculations.get(participantId);
  if (!calculation || amountMinor === 0) {
    return;
  }

  calculation.owesAmountMinor += amountMinor;
  calculation.explanation.included.push({
    expenseId: expense.id,
    expenseTitle: expense.title,
    categoryId: expense.categoryId,
    amountMinor,
    reason
  });
}

function selectRule(expense: ExpenseInput, participantId: string): ExpenseShareRuleInput | undefined {
  const matchingRules = (expense.shareRules ?? []).filter((rule) => {
    const sameParticipant = rule.participantId === participantId;
    const sameCategory = !rule.categoryId || rule.categoryId === expense.categoryId;
    return sameParticipant && sameCategory;
  });

  return matchingRules.at(-1);
}

function resolveResponsiblePayerId(participant: CalculationParticipantInput): string {
  return participant.responsiblePayerId ?? participant.id;
}

function calculateResponsiblePayers(
  participants: CalculationParticipantInput[],
  participantCalculations: ParticipantCalculationResult[]
): ResponsiblePayerCalculationResult[] {
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const responsiblePayers = new Map<string, ResponsiblePayerCalculationResult>();

  const ensureResponsiblePayer = (responsiblePayerId: string): ResponsiblePayerCalculationResult => {
    const existing = responsiblePayers.get(responsiblePayerId);
    if (existing) {
      return existing;
    }

    const created: ResponsiblePayerCalculationResult = {
      responsiblePayerId,
      totalOwesAmountMinor: 0,
      totalPaidAmountMinor: 0,
      netBalanceMinor: 0,
      coveredParticipantIds: [],
      explanationSummary: {}
    };
    responsiblePayers.set(responsiblePayerId, created);
    return created;
  };

  for (const calculation of participantCalculations) {
    const participant = participantById.get(calculation.participantId);
    const responsiblePayerId = participant ? resolveResponsiblePayerId(participant) : calculation.participantId;
    const responsible = ensureResponsiblePayer(responsiblePayerId);

    responsible.totalOwesAmountMinor += calculation.owesAmountMinor;
    responsible.coveredParticipantIds.push(calculation.participantId);
    responsible.explanationSummary[calculation.participantId] = calculation.owesAmountMinor;
  }

  for (const calculation of participantCalculations) {
    const participant = participantById.get(calculation.participantId);
    const responsiblePayerId = participant ? resolveResponsiblePayerId(participant) : calculation.participantId;
    const responsible = ensureResponsiblePayer(responsiblePayerId);
    responsible.totalPaidAmountMinor += calculation.paidAmountMinor;
  }

  for (const responsible of responsiblePayers.values()) {
    responsible.netBalanceMinor = responsible.totalPaidAmountMinor - responsible.totalOwesAmountMinor;
  }

  return [...responsiblePayers.values()].sort((a, b) => a.responsiblePayerId.localeCompare(b.responsiblePayerId));
}

function calculateTransferPlan(responsiblePayers: ResponsiblePayerCalculationResult[]): TransferPlanItem[] {
  const debtors = responsiblePayers
    .filter((payer) => payer.netBalanceMinor < 0)
    .map((payer) => ({ id: payer.responsiblePayerId, amountMinor: Math.abs(payer.netBalanceMinor) }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  const creditors = responsiblePayers
    .filter((payer) => payer.netBalanceMinor > 0)
    .map((payer) => ({ id: payer.responsiblePayerId, amountMinor: payer.netBalanceMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const transfers: TransferPlanItem[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = Math.min(debtor.amountMinor, creditor.amountMinor);

    if (amountMinor > 0) {
      transfers.push({
        fromResponsiblePayerId: debtor.id,
        toResponsiblePayerId: creditor.id,
        amountMinor,
        status: "pending",
        confirmationRequiredBy: "recipient"
      });
    }

    debtor.amountMinor -= amountMinor;
    creditor.amountMinor -= amountMinor;

    if (debtor.amountMinor === 0) {
      debtorIndex += 1;
    }
    if (creditor.amountMinor === 0) {
      creditorIndex += 1;
    }
  }

  return transfers;
}

