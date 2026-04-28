import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app";
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
});
