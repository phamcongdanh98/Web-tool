"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { JobLimiter } from "../src/core/jobs/job-limiter.js";

test("queued jobs can be cancelled without consuming a slot", async () => {
  const limiter = new JobLimiter({ concurrency: 1, queueLimit: 1 });
  let releaseFirst;
  const first = limiter.run(
    () => new Promise((resolve) => {
      releaseFirst = resolve;
    })
  );

  const controller = new AbortController();
  const second = limiter.run(async () => "unexpected", {
    signal: controller.signal
  });
  controller.abort();

  await assert.rejects(second, (error) => error.code === "JOB_ABORTED");
  assert.deepEqual(limiter.stats, {
    active: 1,
    queued: 0,
    concurrency: 1,
    queueLimit: 1
  });

  releaseFirst();
  await first;
  assert.equal(limiter.stats.active, 0);
});

test("queue limit rejects excess work", async () => {
  const limiter = new JobLimiter({ concurrency: 1, queueLimit: 0 });
  let releaseFirst;
  const first = limiter.run(
    () => new Promise((resolve) => {
      releaseFirst = resolve;
    })
  );

  await assert.rejects(
    limiter.run(async () => "unexpected"),
    (error) => error.code === "QUEUE_FULL"
  );

  releaseFirst();
  await first;
});
