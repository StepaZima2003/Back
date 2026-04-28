import { createAppStoreFromEnv } from "../src/store";

async function main() {
  const store = await createAppStoreFromEnv();
  const result = await store.runAutoPaymentSweep();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
