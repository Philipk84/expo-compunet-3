const CACHE_NAME = "bitacora-shell-v1";
const CORE_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];
const DB_NAME = "bitacora-cero-senal";
const DB_VERSION = 1;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(async () => (await caches.match("/")) || (await caches.match("/index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || network;
    }),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-bitacora") event.waitUntil(syncOutbox());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "TRY_SYNC") event.waitUntil(syncOutbox());
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function syncOutbox() {
  const database = await openDatabase();
  const read = database.transaction("outbox", "readonly");
  const operations = await resultOf(read.objectStore("outbox").getAll());

  for (const operation of operations) {
    const response = await fetch("/api/reports/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: [operation] }),
    });
    if (!response.ok) throw new Error("La API no respondió");
    const payload = await response.json();
    const result = payload.results[0];
    if (!result) continue;

    const write = database.transaction(["reports", "outbox"], "readwrite");
    const reportStore = write.objectStore("reports");
    const outboxStore = write.objectStore("outbox");
    const local = await resultOf(reportStore.get(operation.reportId));
    if (local) {
      const localChangedWhileSyncing = local.updatedAt !== operation.report.updatedAt;
      if (result.status === "accepted" && localChangedWhileSyncing) {
        reportStore.put({ ...local, serverVersion: result.report.version, syncStatus: "pending" });
        const queued = await resultOf(outboxStore.index("reportId").getAll());
        queued.forEach((item) => outboxStore.put({
          ...item,
          report: { ...item.report, baseVersion: result.report.version },
        }));
      } else {
        reportStore.put(result.status === "accepted"
          ? { ...result.report, serverVersion: result.report.version, syncStatus: "synced" }
          : { ...local, syncStatus: "conflict", conflict: result.report });
      }
    }
    outboxStore.delete(operation.operationId);
    await transactionDone(write);
  }

  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: "SYNC_COMPLETE" }));
}
