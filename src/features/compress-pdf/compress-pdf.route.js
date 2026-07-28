"use strict";

import { createCompressPdfController } from "./compress-pdf.controller.js";

export async function registerCompressPdfFeature(app, { limiter }) {
  app.post("/api/compress", createCompressPdfController({ limiter }));
  app.post("/api/pdf/compress", createCompressPdfController({ limiter }));
}
