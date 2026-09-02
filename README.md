# Bitácora Cero Señal

Demo para exponer el tema **Aplicaciones web Offline-First**. Es una bitácora de reportes que permite crear y editar registros sin conexión, los conserva en el navegador y los sincroniza con una API cuando vuelve la señal.

La aplicación está pensada para que la demostración sea segura durante una exposición: incluye un botón **Simular corte**, estados visibles de **Pendiente**, **Sincronizado** y **Conflicto**, además de sincronización manual como respaldo.

## Qué se demuestra

- **PWA:** manifiesto instalable y Service Worker.
- **Caché:** el Service Worker guarda la interfaz y permite volver a abrirla sin red.
- **IndexedDB:** conserva reportes y una cola de operaciones en el dispositivo.
- **Sincronización:** envía la cola a una API Express al recuperar conexión.
- **Consistencia:** cada registro tiene una versión; si dos dispositivos modifican la misma versión, la interfaz pide elegir qué copia conservar.
- **Respaldo manual:** el botón **Sincronizar ahora** evita depender únicamente de Background Sync, cuyo soporte no es uniforme.

## Arquitectura

```text
Usuario
  │
  ▼
React + TypeScript
  │  guarda primero
  ▼
IndexedDB ─────► Cola de salida (outbox)
  ▲                         │
  │                         │ vuelve la conexión
  │                         ▼
Service Worker       POST /api/reports/sync
  │                         │
  └── caché PWA             ▼
                    Express + versionado
                             │
                             ▼
                      data/reports.json
```

El frontend nunca espera a la API para aceptar el trabajo del usuario. Primero escribe localmente y después intenta sincronizar. Ese orden es la idea central de **Offline-First**.

## Tecnologías

- React 19, Vite y TypeScript.
- IndexedDB sin abstracciones, para que el código educativo muestre la API del navegador.
- Service Worker escrito a mano con caché de la interfaz y Background Sync progresivo.
- Node.js, Express 5 y TypeScript.
- Docker y Docker Compose.
- Persistencia de demostración en JSON, montada en un volumen de Docker.

## Ejecutar en desarrollo

Requisitos: Node.js 20 o superior y npm.

```bash
npm install
npm run dev
```

Abrir `http://localhost:5173`. Vite sirve el frontend y redirige `/api` hacia Express en `http://localhost:3000`.

Comandos disponibles:

```bash
npm run dev      # frontend y API en modo desarrollo
npm run check    # comprobación de TypeScript
npm run build    # compilación de producción
npm start        # sirve la app compilada desde Express
```

Después de `npm run build`, `npm start` publica frontend y API juntos en `http://localhost:3000`.

## Ejecutar con Docker

```bash
docker compose up --build
```

Abrir `http://localhost:3000`. Los datos del servidor quedan en el volumen `bitacora-data` y sobreviven al reinicio del contenedor.

Para detener la aplicación:

```bash
docker compose down
```

No agregues `-v` si quieres conservar los datos de la demo.

## Guion de exposición para cuatro integrantes

Duración sugerida: **10 a 12 minutos**.

### Integrante 1 — Problema y enfoque (2 minutos)

1. Plantear el caso: técnicos en campo, estudiantes o personal de salud pueden trabajar con señal intermitente.
2. Aclarar la diferencia: una app tradicional intenta guardar en el servidor y falla; una app Offline-First guarda primero en el dispositivo.
3. Presentar el flujo de la pantalla y señalar el estado **En línea**.
4. Frase clave: *“Offline-First no significa sin servidor; significa que perder la conexión no interrumpe la tarea principal.”*

### Integrante 2 — PWA, Service Worker y caché (2 a 3 minutos)

1. Explicar que el manifiesto permite instalar la app y que el Service Worker se ubica entre la página y la red.
2. Contar la estrategia usada:
   - Navegación: **Network First**, con la versión en caché como respaldo.
   - Recursos estáticos: **Stale While Revalidate**, muestra el caché y actualiza en segundo plano.
   - API: no se cachea; los datos se gestionan con IndexedDB para evitar mezclar interfaz y registros.
3. Si se desea una prueba real, cargar la página una vez, activar **Offline** en las herramientas del navegador y recargar. La interfaz debe seguir abriendo.
4. Advertir que una caché antigua es un riesgo; el nombre `bitacora-shell-v1` permite invalidarla cambiando la versión.

### Integrante 3 — IndexedDB y demo sin conexión (3 minutos)

1. Pulsar **Simular corte**. El indicador cambia a **Sin conexión**.
2. Crear un reporte, por ejemplo:
   - Título: `Antena sin cobertura en bloque C`
   - Detalle: `El dispositivo registra la medición aunque la red no responde.`
   - Prioridad: `Alta`
3. Mostrar que aparece inmediatamente como **Pendiente** y aumenta el contador **Por sincronizar**.
4. Explicar que se hicieron dos escrituras atómicas en IndexedDB:
   - El reporte local.
   - Una operación en la cola `outbox`.
5. Frase clave: *“La pantalla no está fingiendo: el dato ya está persistido en el navegador.”*

### Integrante 4 — Sincronización, límites y cierre (3 minutos)

1. Pulsar **Restaurar señal**. La app sincroniza automáticamente.
2. Si no ocurre de inmediato, usar **Sincronizar ahora**. El reporte cambia de **Pendiente** a **Sincronizado**.
3. Explicar que la API guarda un número de versión y recuerda el identificador de cada operación. Esto evita duplicados si se reintenta una petición.
4. Presentar el límite: dos dispositivos pueden editar la misma versión. El segundo en sincronizar recibe un **Conflicto** y puede escoger **Usar servidor** o **Conservar la mía**.
5. Cerrar con ventajas y límites:
   - Ventajas: continuidad, respuesta inmediata y menor dependencia de la red.
   - Límites: datos temporalmente desactualizados, conflictos y soporte desigual de Background Sync.
   - Prevención aplicada: estados visibles, versionado, sincronización manual y pruebas del caché.

## Demo de conflicto opcional

Para provocar un conflicto real se necesitan dos almacenes locales independientes, porque dos pestañas normales comparten IndexedDB:

1. Abrir la aplicación en una ventana normal y en una ventana privada.
2. Sincronizar ambas para que tengan el reporte inicial con versión 1.
3. Activar **Simular corte** en las dos.
4. Editar el mismo reporte de manera diferente en cada ventana.
5. Restaurar la señal en la primera ventana; su cambio se convierte en versión 2.
6. Restaurar la señal en la segunda; verá el estado **Conflicto**.
7. Elegir **Usar servidor** o **Conservar la mía** y explicar la decisión.

## Estrategias de caché incluidas

| Recurso | Estrategia | Motivo |
| --- | --- | --- |
| Navegación HTML | Network First | Intenta obtener la versión reciente y usa el shell guardado si falla. |
| JS, CSS, ícono y manifiesto | Stale While Revalidate | Entrega rápido lo conocido y refresca el caché. |
| `/api/*` | Sin caché del Service Worker | Los registros usan IndexedDB y reglas explícitas de sincronización. |

## Protocolo de sincronización

El cliente envía operaciones a `POST /api/reports/sync`. Cada operación contiene:

- `operationId`: clave idempotente para que un reintento no duplique datos.
- `reportId`: identificador estable del reporte.
- `baseVersion`: versión del servidor que el cliente editó, o `null` para un registro nuevo.
- El contenido y las fechas del reporte.

La API responde `accepted` con la nueva versión o `conflict` con la copia actual del servidor. Antes de enviar, la cola compacta ediciones repetidas del mismo registro para mandar solo la última.

## Riesgos y prevención aplicada

| Riesgo | Prevención en la demo |
| --- | --- |
| Cargar una versión antigua | Caché con nombre versionado y actualización en segundo plano. |
| Background Sync no disponible | Detección de conexión y botón de sincronización manual. |
| Duplicar un registro por reintento | `operationId` idempotente almacenado por la API. |
| Sobrescribir cambios de otro dispositivo | Control optimista con `baseVersion` y resolución explícita. |
| Cerrar la pestaña con cambios pendientes | Cola y reportes persistidos en IndexedDB. |
| Reiniciar el contenedor | Volumen de Docker para el archivo del servidor. |

## Dónde mirar en el código

- `client/src/db.ts`: base IndexedDB y cola de salida.
- `client/src/sync.ts`: envío y descarga de datos.
- `client/public/sw.js`: caché PWA y Background Sync.
- `client/src/App.tsx`: estados visuales y flujo de la demo.
- `server/src/repository.ts`: persistencia, idempotencia y control de versiones.
- `server/src/app.ts`: endpoints y validación de la API.

## Antes de exponer

1. Ejecutar la demo una vez con internet para instalar el Service Worker y llenar el caché.
2. Confirmar que **Simular corte → crear → Restaurar señal** funciona.
3. Si se mostrará la recarga sin red, ensayarla en el mismo navegador y origen que se usará en clase.
4. Evitar limpiar los datos del sitio antes de presentar.
5. Tener Docker ya construido y `npm install` completado para no depender de descargas durante la exposición.
