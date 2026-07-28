"use strict";

import fsp from "node:fs/promises";
import * as mupdf from "mupdf";
import { AppError } from "../../core/errors/app-error.js";
import { logMemory } from "../../core/monitoring/memory-monitor.js";
import { validateCompressionOptions } from "./compress-pdf.options.js";
import {
  buildRasterizedPdf,
  calculateRetrySettings,
  chooseCompressionSettings,
  safeDestroy,
  selectSamplePages,
  throwIfAborted
} from "./compression-engine.js";

export async function compressPdf({ inputPath, outputPath, maxPageCount, onProgress, signal, logger, requestId, ...rawOptions }) {
  const startedAt = performance.now();
  const options = validateCompressionOptions(rawOptions);
  let document;

  try {
    logger?.info({ requestId, options }, "Đọc PDF đầu vào vào bộ nhớ");
    const inputData = await fsp.readFile(inputPath);
    const inputBytes = inputData.length;
    logMemory(logger, "RAM sau khi đọc toàn bộ PDF đầu vào", { requestId, stage: "input-loaded", inputBytes });
    throwIfAborted(signal);

    if (options.targetBytes >= inputBytes) {
      await fsp.copyFile(inputPath, outputPath);
      return { inputBytes, outputBytes: inputBytes, targetBytes: options.targetBytes, pageCount: null, dpi: null, jpegQuality: null, reachedTarget: true, skipped: true, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    }

    logger?.info({ requestId }, "Mở tài liệu bằng MuPDF");
    document = mupdf.PDFDocument.openDocument(inputData, "application/pdf");
    logMemory(logger, "RAM sau khi mở tài liệu MuPDF", { requestId, stage: "mupdf-opened" });

    if (document.needsPassword()) throw new AppError("PDF đang được bảo vệ bằng mật khẩu.", 400, "PDF_PASSWORD_REQUIRED");

    const pageCount = document.countPages();
    logger?.info({ requestId, pageCount, inputBytes }, "Đã phân tích thông tin PDF");
    if (!Number.isInteger(pageCount) || pageCount <= 0) throw new AppError("PDF không có trang hợp lệ.", 400, "INVALID_PAGE_COUNT");
    if (pageCount > maxPageCount) throw new AppError(`PDF vượt quá giới hạn ${maxPageCount} trang.`, 413, "TOO_MANY_PAGES");

    const samplePages = selectSamplePages(pageCount);
    logger?.info({ requestId, samplePages }, "Bắt đầu thử cấu hình trên các trang mẫu");
    const selected = await chooseCompressionSettings(document, {
      samplePages,
      pageCount,
      inputBytes,
      options,
      onProgress,
      signal
    });
    logger?.info({ requestId, selected }, "Đã chọn cấu hình nén");
    logMemory(logger, "RAM sau khi chọn cấu hình nén", { requestId, stage: "settings-selected" });

    const allPages = Array.from({ length: pageCount }, (_, index) => index);
    let finalSettings = { dpi: selected.dpi, jpegQuality: selected.jpegQuality, colorMode: options.colorMode };
    logger?.info({ requestId, finalSettings, pageCount }, "Bắt đầu dựng toàn bộ PDF lần 1");
    let outputBytes = await buildRasterizedPdf(document, allPages, finalSettings, { onProgress, signal });
    logger?.info({ requestId, outputBytes: outputBytes.length, finalSettings }, "Dựng toàn bộ PDF lần 1 hoàn tất");
    logMemory(logger, "RAM sau khi dựng PDF lần 1", { requestId, stage: "full-build-1", outputBytes: outputBytes.length });

    if (outputBytes.length > options.targetBytes) {
      const retrySettings = calculateRetrySettings(finalSettings, outputBytes.length, options.targetBytes);
      if (retrySettings.dpi !== finalSettings.dpi || retrySettings.jpegQuality !== finalSettings.jpegQuality) {
        finalSettings = retrySettings;
        logger?.warn({ requestId, finalSettings, firstOutputBytes: outputBytes.length, targetBytes: options.targetBytes }, "Kết quả vượt mục tiêu, dựng lại PDF lần 2");
        outputBytes = await buildRasterizedPdf(document, allPages, finalSettings, { onProgress, signal });
        logger?.info({ requestId, outputBytes: outputBytes.length, finalSettings }, "Dựng toàn bộ PDF lần 2 hoàn tất");
        logMemory(logger, "RAM sau khi dựng PDF lần 2", { requestId, stage: "full-build-2", outputBytes: outputBytes.length });
      }
    }

    throwIfAborted(signal);
    await fsp.writeFile(outputPath, outputBytes);
    logger?.info({ requestId, outputPath, outputBytes: outputBytes.length }, "Đã ghi file PDF kết quả xuống ổ đĩa");
    onProgress?.({ stage: "completed", inputBytes, outputBytes: outputBytes.length, ...finalSettings });

    return {
      inputBytes,
      outputBytes: outputBytes.length,
      targetBytes: options.targetBytes,
      pageCount,
      dpi: finalSettings.dpi,
      jpegQuality: finalSettings.jpegQuality,
      reachedTarget: outputBytes.length <= options.targetBytes,
      skipped: false,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error({ requestId, error, elapsedMs: Math.round(performance.now() - startedAt) }, "Lỗi bên trong dịch vụ nén PDF");
    logMemory(logger, "RAM khi dịch vụ nén phát sinh lỗi", { requestId, stage: "service-error" }, "error");
    if (/password/i.test(message)) throw new AppError("PDF đang được bảo vệ bằng mật khẩu.", 400, "PDF_PASSWORD_REQUIRED");
    throw error;
  } finally {
    safeDestroy(document);
    logMemory(logger, "RAM sau khi đóng tài liệu MuPDF", { requestId, stage: "mupdf-destroyed" });
  }
}
