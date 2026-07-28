"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { JobStore } from "../src/core/jobs/job-store.js";

function createJob(store, cleanup = async () => {}) {
  return store.create({
    directory: "temporary-directory",
    inputPath: "input.pdf",
    outputPath: "output.pdf",
    originalFilename: "document.pdf",
    inputBytes: 1024,
    options: {},
    cleanup
  });
}

test("active jobs do not expire while queued or processing", async (context) => {
  const store = new JobStore();
  context.after(() => store.close());

  const job = createJob(store);
  assert.equal(job.expiresAt, null);

  store.markProcessing(job.id);
  job.expiresAt = Date.now() - 1;
  await store.cleanupExpired();

  assert.equal(store.get(job.id), job);
  assert.equal(job.status, "processing");
});

test("completed jobs expire and are cleaned up", async (context) => {
  let cleanupCount = 0;
  const store = new JobStore();
  context.after(() => store.close());

  const job = createJob(store, async () => {
    cleanupCount += 1;
  });
  store.markProcessing(job.id);
  store.markCompleted(job.id, {
    inputBytes: 1024,
    outputBytes: 512,
    reachedTarget: true
  });

  assert.ok(Number.isFinite(job.expiresAt));
  job.expiresAt = Date.now() - 1;
  await store.cleanupExpired();

  assert.equal(store.get(job.id), null);
  assert.equal(cleanupCount, 1);
});

test("removing an active job aborts it and cleanup is idempotent", async (context) => {
  let cleanupCount = 0;
  const store = new JobStore();
  context.after(() => store.close());

  const job = createJob(store, async () => {
    cleanupCount += 1;
  });
  const removed = await store.remove(job.id);
  const removedAgain = await store.remove(job.id);

  assert.equal(removed, true);
  assert.equal(removedAgain, false);
  assert.equal(job.abortController.signal.aborted, true);
  assert.equal(cleanupCount, 1);
});

test("capacity reservations prevent concurrent uploads from overbooking", async (context) => {
  const store = new JobStore({ maxJobs: 1 });
  context.after(() => store.close());

  const reservations = await Promise.allSettled([
    store.reserveCapacity(),
    store.reserveCapacity()
  ]);
  const successful = reservations.find((result) => result.status === "fulfilled");
  const rejected = reservations.find((result) => result.status === "rejected");

  assert.equal(successful.status, "fulfilled");
  assert.equal(rejected.reason.code, "JOB_STORE_FULL");

  successful.value();
  const releaseAgain = await store.reserveCapacity();
  releaseAgain();
  releaseAgain();
  assert.equal(store.stats.reservations, 0);
});
