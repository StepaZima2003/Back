import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaymentWebhookRetryWorker, readPaymentWebhookRetryWorkerConfig } from "../src/payments/webhookRetryWorker";

type RetryResult = {
  dueEvents: number;
  retried: number;
  processed: number;
  failed: number;
  deadLettered: number;
  eventIds: string[];
};

describe("payment webhook retry worker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses worker env config with explicit values", () => {
    const config = readPaymentWebhookRetryWorkerConfig({
      PAYMENT_WEBHOOK_RETRY_ENABLED: "true",
      PAYMENT_WEBHOOK_RETRY_INTERVAL_MS: "15000",
      PAYMENT_WEBHOOK_RETRY_ON_BOOT: "false"
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
      retryFailedPaymentWebhooks: vi.fn().mockResolvedValue({
        dueEvents: 1,
        retried: 1,
        processed: 1,
        failed: 0,
        deadLettered: 0,
        eventIds: ["event-1"]
      })
    };

    const worker = createPaymentWebhookRetryWorker({
      store,
      intervalMs: 1000,
      runOnStart: true
    });

    await worker.start();
    expect(store.retryFailedPaymentWebhooks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.retryFailedPaymentWebhooks).toHaveBeenCalledTimes(2);

    await worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.retryFailedPaymentWebhooks).toHaveBeenCalledTimes(2);
  });

  it("does not overlap an active retry sweep and resumes polling after it finishes", async () => {
    vi.useFakeTimers();

    const firstSweep = createDeferred<RetryResult>();
    const completedSweep: RetryResult = {
      dueEvents: 1,
      retried: 1,
      processed: 0,
      failed: 1,
      deadLettered: 0,
      eventIds: ["event-1"]
    };

    const store = {
      retryFailedPaymentWebhooks: vi.fn().mockImplementationOnce(() => firstSweep.promise).mockResolvedValue(completedSweep)
    };

    const worker = createPaymentWebhookRetryWorker({
      store,
      intervalMs: 1000,
      runOnStart: true
    });

    const startPromise = worker.start();
    expect(store.retryFailedPaymentWebhooks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(store.retryFailedPaymentWebhooks).toHaveBeenCalledTimes(1);

    firstSweep.resolve(completedSweep);
    await startPromise;

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.retryFailedPaymentWebhooks).toHaveBeenCalledTimes(2);

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
