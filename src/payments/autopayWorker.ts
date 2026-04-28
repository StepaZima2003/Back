import type { AppStore } from "../store";

export interface AutoPaymentSweepWorkerConfig {
  enabled: boolean;
  intervalMs: number;
  runOnStart: boolean;
}

interface AutoPaymentSweepLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
}

interface CreateAutoPaymentSweepWorkerOptions {
  store: Pick<AppStore, "runAutoPaymentSweep">;
  intervalMs: number;
  runOnStart?: boolean;
  logger?: AutoPaymentSweepLogger;
}

export interface AutoPaymentSweepWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  runNow(trigger?: "manual" | "interval" | "startup"): Promise<Awaited<ReturnType<AppStore["runAutoPaymentSweep"]>>>;
}

const DEFAULT_INTERVAL_MS = 60_000;

const noopLogger: AutoPaymentSweepLogger = {
  info() {},
  error() {}
};

export function readAutoPaymentSweepWorkerConfig(env: NodeJS.ProcessEnv = process.env): AutoPaymentSweepWorkerConfig {
  const enabled = readBooleanEnv(env.AUTOPAY_SWEEP_ENABLED, false);
  const runOnStart = readBooleanEnv(env.AUTOPAY_SWEEP_ON_BOOT, true);
  const intervalMs = readPositiveIntegerEnv(env.AUTOPAY_SWEEP_INTERVAL_MS, DEFAULT_INTERVAL_MS, "AUTOPAY_SWEEP_INTERVAL_MS");

  return {
    enabled,
    intervalMs,
    runOnStart
  };
}

export function createAutoPaymentSweepWorker(options: CreateAutoPaymentSweepWorkerOptions): AutoPaymentSweepWorker {
  const intervalMs = ensurePositiveInteger(options.intervalMs, "intervalMs");
  const logger = options.logger ?? noopLogger;
  const runOnStart = options.runOnStart ?? true;

  let started = false;
  let timer: NodeJS.Timeout | null = null;
  let activeRun: Promise<Awaited<ReturnType<AppStore["runAutoPaymentSweep"]>>> | null = null;

  const scheduleNext = () => {
    if (!started) {
      return;
    }

    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  };

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const tick = async () => {
    clearTimer();
    try {
      await runNow("interval");
    } catch (error) {
      logger.error({ error }, "Auto payment sweep failed.");
    } finally {
      scheduleNext();
    }
  };

  const runNow = async (trigger: "manual" | "interval" | "startup" = "manual") => {
    if (activeRun) {
      return await activeRun;
    }

    activeRun = (async () => {
      logger.info({ trigger }, "Starting auto payment sweep.");
      const result = await options.store.runAutoPaymentSweep();
      logger.info(
        {
          trigger,
          collectionsScanned: result.collectionsScanned,
          collectionsWithEligibleItems: result.collectionsWithEligibleItems,
          paymentsCreated: result.paymentsCreated
        },
        "Completed auto payment sweep."
      );
      return result;
    })();

    try {
      return await activeRun;
    } finally {
      activeRun = null;
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
        // The caller already received the sweep failure through logs or the original trigger.
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
