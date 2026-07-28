"use strict";

import * as mupdf from "mupdf";
import { PDFDocument } from "pdf-lib";
import { AppError } from "../../core/errors/app-error.js";
import {
  assertMemoryHeadroom,
  getMemorySnapshot
} from "../../core/monitoring/memory-monitor.js";
import { COMPRESSION_LIMITS } from "./compress-pdf.options.js";

function safeDestroy(value) {
  try {
    value?.destroy?.();
  } catch {
    // Không cần xử lý khi giải phóng tài nguyên thất bại.
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED");
  }
}

function isLowMemoryEnvironment() {
  const snapshot = getMemorySnapshot();
  return (
    snapshot.cgroupLimitMb !== null &&
    snapshot.cgroupLimitMb <= COMPRESSION_LIMITS.LOW_MEMORY_LIMIT_MB
  );
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

export function selectSamplePages(pageCount) {
  const preferredCount = isLowMemoryEnvironment()
    ? COMPRESSION_LIMITS.LOW_MEMORY_SAMPLE_PAGE_COUNT
    : COMPRESSION_LIMITS.SAMPLE_PAGE_COUNT;
  const count = Math.min(preferredCount, pageCount);

  if (count === 1) return [Math.floor((pageCount - 1) / 2)];
  if (count === pageCount) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  const positions = [
    0,
    Math.floor((pageCount - 1) * 0.25),
    Math.floor((pageCount - 1) * 0.5),
    Math.floor((pageCount - 1) * 0.75),
    pageCount - 1
  ];

  return [...new Set(positions)]
    .slice(0, count)
    .sort((a, b) => a - b);
}

export function buildAdaptiveCandidates({
  inputBytes,
  targetBytes,
  maxDpi,
  preferredQuality,
  mode
}) {
  const ratio = clamp(targetBytes / Math.max(1, inputBytes), 0.01, 1);
  const lowMemory = isLowMemoryEnvironment();
  const effectiveMaxDpi = lowMemory
    ? Math.min(maxDpi, COMPRESSION_LIMITS.LOW_MEMORY_MAX_DPI)
    : maxDpi;
  const candidateLimit = lowMemory
    ? COMPRESSION_LIMITS.LOW_MEMORY_MAX_CANDIDATE_COUNT
    : COMPRESSION_LIMITS.MAX_CANDIDATE_COUNT;

  const estimatedDpi = clamp(
    roundToStep(effectiveMaxDpi * Math.sqrt(ratio) * 1.28, 5),
    COMPRESSION_LIMITS.MIN_DPI,
    effectiveMaxDpi
  );

  const qualityFloor = mode === "image" ? 45 : mode === "balanced" ? 34 : 27;
  const baseQuality = clamp(
    preferredQuality,
    qualityFloor,
    COMPRESSION_LIMITS.MAX_JPEG_QUALITY
  );

  // Tạo lưới nhỏ có trọng tâm quanh cấu hình ước lượng.
  // Nhiều hơn bản cũ (6), nhưng không quay lại 90 tổ hợp gây chậm và tốn RAM.
  const dpiOffsets = lowMemory
    ? [20, 10, 0, -10, -20, -30]
    : [30, 20, 10, 0, -10, -20, -30, -40];
  const qualityOffsets = lowMemory
    ? [12, 6, 0, -6, -12]
    : [16, 10, 5, 0, -5, -10, -16];

  const unique = new Map();

  for (const dpiOffset of dpiOffsets) {
    for (const qualityOffset of qualityOffsets) {
      const dpi = clamp(
        roundToStep(estimatedDpi + dpiOffset, 5),
        COMPRESSION_LIMITS.MIN_DPI,
        effectiveMaxDpi
      );
      const jpegQuality = clamp(
        Math.round(baseQuality + qualityOffset),
        qualityFloor,
        COMPRESSION_LIMITS.MAX_JPEG_QUALITY
      );
      unique.set(`${dpi}:${jpegQuality}`, { dpi, jpegQuality });
    }
  }

  // Bổ sung một số điểm neo để tránh bị kẹt quanh ước lượng ban đầu.
  const anchors = [
    [effectiveMaxDpi, baseQuality],
    [135, 78],
    [125, 72],
    [115, 68],
    [105, 62],
    [95, 56],
    [85, 50],
    [75, 44],
    [60, qualityFloor]
  ];

  for (const [rawDpi, rawQuality] of anchors) {
    const dpi = clamp(
      roundToStep(rawDpi, 5),
      COMPRESSION_LIMITS.MIN_DPI,
      effectiveMaxDpi
    );
    const jpegQuality = clamp(
      Math.round(rawQuality),
      qualityFloor,
      COMPRESSION_LIMITS.MAX_JPEG_QUALITY
    );
    unique.set(`${dpi}:${jpegQuality}`, { dpi, jpegQuality });
  }

  // Ưu tiên các cấu hình gần vùng ước lượng, sau đó mới đến các điểm xa hơn.
  return [...unique.values()]
    .sort((a, b) => {
      const distanceA =
        Math.abs(a.dpi - estimatedDpi) * 1.8 +
        Math.abs(a.jpegQuality - baseQuality);
      const distanceB =
        Math.abs(b.dpi - estimatedDpi) * 1.8 +
        Math.abs(b.jpegQuality - baseQuality);
      return distanceA - distanceB;
    })
    .slice(0, candidateLimit);
}

function qualityScore(candidate, mode) {
  const weight = mode === "image" ? 1.08 : mode === "balanced" ? 0.9 : 0.72;
  return candidate.dpi * (candidate.jpegQuality / 100) ** weight;
}

function targetDistance(candidate, targetBytes) {
  return Math.abs(candidate.estimatedBytes - targetBytes) / Math.max(1, targetBytes);
}

function estimatePixmapMb(widthPoints, heightPoints, dpi, colorMode) {
  const widthPx = Math.ceil((widthPoints * dpi) / 72);
  const heightPx = Math.ceil((heightPoints * dpi) / 72);
  const channels = colorMode === "gray" ? 1 : 3;
  return (widthPx * heightPx * channels) / (1024 * 1024);
}

function renderPage(document, pageIndex, settings) {
  let page;
  let pixmap;

  try {
    assertMemoryHeadroom({
      minimumFreeMb: 96,
      maximumUsagePercent: 82,
      stage: `render-page-${pageIndex + 1}`
    });

    page = document.loadPage(pageIndex);
    const [x0, y0, x1, y1] = page.getBounds();
    const width = x1 - x0;
    const height = y1 - y0;
    const estimatedPixmapMb = estimatePixmapMb(
      width,
      height,
      settings.dpi,
      settings.colorMode
    );
    const snapshot = getMemorySnapshot();

    if (
      snapshot.cgroupFreeMb !== null &&
      estimatedPixmapMb * 2.5 > snapshot.cgroupFreeMb
    ) {
      throw new AppError(
        `Trang ${pageIndex + 1} cần quá nhiều RAM ở ${settings.dpi} DPI. Hãy giảm DPI hoặc chuyển sang thang xám.`,
        507,
        "PAGE_MEMORY_LIMIT"
      );
    }

    pixmap = page.toPixmap(
      mupdf.Matrix.scale(settings.dpi / 72, settings.dpi / 72),
      settings.colorMode === "gray"
        ? mupdf.ColorSpace.DeviceGray
        : mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );

    const jpegBytes = toUint8Array(pixmap.asJPEG(settings.jpegQuality));
    return { width, height, jpegBytes };
  } finally {
    safeDestroy(pixmap);
    safeDestroy(page);
  }
}

export async function buildRasterizedPdf(
  document,
  pageIndexes,
  settings,
  { onProgress, signal } = {}
) {
  assertMemoryHeadroom({
    minimumFreeMb: 128,
    maximumUsagePercent: 78,
    stage: "create-output-pdf"
  });

  const output = await PDFDocument.create();
  output.setTitle("PDF đã nén");
  output.setProducer("WEB TOOL PDF");

  for (let position = 0; position < pageIndexes.length; position += 1) {
    throwIfAborted(signal);
    const rendered = renderPage(document, pageIndexes[position], settings);
    const image = await output.embedJpg(rendered.jpegBytes);
    const outputPage = output.addPage([rendered.width, rendered.height]);
    outputPage.drawImage(image, {
      x: 0,
      y: 0,
      width: rendered.width,
      height: rendered.height
    });

    onProgress?.({
      stage: "rendering",
      currentPage: position + 1,
      totalPages: pageIndexes.length,
      ...settings
    });
  }

  throwIfAborted(signal);
  assertMemoryHeadroom({
    minimumFreeMb: 88,
    maximumUsagePercent: 84,
    stage: "save-output-pdf"
  });

  return output.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 25
  });
}

export async function chooseCompressionSettings(
  document,
  { samplePages, pageCount, inputBytes, options, onProgress, signal }
) {
  const candidates = buildAdaptiveCandidates({
    inputBytes,
    targetBytes: options.targetBytes,
    maxDpi: options.maxDpi,
    preferredQuality: options.jpegQuality,
    mode: options.mode
  });
  const evaluated = [];

  for (let index = 0; index < candidates.length; index += 1) {
    throwIfAborted(signal);
    assertMemoryHeadroom({
      minimumFreeMb: 120,
      maximumUsagePercent: 78,
      stage: `sample-${index + 1}`
    });

    const candidate = candidates[index];
    onProgress?.({
      stage: "sampling",
      candidateIndex: index + 1,
      candidateCount: candidates.length,
      ...candidate
    });

    let bytes = await buildRasterizedPdf(
      document,
      samplePages,
      { ...candidate, colorMode: options.colorMode },
      { signal }
    );

    // Giảm hệ số đệm từ 10% xuống 3% để không chọn cấu hình quá thấp.
    const estimatedBytes = Math.round(
      (bytes.length / samplePages.length) * pageCount * 1.03
    );
    evaluated.push({ ...candidate, estimatedBytes });

    bytes = null;
    if (typeof global.gc === "function") global.gc();
  }

  const lowerTarget = Math.floor(
    options.targetBytes * COMPRESSION_LIMITS.TARGET_LOWER_RATIO
  );
  const upperTarget = Math.floor(
    options.targetBytes * COMPRESSION_LIMITS.TARGET_UPPER_RATIO
  );

  const ideal = evaluated.filter(
    (candidate) =>
      candidate.estimatedBytes >= lowerTarget &&
      candidate.estimatedBytes <= upperTarget
  );

  if (ideal.length) {
    return ideal.sort((a, b) => {
      const distanceDifference =
        targetDistance(a, options.targetBytes) -
        targetDistance(b, options.targetBytes);
      if (Math.abs(distanceDifference) > 0.002) return distanceDifference;
      return qualityScore(b, options.mode) - qualityScore(a, options.mode);
    })[0];
  }

  const underTarget = evaluated.filter(
    (candidate) => candidate.estimatedBytes <= upperTarget
  );

  if (underTarget.length) {
    // Không chọn cấu hình chất lượng cao nhất một cách mù quáng.
    // Chọn cấu hình có kích thước ước lượng gần mục tiêu nhất trước.
    return underTarget.sort((a, b) => {
      const sizeDifference = b.estimatedBytes - a.estimatedBytes;
      if (Math.abs(sizeDifference) > options.targetBytes * 0.01) {
        return sizeDifference;
      }
      return qualityScore(b, options.mode) - qualityScore(a, options.mode);
    })[0];
  }

  // Nếu tất cả đều vượt mục tiêu, chọn cấu hình gần mục tiêu nhất thay vì nhỏ nhất tuyệt đối.
  return evaluated.sort((a, b) => {
    const distanceDifference =
      targetDistance(a, options.targetBytes) -
      targetDistance(b, options.targetBytes);
    if (Math.abs(distanceDifference) > 0.002) return distanceDifference;
    return qualityScore(b, options.mode) - qualityScore(a, options.mode);
  })[0];
}

export function calculateRefinementSettings(settings, outputBytes, targetBytes) {
  // Nhắm khoảng 98% mục tiêu để chừa sai số nhỏ và hạn chế vượt dung lượng.
  const desiredBytes = targetBytes * 0.98;
  const ratio = desiredBytes / Math.max(1, outputBytes);

  if (ratio > 1) {
    // File nhỏ hơn mục tiêu: tăng chất lượng có kiểm soát.
    return {
      ...settings,
      dpi: clamp(
        roundToStep(settings.dpi * Math.sqrt(ratio) * 0.985, 5),
        COMPRESSION_LIMITS.MIN_DPI,
        COMPRESSION_LIMITS.MAX_DPI
      ),
      jpegQuality: clamp(
        Math.round(settings.jpegQuality * Math.min(1.18, ratio ** 0.35)),
        COMPRESSION_LIMITS.MIN_JPEG_QUALITY,
        COMPRESSION_LIMITS.MAX_JPEG_QUALITY
      )
    };
  }

  // File vượt mục tiêu: giảm vừa đủ, không giảm quá sâu.
  const boundedRatio = clamp(ratio, 0.1, 1);
  return {
    ...settings,
    dpi: clamp(
      roundToStep(settings.dpi * Math.sqrt(boundedRatio) * 0.985, 5),
      COMPRESSION_LIMITS.MIN_DPI,
      COMPRESSION_LIMITS.MAX_DPI
    ),
    jpegQuality: clamp(
      Math.round(
        settings.jpegQuality * Math.max(0.76, boundedRatio ** 0.45) * 0.99
      ),
      COMPRESSION_LIMITS.MIN_JPEG_QUALITY,
      COMPRESSION_LIMITS.MAX_JPEG_QUALITY
    )
  };
}

// Giữ tên cũ để không làm lỗi các import cũ.
export const calculateRetrySettings = calculateRefinementSettings;

export { safeDestroy, throwIfAborted };
