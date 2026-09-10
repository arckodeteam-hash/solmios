# monitoreo-plataforma-real

## Intent

Que `/admin/monitoring` **mida el sistema de verdad**: respuestas de API reales, errores recientes
reales, estado real de la base de datos y del disco, y que desde ahí se pueda **hacer un backup de la
base y descargarlo**. Hoy la pantalla es una maqueta: la mayor parte de lo que muestra está escrito a
mano en el HTML.

Referencia MisterPlan: no aplica — MisterPlan no expone un panel de operación de la plataforma. Esto
es infraestructura propia del SaaS (el equivalente sería el panel de estado de su proveedor de
hosting, que no forma parte del producto que replicamos).

## El problema, con evidencia

`frontend/src/pages/super-admin/monitoring.vue` promete "Servidores · API · Base de datos · Errores"
(línea 7). De lo que muestra:

| Dato en pantalla | Realidad | Evidencia |
|---|---|---|
| API Gateway 99.99% · 247 pet/min · 45 ms | Literal en el HTML | `monitoring.vue:26,33,37` |
| Base de datos 8.2 GB · 34/100 conexiones · 1.240 q/s | Literal en el HTML | `monitoring.vue:44,52,56` |
| CDN/Storage 24.5 GB · **AWS S3 · CloudFront** | Literal, y **el proyecto no usa S3** (uploads locales servidos por nginx) | `monitoring.vue:63,65` |
| Email 1.892 enviados · **SendGrid** · 68.9% apertura | Literal, y el proyecto usa **SMTP/Resend/Brevo** | `monitoring.vue:81,83,93` |
| CPU 34% · Memoria 62% · Disco 45% · Uptime 42 días | Literal (y el uptime real aparece más abajo, distinto) | `monitoring.vue:146,157,168,178` |
| "Errores Recientes · 3 activos" | Badge literal sobre una lista **siempre vacía** | `monitoring.vue:117`, `monitoring.vue:229` |
| "Backups Automáticos" | Lista **siempre vacía**; el botón "Forzar Backup Ahora" **no tiene handler** | `monitoring.vue:231,192` |
| Tiempos de Respuesta API | Lee `monData.peticionesAudit`, que **el backend nunca devuelve** | `monitoring.vue:222` vs `dashboard-queries.ts:getMonitoring` |
| "Todos los sistemas operativos" / botón Refrescar | Literal / sin handler | `monitoring.vue:11,13` |

Lo único real que llega del backend son cinco contadores y `uptime`/`memoria` del proceso
(`admin/usecases/dashboard-queries.ts` → `getMonitoring`).

**No existe en el código**: registro de peticiones HTTP consultable, registro de errores, backups
(`grep -rin "pg_dump\|backup" backend/src` → 0 resultados), tamaño de la base, conexiones, uso de
disco ni de CPU.

## Lo que SÍ existe y hay que mostrar (no construir)

La auditoría encontró infraestructura real que hoy no se ve en ninguna pantalla:

- **Webhooks salientes** — `modules/webhooks`: firma HMAC-SHA256, **3 reintentos con backoff
  1s/3s/9s**, y cada intento persistido en `webhook_deliveries` (`event`, `statusCode`, `success`,
  `attemptedAt`). `usecases/dispatch.ts:64-88`. La UI solo muestra un contador `delivered`
  (`api-keys.vue:105`): no se puede ver **qué** falló, con qué código ni cuándo.
- **Cola de Channex** — `modules/ari-outbox`: cola con estados, reintento manual, stats y config,
  con tests de concurrencia y e2e.
- **Cola de email** — `modules/email-queue` con worker.
- **Auditoría** — `Auditlog`, ya ordenada por fecha.
- **11 crons** registrados en `composition-root.ts:20-30`.

## Alcance

1. Instrumentar HTTP: cada petición registra método, ruta normalizada, estado y duración.
2. Registrar errores (4xx de servidor y 5xx) con detalle, **persistidos** para que sobrevivan a un
   reinicio.
3. Medir de verdad: base de datos (tamaño, conexiones), disco, CPU, memoria, uploads, colas.
4. **Backups de la base**: crear, listar, descargar y borrar, desde el panel.
5. Reescribir la pantalla sin un solo dato inventado.
6. Superficie de observabilidad para lo que ya existe: entregas de webhook y estado de las colas.

## Fuera de alcance

- Métricas históricas de largo plazo (30/90 días) y alertas por email/WhatsApp. Requieren una serie
  temporal persistida; se evalúan después con el costo de escritura medido.
- Reemplazar `requestLogger` (log de texto a journalctl). Convive.
- Backups de los archivos de `uploads/` — solo base de datos en esta entrega.

## Riesgo y rollback

| Riesgo | Mitigación |
|---|---|
| El middleware de métricas agrega latencia a TODA petición | Escritura en memoria O(1), sin I/O en el camino de la petición. Los errores se persisten fuera del ciclo de respuesta. |
| Cardinalidad de rutas: `/api/reservas/<uuid>` explotaría el buffer | Normalizar la ruta (UUIDs y números → `:id`) antes de agregar. Tope duro de rutas distintas. |
| **Un backup es un volcado completo de datos de todos los hoteles** | Solo `super_admin`; el archivo se guarda fuera de la raíz servida por nginx; descarga por endpoint autenticado; nombre validado contra path traversal. |
| `pg_dump` puede no estar en el servidor o tardar | Verificación previa del binario con error claro; ejecución con timeout; el estado del backup se refleja en la UI. |
| Un backup grande llena el disco | Retención configurable con tope de cantidad; el borrado del más viejo es explícito. |

**Rollback**: los cambios son aditivos. Quitar `router.use(httpMetrics())` de `composition-root.ts`
desactiva la instrumentación sin tocar nada más; la pantalla vuelve al commit anterior; la tabla de
errores queda huérfana sin romper el arranque (`CREATE TABLE IF NOT EXISTS`).

## Módulos afectados

- `backend/src/shared/observability/` (nuevo)
- `backend/src/modules/admin/` (endpoints, usecases)
- `backend/src/composition-root.ts` (registrar middleware)
- `frontend/src/pages/super-admin/monitoring.vue` (reescritura)
- `frontend/src/services/Platform.service.ts`
