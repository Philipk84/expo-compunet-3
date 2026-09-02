import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ServerReport, StoredState, SyncOperation, SyncResult } from "./types.js";

const MAX_PROCESSED_OPERATIONS = 500;

export class ReportRepository {
  private state: StoredState = { reports: [], processed: {} };
  private writeQueue = Promise.resolve();

  constructor(private readonly filename: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filename), { recursive: true });
    try {
      const contents = await readFile(this.filename, "utf8");
      const parsed = JSON.parse(contents) as StoredState;
      this.state = {
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        processed: parsed.processed ?? {},
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      this.state.reports = [this.createWelcomeReport()];
      await this.persist();
    }
  }

  list(): ServerReport[] {
    return [...this.state.reports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async synchronize(operations: SyncOperation[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const operation of operations) {
      const previousResult = this.state.processed[operation.operationId];
      if (previousResult) {
        results.push(previousResult);
        continue;
      }

      const existingIndex = this.state.reports.findIndex((report) => report.id === operation.report.id);
      const existing = existingIndex >= 0 ? this.state.reports[existingIndex] : undefined;
      let result: SyncResult;

      if (existing && operation.report.baseVersion !== existing.version) {
        result = { operationId: operation.operationId, status: "conflict", report: existing };
      } else {
        const accepted: ServerReport = {
          id: operation.report.id,
          title: operation.report.title.trim(),
          description: operation.report.description.trim(),
          priority: operation.report.priority,
          createdAt: existing?.createdAt ?? operation.report.createdAt,
          updatedAt: operation.report.updatedAt,
          version: (existing?.version ?? 0) + 1,
        };
        if (existingIndex >= 0) this.state.reports[existingIndex] = accepted;
        else this.state.reports.push(accepted);
        result = { operationId: operation.operationId, status: "accepted", report: accepted };
      }

      this.state.processed[operation.operationId] = result;
      results.push(result);
    }

    this.trimProcessedOperations();
    await this.persist();
    return results;
  }

  private createWelcomeReport(): ServerReport {
    const timestamp = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    return {
      id: "demo-auditorio",
      title: "Inspección de conectividad del auditorio",
      description: "Registro inicial enviado por el equipo de infraestructura.",
      priority: "medium",
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
  }

  private trimProcessedOperations(): void {
    const entries = Object.entries(this.state.processed);
    if (entries.length <= MAX_PROCESSED_OPERATIONS) return;
    this.state.processed = Object.fromEntries(entries.slice(-MAX_PROCESSED_OPERATIONS));
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = `${this.filename}.tmp`;
      await writeFile(temporary, JSON.stringify(this.state, null, 2), "utf8");
      await rename(temporary, this.filename);
    });
    await this.writeQueue;
  }
}
