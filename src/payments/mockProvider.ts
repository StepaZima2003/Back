import { createHmac } from "node:crypto";

export type MockProviderWebhookEventType = "payment.succeeded" | "payment.failed" | "payment.refunded";

export interface MockProviderWebhookPayload {
  providerPaymentId: string;
  eventType: MockProviderWebhookEventType;
  occurredAt?: string | null;
  reason?: string | null;
}

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
