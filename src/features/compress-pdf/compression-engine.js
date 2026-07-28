"use strict";

import * as mupdf from "mupdf";
import { PDFDocument } from "pdf-lib";
import { AppError } from "../../core/errors/app-error.js";
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

export function selectSamplePages(pageCount) {
  const count = Math.min(COMPRESSION_LIMITS.SAMPLE_PAGE_COUNT, pageCount);
  if (count === pageCount) return Array.from({ length: pageCount }, (_, index) => index);
  return [...new Set([0, Math.round((pageCount - 1) * 0.25), Math.round((pageCount - 1) * 0.5), Math.round((pageCount - 1) * 0.75), pageCount - 1])]
    .slice(0, count)
    .sort((a, b) => a - b);
}

export function buildAdaptiveCandidates({ inputBytes, targetBytes, maxDpi, preferredQuality, mode }) {
  const ratio = Math.min(1, targetBytes / Math.max(1, inputBytes));
  const estimatedDpi = Math.max(COMPRESSION_LIMITS.MIN_DPI, Math.min(maxDpi, Math.round(maxDpi * Math.sqrt(ratio) * 1.25)));
  const qualityFloor = mode === "image" ? 45 : mode === "balanced" ? 34 : 25;
  const presets = [
    [maxDpi, preferredQuality],
    [estimatedDpi + 20, preferredQuality],
    [estimatedDpi, preferredQuality],
    [estimatedDpi, preferredQuality - 10],
    [estimatedDpi - 15, preferredQuality - 8],
    [estimatedDpi - 25, preferredQuality - 15],
    [120, 65],
    [100, 55],
    [80, 45],
    [60, qualityFloor]
  ];

  const unique = new Map();
  for (const [rawDpi, rawQuality] of presets) {
    const dpi = Math.max(COMPRESSION_LIMITS.MIN_DPI, Math.min(maxDpi, Math.round(rawDpi / 5) * 5));
    const jpegQuality = Math.max(qualityFloor, Math.min(COMPRESSION_LIMITS.MAX_JPEG_QUALITY, Math.round(rawQuality)));
    unique.set(`${dpi}:${jpegQuality}`, { dpi, jpegQuality });
  }
  return [...unique.values()].sort((a, b) => (b.dpi * b.jpegQuality) - (a.dpi * a.jpegQuality));
}

function qualityScore(candidate, mode) {
  const weight = mode === "image" ? 1.05 : mode === "balanced" ? 0.85 : 0.68;
  return candidate.dpi * (candidate.jpegQuality / 100) ** weight;
}

function renderPage(document, pageIndex, settings) {
  let page;
  let pixmap;
  try {
    page = document.loadPage(pageIndex);
    const [x0, y0, x1, y1] = page.getBounds();
    pixmap = page.toPixmap(
      mupdf.Matrix.scale(settings.dpi / 72, settings.dpi / 72),
      settings.colorMode === "gray" ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );
    return {
      width: x1 - x0,
      height: y1 - y0,
      jpegBytes: toUint8Array(pixmap.asJPEG(settings.jpegQuality))
    };
  } finally {
    safeDestroy(pixmap);
    safeDestroy(page);
  }
}

export async function buildRasterizedPdf(document, pageIndexes, settings, { onProgress, signal } = {}) {
  const output = await PDFDocument.create();
  output.setTitle("PDF đã nén");
  output.setProducer("WEB TOOL PDF");

  for (let position = 0; position < pageIndexes.length; position += 1) {
    throwIfAborted(signal);
    const rendered = renderPage(document, pageIndexes[position], settings);
    const image = await output.embedJpg(rendered.jpegBytes);
    const page = output.addPage([rendered.width, rendered.height]);
    page.drawImage(image, { x: 0, y: 0, width: rendered.width, height: rendered.height });
    onProgress?.({ stage: "rendering", currentPage: position + 1, totalPages: pageIndexes.length, ...settings });
  }

  throwIfAborted(signal);
  return output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 100 });
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
    const candidate = candidates[index];
    onProgress?.({ stage: "sampling", candidateIndex: index + 1, candidateCount: candidates.length, ...candidate });
    const bytes = await buildRasterizedPdf(document, samplePages, { ...candidate, colorMode: options.colorMode }, { signal });
    evaluated.push({ ...candidate, estimatedBytes: Math.round((bytes.length / samplePages.length) * pageCount * 1.04) });
  }

  const targetWithMargin = Math.floor(options.targetBytes * 0.96);
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
    dpi: Math.max(COMPRESSION_LIMITS.MIN_DPI, Math.round((settings.dpi * Math.sqrt(ratio) * 0.97) / 5) * 5),
    jpegQuality: Math.max(COMPRESSION_LIMITS.MIN_JPEG_QUALITY, Math.round(settings.jpegQuality * Math.max(0.72, ratio) * 0.98))
  };
}

export { safeDestroy, throwIfAborted };
