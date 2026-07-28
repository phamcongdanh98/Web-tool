"use strict";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { logMemory } from "../../core/monitoring/memory-monitor.js";
import { createCleanup, createTempDirectory } from "../../core/temp/temp-directory.js";
import { assertPdfSignature, sanitizeDownloadFilename, saveUpload } from "../../shared/files/pdf-upload.js";
import { getFieldValue } from "../../shared/http/multipart-fields.js";
import { compressPdf } from "./compress-pdf.worker-client.js";

export function createCompressPdfController({ limiter }) {
  return async function compressPdfController(request, reply) {
    const requestId = crypto.randomUUID();
    const requestStartedAt = performance.now();
    const temporaryDirectory = await createTempDirectory(`web-tool-pdf-${requestId}-`);
    const cleanup = createCleanup(temporaryDirectory, request.log);
    const abortController = new AbortController();
    const abort = () => abortController.abort();

    request.raw.once("aborted", abort);
    reply.raw.once("finish", cleanup);

    const inputPath = path.join(temporaryDirectory, "input.pdf");
    const outputPath = path.join(temporaryDirectory, "output.pdf");
    const fields = {};
    let originalFilename = "tai-lieu.pdf";
    let hasFile = false;
    let responseStarted = false;

    request.log.info({ requestId }, "Bắt đầu yêu cầu nén PDF");
    logMemory(request.log, "RAM khi bắt đầu request nén", { requestId, stage: "request-start" });

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (hasFile) {
            part.file.resume();
            continue;
          }
          hasFile = true;
          originalFilename = part.filename || originalFilename;
          await saveUpload(part, inputPath);
        } else {
          fields[part.fieldname] = { value: String(part.value ?? "") };
        }
      }

      if (!hasFile) throw new AppError("Bạn chưa chọn file PDF.", 400, "FILE_REQUIRED");
      await assertPdfSignature(inputPath);
      const inputStat = await fsp.stat(inputPath);
      if (inputStat.size > env.MAX_UPLOAD_BYTES) throw new AppError("File vượt quá giới hạn dung lượng cho phép.", 413, "FILE_TOO_LARGE");

      const optionsForLog = {
        targetBytes: Number(getFieldValue(fields, "targetBytes")),
        mode: getFieldValue(fields, "mode", "balanced"),
        colorMode: getFieldValue(fields, "colorMode", "color"),
        maxDpi: Number(getFieldValue(fields, "maxDpi", 150)),
        jpegQuality: Number(getFieldValue(fields, "jpegQuality", 75))
      };

      request.log.info({
        requestId,
        filename: originalFilename,
        inputBytes: inputStat.size,
        inputMb: Number((inputStat.size / 1024 / 1024).toFixed(2)),
        options: optionsForLog
      }, "Upload PDF hoàn tất");
      logMemory(request.log, "RAM sau khi upload PDF", { requestId, stage: "upload-complete" });

      const queuedAt = performance.now();
      let compressionStartedAt = queuedAt;

      const result = await limiter.run(() => {
        compressionStartedAt = performance.now();
        request.log.info({ requestId, queueWaitMs: Math.round(compressionStartedAt - queuedAt) }, "Bắt đầu xử lý nén trong hàng đợi");
        logMemory(request.log, "RAM trước khi mở và nén PDF", { requestId, stage: "compression-start" });

        return compressPdf({
          inputPath,
          outputPath,
          maxPageCount: env.MAX_PDF_PAGES,
          ...optionsForLog,
          signal: abortController.signal,
          logger: request.log,
          requestId,
          onProgress(progress) {
            const shouldLog = progress.stage !== "rendering"
              || progress.currentPage === 1
              || progress.currentPage === progress.totalPages
              || progress.currentPage % env.PROGRESS_LOG_EVERY_PAGES === 0;

            if (shouldLog) {
              request.log.info({ requestId, progress }, "Tiến độ nén PDF");
              logMemory(request.log, "RAM trong quá trình nén", {
                requestId,
                stage: progress.stage,
                currentPage: progress.currentPage ?? null,
                totalPages: progress.totalPages ?? null,
                candidateIndex: progress.candidateIndex ?? null
              });
            }
          }
        });
      }, { signal: abortController.signal });

      const queueWaitMs = Math.max(0, Math.round(compressionStartedAt - queuedAt));
      request.log.info({ requestId, result, queueWaitMs }, "Nén PDF hoàn tất, chuẩn bị gửi file");
      logMemory(request.log, "RAM trước khi gửi file kết quả", { requestId, stage: "response-start" });

      const downloadFilename = sanitizeDownloadFilename(originalFilename);
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`)
        .header("Content-Length", String(result.outputBytes))
        .header("Cache-Control", "no-store")
        .header("X-Original-Size", String(result.inputBytes))
        .header("X-Compressed-Size", String(result.outputBytes))
        .header("X-Compression-Dpi", String(result.dpi ?? ""))
        .header("X-Compression-Quality", String(result.jpegQuality ?? ""))
        .header("X-Compression-Reached-Target", String(result.reachedTarget))
        .header("X-Page-Count", String(result.pageCount ?? ""))
        .header("X-Compression-Duration-Ms", String(result.durationMs ?? 0))
        .header("X-Queue-Wait-Ms", String(queueWaitMs))
        .header("Access-Control-Expose-Headers", "X-Original-Size, X-Compressed-Size, X-Compression-Dpi, X-Compression-Quality, X-Compression-Reached-Target, X-Page-Count, X-Compression-Duration-Ms, X-Queue-Wait-Ms");

      responseStarted = true;
      reply.raw.once("finish", () => {
        request.log.info({ requestId, totalRequestMs: Math.round(performance.now() - requestStartedAt) }, "Đã gửi xong file PDF cho người dùng");
        logMemory(request.log, "RAM sau khi gửi file kết quả", { requestId, stage: "response-finished" });
      });
      return reply.send(fs.createReadStream(outputPath));
    } catch (error) {
      request.log.error({
        requestId,
        error,
        elapsedMs: Math.round(performance.now() - requestStartedAt),
        aborted: abortController.signal.aborted
      }, "Yêu cầu nén PDF thất bại");
      logMemory(request.log, "RAM tại thời điểm nén PDF thất bại", { requestId, stage: "request-error" }, "error");
      throw error;
    } finally {
      request.raw.removeListener("aborted", abort);
      if (!responseStarted) await cleanup();
    }
  };
}
