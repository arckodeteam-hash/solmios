# ManagerHotel (SOLMI OS) — CLAUDE.md

## Stack
Bun (>=1.3) + Vue 3.5 + Vite 8 + Pinia 3 + Vue Router 5.1 + Tailwind CSS 4.3 + arckode-framework 1.6.2 + **DB multi-motor** (SQLite bun:sqlite/WAL en dev · Postgres `pg` en prod, elegido por `DATABASE_URL`)

## Estado SDD (cambios activos)

> Changelog e historial de commits: `git log`. Acá solo estado no derivable del repo.

- **match-misterplan**: base ✅ (rates grid, i18n). Pendiente 7.2.2/7.2.3 WhatsApp (**bloqueado** por creds Meta).
- **pms-competitive-gaps**: mayoría ✅ + debt documentada (PC-4 SW desactivado, PC-3.1.2 Checkout Session cumple).
- **frontend-coverage-gaps**: GATES automáticos ✅. GATES manuales (reports/switcher/PWA en prod) sin validar.
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
| `scripts/seed-default-roles.ts` | Roles por defecto (permisos) | ✅ |
| `scripts/create-plans-table.ts` | Tabla `plans` (SaaS subscriptions) | ✅ |
| `scripts/add-user-type-{pg,}.ts` | ALTER `users.userType` | ✅ `addColumnIfMissing` |
| `scripts/drop-users-role-check.ts` | Elimina el CHECK vestigial de `users.role` (bloqueaba roles custom y 'housekeeper'/'supervisor' → 500). SQLite recrea la tabla sin el CHECK; PG imprime el `ALTER DROP CONSTRAINT`. **Correr en prod PG.** | ✅ (no-op si no hay CHECK) |
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
| WhatsApp Business API | ⚠️ Requiere creds Meta |
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
| Captcha del registro APAGADO | Implementado y desplegado (`infrastructure/captcha.ts` + widget en `auth/register.vue`), pero **sin claves de Cloudflare Turnstile** → el alta pública solo la protege el rate-limit por IP, que no frena un bot distribuido. El backend lo avisa al arrancar (`Captcha del alta: DESACTIVADO`). Activar: `TURNSTILE_SECRET` en `backend/.env` + `VITE_TURNSTILE_SITE_KEY` en el build del frontend (ambas en los `.env.example`). GitLab #422. |
| Verificación de email pendiente | El alta crea el hotel sin comprobar que el correo exista: solo se valida el **formato** (`shared/email.ts`). Un tipeo deja una cuenta sin acceso ni recuperación. Alcance decidido: entra igual, con aviso hasta verificar. GitLab #421. |
| ~~Sobrepago de factura sin tope~~ ✅ RESUELTO | El usecase `facturas/usecases/pay-invoice.ts:44-47` rechaza `applied > outstanding + BALANCE_EPSILON` con `ValidationError` antes de tocar `payments`/`invoices`. Test `facturas/tests/pay-invoice.test.ts:68-76` cubre el escenario (paga 150/100 → 400 + cero side effects). El schema `PayFacturasSchema.amount` sigue sin `max` (intencional: el validador no conoce el saldo; el guardián vive en el usecase, convención del código). |
| Depósitos = ledger desconectado | `createDeposit/refund/release` no tocan Stripe ni la tabla `payments` (son flags de estado, `stripePaymentId=''`). Un depósito "held" no es plata capturada; su "refund" no devuelve dinero real. La garantía no está integrada al flujo de cobro. |

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
