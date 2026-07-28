"use strict";

import { compressPdfInProcess } from "./compress-pdf.service.js";

function send(message) {
  if (process.connected) process.send(message);
}

const logger = Object.freeze({
  info(data, message) { send({ type: "log", level: "info", data, message }); },
  warn(data, message) { send({ type: "log", level: "warn", data, message }); },
  error(data, message) {
    const safeData = { ...data };
    if (safeData.error instanceof Error) {
      safeData.error = { name: safeData.error.name, message: safeData.error.message, stack: safeData.error.stack, code: safeData.error.code, statusCode: safeData.error.statusCode };
    }
    send({ type: "log", level: "error", data: safeData, message });
  }
});

process.once("message", async (message) => {
  if (!message || message.type !== "start") return;
  try {
    const result = await compressPdfInProcess({
      ...message.payload,
      logger,
      onProgress(progress) { send({ type: "progress", progress }); }
    });
    send({ type: "result", result });
    process.disconnect?.();
  } catch (error) {
    send({
      type: "error",
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
        stack: error?.stack,
        code: error?.code,
        statusCode: error?.statusCode
      }
    });
    process.exitCode = 1;
    process.disconnect?.();
  }
});
