import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PaymentProvider, PaymentProviderWebhookEventType } from "../domain";
import type {
  CreatePaymentIntentInput,
  CreatePaymentMethodBindingInput,
  NormalizedPaymentWebhookEvent,
  PaymentProviderAdapter,
  ProviderPaymentIntentResult,
  ProviderPaymentMethodBindingResult
} from "./providerAdapter";

export interface MockProviderWebhookPayload {
  eventId: string;
  providerPaymentId: string;
  eventType: PaymentProviderWebhookEventType;
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

export function getMockProviderWebhookSecret(): string {
  return process.env.MOCK_PROVIDER_WEBHOOK_SECRET?.trim() || "dev-mock-provider-secret";
}

export function createMockProviderWebhookSignature(payload: MockProviderWebhookPayload, secret = getMockProviderWebhookSecret()): string {
  return createHmac("sha256", secret)
    .update(stableJson(payload))
    .digest("hex");
}

export function verifyMockProviderWebhookSignature(
  payload: MockProviderWebhookPayload,
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
    createPaymentMethodBinding(input: CreatePaymentMethodBindingInput): ProviderPaymentMethodBindingResult {
      return {
        providerPaymentMethodId: `${provider}_pm_${randomUUID()}`,
        providerMetadata: {
          mode: "mock",
          provider,
          maskedPan: input.maskedPan,
          brand: input.brand
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
    verifyAndNormalizeWebhook({ headers, body }): NormalizedPaymentWebhookEvent {
      const payload = mockProviderWebhookSchema.parse(body) as MockProviderWebhookPayload;
      const signatureHeader = headers["x-mock-provider-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!verifyMockProviderWebhookSignature(payload, signature)) {
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
