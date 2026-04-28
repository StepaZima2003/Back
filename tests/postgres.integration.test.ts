import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/api/app";
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
    await resetIntegrationDatabase(client);
    app = await createApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
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
});
