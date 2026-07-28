"use strict";

import * as mupdf from "mupdf";
import { PDFDocument } from "pdf-lib";
import { AppError } from "../../core/errors/app-error.js";
import { assertMemoryHeadroom, getMemorySnapshot } from "../../core/monitoring/memory-monitor.js";
import { COMPRESSION_LIMITS } from "./compress-pdf.options.js";

function safeDestroy(value) {
  try { value?.destroy?.(); } catch { /* không cần xử lý */ }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AppError("Tác vụ đã bị hủy.", 499, "JOB_ABORTED");
}

function isLowMemoryEnvironment() {
  const snapshot = getMemorySnapshot();
  return snapshot.cgroupLimitMb !== null && snapshot.cgroupLimitMb <= COMPRESSION_LIMITS.LOW_MEMORY_LIMIT_MB;
}

export function selectSamplePages(pageCount) {
  const preferredCount = isLowMemoryEnvironment() ? 1 : COMPRESSION_LIMITS.SAMPLE_PAGE_COUNT;
  const count = Math.min(preferredCount, pageCount);
  if (count === 1) return [Math.floor((pageCount - 1) / 2)];
  if (count === pageCount) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set([0, Math.floor((pageCount - 1) / 2), pageCount - 1])]
    .slice(0, count)
    .sort((a, b) => a - b);
}

export function buildAdaptiveCandidates({ inputBytes, targetBytes, maxDpi, preferredQuality, mode }) {
  const ratio = Math.min(1, targetBytes / Math.max(1, inputBytes));
  const lowMemory = isLowMemoryEnvironment();
  const effectiveMaxDpi = lowMemory
    ? Math.min(maxDpi, COMPRESSION_LIMITS.LOW_MEMORY_MAX_DPI)
    : maxDpi;
  const estimatedDpi = Math.max(
    COMPRESSION_LIMITS.MIN_DPI,
    Math.min(effectiveMaxDpi, Math.round(effectiveMaxDpi * Math.sqrt(ratio) * 1.18))
  );
  const qualityFloor = mode === "image" ? 45 : mode === "balanced" ? 34 : 25;
  const presets = [
    [estimatedDpi + 10, preferredQuality],
    [estimatedDpi, preferredQuality - 5],
    [estimatedDpi - 10, preferredQuality - 10],
    [100, 55],
    [80, 45],
    [60, qualityFloor]
  ];

  const unique = new Map();
  for (const [rawDpi, rawQuality] of presets) {
    const dpi = Math.max(COMPRESSION_LIMITS.MIN_DPI, Math.min(effectiveMaxDpi, Math.round(rawDpi / 5) * 5));
    const jpegQuality = Math.max(qualityFloor, Math.min(COMPRESSION_LIMITS.MAX_JPEG_QUALITY, Math.round(rawQuality)));
    unique.set(`${dpi}:${jpegQuality}`, { dpi, jpegQuality });
  }
  return [...unique.values()]
    .sort((a, b) => (b.dpi * b.jpegQuality) - (a.dpi * a.jpegQuality))
    .slice(0, COMPRESSION_LIMITS.MAX_CANDIDATE_COUNT);
}

function qualityScore(candidate, mode) {
  const weight = mode === "image" ? 1.05 : mode === "balanced" ? 0.85 : 0.68;
  return candidate.dpi * (candidate.jpegQuality / 100) ** weight;
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
    assertMemoryHeadroom({ minimumFreeMb: 96, maximumUsagePercent: 80, stage: `render-page-${pageIndex + 1}` });
    page = document.loadPage(pageIndex);
    const [x0, y0, x1, y1] = page.getBounds();
    const width = x1 - x0;
    const height = y1 - y0;
    const estimatedPixmapMb = estimatePixmapMb(width, height, settings.dpi, settings.colorMode);
    const snapshot = getMemorySnapshot();
    if (snapshot.cgroupFreeMb !== null && estimatedPixmapMb * 2.5 > snapshot.cgroupFreeMb) {
      throw new AppError(
        `Trang ${pageIndex + 1} cần quá nhiều RAM ở ${settings.dpi} DPI. Hãy giảm DPI hoặc chuyển sang thang xám.`,
        507,
        "PAGE_MEMORY_LIMIT"
      );
    }

    pixmap = page.toPixmap(
      mupdf.Matrix.scale(settings.dpi / 72, settings.dpi / 72),
      settings.colorMode === "gray" ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB,
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

export async function buildRasterizedPdf(document, pageIndexes, settings, { onProgress, signal } = {}) {
  assertMemoryHeadroom({ minimumFreeMb: 128, maximumUsagePercent: 76, stage: "create-output-pdf" });
  const output = await PDFDocument.create();
  output.setTitle("PDF đã nén");
  output.setProducer("WEB TOOL PDF");

  for (let position = 0; position < pageIndexes.length; position += 1) {
    throwIfAborted(signal);
    const rendered = renderPage(document, pageIndexes[position], settings);
    const image = await output.embedJpg(rendered.jpegBytes);
    const outputPage = output.addPage([rendered.width, rendered.height]);
    outputPage.drawImage(image, { x: 0, y: 0, width: rendered.width, height: rendered.height });
    onProgress?.({ stage: "rendering", currentPage: position + 1, totalPages: pageIndexes.length, ...settings });
  }

  throwIfAborted(signal);
  assertMemoryHeadroom({ minimumFreeMb: 96, maximumUsagePercent: 82, stage: "save-output-pdf" });
  return output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 25 });
}

export async function chooseCompressionSettings(document, { samplePages, pageCount, inputBytes, options, onProgress, signal }) {
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
    assertMemoryHeadroom({ minimumFreeMb: 128, maximumUsagePercent: 76, stage: `sample-${index + 1}` });
    const candidate = candidates[index];
    onProgress?.({ stage: "sampling", candidateIndex: index + 1, candidateCount: candidates.length, ...candidate });
    let bytes = await buildRasterizedPdf(document, samplePages, { ...candidate, colorMode: options.colorMode }, { signal });
    evaluated.push({ ...candidate, estimatedBytes: Math.round((bytes.length / samplePages.length) * pageCount * 1.10) });
    bytes = null;
    if (typeof global.gc === "function") global.gc();
  }

  const targetWithMargin = Math.floor(options.targetBytes * 0.90);
  const fitting = evaluated.filter((candidate) => candidate.estimatedBytes <= targetWithMargin);
  return (fitting.length ? fitting : evaluated).sort((a, b) => {
    if (fitting.length) return qualityScore(b, options.mode) - qualityScore(a, options.mode);
    return a.estimatedBytes - b.estimatedBytes;
  })[0];
}

export function calculateRetrySettings(settings, outputBytes, targetBytes) {
  const ratio = Math.max(0.1, Math.min(1, targetBytes / Math.max(1, outputBytes)));
  return {
    ...settings,
    dpi: Math.max(COMPRESSION_LIMITS.MIN_DPI, Math.round((settings.dpi * Math.sqrt(ratio) * 0.94) / 5) * 5),
    jpegQuality: Math.max(COMPRESSION_LIMITS.MIN_JPEG_QUALITY, Math.round(settings.jpegQuality * Math.max(0.68, ratio) * 0.95))
  };
}

export { safeDestroy, throwIfAborted };
