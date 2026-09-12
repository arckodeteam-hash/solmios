# ManagerHotel (SOLMI OS) — CLAUDE.md

## Stack
Bun (>=1.3) + Vue 3.5 + Vite 8 + Pinia 3 + Vue Router 5.1 + Tailwind CSS 4.3 + arckode-framework 1.6.2 + **DB multi-motor** (SQLite bun:sqlite/WAL en dev · Postgres `pg` en prod, elegido por `DATABASE_URL`)

## Estado SDD (cambios activos)

> Changelog e historial de commits: `git log`. Acá solo estado no derivable del repo.

- **match-misterplan**: base ✅ (rates grid, i18n). Pendiente 7.2.2/7.2.3 WhatsApp (**bloqueado** por creds Meta).
- **pms-competitive-gaps**: mayoría ✅ + debt documentada (PC-4 SW desactivado, PC-3.1.2 Checkout Session cumple).
- **frontend-coverage-gaps**: GATES automáticos ✅. GATES manuales (reports/switcher/PWA en prod) sin validar.
- **wizard-refactor** (`docs/wizard-refactor/`): ✅ F0-F5 completas. Ubicación + identidad pública movidas de Configuración a Página pública (F1); `OnboardingStep[]` con 6 pasos de perfil granulares + `kind:'profile'|'external'` (F2); Centro de configuración nuevo en `/panel/configuracion-inicial` (F3); dashboard usa `ProfileProgressBar.vue` (franja fina, % solo sobre pasos requeridos) en vez de `OnboardingGuide.vue` (retirado, F4). Copy en registro "usted". Deuda residual menor: `pagina-publica/ubicacion.vue` (de F1, anterior a la decisión de tono) sigue en voseo — fuera del alcance acotado por el usuario para la conversión a "usted".
- **canales-admin-gestion-real** (`openspec/changes/canales-admin-gestion-real/`, GitHub epic #121, issues #122-#128): ✅ COMPLETO y en producción (2026-09-10, PR #184 + `49386c4d`; epic y #122-#128 cerrados). ⚠️ `planExpiresAt` está **VACÍO y así queda mientras prod apunte a `staging.channex.io`**: esa cuenta **no tiene plan ni vencimiento** (verificado 2026-09-10 en Organization → Billing: "Usage Details: Nothing here yet"). El 2026-09-10 se había cargado `2026-09-09` confundiéndolo con el trial del hotel en SolmiOS (`subscriptions.trialEndsAt`) y la tarjeta mostró en rojo "Plan de Channex vencido" sin fundamento; se vació. No volver a cargar una fecha ahí. **Channex NO expone el vencimiento por API**: el campo vuelve a importar cuando se migre a la cuenta de producción (`app.channex.io`) con plan pago — se carga desde la tarjeta y la alerta ya está verificada. **Pendiente de OPERACIÓN, no de código**: el webhook de reservas de Channex no está registrado (las reservas de OTAs entran solo por cron, con retraso — la tarjeta lo avisa en ámbar) y hay 5 properties huérfanas en la cuenta. `/admin/channels` dejó de ser una tabla con `<select>` libre: `channel_requests` tiene ciclo de vida con transiciones (`pending → scheduled → in_progress → waiting_hotel → connected|rejected`, cualquier otra = 409), cita obligatoria con fecha/medio/contacto, historial en `channel_request_activities`, avisos (correo al soporte + campanita al super-admin al entrar el pedido; 3 plantillas de plataforma al hotel al agendar/conectar/rechazar) y cron diario 08:00 de citas de hoy/vencidas. La tarjeta de cuenta Channex muestra webhook, properties huérfanas y vencimiento del plan. En prod ya corrieron `RUN_MIGRATE=1` y `seed-platform-email-templates.ts --refresh` (20 plantillas).
- **admin-soporte-real** (`openspec/changes/admin-soporte-real/`, GitHub epic #120, issues #129-#136): ✅ COMPLETO (2026-09-11). `/admin/support` lee la API real: tickets enriquecidos con `requester`/`hotel`/`assignee` (una consulta a `users` y una a `hotels` por página), conversación en `messages` con autor resuelto por el server (`POST /api/tickets/:id/messages`, `authorKind: 'support'` + nombre real, nunca del body), estados reales (`open → in_progress → resolved → closed`), caché versionada por hotel + global, sin gate por plan `operations.maintenance`, "Entrar como {solicitante}" que audita `auth.impersonate` con el ticket en `detail` y aterriza en `/panel/support?ticket=<id>`. El hotel ve "Atendido por {agente}" y recibe notificación `type: 'support'` (campanita → `metadata.link`) + email al solicitante si el correo está configurado (connector `tickets-notificaciones`). Recorrido de punta a punta verificado en Chromium el 2026-09-11 (§8.2 de tasks.md). **Deudas**: `support:*` como permiso propio (hoy usa el gate de admin) · adjuntos en tickets (control retirado, sin upload) · ⚠️ caché del listado para un super_admin **con** `hotelId` (el seed de prod lo tiene): `TicketsService.list` arma la clave con `currentUser.hotelId` y las mutaciones de otros hoteles solo bumpean el hotel del ticket + `all`, así que `/admin/support` muestra el listado viejo hasta 300 s (F5 no alcanza; visto en el recorrido) — la clave debería usar `'all'`/`query.hotelId` para `super_admin`.
- **admin-facturacion-real** (`openspec/changes/admin-facturacion-real/`, epic #152, issues #153-#157): ✅ COMPLETO y en producción (2026-09-10). `/admin/billing` ya no fabrica facturas desde `listSubscriptions`: existe `platform_invoices` (la llenan los webhooks de Stripe + `scripts/backfill-platform-invoices.ts`), endpoints `/api/admin/billing/*` con filtros server-side, recordatorio con dedup de 24 h y pago manual que reactiva la suscripción vía el connector `admin-subscriptions-billing`. En prod: tabla + índice único creados, backfill corrido (2 facturas históricas) y `invoice.finalized`/`invoice.voided` habilitados en el endpoint de webhook de Stripe (`we_1UDo3YAmbL9UHRkUtNJOA12j`) — si se recrea el endpoint, hay que volver a tildarlos.
- **pipeline-ventas-trials** (`openspec/changes/pipeline-ventas-trials/`, epic #143, issues #144-#151): Fases A y B ✅ en prod 2026-09-10. Epic cerrado; pendiente solo §10.2 → issue #181 (medir `paying/registered` a las 4 semanas, dato de partida 2026-09-10: embudo 8 sem = 15 registrados / 60% activan / 13.3% pagan). Screenshots de QA en `docs/evidencia/pipeline-ventas/`.
- **monitoreo-plataforma-real** (`openspec/changes/monitoreo-plataforma-real/`, epic #96, issues #113-#119): ✅ COMPLETO y en prod (PR #170, 2026-09-10). `/admin/monitoring` mide de verdad (métricas HTTP en memoria, `error_logs`, salud de sistema/BD, colas) y `/api/admin/backups` crea/lista/descarga/borra volcados `pg_dump` en `BACKUP_DIR` (default `backend/data/backups`, fuera de nginx). Restore en base limpia verificado en prod el 2026-09-10 (§7.4 de tasks.md). Runbook: `docs/BACKUP-RESTORE.md`.
- **restaurante-pos-real** (GitHub epic #202, issues #203-#217): auditoría 2026-09-11 del módulo Restaurante (salón, comanda, KDS, cobrar, caja, carta) sobre prod + código. El circuito completo funciona y la plata va a `payments`/caja del restaurante/folio; lo que falta es de POS de uso diario: ~~vistas en pestañas (#203)~~ ✅ (2026-09-11: `components/ui/PillTabs.vue` compartido — `v-model`, `count`, a11y tablist/teclado, `query-param` para `?tab=`; Carta muestra una sección por vez (Ítems por defecto) y Caja lo usa sin cambiar comportamiento; regla + lista de vistas a migrar en la skill `solmios-ui` §6), ~~Salón (#204)~~ ✅ (2026-09-11: zonas en pestañas `?tab=<slug>`, refresco cada 15 s sin vaciar la lista y pausado con modal abierto (`openModalCount`), mesa ocupada con hora/tiempo/total/mozo — mozo por `/usuarios`, nunca employee-profiles —, menú "⋯" siempre visible en vez de `group-hover`, `occupied` sin comanda en ámbar; lógica pura en `salon-helpers.ts`), ~~anulaciones con motivo + auditoría (#207)~~ ✅ (2026-09-11: `voided` en `restaurant_order_items` con `voidReason/voidedBy/voidedAt`; `POST /orders/:id/items/:lineId/void {reason}` y `/cancel {reason}` obligatorio; `DELETE` de una línea ya confirmada a cocina → 409 (una `new` sin `sentAt`, agregada después del envío, se sigue quitando con `restaurant:delete`, #210); el KDS ya no transiciona a `cancelled` — "Cancelar" abre `VoidReasonModal` con los motivos de `configuration('restaurant_void_reasons')` (`GET/PUT /api/restaurant/void-reasons`, sin pestaña de UI todavía); connector `restaurante-auditlog.ts` registra `restaurant.line.voided|order.cancelled|order.refunded`. `isLineActive()` en `order-totals.ts` es el ÚNICO lugar que decide qué línea cuenta — no comparar `status` a mano), cargo a habitación sin tipear UUID (#209), y lo que no existe: tiempo real, cierre del día, dividir cuenta, descuentos, impresión. Orden y dependencias en el epic. Hecho: #206 (bug de dinero de modificadores) y **#205 permisos coherentes**: permiso nuevo `restaurant:pay` (cobrar/cargar a habitación/propina; kitchen no lo tiene), `DELETE /orders/:id/items/:lineId` con la comanda `open` exige `restaurant:create` (el mismo permiso que agregar la línea: el mozo quita una mal cargada, cocina no; enviada → 409, se anula con motivo vía #207), `PaySchema.method` con enum `cash|card|transfer` (espejo `POS_PAYMENT_METHODS` en `Caja.service.ts`), y `frontend/src/config/restaurant-routes.ts` es la ÚNICA tabla ruta→permiso del POS: alimenta `meta.permission` del router (guard global, aplica a roles de sistema y custom, rebota a `/panel` con aviso) y las entradas del sidebar (que además exigen el `view` del módulo, igual que el router). `/panel` manda a mozo/cocina a la primera vista del POS que su PERMISO abre (`posLandingFor`), no a Salón/KDS por nombre de rol: un rol de sistema personalizado sin `restaurant:create` entraba en bucle `/panel → salon → /panel`. Consecuencias: el mozo ahora ve el KDS en el menú (`restaurant:edit`, mismo permiso con el que la API ya le dejaba `PUT /kds/lines/:id`); un rol custom con SOLO `restaurant:view` ya no abre Salón/Caja (exigen `create`, que es lo que kitchen no tiene — sin eso cocina entraba por URL). **Los permisos efectivos salen de la fila de `roles`, no del mapa estático**: por eso `restaurant:pay` llega a las filas existentes con un backfill dentro de `migrate-db.ts` (`scripts/backfill-restaurant-pay-permission.ts`, corre en cada deploy) y la matriz de `/panel/roles` dibuja la columna Cobrar. `signup.ts` escribía `isSystem` (campo que el modelo `Roles` no declara → descartado): todos los roles de sistema de prod tienen `system=0`; corregido a `system: 1` para altas nuevas, las filas viejas siguen en 0. **#210 la comanda deja de ser ciega tras enviar**: dos columnas nuevas — `restaurant_orders.covers` (comensales; solo `dine_in`, default 1, se eligen de un toque al abrir la mesa desde el salón) y `restaurant_order_items.sentAt` (confirmación a cocina). `sentAt` es el ÚNICO discriminador entre una línea recién cargada y una ya despachada — las dos siguen en `status:'new'` hasta que cocina la toma — y **NO filtra el KDS**: la cola sigue mostrando toda línea activa de una comanda en fase de cocina, así que un mozo que se olvide de confirmar no deja el plato sin hacer. `POST /orders/:id/send` pasó a aceptar comandas ya enviadas (`sent|preparing|ready|served`) y es idempotente: re-envía solo las líneas sin `sentAt` y, sin ellas, devuelve 200 y no 409. En `comanda.vue`: badge de estado por línea con la paleta del KDS (`LINE_STATUS_BADGE`, compartido desde `Restaurant.service.ts`), refresco cada 15 s SOLO en fase de cocina, nota por línea (viaja en el mismo `PUT /items/:lineId`; el header de un combo no la ofrece porque el KDS lo excluye de la cola y `updateLine` rechaza sus componentes) y bloqueo por ítem de 300 ms con las altas encoladas, en vez del `busy` global que apagaba la carta entera y descartaba el toque siguiente. Las dos columnas las crea `ormMigrate` (`RUN_MIGRATE=1`, que el auto-deploy ya corre) y NO necesitan backfill: `covers` null = comanda anterior al campo, `sentAt` null en una comanda viva al momento del deploy solo hace aparecer el botón de re-envío una vez.
- **Deploy (2026-09-11)**: el sitio se caía en CADA deploy (403 en `/`, 404 en `/panel/*`) porque `vite build` vacía `dist/` al empezar y la sesión SSH de Actions moría a los ~5 min dejando builds huérfanos solapados. Fix en dos capas: `/root/deploy-solmios.sh` (server, fuera del repo: `flock` + build en `dist-next/` + swap atómico + `timeout` + `tee`) y PR #200 (keepalive SSH en el workflow). Detalle en la skill `ssh-solmios`.
- **mobile-app**: OTRO profesional (Flutter, repo `solmios-mobile`). **NO scope — no tocar.**

## Database — Migraciones y Seeders

Schema en **2 capas** que se corren en orden sobre DB limpia:

```bash
cd backend
# Paso 1 — tablas desde modelos ORM. system.init() registra modelos, ormMigrate hace CREATE TABLE IF NOT EXISTS, NO bindea puerto HTTP.
DATABASE_URL=postgres://... RUN_MIGRATE=1 bun run src/composition-root.ts   # Postgres
DB_PATH=data/managerhotel.db RUN_MIGRATE=1 bun run src/composition-root.ts  # SQLite

# Paso 2 — seed demo + tablas EXTRA no-modeladas (packages, devices, announcements, api_keys, audit_log, configuration, email_queue, groups, maintenance, tickets, notifications, ai_*).
bun run migrate-db.ts
```

**Orden insaltable**: `migrate-db.ts` corre `seedBase()` (INSERT en hotels/users/...) ANTES de crear tablas extra, y NO crea las tablas base. Solo sobre DB vacía → `no such table: hotels`.

### Scripts
| Script | Qué hace | Idempotente |
|--------|----------|-------------|
| `migrate-db.ts` (`bun run migrate`) | DDL tablas extra + seeds demo (24 tablas) | ✅ `exists()`/`COUNT(*)` + `ON CONFLICT` |
| `RUN_MIGRATE=1 composition-root.ts` | Tablas desde modelos ORM | ✅ `CREATE TABLE IF NOT EXISTS` |
| `scripts/orm-migrate.ts` | `ormMigrate(db, models)` — copia del kernel | ✅ |
| `scripts/seed-default-roles.ts` | Roles por defecto (permisos) — solo hoteles SIN roles; no toca filas existentes | ✅ |
| `scripts/backfill-restaurant-pay-permission.ts` (lo llama `migrate-db.ts`, NO se corre aparte) | Agrega `restaurant:pay` (#205) a las filas de `roles` cuyos permisos VÁLIDOS (`isValidPermission`) hoy incluyen `restaurant:edit` — lo que antes habilitaba cobrar — salvo `kitchen` (su default no lo trae: es lo que #205 corrige). Nunca quita nada; NO toca filas con `[]`, JSON corrupto o formato viejo con punto (`billing.read`): esas caen al default en runtime y escribirles `['restaurant:pay']` pelado las dejaría con ese único permiso. Sin esto `/bill`, `/pay` y `/charge-to-room` daban 403 a mozo/recepción/hotel_admin de todo hotel existente. `sync-system-roles.ts` NO servía: las filas del alta tenían `system=0`. | ✅ (0 filas en la segunda corrida; test en `restaurant/tests/restaurant-pay-backfill.test.ts`) |
| `scripts/backfill-reservation-source-web.ts` (lo llama `migrate-db.ts`, NO se corre aparte) | Pasa a `source='web'` (#247, REQ-RWP-04) las reservas `source='direct'` con `accessToken` no nulo ni vacío: sólo el motor público lo setea (`public-booking.ts`, `public-booking-group.ts`, `stripe.ts`), `/api/panel/reservas` lo deja NULL. Desde #247 el motor escribe `source:'web'` (`channel` sigue `direct`); sin esto las reservas web anteriores seguían como "Directa" en el listado. Todo en SQL, sin nombres de columna en JS (Postgres pliega a minúsculas). | ✅ (segunda corrida: 0 filas; test en `reservas/tests/backfill-source-web.e2e.test.ts`) |
| `scripts/create-plans-table.ts` | Tabla `plans` (SaaS subscriptions). Multi-motor desde la auditoría Meta 2026-08-26 (antes Postgres-only, sin forma de probar el catálogo en dev local). | ✅ |
| `scripts/fix-essential-plan-hierarchy.ts` | Corrige `plan-essential` (auditoría Meta 2026-08-26): tenía 20 habitaciones a $99, menos que Starter (30 hab. a $49) y el mismo precio que Professional (100 hab.) — jerarquía que no cierra. Sube a 35 habitaciones y reordena al lado de Professional. `create-plans-table.ts` es insert-only, así que un entorno donde `plan-essential` ya existía con los valores viejos necesita este UPDATE explícito. **Correr en prod tras el deploy si el plan ya existía.** | ✅ (UPDATE por id, no-op si no existe) |
| `scripts/add-user-type-{pg,}.ts` | ALTER `users.userType` | ✅ `addColumnIfMissing` |
| `scripts/drop-users-role-check.ts` | Elimina el CHECK vestigial de `users.role` (bloqueaba roles custom y 'housekeeper'/'supervisor' → 500). SQLite recrea la tabla sin el CHECK; PG imprime el `ALTER DROP CONSTRAINT`. **Correr en prod PG.** | ✅ (no-op si no hay CHECK) |
| `scripts/seed-legal-pages.ts` | Crea o **reemplaza** (UPSERT por slug) las 3 páginas legales (`terminos`, `privacidad`, `eliminacion-datos`) en `site_pages` con el contenido de `scripts/legal-pages-content.ts` (transcripto de los .docx fuente). A diferencia de `migrate-db.ts` (insert-only, nunca pisa CMS), este script siempre sincroniza estas 3 con el texto legal vigente — correr tras editar `legal-pages-content.ts` o para empujar el texto actualizado a un entorno (prod) donde ya existían con contenido viejo. | ✅ (UPSERT) |
| `scripts/seed-platform-email-templates.ts` | Inserta las 20 plantillas de correo de PLATAFORMA (`platform_email_templates`: welcome, trial_* — incl. `trial_extended`, la que encola `POST /api/admin/subscriptions/:hotelId/extend-trial` (#146) —, renewal_*, payment_*, suspended, reactivated, canceled, más las 6 de la secuencia de activación/rescate `activation_*`, `trial_offer`, `trial_rescue_*` que manda `shared/usecases/activation-sequence-cron.ts` (#149/#150), más las 3 del pedido de conexión de OTA — `channel_request_scheduled/connected/rejected`, cuyo texto vive en `src/shared/usecases/channel-request-email-templates.ts` porque lo comparte un test de render). Insert-only por defecto. Con `--refresh` **reemplaza** subject/body/variables de las 20 con el texto del script (conserva `isActive`). El nombre de la plataforma NO va escrito: es `{platform_name}` y lo resuelve el envío desde `configuration('plataforma')` (`shared/utils/platform-identity.ts`), igual que `{support_email}`/`{support_phone}`. **Correr en prod con `--refresh` tras el deploy 2026-09-09**: las filas viejas tienen "SolmiOS" hardcodeado. | ✅ (COUNT por evento; `--refresh` = UPDATE por evento) |
| `scripts/seed-marketing-pages.ts` | Mismo patrón que `seed-legal-pages.ts` pero para las páginas "producto"/"empresa" (`que-es-solmios`, `integraciones`, `sobre-nosotros`, `contacto`) — contenido en `scripts/marketing-pages-content.ts`. Correr tras editarlo o para empujar correcciones (auditoría Meta 2026-08-26: voseo, correo/teléfono de contacto ausentes) a un entorno donde ya existían. | ✅ (UPSERT) |
| `scripts/backfill-announcement-audience.ts` (`bun run backfill:announcement-audience`) | Rellena `announcements.audience` en las filas anteriores a esa columna (`hotel` si tienen `hotelId`, `all` si no). **Obligatorio tras el deploy**: el listado busca los anuncios de plataforma por `audience`, así que una fila con `audience` nulo no la devuelve ninguna consulta y el anuncio deja de verse. Lista los anuncios sin hotel antes de tocarlos — al correrlo **empiezan a verse en todos los hoteles**. | ✅ (solo escribe donde está nulo/vacío) |
| `scripts/backfill-platform-invoices.ts` (`bun run backfill:platform-invoices`) | Trae de Stripe las facturas de la PLATAFORMA anteriores a `platform_invoices` (REQ-BIL-03): recorre las suscripciones con `stripeCustomerId`, pagina `invoices.list` y hace UPSERT por `stripeInvoiceId` reusando el mismo camino que el webhook. NO pisa filas `method='manual'` ni trae borradores. `--dry` cuenta sin escribir, `--hotel <id>` limita a un hotel. **Correr en prod tras el deploy**: sin esto `/admin/billing` arranca vacío para hoteles que ya venían pagando. Además hay que habilitar `invoice.finalized` e `invoice.voided` en el endpoint de webhook de Stripe (dashboard) — sin eso la factura recién aparece cuando se paga. | ✅ (UPSERT por `stripeInvoiceId`) |
| ~~`scripts/patch-orm-postgres.sh`~~ | **ELIMINADO** — el remap camelCase↔lowercase se upstreameó al framework 1.6.2 (nativo en `kernel/db/orm-utils.ts`, "Remap lowercase → camelCase"). Sin postinstall. | — |

### Portabilidad Postgres
- ✅ camelCase↔lowercase: **nativo en framework 1.6.2** (`orm-utils.ts` remapea TODOS los fields, no solo timestamps). PG pliega identificadores no-entrecomillados a minúsculas (`hotelId`→`hotelid`); el ORM los devuelve en camelCase. Ya no hace falta parche/postinstall.
- ⚠️ `ormMigrate` (RUN_MIGRATE) en 1.6.2 hace **`ADD COLUMN`** para campos nuevos de tablas existentes (antes solo `CREATE TABLE IF NOT EXISTS`). Renombrar un campo en el modelo → la columna vieja queda **orphan** (avisa por warning, NO la dropea): migrar data vieja→nueva a mano y `DROP COLUMN` explícito. Columnas físicas en PG son lowercase.
- ✅ Sin SQL SQLite-only en `migrate-db.ts` (sin `PRAGMA`/`datetime('now')`/`AUTOINCREMENT`). Placeholders `?` → `$1...` los convierte `PostgresAdapter`.
- ✅ `addColumnIfMissing()` portable (ignora `duplicate column`).
- ✅ `configuration` garantiza `UNIQUE(hotelId, key)` vía `CREATE UNIQUE INDEX idx_configuration_hotel_key` (el ORM no crea unique compuesto).
- ✅ Booleanos: el ORM normaliza `type:'boolean'`↔INTEGER (`serialize v?1:0` / `deserialize v===true||v===1||'1'||'t'||'true'`). La columna physical es INTEGER en ambos motores → el seeder puede pasar `1`/`0` o `true`/`false` indistintamente. (Antes documentado como "deuda bloqueante PG" — era falso, el kernel ya lo maneja.)

### Reglas al tocar migraciones/seeder
- DDL en INGLÉS, sin SQLite-only. Para "ahora": `new Date().toISOString()` por param (NO `DEFAULT datetime('now')`).
- INSERT multi-motor: placeholders `?` (adapter PG convierte). Contar columnas vs `?`.
- Booleanos en tablas ORM: el ORM mapea `type:'boolean'`→columna INTEGER y convierte en ambos sentidos. Seeder puede pasar `1`/`0` o `true`/`false`.
- UPSERT `ON CONFLICT(col)` requiere UNIQUE constraint o `CREATE UNIQUE INDEX` explícito.

## Arquitectura
```
Manager Hotel/
├── backend/
│   ├── src/composition-root.ts   # ENTRY: System + ORM + 40 módulos (207 líneas, wiring declarativo limpio — sin endpoints inline)
│   ├── src/shared/
│   │   ├── models.ts             # Modelos ORM compartidos (registerSharedModels)
│   │   ├── permissions.ts        # hasPermission, getRolePermissions
│   │   ├── middlewares/          # security-headers.ts, rate-limit.ts
│   │   └── utils/                # safe-parse.ts, hotel-of.ts, push-availability.ts
│   ├── src/infrastructure/
│   │   ├── auth/                 # hotel-auth, require-user-type, require-permission, load-permissions, create-permission-guard
│   │   ├── stripe-config.ts      # Stripe API key resolver
│   │   └── email-bootstrap.ts    # EmailService setup + worker
│   ├── src/modules/              # ~40 módulos aislados (controller/service/types/validators/model/sockets/tests)
│   ├── src/connectors/           # 12 conectores inter-módulo
│   ├── src/services/             # 13 servicios compartidos
│   └── data/managerhotel.db      # SQLite (gitignored)
├── frontend/src/
│   ├── pages/ services/ composables/ stores/ layouts/ router/ components/ types/
├── PRD.md · ARCHITECTURE.md · ANALISIS-MRPLAN.md · PLAN-IMPLEMENTACION.md · FRD/ · SPECS/ · openspec/
```

## Sistema de Permisos

### userType
- `admin` — dueño de la plataforma (super_admin). Accede a `/admin/*`.
- `merchant` — dueño/gerente del hotel. Accede a `/panel/*`. NUNCA accede a endpoints admin.

### Roles por hotel
Cada hotel tiene roles con permisos granulares. Roles por defecto: `hotel_admin` 👑 (completo), `receptionist` 🔑 (operaciones), `housekeeper` 🧹 (limpieza), `maintenance` 🔧 (mantenimiento).

### Permisos (`module:action`)
```
dashboard:view
reservations:view/create/edit/delete/checkin/checkout
guests:view/create/edit/delete
rooms:view/create/edit/delete
housekeeping:view/create/edit
maintenance:view/create/edit
billing:view/create/edit/delete
reports:view/export/edit
settings:view/create/edit/delete
users:view/create/edit/delete
feedback:view
channel-manager:view/edit
ttlock:view/edit
ai:view/edit
restaurant:view/create/edit/delete/pay   # pay = cobrar, cargar a habitación, propina (#205): hotel_admin, receptionist, waiter; NO kitchen
restaurant-catalog:view/create/edit/delete
```

### Uso
```typescript
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
const guard = createPermissionGuard(auth, roleRepo)
router.get('/api/reservations', guard('reservations', 'view'), handler)
```
- `src/shared/permissions.ts` — estructura + hasPermission/getRolePermissions
- `src/infrastructure/auth/` — require-permission, load-permissions, create-permission-guard
- `scripts/seed-default-roles.ts` — roles por defecto

## Lazy Loading — Skills por contexto
NO cargar todo. Solo lo que aplique:

| Contexto | Cargar |
|----------|--------|
| QA UI de una vista del panel (botones faltantes, usabilidad, a11y, responsive) | `qa-ui` (`/qa-ui <ruta>`) |

| Contexto | Cargar |
|----------|--------|
| Backend (cualquier `backend/`) | `backend/node_modules/arckode-framework/skills/{services,orm,auth}/SKILL.md` |
| Módulo nuevo backend | `helpers/SKILL.md` + `make:module` |
| Frontend (`frontend/`) | `ui-analyst`, `ui-designer` |
| CRUD | `skills/crud` + `skills/api-client` (studio raíz) |
| Auth/login | `skills/auth` |
| Pagos/Stripe | `skills/payments` |
| DB/migraciones | `database-qa`, `db-architect` |
| Diseño UI | `designs/index.html` del proyecto |
| Arranque sesión | `ARCHITECTURE.md` + `openspec/config.yaml` |
| Feature en proyecto existente | Leer `backend/src/composition-root.ts` PRIMERO |
| Sync tareas a GitLab | `openspec-gitlab-sync` (ver GitLab Sync abajo) |

## Memoria — MemoryOne
**Project**: `arckode-studio` · **topic_key**: `manager-hotel/{category}/{domain}/{concept}`

```
mem_context(project: "arckode-studio")                    # inicio sesión
mem_search(query: "...", project: "arckode-studio")
mem_save(title, type, project: "arckode-studio", scope: "project",
        topic_key: "manager-hotel/...", content: "**What** / **Why** / **Where** / **Learned**")
mem_session_summary(project: "arckode-studio", content)   # cierre sesión
```

## SDD — Spec-Driven Development
**Modo**: `memoryone-openspec` · **Config**: `openspec/config.yaml`

Cambio activo: `match-misterplan` (F1→F10, ver diagrama de fases en `tasks.md`).
Otros activos: `pms-competitive-gaps`, `frontend-coverage-gaps`.

Reglas SDD (`openspec/config.yaml`):
- Every new feature MUST reference su equivalente MisterPlan
- Cambios riesgosos: incluir rollback plan
- Specs: Given/When/Then + RFC 2119 + secciones DB/API/UI REQUIRED
- Apply: `make:module` + `RepositoryAdapter<T>`, NEVER raw SQL en services
- Verify: `bun run typecheck` (backend) + `cd frontend && bun run typecheck` (= vue-tsc **-b**; sin -b no revisa nada) + `arckode analyze` (0 violations)
- Spanish UI / English DB-API-code

## GitLab Sync — openspec-gitlab-sync

Las tasks de openspec se suben como Issues a GitLab y se delegan con un ciclo de vida obligatorio.

- **Skill**: `~/.claude/skills/openspec-gitlab-sync/SKILL.md`
- **CLI global**: `openspec-gitlab-sync`
- **Project**: `underworf1/solmios` → https://gitlab.com/underworf1/solmios/-/issues
- **Creds**: `GITLAB_TOKEN` + `GITLAB_PROJECT_ID` en `~/.gitlab-env` (`source ~/.gitlab-env` SIEMPRE antes, NUNCA pedir al usuario)

### Ciclo de vida OBLIGATORIO (sin "open")
```
🔧 EN PROCESO → 🧪 QA-DEV → 📦 PREIMPLEMENTACION → 🎨 QA-UI → ✅ IMPLEMENTACION
```
`workflow:en-proceso` (dev trabajando) → `qa-dev` (dev verificó) → `preimplementacion` (listo revisión) → `qa-ui` (diseño/QA) → `implementacion` (desplegado, auto al marcar `[x]`+push)

### Comandos
```bash
source ~/.gitlab-env
openspec-gitlab-sync { init | board | push | push --verify | verify | status | pull | report }
```

## Reglas — Backend (arckode-framework)
- **NUNCA** SQL crudo en módulos → `OrmRepository<T>` (findMany/create/update/delete/count)
- **NUNCA** ORM en services → inyectar `OrmRepository<T>`, no el orm directo
- **NUNCA** controller sin `validateSchema()` en POST/PUT/PATCH
- **NUNCA** sin ownership check → `auth.authenticate(...roles)` + `auth.assertOwnership()` post-findById
- **NUNCA** server.ts suelto → entry es `composition-root.ts`
- **NUNCA** import de otro módulo directo → connector en `src/connectors/`
- **SIEMPRE** permisos → `requirePermission(module, action)` en cada ruta
- **SIEMPRE** userType → admin rutas `requireUserType('admin')`, hotel rutas `requireUserType('merchant')`
- `index.ts` de módulo es APPEND-ONLY
- `model.ts` (BD) ≠ `types.ts` (API)
- `npm install arckode-framework` (desde npm)
- `make:module X` genera estructura canónica
- TODO `findById` requiere `auth.assertOwnership()` después (analyzer detecta y bloquea)

### ⚠️ Anti-patrón ORM — descarte silencioso de campos (mem 1805)
El ORM construye `allowedFields = new Set(Object.keys(def.fields))` y **descarta campos no declarados sin warning** (case-sensitive). Si un service/DTO/validators/frontend usa un campo NO declarado en el `orm.define(...)`, **se pierde al persistir silenciosamente**.

**Síntoma**: dato que "se guarda pero al recargar vuelve al default" → campo no declarado en el modelo.

**Check obligatorio al tocar un modelo o flujo de persistencia**:
1. Todo campo en service/DTO/validators/frontend DEBE estar en el `orm.define(...)`.
2. Case-sensitive: `basePrice` ≠ `baseprice`.
3. Renombrar un campo en el modelo = columna orphan (ADD COLUMN, no rename) → dropear a mano.

**6 casos históricos** (todos fixeados): `reservation_addons.quantity`, `room_rates.{season,basePrice,percentage}`, `payment_requests.paidAt`, `companions.birthDate`, **`lock_codes.hotelId`** (multi-tenancy roto por modelo dual shared/ttlock — consolidado en ttlock, fix 2026-07-05).

### ⚠️ Difusión: el ORM no sabe decir `IS NULL` — un anuncio "para todos" se busca por `audience`

`buildWhere` del framework (`kernel/db/orm-utils.ts`) arma **solo igualdades**: no hay `OR`, ni `IN`,
ni `IS NULL`. Consecuencia práctica: **una fila con una columna nula es inalcanzable desde el ORM**.

Eso rompió los anuncios durante meses. Un anuncio de plataforma se guarda sin `hotelId`, y el listado
filtraba `hotelId = <hotel>`: `NULL` no matchea nunca, así que el mensaje del dueño de la plataforma
**no le llegaba a ningún hotel**, sin ningún error a la vista.

**Regla**: si un registro puede aplicar a "todos", el "todos" es un **valor explícito en una columna**
(`announcements.audience` = `hotel` | `all` | `admins`), nunca la ausencia de la clave foránea. La
unión "lo mío + lo de todos" se arma con dos `findMany` y se junta en memoria
(`modules/anuncios/usecases/list-visible.ts`); las reglas puras de quién ve qué viven en
`shared/usecases/announcement-visibility.ts` porque las usan dos módulos (`anuncios` y `admin`). En
`modules/anuncios/service.ts` NO hay ningún `filters.hotelId = hotelId` sobre el listado, y no
debe volver a haberlo: un filtro por igualdad ahí es exactamente el bug que esto corrigió (#105).

Corolario al agregar una columna así: `ormMigrate` hace `ADD COLUMN` y **no rellena las filas
viejas** (quedan en `NULL` → invisibles). Toda columna discriminadora nueva necesita su backfill
(`scripts/backfill-announcement-audience.ts`).

### Modelos duales — último `orm.define` gana (RESUELTO)
`composition-root.ts` registra `shared` PRIMERO, módulos DESPUÉS. Si un módulo redefine un modelo compartido, el último gana (`models.set`) y **descarta campos del anterior**. **RESUELTO 2026-07-05**: `LockDevices`/`LockCodes` estaban en shared + ttlock; ttlock ganaba y descartaba `lock_codes.hotelId` (multi-tenancy). Consolidado en `modules/ttlock/model.ts` — **regla: si un módulo es dueño de un modelo, NO definirlo en shared**.

## Reglas — DB (ENGLISH ONLY)
- TODAS tablas/columnas/modelos en INGLÉS
- Multi-tenant por columna `hotelId` (NO schema-per-tenant)
- id = TEXT (UUID), timestamps = createdAt/updatedAt, booleanos = INTEGER (0/1)

## Reglas — Frontend (Vue 3)
- **SIEMPRE** `<script setup lang="ts">` + `<style scoped>`
- **NUNCA** `fetch()` en componentes → `XxxService.method()`
- **NUNCA** `<a href="/ruta">` interna → `<router-link>`
- **NUNCA** Options API en Pinia → setup syntax
- **NUNCA** store importa `useRouter` → componente hace `router.push()`
- **NUNCA** service importa store → store orquesta service
- **NUNCA** `any` sin justificación → `unknown` + type guard
- Tipos en `types/index.ts`
- Naming: páginas kebab-case, componentes PascalCase, stores camelCase, services PascalCase+.service.ts

### ⚠️ Resolver nombres de personal/participantes: `/usuarios`, NO `employee-profiles`
Los `staffId`, `supervisorId`, `assignedTo`, `providerId` y los `fromUserId/toUserId` del chat
guardan **`users.id`** (tabla `users`). Para mostrar el nombre hay que resolver contra
**`GET /api/usuarios`** (`TeamService.list()` → `id → name`), **NO** contra `employee-profiles`
(`EmpleadosService.listProfiles`), que es un módulo de RRHH con otros ids que **no matchean** →
todo sale "Sin asignar"/"Usuario"/ID crudo. Bug recurrente: apareció en `team-chat`, `housekeeping`
(camarera + supervisor + stats) y `maintenance` (técnicos). Filtrar el desplegable por rol:
limpieza→`housekeeper`, mantenimiento→`maintenance`. **Regla: cualquier vista que muestre el nombre
de un usuario del hotel resuelve por `/usuarios`.**

## Verificación (antes de "listo")
```bash
# Backend — arckode analyze es GATE BLOQUEANTE
cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze   # → ✅ VÁLIDO (0 violaciones)
cd backend && bun run typecheck && bun test
# Frontend
cd frontend && bun run typecheck && bun run build   # typecheck = vue-tsc -b (SIN -b no revisa nada: tsconfig usa project references)
```
> Si `arckode analyze` muestra ❌ violaciones, el backend **NO está terminado**.

## Panel web — Operaciones (estado 2026-07-16)
Terminología: **"Proveedor de servicios"** (antes "Servicio externo"/"Proveedor técnico") es el nombre
visible en toda la app (web + móvil). Solo texto de UI; código/rutas/endpoints siguen en inglés
(`/mantenimiento/proveedores`, clases `TechnicalProvider*`/`ExternalProvider*`).

| Vista (menú Operaciones) | Estado |
|---|---|
| **Limpieza** → detalle "Ver" | Rediseñado en tarjetas. Muestra camarera (resuelta), **video** (URL firmada `GET /housekeeping/:id/video/view-url`), **lightbox** de fotos, **Revisión del supervisor** (rating 1-10 + quién aprobó + nota), y **Calificar/aprobar** desde el panel (tarjeta en tareas `completed`: marca presencia `POST /:id/presence` → aprueba `POST /:id/approve {rating,note}` → `inspected`). Asignar solo a `housekeeper`. |
| **Proveedores de servicios** | Vista NUEVA (`pages/technical-providers/`): alta/edición/baja del catálogo `/mantenimiento/proveedores`. |
| **Chats del equipo** | Vista NUEVA (`pages/team-chat/`): monitor solo-lectura de `GET /messages/all`, agrupa por par de usuarios + canal `team:`. Nombres por `/usuarios`. |
| **Mantenimiento** | Asigna tickets a técnicos (`role=maintenance`) **o** a un Proveedor de servicios (`providerId`, badge "Externo"). Un ticket, un dueño. |

Aprobar limpieza desde el web exige `supOnSiteTime` (presencia) — el backend lo pide; el admin la
marca en el mismo paso (`presence` no exige foto; la foto es solo la regla del móvil).

## WhatsApp con Meta — cómo está armado

**El modelo es una cuenta de WhatsApp POR HOTEL**, no una de la plataforma. SOLMI OS es el
"proveedor de tecnología": una sola app de Meta (`1727869705161184`) que opera **en nombre de**
muchas cuentas. Cada hotel conecta su número, tiene su WABA y paga sus conversaciones.

| Pieza | Dónde |
|---|---|
| Cliente HTTP de Meta (plantillas, conexión, envío) | `services/whatsapp-cloud-client.ts` |
| Conexión del hotel (Embedded Signup) | `ai-recepcionista/usecases/whatsapp-connection.ts` |
| Plantillas ↔ Meta | `marketing/usecases/meta-templates.ts` + `meta-variable-mapping.ts` |
| Plantillas listas para usar | `marketing/usecases/plantillas-base.ts` |
| Envío desde la reserva | `reservas/usecases/send-whatsapp.ts` |
| Bandeja del huésped | `ai-recepcionista/usecases/inbox.ts` |
| Acuse de entrega | `ai-recepcionista/usecases/whatsapp-delivery-status.ts` |
| Diagnóstico | `bun run verificar-whatsapp` |
| Hotel de prueba para Meta | `bun run seed-demo-meta` (pide `DEMO_PASSWORD`) |

Variables (`backend/.env.example`): `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`,
`META_REGISTRATION_PIN`, `WHATSAPP_APP_SECRET`. **Sin `WHATSAPP_APP_SECRET` el webhook rechaza
TODO** (puerta cerrada) y ningún mensaje de huésped entra.

### Reglas de Meta que ya nos costaron un rechazo

- Una plantilla **no puede terminar con una variable, ni siquiera seguida de un punto**.
- Una plantilla `UTILITY` que **entrega o menciona una credencial** (clave de wifi, código de
  puerta) se rechaza con `INCORRECT_CATEGORY`. El dato se manda por texto libre dentro de la
  ventana de 24 h, no por plantilla.
- **Borrar una plantilla no libera el nombre** enseguida: para corregir una rechazada, mandarla con
  otro nombre.
- Fuera de las **24 h** desde el último mensaje del huésped, solo se puede escribir con plantilla
  aprobada. La ventana se calcula con el último mensaje ENTRANTE (`ai_conversations.lastInboundAt`);
  una respuesta del hotel no la reabre.

### Consumo y cobro — el modelo es "SOLMI OS paga y factura al hotel"

Meta le cobra a la **plataforma**, y la plataforma se lo cobra al hotel dentro de su plan. Eso
obliga a dos cosas que no serían necesarias si cada hotel pagara directo:

| Pieza | Dónde |
|---|---|
| Consumo por hotel/día/categoría | tabla `whatsapp_usage_daily` |
| Sincronía desde Meta | `ai-recepcionista/usecases/whatsapp-usage.ts` + cron cada 6 h |
| Cupo del plan | `plans.limits.whatsappConversations` |
| Corte al agotarse | `assertPuedeIniciarConversacion`, llamado desde `reservas/usecases/send-whatsapp.ts` |
| Pantalla del hotel | `components/features/WhatsappUsageCard.vue` |

Reglas que están en el código y conviene no romper:

- **El consumo se TRAE de Meta, no se calcula.** Meta cobra por conversación de 24 h con precio por
  categoría; contar `message_logs` daría otro número y la diferencia la discutiría el hotel con su
  factura en la mano.
- **La sincronía reemplaza el día, no suma.** Meta corrige sus propios números durante las horas
  siguientes; acumular convertiría una corrección en un cobro doble.
- **El corte solo frena lo que INICIA una conversación** (una plantilla). Responder dentro de la
  ventana de 24 h nunca se corta: esa conversación ya está pagada, y dejar a un huésped sin
  respuesta a mitad de una charla es peor que el sobrecosto.
- **Un plan sin `whatsappConversations` cae al default (1000), no a ilimitado.** El que paga es la
  plataforma: ante la duda, tope. `null` explícito sí es sin tope; `0` es "este plan no incluye
  WhatsApp".

### ⚠️ Baileys es LEGACY — no construir nada nuevo sobre él

`ai-recepcionista/usecases/whatsapp-baileys-client.ts` vincula WhatsApp escaneando un código QR
(WhatsApp Web no oficial). **Va contra las condiciones de Meta** y es un riesgo de rechazo de la app:
si el revisor la encuentra, rechaza.

Sigue en el código porque hay hoteles usándolo y apagarlo los desconecta sin aviso. Mitigación
vigente: la pestaña **desaparece del panel en cuanto el hotel tiene `connectionMode='meta'`**
(`pages/ai-receptionist/config.vue`). Pendiente, como decisión de producto: avisar a esos hoteles,
migrarlos a la conexión oficial y sacar el código.

Para saber quién lo usa: `bun run verificar-whatsapp` los lista.

## Pipeline de ventas — cómo está armado (epic #143, Fases A y B en prod desde 2026-09-10)

**El pipeline se CALCULA, no se guarda.** Una fila por hotel con suscripción (`subscriptions ⋈
hotels`, inner join: el demo sin suscripción no está) más una por `sales_leads` sin hotel. Lo único
persistido es lo que una persona anota (`sales_prospects`). Vista: `/admin/leads-ventas`
("Pipeline de ventas"); embudo en el dashboard del super-admin.

| Pieza | Dónde |
|---|---|
| Etapa, señales, calor, orden | `sales-leads/usecases/pipeline.ts` (`buildPipeline`) |
| Lo que ventas anota (próximo paso, responsable, contactado, perdido) | `sales-leads/usecases/prospect-upsert.ts` → `sales_prospects` |
| Responsables (`assignedTo` = `users.id` con `userType='admin'`) | `sales-leads/usecases/assignees.ts` |
| Embudo semanal | `sales-leads/usecases/funnel.ts` (`GET /api/admin/sales-pipeline/funnel?weeks=1..26`) |
| Aviso a ventas al registrarse | socket `subscriptions.onHotelSignedUp` → `connectors/subscriptions-sales-alert.ts` → `sales-leads/usecases/signup-alert.ts` (`SALES_LEADS_ADMIN_EMAIL`, cae a `ventas@solmios.com`) |
| Extender trial | `POST /api/admin/subscriptions/:hotelId/extend-trial` → `connectors/admin-subscriptions-trial.ts` → `subscriptions/usecases/extend-trial.ts` |
| Secuencia de activación + rescate + perdido automático | `shared/usecases/activation-sequence-cron.ts` (diario) |
| WhatsApp en la landing | `site-pages/usecases/platform-contact.ts` (`GET /api/public/platform-contact`) |
| Frontend | `pages/super-admin/leads-ventas.vue`, `components/features/super-admin/SalesFunnelCard.vue`, `services/SalesPipeline.service.ts`, `types/sales-pipeline.ts` (espejo exacto de `sales-leads/types.ts`) |

**Etapa** (`stageOfHotel`): `lost` manda (alguien decidió) → `active` = `paying` → `trialing` vencido =
`expired` → `trialing` con habitaciones = `activated`, sin = `registered`. `canceled`/`suspended`/
`past_due` sin `lostAt` caen en `expired` (no paga, hay que rescatarlo). Leads sin hotel: `contact`,
o `lost` si `sales_leads.status='lost'`.

**Calor**: rooms>0 +2 · rates>0 +2 · channels>0 +3 · reservations>0 +3 · actividad ≤3 d +2 →
`hot ≥6`, `warm 3–5`, `cold <3`. **Orden**: `nextStepAt` vencido primero → calor desc → `daysLeft` asc.

Reglas que están en el código y conviene no romper:

- **Las señales se piden POR HOTEL y acotadas** (`count({hotelId})`, `findMany({hotelId},{limit:1})`),
  nunca `reservations`/`audit_log` enteros en memoria: son las dos tablas más grandes de la base.
- **Extender trial solo aplica a `trialing`/`expired` sin Stripe vivo** — sobre `active`/`suspended`/
  `canceled` da 409. Pisar a `trialing` una suscripción paga la bloquea al vencer y reabre el doble
  Checkout.
- **El cron manda como máximo UN correo por hotel por corrida**, primera regla que aplique; `contactedAt`
  en los últimos 2 días = silencio (hay un humano encima). Dedup en `sales_prospects.sequenceSent`
  `{evento: fechaISO}` y **solo se marca si `sendEvent` devolvió `sent:true`**: el primer tick corre 20 s
  después del restart y si el seed de plantillas todavía no corrió, sin este guard el hotel se queda sin
  ese correo para siempre (pasó en prod el 2026-09-10).
- **Un rescate (`trial_rescue_*`) cuenta como enviado solo si salió después del vencimiento vigente**:
  extender el trial mueve `trialEndsAt` y la secuencia arranca de cero sin que `extend-trial` conozca
  esta tabla.
- **Perdido automático** (+14 d vencido) solo si no hay NI actividad NI contacto desde el vencimiento;
  con cualquiera de los dos sigue en `expired` y lo decide una persona.
- Un lead de contacto que se registra con el mismo email pasa a ser la fila del hotel; **su prospecto
  (notas, próximo paso) no se traslada** — deuda conocida (INT-2 del scorecard PIPE-A), sin issue.

## Multi-tenancy
- Single DB con columna `hotelId` en cada tabla
- Cada query filtra por `hotelId` (token o query param)
- Configuración: tabla `configuration` KV (por hotel + `platform`)
- **userType** + **permisos** protegen rutas (ver Sistema de Permisos)

## Integraciones (estado real)
| Integración | Estado |
|-------------|--------|
| Channex (Channel Manager) | ✅ Conectado |
| Stripe (pagos) | ✅ Links + deposits + checkout sessions · ⚠️ **webhooks rotos en prod** (firma, ver deudas) |
| TTLock (cerraduras) | ✅ Auto-generate/send/delete codes |
| Email (SMTP/Resend) | ✅ Auto-messages |
| WhatsApp Business API | ✅ Código completo (ver abajo) · ⚠️ falta `META_APP_SECRET` en prod |
| Facturación electrónica | ⚠️ Stub (`fiscal.ts`), sin conector |

## Módulos — madurez
- **Producción, auditados vs anti-patrón ORM**: núcleo financiero (facturas, folios, payments, cash, reports, reservas) + operación (habitaciones, huespedes, housekeeping, mantenimiento).
- **Funcionales, menor cobertura**: attendance, payroll, marketing, canales, dispositivos.

## Deudas técnicas
| Deuda | Detalle |
|-------|---------|
| Anti-patrón ORM | Ver sección "Anti-patrón ORM" en Reglas Backend. 6 casos fixeados. Vigilar al tocar modelos. |
| WhatsApp | Requiere creds Meta Business. |
| Facturación electrónica | Stub, sin conector fiscal real. |
| ~~Webhook Stripe roto~~ ✅ RESUELTO | Resuelto en arckode-framework **1.6.3** (expone `req.rawBody` + `constructEventAsync` bajo Bun; el server ya no descarta los bytes crudos y el router los propaga). **Verificado end-to-end en prod 2026-07-16**: pago test → firma OK → seña aplicada → código TTLock auto-generado. Ver mem `stripe-webhook-rawbody-broken`. |
| ~~`electronic_invoicing.enabled` inalcanzable~~ ✅ RESUELTO | `frontend/src/pages/settings/index.vue` (tab Facturación electrónica, líneas ~905-944) ya persiste `configuration('electronic_invoicing')` como objeto `{enabled, serie, authority, sequence}` — no como array. `fiscal.ts`/`deletable.ts` leen `.enabled` correctamente. Verificado 2026-07-24: no queda ningún seed/escritura con forma de array en el repo. Sigue pendiente (deuda real, separada): NO hay adaptador fiscal real conectado a DGII/DIAN/SAT — ver fila "Facturación electrónica" (stub). |
| Search de facturas (DT-07) | `?search=` trae todas las filas del hotel y filtra en JS (ya no solo la página: un match en cualquier página aparece). Correcto pero O(n) con enrich por fila. Deuda de PERF, no de correctitud. Mover a WHERE del repo. Tarea trackeada: `openspec/changes/deudas-tecnicas-pendientes`. |
| ~~PC-4 Service Worker~~ ✅ RESUELTO | Reactivado commit `5857848` (#369 #370 #222): `frontend/public/sw.js` con network-first para navegación + bypass total de `/api/*` (auth/logout nunca se cachean) + assets con hash cache-first + `skipWaiting`/`clients.claim`. Registrado en `main.ts` solo en `PROD`. Verificado 2026-07-24: código presente y consistente con el diseño documentado. |
| ~~Captcha del registro APAGADO~~ ✅ RESUELTO | El captcha del alta pública ya no depende de variables de entorno: se prende, se apaga y se elige proveedor desde **Admin → Configuración → Seguridad** (#12). Soporta **Cloudflare Turnstile, Google reCAPTCHA v2 y hCaptcha** — la tabla de proveedores vive en `infrastructure/captcha.ts` y agregar uno cuarto es una entrada más. El secreto se guarda **cifrado** (`PAYMENTS_ENCRYPTION_KEY`, igual que `meta-app-config.ts`) y nunca vuelve al navegador: la pantalla sólo muestra una pista. La site key dejó de ser variable de BUILD (`VITE_TURNSTILE_SITE_KEY`, que era EL motivo por el que esto estuvo apagado desde el primer día): la página de registro la pide en runtime a `GET /api/public/captcha`. `TURNSTILE_SECRET` sigue funcionando y **gana** sobre el panel — quien tiene SSH no puede ser pisado desde un navegador, y en ese caso la pantalla queda de solo lectura. **Sigue APAGADO en producción a propósito**: falta que alguien genere las claves y lo active desde el panel; hasta entonces el alta está protegida sólo por rate-limit por IP. |
| Verificación de email pendiente | El alta crea el hotel sin comprobar que el correo exista: solo se valida el **formato** (`shared/email.ts`). Un tipeo deja una cuenta sin acceso ni recuperación. Alcance decidido: entra igual, con aviso hasta verificar. GitLab #421. |
| ~~Sobrepago de factura sin tope~~ ✅ RESUELTO | El usecase `facturas/usecases/pay-invoice.ts:44-47` rechaza `applied > outstanding + BALANCE_EPSILON` con `ValidationError` antes de tocar `payments`/`invoices`. Test `facturas/tests/pay-invoice.test.ts:68-76` cubre el escenario (paga 150/100 → 400 + cero side effects). El schema `PayFacturasSchema.amount` sigue sin `max` (intencional: el validador no conoce el saldo; el guardián vive en el usecase, convención del código). |
| Depósitos = ledger desconectado | `createDeposit/refund/release` no tocan Stripe ni la tabla `payments` (son flags de estado, `stripePaymentId=''`). Un depósito "held" no es plata capturada; su "refund" no devuelve dinero real. La garantía no está integrada al flujo de cobro. |
| Envelope roto cuando comprime (arckode-framework) | `kernel/http/server.ts:138-139` — `const responseBody = Buffer.isBuffer(res.body) ? res.body : buildEnvelope(...)`. Ese check existe para rutas que devuelven binario crudo (PDF), pero `compression()` (`kernel/middlewares.ts:180-209`) también convierte `res.body` en `Buffer` (bytes gzip) cuando la respuesta supera 1KB y el cliente manda `Accept-Encoding: gzip` — y lo hace ANTES de `buildEnvelope()`. Resultado: cualquier endpoint con respuesta >1KB le devuelve al navegador el body crudo sin envolver (`{token,...}` en vez de `{success,data:{token,...},meta,error}`) — reproducible con `curl --compressed` contra `/api/auth/login`. No es solo auth: afecta cualquier ruta que comprima. **Impacto real ya mitigado, pero frágil**: `frontend/src/services/http.ts:294` (`return raw as T`) y el fallback de `:79` (`data.data?.token ?? data.token`) ya toleran el body sin envolver — por eso no se nota a simple vista. El hueco real: una lista paginada SIN envelope no pasa por la reconstrucción `{data, total}` (líneas 217-222/285-291 de `http.ts`) y devuelve el array pelado sin `.total` — una lista grande (facturas, reservas) que supere 1KB comprimida podría perder la paginación en prod sin tirar error. Sin fix aplicado (decisión 2026-08-28: solo documentar). Fix de fondo va en `arckode-framework` (mover `buildEnvelope()` antes de que `compression()` toque `res.body`, o que `compression()` no lo reemplace por un `Buffer` plano); mitigación rápida de este lado sería sacar `router.use(compression(...))` de `composition-root.ts:91`. |

## Settlement Flow (checkout)
```
POST /api/reservas/:id/checkout → body: { settle?: { method, amount, reference? } }
```
- Orchestra: close folio → create invoice → record payment (`settle-folio-at-checkout.ts`, connector `reservas-folios-settlement.ts`)
- `amount <= 0` tras close: folio se cierra sin invoice
- `settle` null/undefined: checkout sin settlement
- Auto-post room charge at check-in: `checkin.ts` (ORM transaction)
- Night audit cron: cada 3h, todos los hoteles, dedup por fecha

## Finance API endpoints
| Módulo | Base | Sub-rutas | Permiso |
|--------|------|-----------|---------|
| Facturas | `/api/facturas` | stats, tax-report, :id, :id/print (A4 público), :id/pay, :id/credit-note, :id/email | billing:* |
| Folios | `/api/folios` | :id/charges, :id/payments, :id/close, :id/invoice, audit/post-room-charges | billing:view/create/edit |
| Payments | `/api/payments` | :id, charge, :id/refund | billing:view/create |
| Payment Links | `/api/payment-links` | :id | billing:view/create |
| Deposits | `/api/deposits` | :id/refund, :id/release | billing:view/create |
| Caja | `/api/caja/movements` | shifts, shifts/current, shifts/:id/close, shifts/:id/reconcile, stats | billing:view/create |
| Reconciliation | `/api/billing/reconciliation` | — | billing:edit |
| Gastos | `/api/gastos` | :id | billing:view/create/delete |
| Reports | `/api/reports` | /advanced, /export | reports:view/export |
| Night Audit | `/api/night-audit` | mark-no-shows | reports:view/edit |

### Redondeo de dinero — `shared/utils/money.ts` (STR-7)
`round2` y `BALANCE_EPSILON` viven **solo** en `backend/src/shared/utils/money.ts`. Código nuevo que
maneje plata lo **importa de ahí**: nada de `const round2 = ...` local ni de re-exports intermedios
(se quitaron los de `reservation-balance.ts`, `rate-resolution.ts` y el shim de `bookingengine`, que
daban tres rutas de import para el mismo símbolo y escondían consumidores de un `rg`).

**Deuda conocida**: quedan ~20 definiciones locales de `round2` en módulos viejos
(`rg 'function round2|const round2' backend/src`), y no todas son equivalentes —
`Math.round(n*100)/100` vs `Math.round((n+Number.EPSILON)*100)/100` difieren en el centavo de borde.
Migrarlas es un cambio de comportamiento en dinero: se hace por módulo y con tests, no de un barrido.
La regla aplica **desde ahora** a todo código nuevo o tocado.

### Facturación — reglas
- Impuestos de `configuration(key='taxes')` — NO hardcodear
- Hotel name de tabla `hotels` — NO hardcodear
- Moneda del invoice — NO hardcodear
- Items en `notes` como string descriptivo
- NCF auto-generado (hoy SIEMPRE — ver deudas técnicas)
- Invoice number: counter atómico en `configuration(key='invoice_counter_{hotelId}_{year}')`

### ✅ `payments` es la ÚNICA fuente de verdad del dinero (billing-money-consolidation, RESUELTO 2026-07-28)
`InvoiceType` es ahora solo `'invoice' | 'credit_note'` — `facturas.pay()` y `folios.applyPayment()`
asientan el cobro en `payments` (vía `payment-port.ts` + connectors `facturas-payments`/`folios-payments`),
NO como una fila `type:'payment'` duplicada dentro de `invoices`. Esto alimenta el arqueo de caja y la
conciliación bancaria automáticamente (antes un cobro en efectivo desde `/panel/billing` no entraba a
ninguno de los dos). `usecases/stats.ts` sigue filtrando `type:'invoice'` por defensa ante datos
legacy, pero ya no hay código que genere filas nuevas `type:'payment'`/`'folio'`/`'receipt'` (prod
verificado en 0 filas de ese tipo, migración `scripts/migrate-payments-out-of-invoices.ts` disponible
si aparecieran en otro entorno).

Corolarios:
- `pendingAmount`/`overdueAmount` acumulan **saldo** (`amount - amountPaid`), no el total facturado.
- Refund de una factura ahora es posible vía el flujo normal de `payments.refundPayment()` — antes
  un cobro registrado dentro de `invoices` no tenía forma de devolverse.

### Anular ≠ borrar
Una factura con efectos contables (cobrada, vencida, anulada, con pagos parciales, o de un hotel con
`electronic_invoicing.enabled`) **no se borra**: se anula con `POST /api/facturas/:id/credit-note`.
`usecases/deletable.ts` lo impone con `ConflictError` (409); el frontend espeja la regla en `isDeletable()`
solo para decidir qué botón mostrar. Borrar deja el libro de ventas sin respaldo y abre un hueco en el numerador.

### Folio → factura es una sola operación del servidor
`POST /api/folios/:id/invoice` cierra el folio, emite la factura y setea `folio.invoiceId`
(`folios/usecases/close-and-create-invoice.ts` + connector `folios-facturas`). NO orquestar esto desde
el frontend: si el segundo request falla, el folio queda cerrado sin factura.

Lo mismo desde la reserva (REQ-FDR-02/03, #253/#254): `POST /api/reservas/:id/invoice`
(`reservas/usecases/issue-invoice.ts` + connector `reservas-facturas`) decide él solo el camino —
reserva CON folio abierto → el flujo de arriba (`source: 'folio'`); reserva SIN folio → factura directa
desde la reserva (`source: 'reservation'`)— y **vincula los pagos que ya existían (`linkedPayments`),
no los crea**. Si la reserva ya tiene factura responde 409 (idempotente). El botón "Facturar" del
`ReservationModal` llama a ese endpoint; la tarjeta "Facturas" lee `detail.invoices` (REQ-FDR-01) y
reusa Imprimir/PDF/Email de `/panel/billing` vía `composables/useInvoiceActions.ts`.

### Caché de listados: versionada, no por clave fija
`CacheAdapter` solo borra claves exactas (no hay glob ni prefijo). Las claves de listado incluyen
filtros y paginación, así que se invalidan bumpeando un token de versión
(`facturas/usecases/cache.ts`, `folios/usecases/cache.ts`). Un `cache.delete('x:*')` **no borra nada**.

## Producción (hotel.zx89.site)
- **SSH**: `root@158.220.103.200` (credencial en gestor de secretos / `~/.ssh` — NUNCA en repo)
- **Repo**: `/www/wwwroot/hotel.zx89.site/solmios`
- **Backend**: systemd `solmios-backend.service` (restart on-failure). bun en `/root/.bun/bin/bun` (NO en PATH del SSH).
- **Frontend**: `dist/` servido por nginx (proxy `/api`,`/uploads`→:3000)
- **DB**: PostgreSQL `solmios` (localhost:5432)
- **Login demo (verificado 2026-07-09)**: `hotel@solmios.com` / `demo123` (`hotel_admin`). También `admin@solmios.com` (`super_admin`), `recepcion@`, `rosa@`, `carlos@`, `luis@` — todos `@solmios.com` / `demo123`.
  - Acepta **email o teléfono** en el mismo campo: `8095550000` ≡ `809-555-0000` ≡ `+1 809 555 0000`.
  - ⚠️ `admin@caribeparadise.com` y `admin@managerhotel.com` dan **401 en prod**: la DB fue re-seedeada con el dominio `@solmios.com`. Solo existen en la SQLite local de dev.
- **PG sin seed data financiera**: folios, facturas, gastos, caja = 0 registros. Reports y night-audit computan desde reservas.
- Ver skill `ssh-solmios` para protocolo de deploy completo.

### Deploy rápido
```bash
# Setup SSH askpass al inicio de sesión — ver ssh-solmios skill
REPO=/www/wwwroot/hotel.zx89.site/solmios
# ⚠️ El `git pull` a veces falla en el server ("could not read... make sure you have access")
# por las 2 SSH keys. Forzar la key correcta con IdentitiesOnly:
SOLSSH "cd $REPO && GIT_SSH_COMMAND='ssh -i /root/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' git pull origin main"
# ⚠️ Si el build de Vite falla, NO pisa el dist viejo (queda la versión anterior servida).
#    Verificar SIEMPRE que el build termine en "✓ built" antes de dar el deploy por hecho.
SOLSSH "cd $REPO/backend && bun install && systemctl restart solmios-backend"
SOLSSH "cd $REPO/frontend && bun --bun vite build"   # SIEMPRE bun --bun (Node 18 + Vite 8 rompe)
# Si cambiaron modelos ORM: cd $REPO/backend && set -a && source .env && set +a && RUN_MIGRATE=1 bun run src/composition-root.ts
# Si cambiaron seeds/tablas extra (migrate-db.ts): cd $REPO/backend && set -a && source .env && set +a && bun run migrate
# NOTA: el auto-deploy (deploy-solmios.sh) YA corre RUN_MIGRATE=1 y bun run migrate en cada deploy (desde 2026-08-17) — esto es solo para deploy manual.
```

## Ejecución (local)
```bash
cd backend && bun run dev          # :3000
cd frontend && bun run dev         # :5173
cd backend && bun run migrate      # seed demo + tablas extra (requiere RUN_MIGRATE antes en DB limpia)
cd backend && bun run doctor       # health-check Channex
```
