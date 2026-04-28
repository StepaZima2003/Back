import { buildApp } from "./app";
import { createAutoPaymentSweepWorker, readAutoPaymentSweepWorkerConfig } from "../payments/autopayWorker";
import { createAppStoreFromEnv } from "../store";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const store = await createAppStoreFromEnv();
  const app = await buildApp({ logger: true, store });
  const workerConfig = readAutoPaymentSweepWorkerConfig(process.env);
  const worker = workerConfig.enabled
    ? createAutoPaymentSweepWorker({
        store,
        intervalMs: workerConfig.intervalMs,
        runOnStart: workerConfig.runOnStart,
        logger: app.log
      })
    : null;

  if (worker) {
    app.addHook("onClose", async () => {
      await worker.stop();
    });
  }

  try {
    await app.listen({ port, host });
    if (worker) {
      await worker.start();
    }
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
