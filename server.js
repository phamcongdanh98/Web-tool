"use strict";

import { loadLocalEnvironment } from "./src/config/load-env.js";

await loadLocalEnvironment();

const [{ buildApp }, { env }] = await Promise.all([
  import("./src/app.js"),
  import("./src/config/env.js")
]);

const app = await buildApp();
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Đang tắt máy chủ");
  const forceExit = setTimeout(() => process.exit(1), 25_000).unref();
  try {
    await app.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => app.log.error({ error }, "Unhandled rejection"));
process.on("uncaughtException", (error) => {
  app.log.fatal({ error }, "Uncaught exception");
  shutdown("uncaughtException");
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info({ host: env.HOST, port: env.PORT }, "Máy chủ đã khởi động");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
