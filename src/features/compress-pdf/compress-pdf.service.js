"use strict";

import fsp from "node:fs/promises";
import * as mupdf from "mupdf";
import { AppError } from "../../core/errors/app-error.js";
import { assertMemoryHeadroom, getMemorySnapshot, logMemory } from "../../core/monitoring/memory-monitor.js";
import { COMPRESSION_LIMITS, validateCompressionOptions } from "./compress-pdf.options.js";
import {
  buildRasterizedPdf,
  calculateRefinementSettings,
  chooseCompressionSettings,
  safeDestroy,
  selectSamplePages,
  throwIfAborted
} from "./compression-engine.js";

function validateLowMemoryRequest({ inputBytes, options }) {
  const snapshot = getMemorySnapshot();
  const lowMemory = snapshot.cgroupLimitMb !== null && snapshot.cgroupLimitMb <= COMPRESSION_LIMITS.LOW_MEMORY_LIMIT_MB;
  if (!lowMemory) return;

  const targetRatio = options.targetBytes / Math.max(1, inputBytes);
  if (targetRatio < COMPRESSION_LIMITS.LOW_MEMORY_MIN_TARGET_RATIO) {
    throw new AppError(
      `Mục tiêu nén quá thấp đối với máy chủ RAM ${snapshot.cgroupLimitMb} MB. Hãy chọn dung lượng mục tiêu ít nhất khoảng ${Math.ceil((inputBytes * COMPRESSION_LIMITS.LOW_MEMORY_MIN_TARGET_RATIO) / 1024 / 1024)} MB.`,
      422,
      "TARGET_TOO_AGGRESSIVE"
    );
  }
}

export async function compressPdfInProcess({ inputPath, outputPath, maxPageCount, onProgress, signal, logger, requestId, ...rawOptions }) {
  const startedAt = performance.now();
  const options = validateCompressionOptions(rawOptions);
  let document;
  let outputBytes;

  try {
    const inputStat = await fsp.stat(inputPath);
    const inputBytes = inputStat.size;
    validateLowMemoryRequest({ inputBytes, options });
    throwIfAborted(signal);

    if (options.targetBytes >= inputBytes) {
      await fsp.copyFile(inputPath, outputPath);
      return { inputBytes, outputBytes: inputBytes, targetBytes: options.targetBytes, pageCount: null, dpi: null, jpegQuality: null, reachedTarget: true, skipped: true, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    }

    assertMemoryHeadroom({ minimumFreeMb: 160, maximumUsagePercent: 68, stage: "before-open-mupdf" });
    logger?.info({ requestId, inputPath, inputBytes }, "Mở trực tiếp file PDF bằng MuPDF, không tạo Buffer toàn bộ file");
    document = mupdf.PDFDocument.openDocument(inputPath, "application/pdf");
    logMemory(logger, "RAM sau khi mở tài liệu MuPDF từ đường dẫn", { requestId, stage: "mupdf-opened" });

    if (document.needsPassword()) throw new AppError("PDF đang được bảo vệ bằng mật khẩu.", 400, "PDF_PASSWORD_REQUIRED");

    const pageCount = document.countPages();
    logger?.info({ requestId, pageCount, inputBytes }, "Đã phân tích thông tin PDF");
    if (!Number.isInteger(pageCount) || pageCount <= 0) throw new AppError("PDF không có trang hợp lệ.", 400, "INVALID_PAGE_COUNT");
    if (pageCount > maxPageCount) throw new AppError(`PDF vượt quá giới hạn ${maxPageCount} trang.`, 413, "TOO_MANY_PAGES");

    const samplePages = selectSamplePages(pageCount);
    logger?.info({ requestId, samplePages }, "Bắt đầu thử cấu hình trên số trang mẫu đã giảm");
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
    logger?.info({ requestId, finalSettings, pageCount }, "Bắt đầu dựng toàn bộ PDF");
    outputBytes = await buildRasterizedPdf(document, allPages, finalSettings, { onProgress, signal });
    logger?.info({ requestId, outputBytes: outputBytes.length, finalSettings }, "Dựng toàn bộ PDF hoàn tất");
    logMemory(logger, "RAM sau khi dựng PDF", { requestId, stage: "full-build", outputBytes: outputBytes.length });

    const firstBuildLength = outputBytes.length;
    const sizeRatio = firstBuildLength / Math.max(1, options.targetBytes);
    const memory = getMemorySnapshot();
    const lowMemory =
      memory.cgroupLimitMb !== null &&
      memory.cgroupLimitMb <= COMPRESSION_LIMITS.LOW_MEMORY_LIMIT_MB;
    const needsRefinement =
      sizeRatio < COMPRESSION_LIMITS.REFINEMENT_TRIGGER_LOWER_RATIO ||
      sizeRatio > COMPRESSION_LIMITS.REFINEMENT_TRIGGER_UPPER_RATIO;

    if (needsRefinement) {
      const refinedSettings = calculateRefinementSettings(
        finalSettings,
        firstBuildLength,
        options.targetBytes
      );
      const settingsChanged =
        refinedSettings.dpi !== finalSettings.dpi ||
        refinedSettings.jpegQuality !== finalSettings.jpegQuality;

      if (settingsChanged) {
        const beforeRefinement = getMemorySnapshot();
        const canRefineOnLowMemory =
          beforeRefinement.cgroupFreeMb === null ||
          (beforeRefinement.cgroupFreeMb >= 140 &&
            (beforeRefinement.cgroupUsagePercent === null ||
              beforeRefinement.cgroupUsagePercent <= 73));

        if (!lowMemory || canRefineOnLowMemory) {
          outputBytes = null;
          if (typeof global.gc === "function") global.gc();

          assertMemoryHeadroom({
            minimumFreeMb: lowMemory ? 128 : 180,
            maximumUsagePercent: lowMemory ? 76 : 68,
            stage: "before-refinement"
          });

          finalSettings = refinedSettings;
          logger?.warn(
            {
              requestId,
              firstBuildBytes: firstBuildLength,
              targetBytes: options.targetBytes,
              sizeRatio: Number(sizeRatio.toFixed(3)),
              finalSettings,
              lowMemory
            },
            sizeRatio < 1
              ? "Kết quả thấp hơn mục tiêu, dựng lại một lần để tăng chất lượng"
              : "Kết quả vượt mục tiêu, dựng lại một lần để bám sát dung lượng"
          );

          outputBytes = await buildRasterizedPdf(
            document,
            allPages,
            finalSettings,
            { onProgress, signal }
          );
        } else {
          logger?.warn(
            {
              requestId,
              firstBuildBytes: firstBuildLength,
              targetBytes: options.targetBytes,
              memory: beforeRefinement
            },
            "Không đủ khoảng trống RAM để tinh chỉnh lần hai; giữ kết quả lần đầu"
          );
        }
      }
    }

    throwIfAborted(signal);
    assertMemoryHeadroom({ minimumFreeMb: 64, maximumUsagePercent: 88, stage: "write-output" });
    await fsp.writeFile(outputPath, outputBytes);
    const resultLength = outputBytes.length;
    outputBytes = null;
    if (typeof global.gc === "function") global.gc();
    logger?.info({ requestId, outputPath, outputBytes: resultLength }, "Đã ghi file PDF kết quả xuống ổ đĩa");
    onProgress?.({ stage: "completed", inputBytes, outputBytes: resultLength, ...finalSettings });

    return {
      inputBytes,
      outputBytes: resultLength,
      targetBytes: options.targetBytes,
      pageCount,
      dpi: finalSettings.dpi,
      jpegQuality: finalSettings.jpegQuality,
      reachedTarget: resultLength <= options.targetBytes,
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
    outputBytes = null;
    safeDestroy(document);
    if (typeof global.gc === "function") global.gc();
    logMemory(logger, "RAM sau khi đóng tài liệu MuPDF", { requestId, stage: "mupdf-destroyed" });
  }
}
