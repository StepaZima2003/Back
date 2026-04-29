import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerAuthRoutes } from "./routes/auth";
import { registerCollectionRoutes } from "./routes/collections";
import { registerFriendRoutes } from "./routes/friends";
import { registerGroupRoutes } from "./routes/groups";
import { registerInternalRoutes } from "./routes/internal";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerPaymentRoutes } from "./routes/payments";
import { registerUserRoutes } from "./routes/users";
import { AppError, createAppStoreFromEnv, type AppStore } from "../store";

export interface BuildAppOptions {
  store?: AppStore;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const store = options.store ?? (await createAppStoreFromEnv());
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

  app.get("/api", async (request) => {
    const host = request.headers.host ?? "localhost:3000";
    const protocol = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;

    return {
      service: "social-split-api",
      status: "ok",
      docs: `${baseUrl}/openapi.yaml`,
      health: `${baseUrl}/health`
    };
  });

  app.get("/", async (_request, reply) => {
    const html = await readFile(join(process.cwd(), "web", "index.html"), "utf8");
    reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/app.css", async (_request, reply) => {
    const css = await readFile(join(process.cwd(), "web", "app.css"), "utf8");
    reply.type("text/css; charset=utf-8").send(css);
  });

  app.get("/app.js", async (_request, reply) => {
    const js = await readFile(join(process.cwd(), "web", "app.js"), "utf8");
    reply.type("application/javascript; charset=utf-8").send(js);
  });

  app.get("/openapi.yaml", async (_request, reply) => {
    const openApi = await readFile(join(process.cwd(), "docs", "openapi.yaml"), "utf8");
    reply.type("application/yaml").send(openApi);
  });

  registerAuthRoutes(app, store);
  registerUserRoutes(app, store);
  registerFriendRoutes(app, store);
  registerGroupRoutes(app, store);
  registerCollectionRoutes(app, store);
  registerPaymentRoutes(app, store);
  registerNotificationRoutes(app, store);
  registerInternalRoutes(app, store);

  return app;
}
