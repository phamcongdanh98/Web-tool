"use strict";

import { fork } from "node:child_process";
import { AppError } from "../../core/errors/app-error.js";

export function compressPdf({ logger, onProgress, signal, requestId, ...payload }) {
  return new Promise((resolve, reject) => {
    const worker = fork(new URL("./compression-worker.js", import.meta.url), [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env, WEB_TOOL_COMPRESSION_WORKER: "1" },
      execArgv: ["--expose-gc"]
    });
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };

    const abort = () => {
      worker.kill("SIGTERM");
      finish(reject, new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED"));
    };
    signal?.addEventListener("abort", abort, { once: true });

    worker.on("message", (message) => {
      if (message?.type === "progress") onProgress?.(message.progress);
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
