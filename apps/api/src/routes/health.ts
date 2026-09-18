import type { FastifyInstance } from "fastify";
import { pool } from "@kenza/db/src/client.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return reply.send({ status: "ok", db: "up" });
    } catch (err) {
      app.log.error(err, "healthcheck DB failed");
      return reply.status(503).send({ status: "degraded", db: "down" });
    }
  });
}
