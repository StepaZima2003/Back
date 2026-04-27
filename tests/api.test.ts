import { describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app";

describe("api smoke flow", () => {
  it("registers user, creates collection, adds guest, expense, and calculation", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/auth/request-otp",
      payload: { phone: "+79990000000" }
    });

    const authResponse = await app.inject({
      method: "POST",
      url: "/auth/verify-otp",
      payload: { phone: "+79990000000", otp: "000000" }
    });
    const auth = authResponse.json();
    const authorization = `Bearer ${auth.accessToken}`;

    await app.inject({
      method: "PATCH",
      url: "/me",
      headers: { authorization },
      payload: { displayName: "Алексей" }
    });

    const collectionResponse = await app.inject({
      method: "POST",
      url: "/collections",
      headers: { authorization },
      payload: { title: "Шашлыки", type: "picnic" }
    });
    expect(collectionResponse.statusCode).toBe(201);
    const { collection, organizerParticipant } = collectionResponse.json();

    const guestResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/participants/add-guest`,
      headers: { authorization },
      payload: {
        displayName: "Гость",
        responsiblePayerParticipantId: organizerParticipant.id
      }
    });
    expect(guestResponse.statusCode).toBe(201);

    const expenseResponse = await app.inject({
      method: "POST",
      url: `/collections/${collection.id}/expenses`,
      headers: { authorization },
      payload: {
        title: "Продукты",
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
    const app = await buildApp();

    async function auth(phone: string) {
      await app.inject({ method: "POST", url: "/auth/request-otp", payload: { phone } });
      const response = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { phone, otp: "000000" } });
      const body = response.json();
      return {
        user: body.user,
        authorization: `Bearer ${body.accessToken}`
      };
    }

    const organizer = await auth("+79990000001");
    const participantUser = await auth("+79990000002");

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
        message: "I joined only for half of the trip."
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
});
