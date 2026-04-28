import { prisma } from "../db/client";
import type { AppStore } from "./appStore";
import { InMemoryStore } from "./inMemoryStore";
import { PrismaStore } from "./prismaStore";

export async function createAppStoreFromEnv(): Promise<AppStore> {
  const provider = process.env.STORE_PROVIDER ?? "memory";
  if (provider === "prisma") {
    return await PrismaStore.create(prisma);
  }
  if (provider === "memory") {
    return new InMemoryStore();
  }

  throw new Error(`Unsupported STORE_PROVIDER: ${provider}`);
}
