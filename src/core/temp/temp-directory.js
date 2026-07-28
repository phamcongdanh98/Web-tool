"use strict";

import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";

export async function ensureTempRoot() {
  await fsp.mkdir(env.TEMP_ROOT, { recursive: true });
}
export async function createTempDirectory(prefix = "job-") {
  await ensureTempRoot();
  return fsp.mkdtemp(path.join(env.TEMP_ROOT, prefix));
}
export function createCleanup(directory, logger) {
  let promise;
  return function cleanup() {
    if (!promise) promise = fsp.rm(directory, { recursive: true, force: true }).catch((error) => logger?.warn?.({ error, directory }, "Không thể xóa thư mục tạm"));
    return promise;
  };
}
