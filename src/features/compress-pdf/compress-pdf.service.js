"use strict";

import path from "node:path";
import fsp from "node:fs/promises";
import * as mupdf from "mupdf";
import { AppError } from "../../core/errors/app-error.js";
import {
  assertMemoryHeadroom,
  getMemorySnapshot,
  logMemory
} from "../../core/monitoring/memory-monitor.js";
import {
  COMPRESSION_LIMITS,
  validateCompressionOptions
} from "./compress-pdf.options.js";
import {
  buildRasterizedPdf,
  calculateRefinementSettings,
  chooseCompressionSettings,
  safeDestroy,
  selectSamplePages,
  throwIfAborted
} from "./compression-engine.js";

const MB = 1024 * 1024;

function isLowMemory(snapshot = getMemorySnapshot()) {
  return (
    snapshot.cgroupLimitMb !== null &&
    snapshot.cgroupLimitMb <= COMPRESSION_LIMITS.LOW_MEMORY_LIMIT_MB
  );
}

function validateLowMemoryRequest({ inputBytes, options }) {
  const snapshot = getMemorySnapshot();
  if (!isLowMemory(snapshot)) return;

  const targetRatio = options.targetBytes / Math.max(1, inputBytes);
  if (targetRatio < COMPRESSION_LIMITS.LOW_MEMORY_MIN_TARGET_RATIO) {
    const minimumMb = Math.ceil(
      (inputBytes * COMPRESSION_LIMITS.LOW_MEMORY_MIN_TARGET_RATIO) / MB
    );
    throw new AppError(
      `Mục tiêu nén quá thấp đối với máy chủ RAM ${snapshot.cgroupLimitMb} MB. ` +
        `Hãy chọn dung lượng tối đa ít nhất khoảng ${minimumMb} MB.`,
      422,
      "TARGET_TOO_AGGRESSIVE"
    );
  }
}

function settingsChanged(a, b) {
  return a.dpi !== b.dpi || a.jpegQuality !== b.jpegQuality;
}

function forceGc() {
  if (typeof global.gc === "function") global.gc();
}

async function removeSafe(filePath) {
  try {
    await fsp.rm(filePath, { force: true });
  } catch {
    // Bỏ qua lỗi dọn file tạm.
  }
}

/**
 * Dựng và hiệu chỉnh theo kết quả thật.
 * Luôn lưu bản tốt nhất <= mục tiêu xuống ổ đĩa để không giữ nhiều PDF trong RAM.
 */
async function buildClosestUnderTarget({
  document,
  allPages,
  initialSettings,
  inputBytes,
  outputPath,
  options,
  onProgress,
  signal,
  logger,
  requestId
}) {
  const lowMemory = isLowMemory();
  const maxRefinements = lowMemory
    ? COMPRESSION_LIMITS.LOW_MEMORY_MAX_REFINEMENT_ATTEMPTS
    : COMPRESSION_LIMITS.MAX_REFINEMENT_ATTEMPTS;
  const lowerBound = Math.floor(
    options.targetBytes * COMPRESSION_LIMITS.TARGET_LOWER_RATIO
  );
  const bestPath = `${outputPath}.best-${process.pid}.tmp`;

  let settings = { ...initialSettings };
  let previousDirection = null;
  let bestBytes = null;
  let bestSettings = null;
  let lastLength = null;

  await removeSafe(bestPath);

  try {
    for (let attempt = 0; attempt <= maxRefinements; attempt += 1) {
      throwIfAborted(signal);

      logger?.info(
        { requestId, attempt: attempt + 1, settings, targetBytes: options.targetBytes },
        attempt === 0
          ? "Bắt đầu dựng PDF lần đầu"
          : "Bắt đầu dựng PDF tinh chỉnh"
      );

      let bytes = await buildRasterizedPdf(document, allPages, settings, {
        onProgress,
        signal
      });
      const length = bytes.length;
      lastLength = length;

      logger?.info(
        {
          requestId,
          attempt: attempt + 1,
          outputBytes: length,
          outputMb: Number((length / MB).toFixed(2)),
          targetBytes: options.targetBytes,
          targetMb: Number((options.targetBytes / MB).toFixed(2)),
          settings
        },
        "Hoàn tất một lần dựng PDF"
      );

      // Chỉ giữ bản không vượt trần và gần trần nhất.
      if (length <= options.targetBytes && (bestBytes === null || length > bestBytes)) {
        await fsp.writeFile(bestPath, bytes);
        bestBytes = length;
        bestSettings = { ...settings };
      }

      // Đã nằm trong vùng 95–100%: đây là kết quả mong muốn.
      if (length <= options.targetBytes && length >= lowerBound) {
        await fsp.writeFile(outputPath, bytes);
        bytes = null;
        forceGc();
        return {
          outputBytes: length,
          finalSettings: { ...settings },
          reachedTarget: true,
          closeToTarget: true
        };
      }

      if (attempt >= maxRefinements) {
        bytes = null;
        forceGc();
        break;
      }

      const direction = length > options.targetBytes ? "down" : "up";
      const nextSettings = calculateRefinementSettings(
        settings,
        length,
        options.targetBytes,
        {
          mode: options.mode,
          previousDirection
        }
      );

      bytes = null;
      forceGc();

      if (!settingsChanged(settings, nextSettings)) break;

      const snapshot = getMemorySnapshot();
      if (
        lowMemory &&
        snapshot.cgroupUsagePercent !== null &&
        snapshot.cgroupUsagePercent > 80
      ) {
        logger?.warn(
          { requestId, snapshot, bestBytes, lastLength },
          "Dừng tinh chỉnh vì RAM đang cao; sử dụng bản tốt nhất đã lưu"
        );
        break;
      }

      assertMemoryHeadroom({
        minimumFreeMb: lowMemory ? 90 : 150,
        maximumUsagePercent: lowMemory ? 82 : 74,
        stage: `before-refinement-${attempt + 1}`
      });

      logger?.warn(
        {
          requestId,
          attempt: attempt + 1,
          previousBytes: length,
          targetBytes: options.targetBytes,
          direction,
          currentSettings: settings,
          nextSettings
        },
        direction === "up"
          ? "Kết quả còn thấp, tăng chất lượng để tiến gần dung lượng tối đa"
          : "Kết quả vượt trần, giảm nhẹ cấu hình để xuống dưới dung lượng tối đa"
      );

      settings = nextSettings;
      previousDirection = direction;
    }

    if (bestBytes !== null) {
      await fsp.copyFile(bestPath, outputPath);
      return {
        outputBytes: bestBytes,
        finalSettings: bestSettings,
        reachedTarget: true,
        closeToTarget: bestBytes >= lowerBound
      };
    }

    throw new AppError(
      `Không thể đưa PDF xuống dưới ${(options.targetBytes / MB).toFixed(2)} MB ` +
        "với giới hạn RAM hiện tại. Hãy giảm DPI, giảm JPEG hoặc chọn thang xám.",
      422,
      "TARGET_NOT_REACHED"
    );
  } finally {
    await removeSafe(bestPath);
  }
}

export async function compressPdfInProcess({
  inputPath,
  outputPath,
  maxPageCount,
  onProgress,
  signal,
  logger,
  requestId,
  ...rawOptions
}) {
  const startedAt = performance.now();
  const options = validateCompressionOptions(rawOptions);
  let document;

  try {
    const inputStat = await fsp.stat(inputPath);
    const inputBytes = inputStat.size;
    validateLowMemoryRequest({ inputBytes, options });
    throwIfAborted(signal);

    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    if (options.targetBytes >= inputBytes) {
      await fsp.copyFile(inputPath, outputPath);
      return {
        inputBytes,
        outputBytes: inputBytes,
        targetBytes: options.targetBytes,
        pageCount: null,
        dpi: null,
        jpegQuality: null,
        reachedTarget: true,
        closeToTarget: true,
        skipped: true,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt))
      };
    }

    assertMemoryHeadroom({
      minimumFreeMb: 150,
      maximumUsagePercent: 70,
      stage: "before-open-mupdf"
    });

    document = mupdf.PDFDocument.openDocument(inputPath, "application/pdf");
    logMemory(logger, "RAM sau khi mở tài liệu MuPDF", {
      requestId,
      stage: "mupdf-opened"
    });

    if (document.needsPassword()) {
      throw new AppError(
        "PDF đang được bảo vệ bằng mật khẩu.",
        400,
        "PDF_PASSWORD_REQUIRED"
      );
    }

    const pageCount = document.countPages();
    if (!Number.isInteger(pageCount) || pageCount <= 0) {
      throw new AppError("PDF không có trang hợp lệ.", 400, "INVALID_PAGE_COUNT");
    }
    if (pageCount > maxPageCount) {
      throw new AppError(
        `PDF vượt quá giới hạn ${maxPageCount} trang.`,
        413,
        "TOO_MANY_PAGES"
      );
    }

    const samplePages = selectSamplePages(pageCount);
    const selected = await chooseCompressionSettings(document, {
      samplePages,
      pageCount,
      inputBytes,
      options,
      onProgress,
      signal
    });

    logger?.info(
      { requestId, selected, samplePages },
      "Đã chọn cấu hình ban đầu từ trang mẫu"
    );

    const allPages = Array.from({ length: pageCount }, (_, index) => index);
    const built = await buildClosestUnderTarget({
      document,
      allPages,
      initialSettings: {
        dpi: selected.dpi,
        jpegQuality: selected.jpegQuality,
        colorMode: options.colorMode
      },
      inputBytes,
      outputPath,
      options,
      onProgress,
      signal,
      logger,
      requestId
    });

    onProgress?.({
      stage: "completed",
      inputBytes,
      outputBytes: built.outputBytes,
      targetBytes: options.targetBytes,
      ...built.finalSettings
    });

    return {
      inputBytes,
      outputBytes: built.outputBytes,
      targetBytes: options.targetBytes,
      pageCount,
      dpi: built.finalSettings.dpi,
      jpegQuality: built.finalSettings.jpegQuality,
      reachedTarget: built.reachedTarget,
      closeToTarget: built.closeToTarget,
      skipped: false,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt))
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(
      {
        requestId,
        error,
        elapsedMs: Math.round(performance.now() - startedAt)
      },
      "Lỗi bên trong dịch vụ nén PDF"
    );
    logMemory(
      logger,
      "RAM khi dịch vụ nén phát sinh lỗi",
      { requestId, stage: "service-error" },
      "error"
    );
    if (/password/i.test(message)) {
      throw new AppError(
        "PDF đang được bảo vệ bằng mật khẩu.",
        400,
        "PDF_PASSWORD_REQUIRED"
      );
    }
    throw error;
  } finally {
    safeDestroy(document);
    forceGc();
    logMemory(logger, "RAM sau khi đóng tài liệu MuPDF", {
      requestId,
      stage: "mupdf-destroyed"
    });
  }
}
