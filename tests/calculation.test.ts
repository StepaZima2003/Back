import { describe, expect, it } from "vitest";
import { calculateCollection, type CalculateCollectionInput } from "../src/calculation";

const participants: CalculateCollectionInput["participants"] = [
  { id: "a", displayName: "A" },
  { id: "b", displayName: "B" },
  { id: "c", displayName: "C" }
];

function participantAmount(result: ReturnType<typeof calculateCollection>, participantId: string): number {
  const calculation = result.participantCalculations.find((item) => item.participantId === participantId);
  if (!calculation) {
    throw new Error(`Missing participant ${participantId}`);
  }
  return calculation.owesAmountMinor;
}

describe("calculation engine", () => {
  it("splits an expense equally and minimizes transfers", () => {
    const result = calculateCollection({
      collectionId: "collection",
      currency: "RUB",
      participants,
      expenses: [
        {
          id: "expense",
          title: "Dinner",
          amountMinor: 300,
          payments: [{ participantId: "a", amountMinor: 300 }]
        }
      ]
    });

    expect(participantAmount(result, "a")).toBe(100);
    expect(participantAmount(result, "b")).toBe(100);
    expect(participantAmount(result, "c")).toBe(100);
    expect(result.transferPlan).toEqual([
      expect.objectContaining({ fromResponsiblePayerId: "b", toResponsiblePayerId: "a", amountMinor: 100 }),
      expect.objectContaining({ fromResponsiblePayerId: "c", toResponsiblePayerId: "a", amountMinor: 100 })
    ]);
  });

  it("excludes a participant from a category", () => {
    const result = calculateCollection({
      collectionId: "collection",
      currency: "RUB",
      participants,
      expenses: [
        {
          id: "alcohol",
          title: "Alcohol",
          amountMinor: 300,
          categoryId: "alcohol",
          payments: [{ participantId: "a", amountMinor: 300 }],
          shareRules: [
            {
              participantId: "c",
              categoryId: "alcohol",
              splitMode: "excluded",
              reason: "Does not drink alcohol."
            }
          ]
        }
      ]
    });

    expect(participantAmount(result, "a")).toBe(150);
    expect(participantAmount(result, "b")).toBe(150);
    expect(participantAmount(result, "c")).toBe(0);
    expect(result.participantCalculations.find((item) => item.participantId === "c")?.explanation.excluded).toHaveLength(1);
  });

  it("supports child or half-share participants", () => {
    const result = calculateCollection({
      collectionId: "collection",
      currency: "RUB",
      participants: [
        { id: "adult-a", displayName: "Adult A" },
        { id: "adult-b", displayName: "Adult B" },
        { id: "child", displayName: "Child", participantType: "child", defaultWeight: 0.5, responsiblePayerId: "adult-a" }
      ],
      expenses: [
        {
          id: "picnic",
          title: "Picnic",
          amountMinor: 250,
          payments: [{ participantId: "adult-b", amountMinor: 250 }]
        }
      ]
    });

    expect(participantAmount(result, "adult-a")).toBe(100);
    expect(participantAmount(result, "adult-b")).toBe(100);
    expect(participantAmount(result, "child")).toBe(50);
  });

  it("credits multiple payers of one expense", () => {
    const result = calculateCollection({
      collectionId: "collection",
      currency: "RUB",
      participants: participants.slice(0, 2),
      expenses: [
        {
          id: "groceries",
          title: "Groceries",
          amountMinor: 200,
          payments: [
            { participantId: "a", amountMinor: 120 },
            { participantId: "b", amountMinor: 80 }
          ]
        }
      ]
    });

    expect(result.participantCalculations.find((item) => item.participantId === "a")?.netBalanceMinor).toBe(20);
    expect(result.participantCalculations.find((item) => item.participantId === "b")?.netBalanceMinor).toBe(-20);
    expect(result.transferPlan).toEqual([expect.objectContaining({ fromResponsiblePayerId: "b", toResponsiblePayerId: "a", amountMinor: 20 })]);
  });

  it("supports fixed shares and rounded remainders", () => {
    const result = calculateCollection({
      collectionId: "collection",
      currency: "RUB",
      participants,
      expenses: [
        {
          id: "taxi",
          title: "Taxi",
          amountMinor: 301,
          payments: [{ participantId: "a", amountMinor: 301 }],
          shareRules: [{ participantId: "a", splitMode: "fixed", fixedAmountMinor: 50 }]
        }
      ]
    });

    expect(participantAmount(result, "a")).toBe(50);
    expect(participantAmount(result, "b") + participantAmount(result, "c")).toBe(251);
    expect(result.participantCalculations.reduce((sum, item) => sum + item.owesAmountMinor, 0)).toBe(301);
  });

  it("warns when everyone is excluded from a non-zero expense", () => {
    const result = calculateCollection({
      collectionId: "collection",
      currency: "RUB",
      participants: participants.slice(0, 2),
      expenses: [
        {
          id: "empty",
          title: "Empty split",
          amountMinor: 100,
          payments: [{ participantId: "a", amountMinor: 100 }],
          shareRules: [
            { participantId: "a", splitMode: "excluded" },
            { participantId: "b", splitMode: "excluded" }
          ]
        }
      ]
    });

    expect(result.warnings.map((warning) => warning.code)).toContain("EXPENSE_WITHOUT_PARTICIPANTS");
  });

  it("aggregates guests and children under their responsible payer", () => {
    const result = calculateCollection({
      collectionId: "collection",
      currency: "RUB",
      participants: [
        { id: "parent", displayName: "Parent" },
        { id: "friend", displayName: "Friend" },
        { id: "guest", displayName: "Guest", participantType: "guest", responsiblePayerId: "parent" }
      ],
      expenses: [
        {
          id: "party",
          title: "Party",
          amountMinor: 300,
          payments: [{ participantId: "friend", amountMinor: 300 }]
        }
      ]
    });

    const parentSummary = result.responsiblePayerCalculations.find((item) => item.responsiblePayerId === "parent");
    const friendSummary = result.responsiblePayerCalculations.find((item) => item.responsiblePayerId === "friend");

    expect(parentSummary?.totalOwesAmountMinor).toBe(200);
    expect(parentSummary?.netBalanceMinor).toBe(-200);
    expect(friendSummary?.totalOwesAmountMinor).toBe(100);
    expect(friendSummary?.netBalanceMinor).toBe(200);
    expect(result.transferPlan).toEqual([expect.objectContaining({ fromResponsiblePayerId: "parent", toResponsiblePayerId: "friend", amountMinor: 200 })]);
  });
});

