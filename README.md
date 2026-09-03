# Demo de Aplicaciones Web Offline-First

Aplicación de reportes que sigue funcionando sin internet, guarda los datos localmente y los sincroniza con una API cuando recupera la conexión.

**Referencias oficiales:** [operación offline en una PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation), [caché para PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching), [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) y [Express](https://expressjs.com/en/starter/installing/).

## ¿Qué es Offline-First y por qué usarlo?

Offline-First es un enfoque en el que la aplicación considera la pérdida de conexión como un estado normal, no como un error excepcional. La acción principal se completa primero en el dispositivo y la comunicación con el servidor ocurre después.

En esta demo, cuando el usuario crea o edita un reporte:

1. React actualiza la interfaz.
2. IndexedDB guarda el reporte.
3. Una cola local registra la operación pendiente.
4. Cuando hay conexión, la cola se envía a Express.
5. La API acepta el cambio o devuelve un conflicto de versiones.

Ventajas principales:

- **Continuidad:** el usuario puede seguir trabajando con una conexión inestable.
- **Respuesta inmediata:** guardar no depende del tiempo de respuesta de la red.
- **Persistencia:** cerrar o recargar la pestaña no elimina los cambios pendientes.
- **Sincronización controlada:** los estados pendiente, sincronizado y conflicto son visibles.

Comparado con una aplicación web tradicional, esta solución no bloquea el formulario cuando la API deja de responder. El servidor sigue siendo importante, pero deja de ser un requisito para cada interacción.

## 1) Requisitos

- Node.js 20 o superior.
- npm.
- Un navegador moderno; Chrome o Edge permiten mostrar más fácilmente las herramientas de PWA.
- Docker Desktop, únicamente si se ejecutará la versión en contenedor.

## 2) Instalar el proyecto

Desde la carpeta raíz:

```bash
npm install
```

El proyecto utiliza *workspaces* de npm para instalar el frontend y la API con un solo comando.

## 3) Estructura del proyecto

```text
/
├── client/
│   ├── public/
│   │   ├── icon.svg
│   │   ├── manifest.webmanifest
│   │   └── sw.js
│   ├── src/
│   │   ├── App.tsx
│   │   ├── db.ts
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   ├── sync.ts
│   │   └── types.ts
│   ├── index.html
│   └── vite.config.ts
├── server/
│   └── src/
│       ├── app.ts
│       ├── index.ts
│       ├── repository.ts
│       └── types.ts
├── Dockerfile
├── docker-compose.yml
├── GUIA_EXPOSICION.md
└── package.json
```

## 4) Arquitectura general

```text
┌───────────────────────────────────────────────────────┐
│ Navegador                                             │
│                                                       │
│  React ──► IndexedDB ──► outbox                       │
│    ▲                         │                        │
│    │                         │ sincronización         │
│    └──── Service Worker ◄────┘                        │
│              │ caché                                  │
└──────────────┼────────────────────────────────────────┘
               │ HTTP
               ▼
┌───────────────────────────────────────────────────────┐
│ API Express                                           │
│ Validación ──► control de versión ──► reports.json    │
└───────────────────────────────────────────────────────┘
```

El **Service Worker** conserva los archivos necesarios para abrir la interfaz. **IndexedDB** almacena los datos de negocio. Separar ambas responsabilidades evita usar el caché HTTP como si fuera una base de datos.

## 5) Código principal

### 5.1 Modelo local y estados de sincronización

Cada reporte local conoce la versión del servidor que fue editada y su estado actual:

```ts
// client/src/types.ts
export type SyncStatus = "pending" | "synced" | "conflict";

export interface LocalReport {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
  serverVersion: number | null;
  syncStatus: SyncStatus;
  conflict?: ServerReport;
}
```

- `pending`: el reporte está seguro en el dispositivo, pero todavía no está confirmado por la API.
- `synced`: la copia local coincide con la versión conocida del servidor.
- `conflict`: el servidor cambió desde la última versión descargada.

### 5.2 Persistencia con IndexedDB

La base local tiene dos almacenes:

```ts
// client/src/db.ts
const REPORTS = "reports";
const OUTBOX = "outbox";

request.onupgradeneeded = () => {
  const db = request.result;
  db.createObjectStore(REPORTS, { keyPath: "id" });

  const store = db.createObjectStore(OUTBOX, {
    keyPath: "operationId",
  });
  store.createIndex("reportId", "reportId");
};
```

`reports` contiene el estado visible de la aplicación. `outbox` implementa el patrón **Transactional Outbox**: representa los cambios que deben viajar al servidor.

Al guardar, ambos almacenes se modifican dentro de una transacción. Si el usuario edita varias veces el mismo reporte antes de sincronizar, la cola conserva únicamente la operación más reciente.

### 5.3 Sincronización con la API

El frontend toma las operaciones pendientes y las envía en un lote:

```ts
// client/src/sync.ts
const response = await fetch("/api/reports/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ operations }),
});
```

Después procesa cada resultado:

- `accepted`: elimina la operación de la cola y marca el reporte como sincronizado.
- `conflict`: elimina la operación enviada, conserva la copia local y adjunta la versión actual del servidor para que el usuario decida.

Finalmente descarga los reportes del servidor. Los datos recibidos nunca sobrescriben un cambio local pendiente.

### 5.4 Service Worker y estrategias de caché

El Service Worker se registra al cargar React:

```ts
// client/src/main.tsx
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
```

Se aplican estrategias distintas según el recurso:

| Recurso | Estrategia | Comportamiento |
| --- | --- | --- |
| Navegación HTML | Network First | Busca la versión reciente y usa el shell guardado si la red falla. |
| JavaScript, CSS e íconos | Stale While Revalidate | Responde desde caché y actualiza la copia en segundo plano. |
| `/api/*` | Sin caché HTTP | Los registros se coordinan explícitamente mediante IndexedDB. |

La API de Background Sync se usa como mejora progresiva:

```js
// client/public/sw.js
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-bitacora") {
    event.waitUntil(syncOutbox());
  }
});
```

Como Background Sync no está disponible de forma uniforme en todos los navegadores, la aplicación también escucha el evento `online` e incluye el botón **Sincronizar ahora**.

### 5.5 API con Express y TypeScript

Express expone tres rutas:

```text
GET  /api/health          Estado de la API
GET  /api/reports         Reportes almacenados en el servidor
POST /api/reports/sync    Sincronización de operaciones locales
```

La ruta de sincronización valida el lote y delega el control de versiones al repositorio:

```ts
// server/src/app.ts
app.post("/api/reports/sync", async (request, response) => {
  const operations = request.body?.operations;
  const results = await repository.synchronize(operations);
  response.json({ results });
});
```

La implementación real incluye validación de tipos, límites de longitud y un máximo de 100 operaciones por solicitud.

### 5.6 Idempotencia y conflictos

Cada cambio usa dos datos importantes:

- `operationId`: identificador único de la operación. Si se reintenta la misma petición, la API devuelve el resultado anterior y no duplica el registro.
- `baseVersion`: versión que el cliente conocía cuando editó. Si no coincide con la versión actual del servidor, la API devuelve `conflict`.

```ts
// server/src/repository.ts
if (existing && operation.report.baseVersion !== existing.version) {
  result = {
    operationId: operation.operationId,
    status: "conflict",
    report: existing,
  };
}
```

En la interfaz, el usuario puede escoger **Usar servidor** o **Conservar la mía**. La segunda opción vuelve a encolar la copia local tomando como base la versión más reciente.

## 6) Ejecutar el proyecto

```bash
npm run dev
```

Servicios de desarrollo:

- Aplicación: `http://localhost:5173`
- API: `http://localhost:3000`

Vite redirige automáticamente las solicitudes `/api` hacia Express, por lo que el frontend usa rutas relativas tanto en desarrollo como en producción.

## 7) Probar el funcionamiento Offline-First

### Demostración rápida

1. Abrir la aplicación.
2. Pulsar **Simular corte**.
3. Crear un reporte.
4. Comprobar que aparece como **Pendiente**.
5. Pulsar **Restaurar señal**.
6. Esperar la sincronización automática o pulsar **Sincronizar ahora**.
7. Comprobar que el estado cambia a **Sincronizado**.

### Prueba real del caché

1. Cargar la aplicación una vez con conexión.
2. Abrir las herramientas del navegador.
3. En la pestaña **Network**, seleccionar **Offline**.
4. Recargar la página.
5. La interfaz debe seguir disponible gracias al Service Worker.

El botón **Simular corte** pausa las llamadas de sincronización para facilitar la exposición. No desactiva físicamente la red ni sustituye la prueba real del Service Worker.

## 8) Construir para producción

```bash
npm run check
npm run build
npm start
```

La aplicación completa queda disponible en `http://localhost:3000`. Express sirve la compilación de React y la API desde el mismo origen.

## 9) Ejecutar con Docker

```bash
docker compose up --build
```

Abrir `http://localhost:3000`.

El volumen `bitacora-data` conserva `reports.json` aunque el contenedor se reinicie.

Para detenerlo sin borrar los datos:

```bash
docker compose down
```

## 10) Conceptos clave usados

- **PWA:** aplicación web instalable con manifiesto y Service Worker.
- **App Shell:** estructura visual mínima guardada para poder abrir la interfaz sin red.
- **Cache Storage:** almacenamiento de respuestas HTTP controlado por el Service Worker.
- **IndexedDB:** base de datos transaccional del navegador para información estructurada.
- **Outbox:** cola persistente de operaciones aún no confirmadas por el servidor.
- **Optimistic UI:** la interfaz acepta el cambio local antes de recibir respuesta de la API.
- **Sincronización progresiva:** Background Sync cuando existe, evento `online` y acción manual como alternativas.
- **Control optimista de concurrencia:** comparación de versiones antes de sobrescribir datos.
- **Idempotencia:** repetir una operación no genera registros duplicados.

## 11) ¿Por qué esta aplicación es resistente?

- Los datos del formulario se guardan antes de intentar usar la red.
- El caché de la PWA y la base IndexedDB cumplen funciones separadas.
- La cola sobrevive a recargas y cierres del navegador.
- Las peticiones pueden reintentarse sin duplicar reportes.
- Los cambios remotos no sobrescriben silenciosamente los locales.
- La sincronización manual evita depender de una API experimental.
- Docker monta la persistencia del servidor en un volumen.

## 12) Comparativa rápida

| Enfoque | Sin conexión | Persistencia local | Manejo de conflictos | Complejidad |
| --- | --- | --- | --- | --- |
| SPA tradicional | La interfaz puede fallar o quedar bloqueada | Opcional | Normalmente no | Baja |
| `localStorage` solamente | Limitado | Sí, pero sin transacciones ni consultas avanzadas | No incluido | Baja |
| PWA solo con caché | Abre la interfaz | El caché no es una base de datos de negocio | No incluido | Media |
| Esta demo Offline-First | Interfaz y creación de reportes | IndexedDB transaccional | Versionado y decisión del usuario | Media |
| Solución empresarial distribuida | Sí | Base local especializada | Reglas por dominio, auditoría y fusiones | Alta |


## 13) Comandos disponibles

```bash
npm run dev      # inicia React y Express
npm run check    # comprueba los tipos de ambos proyectos
npm run build    # genera la compilación de producción
npm start        # sirve frontend y API en el puerto 3000
```

