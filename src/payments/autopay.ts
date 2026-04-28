import type { CalculationVersion, CollectionParticipant, ExpenseCategory, Payment, PaymentMethod, AutoPaymentRule } from "../domain";

export type AutoPaymentPreviewStatus = "eligible" | "blocked" | "already_exists";

export type AutoPaymentReasonCode =
  | "eligible"
  | "no_rule"
  | "rule_disabled"
  | "missing_payment_method"
  | "objection_window_open"
  | "participant_type_not_allowed"
  | "covered_participant_limit"
  | "collection_limit_exceeded"
  | "daily_limit_exceeded"
  | "monthly_limit_exceeded"
  | "existing_payment"
  | "unlinked_responsible_user";

export interface AutoPaymentPreviewItem {
  participantId: string;
  responsibleParticipantId: string;
  responsibleUserId: string | null;
  ruleId: string | null;
  paymentMethodId: string | null;
  category: string | null;
  amountMinor: number;
  status: AutoPaymentPreviewStatus;
  reasonCode: AutoPaymentReasonCode;
  reason: string;
  availableAt: string | null;
  idempotencyKey: string | null;
  existingPaymentId: string | null;
}

export interface AutoPaymentExecutionPlan {
  preview: AutoPaymentPreviewItem[];
  eligible: AutoPaymentPreviewItem[];
}

interface BuildAutoPaymentPlanInput {
  collectionId: string;
  collectionGroupId: string | null;
  nowIso: string;
  calculationVersion: CalculationVersion;
  participants: CollectionParticipant[];
  categories: ExpenseCategory[];
  paymentMethods: PaymentMethod[];
  autoPaymentRules: AutoPaymentRule[];
  payments: Payment[];
}

interface ExposureItem {
  participantId: string;
  responsibleParticipantId: string;
  responsibleUserId: string | null;
  category: string | null;
  amountMinor: number;
}

type UsageState = {
  collectionMinor: number;
  dailyMinor: number;
  monthlyMinor: number;
};

export function buildAutoPaymentPlan(input: BuildAutoPaymentPlanInput): AutoPaymentExecutionPlan {
  const now = new Date(input.nowIso);
  const categoryTitleById = new Map(input.categories.map((category) => [category.id, category.title.toLowerCase()]));
  const participantsById = new Map(input.participants.map((participant) => [participant.id, participant]));
  const allRules = input.autoPaymentRules.filter((rule) => rule.collectionId === null || rule.collectionId === input.collectionId)
    .filter((rule) => rule.groupId === null || rule.groupId === input.collectionGroupId);
  const paymentMethodsByUserId = new Map<string, PaymentMethod[]>();

  for (const method of input.paymentMethods) {
    const methods = paymentMethodsByUserId.get(method.userId) ?? [];
    methods.push(method);
    paymentMethodsByUserId.set(method.userId, methods);
  }

  const paymentsByResponsibleUserId = new Map<string, Payment[]>();
  for (const payment of input.payments) {
    const payments = paymentsByResponsibleUserId.get(payment.responsibleUserId) ?? [];
    payments.push(payment);
    paymentsByResponsibleUserId.set(payment.responsibleUserId, payments);
  }

  const coveredParticipantCounts = new Map<string, number>();
  for (const participant of input.participants) {
    if (!participant.paymentResponsibleParticipantId || participant.paymentResponsibleParticipantId === participant.id) {
      continue;
    }
    coveredParticipantCounts.set(
      participant.paymentResponsibleParticipantId,
      (coveredParticipantCounts.get(participant.paymentResponsibleParticipantId) ?? 0) + 1
    );
  }

  const exposures = buildExposureItems(input.calculationVersion, input.participants, categoryTitleById);
  const activeUsage = new Map<string, UsageState>();
  for (const [responsibleUserId, payments] of paymentsByResponsibleUserId) {
    activeUsage.set(responsibleUserId, calculateUsage(responsibleUserId, input.collectionId, payments, now));
  }

  const preview: AutoPaymentPreviewItem[] = [];
  const eligible: AutoPaymentPreviewItem[] = [];

  for (const exposure of exposures) {
    const selectedRule = selectRuleForExposure(allRules, exposure.category);
    if (!selectedRule) {
      preview.push(makeBlockedPreview(exposure, null, null, "no_rule", "No auto payment rule matches this exposure."));
      continue;
    }
    if (!selectedRule.enabled) {
      preview.push(makeBlockedPreview(exposure, selectedRule, null, "rule_disabled", "Auto payment rule is disabled."));
      continue;
    }
    if (!exposure.responsibleUserId) {
      preview.push(makeBlockedPreview(exposure, selectedRule, null, "unlinked_responsible_user", "Responsible participant is not linked to a user."));
      continue;
    }

    const paymentMethod = selectPaymentMethod(paymentMethodsByUserId.get(exposure.responsibleUserId) ?? []);
    if (!paymentMethod) {
      preview.push(makeBlockedPreview(exposure, selectedRule, null, "missing_payment_method", "Responsible user has no active payment method."));
      continue;
    }

    const participant = participantsById.get(exposure.participantId);
    if (!participant) {
      preview.push(makeBlockedPreview(exposure, selectedRule, paymentMethod, "participant_type_not_allowed", "Participant is not available for auto payment."));
      continue;
    }

    if (!isParticipantAllowed(participant, exposure.responsibleParticipantId, selectedRule)) {
      preview.push(makeBlockedPreview(exposure, selectedRule, paymentMethod, "participant_type_not_allowed", "Rule does not allow this participant type."));
      continue;
    }

    const coveredCount = coveredParticipantCounts.get(exposure.responsibleParticipantId) ?? 0;
    if (participant.id !== exposure.responsibleParticipantId && coveredCount > selectedRule.maxCoveredParticipants) {
      preview.push(makeBlockedPreview(exposure, selectedRule, paymentMethod, "covered_participant_limit", "Rule covered participant limit is exceeded."));
      continue;
    }

    const availableAt = selectedRule.requiresObjectionWindow
      ? new Date(new Date(input.calculationVersion.createdAt).getTime() + selectedRule.objectionWindowHours * 60 * 60 * 1000)
      : new Date(input.calculationVersion.createdAt);
    if (availableAt.getTime() > now.getTime()) {
      preview.push(makeBlockedPreview(exposure, selectedRule, paymentMethod, "objection_window_open", "Objection window is still open.", availableAt));
      continue;
    }

    const idempotencyKey = buildAutopayIdempotencyKey(input.collectionId, input.calculationVersion.version, exposure, selectedRule);
    const existingPayment = input.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
    if (existingPayment && existingPayment.status !== "failed" && existingPayment.status !== "cancelled" && existingPayment.status !== "refunded") {
      preview.push({
        participantId: exposure.participantId,
        responsibleParticipantId: exposure.responsibleParticipantId,
        responsibleUserId: exposure.responsibleUserId,
        ruleId: selectedRule.id,
        paymentMethodId: paymentMethod.id,
        category: exposure.category,
        amountMinor: exposure.amountMinor,
        status: "already_exists",
        reasonCode: "existing_payment",
        reason: "Matching auto payment already exists.",
        availableAt: availableAt.toISOString(),
        idempotencyKey,
        existingPaymentId: existingPayment.id
      });
      continue;
    }

    const usage = activeUsage.get(exposure.responsibleUserId) ?? { collectionMinor: 0, dailyMinor: 0, monthlyMinor: 0 };
    if (selectedRule.singleCollectionLimitMinor > 0 && usage.collectionMinor + exposure.amountMinor > selectedRule.singleCollectionLimitMinor) {
      preview.push(makeBlockedPreview(exposure, selectedRule, paymentMethod, "collection_limit_exceeded", "Collection auto payment limit is exceeded.", availableAt, idempotencyKey));
      continue;
    }
    if (selectedRule.dailyLimitMinor > 0 && usage.dailyMinor + exposure.amountMinor > selectedRule.dailyLimitMinor) {
      preview.push(makeBlockedPreview(exposure, selectedRule, paymentMethod, "daily_limit_exceeded", "Daily auto payment limit is exceeded.", availableAt, idempotencyKey));
      continue;
    }
    if (selectedRule.monthlyLimitMinor > 0 && usage.monthlyMinor + exposure.amountMinor > selectedRule.monthlyLimitMinor) {
      preview.push(makeBlockedPreview(exposure, selectedRule, paymentMethod, "monthly_limit_exceeded", "Monthly auto payment limit is exceeded.", availableAt, idempotencyKey));
      continue;
    }

    const eligibleItem: AutoPaymentPreviewItem = {
      participantId: exposure.participantId,
      responsibleParticipantId: exposure.responsibleParticipantId,
      responsibleUserId: exposure.responsibleUserId,
      ruleId: selectedRule.id,
      paymentMethodId: paymentMethod.id,
      category: exposure.category,
      amountMinor: exposure.amountMinor,
      status: "eligible",
      reasonCode: "eligible",
      reason: "Eligible for simulated auto payment.",
      availableAt: availableAt.toISOString(),
      idempotencyKey,
      existingPaymentId: null
    };
    preview.push(eligibleItem);
    eligible.push(eligibleItem);
    activeUsage.set(exposure.responsibleUserId, {
      collectionMinor: usage.collectionMinor + exposure.amountMinor,
      dailyMinor: usage.dailyMinor + exposure.amountMinor,
      monthlyMinor: usage.monthlyMinor + exposure.amountMinor
    });
  }

  return { preview, eligible };
}

function buildExposureItems(
  calculationVersion: CalculationVersion,
  participants: CollectionParticipant[],
  categoryTitleById: Map<string, string>
): ExposureItem[] {
  const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
  const items: ExposureItem[] = [];

  for (const calculation of calculationVersion.result.participantCalculations) {
    if (calculation.owesAmountMinor <= 0) {
      continue;
    }

    const participant = participantsById.get(calculation.participantId);
    const responsibleParticipant = participantsById.get(calculation.responsiblePayerId) ?? participant;
    const grouped = new Map<string, { category: string | null; amountMinor: number }>();
    let explainedTotal = 0;

    for (const line of calculation.explanation.included) {
      const category = line.categoryId ? (categoryTitleById.get(line.categoryId) ?? null) : null;
      const key = category ?? "__uncategorized__";
      const current = grouped.get(key) ?? { category, amountMinor: 0 };
      current.amountMinor += line.amountMinor;
      grouped.set(key, current);
      explainedTotal += line.amountMinor;
    }

    if (explainedTotal < calculation.owesAmountMinor) {
      const current = grouped.get("__uncategorized__") ?? { category: null, amountMinor: 0 };
      current.amountMinor += calculation.owesAmountMinor - explainedTotal;
      grouped.set("__uncategorized__", current);
    }

    for (const entry of grouped.values()) {
      if (entry.amountMinor <= 0) {
        continue;
      }
      items.push({
        participantId: calculation.participantId,
        responsibleParticipantId: calculation.responsiblePayerId,
        responsibleUserId: responsibleParticipant?.linkedUserId ?? null,
        category: entry.category,
        amountMinor: entry.amountMinor
      });
    }
  }

  return items.sort((left, right) =>
    left.responsibleParticipantId.localeCompare(right.responsibleParticipantId) ||
    left.participantId.localeCompare(right.participantId) ||
    (left.category ?? "").localeCompare(right.category ?? "")
  );
}

function selectRuleForExposure(rules: AutoPaymentRule[], category: string | null): AutoPaymentRule | null {
  const normalizedCategory = category?.toLowerCase() ?? null;
  const candidates = rules.filter((rule) => rule.category === null || rule.category.toLowerCase() === normalizedCategory);
  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => {
    const specificityDelta = scoreRuleSpecificity(right, normalizedCategory) - scoreRuleSpecificity(left, normalizedCategory);
    if (specificityDelta !== 0) {
      return specificityDelta;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  })[0] ?? null;
}

function scoreRuleSpecificity(rule: AutoPaymentRule, category: string | null): number {
  return (rule.collectionId ? 100 : 0) + (rule.groupId ? 10 : 0) + (rule.category && rule.category.toLowerCase() === category ? 1 : 0);
}

function selectPaymentMethod(methods: PaymentMethod[]): PaymentMethod | null {
  const active = methods.filter((method) => method.status === "active");
  if (active.length === 0) {
    return null;
  }
  return active.find((method) => method.isDefault) ?? active.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

function isParticipantAllowed(
  participant: CollectionParticipant,
  responsibleParticipantId: string,
  rule: AutoPaymentRule
): boolean {
  if (participant.id === responsibleParticipantId) {
    return true;
  }

  if (participant.participantType === "guest") {
    return rule.allowGuests;
  }
  if (participant.participantType === "child") {
    return rule.allowChildren;
  }
  if (participant.relationshipHint === "partner") {
    return rule.allowPartner;
  }

  return false;
}

function calculateUsage(
  responsibleUserId: string,
  collectionId: string,
  payments: Payment[],
  now: Date
): UsageState {
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  return payments
    .filter((payment) => payment.responsibleUserId === responsibleUserId)
    .filter((payment) => payment.status === "pending" || payment.status === "processing" || payment.status === "succeeded")
    .reduce<UsageState>(
      (usage, payment) => {
        if (payment.collectionId === collectionId) {
          usage.collectionMinor += payment.amountMinor;
        }
        if (payment.createdAt.slice(0, 10) === dayKey) {
          usage.dailyMinor += payment.amountMinor;
        }
        if (payment.createdAt.slice(0, 7) === monthKey) {
          usage.monthlyMinor += payment.amountMinor;
        }
        return usage;
      },
      { collectionMinor: 0, dailyMinor: 0, monthlyMinor: 0 }
    );
}

function buildAutopayIdempotencyKey(
  collectionId: string,
  calculationVersion: number,
  exposure: ExposureItem,
  rule: AutoPaymentRule
): string {
  return [
    "autopay",
    collectionId,
    `v${calculationVersion}`,
    exposure.participantId,
    exposure.category ?? "all",
    rule.id
  ].join(":");
}

function makeBlockedPreview(
  exposure: ExposureItem,
  rule: AutoPaymentRule | null,
  paymentMethod: PaymentMethod | null,
  reasonCode: Exclude<AutoPaymentReasonCode, "eligible" | "existing_payment">,
  reason: string,
  availableAt?: Date,
  idempotencyKey?: string | null
): AutoPaymentPreviewItem {
  return {
    participantId: exposure.participantId,
    responsibleParticipantId: exposure.responsibleParticipantId,
    responsibleUserId: exposure.responsibleUserId,
    ruleId: rule?.id ?? null,
    paymentMethodId: paymentMethod?.id ?? null,
    category: exposure.category,
    amountMinor: exposure.amountMinor,
    status: "blocked",
    reasonCode,
    reason,
    availableAt: availableAt?.toISOString() ?? null,
    idempotencyKey: idempotencyKey ?? null,
    existingPaymentId: null
  };
}
