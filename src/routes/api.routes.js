"use strict";

import { env } from "../config/env.js";
import { JobLimiter } from "../core/jobs/job-limiter.js";
import { JobStore } from "../core/jobs/job-store.js";
import { registerCompressPdfFeature } from "../features/compress-pdf/compress-pdf.route.js";

export async function registerApiRoutes(app) {
  const limiter = new JobLimiter({ concurrency: env.MAX_CONCURRENT_JOBS, queueLimit: env.MAX_QUEUE_SIZE });
  const jobStore = new JobStore({
    retentionMs: env.JOB_RETENTION_MS,
    cleanupIntervalMs: env.JOB_CLEANUP_INTERVAL_MS,
    maxJobs: env.MAX_STORED_JOBS,
    logger: app.log
  });

  app.addHook("onClose", async () => jobStore.close());

  app.get("/api/health", async () => {
    const memory = process.memoryUsage();
    return {
      ok: true,
      service: "web-tool-pdf",
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      limiter: limiter.stats,
      jobs: jobStore.stats,
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024)
      }
    };
  });

  await registerCompressPdfFeature(app, { limiter, jobStore });
}
