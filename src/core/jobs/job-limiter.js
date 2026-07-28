"use strict";

import { AppError } from "../errors/app-error.js";

export class JobLimiter {
  #active = 0;
  #queue = [];

  constructor({ concurrency = 1, queueLimit = 10 } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.queueLimit = Math.max(0, Number(queueLimit) || 0);
  }

  async run(task, { signal } = {}) {
    await this.#acquire(signal);
    try {
      if (signal?.aborted) throw new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED");
      return await task();
    } finally {
      this.#release();
    }
  }

  #acquire(signal) {
    if (signal?.aborted) {
      return Promise.reject(new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED"));
    }

    if (this.#active < this.concurrency) {
      this.#active += 1;
      return Promise.resolve();
    }

    if (this.#queue.length >= this.queueLimit) {
      return Promise.reject(new AppError("Máy chủ đang xử lý quá nhiều file. Vui lòng thử lại sau.", 503, "QUEUE_FULL"));
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: null };
      entry.onAbort = () => {
        const index = this.#queue.indexOf(entry);
        if (index >= 0) this.#queue.splice(index, 1);
        reject(new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED"));
      };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      this.#queue.push(entry);
    });
  }

  #release() {
    while (this.#queue.length > 0) {
      const next = this.#queue.shift();
      next.signal?.removeEventListener("abort", next.onAbort);
      if (next.signal?.aborted) {
        next.reject(new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED"));
        continue;
      }
      next.resolve();
      return;
    }
    this.#active = Math.max(0, this.#active - 1);
  }

  get stats() {
    return {
      active: this.#active,
      queued: this.#queue.length,
      concurrency: this.concurrency,
      queueLimit: this.queueLimit
    };
  }
}
