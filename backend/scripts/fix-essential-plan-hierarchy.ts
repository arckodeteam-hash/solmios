// scripts/fix-essential-plan-hierarchy.ts — UNIVERSAL (PostgreSQL + SQLite).
// Fix puntual (auditoría Meta 2026-08-26): plan-essential existe a $99, el MISMO precio que
// Professional (100 habitaciones) y MÁS CARO que Starter ($49) — y el copy de marketing de
// Starter (frontend/src/services/PlanCatalog.service.ts) dice literalmente "Todo lo del plan
// Essential" como primer beneficio (Starter tiene modules:[] = todos los módulos; Essential
// tiene la lista acotada del PRD §5, así que la promesa es real). Con Essential más caro que el
// plan que dice incluirlo, nadie lo elegiría nunca. create-plans-table.ts es insert-only (ON
// CONFLICT/duplicate DO NOTHING), así que un entorno donde plan-essential YA se sembró con el
// precio viejo no se corrige solo reseedeando. Este script empuja el UPDATE explícito.
// Idempotente (correr dos veces no rompe nada).
//
// Local (SQLite):   DB_PATH=data/managerhotel.db bun run scripts/fix-essential-plan-hierarchy.ts
// Prod (Postgres):  DATABASE_URL=postgres://... bun run scripts/fix-essential-plan-hierarchy.ts
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

interface PlanRow { id: string }

async function main(): Promise<void> {
  await db.connect()
  try {
    const rows = (await db.query("SELECT id FROM plans WHERE id = 'plan-essential'")) as PlanRow[]
    if (!rows[0]) {
      console.log('plan-essential no existe en esta DB — nada que corregir (create-plans-table.ts ya siembra el valor correcto).')
      return
    }

    // sortorder 0: entre host (-1) y starter (ahora 1) — habitaciones y módulos no cambian,
    // solo el precio y la posición, para que "Starter incluye Essential" tenga sentido comercial.
    await db.run(`UPDATE plans SET price = ?, sortorder = ? WHERE id = 'plan-essential'`, [39, 0])
    console.log('✅ plan-essential: $99 → $39, sortorder 3 → 0 (queda entre Host y Starter, más barato que el plan que dice incluirlo)')
  } finally {
    await db.close()
  }
}

main().catch((e: unknown) => {
  console.error('fix-essential-plan-hierarchy falló:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
