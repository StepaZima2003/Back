import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoPaymentSweepWorker, readAutoPaymentSweepWorkerConfig } from "../src/payments/autopayWorker";

type SweepResult = {
  collectionsScanned: number;
  collectionsWithEligibleItems: number;
  paymentsCreated: number;
  affectedCollectionIds: string[];
};

describe("auto payment worker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses worker env config with explicit values", () => {
    const config = readAutoPaymentSweepWorkerConfig({
      AUTOPAY_SWEEP_ENABLED: "true",
      AUTOPAY_SWEEP_INTERVAL_MS: "15000",
      AUTOPAY_SWEEP_ON_BOOT: "false"
    });

    expect(config).toEqual({
      enabled: true,
      intervalMs: 15000,
      runOnStart: false
    });
  });

  it("runs on startup and then keeps polling on the configured interval", async () => {
    vi.useFakeTimers();

    const store = {
      runAutoPaymentSweep: vi.fn().mockResolvedValue({
        collectionsScanned: 1,
        collectionsWithEligibleItems: 1,
        paymentsCreated: 1,
        affectedCollectionIds: ["collection-1"]
      })
    };

    const worker = createAutoPaymentSweepWorker({
      store,
      intervalMs: 1000,
      runOnStart: true
    });

    await worker.start();
    expect(store.runAutoPaymentSweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.runAutoPaymentSweep).toHaveBeenCalledTimes(2);

    await worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.runAutoPaymentSweep).toHaveBeenCalledTimes(2);
  });

  it("does not overlap an active sweep and resumes polling after it finishes", async () => {
    vi.useFakeTimers();

    const firstSweep = createDeferred<SweepResult>();
    const completedSweep: SweepResult = {
      collectionsScanned: 1,
      collectionsWithEligibleItems: 0,
      paymentsCreated: 0,
      affectedCollectionIds: []
    };

    const store = {
      runAutoPaymentSweep: vi.fn().mockImplementationOnce(() => firstSweep.promise).mockResolvedValue(completedSweep)
    };

    const worker = createAutoPaymentSweepWorker({
      store,
      intervalMs: 1000,
      runOnStart: true
    });

    const startPromise = worker.start();
    expect(store.runAutoPaymentSweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(store.runAutoPaymentSweep).toHaveBeenCalledTimes(1);

    firstSweep.resolve(completedSweep);
    await startPromise;

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.runAutoPaymentSweep).toHaveBeenCalledTimes(2);

    await worker.stop();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}
