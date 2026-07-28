"use strict";

import fs from "node:fs";
import os from "node:os";
import { AppError } from "../errors/app-error.js";

const MB = 1024 * 1024;
const CGROUP_CURRENT_PATHS = [
  "/sys/fs/cgroup/memory.current",
  "/sys/fs/cgroup/memory/memory.usage_in_bytes"
];
const CGROUP_LIMIT_PATHS = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes"
];

function readFirstNumber(paths) {
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, "utf8").trim();
      if (!raw || raw === "max") return null;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      // Không chạy trong cgroup hoặc file không tồn tại.
    }
  }
  return null;
}

function toMb(bytes) {
  return Number((bytes / MB).toFixed(1));
}

export function getMemorySnapshot(extra = {}) {
  const usage = process.memoryUsage();
  const cgroupCurrent = readFirstNumber(CGROUP_CURRENT_PATHS);
  const cgroupLimit = readFirstNumber(CGROUP_LIMIT_PATHS);
  const rssBytes = usage.rss;
  const effectiveCurrent = cgroupCurrent ?? rssBytes;

  return {
    ...extra,
    pid: process.pid,
    rssMb: toMb(rssBytes),
    heapUsedMb: toMb(usage.heapUsed),
    heapTotalMb: toMb(usage.heapTotal),
    externalMb: toMb(usage.external),
    arrayBuffersMb: toMb(usage.arrayBuffers),
    cgroupUsedMb: cgroupCurrent ? toMb(cgroupCurrent) : null,
    cgroupLimitMb: cgroupLimit ? toMb(cgroupLimit) : null,
    cgroupFreeMb: cgroupLimit ? toMb(Math.max(0, cgroupLimit - effectiveCurrent)) : null,
    cgroupUsagePercent: cgroupLimit ? Number(((effectiveCurrent / cgroupLimit) * 100).toFixed(1)) : null,
    systemFreeMb: toMb(os.freemem()),
    systemTotalMb: toMb(os.totalmem()),
    uptimeSeconds: Math.round(process.uptime())
  };
}

export function assertMemoryHeadroom({
  minimumFreeMb = 96,
  maximumUsagePercent = 82,
  stage = "compression"
} = {}) {
  const snapshot = getMemorySnapshot({ stage });
  if (
    snapshot.cgroupLimitMb !== null &&
    (
      snapshot.cgroupFreeMb < minimumFreeMb ||
      snapshot.cgroupUsagePercent >= maximumUsagePercent
    )
  ) {
    throw new AppError(
      `Máy chủ không còn đủ RAM an toàn để tiếp tục xử lý tại bước ${stage}. Hãy thử file nhỏ hơn hoặc chọn mức nén nhẹ hơn.`,
      507,
      "INSUFFICIENT_MEMORY"
    );
  }
  return snapshot;
}

export function logMemory(logger, message, extra = {}, level = "info") {
  const snapshot = getMemorySnapshot(extra);
  const method = typeof logger?.[level] === "function" ? level : "info";
  logger?.[method]?.({ memory: snapshot }, message);
  return snapshot;
}

export function startMemoryMonitor(logger, {
  intervalMs = 15_000,
  warningPercent = 85
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};

  const timer = setInterval(() => {
    const snapshot = getMemorySnapshot({ source: "periodic" });
    const level = snapshot.cgroupUsagePercent !== null && snapshot.cgroupUsagePercent >= warningPercent
      ? "warn"
      : "info";
    logger?.[level]?.({ memory: snapshot }, level === "warn" ? "Cảnh báo RAM container đang cao" : "Theo dõi RAM định kỳ");
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
