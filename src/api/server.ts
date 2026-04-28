import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = await buildApp({ logger: true });
  await app.listen({ port, host });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
