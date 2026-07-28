"use strict";

import { AppError } from "../../core/errors/app-error.js";

export const COMPRESSION_LIMITS = Object.freeze({
  MIN_TARGET_BYTES: 200 * 1024,
  MAX_TARGET_BYTES: 500 * 1024 * 1024,

  MIN_DPI: 60,
  MAX_DPI: 220,

  MIN_JPEG_QUALITY: 25,
  MAX_JPEG_QUALITY: 92,

  /*
   * Số trang mẫu dùng để ước lượng dung lượng.
   * Máy RAM thấp dùng ít trang hơn để hạn chế tải RAM.
   */
  SAMPLE_PAGE_COUNT: 3,
  LOW_MEMORY_SAMPLE_PAGE_COUNT: 2,

  /*
   * Số cấu hình DPI/JPEG tối đa được thử.
   * Không quay lại 90 cấu hình vì quá chậm.
   */
  MAX_CANDIDATE_COUNT: 24,
  LOW_MEMORY_MAX_CANDIDATE_COUNT: 16,

  /*
   * Giới hạn riêng cho máy chủ RAM thấp.
   */
  LOW_MEMORY_LIMIT_MB: 768,
  LOW_MEMORY_MAX_DPI: 135,
  LOW_MEMORY_MIN_TARGET_RATIO: 0.08,

  /*
   * Dung lượng người dùng nhập được xem là GIỚI HẠN TỐI ĐA.
   *
   * Ví dụ nhập 4 MB:
   * - Kết quả mong muốn: khoảng 3,88–4,00 MB.
   * - Không chấp nhận file lớn hơn 4 MB.
   */
  TARGET_LOWER_RATIO: 0.97,
  TARGET_UPPER_RATIO: 1.0,

  /*
   * Kích hoạt tinh chỉnh nếu:
   * - Kết quả thấp hơn 94% mục tiêu: tăng chất lượng.
   * - Kết quả lớn hơn mục tiêu: giảm nhẹ DPI/JPEG.
   */
  REFINEMENT_TRIGGER_LOWER_RATIO: 0.94,
  REFINEMENT_TRIGGER_UPPER_RATIO: 1.0,

  /*
   * Dung lượng mà lần tinh chỉnh nên nhắm tới.
   * Dùng 98% để chừa một ít sai số.
   *
   * Ví dụ mục tiêu 4 MB:
   * 4 × 98% = 3,92 MB.
   */
  REFINEMENT_TARGET_RATIO: 0.98,

  /*
   * Số lần được phép dựng lại PDF.
   */
  MAX_REFINEMENT_ATTEMPTS: 3,
  LOW_MEMORY_MAX_REFINEMENT_ATTEMPTS: 2
});

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(
    minimum,
    Math.min(maximum, Math.round(number))
  );
}

export function validateCompressionOptions(rawOptions) {
  const targetBytes = Math.round(
    Number(rawOptions.targetBytes)
  );

  if (
    !Number.isFinite(targetBytes) ||
    targetBytes < COMPRESSION_LIMITS.MIN_TARGET_BYTES ||
    targetBytes > COMPRESSION_LIMITS.MAX_TARGET_BYTES
  ) {
    throw new AppError(
      "Dung lượng tối đa phải từ 200 KB đến 500 MB.",
      400,
      "INVALID_TARGET_SIZE"
    );
  }

  return {
    targetBytes,

    mode: ["text", "balanced", "image"].includes(
      rawOptions.mode
    )
      ? rawOptions.mode
      : "balanced",

    colorMode:
      rawOptions.colorMode === "gray"
        ? "gray"
        : "color",

    maxDpi: clampInteger(
      rawOptions.maxDpi,
      COMPRESSION_LIMITS.MIN_DPI,
      COMPRESSION_LIMITS.MAX_DPI,
      120
    ),

    jpegQuality: clampInteger(
      rawOptions.jpegQuality,
      COMPRESSION_LIMITS.MIN_JPEG_QUALITY,
      COMPRESSION_LIMITS.MAX_JPEG_QUALITY,
      68
    )
  };
}