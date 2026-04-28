import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://socialsplit:socialsplit@localhost:5432/socialsplit?schema=integration";

function getSchemaName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  return parsed.searchParams.get("schema") ?? "public";
}

function getAdminDatabaseUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("schema", "public");
  return parsed.toString();
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function main() {
  const schemaName = getSchemaName(testDatabaseUrl);
  const adminClient = new PrismaClient({
    datasources: {
      db: {
        url: getAdminDatabaseUrl(testDatabaseUrl)
      }
    }
  });

  await adminClient.$connect();
  await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminClient.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  await adminClient.$disconnect();

  const env = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
    PRISMA_HIDE_UPDATE_MESSAGE: "1"
  };

  await run(npmCommand, ["run", "db:deploy"], env);
  await run(npmCommand, ["run", "test:integration:vitest"], env);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
