"use strict";

import { fork } from "node:child_process";
import { AppError } from "../../core/errors/app-error.js";

export function compressPdf({
  logger,
  onProgress,
  signal,
  requestId,
  timeoutMs = 30 * 60 * 1000,
  ...payload
}) {
  return new Promise((resolve, reject) => {
    const worker = fork(new URL("./compression-worker.js", import.meta.url), [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env, WEB_TOOL_COMPRESSION_WORKER: "1" },
      execArgv: ["--expose-gc"]
    });
    let settled = false;
    let forceKillTimer = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };

    const stopWorker = () => {
      if (worker.exitCode !== null || worker.signalCode !== null) return;
      worker.kill("SIGTERM");
      forceKillTimer = setTimeout(() => worker.kill("SIGKILL"), 5_000);
      forceKillTimer.unref?.();
    };

    const abort = () => {
      stopWorker();
      finish(reject, new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED"));
    };

    const timeout = setTimeout(() => {
      stopWorker();
      finish(reject, new AppError(
        "Tác vụ nén vượt quá thời gian xử lý cho phép.",
        504,
        "WORKER_TIMEOUT"
      ));
    }, Math.max(1_000, Number(timeoutMs) || 30 * 60 * 1000));
    timeout.unref?.();

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }

    worker.on("message", (message) => {
      if (settled) return;
      if (message?.type === "progress") {
        try {
          onProgress?.(message.progress);
        } catch (error) {
          stopWorker();
          finish(reject, error);
        }
      }
      if (message?.type === "log") {
        const method = typeof logger?.[message.level] === "function" ? message.level : "info";
        logger?.[method]?.({ requestId, workerPid: worker.pid, ...message.data }, message.message);
      }
      if (message?.type === "result") finish(resolve, message.result);
      if (message?.type === "error") {
        const error = new AppError(
          message.error.message || "Không thể nén PDF.",
          Number(message.error.statusCode) || 500,
          message.error.code || "COMPRESSION_FAILED"
        );
        error.stack = message.error.stack || error.stack;
        finish(reject, error);
      }
    });

    worker.once("error", (error) => finish(reject, error));
    worker.once("exit", (code, exitSignal) => {
      if (settled) return;
      if (exitSignal === "SIGKILL" || code === 137) {
        finish(reject, new AppError(
          "Tiến trình nén đã bị dừng vì vượt giới hạn RAM. Hãy giảm dung lượng file, DPI hoặc chuyển sang thang xám.",
          507,
          "WORKER_OUT_OF_MEMORY"
        ));
        return;
      }
      finish(reject, new AppError(
        `Tiến trình nén kết thúc bất thường (mã ${code ?? "không rõ"}, tín hiệu ${exitSignal ?? "không có"}).`,
        500,
        "WORKER_EXITED"
      ));
    });

    worker.send({ type: "start", payload: { ...payload, requestId } });
  });
}
