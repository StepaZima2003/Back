import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app";
import { createMockProviderWebhookSignature } from "../src/payments/mockProvider";
import { InMemoryStore, PrismaStore } from "../src/store";
import { createSharedMockPrismaClient } from "./support/mockPrismaClient";

type ProviderName = "memory" | "prisma";

async function createStore(provider: ProviderName) {
  if (provider === "memory") {
    return new InMemoryStore();
  }

  const shared = createSharedMockPrismaClient();
  return await PrismaStore.create(shared.client as never);
}

describe.each<ProviderName>(["memory", "prisma"])("api provider parity: %s", (provider) => {
  afterEach(() => {
    delete process.env.STORE_PROVIDER;
    delete process.env.INTERNAL_API_TOKEN;
    delete process.env.MOCK_PROVIDER_WEBHOOK_SECRET;
  });

  it("registers user, creates collection, adds guest, expense, and calculation", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    await app.inject({
      method: "POST",
      url: "/auth/request-otp",
      payload: { phone: "+79990010000" }
    });

    const authResponse = await app.inject({
      method: "POST",
      url: "/auth/verify-otp",
      payload: { phone: "+79990010000", otp: "000000" }
    });
    const auth = authResponse.json();
    const authorization = `Bearer ${auth.accessToken}`;

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization },
      payload: { title: "BBQ", type: "picnic" }
    });
    expect(collectionResponse.statusCode).toBe(201);
    const { collection, organizerParticipant } = collectionResponse.json();

    const guestResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants/add-guest`,
      headers: { authorization },
      payload: {
        displayName: "Guest",
        responsiblePayerParticipantId: organizerParticipant.id
      }
    });
    expect(guestResponse.statusCode).toBe(201);

    const expenseResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization },
      payload: {
        title: "Food",
        amountMinor: 300000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 300000, paymentSource: "card" }]
      }
    });
    expect(expenseResponse.statusCode).toBe(201);

    const calculationResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization }
    });
    expect(calculationResponse.statusCode).toBe(201);

    const calculation = calculationResponse.json();
    expect(calculation.version).toBe(1);
    expect(calculation.result.totalAmountMinor).toBe(300000);
    expect(calculation.result.participantCalculations).toHaveLength(2);
    expect(calculation.result.responsiblePayerCalculations).toHaveLength(1);

    await app.close();
  });

  it("supports review confirmations, disputes, manual payments, audit log, and notifications", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990010001");
    const participantUser = await auth("+79990010002");

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Hotel",
        amountMinor: 10000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 10000 }]
      }
    });

    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/send-to-review`,
      headers: { authorization: organizer.authorization }
    });
    expect(reviewResponse.json().status).toBe("review");

    const notificationsResponse = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: { authorization: participantUser.authorization }
    });
    const notifications = notificationsResponse.json();
    expect(notifications.some((notification: { type: string }) => notification.type === "collection_review_requested")).toBe(true);

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants/${participant.id}/confirm-review`,
      headers: { authorization: participantUser.authorization }
    });
    expect(confirmResponse.json().status).toBe("confirmed");

    const disputeResponse = await app.inject({
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
    expect(dispute.status).toBe("created");

    const acceptedDisputeResponse = await app.inject({
      method: "POST",
      url: `/disputes/${dispute.id}/accept`,
      headers: { authorization: organizer.authorization },
      payload: { resolutionComment: "Accepted for recalculation." }
    });
    expect(acceptedDisputeResponse.json().status).toBe("accepted");

    const resolvedDisputeResponse = await app.inject({
      method: "POST",
      url: `/disputes/${dispute.id}/resolve`,
      headers: { authorization: organizer.authorization },
      payload: { resolutionComment: "Recalculated after review." }
    });
    expect(resolvedDisputeResponse.json().calculationVersion.version).toBe(2);

    const manualPaymentResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/manual-payments/mark-paid`,
      headers: { authorization: participantUser.authorization },
      payload: {
        payerParticipantId: participant.id,
        receiverParticipantId: organizerParticipant.id,
        amountMinor: 5000,
        method: "sbp",
        comment: "Paid manually"
      }
    });
    expect(manualPaymentResponse.statusCode).toBe(201);
    const manualPayment = manualPaymentResponse.json();
    expect(manualPayment.status).toBe("submitted");

    const confirmedPaymentResponse = await app.inject({
      method: "POST",
      url: `/manual-payments/${manualPayment.id}/confirm`,
      headers: { authorization: organizer.authorization }
    });
    expect(confirmedPaymentResponse.json().status).toBe("confirmed");

    const auditResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/audit-log`,
      headers: { authorization: organizer.authorization }
    });
    const auditLog = auditResponse.json();
    expect(auditLog.some((log: { entityType: string }) => log.entityType === "dispute")).toBe(true);
    expect(auditLog.some((log: { entityType: string }) => log.entityType === "manual_payment")).toBe(true);

    await app.close();
  });

  it("creates group templates and copies template categories into a collection", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    await app.inject({
      method: "POST",
      url: "/auth/request-otp",
      payload: { phone: "+79990010003" }
    });
    const authResponse = await app.inject({
      method: "POST",
      url: "/auth/verify-otp",
      payload: { phone: "+79990010003", otp: "000000" }
    });
    const auth = authResponse.json();
    const authorization = `Bearer ${auth.accessToken}`;

    const groupResponse = await app.inject({
      method: "POST",
      url: "/groups",
      headers: { authorization },
      payload: { title: "Weekend", groupType: "friends" }
    });
    const group = groupResponse.json();

    const templateResponse = await app.inject({
      method: "POST",
      url: `/groups/${group.id}/templates`,
      headers: { authorization },
      payload: {
        title: "BBQ template",
        collectionType: "picnic",
        categories: [
          { title: "Food", emoji: "🥩" },
          { title: "Alcohol", emoji: "🍺", requiresManualConfirmation: true, autopayAllowedByDefault: false }
        ]
      }
    });
    expect(templateResponse.statusCode).toBe(201);
    const template = templateResponse.json();
    expect(template.categories).toHaveLength(2);

    const templatesListResponse = await app.inject({
      method: "GET",
      url: `/groups/${group.id}/templates`,
      headers: { authorization }
    });
    expect(templatesListResponse.json()).toHaveLength(1);

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization },
      payload: {
        title: "Saturday BBQ",
        groupId: group.id,
        templateId: template.id
      }
    });
    expect(collectionResponse.statusCode).toBe(201);
    const collection = collectionResponse.json().collection;

    const categoriesResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/categories`,
      headers: { authorization }
    });
    expect(categoriesResponse.statusCode).toBe(200);
    const categories = categoriesResponse.json();
    expect(categories).toHaveLength(2);
    expect(categories.some((category: { title: string }) => category.title === "Alcohol")).toBe(true);

    await app.close();
  });

  it("supports group participant profiles and applying template categories to an existing collection", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990010021");
    const linkedFriend = await auth("+79990010022");

    const groupResponse = await app.inject({
      method: "POST",
      url: "/groups",
      headers: { authorization: organizer.authorization },
      payload: { title: "Family", groupType: "family" }
    });
    const group = groupResponse.json();

    const profileResponse = await app.inject({
      method: "POST",
      url: `/groups/${group.id}/participant-profiles`,
      headers: { authorization: organizer.authorization },
      payload: {
        linkedUserId: linkedFriend.user.id,
        relationshipHint: "family",
        defaultWeight: 1
      }
    });
    expect(profileResponse.statusCode).toBe(201);
    const profile = profileResponse.json();
    expect(profile.linkedUserId).toBe(linkedFriend.user.id);

    const templateResponse = await app.inject({
      method: "POST",
      url: `/groups/${group.id}/templates`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Family preset",
        collectionType: "picnic",
        categories: [
          { title: "Food" },
          { title: "Dessert" }
        ]
      }
    });
    expect(templateResponse.statusCode).toBe(201);
    const template = templateResponse.json();

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Weekend picnic",
        type: "picnic",
        groupId: group.id
      }
    });
    const { collection } = collectionResponse.json();

    const applyCategoriesResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/apply-template-categories`,
      headers: { authorization: organizer.authorization },
      payload: { templateId: template.id }
    });
    expect(applyCategoriesResponse.statusCode).toBe(200);
    const categories = applyCategoriesResponse.json();
    expect(categories.some((category: { title: string }) => category.title === "Dessert")).toBe(true);

    const participantResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants/from-profile`,
      headers: { authorization: organizer.authorization },
      payload: { profileId: profile.id }
    });
    expect(participantResponse.statusCode).toBe(201);
    expect(participantResponse.json().linkedUserId).toBe(linkedFriend.user.id);

    await app.close();
  });

  it("supports mock payment method setup lifecycle before payment intents", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const participantUser = await auth("+79990010025");

    const setupResponse = await app.inject({
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
    expect(pendingMethod.isDefault).toBe(false);

    const failedResponse = await app.inject({
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

    const setupRetryResponse = await app.inject({
      method: "POST",
      url: "/payment-methods/mock-setup-intents",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        setAsDefault: true
      }
    });
    expect(setupRetryResponse.statusCode).toBe(201);
    const retriedMethod = setupRetryResponse.json();
    expect(retriedMethod.providerCustomerId).toBeTruthy();

    const confirmedResponse = await app.inject({
      method: "POST",
      url: `/payment-methods/${retriedMethod.id}/confirm-setup`,
      headers: { authorization: participantUser.authorization },
      payload: {
        maskedPan: "2200 **** **** 2525",
        brand: "mir",
        setAsDefault: true
      }
    });
    expect(confirmedResponse.statusCode).toBe(200);
    const activeMethod = confirmedResponse.json();
    expect(activeMethod.status).toBe("active");
    expect(activeMethod.maskedPan).toBe("2200 **** **** 2525");
    expect(activeMethod.brand).toBe("mir");
    expect(activeMethod.isDefault).toBe(true);
    expect(activeMethod.confirmedAt).toBeTruthy();
    expect(activeMethod.providerPaymentMethodId).toContain("_pm_");
    expect(activeMethod.providerSetupId).toBeTruthy();
    expect(activeMethod.lastSetupErrorCode).toBe(null);

    const methodsResponse = await app.inject({
      method: "GET",
      url: "/payment-methods",
      headers: { authorization: participantUser.authorization }
    });
    expect(methodsResponse.statusCode).toBe(200);
    const methods = methodsResponse.json();
    expect(methods).toHaveLength(2);
    expect(methods.some((method: { status: string }) => method.status === "failed")).toBe(true);
    expect(methods.some((method: { id: string; status: string }) => method.id === activeMethod.id && method.status === "active")).toBe(true);

    await app.close();
  });

  it("reconciles signed payment-method setup webhooks and keeps them idempotent", async () => {
    process.env.MOCK_PROVIDER_WEBHOOK_SECRET = "test-webhook-secret";

    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const participantUser = await auth("+79990010026");

    const setupResponse = await app.inject({
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

    const successWebhookPayload = {
      eventId: "payment-method-setup-webhook-1",
      providerSetupId: pendingMethod.providerSetupId,
      providerPaymentMethodId: "bank_pm_webhook_1",
      eventType: "payment_method.setup_succeeded" as const,
      maskedPan: "2200 **** **** 2626",
      brand: "mir" as const,
      occurredAt: new Date().toISOString()
    };

    const invalidWebhookResponse = await app.inject({
      method: "POST",
      url: "/payment-methods/webhooks/bank",
      payload: successWebhookPayload
    });
    expect(invalidWebhookResponse.statusCode).toBe(401);

    const successWebhookResponse = await app.inject({
      method: "POST",
      url: "/payment-methods/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(successWebhookPayload, "test-webhook-secret")
      },
      payload: successWebhookPayload
    });
    expect(successWebhookResponse.statusCode).toBe(200);
    expect(successWebhookResponse.json().id).toBe(pendingMethod.id);
    expect(successWebhookResponse.json().status).toBe("active");
    expect(successWebhookResponse.json().providerPaymentMethodId).toBe("bank_pm_webhook_1");
    expect(successWebhookResponse.json().maskedPan).toBe("2200 **** **** 2626");
    expect(successWebhookResponse.json().brand).toBe("mir");
    expect(successWebhookResponse.json().isDefault).toBe(true);
    expect(successWebhookResponse.json().confirmedAt).toBeTruthy();

    const duplicateWebhookResponse = await app.inject({
      method: "POST",
      url: "/payment-methods/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(successWebhookPayload, "test-webhook-secret")
      },
      payload: successWebhookPayload
    });
    expect(duplicateWebhookResponse.statusCode).toBe(200);
    expect(duplicateWebhookResponse.json().id).toBe(pendingMethod.id);

    const failedSetupResponse = await app.inject({
      method: "POST",
      url: "/payment-methods/mock-setup-intents",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        setAsDefault: false
      }
    });
    expect(failedSetupResponse.statusCode).toBe(201);
    const failedPendingMethod = failedSetupResponse.json();

    const failedWebhookPayload = {
      eventId: "payment-method-setup-webhook-2",
      providerSetupId: failedPendingMethod.providerSetupId,
      eventType: "payment_method.setup_failed" as const,
      reason: "Issuer declined setup.",
      occurredAt: new Date().toISOString()
    };

    const failedWebhookResponse = await app.inject({
      method: "POST",
      url: "/payment-methods/webhooks/mock-provider",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(failedWebhookPayload, "test-webhook-secret")
      },
      payload: failedWebhookPayload
    });
    expect(failedWebhookResponse.statusCode).toBe(200);
    expect(failedWebhookResponse.json().id).toBe(failedPendingMethod.id);
    expect(failedWebhookResponse.json().status).toBe("failed");
    expect(failedWebhookResponse.json().lastSetupErrorCode).toBe("provider_setup_failed");
    expect(failedWebhookResponse.json().lastSetupErrorMessage).toBe("Issuer declined setup.");

    const methodsResponse = await app.inject({
      method: "GET",
      url: "/payment-methods",
      headers: { authorization: participantUser.authorization }
    });
    expect(methodsResponse.statusCode).toBe(200);
    const methods = methodsResponse.json();
    expect(
      methods.some(
        (method: { id: string; status: string; providerPaymentMethodId: string; isDefault: boolean }) =>
          method.id === pendingMethod.id &&
          method.status === "active" &&
          method.providerPaymentMethodId === "bank_pm_webhook_1" &&
          method.isDefault === true
      )
    ).toBe(true);
    expect(
      methods.some(
        (method: { id: string; status: string; lastSetupErrorCode: string | null }) =>
          method.id === failedPendingMethod.id &&
          method.status === "failed" &&
          method.lastSetupErrorCode === "provider_setup_failed"
      )
    ).toBe(true);

    await app.close();
  });

  it("supports itemized restaurant receipts with item-scoped share rules", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990010011");
    const friend = await auth("+79990010012");

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Dinner", type: "restaurant" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: friend.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    const expenseResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Restaurant receipt",
        amountMinor: 1200,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 1200, paymentSource: "card" }],
        items: [
          { title: "Steak", amountMinor: 700 },
          { title: "Wine", amountMinor: 500, categoryId: null }
        ]
      }
    });
    expect(expenseResponse.statusCode).toBe(201);
    const expense = expenseResponse.json().expense;

    const itemsResponse = await app.inject({
      method: "GET",
      url: `/expenses/${expense.id}/items`,
      headers: { authorization: organizer.authorization }
    });
    expect(itemsResponse.statusCode).toBe(200);
    const items = itemsResponse.json();
    expect(items).toHaveLength(2);

    const wineItem = items.find((item: { title: string }) => item.title === "Wine");
    expect(wineItem).toBeTruthy();

    const ruleResponse = await app.inject({
      method: "POST",
      url: `/expenses/${expense.id}/share-rules`,
      headers: { authorization: organizer.authorization },
      payload: {
        participantId: participant.id,
        expenseItemId: wineItem.id,
        splitMode: "excluded",
        reason: "Did not drink wine."
      }
    });
    expect(ruleResponse.statusCode).toBe(201);

    const calculationResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });
    expect(calculationResponse.statusCode).toBe(201);

    const calculation = calculationResponse.json();
    const organizerCalc = calculation.result.participantCalculations.find((item: { participantId: string }) => item.participantId === organizerParticipant.id);
    const friendCalc = calculation.result.participantCalculations.find((item: { participantId: string }) => item.participantId === participant.id);

    expect(organizerCalc?.owesAmountMinor).toBe(850);
    expect(friendCalc?.owesAmountMinor).toBe(350);

    await app.close();
  });

  it("deduplicates repeated calculate calls and manual payment retries", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990010031");
    const participantUser = await auth("+79990010032");

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Retry-safe trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Stay",
        amountMinor: 10000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 10000, paymentSource: "card" }]
      }
    });

    const [calculateA, calculateB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/collections/${collection.id}/calculate`,
        headers: { authorization: organizer.authorization }
      }),
      app.inject({
        method: "POST",
        url: `/collections/${collection.id}/calculate`,
        headers: { authorization: organizer.authorization }
      })
    ]);

    expect(calculateA.statusCode).toBe(201);
    expect(calculateB.statusCode).toBe(201);
    expect(calculateA.json().version).toBe(1);
    expect(calculateB.json().version).toBe(1);

    const latestCalculationResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/calculations/latest`,
      headers: { authorization: organizer.authorization }
    });
    expect(latestCalculationResponse.json().version).toBe(1);

    const [manualPaymentA, manualPaymentB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/collections/${collection.id}/manual-payments/mark-paid`,
        headers: { authorization: participantUser.authorization },
        payload: {
          payerParticipantId: participant.id,
          receiverParticipantId: organizerParticipant.id,
          amountMinor: 5000,
          method: "sbp",
          comment: "Paid manually",
          idempotencyKey: "retry-1"
        }
      }),
      app.inject({
        method: "POST",
        url: `/collections/${collection.id}/manual-payments/mark-paid`,
        headers: { authorization: participantUser.authorization },
        payload: {
          payerParticipantId: participant.id,
          receiverParticipantId: organizerParticipant.id,
          amountMinor: 5000,
          method: "sbp",
          comment: "Paid manually",
          idempotencyKey: "retry-1"
        }
      })
    ]);

    expect(manualPaymentA.statusCode).toBe(201);
    expect(manualPaymentB.statusCode).toBe(201);
    expect(manualPaymentA.json().id).toBe(manualPaymentB.json().id);

    const listManualPaymentsResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/manual-payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(listManualPaymentsResponse.json()).toHaveLength(1);

    await app.close();
  });

  it("supports mock payment methods, autopay rules, and simulated provider payments", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990010041");
    const participantUser = await auth("+79990010042");

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Mock autopay trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    const paymentMethodResponse = await app.inject({
      method: "POST",
      url: "/payment-methods/mock-bind",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        maskedPan: "2200 **** **** 4242",
        brand: "mir",
        setAsDefault: true
      }
    });
    expect(paymentMethodResponse.statusCode).toBe(201);
    const paymentMethod = paymentMethodResponse.json();
    expect(paymentMethod.status).toBe("active");
    expect(paymentMethod.providerMetadata.mode).toBe("mock");

    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Cabin",
        amountMinor: 8000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 8000, paymentSource: "card" }]
      }
    });
    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });

    const autopayRuleResponse = await app.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        singleCollectionLimitMinor: 10000,
        monthlyLimitMinor: 30000,
        allowChildren: true
      }
    });
    expect(autopayRuleResponse.statusCode).toBe(201);
    const autopayRule = autopayRuleResponse.json();
    expect(autopayRule.enabled).toBe(true);

    const autopayRulePatchResponse = await app.inject({
      method: "PATCH",
      url: `/autopay-rules/${autopayRule.id}`,
      headers: { authorization: participantUser.authorization },
      payload: {
        enabled: false,
        monthlyLimitMinor: 15000
      }
    });
    expect(autopayRulePatchResponse.statusCode).toBe(200);
    expect(autopayRulePatchResponse.json().enabled).toBe(false);

    const autopayRulesListResponse = await app.inject({
      method: "GET",
      url: `/autopay-rules?collectionId=${collection.id}`,
      headers: { authorization: participantUser.authorization }
    });
    expect(autopayRulesListResponse.statusCode).toBe(200);
    expect(autopayRulesListResponse.json()).toHaveLength(1);

    const [paymentIntentA, paymentIntentB] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/collections/${collection.id}/payments/mock-intents`,
        headers: { authorization: participantUser.authorization },
        payload: {
          participantId: participant.id,
          amountMinor: 4000,
          paymentMethodId: paymentMethod.id,
          provider: "bank",
          idempotencyKey: "mock-intent-1"
        }
      }),
      app.inject({
        method: "POST",
        url: `/collections/${collection.id}/payments/mock-intents`,
        headers: { authorization: participantUser.authorization },
        payload: {
          participantId: participant.id,
          amountMinor: 4000,
          paymentMethodId: paymentMethod.id,
          provider: "bank",
          idempotencyKey: "mock-intent-1"
        }
      })
    ]);

    expect(paymentIntentA.statusCode).toBe(201);
    expect(paymentIntentB.statusCode).toBe(201);
    expect(paymentIntentA.json().id).toBe(paymentIntentB.json().id);
    const firstPayment = paymentIntentA.json();
    expect(firstPayment.paymentMethodId).toBe(paymentMethod.id);
    expect(firstPayment.providerStatus).toBe("pending");
    expect(firstPayment.providerMetadata.mode).toBe("mock");
    expect(firstPayment.attemptCount).toBe(1);

    const successResponse = await app.inject({
      method: "POST",
      url: `/payments/${firstPayment.id}/simulate-success`,
      headers: { authorization: organizer.authorization }
    });
    expect(successResponse.statusCode).toBe(200);
    expect(successResponse.json().status).toBe("succeeded");

    const refundResponse = await app.inject({
      method: "POST",
      url: `/payments/${firstPayment.id}/refund`,
      headers: { authorization: organizer.authorization },
      payload: { reason: "Charge reversed in mock flow." }
    });
    expect(refundResponse.statusCode).toBe(200);
    expect(refundResponse.json().status).toBe("refunded");

    const secondPaymentResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/payments/mock-intents`,
      headers: { authorization: participantUser.authorization },
      payload: {
        participantId: participant.id,
        amountMinor: 4000,
        paymentMethodId: paymentMethod.id,
        provider: "bank",
        idempotencyKey: "mock-intent-2"
      }
    });
    expect(secondPaymentResponse.statusCode).toBe(201);

    const failureResponse = await app.inject({
      method: "POST",
      url: `/payments/${secondPaymentResponse.json().id}/simulate-failure`,
      headers: { authorization: participantUser.authorization },
      payload: { reason: "Issuer declined in mock flow." }
    });
    expect(failureResponse.statusCode).toBe(200);
    expect(failureResponse.json().status).toBe("failed");

    const paymentsListResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(paymentsListResponse.statusCode).toBe(200);
    const payments = paymentsListResponse.json();
    expect(payments).toHaveLength(2);
    expect(payments.some((payment: { status: string }) => payment.status === "refunded")).toBe(true);
    expect(payments.some((payment: { status: string }) => payment.status === "failed")).toBe(true);

    const auditResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/audit-log`,
      headers: { authorization: organizer.authorization }
    });
    expect(auditResponse.json().some((entry: { entityType: string }) => entry.entityType === "payment")).toBe(true);

    await app.close();
  });

  it("previews and executes auto payment batches with category rules and collection limits", async () => {
    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990010051");
    const participantUser = await auth("+79990010052");

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Autopay batch", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app.inject({
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

    const categoriesResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/categories`,
      headers: { authorization: organizer.authorization }
    });
    const categories = categoriesResponse.json();
    const foodCategory = categories.find((category: { title: string }) => category.title === "Food");
    const alcoholCategory = categories.find((category: { title: string }) => category.title === "Alcohol");
    expect(foodCategory).toBeTruthy();
    expect(alcoholCategory).toBeTruthy();

    await app.inject({
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
    await app.inject({
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
    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });

    await app.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        category: "Food",
        requiresObjectionWindow: false
      }
    });
    await app.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        singleCollectionLimitMinor: 500,
        requiresObjectionWindow: false
      }
    });

    const previewResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/autopay/preview`,
      headers: { authorization: organizer.authorization }
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json().filter((item: { participantId: string }) => item.participantId === participant.id);
    expect(preview).toHaveLength(2);
    expect(preview.some((item: { category: string; status: string; amountMinor: number }) => item.category === "food" && item.status === "eligible" && item.amountMinor === 2000)).toBe(true);
    expect(preview.some((item: { category: string; reasonCode: string; amountMinor: number }) => item.category === "alcohol" && item.reasonCode === "collection_limit_exceeded" && item.amountMinor === 1000)).toBe(true);

    const dryRunResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/autopay/execute`,
      headers: { authorization: organizer.authorization },
      payload: { dryRun: true }
    });
    expect(dryRunResponse.statusCode).toBe(200);
    expect(dryRunResponse.json().createdPayments).toHaveLength(0);

    const executeResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/autopay/execute`,
      headers: { authorization: organizer.authorization }
    });
    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json().createdPayments).toHaveLength(1);
    expect(executeResponse.json().createdPayments[0].amountMinor).toBe(2000);

    const rerunResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/autopay/execute`,
      headers: { authorization: organizer.authorization }
    });
    expect(rerunResponse.statusCode).toBe(200);
    expect(rerunResponse.json().createdPayments).toHaveLength(0);
    expect(rerunResponse.json().preview.some((item: { status: string; reasonCode: string }) => item.status === "already_exists" && item.reasonCode === "existing_payment")).toBe(true);

    const paymentsResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    expect(paymentsResponse.json()).toHaveLength(1);

    await app.close();
  });

  it("runs due autopay sweep through internal route and accepts signed mock-provider webhooks", async () => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.MOCK_PROVIDER_WEBHOOK_SECRET = "test-webhook-secret";

    const app = await buildApp({ store: await createStore(provider) });

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990010061");
    const participantUser = await auth("+79990010062");

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization: organizer.authorization },
      payload: { title: "Internal sweep trip", type: "trip" }
    });
    const { collection, organizerParticipant } = collectionResponse.json();

    const participantResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants`,
      headers: { authorization: organizer.authorization },
      payload: { linkedUserId: participantUser.user.id, displayName: "Friend" }
    });
    const participant = participantResponse.json();

    await app.inject({
      method: "POST",
      url: "/payment-methods/mock-bind",
      headers: { authorization: participantUser.authorization },
      payload: {
        provider: "bank",
        maskedPan: "2200 **** **** 6161",
        brand: "mir",
        setAsDefault: true
      }
    });

    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization: organizer.authorization },
      payload: {
        title: "Stay",
        amountMinor: 6000,
        payments: [{ paidByParticipantId: organizerParticipant.id, amountMinor: 6000, paymentSource: "card" }]
      }
    });
    await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/calculate`,
      headers: { authorization: organizer.authorization }
    });
    await app.inject({
      method: "POST",
      url: "/autopay-rules",
      headers: { authorization: participantUser.authorization },
      payload: {
        collectionId: collection.id,
        requiresObjectionWindow: false,
        singleCollectionLimitMinor: 10000
      }
    });

    const unauthorizedSweep = await app.inject({
      method: "POST",
      url: "/internal/autopay/run-due"
    });
    expect(unauthorizedSweep.statusCode).toBe(401);

    const sweepResponse = await app.inject({
      method: "POST",
      url: "/internal/autopay/run-due",
      headers: { "x-internal-token": "test-internal-token" }
    });
    expect(sweepResponse.statusCode).toBe(200);
    expect(sweepResponse.json().paymentsCreated).toBe(1);
    expect(sweepResponse.json().affectedCollectionIds).toContain(collection.id);

    const paymentsResponse = await app.inject({
      method: "GET",
      url: `/collections/${collection.id}/payments`,
      headers: { authorization: organizer.authorization }
    });
    const targetPayment = paymentsResponse.json().find((payment: { participantId: string }) => payment.participantId === participant.id);
    expect(targetPayment).toBeTruthy();

    const webhookPayload = {
      eventId: "parity-webhook-1",
      providerPaymentId: targetPayment.providerPaymentId,
      eventType: "payment.succeeded" as const,
      occurredAt: new Date().toISOString()
    };

    const invalidWebhookResponse = await app.inject({
      method: "POST",
      url: "/payments/webhooks/mock-provider",
      payload: webhookPayload
    });
    expect(invalidWebhookResponse.statusCode).toBe(401);

    const webhookResponse = await app.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.json().status).toBe("succeeded");

    const duplicateWebhookResponse = await app.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(duplicateWebhookResponse.statusCode).toBe(200);
    expect(duplicateWebhookResponse.json().id).toBe(targetPayment.id);

    const updatedPaymentsResponse = await app.inject({
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
            payment.lastWebhookEventId === "parity-webhook-1" &&
            payment.providerStatus === "succeeded"
        )
    ).toBe(true);

    await app.close();
  });

  it("retries failed provider webhooks and dead-letters terminal misses", async () => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.MOCK_PROVIDER_WEBHOOK_SECRET = "test-webhook-secret";

    const app = await buildApp({ store: await createStore(provider) });

    const webhookPayload = {
      eventId: "retry-missing-event",
      providerPaymentId: "missing-provider-payment",
      eventType: "payment.succeeded" as const,
      occurredAt: new Date().toISOString()
    };

    const firstAttempt = await app.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(firstAttempt.statusCode).toBe(404);

    const retrySummaries = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      retrySummaries.push(
        await app.inject({
          method: "POST",
          url: "/internal/payments/webhooks/retry-failed",
          headers: { "x-internal-token": "test-internal-token" },
          payload: { ignoreSchedule: true }
        })
      );
    }

    expect(retrySummaries[0].statusCode).toBe(200);
    expect(retrySummaries.at(-1)?.json().deadLettered).toBe(1);

    const noMoreDueEvents = await app.inject({
      method: "POST",
      url: "/internal/payments/webhooks/retry-failed",
      headers: { "x-internal-token": "test-internal-token" },
      payload: { ignoreSchedule: true }
    });
    expect(noMoreDueEvents.statusCode).toBe(200);
    expect(noMoreDueEvents.json().dueEvents).toBe(0);

    await app.close();
  });

  it("lists webhook events internally and replays a specific failed event until dead-letter", async () => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.MOCK_PROVIDER_WEBHOOK_SECRET = "test-webhook-secret";

    const app = await buildApp({ store: await createStore(provider) });

    const webhookPayload = {
      eventId: "replay-missing-event",
      providerPaymentId: "replay-missing-provider-payment",
      eventType: "payment.succeeded" as const,
      occurredAt: new Date().toISOString()
    };

    const firstAttempt = await app.inject({
      method: "POST",
      url: "/payments/webhooks/bank",
      headers: {
        "x-mock-provider-signature": createMockProviderWebhookSignature(webhookPayload, "test-webhook-secret")
      },
      payload: webhookPayload
    });
    expect(firstAttempt.statusCode).toBe(404);

    const listResponse = await app.inject({
      method: "GET",
      url: "/internal/payments/webhooks/events?status=failed&provider=bank",
      headers: { "x-internal-token": "test-internal-token" }
    });
    expect(listResponse.statusCode).toBe(200);
    const events = listResponse.json();
    expect(events).toHaveLength(1);
    expect(events[0].externalEventId).toBe(webhookPayload.eventId);
    expect(events[0].attemptCount).toBe(1);

    const replayA = await app.inject({
      method: "POST",
      url: `/internal/payments/webhooks/${webhookPayload.eventId}/replay`,
      headers: { "x-internal-token": "test-internal-token" }
    });
    expect(replayA.statusCode).toBe(200);
    expect(replayA.json().status).toBe("failed");
    expect(replayA.json().attemptCount).toBe(2);

    let replayResult = replayA;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      replayResult = await app.inject({
        method: "POST",
        url: `/internal/payments/webhooks/${webhookPayload.eventId}/replay`,
        headers: { "x-internal-token": "test-internal-token" }
      });
    }

    expect(replayResult.statusCode).toBe(200);
    expect(replayResult.json().status).toBe("dead_lettered");
    expect(replayResult.json().attemptCount).toBe(5);

    await app.close();
  });
});
