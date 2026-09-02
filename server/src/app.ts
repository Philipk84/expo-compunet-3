import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ReportRepository } from "./repository.js";
import type { Priority, SyncOperation } from "./types.js";

const priorities = new Set<Priority>(["low", "medium", "high"]);

function isSyncOperation(value: unknown): value is SyncOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<SyncOperation>;
  const report = operation.report;
  return Boolean(
    typeof operation.operationId === "string" &&
    typeof operation.reportId === "string" &&
    report &&
    typeof report.id === "string" &&
    report.id === operation.reportId &&
    typeof report.title === "string" &&
    report.title.trim().length > 0 &&
    report.title.length <= 100 &&
    typeof report.description === "string" &&
    report.description.trim().length > 0 &&
    report.description.length <= 500 &&
    priorities.has(report.priority as Priority) &&
    typeof report.createdAt === "string" &&
    !Number.isNaN(Date.parse(report.createdAt)) &&
    typeof report.updatedAt === "string" &&
    !Number.isNaN(Date.parse(report.updatedAt)) &&
    (report.baseVersion === null || (Number.isInteger(report.baseVersion) && Number(report.baseVersion) >= 1)),
  );
}

export async function createApp(options: { dataFile?: string } = {}) {
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const dataFile = options.dataFile ?? process.env.DATA_FILE ?? resolve(workspaceRoot, "data", "reports.json");
  const repository = new ReportRepository(dataFile);
  await repository.initialize();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/reports", (_request, response) => {
    response.json(repository.list());
  });

  app.post("/api/reports/sync", async (request, response) => {
    const operations = (request.body as { operations?: unknown })?.operations;
    if (!Array.isArray(operations) || operations.length > 100 || !operations.every(isSyncOperation)) {
      response.status(400).json({
        error: "INVALID_OPERATIONS",
        message: "La solicitud debe incluir hasta 100 operaciones válidas.",
      });
      return;
    }

    const results = await repository.synchronize(operations);
    response.json({ results });
  });

  const clientDirectory = resolve(workspaceRoot, "client", "dist");
  if (existsSync(clientDirectory)) {
    app.use(express.static(clientDirectory, { maxAge: "1h", etag: true }));
    app.use((request, response, next) => {
      if (request.method === "GET" && request.accepts("html")) {
        response.sendFile(resolve(clientDirectory, "index.html"));
        return;
      }
      next();
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "INTERNAL_ERROR", message: "Ocurrió un error inesperado." });
  });

  return app;
}
