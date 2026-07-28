"use strict";

import { AppError } from "../../core/errors/app-error.js";

export const COMPRESSION_LIMITS = Object.freeze({
  MIN_TARGET_BYTES: 200 * 1024,
  MAX_TARGET_BYTES: 500 * 1024 * 1024,
  MIN_DPI: 60,
  MAX_DPI: 220,
  MIN_JPEG_QUALITY: 25,
  MAX_JPEG_QUALITY: 92,

  SAMPLE_PAGE_COUNT: 4,
  LOW_MEMORY_SAMPLE_PAGE_COUNT: 2,
  MAX_CANDIDATE_COUNT: 32,
  LOW_MEMORY_MAX_CANDIDATE_COUNT: 20,

  LOW_MEMORY_LIMIT_MB: 768,
  LOW_MEMORY_MAX_DPI: 145,
  LOW_MEMORY_MIN_TARGET_RATIO: 0.08,

  // Nhập 4 MB nghĩa là file phải <= 4 MB.
  // Vùng chất lượng mong muốn là 95–100%, tức khoảng 3,8–4,0 MB.
  TARGET_LOWER_RATIO: 0.95,
  TARGET_UPPER_RATIO: 1.0,
  REFINEMENT_TRIGGER_LOWER_RATIO: 0.94,
  REFINEMENT_TRIGGER_UPPER_RATIO: 1.0,
  REFINEMENT_TARGET_RATIO: 0.985,

  // Render Free tối đa 2 lần tinh chỉnh; VPS có thể thử 3 lần.
  MAX_REFINEMENT_ATTEMPTS: 3,
  LOW_MEMORY_MAX_REFINEMENT_ATTEMPTS: 2
});

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

export function validateCompressionOptions(rawOptions) {
  const targetBytes = Math.round(Number(rawOptions.targetBytes));

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
    mode: ["text", "balanced", "image"].includes(rawOptions.mode)
      ? rawOptions.mode
      : "balanced",
    colorMode: rawOptions.colorMode === "gray" ? "gray" : "color",
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
