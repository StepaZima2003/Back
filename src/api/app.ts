import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerAuthRoutes } from "./routes/auth";
import { registerCollectionRoutes } from "./routes/collections";
import { registerFriendRoutes } from "./routes/friends";
import { registerGroupRoutes } from "./routes/groups";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerUserRoutes } from "./routes/users";
import { AppError, InMemoryStore } from "../store";

export interface BuildAppOptions {
  store?: InMemoryStore;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const store = options.store ?? new InMemoryStore();
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: "APP_ERROR",
        message: error.message
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "VALIDATION_ERROR",
        issues: error.issues
      });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Unexpected server error."
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "social-split-api"
  }));

  app.get("/openapi.yaml", async (_request, reply) => {
    const openApi = await readFile(join(process.cwd(), "docs", "openapi.yaml"), "utf8");
    reply.type("application/yaml").send(openApi);
  });

  registerAuthRoutes(app, store);
  registerUserRoutes(app, store);
  registerFriendRoutes(app, store);
  registerGroupRoutes(app, store);
  registerCollectionRoutes(app, store);
  registerNotificationRoutes(app, store);

  return app;
}
