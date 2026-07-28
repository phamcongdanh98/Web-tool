"use strict";

import {
  createCompressionJobController,
  createDeleteCompressionJobController,
  createDownloadCompressionJobController,
  createGetCompressionJobController
} from "./compress-pdf.controller.js";

export async function registerCompressPdfFeature(app, { limiter, jobStore }) {
  const createJob = createCompressionJobController({ limiter, jobStore });
  const getJob = createGetCompressionJobController({ jobStore });
  const downloadJob = createDownloadCompressionJobController({ jobStore });
  const deleteJob = createDeleteCompressionJobController({ jobStore });

  app.post("/api/compress/jobs", createJob);
  app.post("/api/pdf/compress/jobs", createJob);
  app.get("/api/pdf/compress/jobs/:jobId", getJob);
  app.get("/api/pdf/compress/jobs/:jobId/download", downloadJob);
  app.delete("/api/pdf/compress/jobs/:jobId", deleteJob);

  app.post("/api/compress", async (_request, reply) => reply.code(410).send({
    ok: false,
    message: "API nén trực tiếp đã được thay bằng tác vụ nền. Hãy tải lại trang và thử lại."
  }));
  app.post("/api/pdf/compress", async (_request, reply) => reply.code(410).send({
    ok: false,
    message: "API nén trực tiếp đã được thay bằng tác vụ nền. Hãy tải lại trang và thử lại."
  }));
}
