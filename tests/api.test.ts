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
});

