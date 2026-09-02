import {
  AlertTriangle,
  Check,
  CloudOff,
  Database,
  FlaskConical,
  ListChecks,
  LoaderCircle,
  Pencil,
  Radio,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acceptServerVersion, getLocalReports, queueReport } from "./db";
import { requestBackgroundSync, synchronize } from "./sync";
import type { LocalReport, Priority } from "./types";

const priorityLabels: Record<Priority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

function relativeTime(date: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 15) return "Ahora mismo";
  if (seconds < 60) return `Hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(date));
}

function App() {
  const [reports, setReports] = useState<LocalReport[]>([]);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [demoOffline, setDemoOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ready, setReady] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(() => localStorage.getItem("last-sync"));
  const [notice, setNotice] = useState("Datos locales listos");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [editingId, setEditingId] = useState<string | null>(null);
  const initialized = useRef(false);
  const effectiveOnline = browserOnline && !demoOffline;

  const refresh = useCallback(async () => {
    setReports(await getLocalReports());
  }, []);

  const runSync = useCallback(async (silent = false) => {
    if (!browserOnline || demoOffline || syncing) {
      if (!silent) setNotice("Sin conexión: los cambios siguen seguros en este dispositivo");
      return;
    }

    setSyncing(true);
    if (!silent) setNotice("Sincronizando con la API…");
    try {
      const summary = await synchronize();
      await refresh();
      const timestamp = new Date().toISOString();
      localStorage.setItem("last-sync", timestamp);
      setLastSync(timestamp);
      if (summary.conflicts > 0) {
        setNotice(`${summary.conflicts} conflicto${summary.conflicts === 1 ? " necesita" : "s necesitan"} revisión`);
      } else if (summary.uploaded > 0) {
        setNotice(`${summary.uploaded} cambio${summary.uploaded === 1 ? " sincronizado" : "s sincronizados"}`);
      } else if (!silent) {
        setNotice("Todo está al día");
      }
    } catch {
      setNotice("La API no respondió; tus datos continúan guardados localmente");
    } finally {
      setSyncing(false);
    }
  }, [browserOnline, demoOffline, refresh, syncing]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void refresh().then(() => {
      setReady(true);
    });
  }, [refresh, runSync]);

  useEffect(() => {
    const online = () => {
      setBrowserOnline(true);
      setNotice("La conexión volvió: preparando sincronización");
    };
    const offline = () => {
      setBrowserOnline(false);
      setNotice("Estás sin internet; puedes seguir trabajando");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useEffect(() => {
    if (browserOnline && !demoOffline && ready) void runSync(true);
  }, [browserOnline, demoOffline, ready]); // runSync cambia mientras sincroniza; evitamos un bucle

  useEffect(() => {
    const serviceWorkerMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "SYNC_COMPLETE") {
        void refresh();
        setNotice("Sincronización en segundo plano completada");
      }
    };
    navigator.serviceWorker?.addEventListener("message", serviceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", serviceWorkerMessage);
  }, [refresh]);

  const totals = useMemo(() => ({
    pending: reports.filter((report) => report.syncStatus === "pending").length,
    synced: reports.filter((report) => report.syncStatus === "synced").length,
    conflicts: reports.filter((report) => report.syncStatus === "conflict").length,
  }), [reports]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      setNotice("Completa el título y los detalles del reporte");
      return;
    }

    const now = new Date().toISOString();
    const existing = editingId ? reports.find((report) => report.id === editingId) : undefined;
    const report: LocalReport = {
      id: existing?.id ?? crypto.randomUUID(),
      title: title.trim(),
      description: description.trim(),
      priority,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      serverVersion: existing?.serverVersion ?? null,
      syncStatus: "pending",
    };
    await queueReport(report);
    await refresh();
    setTitle("");
    setDescription("");
    setPriority("medium");
    setEditingId(null);
    setNotice(effectiveOnline ? "Guardado localmente; enviando al servidor…" : "Guardado sin conexión en IndexedDB");

    if (effectiveOnline) void runSync(true);
    else void requestBackgroundSync().catch(() => undefined);
  }

  function startEditing(report: LocalReport) {
    setEditingId(report.id);
    setTitle(report.title);
    setDescription(report.description);
    setPriority(report.priority);
    document.querySelector(".report-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEditing() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setPriority("medium");
  }

  async function resolveConflict(report: LocalReport, choice: "server" | "local") {
    if (!report.conflict) return;
    if (choice === "server") {
      await acceptServerVersion(report);
      setNotice("Se conservó la versión del servidor");
      await refresh();
      return;
    }

    await queueReport({
      ...report,
      serverVersion: report.conflict.version,
      conflict: undefined,
      updatedAt: new Date().toISOString(),
      syncStatus: "pending",
    });
    setNotice("Tu versión quedó lista para reemplazar la del servidor");
    await refresh();
    if (effectiveOnline) void runSync(true);
  }

  function toggleDemoConnection() {
    setDemoOffline((current) => {
      const next = !current;
      setNotice(next ? "Corte simulado: la API está pausada" : "Señal restaurada: sincronización habilitada");
      return next;
    });
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Ir al inicio">
          <span className="brand-mark"><Radio size={20} /></span>
          <span>Bitácora <strong>Cero Señal</strong></span>
        </a>
        <div className="topbar-actions">
          <button className="demo-toggle" type="button" onClick={toggleDemoConnection} aria-pressed={demoOffline}>
            <FlaskConical size={15} /> {demoOffline ? "Restaurar señal" : "Simular corte"}
          </button>
          <div className={`connection ${effectiveOnline ? "online" : "offline"}`} role="status">
            {effectiveOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            {effectiveOnline ? "En línea" : "Sin conexión"}
          </div>
        </div>
      </header>

      <section className="intro" id="inicio">
        <div>
          <p className="eyebrow">Laboratorio Offline-First · PWA</p>
          <h1>La conexión puede fallar.<br />Tu trabajo no.</h1>
          <p className="lede">Crea reportes desde cualquier lugar. Se guardan en este dispositivo y viajan al servidor cuando vuelve la señal.</p>
        </div>
        <div className={`sync-panel ${effectiveOnline ? "" : "is-offline"}`}>
          <div className="sync-icon">{effectiveOnline ? <RefreshCw size={22} /> : <CloudOff size={22} />}</div>
          <div>
            <strong>{totals.pending} {totals.pending === 1 ? "cambio por enviar" : "cambios por enviar"}</strong>
            <span>{lastSync ? `Última sincronización: ${relativeTime(lastSync)}` : "Aún no se ha sincronizado"}</span>
          </div>
          <button type="button" onClick={() => void runSync()} disabled={!effectiveOnline || syncing}>
            <RefreshCw className={syncing ? "spin" : ""} size={16} />
            {syncing ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        </div>
      </section>

      <section className="stats" aria-label="Resumen de reportes">
        <article><span>Total local</span><strong>{reports.length}</strong><ListChecks /></article>
        <article><span>Por sincronizar</span><strong>{totals.pending}</strong><CloudOff /></article>
        <article><span>En el servidor</span><strong>{totals.synced}</strong><Server /></article>
      </section>

      <div className="notice" role="status" aria-live="polite">
        <span className={effectiveOnline ? "pulse online" : "pulse"} /> {notice}
      </div>

      <section className="workspace">
        <form className="report-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <span>01</span>
            <div><h2>{editingId ? "Editar reporte" : "Nuevo reporte"}</h2><p>Funciona incluso sin internet.</p></div>
            {editingId && <button className="cancel-edit" type="button" onClick={cancelEditing} aria-label="Cancelar edición"><X size={16} /></button>}
          </div>
          <label>
            ¿Qué ocurrió?
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Falla en el punto de acceso" maxLength={100} />
          </label>
          <label>
            Detalles
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe lo que encontraste…" rows={4} maxLength={500} />
          </label>
          <fieldset>
            <legend>Prioridad</legend>
            <div className="priority-row">
              {(["low", "medium", "high"] as Priority[]).map((option) => (
                <label className={priority === option ? "selected" : ""} key={option}>
                  <input type="radio" name="priority" value={option} checked={priority === option} onChange={() => setPriority(option)} />
                  {priorityLabels[option]}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="primary" type="submit"><Send size={17} /> {editingId ? "Guardar nueva versión" : "Guardar en el dispositivo"}</button>
          <p className="form-note"><Database size={14} /> Se escribe primero en IndexedDB.</p>
        </form>

        <div className="reports">
          <div className="section-heading reports-heading">
            <span>02</span>
            <div><h2>Actividad reciente</h2><p>Primero local, después en el servidor.</p></div>
            {totals.conflicts > 0 && <span className="conflict-count"><AlertTriangle size={13} /> {totals.conflicts}</span>}
          </div>

          {!ready ? (
            <div className="empty-state"><LoaderCircle className="spin" /><h3>Abriendo la base local…</h3></div>
          ) : reports.length === 0 ? (
            <div className="empty-state"><Smartphone /><h3>Este dispositivo está listo</h3><p>Crea el primer reporte o sincroniza para traer los del servidor.</p></div>
          ) : (
            <div className="report-list">
              {reports.map((report) => (
                <article className={`report-card ${report.syncStatus === "conflict" ? "has-conflict" : ""}`} key={report.id}>
                  <div className="report-meta">
                    <span className={`status ${report.syncStatus}`}>
                      {report.syncStatus === "pending" && <CloudOff size={12} />}
                      {report.syncStatus === "synced" && <Check size={12} />}
                      {report.syncStatus === "conflict" && <AlertTriangle size={12} />}
                      {report.syncStatus === "pending" ? "Pendiente" : report.syncStatus === "synced" ? "Sincronizado" : "Conflicto"}
                    </span>
                    <time dateTime={report.updatedAt}>{relativeTime(report.updatedAt)}</time>
                  </div>
                  <h3>{report.title}</h3>
                  <p>{report.description}</p>
                  {report.syncStatus === "conflict" && report.conflict && (
                    <div className="conflict-box">
                      <strong>El servidor tiene otra versión</strong>
                      <p>Servidor: “{report.conflict.title}”</p>
                      <div>
                        <button type="button" onClick={() => void resolveConflict(report, "server")}>Usar servidor</button>
                        <button type="button" onClick={() => void resolveConflict(report, "local")}>Conservar la mía</button>
                      </div>
                    </div>
                  )}
                  <footer>
                    <span className={`priority ${report.priority}`}>{priorityLabels[report.priority]}</span>
                    <div className="card-actions">
                      <button type="button" onClick={() => startEditing(report)}><Pencil size={12} /> Editar</button>
                      <code>#{report.id.slice(0, 6)}</code>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="under-the-hood" aria-labelledby="flow-title">
        <div className="flow-heading">
          <p className="eyebrow">Qué ocurre por debajo</p>
          <h2 id="flow-title">Un recorrido en cuatro saltos</h2>
        </div>
        <ol>
          <li><span><Smartphone /></span><strong>1. React</strong><p>Recibe el reporte y actualiza la pantalla inmediatamente.</p></li>
          <li><span><Database /></span><strong>2. IndexedDB</strong><p>Guarda el registro y lo agrega a la cola de salida.</p></li>
          <li><span><RefreshCw /></span><strong>3. Sincronización</strong><p>Detecta la señal y envía cada operación pendiente.</p></li>
          <li><span><ShieldCheck /></span><strong>4. API Express</strong><p>Persiste, versiona y devuelve posibles conflictos.</p></li>
        </ol>
      </section>

      <footer className="page-footer">
        <span>Demo educativa · Offline-First</span>
        <span>React + TypeScript + Express</span>
      </footer>
    </main>
  );
}

export default App;
