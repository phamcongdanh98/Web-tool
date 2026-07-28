"use strict";

import os from "node:os";
import path from "node:path";

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
function readNonNegativeInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || "development",
  HOST: process.env.HOST || "0.0.0.0",
  PORT: readPositiveInteger("PORT", 3000),
  TEMP_ROOT: path.resolve(process.env.TEMP_ROOT || path.join(os.tmpdir(), "web-tool-pdf")),
  MAX_UPLOAD_BYTES: readPositiveInteger("MAX_UPLOAD_MB", 100) * 1024 * 1024,
  MAX_PDF_PAGES: readPositiveInteger("MAX_PDF_PAGES", 500),
  MAX_CONCURRENT_JOBS: readPositiveInteger("MAX_CONCURRENT_JOBS", 1),
  MAX_QUEUE_SIZE: readNonNegativeInteger("MAX_QUEUE_SIZE", 10),
  REQUEST_TIMEOUT_MS: readPositiveInteger("REQUEST_TIMEOUT_MS", 30 * 60 * 1000)
});
