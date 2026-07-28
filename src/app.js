"use strict";

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { registerApiRoutes } from "./routes/api.routes.js";
import { registerPageRoutes } from "./routes/pages.routes.js";
import { ensureTempRoot } from "./core/temp/temp-directory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(__dirname, "../public");

export async function buildApp() {
  await ensureTempRoot();
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || "info" },
    bodyLimit: env.MAX_UPLOAD_BYTES + 1024 * 1024,
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    connectionTimeout: 30_000
  });

  app.addHook("onSend", async (_, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "no-referrer")
      .header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
      .header("Cross-Origin-Resource-Policy", "same-origin");
    return payload;
  });

  await app.register(multipart, {
    limits: { files: 1, fields: 20, parts: 25, fileSize: env.MAX_UPLOAD_BYTES, fieldSize: 1024 * 1024 }
  });
  await app.register(fastifyStatic, { root: publicRoot, prefix: "/", index: false });
  await registerPageRoutes(app);
  await registerApiRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "Lỗi xử lý yêu cầu");
    const tooLarge = error.code === "FST_REQ_FILE_TOO_LARGE" || error.name === "RequestFileTooLargeError";
    const statusCode = tooLarge ? 413 : Number(error.statusCode) || 500;
    if (!reply.sent) reply.code(statusCode).send({ ok: false, message: tooLarge ? "File vượt quá giới hạn dung lượng cho phép." : error.message || "Máy chủ gặp lỗi không xác định." });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) return reply.code(404).send({ ok: false, message: "API không tồn tại." });
    return reply.code(404).sendFile("index.html");
  });

  return app;
}
