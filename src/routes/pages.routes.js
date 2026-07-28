"use strict";

export async function registerPageRoutes(app) {
  app.get("/", (_, reply) => reply.sendFile("index.html"));
  app.get("/nen-pdf", (_, reply) => reply.sendFile("pdf-compressor.html"));
  app.get("/nen-pdf/", (_, reply) => reply.redirect(301, "/nen-pdf"));
  app.get("/pdf-compressor.html", (_, reply) => reply.redirect(301, "/nen-pdf"));
  app.get("/chinh-sua-pdf", (_, reply) => reply.sendFile("pdf-editor.html"));
  app.get("/chinh-sua-pdf/", (_, reply) => reply.redirect(301, "/chinh-sua-pdf"));
  app.get("/pdf-editor.html", (_, reply) => reply.redirect(301, "/chinh-sua-pdf"));
}
