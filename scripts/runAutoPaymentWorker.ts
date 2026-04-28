import { createAutoPaymentSweepWorker, readAutoPaymentSweepWorkerConfig } from "../src/payments/autopayWorker";
import { createAppStoreFromEnv } from "../src/store";

async function main() {
  const config = readAutoPaymentSweepWorkerConfig(process.env);
  const store = await createAppStoreFromEnv();
  const worker = createAutoPaymentSweepWorker({
    store,
    intervalMs: config.intervalMs,
    runOnStart: config.runOnStart,
    logger: console
  });

  await worker.start();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "running",
        intervalMs: config.intervalMs,
        runOnStart: config.runOnStart
      },
      null,
      2
    )}\n`
  );

  const shutdown = async () => {
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
