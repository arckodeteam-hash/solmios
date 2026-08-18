# ManagerHotel — SOLMI OS

PMS (Property Management System) SaaS multi-tenant para hoteles boutique: reservas, planning, channel manager, housekeeping, mantenimiento, facturación, caja, reports, sitio público de reservas y app de limpieza para el personal. Todo el sistema opera en español; código, DB y API en inglés.

> **Si sos una IA asistente de código**: leé `CLAUDE.md` antes de tocar nada — contiene las reglas del proyecto, anti-patrones conocidos y los gates de verificación. Este README es el resumen para humanos.

## Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Runtime | Bun | ≥ 1.3 |
| Backend | TypeScript + [arckode-framework](https://www.npmjs.com/package/arckode-framework) | 1.6.3 |
| Frontend | Vue 3 (`<script setup>`) + Vue Router + Pinia | 3.5 / 5.1 / 3.0 |
| Build | Vite | 8 |
| Estilos | Tailwind CSS | 4.3 |
| DB dev | SQLite (`bun:sqlite`, WAL) | — |
| DB prod | PostgreSQL (`pg`) | 16 |
| Tests | `bun test` (backend) · Vitest + Playwright (frontend) | — |

El motor de DB se elige por env: `DB_PATH` → SQLite (default en dev), `DATABASE_URL=postgres://…` → PostgreSQL. El framework remapea `camelCase`↔`lowercase` para PG en ambos sentidos.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.3 (`curl -fsSL https://bun.sh/install | bash`)
- (Opcional en dev) PostgreSQL 16 — sin él, todo corre sobre SQLite
- Node **no** es necesario; en el server de prod incluso rompe el build de Vite (usar `bun --bun vite build`)

## Setup local

```bash
git clone git@github.com:arckodeteam-hash/solmios.git && cd solmios

# 1. Backend
cd backend
cp .env.example .env          # editar JWT_SECRET (openssl rand -hex 32)
bun install

# 2. Migraciones — 2 capas, ESTE ORDEN ES INSALTABLE sobre DB limpia:
#    Paso 1: tablas base desde los modelos ORM
DB_PATH=data/managerhotel.db RUN_MIGRATE=1 bun run src/composition-root.ts
#    Paso 2: seeds demo + tablas extra no-modeladas (24 tablas)
bun run migrate

# 3. Levantar
bun run dev                   # API en el puerto de PORT (.env — el del equipo usa 3001)

# 4. Frontend (otra terminal)
cd ../frontend
bun install
bun run dev                   # Vite en :5173, proxyea /api y /uploads al backend
```

> El proxy de Vite (`vite.config.ts`) apunta a `localhost:3001` — si tu `.env` usa otro `PORT`, alineá ambos.

⚠️ `migrate-db.ts` corre `seedBase()` (INSERT en `hotels`/`users`/…) **antes** de crear las tablas extra y no crea las tablas base. Correrlo sin el paso 1 en una DB vacía falla con `no such table: hotels`. Ambos scripts son idempotentes.

### Cuentas demo (tras el seed)

| Cuenta | Rol | Acceso |
|---|---|---|
| `hotel@solmios.com` | hotel_admin | `/panel/*` |
| `admin@solmios.com` | super_admin (admin plataforma) | `/admin/*` |
| `recepcion@` · `rosa@` · `carlos@` · `luis@` | recepcionista / limpieza / mantenimiento | `/panel/*` |

Password de todas: `demo123`. El login acepta **email o teléfono** en el mismo campo (`8095550000` ≡ `+1 809 555 0000`).

## Scripts

**Backend** (`cd backend`)

| Comando | Qué hace |
|---|---|
| `bun run dev` | Servidor con hot-reload (carga `.env`) |
| `bun run start` | Servidor sin watch |
| `bun run migrate` | DDL tablas extra + seeds demo (idempotente) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | Tests (usa `.env.test`) |
| `bun run analyze` | `arckode analyze` — **gate bloqueante**: 0 violaciones o no está terminado |
| `bun run doctor` | Health-check de Channex |
| `bun run sync-roles` | Sincroniza roles/permisos por defecto |

**Frontend** (`cd frontend`)

| Comando | Qué hace |
|---|---|
| `bun run dev` | Vite dev server :5173 |
| `bun run build` | `vue-tsc -b` + build (verifica tipos **con** project references) |
| `bun run typecheck` | `vue-tsc -b --noEmit` — sin `-b` no revisa nada |
| `bun run test` | Vitest |
| `bun run test:e2e` | Playwright |

## Verificación (antes de declarar "listo")

```bash
cd backend  && bun run analyze && bun run typecheck && bun test
cd frontend && bun run typecheck && bun run build
```

`arckode analyze` en el backend es **bloqueante**: si reporta violaciones (ownership faltante, SQL crudo, endpoint sin validación…), el trabajo no está terminado.

## Estructura

```
├── backend/
│   ├── src/composition-root.ts    # ENTRYPOINT único: System + ORM + ~40 módulos (wiring declarativo)
│   ├── src/shared/                # modelos ORM compartidos, permisos, middlewares, utils
│   ├── src/infrastructure/        # auth (guards, permission-guard), stripe-config, email-bootstrap
│   ├── src/modules/               # ~40 módulos aislados: controller/service/types/validators/model/tests
│   ├── src/connectors/            # integración ENTRE módulos (única vía permitida de cross-module)
│   ├── src/services/              # 13 servicios compartidos
│   ├── scripts/                   # migraciones puntuales, seeds, utils
│   └── migrate-db.ts              # capa 2 de migraciones (tablas extra + seeds)
├── frontend/src/
│   ├── pages/                     # vistas (kebab-case) por sección del panel
│   ├── services/                  # ÚNICO acceso a la API (nunca fetch() en componentes)
│   ├── stores/ · composables/ · components/ · layouts/ · router/ · types/
├── PRD.md · ARCHITECTURE.md · ANALISIS-MRPLAN.md · FRD/ · SPECS/
└── openspec/                      # Spec-Driven Development (cambios activos, tasks, config)
```

La app móvil del personal es un repo aparte (`solmios-mobile`, Flutter) — **fuera del alcance de este repo**.

## Arquitectura en 60 segundos

- **Composition root**: no hay `server.ts` suelto. `composition-root.ts` registra modelos (`shared` primero, módulos después) y cablea todo.
- **Módulos aislados**: cada módulo posee sus tablas y expone su API. Un módulo **nunca** importa otro directamente — se comunican por connectors en `src/connectors/`.
- **Multi-tenancy**: una sola DB, columna `hotelId` en cada tabla, filtrada en cada query. Sin schema-per-tenant.
- **Permisos** en dos capas: `userType` (`admin` de plataforma vs `merchant` dueño de hotel) + roles por hotel con permisos granulares `module:action` (`src/shared/permissions.ts`).
- **Ownership obligatorio**: todo `findById` que deriva en escritura pasa por `auth.assertOwnership()` (anti-IDOR).
- **`payments` es la única fuente de verdad del dinero** — facturas y folios asientan cobros ahí.
- **SDD**: los features se diseñan en `openspec/` (specs Given/When/Then) antes de codearse, y se sincronizan como issues de GitLab.

### Reglas de código no negociables (resumen)

- Sin SQL crudo en módulos → `OrmRepository<T>` inyectado; sin ORM en services.
- Todo POST/PUT/PATCH valida con `validateSchema()`; todo campo persistido **debe** estar declarado en el `orm.define()` (los no declarados se descartan en silencio — anti-patrón histórico, ver CLAUDE.md).
- Frontend: siempre `<script setup lang="ts">`, `XxxService.method()` para la API, `<router-link>` para navegación interna, sin `any` injustificado.
- DDL y nombres de DB en inglés; UI en español.
- Commits convencionales (`feat:`, `fix:`, `docs:`…).

## Migraciones y seeders

Dos capas, en orden: (1) `RUN_MIGRATE=1 bun run src/composition-root.ts` crea las tablas desde los modelos ORM (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN` para campos nuevos); (2) `bun run migrate` agrega tablas no-modeladas y seeds demo. Ambas idempotentes y multi-motor: sin sintaxis SQLite-only, placeholders `?`, booleanos como INTEGER. Detalle completo y scripts puntuales en `CLAUDE.md`.

## Integraciones

| Integración | Estado |
|---|---|
| Channex (channel manager → OTAs) | ✅ Operativa |
| Stripe (payment links, deposits, checkout) | ✅ Operativa (webhooks verificados en prod) |
| TTLock (cerraduras, códigos automáticos) | ✅ Operativa |
| Email (SMTP/Resend, auto-messages) | ✅ Operativa |
| WhatsApp Business API | ⚠️ Requiere credenciales Meta |
| Facturación electrónica fiscal | ⚠️ Stub sin conector real |

## Producción

Deploy en `hotel.zx89.site` (backend como servicio de systemd + frontend estático detrás de nginx, PostgreSQL local). El deploy es automático por script y corre las dos capas de migración en cada push a `main`. El protocolo completo (SSH, gotchas del server, rollback) vive en el skill `ssh-solmios` y en `CLAUDE.md` — no se duplican credenciales acá.

## Documentación

- `CLAUDE.md` — reglas del proyecto, anti-patrones, estado de deudas técnicas (leer primero)
- `ARCHITECTURE.md` — arquitectura detallada
- `PRD.md`, `FRD/`, `SPECS/` — producto y especificaciones
- `openspec/` — cambios activos con Spec-Driven Development
