"use strict";

import { AppError } from "../../core/errors/app-error.js";

export const COMPRESSION_LIMITS = Object.freeze({
  MIN_TARGET_BYTES: 200 * 1024,
  MAX_TARGET_BYTES: 500 * 1024 * 1024,
  MIN_DPI: 60,
  MAX_DPI: 220,
  MIN_JPEG_QUALITY: 25,
  MAX_JPEG_QUALITY: 90,
  SAMPLE_PAGE_COUNT: 2,
  MAX_CANDIDATE_COUNT: 6,
  LOW_MEMORY_LIMIT_MB: 768,
  LOW_MEMORY_MAX_DPI: 120,
  LOW_MEMORY_MIN_TARGET_RATIO: 0.08
});

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

export function validateCompressionOptions(rawOptions) {
  const targetBytes = Math.round(Number(rawOptions.targetBytes));
  if (!Number.isFinite(targetBytes) || targetBytes < COMPRESSION_LIMITS.MIN_TARGET_BYTES || targetBytes > COMPRESSION_LIMITS.MAX_TARGET_BYTES) {
    throw new AppError("Dung lượng mục tiêu phải từ 200 KB đến 500 MB.", 400, "INVALID_TARGET_SIZE");
  }

  return {
    targetBytes,
    mode: ["text", "balanced", "image"].includes(rawOptions.mode) ? rawOptions.mode : "balanced",
    colorMode: rawOptions.colorMode === "gray" ? "gray" : "color",
    maxDpi: clampInteger(rawOptions.maxDpi, COMPRESSION_LIMITS.MIN_DPI, COMPRESSION_LIMITS.MAX_DPI, 120),
    jpegQuality: clampInteger(rawOptions.jpegQuality, COMPRESSION_LIMITS.MIN_JPEG_QUALITY, COMPRESSION_LIMITS.MAX_JPEG_QUALITY, 65)
  };
}
