import type {
  Payment,
  PaymentMethod,
  PaymentProvider,
  PaymentProviderWebhookEventType
} from "../domain";
import { createMockProviderAdapter } from "./mockProvider";

export interface CreatePaymentMethodBindingInput {
  provider: PaymentProvider;
  userId: string;
  maskedPan: string;
  brand: PaymentMethod["brand"];
  existingProviderCustomerId?: string | null;
}

export interface ProviderPaymentMethodBindingResult {
  providerCustomerId: string;
  providerSetupId: string | null;
  providerPaymentMethodId: string;
  providerStatus: PaymentMethod["status"];
  providerMetadata: Record<string, unknown>;
}

export interface CreatePaymentMethodSetupInput {
  provider: PaymentProvider;
  userId: string;
  existingProviderCustomerId?: string | null;
}

export interface ProviderPaymentMethodSetupResult {
  providerCustomerId: string;
  providerSetupId: string;
  providerStatus: PaymentMethod["status"];
  providerMetadata: Record<string, unknown>;
}

export interface CreatePaymentIntentInput {
  provider: PaymentProvider;
  paymentId: string;
  collectionId: string;
  participantId: string | null;
  responsibleUserId: string;
  amountMinor: number;
  currency: Payment["currency"];
  idempotencyKey: string;
  paymentMethod: PaymentMethod | null;
}

export interface ProviderPaymentIntentResult {
  providerPaymentId: string;
  providerStatus: string;
  providerMetadata: Record<string, unknown>;
}

export interface NormalizedPaymentWebhookEvent {
  provider: PaymentProvider;
  eventId: string;
  providerPaymentId: string;
  eventType: PaymentProviderWebhookEventType;
  occurredAt: string | null;
  reason: string | null;
  providerStatus: string;
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  createPaymentMethodSetup(input: CreatePaymentMethodSetupInput): ProviderPaymentMethodSetupResult;
  createPaymentMethodBinding(input: CreatePaymentMethodBindingInput): ProviderPaymentMethodBindingResult;
  createPaymentIntent(input: CreatePaymentIntentInput): ProviderPaymentIntentResult;
  verifyAndNormalizeWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }): NormalizedPaymentWebhookEvent;
}

export function normalizePaymentProvider(value: string | null | undefined): PaymentProvider {
  switch (value) {
    case "yookassa":
    case "bank":
    case "sbp":
    case "manual":
    case "other":
      return value;
    default:
      return "other";
  }
}

const providerAdapters = new Map<PaymentProvider, PaymentProviderAdapter>([
  ["yookassa", createMockProviderAdapter("yookassa")],
  ["bank", createMockProviderAdapter("bank")],
  ["sbp", createMockProviderAdapter("sbp")],
  ["manual", createMockProviderAdapter("manual")],
  ["other", createMockProviderAdapter("other")]
]);

export function getPaymentProviderAdapter(provider: PaymentProvider): PaymentProviderAdapter {
  return providerAdapters.get(provider) ?? providerAdapters.get("other")!;
}
