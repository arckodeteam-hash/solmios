// scripts/create-plans-table.ts — UNIVERSAL (PostgreSQL + SQLite vía DbAdapter del framework).
// Antes era Postgres-only (`pg` crudo, hardcodeado) — sin rama SQLite no había forma de
// probar el catálogo de planes en dev local. Migrado al mismo patrón portable que
// migrate-db.ts/seed-legal-pages.ts (DbAdapter condicional por DATABASE_URL).
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import type { DbAdapter } from 'arckode-framework'

const DATABASE_URL = process.env.DATABASE_URL
const db: DbAdapter & { connect(): Promise<void> } = DATABASE_URL
  ? new PostgresAdapter({ connectionString: DATABASE_URL })
  : new SqliteAdapter({
      path: process.env.DB_PATH || './data/managerhotel.db',
      wal: true,
      foreignKeys: true,
    })

function isAlreadyExistsError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  if (code === '42P07' || code === '42701' || code === '42710') return true
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes('already exists') || msg.includes('duplicate column')
}

async function exec(sql: string): Promise<void> {
  try {
    await db.run(sql)
  } catch (e: unknown) {
    if (!isAlreadyExistsError(e)) throw e
  }
}

async function migrate() {
  await db.connect()
  try {
    // `plans`/`amenities_catalog` ya existen como modelos ORM compartidos
    // (src/shared/models.ts → Plans/AmenitiesCatalog, registrados por
    // registerSharedModels en composition-root). El ORM crea las columnas SIN
    // comillas, así que Postgres las pliega a minúsculas (isActive→isactive,
    // sortOrder→sortorder) y el framework remapea camelCase↔lowercase al leer/escribir.
    // Este script NO pasa por el ORM (SQL directo), así que debe usar los mismos
    // nombres físicos (minúsculas) — antes usaba comillas con camelCase, lo que
    // rompía contra la tabla ya creada por el ORM. CREATE TABLE IF NOT EXISTS queda
    // como red de seguridad si este script corriera antes que el ORM.
    await exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        price REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        description TEXT,
        features TEXT DEFAULT '[]',
        modules TEXT DEFAULT '[]',
        limits TEXT DEFAULT '{}',
        stripepriceid TEXT,
        isactive INTEGER DEFAULT 1,
        sortorder INTEGER DEFAULT 0,
        createdat TEXT,
        updatedat TEXT
      )
    `)
    console.log('✅ Tabla plans creada')

    // Seed default plans.
    // `modules` es la lista plana de claves top-level Y submódulos punteados que el plan incluye.
    // Array vacío = TODOS los módulos (retrocompat del cálculo en getModuleStateForPlan).
    //
    // essential/ultra cierran el fail-open: antes, un hotel sin plan.match en plans.modules
    // recibía TODOS los módulos. Ahora essential define un set acotado y ultra (vacío) sigue
    // dando todo por ser el plan tope.
    //
    // El mapeo de essential es una interpretación pragmática del PRD §5
    // (Essential = M01 PMS + M02 Channel + M03 Reservas + M13 Pagos). Ajustable vía /admin/plans.
    //
    // R3-2: essential NO lista los padres 'finance'/'operations' — bajo la semántica
    // "padre = módulo completo" un padre habilita TODOS sus sub-módulos y essential heredaba
    // 8 que el plan no promete (folios/caja/gastos/reports/night-audit/housekeeping/providers/
    // team-chat). Lista SOLO los sub-módulos explícitos; las demás matrices están OK bajo esa
    // semántica (host lista padre+hijo = mismo resultado; starter/professional/enterprise/ultra
    // son [] = todo, que es lo que venden). Congelado en tests/plan-gating.test.ts (R3-2).
    //
    // settings.rooms en host/essential (auditoría de superficies 2026-08-21): un plan que vende
    // 'reservations' SIN el catálogo de habitaciones es inoperable — el paso REQUIRED del
    // onboarding ('Cargá tus habitaciones' → /panel/config/habitaciones → /api/habitaciones)
    // queda 403, sin habitaciones no entra ninguna reserva y el motor público no tiene
    // inventario (prod: Hotel Ortiz, trial plan-host, 0 habitaciones). Se lista la SUB-clave
    // sola (R3-2): prende el catálogo SIN regalar el padre 'settings' (auto-messages, locks,
    // gateways, devices... siguen OFF). Mismo bug de clase que reservations.list (CS-1).
    //
    // Host (#567): plan de entrada, por debajo de Starter — el dueño no proveyó la doc con el
    // precio/módulos oficiales (issue quedó bloqueado en workflow:pendiente), así que estos son
    // valores de arranque razonables, no datos confirmados. Todo se edita desde /panel/plans
    // (mismo criterio que essential/ultra) — no hace falta reseedear para corregirlos.
    //
    // Status quo 2026-08-21 (claves nuevas site-pages/settings.rates/settings.audit): TODOS los
    // planes ven hoy Página pública, Temporadas y Tarifas y Auditoría (estaban sin gate), así que
    // host/essential las listan EXPLÍCITAMENTE para que el deploy no le quite nada a nadie — el
    // dueño saca lo que quiera con el editor (/admin → planes). starter/professional/enterprise/
    // ultra NO las necesitan: su matriz es [] = TODOS los módulos, y enumerar claves en un []
    // lo RESTRINGIRÍA a solo esas (semántica de getModuleStateForPlan). Por lo mismo, en prod NO
    // hay que correrles UPDATE a los planes [].
    //
    // essential: $99→$39 + sortorder 3→0 (auditoría Meta 2026-08-26): el copy de marketing de
    // starter (frontend/src/services/PlanCatalog.service.ts) dice literalmente "Todo lo del plan
    // Essential" como primer beneficio — Starter se vende como un SUPERSET de Essential (y lo es:
    // starter tiene modules:[] = todos los módulos, essential tiene la lista acotada del PRD §5).
    // Con Essential a $99 (lo mismo que Professional) y Starter a $49, el resultado era que la
    // opción MÁS CARA ofrecía MENOS que una MÁS BARATA que además dice incluirla — nadie elegiría
    // Essential nunca. La cantidad de habitaciones (20) no era el problema: subirla por encima de
    // Starter (30) rompería la promesa "incluye Essential" en la otra dirección. El precio es lo
    // que hay que bajar para que la relación de inclusión tenga sentido comercial: Essential queda
    // entre Host y Starter, tanto en precio como en sortorder. Habitaciones y set de módulos quedan
    // intactos (eso sí es una decisión de producto que no me corresponde inventar).
    const plans: [string, string, string, number, string, string, string, string, string, number, number][] = [
      // id, name, slug, price, currency, desc, features, limits, modules, isactive, sortorder
      ['plan-host', 'Host', 'host', 29, 'USD', 'Plan de entrada — motor de reservas básico', JSON.stringify(['10 habitaciones', '1 usuario']), JSON.stringify({rooms:10,users:1}), JSON.stringify(['planning','reservations','reservations.checkin','guests','settings.rooms','site-pages','settings.rates','settings.audit']), 1, -1],
      ['plan-essential', 'Essential', 'essential', 39, 'USD', 'PMS + Channel + Reservas + Pagos', JSON.stringify(['20 habitaciones', '2 usuarios']), JSON.stringify({rooms:20,users:2}), JSON.stringify(['planning','reservations','reservations.checkin','guests','settings.rooms','channel','finance.billing','finance.payments','operations.maintenance','site-pages','settings.rates','settings.audit']), 1, 0],
      ['plan-starter', 'Starter', 'starter', 49, 'USD', 'Para hoteles pequeños', JSON.stringify(['30 habitaciones', '2 usuarios']), JSON.stringify({rooms:30,users:2}), JSON.stringify([]), 1, 1],
      ['plan-professional', 'Professional', 'professional', 99, 'USD', 'Para hoteles en crecimiento', JSON.stringify(['100 habitaciones', '6 usuarios']), JSON.stringify({rooms:100,users:6}), JSON.stringify([]), 1, 2],
      ['plan-enterprise', 'Enterprise', 'enterprise', 199, 'USD', 'Para hoteles grandes', JSON.stringify(['Habitaciones ilimitadas', 'Usuarios ilimitados']), JSON.stringify({rooms:9999,users:9999}), JSON.stringify([]), 1, 3],
      ['plan-ultra', 'Ultra', 'ultra', 0, 'USD', 'Plan custom — todos los módulos', JSON.stringify(['Habitaciones ilimitadas', 'Usuarios ilimitados']), JSON.stringify({rooms:9999,users:9999}), JSON.stringify([]), 1, 4],
    ]

    for (const [id, name, slug, price, currency, desc, features, limits, modules, active, sort] of plans) {
      try {
        await db.run(
          `INSERT INTO plans (id, name, slug, price, currency, description, features, limits, modules, isactive, sortorder)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, name, slug, price, currency, desc, features, limits, modules, active, sort]
        )
      } catch (e: unknown) {
        if (!isAlreadyExistsError(e) && !(e instanceof Error && /unique|duplicate/i.test(e.message))) throw e
      }
    }
    console.log('✅ Plans seed completado')

    // Create amenities_catalog if not exists
    await exec(`
      CREATE TABLE IF NOT EXISTS amenities_catalog (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        category TEXT DEFAULT 'interior',
        icon TEXT,
        isactive INTEGER DEFAULT 1,
        sortorder INTEGER DEFAULT 0,
        createdat TEXT,
        updatedat TEXT
      )
    `)
    console.log('✅ Tabla amenities_catalog creada')

    console.log('✅ Migración completada')
  } finally {
    await db.close()
  }
}

migrate().catch((e) => { console.error(e); process.exitCode = 1 })
