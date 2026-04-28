import type { FastifyInstance } from "fastify";
import { requireInternalAccess } from "../internalAuth";
import type { AppStore } from "../../store";

export function registerInternalRoutes(app: FastifyInstance, store: AppStore): void {
  app.post("/internal/autopay/run-due", async (request) => {
    requireInternalAccess(request);
    return await store.runAutoPaymentSweep();
  });
}
