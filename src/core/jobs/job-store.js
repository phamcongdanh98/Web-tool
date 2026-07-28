"use strict";

import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export class JobStore {
  #jobs = new Map();
  #reservations = 0;
  #capacityLock = Promise.resolve();
  #timer = null;

  constructor({ retentionMs = 30 * 60 * 1000, cleanupIntervalMs = 60_000, maxJobs = 10, logger } = {}) {
    this.retentionMs = Math.max(60_000, Number(retentionMs) || 30 * 60 * 1000);
    this.cleanupIntervalMs = Math.max(10_000, Number(cleanupIntervalMs) || 60_000);
    this.maxJobs = Math.max(1, Number(maxJobs) || 10);
    this.logger = logger;
    this.#timer = setInterval(() => void this.cleanupExpired(), this.cleanupIntervalMs);
    this.#timer.unref?.();
  }

  async ensureCapacity() {
    if (this.#jobs.size + this.#reservations < this.maxJobs) return;
    const removable = [...this.#jobs.values()]
      .filter((job) => TERMINAL_STATUSES.has(job.status))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (
      this.#jobs.size + this.#reservations >= this.maxJobs &&
      removable.length > 0
    ) {
      await this.remove(removable.shift().id, { abort: false });
    }
    if (this.#jobs.size + this.#reservations >= this.maxJobs) {
      throw new AppError("Máy chủ đang lưu quá nhiều tác vụ. Vui lòng thử lại sau.", 503, "JOB_STORE_FULL");
    }
  }

  async reserveCapacity() {
    let unlock;
    const previousLock = this.#capacityLock;
    this.#capacityLock = new Promise((resolve) => {
      unlock = resolve;
    });

    await previousLock;
    try {
      await this.ensureCapacity();
      this.#reservations += 1;
    } finally {
      unlock();
    }

    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.#reservations = Math.max(0, this.#reservations - 1);
    };
  }

  create({ directory, inputPath, outputPath, originalFilename, inputBytes, options, cleanup }) {
    const now = Date.now();
    const id = crypto.randomUUID();
    const job = {
      id,
      status: "queued",
      progress: 0,
      stage: "queued",
      message: "Đang chờ xử lý",
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      startedAt: null,
      completedAt: null,
      queueWaitMs: 0,
      durationMs: 0,
      directory,
      inputPath,
      outputPath,
      originalFilename,
      inputBytes,
      outputBytes: null,
      options,
      result: null,
      error: null,
      cleanup,
      abortController: new AbortController(),
      downloadCount: 0
    };
    this.#jobs.set(id, job);
    return job;
  }

  get(id) {
    return this.#jobs.get(id) || null;
  }

  require(id) {
    const job = this.get(id);
    if (!job) throw new AppError("Tác vụ không tồn tại hoặc đã hết hạn.", 404, "JOB_NOT_FOUND");
    return job;
  }

  update(id, patch) {
    const job = this.require(id);
    Object.assign(job, patch, { updatedAt: Date.now() });
    job.expiresAt = TERMINAL_STATUSES.has(job.status)
      ? Date.now() + this.retentionMs
      : null;
    return job;
  }

  markProcessing(id, { queueWaitMs = 0 } = {}) {
    return this.update(id, {
      status: "processing",
      stage: "analyzing",
      progress: Math.max(1, this.require(id).progress),
      message: "Đang phân tích PDF",
      startedAt: Date.now(),
      queueWaitMs
    });
  }

  markProgress(id, progressData = {}) {
    const job = this.require(id);
    if (TERMINAL_STATUSES.has(job.status)) return job;
    const normalized = normalizeProgress(progressData, job.progress);
    return this.update(id, {
      status: "processing",
      ...normalized
    });
  }

  markCompleted(id, result) {
    const job = this.require(id);
    return this.update(id, {
      status: "completed",
      stage: "completed",
      progress: 100,
      message: result.reachedTarget ? "Nén hoàn tất" : "Hoàn tất, chưa đạt đúng mục tiêu",
      completedAt: Date.now(),
      durationMs: Number(result.durationMs) || Math.max(0, Date.now() - (job.startedAt || job.createdAt)),
      outputBytes: Number(result.outputBytes) || null,
      result,
      error: null
    });
  }

  markFailed(id, error) {
    const job = this.require(id);
    const cancelled = error?.code === "JOB_ABORTED";
    return this.update(id, {
      status: cancelled ? "cancelled" : "failed",
      stage: cancelled ? "cancelled" : "failed",
      message: error?.message || "Không thể nén PDF.",
      completedAt: Date.now(),
      durationMs: Math.max(0, Date.now() - (job.startedAt || job.createdAt)),
      error: {
        code: error?.code || "COMPRESSION_FAILED",
        message: error?.message || "Không thể nén PDF.",
        statusCode: Number(error?.statusCode) || 500
      }
    });
  }

  toPublic(job) {
    return {
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        message: job.message,
        createdAt: new Date(job.createdAt).toISOString(),
        updatedAt: new Date(job.updatedAt).toISOString(),
        expiresAt: Number.isFinite(job.expiresAt)
          ? new Date(job.expiresAt).toISOString()
          : null,
        queueWaitMs: job.queueWaitMs,
        durationMs: job.durationMs,
        inputBytes: job.inputBytes,
        outputBytes: job.outputBytes,
        result: job.status === "completed" ? publicResult(job.result) : null,
        error: job.error,
        downloadUrl: job.status === "completed" ? `/api/pdf/compress/jobs/${job.id}/download` : null
      }
    };
  }

  async remove(id, { abort = true } = {}) {
    const job = this.#jobs.get(id);
    if (!job) return false;
    this.#jobs.delete(id);
    if (abort && !TERMINAL_STATUSES.has(job.status)) job.abortController.abort();
    await job.cleanup?.();
    return true;
  }

  async cleanupExpired() {
    const now = Date.now();
    const expired = [...this.#jobs.values()].filter(
      (job) =>
        TERMINAL_STATUSES.has(job.status) &&
        Number.isFinite(job.expiresAt) &&
        job.expiresAt <= now
    );
    for (const job of expired) {
      try {
        await this.remove(job.id);
      } catch (error) {
        this.logger?.warn?.({ error, jobId: job.id }, "Không thể dọn tác vụ PDF hết hạn");
      }
    }
  }

  async close() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const ids = [...this.#jobs.keys()];
    await Promise.allSettled(ids.map((id) => this.remove(id)));
  }

  get stats() {
    const values = [...this.#jobs.values()];
    return {
      total: values.length,
      queued: values.filter((job) => job.status === "queued").length,
      processing: values.filter((job) => job.status === "processing").length,
      completed: values.filter((job) => job.status === "completed").length,
      failed: values.filter((job) => job.status === "failed").length,
      reservations: this.#reservations
    };
  }
}

function normalizeProgress(data, previous) {
  const stage = String(data.stage || "processing");
  if (stage === "sampling") {
    const current = Number(data.candidateIndex || data.currentCandidate || 1);
    const total = Math.max(1, Number(data.candidateCount || data.totalCandidates || 6));
    return {
      stage,
      progress: clamp(5 + Math.round((current / total) * 20), previous, 30),
      message: "Đang tìm cấu hình nén phù hợp"
    };
  }
  if (stage === "rendering") {
    const current = Number(data.currentPage || 0);
    const total = Math.max(1, Number(data.totalPages || 1));
    return {
      stage,
      progress: clamp(30 + Math.round((current / total) * 62), previous, 94),
      message: `Đang xử lý trang ${current}/${total}`
    };
  }
  if (stage === "saving" || stage === "finalizing") {
    return { stage, progress: clamp(96, previous, 98), message: "Đang hoàn thiện file kết quả" };
  }
  return { stage, progress: clamp(Math.max(previous, 3), 0, 98), message: "Đang xử lý PDF" };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function publicResult(result = {}) {
  return {
    inputBytes: Number(result.inputBytes) || null,
    outputBytes: Number(result.outputBytes) || null,
    pageCount: Number(result.pageCount) || null,
    dpi: Number(result.dpi) || null,
    jpegQuality: Number(result.jpegQuality) || null,
    colorMode: result.colorMode || null,
    reachedTarget: Boolean(result.reachedTarget),
    skipped: Boolean(result.skipped),
    durationMs: Number(result.durationMs) || 0
  };
}
