"use strict";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { createCleanup, createTempDirectory } from "../../core/temp/temp-directory.js";
import { assertPdfSignature, sanitizeDownloadFilename, saveUpload } from "../../shared/files/pdf-upload.js";
import { getFieldValue } from "../../shared/http/multipart-fields.js";
import { compressPdf } from "./compress-pdf.service.js";

export function createCompressPdfController({ limiter }) {
  return async function compressPdfController(request, reply) {
    const requestId = crypto.randomUUID();
    const temporaryDirectory = await createTempDirectory(`web-tool-pdf-${requestId}-`);
    const cleanup = createCleanup(temporaryDirectory, request.log);
    const abortController = new AbortController();
    const abort = () => abortController.abort();

request.raw.once("aborted", abort);

reply.raw.once("finish", cleanup);
reply.raw.once("close", cleanup);

    const inputPath = path.join(temporaryDirectory, "input.pdf");
    const outputPath = path.join(temporaryDirectory, "output.pdf");
    const fields = {};
    let originalFilename = "tai-lieu.pdf";
    let hasFile = false;

    let responseStarted = false;

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

      const queuedAt = performance.now();
      let compressionStartedAt = queuedAt;

      const result = await limiter.run(() => {
        compressionStartedAt = performance.now();
        return compressPdf({
        inputPath,
        outputPath,
        maxPageCount: env.MAX_PDF_PAGES,
        targetBytes: Number(getFieldValue(fields, "targetBytes")),
        mode: getFieldValue(fields, "mode", "balanced"),
        colorMode: getFieldValue(fields, "colorMode", "color"),
        maxDpi: Number(getFieldValue(fields, "maxDpi", 150)),
        jpegQuality: Number(getFieldValue(fields, "jpegQuality", 75)),
        signal: abortController.signal,
        onProgress(progress) {
          if (progress.stage === "completed") request.log.info({ requestId, progress }, "Nén PDF hoàn tất");
        }
      });
      }, { signal: abortController.signal });

      const queueWaitMs = Math.max(0, Math.round(compressionStartedAt - queuedAt));

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
      return reply.send(fs.createReadStream(outputPath));
    } finally {
      request.raw.removeListener("aborted", abort);
      if (!responseStarted) await cleanup();
    }
  };
}
