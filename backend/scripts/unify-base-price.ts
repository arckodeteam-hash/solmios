// scripts/unify-base-price.ts — Un solo precio base por tipo de habitación, sin mover ni un centavo
// de lo que ya se está publicando. UNIVERSAL (PostgreSQL + SQLite vía DbAdapter, patrón de
// create-plans-table.ts).
//
// QUÉ ARREGLA
// `room_rates` guarda una columna `basePrice` por FILA, y una fila es (tipo × ocupación × temporada
// × canal). Nada obligaba a que coincidieran. Medido en producción el 2026-09-05, el Hotel Boutique
// Palma tenía TRES precios base para la misma suite: 120 en `rooms`, 120 en la grilla base y 250/220
// en el canal — el editor mostraba uno y el motor cobraba otro. Desde ahora el base se deriva
// siempre de la habitación (`src/modules/pricing/usecases/base-price.ts`); este script alinea los
// datos que ya estaban cargados.
//
// POR QUÉ NO ALCANZA CON PISAR EL BASE
// Pisar el base y dejar el porcentaje mueve el precio publicado: en Palma la suite habría caído de
// 374 a 204 en las OTAs, en vivo. El script hace lo contrario: fija el base del tipo y RECALCULA el
// porcentaje para que `price` quede idéntico. Los porcentajes quedan con decimales feos la primera
// vez; después el hotel pone el base que quiera y los porcentajes limpios, en un solo lugar.
//
// USO
//   cd backend && set -a && source .env && set +a
//   bun run scripts/unify-base-price.ts            # simulacro: no escribe nada
//   bun run scripts/unify-base-price.ts --apply    # escribe
//
// Idempotente: una segunda corrida no encuentra nada que cambiar.
//
// Sobre los nombres de columna: PG pliega los identificadores no entrecomillados a minúsculas
// (`basePrice` → `baseprice`) y SQLite es insensible a mayúsculas, así que el SQL va todo en
// minúsculas y los SELECT usan alias explícitos para que las filas lleguen igual desde los dos
// motores.

import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import type { DbAdapter } from 'arckode-framework'
import { percentagePreserving, effectiveRate } from '../src/shared/utils/base-price'

const APPLY = process.argv.includes('--apply')

/** Mismos topes que `pricing/validators/schema.ts`: fuera de rango, el guardado siguiente fallaría. */
const MIN_PCT = -100
const MAX_PCT = 1000
/** Tolerancia al comparar dinero ya redondeado a centavos. */
const EPSILON = 0.005

const DATABASE_URL = process.env.DATABASE_URL
const db: DbAdapter & { connect(): Promise<void> } = DATABASE_URL
  ? new PostgresAdapter({ connectionString: DATABASE_URL })
  : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })

interface RoomRow { hotel_id: string; room_type: string | null; base_price: number | null }
interface RateRow {
  id: string; hotel_id: string; room_type: string; occupancy: number; season: string
  channel: string | null; base_price: number | null; percentage: number | null; price: number | null
}

/** Precio base por (hotel, tipo): mínimo positivo entre las unidades del tipo — mismo criterio que
 *  `PricingQueries.roomTypesFor` y que el motor público para publicar "desde $X". */
export function basePriceIndex(rooms: readonly RoomRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rooms) {
    const key = `${r.hotel_id}|${r.room_type || 'standard'}`
    const price = Number(r.base_price) || 0
    if (price <= 0) continue
    const prev = out.get(key)
    if (prev === undefined || price < prev) out.set(key, price)
  }
  return out
}

/** El precio que la fila publica HOY. Si `price` viniera en 0 (fila legacy o derivada) se recompone
 *  del base+porcentaje grabados, que es lo que hace `rate-resolution.ts` al cotizar. */
export function currentPrice(r: Pick<RateRow, 'price' | 'base_price' | 'percentage'>): number {
  const stored = Number(r.price) || 0
  if (stored > 0) return stored
  return effectiveRate(Number(r.base_price) || 0, Number(r.percentage) || 0)
}

async function main(): Promise<void> {
  await db.connect()

  const rooms = (await db.query(
    'SELECT hotelid AS hotel_id, type AS room_type, baseprice AS base_price FROM rooms',
  )) as RoomRow[]
  const rates = (await db.query(
    `SELECT id, hotelid AS hotel_id, roomtype AS room_type, occupancy, season, channel,
            baseprice AS base_price, percentage, price
       FROM room_rates`,
  )) as RateRow[]
  const index = basePriceIndex(rooms)

  let aligned = 0, already = 0, noType = 0, zeroPrice = 0, skipped = 0
  const warnings: string[] = []
  const label = (r: RateRow): string =>
    `${r.hotel_id} ${r.room_type} occ${r.occupancy} ${r.season}${r.channel ? ` [${r.channel}]` : ''}`

  for (const r of rates) {
    const newBase = index.get(`${r.hotel_id}|${r.room_type}`)
    if (newBase === undefined) {
      // Tipo sin habitaciones con precio: fila huérfana. Se deja como está — ponerla en 0 la
      // publicaría gratis, y sigue siendo lo que la OTA vende hoy.
      noType++
      continue
    }
    const price = currentPrice(r)
    if (price <= 0) { zeroPrice++; continue }

    const newPct = percentagePreserving(price, newBase)
    if (newPct < MIN_PCT || newPct > MAX_PCT) {
      skipped++
      warnings.push(`  ${label(r)}: ${price} sobre base ${newBase} daría ${newPct}% (fuera de ${MIN_PCT}..${MAX_PCT})`)
      continue
    }

    // La invariante del script: el precio NO cambia. Si el redondeo del porcentaje a dos decimales
    // moviera dinero, se avisa y se saltea ANTES de escribir.
    const check = effectiveRate(newBase, newPct)
    if (Math.abs(check - price) >= EPSILON) {
      skipped++
      warnings.push(`  ${label(r)}: ${price} → ${check} por redondeo del porcentaje`)
      continue
    }

    const sameBase = Math.abs((Number(r.base_price) || 0) - newBase) < EPSILON
    const samePct = Math.abs((Number(r.percentage) || 0) - newPct) < EPSILON
    const samePrice = Math.abs((Number(r.price) || 0) - price) < EPSILON
    if (sameBase && samePct && samePrice) { already++; continue }

    if (APPLY) {
      await db.run(
        'UPDATE room_rates SET baseprice = ?, percentage = ?, price = ? WHERE id = ?',
        [newBase, newPct, price, r.id],
      )
    }
    aligned++
  }

  console.log(`\n${APPLY ? 'APLICADO' : 'SIMULACRO — usar --apply para escribir'}`)
  console.log(`  filas de tarifas:         ${rates.length}`)
  console.log(`  alineadas:                ${aligned}`)
  console.log(`  ya estaban bien:          ${already}`)
  console.log(`  tipo sin precio base:     ${noType}`)
  console.log(`  sin precio (nada que hacer): ${zeroPrice}`)
  console.log(`  salteadas:                ${skipped}`)
  if (warnings.length) console.log(`\nSalteadas (quedan como están):\n${warnings.join('\n')}`)
  console.log('')
}

main().catch((err) => { console.error(err); process.exit(1) })
