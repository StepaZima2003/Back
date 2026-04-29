import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PaymentCardBrand, PaymentProvider, PaymentProviderWebhookEventType } from "../domain";
import type {
  CreatePaymentIntentInput,
  CreatePaymentMethodSetupInput,
  CreatePaymentMethodBindingInput,
  NormalizedPaymentWebhookEvent,
  PaymentProviderAdapter,
  ProviderPaymentIntentResult,
  ProviderPaymentMethodBindingResult,
  ProviderPaymentMethodSetupResult
} from "./providerAdapter";

export interface MockProviderWebhookPayload {
  eventId: string;
  providerPaymentId: string;
  eventType: Extract<PaymentProviderWebhookEventType, "payment.succeeded" | "payment.failed" | "payment.refunded">;
  occurredAt?: string | null;
  reason?: string | null;
  providerStatus?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface MockProviderPaymentMethodSetupWebhookPayload {
  eventId: string;
  providerSetupId: string;
  eventType: Extract<PaymentProviderWebhookEventType, "payment_method.setup_succeeded" | "payment_method.setup_failed">;
  providerPaymentMethodId?: string | null;
  maskedPan?: string | null;
  brand?: PaymentCardBrand | null;
  occurredAt?: string | null;
  reason?: string | null;
  providerStatus?: string | null;
  metadata?: Record<string, unknown> | null;
}

const mockProviderWebhookSchema = z.object({
  eventId: z.string().min(1),
  providerPaymentId: z.string().min(1),
  eventType: z.enum(["payment.succeeded", "payment.failed", "payment.refunded"]),
  occurredAt: z.string().datetime().nullable().optional(),
  reason: z.string().nullable().optional(),
  providerStatus: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional()
});

const mockProviderPaymentMethodSetupWebhookSchema = z.object({
  eventId: z.string().min(1),
  providerSetupId: z.string().min(1),
  eventType: z.enum(["payment_method.setup_succeeded", "payment_method.setup_failed"]),
  providerPaymentMethodId: z.string().min(1).nullable().optional(),
  maskedPan: z.string().min(4).max(32).nullable().optional(),
  brand: z.enum(["visa", "mastercard", "mir", "unknown"]).nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  reason: z.string().nullable().optional(),
  providerStatus: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional()
});

export function getMockProviderWebhookSecret(): string {
  return process.env.MOCK_PROVIDER_WEBHOOK_SECRET?.trim() || "dev-mock-provider-secret";
}

export function createMockProviderWebhookSignature(
  payload: Record<string, unknown>,
  secret = getMockProviderWebhookSecret()
): string {
  return createHmac("sha256", secret)
    .update(stableJson(payload))
    .digest("hex");
}

export function verifyMockProviderWebhookSignature(
  payload: Record<string, unknown>,
  providedSignature: string | undefined,
  secret = getMockProviderWebhookSecret()
): boolean {
  if (!providedSignature?.trim()) {
    return false;
  }
  return createMockProviderWebhookSignature(payload, secret) === providedSignature.trim();
}

export function createMockProviderAdapter(provider: PaymentProvider): PaymentProviderAdapter {
  return {
    provider,
    createPaymentMethodSetup(input: CreatePaymentMethodSetupInput): ProviderPaymentMethodSetupResult {
      const providerCustomerId = input.existingProviderCustomerId?.trim() || `${provider}_cust_${randomUUID()}`;
      return {
        providerCustomerId,
        providerSetupId: `${provider}_setup_${randomUUID()}`,
        providerStatus: "requires_confirmation",
        providerMetadata: {
          mode: "mock",
          provider,
          customerReference: providerCustomerId,
          flow: "payment_method_setup"
        }
      };
    },
    createPaymentMethodBinding(input: CreatePaymentMethodBindingInput): ProviderPaymentMethodBindingResult {
      const providerCustomerId = input.existingProviderCustomerId?.trim() || `${provider}_cust_${randomUUID()}`;
      return {
        providerCustomerId,
        providerSetupId: null,
        providerPaymentMethodId: `${provider}_pm_${randomUUID()}`,
        providerStatus: "active",
        providerMetadata: {
          mode: "mock",
          provider,
          customerReference: providerCustomerId,
          maskedPan: input.maskedPan,
          brand: input.brand,
          flow: "legacy_bind"
        }
      };
    },
    createPaymentIntent(input: CreatePaymentIntentInput): ProviderPaymentIntentResult {
      return {
        providerPaymentId: `${provider}_pay_${randomUUID()}`,
        providerStatus: "pending",
        providerMetadata: {
          mode: "mock",
          provider,
          paymentMethodReference: input.paymentMethod?.providerPaymentMethodId ?? null,
          collectionId: input.collectionId,
          participantId: input.participantId,
          amountMinor: input.amountMinor
        }
      };
    },
    verifyAndNormalizePaymentWebhook({ headers, body }): NormalizedPaymentWebhookEvent {
      const payload = mockProviderWebhookSchema.parse(body) as MockProviderWebhookPayload;
      const signatureHeader = headers["x-mock-provider-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!verifyMockProviderWebhookSignature(payload as unknown as Record<string, unknown>, signature)) {
        throw new Error("Invalid mock provider signature.");
      }

      return {
        provider,
        eventId: payload.eventId,
        providerPaymentId: payload.providerPaymentId,
        eventType: payload.eventType,
        occurredAt: payload.occurredAt ?? null,
        reason: payload.reason ?? null,
        providerStatus: payload.providerStatus ?? defaultProviderStatusForEvent(payload.eventType),
        metadata: payload.metadata ?? {},
        rawPayload: payload as unknown as Record<string, unknown>
      };
    },
    verifyAndNormalizePaymentMethodSetupWebhook({ headers, body }): NormalizedPaymentWebhookEvent {
      const payload = mockProviderPaymentMethodSetupWebhookSchema.parse(body) as MockProviderPaymentMethodSetupWebhookPayload;
      const signatureHeader = headers["x-mock-provider-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!verifyMockProviderWebhookSignature(payload as unknown as Record<string, unknown>, signature)) {
        throw new Error("Invalid mock provider signature.");
      }

      return {
        provider,
        eventId: payload.eventId,
        providerPaymentId: payload.providerSetupId,
        eventType: payload.eventType,
        occurredAt: payload.occurredAt ?? null,
        reason: payload.reason ?? null,
        providerStatus: payload.providerStatus ?? defaultProviderStatusForEvent(payload.eventType),
        providerPaymentMethodId: payload.providerPaymentMethodId ?? null,
        maskedPan: payload.maskedPan ?? null,
        brand: payload.brand ?? null,
        metadata: payload.metadata ?? {},
        rawPayload: payload as unknown as Record<string, unknown>
      };
    }
  };
}

function defaultProviderStatusForEvent(eventType: PaymentProviderWebhookEventType): string {
  switch (eventType) {
    case "payment.succeeded":
      return "succeeded";
    case "payment.failed":
      return "failed";
    case "payment.refunded":
      return "refunded";
    case "payment_method.setup_succeeded":
      return "active";
    case "payment_method.setup_failed":
      return "failed";
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }
  return value;
}
