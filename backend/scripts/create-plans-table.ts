import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://solmios:solmios123@localhost:5432/solmios'
})

async function migrate() {
  const client = await pool.connect()
  try {
    // `plans`/`amenities_catalog` ya existen como modelos ORM compartidos
    // (src/shared/models.ts → Plans/AmenitiesCatalog, registrados por
    // registerSharedModels en composition-root). El ORM crea las columnas SIN
    // comillas, así que Postgres las pliega a minúsculas (isActive→isactive,
    // sortOrder→sortorder) y el framework remapea camelCase↔lowercase al leer/escribir.
    // Este script NO pasa por el ORM (usa `pg` crudo), así que debe usar los
    // mismos nombres físicos (minúsculas) — antes usaba comillas con camelCase,
    // lo que rompía contra la tabla ya creada por el ORM (columna "isActive"
    // no existe, la física es "isactive"). CREATE TABLE IF NOT EXISTS queda
    // como red de seguridad si este script corriera antes que el ORM.
    await client.query(`
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
    const plans = [
      // id, name, slug, price, currency, desc, features, limits, modules, isactive, sortorder
      ['plan-host', 'Host', 'host', 29, 'USD', 'Plan de entrada — motor de reservas básico', JSON.stringify(['10 habitaciones', '1 usuario']), JSON.stringify({rooms:10,users:1}), JSON.stringify(['planning','reservations','reservations.checkin','guests','settings.rooms']), 1, -1],
      ['plan-starter', 'Starter', 'starter', 49, 'USD', 'Para hoteles pequeños', JSON.stringify(['30 habitaciones', '2 usuarios']), JSON.stringify({rooms:30,users:2}), JSON.stringify([]), 1, 0],
      ['plan-professional', 'Professional', 'professional', 99, 'USD', 'Para hoteles en crecimiento', JSON.stringify(['100 habitaciones', '6 usuarios']), JSON.stringify({rooms:100,users:6}), JSON.stringify([]), 1, 1],
      ['plan-enterprise', 'Enterprise', 'enterprise', 199, 'USD', 'Para hoteles grandes', JSON.stringify(['Habitaciones ilimitadas', 'Usuarios ilimitados']), JSON.stringify({rooms:9999,users:9999}), JSON.stringify([]), 1, 2],
      ['plan-essential', 'Essential', 'essential', 99, 'USD', 'PMS + Channel + Reservas + Pagos', JSON.stringify(['20 habitaciones', '2 usuarios']), JSON.stringify({rooms:20,users:2}), JSON.stringify(['planning','reservations','reservations.checkin','guests','settings.rooms','channel','finance.billing','finance.payments','operations.maintenance']), 1, 3],
      ['plan-ultra', 'Ultra', 'ultra', 0, 'USD', 'Plan custom — todos los módulos', JSON.stringify(['Habitaciones ilimitadas', 'Usuarios ilimitados']), JSON.stringify({rooms:9999,users:9999}), JSON.stringify([]), 1, 4],
    ]

    for (const [id, name, slug, price, currency, desc, features, limits, modules, active, sort] of plans) {
      await client.query(
        `INSERT INTO plans (id, name, slug, price, currency, description, features, limits, modules, isactive, sortorder)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [id, name, slug, price, currency, desc, features, limits, modules, active, sort]
      )
    }
    console.log('✅ Plans seed completado')

    // Create amenities_catalog if not exists
    await client.query(`
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
    client.release()
    await pool.end()
  }
}

migrate().catch(console.error)
