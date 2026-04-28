import { prisma } from "../db/client";
import type { AppStore } from "./appStore";
import { InMemoryStore } from "./inMemoryStore";
import { PrismaMirrorStore } from "./prismaMirrorStore";
import { PrismaStore } from "./prismaStore";

export async function createAppStoreFromEnv(): Promise<AppStore> {
  const provider = process.env.STORE_PROVIDER ?? "memory";
  if (provider === "prisma") {
    return await PrismaStore.create(prisma);
  }
  if (provider === "prisma-mirror") {
    return await PrismaMirrorStore.create(prisma);
  }

  return new InMemoryStore();
}
