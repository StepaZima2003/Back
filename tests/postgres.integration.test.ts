import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/api/app";
import { createAutoPaymentSweepWorker } from "../src/payments/autopayWorker";
import { createPaymentWebhookRetryWorker } from "../src/payments/webhookRetryWorker";
import { createMockProviderWebhookSignature } from "../src/payments/mockProvider";
import { PrismaStore } from "../src/store";
import { createIntegrationPrismaClient, resetIntegrationDatabase } from "./support/postgresIntegration";

describe("PostgreSQL integration", () => {
  let client: PrismaClient;
  let app: FastifyInstance | null = null;

  async function createApp(): Promise<FastifyInstance> {
    return await buildApp({
      store: await PrismaStore.create(client as never)
    });
  }

  async function auth(targetApp: FastifyInstance, phone: string) {
    await targetApp.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
    const response = await targetApp.inject({
      method: "POST",
      url: "/auth/verify-otp",
      payload: { phone, otp: "000000" }
    });
    const body = response.json();

    return {
      user: body.user,
      authorization: `Bearer ${body.accessToken}`
    };
  }

  beforeAll(async () => {
    client = createIntegrationPrismaClient();
    await client.$connect();
    await client.$queryRawUnsafe("SELECT 1");
  });

  beforeEach(async () => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.MOCK_PROVIDER_WEBHOOK_SECRET = "test-webhook-secret";
    await resetIntegrationDatabase(client);
    app = await createApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    delete process.env.INTERNAL_API_TOKEN;
    delete process.env.MOCK_PROVIDER_WEBHOOK_SECRET;
  });

  afterAll(async () => {
    await resetIntegrationDatabase(client);
    await client.$disconnect();
  });

  it("runs the review, dispute, and manual payment flow against live PostgreSQL", async () => {
    const organizer = await auth(app!, "+79990011001");
    const participantUser = await auth(app!, "+79990011002");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Live trip", type: "trip" }
    });
    expect(collectionResponse.statusCode).toBe(201);
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    expect(participantResponse.statusCode).toBe(201);
    const participant = participantResponse.json();

    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Hotel",
        amountMinor: 12000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 12000, paymentSource: "card" }]
      }
    });

    const calculationResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });
    expect(calculationResponse.statusCode).toBe(201);
    expect(calculationResponse.json().version).toBe(1);

    const reviewResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/send-to-review`,
      headers: { authorization: organizer.authorization }
    });
    expect(reviewResponse.statusCode).toBe(200);

    const confirmResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants/${participant.id}/confirm-review`,
      headers: { authorization: participantUser.authorization }
    });
    expect(confirmResponse.statusCode).toBe(200);

    const disputeResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/disputes`,
      headers: { authorization: participantUser.authorization },
      payload: {
        participantId: participant.id,
        type: "partial_time",
        message: "Joined for half only."
      }
    });
    expect(disputeResponse.statusCode).toBe(201);
    const dispute = disputeResponse.json();

    const resolvedResponse = await app!.inject({
      method: "POST",
      url: `/disputes/${dispute.id}/resolve`,
      headers: { authorization: organizer.authorization },
      payload: { resolutionComment: "Recalculated after review." }
    });
    expect(resolvedResponse.statusCode).toBe(200);
    expect(resolvedResponse.json().calculationVersion.version).toBe(2);

    const latestCalculationResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/calculations/latest`,
      headers: { authorization: organizer.authorization }
    });
    const latestCalculation = latestCalculationResponse.json();
    expect(latestCalculation.version).toBe(2);

    const manualPaymentResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/manual-payments/mark-paid`,
      headers: { authorization: participantUser.authorization },
      payload: {
        payerParticipantId: participant.id,
        receiverParticipantId: organizerParticipant.id,
        amountMinor: latestCalculation.result.transferPlan[0]?.amountMinor ?? 6000,
        method: "sbp",
        comment: "Paid manually"
      }
    });
    expect(manualPaymentResponse.statusCode).toBe(201);
    const manualPayment = manualPaymentResponse.json();

    const confirmManualPaymentResponse = await app!.inject({
      method: "POST",
      url: `/manual-payments/${manualPayment.id}/confirm`,
      headers: { authorization: organizer.authorization }
    });
    expect(confirmManualPaymentResponse.statusCode).toBe(200);
    expect(confirmManualPaymentResponse.json().status).toBe("confirmed");

    const auditResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/audit-log`,
      headers: { authorization: organizer.authorization }
    });
    const auditLog = auditResponse.json();
    expect(auditLog.some((entry: { entityType: string }) => entry.entityType === "dispute")).toBe(true);
    expect(auditLog.some((entry: { entityType: string }) => entry.entityType === "manual_payment")).toBe(true);
  });

  it("persists group profiles, template categories, and itemized expenses across app restarts", async () => {
    const organizer = await auth(app!, "+79990011011");
    const friend = await auth(app!, "+79990011012");

    const groupResponse = await app!.inject({
      method: "POST",
      url: "/groups",
      headers: { authorization: organizer.authorization },
      payload: { title: "Family", groupType: "family" }
    });
    const group = groupResponse.json();

    const profileResponse = await app!.inject({
      method: "POST",
      url: `/groups/${group.id}/participant-profiles`,
      headers: { authorization: organizer.authorization },
      payload: {
        linkedUserId: friend.user.id,
        relationshipHint: "family",
        defaultWeight: 1
      }
    });
    expect(profileResponse.statusCode).toBe(201);
    const profile = profileResponse.json();

    const templateResponse = await app!.inject({
      method: "POST",
      url: `/groups/${group.id}/templates`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Family preset",
        collectionType: "restaurant",
        categories: [{ title: "Food" }, { title: "Dessert" }]
      }
    });
    expect(templateResponse.statusCode).toBe(201);
    const template = templateResponse.json();

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Dinner",
        type: "restaurant",
        groupId: group.id
      }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const applyCategoriesResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/apply-template-categories`,
      headers: { authorization: organizer.authorization },
      payload: { templateId: template.id }
    });
    expect(applyCategoriesResponse.statusCode).toBe(200);

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants/from-profile`,
      headers: { authorization: organizer.authorization },
      payload: { profileId: profile.id }
    });
    expect(participantResponse.statusCode).toBe(201);
    const participant = participantResponse.json();

    const expenseResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Restaurant receipt",
        amountMinor: 1500,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 1500, paymentSource: "card" }],
        items: [
          { title: "Steak", amountMinor: 900 },
          { title: "Dessert", amountMinor: 600 }
        ]
      }
    });
    expect(expenseResponse.statusCode).toBe(201);
    const expense = expenseResponse.json().expense;

    const itemsResponse = await app!.inject({
      method: "GET",
      url: `/expenses/${expense.id}/items`,
      headers: { authorization: organizer.authorization }
    });
    const dessertItem = itemsResponse.json().find((item: { title: string }) => item.title === "Dessert");
    expect(dessertItem).toBeTruthy();

    const excludedRuleResponse = await app!.inject({
      method: "POST",
      url: `/expenses/${expense.id}/share-rules`,
      headers: { authorization: organizer.authorization },
      payload: {
        participantId: participant.id,
        expenseItemId: dessertItem.id,
        splitMode: "excluded",
        reason: "Skipped dessert."
      }
    });
    expect(excludedRuleResponse.statusCode).toBe(201);

    await app!.close();
    app = await createApp();

    const categoriesAfterRestart = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/categories`,
      headers: { authorization: organizer.authorization }
    });
    expect(categoriesAfterRestart.statusCode).toBe(200);
    expect(categoriesAfterRestart.json().some((category: { title: string }) => category.title === "Dessert")).toBe(true);

    const calculationResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });
    expect(calculationResponse.statusCode).toBe(201);
    const calculation = calculationResponse.json();
    const friendCalculation = calculation.result.participantCalculations.find(
      (entry: { participantId: string }) => entry.participantId === participant.id
    );
    expect(friendCalculation?.owesAmountMinor).toBe(450);
  });

  it("serializes concurrent calculate and manual payment retry flows on live PostgreSQL", async () => {
    const organizer = await auth(app!, "+79990011021");
    const participantUser = await auth(app!, "+79990011022");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Concurrency trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Cabin",
        amountMinor: 14000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 14000, paymentSource: "card" }]
      }
    });

    const [calculateA, calculateB] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/collections/${collection.id}/calculate`,
        headers: { authorization: organizer.authorization }
      }),
      app!.inject({
        method: "POST",
        url: `/collections/${collection.id}/calculate`,
        headers: { authorization: organizer.authorization }
      })
    ]);

    expect(calculateA.statusCode).toBe(201);
    expect(calculateB.statusCode).toBe(201);
    expect(calculateA.json().version).toBe(1);
    expect(calculateB.json().version).toBe(1);

    const [manualPaymentA, manualPaymentB] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/collections/${collection.id}/manual-payments/mark-paid`,
        headers: { authorization: participantUser.authorization },
        payload: {
          payerParticipantId: participant.id,
          receiverParticipantId: organizerParticipant.id,
          amountMinor: 7000,
          method: "sbp",
          comment: "Paid manually",
          idempotencyKey: "live-retry-1"
        }
      }),
      app!.inject({
        method: "POST",
        url: `/collections/${collection.id}/manual-payments/mark-paid`,
        headers: { authorization: participantUser.authorization },
        payload: {
          payerParticipantId: participant.id,
          receiverParticipantId: organizerParticipant.id,
          amountMinor: 7000,
          method: "sbp",
          comment: "Paid manually",
          idempotencyKey: "live-retry-1"
        }
      })
    ]);

    expect(manualPaymentA.statusCode).toBe(201);
    expect(manualPaymentB.statusCode).toBe(201);
    expect(manualPaymentA.json().id).toBe(manualPaymentB.json().id);

    const latestCalculationResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/calculations/latest`,
      headers: { authorization: organizer.authorization }
    });
    expect(latestCalculationResponse.json().version).toBe(1);

    const listManualPaymentsResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/manual-payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(listManualPaymentsResponse.json()).toHaveLength(1);
  });

  it("persists mock payment methods, autopay rules, and simulated provider payments in live PostgreSQL", async () => {
    const organizer = await auth(app!, "+79990011031");
    const participantUser = await auth(app!, "+79990011032");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Mock payment trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    const paymentMethodResponse = await app!.inject({
      method: "POST",
      url: "/payment-methods/mock-bind",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        maskedPan: "2200 **** **** 3131",
        brand: "mir",
        setAsDefault: true
      }
    });
    expect(paymentMethodResponse.statusCode).toBe(201);
    const paymentMethod = paymentMethodResponse.json();
    expect(paymentMethod.providerMetadata.mode).toBe("mock");

    const autopayRuleResponse = await app!.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        singleCollectionLimitMinor: 12000,
        monthlyLimitMinor: 50000
      }
    });
    expect(autopayRuleResponse.statusCode).toBe(201);
    const autopayRule = autopayRuleResponse.json();

    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "House",
        amountMinor: 10000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 10000, paymentSource: "card" }]
      }
    });
    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });

    const [paymentIntentA, paymentIntentB] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/collections/${collection.id}/payments/mock-intents`,
        headers: { authorization: participantUser.authorization },
        payload: {
          participantId: participant.id,
          amountMinor: 5000,
          paymentMethodId: paymentMethod.id,
          provider: "bank",
          idempotencyKey: "live-mock-intent-1"
        }
      }),
      app!.inject({
        method: "POST",
        url: `/collections/${collection.id}/payments/mock-intents`,
        headers: { authorization: participantUser.authorization },
        payload: {
          participantId: participant.id,
          amountMinor: 5000,
          paymentMethodId: paymentMethod.id,
          provider: "bank",
          idempotencyKey: "live-mock-intent-1"
        }
      })
    ]);

    expect(paymentIntentA.statusCode).toBe(201);
    expect(paymentIntentB.statusCode).toBe(201);
    expect(paymentIntentA.json().id).toBe(paymentIntentB.json().id);
    expect(paymentIntentA.json().paymentMethodId).toBe(paymentMethod.id);
    expect(paymentIntentA.json().providerStatus).toBe("pending");
    expect(paymentIntentA.json().providerMetadata.mode).toBe("mock");

    const successResponse = await app!.inject({
      method: "POST",
      url: `/payments/${paymentIntentA.json().id}/simulate-success`,
      headers: { authorization: organizer.authorization }
    });
    expect(successResponse.statusCode).toBe(200);
    expect(successResponse.json().status).toBe("succeeded");

    const refundResponse = await app!.inject({
      method: "POST",
      url: `/payments/${paymentIntentA.json().id}/refund`,
      headers: { authorization: organizer.authorization },
      payload: { reason: "Live mock refund." }
    });
    expect(refundResponse.statusCode).toBe(200);
    expect(refundResponse.json().status).toBe("refunded");

    const secondPaymentResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/payments/mock-intents`,
      headers: { authorization: participantUser.authorization },
      payload: {
        participantId: participant.id,
        amountMinor: 5000,
        paymentMethodId: paymentMethod.id,
        provider: "bank",
        idempotencyKey: "live-mock-intent-2"
      }
    });
    expect(secondPaymentResponse.statusCode).toBe(201);

    const failureResponse = await app!.inject({
      method: "POST",
      url: `/payments/${secondPaymentResponse.json().id}/simulate-failure`,
      headers: { authorization: participantUser.authorization },
      payload: { reason: "Issuer declined." }
    });
    expect(failureResponse.statusCode).toBe(200);
    expect(failureResponse.json().status).toBe("failed");

    await app!.close();
    app = await createApp();

    const autopayRulesResponse = await app!.inject({
      method: "GET",
      url: `/autopay-rules?collectionId=${collection.id}`,
      headers: { authorization: participantUser.authorization }
    });
    expect(autopayRulesResponse.statusCode).toBe(200);
    expect(autopayRulesResponse.json().find((rule: { id: string }) => rule.id === autopayRule.id)).toBeTruthy();

    const paymentsListResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(paymentsListResponse.statusCode).toBe(200);
    const payments = paymentsListResponse.json();
    expect(payments).toHaveLength(2);
    expect(payments.some((payment: { status: string }) => payment.status === "refunded")).toBe(true);
    expect(payments.some((payment: { status: string }) => payment.status === "failed")).toBe(true);

    const auditResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/audit-log`,
      headers: { authorization: organizer.authorization }
    });
    const auditLog = auditResponse.json();
    expect(auditLog.some((entry: { entityType: string }) => entry.entityType === "payment")).toBe(true);
  });

  it("persists mock payment method setup lifecycle in live PostgreSQL", async () => {
    const participantUser = await auth(app!, "+79990011036");

    const setupResponse = await app!.inject({
      method: "POST",
      url: "/payment-methods/mock-setup-intents",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        setAsDefault: true
      }
    });
    expect(setupResponse.statusCode).toBe(201);
    const pendingMethod = setupResponse.json();
    expect(pendingMethod.status).toBe("requires_confirmation");
    expect(pendingMethod.providerCustomerId).toBeTruthy();
    expect(pendingMethod.providerSetupId).toBeTruthy();

    const failedResponse = await app!.inject({
      method: "POST",
      url: `/payment-methods/${pendingMethod.id}/fail-setup`,
      headers: { authorization: participantUser.authorization },
      payload: {
        errorCode: "mock_declined",
        reason: "Mock setup failed."
      }
    });
    expect(failedResponse.statusCode).toBe(200);
    expect(failedResponse.json().status).toBe("failed");
    expect(failedResponse.json().lastSetupErrorCode).toBe("mock_declined");

    const secondSetupResponse = await app!.inject({
      method: "POST",
      url: "/payment-methods/mock-setup-intents",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        setAsDefault: true
      }
    });
    expect(secondSetupResponse.statusCode).toBe(201);
    const pendingRetryMethod = secondSetupResponse.json();

    const confirmedResponse = await app!.inject({
      method: "POST",
      url: `/payment-methods/${pendingRetryMethod.id}/confirm-setup`,
      headers: { authorization: participantUser.authorization },
      payload: {
        maskedPan: "2200 **** **** 3636",
        brand: "mir",
        setAsDefault: true
      }
    });
    expect(confirmedResponse.statusCode).toBe(200);
    const activeMethod = confirmedResponse.json();
    expect(activeMethod.status).toBe("active");
    expect(activeMethod.providerSetupId).toBeTruthy();
    expect(activeMethod.confirmedAt).toBeTruthy();
    expect(activeMethod.lastSetupErrorCode).toBe(null);

    await app!.close();
    app = await createApp();

    const methodsResponse = await app!.inject({
      method: "GET",
      url: "/payment-methods",
      headers: { authorization: participantUser.authorization }
    });
    expect(methodsResponse.statusCode).toBe(200);
    const methods = methodsResponse.json();
    expect(methods).toHaveLength(2);
    expect(methods.some((method: { id: string; status: string }) => method.id === pendingMethod.id && method.status === "failed")).toBe(true);
    expect(methods.some((method: { id: string; status: string; isDefault: boolean }) => method.id === activeMethod.id && method.status === "active" && method.isDefault)).toBe(true);
  });

  it("executes persisted auto payment batches with category rules on live PostgreSQL", async () => {
    const organizer = await auth(app!, "+79990011041");
    const participantUser = await auth(app!, "+79990011042");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Autopay live batch", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app!.inject({
      method: "POST",
      url: "/payment-methods/mock-bind",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        maskedPan: "2200 **** **** 4141",
        brand: "mir",
        setAsDefault: true
      }
    });

    const categoriesResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/categories`,
      headers: { authorization: organizer.authorization }
    });
    const categories = categoriesResponse.json();
    const foodCategory = categories.find((category: { title: string }) => category.title === "Food");
    const alcoholCategory = categories.find((category: { title: string }) => category.title === "Alcohol");
    expect(foodCategory).toBeTruthy();
    expect(alcoholCategory).toBeTruthy();

    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Food",
        amountMinor: 4000,
        categoryId: foodCategory.id,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 4000, paymentSource: "card" }]
      }
    });
    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Wine",
        amountMinor: 2000,
        categoryId: alcoholCategory.id,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 2000, paymentSource: "card" }]
      }
    });
    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });

    await app!.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        category: "Food",
        requiresObjectionWindow: false
      }
    });
    await app!.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        singleCollectionLimitMinor: 500,
        requiresObjectionWindow: false
      }
    });

    const previewResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/autopay/preview`,
      headers: { authorization: organizer.authorization }
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json().filter((item: { participantId: string }) => item.participantId === participant.id);
    expect(preview.some((item: { category: string; status: string; amountMinor: number }) => item.category === "food" && item.status === "eligible" && item.amountMinor === 2000)).toBe(true);
    expect(preview.some((item: { category: string; reasonCode: string; amountMinor: number }) => item.category === "alcohol" && item.reasonCode === "collection_limit_exceeded" && item.amountMinor === 1000)).toBe(true);

    const executeResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/autopay/execute`,
      headers: { authorization: organizer.authorization }
    });
    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json().createdPayments).toHaveLength(1);

    await app!.close();
    app = await createApp();

    const paymentsResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(paymentsResponse.statusCode).toBe(200);
    expect(paymentsResponse.json()).toHaveLength(1);
    expect(paymentsResponse.json()[0].amountMinor).toBe(2000);
  });

  it("runs due autopay sweep and applies signed mock-provider webhook events on live PostgreSQL", async () => {
    const organizer = await auth(app!, "+79990011051");
    const participantUser = await auth(app!, "+79990011052");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Sweep live trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app!.inject({
      method: "POST",
      url: "/payment-methods/mock-bind",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        maskedPan: "2200 **** **** 5151",
        brand: "mir",
        setAsDefault: true
      }
    });

    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Stay",
        amountMinor: 6000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 6000, paymentSource: "card" }]
      }
    });
    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });
    await app!.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        requiresObjectionWindow: false,
        singleCollectionLimitMinor: 10000
      }
    });

    const sweepResponse = await app!.inject({
      method: "POST",
      url: "/internal/autopay/run-due",
      headers: { "x-internal-token": "test-internal-token" }
    });
    expect(sweepResponse.statusCode).toBe(200);
    expect(sweepResponse.json().paymentsCreated).toBe(1);
    expect(sweepResponse.json().affectedCollectionIds).toContain(collection.id);

    const paymentsResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    const targetPayment = paymentsResponse.json().find((payment: { participantId: string }) => payment.participantId === participant.id);
    expect(targetPayment).toBeTruthy();

    const webhookPayload = {
      eventId: "live-webhook-1",
      providerPaymentId: targetPayment.providerPaymentId,
      eventType: "payment.succeeded" as const,
      occurredAt: new Date().toISOString()
    };
    const webhookResponse = await app!.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.json().status).toBe("succeeded");

    const duplicateWebhookResponse = await app!.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(duplicateWebhookResponse.statusCode).toBe(200);
    expect(duplicateWebhookResponse.json().id).toBe(targetPayment.id);

    const updatedPaymentsResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(
      updatedPaymentsResponse
        .json()
        .some(
          (payment: { id: string; status: string; lastWebhookEventId: string | null; providerStatus: string | null }) =>
            payment.id === targetPayment.id &&
            payment.status === "succeeded" &&
            payment.lastWebhookEventId === "live-webhook-1" &&
            payment.providerStatus === "succeeded"
        )
    ).toBe(true);
  });

  it("retries failed payment-method setup webhooks after the pending method becomes available", async () => {
    const participantUser = await auth(app!, "+79990011053");

    const providerSetupId = "live-late-provider-setup";
    const webhookPayload = {
      eventId: "live-payment-method-setup-webhook-1",
      providerSetupId,
      providerPaymentMethodId: "bank_pm_late_setup",
      eventType: "payment_method.setup_succeeded" as const,
      maskedPan: "2200 **** **** 5353",
      brand: "mir" as const,
      occurredAt: new Date().toISOString()
    };

    const firstAttempt = await app!.inject({
      method: "POST",
      url: "/payment-methods/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(firstAttempt.statusCode).toBe(404);

    const failedEvent = await client.paymentWebhookEvent.findUnique({
      where: { externalEventId: webhookPayload.eventId }
    });
    expect(failedEvent?.status).toBe("failed");
    expect(failedEvent?.attemptCount).toBe(1);

    const setupResponse = await app!.inject({
      method: "POST",
      url: "/payment-methods/mock-setup-intents",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        setAsDefault: true
      }
    });
    expect(setupResponse.statusCode).toBe(201);
    const pendingMethod = setupResponse.json();

    await client.paymentMethod.update({
      where: { id: pendingMethod.id },
      data: {
        providerSetupId
      }
    });

    const retryResponse = await app!.inject({
      method: "POST",
      url: "/internal/payments/webhooks/retry-failed",
      headers: { "x-internal-token": "test-internal-token" },
      payload: { ignoreSchedule: true }
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().dueEvents).toBe(1);
    expect(retryResponse.json().processed).toBe(1);
    expect(retryResponse.json().deadLettered).toBe(0);

    const updatedMethod = await client.paymentMethod.findUnique({
      where: { id: pendingMethod.id }
    });
    expect(updatedMethod?.status).toBe("active");
    expect(updatedMethod?.providerPaymentMethodId).toBe("bank_pm_late_setup");
    expect(updatedMethod?.maskedPan).toBe("2200 **** **** 5353");
    expect(updatedMethod?.brand).toBe("mir");
    expect(updatedMethod?.isDefault).toBe(true);
    expect(updatedMethod?.confirmedAt).not.toBeNull();

    const processedEvent = await client.paymentWebhookEvent.findUnique({
      where: { externalEventId: webhookPayload.eventId }
    });
    expect(processedEvent?.status).toBe("processed");
    expect(processedEvent?.attemptCount).toBe(2);
    expect(processedEvent?.paymentId).toBeNull();
    expect(processedEvent?.deadLetteredAt).toBeNull();
  });

  it("retries failed provider webhooks after the missing payment becomes available", async () => {
    const organizer = await auth(app!, "+79990011071");
    const participantUser = await auth(app!, "+79990011072");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Webhook recovery trip", type: "trip" }
    });
    const { collection } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    const providerPaymentId = "live-recovery-provider-payment";
    const webhookPayload = {
      eventId: "live-recovery-webhook-1",
      providerPaymentId,
      eventType: "payment.succeeded" as const,
      occurredAt: new Date().toISOString()
    };

    const firstAttempt = await app!.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(firstAttempt.statusCode).toBe(404);

    const failedEvent = await client.paymentWebhookEvent.findUnique({
      where: { externalEventId: webhookPayload.eventId }
    });
    expect(failedEvent?.status).toBe("failed");
    expect(failedEvent?.attemptCount).toBe(1);

    const createdPayment = await client.payment.create({
      data: {
        collectionId: collection.id,
        participantId: participant.id,
        responsibleUserId: participantUser.user.id,
        paymentMethodId: null,
        amountMinor: 3000,
        currency: "RUB",
        provider: "bank",
        providerPaymentId,
        providerStatus: "pending",
        providerMetadata: { mode: "recovery-test" },
        status: "pending",
        lastErrorCode: null,
        lastErrorMessage: null,
        attemptCount: 1,
        lastWebhookEventId: null,
        lastWebhookReceivedAt: null,
        idempotencyKey: "live-recovery-intent-1"
      }
    });

    const retryResponse = await app!.inject({
      method: "POST",
      url: "/internal/payments/webhooks/retry-failed",
      headers: { "x-internal-token": "test-internal-token" },
      payload: { ignoreSchedule: true }
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().dueEvents).toBe(1);
    expect(retryResponse.json().processed).toBe(1);
    expect(retryResponse.json().deadLettered).toBe(0);

    const recoveredPayment = await client.payment.findUnique({
      where: { id: createdPayment.id }
    });
    expect(recoveredPayment?.status).toBe("succeeded");
    expect(recoveredPayment?.providerStatus).toBe("succeeded");
    expect(recoveredPayment?.lastWebhookEventId).toBe(webhookPayload.eventId);

    const processedEvent = await client.paymentWebhookEvent.findUnique({
      where: { externalEventId: webhookPayload.eventId }
    });
    expect(processedEvent?.status).toBe("processed");
    expect(processedEvent?.attemptCount).toBe(2);
    expect(processedEvent?.paymentId).toBe(createdPayment.id);
    expect(processedEvent?.deadLetteredAt).toBeNull();
  });

  it("lists dead-letter webhook events internally and replays them after payment recovery", async () => {
    const organizer = await auth(app!, "+79990011091");
    const participantUser = await auth(app!, "+79990011092");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Dead-letter recovery trip", type: "trip" }
    });
    const { collection } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    const providerPaymentId = "live-dead-letter-provider-payment";
    const webhookPayload = {
      eventId: "live-dead-letter-webhook-1",
      providerPaymentId,
      eventType: "payment.succeeded" as const,
      occurredAt: new Date().toISOString()
    };

    const firstAttempt = await app!.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(firstAttempt.statusCode).toBe(404);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const replayResponse = await app!.inject({
        method: "POST",
        url: `/internal/payments/webhooks/${webhookPayload.eventId}/replay`,
        headers: { "x-internal-token": "test-internal-token" }
      });
      expect(replayResponse.statusCode).toBe(200);
    }

    const deadLetterListResponse = await app!.inject({
      method: "GET",
      url: `/internal/payments/webhooks/events?status=dead_lettered&provider=bank`,
      headers: { "x-internal-token": "test-internal-token" }
    });
    expect(deadLetterListResponse.statusCode).toBe(200);
    expect(
      deadLetterListResponse
        .json()
        .some((event: { externalEventId: string; attemptCount: number }) => event.externalEventId === webhookPayload.eventId && event.attemptCount === 5)
    ).toBe(true);

    const createdPayment = await client.payment.create({
      data: {
        collectionId: collection.id,
        participantId: participant.id,
        responsibleUserId: participantUser.user.id,
        paymentMethodId: null,
        amountMinor: 3500,
        currency: "RUB",
        provider: "bank",
        providerPaymentId,
        providerStatus: "pending",
        providerMetadata: { mode: "dead-letter-recovery-test" },
        status: "pending",
        lastErrorCode: null,
        lastErrorMessage: null,
        attemptCount: 1,
        lastWebhookEventId: null,
        lastWebhookReceivedAt: null,
        idempotencyKey: "live-dead-letter-recovery-intent-1"
      }
    });

    const replayRecoveredResponse = await app!.inject({
      method: "POST",
      url: `/internal/payments/webhooks/${webhookPayload.eventId}/replay`,
      headers: { "x-internal-token": "test-internal-token" }
    });
    expect(replayRecoveredResponse.statusCode).toBe(200);
    expect(replayRecoveredResponse.json().status).toBe("processed");
    expect(replayRecoveredResponse.json().paymentId).toBe(createdPayment.id);
    expect(replayRecoveredResponse.json().attemptCount).toBe(6);
    expect(replayRecoveredResponse.json().deadLetteredAt).toBeNull();

    const recoveredPayment = await client.payment.findUnique({
      where: { id: createdPayment.id }
    });
    expect(recoveredPayment?.status).toBe("succeeded");
    expect(recoveredPayment?.lastWebhookEventId).toBe(webhookPayload.eventId);
  });

  it("executes the background auto payment worker against live PostgreSQL", async () => {
    const organizer = await auth(app!, "+79990011061");
    const participantUser = await auth(app!, "+79990011062");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Worker live trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app!.inject({
      method: "POST",
      url: "/payment-methods/mock-bind",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        maskedPan: "2200 **** **** 6262",
        brand: "mir",
        setAsDefault: true
      }
    });

    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Villa",
        amountMinor: 8000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 8000, paymentSource: "card" }]
      }
    });
    await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });
    await app!.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        requiresObjectionWindow: false,
        singleCollectionLimitMinor: 10000
      }
    });

    const worker = createAutoPaymentSweepWorker({
      store: await PrismaStore.create(client as never),
      intervalMs: 1000,
      runOnStart: false
    });

    const result = await worker.runNow();
    expect(result.paymentsCreated).toBe(1);
    expect(result.affectedCollectionIds).toContain(collection.id);

    const paymentsResponse = await app!.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(paymentsResponse.statusCode).toBe(200);
    expect(paymentsResponse.json().some((payment: { participantId: string; amountMinor: number }) => payment.participantId === participant.id && payment.amountMinor === 4000)).toBe(true);

    await worker.stop();
  });

  it("executes the payment webhook retry worker against live PostgreSQL", async () => {
    const organizer = await auth(app!, "+79990011081");
    const participantUser = await auth(app!, "+79990011082");

    const collectionResponse = await app!.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Webhook worker trip", type: "trip" }
    });
    const { collection } = collectionResponse.json();

    const participantResponse = await app!.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    const providerPaymentId = "live-worker-provider-payment";
    const webhookPayload = {
      eventId: "live-worker-webhook-1",
      providerPaymentId,
      eventType: "payment.succeeded" as const,
      occurredAt: new Date().toISOString()
    };

    const firstAttempt = await app!.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(firstAttempt.statusCode).toBe(404);

    await client.paymentWebhookEvent.update({
      where: { externalEventId: webhookPayload.eventId },
      data: {
        nextRetryAt: new Date(Date.now() - 1_000)
      }
    });

    const createdPayment = await client.payment.create({
      data: {
        collectionId: collection.id,
        participantId: participant.id,
        responsibleUserId: participantUser.user.id,
        paymentMethodId: null,
        amountMinor: 2500,
        currency: "RUB",
        provider: "bank",
        providerPaymentId,
        providerStatus: "pending",
        providerMetadata: { mode: "worker-test" },
        status: "pending",
        lastErrorCode: null,
        lastErrorMessage: null,
        attemptCount: 1,
        lastWebhookEventId: null,
        lastWebhookReceivedAt: null,
        idempotencyKey: "live-worker-intent-1"
      }
    });

    const worker = createPaymentWebhookRetryWorker({
      store: await PrismaStore.create(client as never),
      intervalMs: 1000,
      runOnStart: false
    });

    const result = await worker.runNow();
    expect(result.dueEvents).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(result.eventIds).toContain(webhookPayload.eventId);

    const recoveredPayment = await client.payment.findUnique({
      where: { id: createdPayment.id }
    });
    expect(recoveredPayment?.status).toBe("succeeded");
    expect(recoveredPayment?.lastWebhookEventId).toBe(webhookPayload.eventId);

    await worker.stop();
  });
});
