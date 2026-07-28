"use strict";

const port = Number(process.env.PORT || 3000);
const host = "127.0.0.1";
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 4_000);

try {
  const response = await fetch(`http://${host}:${port}/api/health`, {
    signal: controller.signal,
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Health check trả HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body?.ok !== true) {
    throw new Error("Health check trả dữ liệu không hợp lệ");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
