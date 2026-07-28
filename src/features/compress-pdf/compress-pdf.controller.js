"use strict";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { logMemory } from "../../core/monitoring/memory-monitor.js";
import { createCleanup, createTempDirectory } from "../../core/temp/temp-directory.js";
import { assertPdfSignature, sanitizeDownloadFilename, saveUpload } from "../../shared/files/pdf-upload.js";
import { getFieldValue } from "../../shared/http/multipart-fields.js";
import { compressPdf } from "./compress-pdf.worker-client.js";

export function createCompressionJobController({ limiter, jobStore }) {
  return async function createCompressionJob(request, reply) {
    const temporaryDirectory = await createTempDirectory("web-tool-pdf-job-");
    const cleanup = createCleanup(temporaryDirectory, request.log);
    const inputPath = path.join(temporaryDirectory, "input.pdf");
    const outputPath = path.join(temporaryDirectory, "output.pdf");
    const fields = {};
    let originalFilename = "tai-lieu.pdf";
    let hasFile = false;
    let job = null;

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
      if (inputStat.size > env.MAX_UPLOAD_BYTES) {
        throw new AppError("File vượt quá giới hạn dung lượng cho phép.", 413, "FILE_TOO_LARGE");
      }

      const options = {
        targetBytes: Number(getFieldValue(fields, "targetBytes")),
        mode: getFieldValue(fields, "mode", "balanced"),
        colorMode: getFieldValue(fields, "colorMode", "color"),
        maxDpi: Number(getFieldValue(fields, "maxDpi", 150)),
        jpegQuality: Number(getFieldValue(fields, "jpegQuality", 75))
      };

      await jobStore.ensureCapacity();

      job = jobStore.create({
        directory: temporaryDirectory,
        inputPath,
        outputPath,
        originalFilename,
        inputBytes: inputStat.size,
        options,
        cleanup
      });

      request.log.info({
        jobId: job.id,
        filename: originalFilename,
        inputBytes: inputStat.size,
        options
      }, "Đã tạo tác vụ nén PDF nền");

      startCompressionInBackground({ job, limiter, jobStore, logger: request.log });

      return reply.code(202).send({
        ok: true,
        jobId: job.id,
        statusUrl: `/api/pdf/compress/jobs/${job.id}`,
        downloadUrl: `/api/pdf/compress/jobs/${job.id}/download`,
        expiresAt: new Date(job.expiresAt).toISOString()
      });
    } catch (error) {
      if (!job) await cleanup();
      throw error;
    }
  };
}

export function createGetCompressionJobController({ jobStore }) {
  return async function getCompressionJob(request) {
    return jobStore.toPublic(jobStore.require(request.params.jobId));
  };
}

export function createDownloadCompressionJobController({ jobStore }) {
  return async function downloadCompressionJob(request, reply) {
    const job = jobStore.require(request.params.jobId);
    if (job.status !== "completed") {
      throw new AppError(
        job.status === "failed" ? job.error?.message || "Tác vụ nén thất bại." : "PDF chưa nén xong.",
        job.status === "failed" ? Number(job.error?.statusCode) || 500 : 409,
        job.status === "failed" ? job.error?.code || "COMPRESSION_FAILED" : "JOB_NOT_COMPLETED"
      );
    }

    try {
      const stat = await fsp.stat(job.outputPath);
      if (!stat.isFile()) throw new Error("Kết quả không phải file.");
    } catch {
      throw new AppError("File kết quả không còn tồn tại. Vui lòng nén lại.", 410, "RESULT_EXPIRED");
    }

    job.downloadCount += 1;
    job.expiresAt = Date.now() + jobStore.retentionMs;
    const result = job.result || {};
    const filename = sanitizeDownloadFilename(job.originalFilename);

    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .header("Content-Length", String(job.outputBytes || result.outputBytes || ""))
      .header("Cache-Control", "private, no-store")
      .header("X-Original-Size", String(job.inputBytes))
      .header("X-Compressed-Size", String(job.outputBytes || result.outputBytes || ""))
      .header("X-Compression-Dpi", String(result.dpi ?? ""))
      .header("X-Compression-Quality", String(result.jpegQuality ?? ""))
      .header("X-Compression-Reached-Target", String(Boolean(result.reachedTarget)))
      .header("X-Page-Count", String(result.pageCount ?? ""))
      .header("X-Compression-Duration-Ms", String(job.durationMs || result.durationMs || 0))
      .header("X-Queue-Wait-Ms", String(job.queueWaitMs || 0))
      .header("Access-Control-Expose-Headers", "X-Original-Size, X-Compressed-Size, X-Compression-Dpi, X-Compression-Quality, X-Compression-Reached-Target, X-Page-Count, X-Compression-Duration-Ms, X-Queue-Wait-Ms");

    return reply.send(fs.createReadStream(job.outputPath));
  };
}

export function createDeleteCompressionJobController({ jobStore }) {
  return async function deleteCompressionJob(request, reply) {
    const removed = await jobStore.remove(request.params.jobId);
    if (!removed) throw new AppError("Tác vụ không tồn tại hoặc đã hết hạn.", 404, "JOB_NOT_FOUND");
    return reply.code(204).send();
  };
}

function startCompressionInBackground({ job, limiter, jobStore, logger }) {
  const queuedAt = performance.now();

  void limiter.run(async () => {
    const queueWaitMs = Math.max(0, Math.round(performance.now() - queuedAt));
    jobStore.markProcessing(job.id, { queueWaitMs });
    logger.info({ jobId: job.id, queueWaitMs }, "Bắt đầu tác vụ nén PDF nền");
    logMemory(logger, "RAM trước khi nén PDF nền", { jobId: job.id, stage: "background-start" });

    const result = await compressPdf({
      inputPath: job.inputPath,
      outputPath: job.outputPath,
      maxPageCount: env.MAX_PDF_PAGES,
      ...job.options,
      signal: job.abortController.signal,
      logger,
      requestId: job.id,
      onProgress(progress) {
        jobStore.markProgress(job.id, progress);
        const current = Number(progress.currentPage || 0);
        const total = Number(progress.totalPages || 0);
        const shouldLog = progress.stage !== "rendering" || current === 1 || current === total || current % env.PROGRESS_LOG_EVERY_PAGES === 0;
        if (shouldLog) logger.info({ jobId: job.id, progress }, "Tiến độ tác vụ nén PDF nền");
      }
    });

    jobStore.markCompleted(job.id, result);
    logger.info({ jobId: job.id, result }, "Tác vụ nén PDF nền hoàn tất");
    logMemory(logger, "RAM sau khi nén PDF nền", { jobId: job.id, stage: "background-completed" });
  }, { signal: job.abortController.signal }).catch((error) => {
    try {
      jobStore.markFailed(job.id, error);
    } catch {
      return;
    }
    logger.error({ jobId: job.id, error }, "Tác vụ nén PDF nền thất bại");
    logMemory(logger, "RAM khi tác vụ PDF nền thất bại", { jobId: job.id, stage: "background-failed" }, "error");
  });
}
