import { PrismaClient } from "@prisma/client";

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://socialsplit:socialsplit@localhost:5432/socialsplit?schema=integration";

export function getTestDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export function createIntegrationPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: getTestDatabaseUrl()
      }
    }
  });
}

export async function resetIntegrationDatabase(client: PrismaClient): Promise<void> {
  const tables = await client.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'"
  );

  if (tables.length === 0) {
    return;
  }

  const tableNames = tables.map((table) => `"${table.tablename}"`).join(", ");
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
}
