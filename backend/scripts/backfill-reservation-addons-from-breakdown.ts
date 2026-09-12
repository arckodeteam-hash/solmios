// scripts/backfill-reservation-addons-from-breakdown.ts — UNIVERSAL (PostgreSQL + SQLite).
//
// Materializa como `reservation_addons` (source 'booking_engine') los extras que el motor
// público cobró ANTES de #269 (MR-04). Hasta ese cambio, los upsells / amenidades infantiles /
// amenidades de habitación quedaban sólo como snapshot en `priceBreakdown`, `childAmenities`,
// `roomAmenities` y como texto en `notes` ("Upsells: Transfer×1=30.00, ..."). Nada de eso es un
// cargo: al check-in el folio nacía con la habitación sola, el prepago (que incluía los extras)
// se cruzaba contra ese folio incompleto y el checkout dejaba un "saldo a favor" que no existe.
//
// Con una fila por extra, el check-in y el night audit (#269, subtareas 3 y 4) postean cada uno
// al folio con `reference addon:<id>` y el panel los lista sin parsear `notes`.
//
// Qué toma: reservas con `accessToken` no nulo/vacío (sólo el motor público lo setea) y
// `priceBreakdown` no nulo, cuyo breakdown tenga extras (upsellsTotal + childAmenitiesTotal +
// roomAmenitiesTotal > 0) y que todavía NO tengan addons `source:'booking_engine'`.
//
// De dónde sale cada fila (misma función que usa el motor: `buildBookingEngineAddons`):
//   - upsells          ← `notes` "Upsells: <nombre>×<qty>=<total>, ..." (unitario = total / qty).
//                        Fragmentos "id×qty" sin "=" (reservas sin catálogo cableado) se ignoran.
//   - child_amenity    ← `childAmenities` [{name, price, quantity}]
//   - room_amenity     ← `roomAmenities`  [{name, price, quantity}]
//   - taxRate          ← Σ `rate` de `priceBreakdown.taxBreakdown` (0 si no hay)
//
// Idempotente: una reserva que ya tiene addons `booking_engine` se saltea, así la segunda corrida
// crea 0. Test: `src/modules/reservas/tests/backfill-reservation-addons.test.ts`.
//
// **Paso post-deploy de #269.** Uso:
//   DB_PATH=data/managerhotel.db bun run scripts/backfill-reservation-addons-from-breakdown.ts [--dry]
//   DATABASE_URL=postgres://... bun run scripts/backfill-reservation-addons-from-breakdown.ts [--dry]
//
// `--dry` recorre y cuenta sin escribir una sola fila.
import type { Logger } from 'arckode-framework'
import {
  buildBookingEngineAddons, totalTaxRateOf, BOOKING_ENGINE_ADDON_SOURCE,
  type BookingEngineUpsellInput, type BookingEngineAmenityInput,
} from '../src/shared/usecases/booking-engine-addons'
import { round2 } from '../src/shared/utils/money'

/** Lo mínimo del ORM que usa el backfill (el `ORM` del framework lo cumple; los tests usan uno en memoria). */
export interface BackfillOrm {
  findMany(model: string, filter?: Record<string, unknown>): Promise<any[]>
  create(model: string, data: object): Promise<any>
}

export interface BackfillOptions {
  /** Recorre y cuenta, sin escribir una sola fila. */
  dryRun?: boolean
  logger?: Pick<Logger, 'info' | 'warn'>
}

export interface BackfillSummary {
  /** Reservas del motor (accessToken + priceBreakdown) revisadas. */
  scanned: number
  /** Filas de `reservation_addons` creadas (0 en dry-run). */
  created: number
  /** Reservas salteadas: sin extras en el breakdown o ya con addons `booking_engine`. */
  skipped: number
}

/** Prefijo con que `public-booking.ts` / `public-booking-group.ts` escriben el resumen en `notes`. */
const UPSELLS_NOTE_PREFIX = 'Upsells:'

/**
 * Parsea el fragmento "Upsells: Transfer×1=30.00, Late checkout×2=40.00" de `notes`.
 * Cada item es `<nombre>×<qty>=<total>` (total = unitario × qty, ver `upsellSummary` en
 * `bookingengine/usecases/public-booking.ts`). Los items sin "=" son ids sin resolver
 * ("abc×1", reservas creadas sin catálogo cableado): no tienen precio, se ignoran.
 * El fragmento termina en el próximo salto de línea o en el próximo " | " (separador de notesParts).
 */
export function parseUpsellSummary(notes: unknown): BookingEngineUpsellInput[] {
  const text = typeof notes === 'string' ? notes : ''
  const start = text.indexOf(UPSELLS_NOTE_PREFIX)
  if (start < 0) return []
  let fragment = text.slice(start + UPSELLS_NOTE_PREFIX.length)
  const end = fragment.search(/\r?\n| \| /)
  if (end >= 0) fragment = fragment.slice(0, end)

  const lines: BookingEngineUpsellInput[] = []
  for (const raw of fragment.split(',')) {
    const item = raw.trim()
    if (!item) continue
    const m = /^(.+?)×(\d+)=(\d+(?:\.\d+)?)$/.exec(item)
    if (!m) continue // "id×qty" sin precio, o texto que no es un upsell
    const name = m[1].trim()
    const quantity = Math.max(1, Math.floor(Number(m[2]) || 1))
    const total = Number(m[3]) || 0
    if (!name) continue
    lines.push({ name, quantity, unitPrice: round2(total / quantity) })
  }
  return lines
}

/** Columnas `json` del ORM llegan parseadas; por si alguna llega como texto (SQL crudo), se tolera. */
function asJson<T>(value: unknown): T | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return null }
  }
  return value as T
}

/** Snapshot [{key, name, price, quantity, total}] → input del helper (sólo lo que usa). */
function amenityLines(value: unknown): BookingEngineAmenityInput[] {
  const arr = asJson<any[]>(value)
  if (!Array.isArray(arr)) return []
  return arr
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({
      name: String(a.name ?? a.key ?? '').trim(),
      price: Number(a.price) || 0,
      quantity: Math.max(1, Math.floor(Number(a.quantity) || 1)),
    }))
    .filter((a) => a.name)
}

interface Breakdown {
  upsellsTotal?: number
  childAmenitiesTotal?: number
  roomAmenitiesTotal?: number
  taxBreakdown?: Array<{ name?: string; rate?: number; amount?: number }>
}

function extrasTotalOf(b: Breakdown): number {
  return round2((Number(b.upsellsTotal) || 0) + (Number(b.childAmenitiesTotal) || 0) + (Number(b.roomAmenitiesTotal) || 0))
}

/**
 * Recorre las reservas del motor y crea los addons faltantes. Devuelve el resumen; el CLI es
 * quien lo imprime. `findMany('Reservations', {})` sin filtro porque el `buildWhere` del ORM sólo
 * hace `campo = ?` (no hay "IS NOT NULL"): se filtra en memoria.
 */
export async function backfillReservationAddonsFromBreakdown(
  orm: BackfillOrm, options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const { dryRun = false, logger } = options
  const summary: BackfillSummary = { scanned: 0, created: 0, skipped: 0 }

  const reservations = (await orm.findMany('Reservations', {})) ?? []
  for (const r of reservations) {
    const accessToken = String(r.accessToken ?? '').trim()
    const breakdown = asJson<Breakdown>(r.priceBreakdown)
    if (!accessToken || !breakdown || typeof breakdown !== 'object') continue // no es del motor
    summary.scanned++

    if (extrasTotalOf(breakdown) <= 0) { summary.skipped++; continue }

    const existing = await orm.findMany('ReservationAddons', { reservationId: r.id, source: BOOKING_ENGINE_ADDON_SOURCE })
    if (existing.length > 0) { summary.skipped++; continue }

    const rows = buildBookingEngineAddons({
      reservationId: String(r.id),
      hotelId: String(r.hotelId),
      taxRate: totalTaxRateOf((breakdown.taxBreakdown ?? []).map((t) => ({ rate: Number(t?.rate) || 0 }))),
      upsells: parseUpsellSummary(r.notes),
      childAmenities: amenityLines(r.childAmenities),
      roomAmenities: amenityLines(r.roomAmenities),
    })
    if (rows.length === 0) {
      // El breakdown dice que hubo extras pero no hay de dónde reconstruirlos (notes editadas,
      // upsells sin catálogo): se avisa y no se inventa nada.
      logger?.warn('backfill reservation_addons: reserva con extras en priceBreakdown pero sin líneas reconstruibles', {
        reservationId: r.id, hotelId: r.hotelId, extrasTotal: extrasTotalOf(breakdown),
      })
      summary.skipped++
      continue
    }

    const sum = round2(rows.reduce((s, row) => s + row.amount * row.quantity, 0))
    logger?.info(`backfill reservation_addons: reserva ${String(r.id).slice(0, 8)} → ${rows.length} addon(s), Σ ${sum}${dryRun ? ' (dry-run)' : ''}`, {
      reservationId: r.id, hotelId: r.hotelId, extrasTotal: extrasTotalOf(breakdown),
    })
    if (dryRun) continue
    for (const row of rows) {
      await orm.create('ReservationAddons', row)
      summary.created++
    }
  }

  logger?.info('backfill reservation_addons: terminado', { ...summary, dryRun })
  return summary
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// Solo cuando se ejecuta como script: importarlo desde el test NO conecta ninguna base.
if (import.meta.main) {
  const { ORM } = await import('arckode-framework')
  const { SqliteAdapter } = await import('arckode-framework/adapters/sqlite')
  const { PostgresAdapter } = await import('arckode-framework/adapters/postgres')
  const { registerSharedModels } = await import('../src/shared/models')
  const { registerReservasModels } = await import('../src/modules/reservas/model')

  const dryRun = process.argv.includes('--dry')

  const DATABASE_URL = process.env.DATABASE_URL
  const db = DATABASE_URL
    ? new PostgresAdapter({ connectionString: DATABASE_URL })
    : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })
  await db.connect()
  const orm = new ORM(db)
  registerSharedModels(orm)
  registerReservasModels(orm)

  // Logger mínimo: el script no levanta el System, así que no hay logger del framework.
  const logger = {
    info: (msg: string, meta?: unknown) => console.log(msg, meta ?? ''),
    warn: (msg: string, meta?: unknown) => console.warn(msg, meta ?? ''),
  }

  try {
    const summary = await backfillReservationAddonsFromBreakdown(orm, { dryRun, logger })
    console.log(dryRun
      ? `Corrida en seco: ${summary.scanned} reserva(s) del motor revisadas, ${summary.skipped} salteadas — usá sin --dry para escribir.`
      : `Listo: ${summary.scanned} reserva(s) del motor revisadas, ${summary.created} addon(s) creados, ${summary.skipped} salteadas.`)
  } finally {
    await db.close()
  }
  process.exit(0)
}
