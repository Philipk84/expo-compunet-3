import { applySyncResult, getOutbox, mergeServerReports } from "./db";
import type { ServerReport, SyncResult } from "./types";

export interface SyncSummary {
  uploaded: number;
  conflicts: number;
}

export async function synchronize(): Promise<SyncSummary> {
  const operations = await getOutbox();
  let uploaded = 0;
  let conflicts = 0;

  if (operations.length > 0) {
    const response = await fetch("/api/reports/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });

    if (!response.ok) throw new Error("No fue posible enviar los cambios");
    const payload = await response.json() as { results: SyncResult[] };

    for (const result of payload.results) {
      const operation = operations.find((item) => item.operationId === result.operationId);
      if (!operation) continue;
      await applySyncResult(operation, result.status, result.report);
      if (result.status === "accepted") uploaded += 1;
      else conflicts += 1;
    }
  }

  const pullResponse = await fetch("/api/reports");
  if (!pullResponse.ok) throw new Error("No fue posible consultar el servidor");
  const serverReports = await pullResponse.json() as ServerReport[];
  await mergeServerReports(serverReports);

  return { uploaded, conflicts };
}

export async function requestBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const enhancedRegistration = registration as ServiceWorkerRegistration & {
    sync?: { register(tag: string): Promise<void> };
  };

  if (enhancedRegistration.sync) {
    await enhancedRegistration.sync.register("sync-bitacora");
  }
}
