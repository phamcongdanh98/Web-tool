"use strict";

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

const BYTES_PER_MB = 1024 * 1024;

function isLowMemoryServer(snapshot = getMemorySnapshot()) {
  return (
    snapshot.cgroupLimitMb !== null &&
    snapshot.cgroupLimitMb <=
      COMPRESSION_LIMITS.LOW_MEMORY_LIMIT_MB
  );
}

function validateLowMemoryRequest({
  inputBytes,
  options
}) {
  const snapshot = getMemorySnapshot();

  if (!isLowMemoryServer(snapshot)) {
    return;
  }

  const targetRatio =
    options.targetBytes / Math.max(1, inputBytes);

  if (
    targetRatio <
    COMPRESSION_LIMITS.LOW_MEMORY_MIN_TARGET_RATIO
  ) {
    const minimumTargetMb = Math.ceil(
      (
        inputBytes *
        COMPRESSION_LIMITS
          .LOW_MEMORY_MIN_TARGET_RATIO
      ) /
        BYTES_PER_MB
    );

    throw new AppError(
      `Mục tiêu nén quá thấp đối với máy chủ RAM ${snapshot.cgroupLimitMb} MB. ` +
        `Hãy chọn dung lượng mục tiêu ít nhất khoảng ${minimumTargetMb} MB.`,
      422,
      "TARGET_TOO_AGGRESSIVE"
    );
  }
}

function releaseOutputBytes() {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

function settingsAreDifferent(
  currentSettings,
  nextSettings
) {
  return (
    nextSettings.dpi !== currentSettings.dpi ||
    nextSettings.jpegQuality !==
      currentSettings.jpegQuality
  );
}

function getRefinementAttemptLimit(lowMemory) {
  return lowMemory
    ? COMPRESSION_LIMITS
        .LOW_MEMORY_MAX_REFINEMENT_ATTEMPTS
    : COMPRESSION_LIMITS.MAX_REFINEMENT_ATTEMPTS;
}

function getDesiredRefinementBytes(targetBytes) {
  return Math.floor(
    targetBytes *
      COMPRESSION_LIMITS.REFINEMENT_TARGET_RATIO
  );
}

function shouldRefineOutput({
  outputLength,
  targetBytes
}) {
  const sizeRatio =
    outputLength / Math.max(1, targetBytes);

  return {
    sizeRatio,
    isAboveTarget: outputLength > targetBytes,
    isTooSmall:
      sizeRatio <
      COMPRESSION_LIMITS
        .REFINEMENT_TRIGGER_LOWER_RATIO
  };
}

function assertRefinementMemory({
  lowMemory,
  attempt
}) {
  assertMemoryHeadroom({
    minimumFreeMb: lowMemory ? 90 : 160,
    maximumUsagePercent: lowMemory ? 82 : 72,
    stage: `before-refinement-${attempt}`
  });
}

/**
 * Tinh chỉnh kết quả để:
 *
 * - Không vượt quá dung lượng tối đa.
 * - Không thấp hơn mục tiêu quá nhiều nếu còn RAM.
 * - Ưu tiên khoảng 97–100% mục tiêu.
 */
async function refinePdfToTarget({
  document,
  allPages,
  initialBytes,
  initialSettings,
  options,
  onProgress,
  signal,
  logger,
  requestId
}) {
  let outputBytes = initialBytes;
  let finalSettings = {
    ...initialSettings
  };

  const lowMemory = isLowMemoryServer();
  const maxAttempts =
    getRefinementAttemptLimit(lowMemory);

  const targetBytes = options.targetBytes;
  const preferredMinimumBytes = Math.floor(
    targetBytes *
      COMPRESSION_LIMITS.TARGET_LOWER_RATIO
  );

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    throwIfAborted(signal);

    const currentLength = outputBytes.length;

    const {
      sizeRatio,
      isAboveTarget,
      isTooSmall
    } = shouldRefineOutput({
      outputLength: currentLength,
      targetBytes
    });

    /*
     * Kết quả đã nằm trong vùng mong muốn:
     * khoảng 97–100% mục tiêu.
     */
    if (
      currentLength <= targetBytes &&
      currentLength >= preferredMinimumBytes
    ) {
      logger?.info(
        {
          requestId,
          attempt,
          outputBytes: currentLength,
          targetBytes,
          sizeRatio: Number(
            sizeRatio.toFixed(4)
          ),
          finalSettings
        },
        "Kết quả PDF đã nằm trong vùng dung lượng mong muốn"
      );

      break;
    }

    /*
     * File đã dưới mục tiêu và không quá nhỏ.
     * Không cần dựng lại thêm.
     */
    if (!isAboveTarget && !isTooSmall) {
      break;
    }

    const desiredBytes =
      getDesiredRefinementBytes(targetBytes);

    const nextSettings =
      calculateRefinementSettings(
        finalSettings,
        currentLength,
        desiredBytes
      );

    if (
      !settingsAreDifferent(
        finalSettings,
        nextSettings
      )
    ) {
      logger?.warn(
        {
          requestId,
          attempt,
          outputBytes: currentLength,
          targetBytes,
          finalSettings
        },
        "Không thể thay đổi thêm cấu hình nén"
      );

      break;
    }

    const memoryBefore =
      getMemorySnapshot();

    /*
     * Trên máy RAM thấp, nếu RAM đã quá cao thì:
     * - Nếu file đã dưới mục tiêu: giữ kết quả hiện tại.
     * - Nếu file vẫn vượt mục tiêu: trả lỗi rõ ràng.
     */
    if (
      lowMemory &&
      memoryBefore.cgroupUsagePercent !== null &&
      memoryBefore.cgroupUsagePercent > 82
    ) {
      if (currentLength <= targetBytes) {
        logger?.warn(
          {
            requestId,
            attempt,
            outputBytes: currentLength,
            targetBytes,
            memory: memoryBefore
          },
          "RAM không đủ để tăng thêm chất lượng; giữ kết quả hiện tại"
        );

        break;
      }

      throw new AppError(
        "Máy chủ không còn đủ RAM để đưa PDF xuống dưới dung lượng tối đa. " +
          "Hãy giảm DPI, giảm chất lượng JPEG hoặc chuyển sang thang xám.",
        507,
        "INSUFFICIENT_MEMORY_FOR_TARGET"
      );
    }

    /*
     * Xóa kết quả lần trước khỏi RAM trước khi
     * dựng lại toàn bộ PDF.
     */
    outputBytes = null;
    releaseOutputBytes();

    assertRefinementMemory({
      lowMemory,
      attempt
    });

    finalSettings = nextSettings;

    logger?.warn(
      {
        requestId,
        attempt,
        maxAttempts,
        previousBytes: currentLength,
        targetBytes,
        desiredBytes,
        sizeRatio: Number(
          sizeRatio.toFixed(4)
        ),
        finalSettings,
        lowMemory
      },
      isAboveTarget
        ? "PDF vượt dung lượng tối đa, đang dựng lại với cấu hình nhẹ hơn"
        : "PDF thấp hơn mục tiêu quá nhiều, đang dựng lại để tăng chất lượng"
    );

    outputBytes =
      await buildRasterizedPdf(
        document,
        allPages,
        finalSettings,
        {
          onProgress,
          signal
        }
      );

    logger?.info(
      {
        requestId,
        attempt,
        outputBytes: outputBytes.length,
        targetBytes,
        finalSettings
      },
      "Hoàn tất một lần tinh chỉnh dung lượng PDF"
    );

    logMemory(
      logger,
      "RAM sau khi tinh chỉnh PDF",
      {
        requestId,
        attempt,
        stage: `refinement-${attempt}`,
        outputBytes: outputBytes.length
      }
    );
  }

  /*
   * Mục tiêu là trần cứng.
   * Không trả file lớn hơn dung lượng người dùng nhập.
   */
  if (outputBytes.length > targetBytes) {
    throw new AppError(
      `Không thể đưa PDF xuống dưới ${(
        targetBytes / BYTES_PER_MB
      ).toFixed(2)} MB với cấu hình hiện tại. ` +
        "Hãy giảm DPI, giảm chất lượng JPEG hoặc chọn thang xám.",
      422,
      "TARGET_NOT_REACHED"
    );
  }

  return {
    outputBytes,
    finalSettings
  };
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
  const options =
    validateCompressionOptions(rawOptions);

  let document;
  let outputBytes;

  try {
    const inputStat =
      await fsp.stat(inputPath);

    const inputBytes = inputStat.size;

    validateLowMemoryRequest({
      inputBytes,
      options
    });

    throwIfAborted(signal);

    /*
     * File đã nhỏ hơn giới hạn người dùng nhập.
     * Không nén lại để tránh giảm chất lượng.
     */
    if (
      options.targetBytes >= inputBytes
    ) {
      await fsp.copyFile(
        inputPath,
        outputPath
      );

      return {
        inputBytes,
        outputBytes: inputBytes,
        targetBytes: options.targetBytes,
        pageCount: null,
        dpi: null,
        jpegQuality: null,
        reachedTarget: true,
        skipped: true,
        durationMs: Math.max(
          0,
          Math.round(
            performance.now() - startedAt
          )
        )
      };
    }

    assertMemoryHeadroom({
      minimumFreeMb: 160,
      maximumUsagePercent: 68,
      stage: "before-open-mupdf"
    });

    logger?.info(
      {
        requestId,
        inputPath,
        inputBytes,
        targetBytes: options.targetBytes
      },
      "Mở trực tiếp file PDF bằng MuPDF"
    );

    document =
      mupdf.PDFDocument.openDocument(
        inputPath,
        "application/pdf"
      );

    logMemory(
      logger,
      "RAM sau khi mở tài liệu MuPDF",
      {
        requestId,
        stage: "mupdf-opened"
      }
    );

    if (document.needsPassword()) {
      throw new AppError(
        "PDF đang được bảo vệ bằng mật khẩu.",
        400,
        "PDF_PASSWORD_REQUIRED"
      );
    }

    const pageCount =
      document.countPages();

    logger?.info(
      {
        requestId,
        pageCount,
        inputBytes
      },
      "Đã phân tích thông tin PDF"
    );

    if (
      !Number.isInteger(pageCount) ||
      pageCount <= 0
    ) {
      throw new AppError(
        "PDF không có trang hợp lệ.",
        400,
        "INVALID_PAGE_COUNT"
      );
    }

    if (pageCount > maxPageCount) {
      throw new AppError(
        `PDF vượt quá giới hạn ${maxPageCount} trang.`,
        413,
        "TOO_MANY_PAGES"
      );
    }

    const samplePages =
      selectSamplePages(pageCount);

    logger?.info(
      {
        requestId,
        samplePages
      },
      "Bắt đầu thử cấu hình trên các trang mẫu"
    );

    const selected =
      await chooseCompressionSettings(
        document,
        {
          samplePages,
          pageCount,
          inputBytes,
          options,
          onProgress,
          signal
        }
      );

    logger?.info(
      {
        requestId,
        selected
      },
      "Đã chọn cấu hình nén ban đầu"
    );

    logMemory(
      logger,
      "RAM sau khi chọn cấu hình nén",
      {
        requestId,
        stage: "settings-selected"
      }
    );

    const allPages = Array.from(
      {
        length: pageCount
      },
      (_, index) => index
    );

    let finalSettings = {
      dpi: selected.dpi,
      jpegQuality:
        selected.jpegQuality,
      colorMode: options.colorMode
    };

    logger?.info(
      {
        requestId,
        finalSettings,
        pageCount,
        targetBytes: options.targetBytes
      },
      "Bắt đầu dựng toàn bộ PDF"
    );

    outputBytes =
      await buildRasterizedPdf(
        document,
        allPages,
        finalSettings,
        {
          onProgress,
          signal
        }
      );

    logger?.info(
      {
        requestId,
        outputBytes: outputBytes.length,
        targetBytes: options.targetBytes,
        finalSettings
      },
      "Dựng toàn bộ PDF lần đầu hoàn tất"
    );

    logMemory(
      logger,
      "RAM sau khi dựng PDF lần đầu",
      {
        requestId,
        stage: "full-build",
        outputBytes: outputBytes.length
      }
    );

    /*
     * Tinh chỉnh để:
     * - Không vượt dung lượng tối đa.
     * - Không thấp hơn mục tiêu quá nhiều.
     */
    const refined =
      await refinePdfToTarget({
        document,
        allPages,
        initialBytes: outputBytes,
        initialSettings: finalSettings,
        options,
        onProgress,
        signal,
        logger,
        requestId
      });

    outputBytes = refined.outputBytes;
    finalSettings =
      refined.finalSettings;

    throwIfAborted(signal);

    assertMemoryHeadroom({
      minimumFreeMb: 64,
      maximumUsagePercent: 88,
      stage: "write-output"
    });

    await fsp.writeFile(
      outputPath,
      outputBytes
    );

    const resultLength =
      outputBytes.length;

    outputBytes = null;
    releaseOutputBytes();

    logger?.info(
      {
        requestId,
        outputPath,
        outputBytes: resultLength,
        targetBytes: options.targetBytes,
        finalSettings
      },
      "Đã ghi file PDF kết quả xuống ổ đĩa"
    );

    onProgress?.({
      stage: "completed",
      inputBytes,
      outputBytes: resultLength,
      targetBytes: options.targetBytes,
      ...finalSettings
    });

    return {
      inputBytes,
      outputBytes: resultLength,
      targetBytes: options.targetBytes,
      pageCount,
      dpi: finalSettings.dpi,
      jpegQuality:
        finalSettings.jpegQuality,
      reachedTarget:
        resultLength <=
        options.targetBytes,
      skipped: false,
      durationMs: Math.max(
        0,
        Math.round(
          performance.now() - startedAt
        )
      )
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    logger?.error(
      {
        requestId,
        error,
        elapsedMs: Math.round(
          performance.now() - startedAt
        )
      },
      "Lỗi bên trong dịch vụ nén PDF"
    );

    logMemory(
      logger,
      "RAM khi dịch vụ nén phát sinh lỗi",
      {
        requestId,
        stage: "service-error"
      },
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
    outputBytes = null;

    safeDestroy(document);

    releaseOutputBytes();

    logMemory(
      logger,
      "RAM sau khi đóng tài liệu MuPDF",
      {
        requestId,
        stage: "mupdf-destroyed"
      }
    );
  }
}