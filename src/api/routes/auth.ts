import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { InMemoryStore } from "../../store";

const requestOtpSchema = z.object({
  phone: z.string().min(5)
});

const verifyOtpSchema = z.object({
  phone: z.string().min(5),
  otp: z.string().min(4)
});

export function registerAuthRoutes(app: FastifyInstance, store: InMemoryStore): void {
  app.post("/auth/request-otp", async (request, reply) => {
    const body = requestOtpSchema.parse(request.body);
    const result = store.requestOtp(body.phone);
    reply.send({
      status: "otp_sent",
      ...result
    });
  });

  app.post("/auth/verify-otp", async (request, reply) => {
    const body = verifyOtpSchema.parse(request.body);
    const result = store.verifyOtp(body.phone, body.otp);
    reply.send(result);
  });
}

