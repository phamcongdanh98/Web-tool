"use strict";

import fs from "node:fs";
import fsp from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { AppError } from "../../core/errors/app-error.js";

export async function saveUpload(part, destination) {
  await pipeline(part.file, fs.createWriteStream(destination, { flags: "wx" }));
  if (part.file.truncated) throw new AppError("File vượt quá giới hạn dung lượng cho phép.", 413, "FILE_TOO_LARGE");
}

export async function assertPdfSignature(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(5);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 5 || buffer.toString("ascii") !== "%PDF-") {
      throw new AppError("File đã chọn không phải PDF hợp lệ.", 400, "INVALID_PDF_SIGNATURE");
    }
  } finally {
    await handle.close();
  }
}

export function sanitizeDownloadFilename(filename) {
  const base = String(filename || "tai-lieu.pdf")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, 120) || "tai-lieu";
  return `${base}-da-nen.pdf`;
}
