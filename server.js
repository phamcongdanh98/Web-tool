"use strict";

import { loadLocalEnvironment } from "./src/config/load-env.js";

await loadLocalEnvironment();

const [{ buildApp }, { env }, { getMemorySnapshot, logMemory, startMemoryMonitor }] = await Promise.all([
  import("./src/app.js"),
  import("./src/config/env.js"),
  import("./src/core/monitoring/memory-monitor.js")
]);

const app = await buildApp();
let shuttingDown = false;
let stopMemoryMonitor = () => {};

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopMemoryMonitor();
  app.log.info({ signal, memory: getMemorySnapshot({ stage: "shutdown" }) }, "Đang tắt máy chủ");
  const forceExit = setTimeout(() => process.exit(1), 25_000).unref();
  try {
    await app.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    app.log.error({ error, memory: getMemorySnapshot({ stage: "shutdown-error" }) }, "Lỗi khi tắt máy chủ");
    process.exit(1);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.on("warning", (warning) => app.log.warn({ warning, memory: getMemorySnapshot({ stage: "process-warning" }) }, "Cảnh báo từ Node.js"));
process.on("unhandledRejection", (error) => app.log.error({ error, memory: getMemorySnapshot({ stage: "unhandled-rejection" }) }, "Unhandled rejection"));
process.on("uncaughtException", (error) => {
  app.log.fatal({ error, memory: getMemorySnapshot({ stage: "uncaught-exception" }) }, "Uncaught exception");
  shutdown("uncaughtException");
});
process.on("exit", (code) => {
  // console.error được dùng vì logger có thể đã đóng tại thời điểm exit.
  console.error(JSON.stringify({ level: "fatal", event: "process-exit", code, memory: getMemorySnapshot({ stage: "process-exit" }) }));
});

try {
  app.server.keepAliveTimeout = 120_000;
  app.server.headersTimeout = 125_000;
  app.server.requestTimeout = Number(
    process.env.REQUEST_TIMEOUT_MS || 1_800_000
  );

  await app.listen({
    host: env.HOST,
    port: env.PORT
  });

  app.log.info(
    {
      host: env.HOST,
      port: env.PORT,
      keepAliveTimeoutMs: app.server.keepAliveTimeout,
      headersTimeoutMs: app.server.headersTimeout,
      requestTimeoutMs: app.server.requestTimeout
    },
    "Máy chủ đã khởi động"
  );

  logMemory(
    app.log,
    "RAM ngay sau khi máy chủ khởi động",
    {
      stage: "server-started"
    }
  );

  stopMemoryMonitor = startMemoryMonitor(app.log, {
    intervalMs: env.MEMORY_LOG_INTERVAL_MS,
    warningPercent: env.MEMORY_WARNING_PERCENT
  });
} catch (error) {
  app.log.error(
    {
      error,
      memory: getMemorySnapshot({
        stage: "listen-error"
      })
    },
    "Không thể khởi động máy chủ"
  );

  process.exit(1);
}
