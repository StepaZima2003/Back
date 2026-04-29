import { buildApp } from "./app";
import { createAutoPaymentSweepWorker, readAutoPaymentSweepWorkerConfig } from "../payments/autopayWorker";
import { createPaymentWebhookRetryWorker, readPaymentWebhookRetryWorkerConfig } from "../payments/webhookRetryWorker";
import { createAppStoreFromEnv } from "../store";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const store = await createAppStoreFromEnv();
  const app = await buildApp({ logger: true, store });
  const autoPaymentWorkerConfig = readAutoPaymentSweepWorkerConfig(process.env);
  const autoPaymentWorker = autoPaymentWorkerConfig.enabled
    ? createAutoPaymentSweepWorker({
        store,
        intervalMs: autoPaymentWorkerConfig.intervalMs,
        runOnStart: autoPaymentWorkerConfig.runOnStart,
        logger: app.log
      })
    : null;
  const paymentWebhookRetryWorkerConfig = readPaymentWebhookRetryWorkerConfig(process.env);
  const paymentWebhookRetryWorker = paymentWebhookRetryWorkerConfig.enabled
    ? createPaymentWebhookRetryWorker({
        store,
        intervalMs: paymentWebhookRetryWorkerConfig.intervalMs,
        runOnStart: paymentWebhookRetryWorkerConfig.runOnStart,
        logger: app.log
      })
    : null;

  if (autoPaymentWorker || paymentWebhookRetryWorker) {
    app.addHook("onClose", async () => {
      await Promise.all([
        autoPaymentWorker?.stop(),
        paymentWebhookRetryWorker?.stop()
      ]);
    });
  }

  try {
    await app.listen({ port, host });
    await autoPaymentWorker?.start();
    await paymentWebhookRetryWorker?.start();
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
