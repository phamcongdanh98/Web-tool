"use strict";

import fsp from "node:fs/promises";
import * as mupdf from "mupdf";
import { AppError } from "../../core/errors/app-error.js";
import { validateCompressionOptions } from "./compress-pdf.options.js";
import {
  buildRasterizedPdf,
  calculateRetrySettings,
  chooseCompressionSettings,
  safeDestroy,
  selectSamplePages,
  throwIfAborted
} from "./compression-engine.js";

export async function compressPdf({ inputPath, outputPath, maxPageCount, onProgress, signal, ...rawOptions }) {
  const startedAt = performance.now();
  const options = validateCompressionOptions(rawOptions);
  const inputData = await fsp.readFile(inputPath);
  const inputBytes = inputData.length;
  throwIfAborted(signal);

  if (options.targetBytes >= inputBytes) {
    await fsp.copyFile(inputPath, outputPath);
    return { inputBytes, outputBytes: inputBytes, targetBytes: options.targetBytes, pageCount: null, dpi: null, jpegQuality: null, reachedTarget: true, skipped: true, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) };
  }

  let document;
  try {
    document = mupdf.PDFDocument.openDocument(inputData, "application/pdf");
    if (document.needsPassword()) throw new AppError("PDF đang được bảo vệ bằng mật khẩu.", 400, "PDF_PASSWORD_REQUIRED");

    const pageCount = document.countPages();
    if (!Number.isInteger(pageCount) || pageCount <= 0) throw new AppError("PDF không có trang hợp lệ.", 400, "INVALID_PAGE_COUNT");
    if (pageCount > maxPageCount) throw new AppError(`PDF vượt quá giới hạn ${maxPageCount} trang.`, 413, "TOO_MANY_PAGES");

    const selected = await chooseCompressionSettings(document, {
      samplePages: selectSamplePages(pageCount),
      pageCount,
      inputBytes,
      options,
      onProgress,
      signal
    });

    const allPages = Array.from({ length: pageCount }, (_, index) => index);
    let finalSettings = { dpi: selected.dpi, jpegQuality: selected.jpegQuality, colorMode: options.colorMode };
    let outputBytes = await buildRasterizedPdf(document, allPages, finalSettings, { onProgress, signal });

    if (outputBytes.length > options.targetBytes) {
      const retrySettings = calculateRetrySettings(finalSettings, outputBytes.length, options.targetBytes);
      if (retrySettings.dpi !== finalSettings.dpi || retrySettings.jpegQuality !== finalSettings.jpegQuality) {
        finalSettings = retrySettings;
        outputBytes = await buildRasterizedPdf(document, allPages, finalSettings, { onProgress, signal });
      }
    }

    throwIfAborted(signal);
    await fsp.writeFile(outputPath, outputBytes);
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
    if (/password/i.test(message)) throw new AppError("PDF đang được bảo vệ bằng mật khẩu.", 400, "PDF_PASSWORD_REQUIRED");
    throw error;
  } finally {
    safeDestroy(document);
  }
}
