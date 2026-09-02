export type Priority = "low" | "medium" | "high";

export interface ServerReport {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SyncOperation {
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

export interface StoredState {
  reports: ServerReport[];
  processed: Record<string, SyncResult>;
}
