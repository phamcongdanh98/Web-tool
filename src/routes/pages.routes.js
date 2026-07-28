"use strict";

export async function registerPageRoutes(app) {
  app.get("/", (_, reply) => reply.sendFile("index.html"));
  app.get("/nen-pdf", (_, reply) => reply.sendFile("pdf-compressor.html"));
  app.get("/nen-pdf/", (_, reply) => reply.redirect("/nen-pdf", 301));
  app.get("/pdf-compressor.html", (_, reply) => reply.redirect("/nen-pdf", 301));
  app.get("/chinh-sua-pdf", (_, reply) => reply.sendFile("pdf-editor.html"));
  app.get("/chinh-sua-pdf/", (_, reply) => reply.redirect("/chinh-sua-pdf", 301));
  app.get("/pdf-editor.html", (_, reply) => reply.redirect("/chinh-sua-pdf", 301));
}
