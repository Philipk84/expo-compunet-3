import type { LocalReport, OutboxOperation, ServerReport } from "./types";

const DB_NAME = "bitacora-cero-senal";
const DB_VERSION = 1;
const REPORTS = "reports";
const OUTBOX = "outbox";

let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(REPORTS)) {
          db.createObjectStore(REPORTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(OUTBOX)) {
          const store = db.createObjectStore(OUTBOX, { keyPath: "operationId" });
          store.createIndex("reportId", "reportId");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function getLocalReports(): Promise<LocalReport[]> {
  const db = await database();
  const transaction = db.transaction(REPORTS, "readonly");
  const reports = await requestResult(transaction.objectStore(REPORTS).getAll() as IDBRequest<LocalReport[]>);
  return reports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getOutbox(): Promise<OutboxOperation[]> {
  const db = await database();
  const transaction = db.transaction(OUTBOX, "readonly");
  return requestResult(transaction.objectStore(OUTBOX).getAll() as IDBRequest<OutboxOperation[]>);
}

export async function queueReport(report: LocalReport): Promise<void> {
  const db = await database();
  const transaction = db.transaction([REPORTS, OUTBOX], "readwrite");
  const outbox = transaction.objectStore(OUTBOX);
  const previousKeys = await requestResult(outbox.index("reportId").getAllKeys(report.id));
  previousKeys.forEach((key) => outbox.delete(key));
  const pendingReport: LocalReport = { ...report, syncStatus: "pending", conflict: undefined };
  const operation: OutboxOperation = {
    operationId: crypto.randomUUID(),
    reportId: report.id,
    report: {
      id: report.id,
      title: report.title,
      description: report.description,
      priority: report.priority,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      baseVersion: report.serverVersion,
    },
  };

  transaction.objectStore(REPORTS).put(pendingReport);
  outbox.put(operation);
  await transactionDone(transaction);
}

export async function applySyncResult(
  operation: OutboxOperation,
  status: "accepted" | "conflict",
  serverReport: ServerReport,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction([REPORTS, OUTBOX], "readwrite");
  const reports = transaction.objectStore(REPORTS);
  const outbox = transaction.objectStore(OUTBOX);
  const local = await requestResult(reports.get(operation.reportId) as IDBRequest<LocalReport | undefined>);

  if (local) {
    const localChangedWhileSyncing = local.updatedAt !== operation.report.updatedAt;
    const updated: LocalReport = status === "accepted" && localChangedWhileSyncing
      ? { ...local, serverVersion: serverReport.version, syncStatus: "pending" }
      : status === "accepted"
      ? {
          ...serverReport,
          serverVersion: serverReport.version,
          syncStatus: "synced",
        }
      : {
          ...local,
          syncStatus: "conflict",
          conflict: serverReport,
        };
    reports.put(updated);

    if (status === "accepted" && localChangedWhileSyncing) {
      const queued = await requestResult(outbox.index("reportId").getAll() as IDBRequest<OutboxOperation[]>);
      queued.forEach((item) => outbox.put({
        ...item,
        report: { ...item.report, baseVersion: serverReport.version },
      }));
    }
  }

  outbox.delete(operation.operationId);
  await transactionDone(transaction);
}

export async function mergeServerReports(serverReports: ServerReport[]): Promise<void> {
  const db = await database();
  const transaction = db.transaction(REPORTS, "readwrite");
  const store = transaction.objectStore(REPORTS);

  for (const serverReport of serverReports) {
    const local = await requestResult(store.get(serverReport.id) as IDBRequest<LocalReport | undefined>);
    if (!local || local.syncStatus === "synced") {
      store.put({
        ...serverReport,
        serverVersion: serverReport.version,
        syncStatus: "synced",
      } satisfies LocalReport);
    }
  }

  await transactionDone(transaction);
}

export async function acceptServerVersion(report: LocalReport): Promise<void> {
  if (!report.conflict) return;
  const db = await database();
  const transaction = db.transaction(REPORTS, "readwrite");
  transaction.objectStore(REPORTS).put({
    ...report.conflict,
    serverVersion: report.conflict.version,
    syncStatus: "synced",
  } satisfies LocalReport);
  await transactionDone(transaction);
}
