import type { AppStore } from "../store";

export interface PaymentWebhookRetryWorkerConfig {
  enabled: boolean;
  intervalMs: number;
  runOnStart: boolean;
}

interface PaymentWebhookRetryLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
}

interface CreatePaymentWebhookRetryWorkerOptions {
  store: Pick<AppStore, "retryFailedPaymentWebhooks">;
  intervalMs: number;
  runOnStart?: boolean;
  logger?: PaymentWebhookRetryLogger;
}

export interface PaymentWebhookRetryWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  runNow(trigger?: "manual" | "interval" | "startup"): Promise<Awaited<ReturnType<AppStore["retryFailedPaymentWebhooks"]>>>;
}

const DEFAULT_INTERVAL_MS = 60_000;

const noopLogger: PaymentWebhookRetryLogger = {
  info() {},
  error() {}
};

export function readPaymentWebhookRetryWorkerConfig(env: NodeJS.ProcessEnv = process.env): PaymentWebhookRetryWorkerConfig {
  return {
    enabled: readBooleanEnv(env.PAYMENT_WEBHOOK_RETRY_ENABLED, false),
    intervalMs: readPositiveIntegerEnv(env.PAYMENT_WEBHOOK_RETRY_INTERVAL_MS, DEFAULT_INTERVAL_MS, "PAYMENT_WEBHOOK_RETRY_INTERVAL_MS"),
    runOnStart: readBooleanEnv(env.PAYMENT_WEBHOOK_RETRY_ON_BOOT, true)
  };
}

export function createPaymentWebhookRetryWorker(options: CreatePaymentWebhookRetryWorkerOptions): PaymentWebhookRetryWorker {
  const logger = options.logger ?? noopLogger;
  const intervalMs = ensurePositiveInteger(options.intervalMs, "intervalMs");
  const runOnStart = options.runOnStart ?? true;

  let started = false;
  let timer: NodeJS.Timeout | null = null;
  let activeRun: Promise<Awaited<ReturnType<AppStore["retryFailedPaymentWebhooks"]>>> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNext = () => {
    if (!started) {
      return;
    }
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  };

  const runNow = async (trigger: "manual" | "interval" | "startup" = "manual") => {
    if (activeRun) {
      return await activeRun;
    }

    activeRun = (async () => {
      logger.info({ trigger }, "Starting payment webhook retry sweep.");
      const result = await options.store.retryFailedPaymentWebhooks();
      logger.info(
        {
          trigger,
          dueEvents: result.dueEvents,
          retried: result.retried,
          processed: result.processed,
          failed: result.failed,
          deadLettered: result.deadLettered
        },
        "Completed payment webhook retry sweep."
      );
      return result;
    })();

    try {
      return await activeRun;
    } finally {
      activeRun = null;
    }
  };

  const tick = async () => {
    clearTimer();
    try {
      await runNow("interval");
    } catch (error) {
      logger.error({ error }, "Payment webhook retry sweep failed.");
    } finally {
      scheduleNext();
    }
  };

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;
      if (runOnStart) {
        await runNow("startup");
      }
      scheduleNext();
    },
    async stop() {
      started = false;
      clearTimer();
      try {
        await activeRun;
      } catch {
        // Original caller already observed the failure.
      }
    },
    async runNow(trigger: "manual" | "interval" | "startup" = "manual") {
      return await runNow(trigger);
    }
  };
}

function readBooleanEnv(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (!rawValue) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  throw new Error(`Invalid boolean value: ${rawValue}`);
}

function readPositiveIntegerEnv(rawValue: string | undefined, defaultValue: number, envName: string): number {
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }

  return parsed;
}

function ensurePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value;
}
