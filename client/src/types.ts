export type Priority = "low" | "medium" | "high";
export type SyncStatus = "pending" | "synced" | "conflict";

export interface ServerReport {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface LocalReport {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  serverVersion: number | null;
  syncStatus: SyncStatus;
  conflict?: ServerReport;
}

export interface OutboxOperation {
  operationId: string;
  reportId: string;
  report: {
    id: string;
    title: string;
    description: string;
    priority: Priority;
    createdAt: string;
    updatedAt: string;
    baseVersion: number | null;
  };
}

export interface SyncResult {
  operationId: string;
  status: "accepted" | "conflict";
  report: ServerReport;
}
