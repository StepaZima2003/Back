import { prisma } from "../db/client";
import type { AppStore } from "./appStore";
import { InMemoryStore } from "./inMemoryStore";
import { PrismaMirrorStore } from "./prismaMirrorStore";

export function createAppStoreFromEnv(): AppStore {
  const provider = process.env.STORE_PROVIDER ?? "memory";
  if (provider === "prisma-mirror") {
    return new PrismaMirrorStore(prisma);
  }

  return new InMemoryStore();
}
