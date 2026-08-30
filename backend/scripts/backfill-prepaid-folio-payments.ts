// scripts/backfill-prepaid-folio-payments.ts — Asienta en folios YA abiertos los cobros que el
// motor web hizo antes del check-in.
//
// Contexto: el motor cobra antes de que exista folio. Hasta el fix del 2026-08-30 el check-in
// creaba el folio sin esos pagos, así que el folio pedía plata ya cobrada y el settlement del
// checkout la volvía a facturar. El fix cubre los check-in nuevos; este script arregla los
// folios que ya se abrieron mal.
//
// Idempotente: usa `prepaidLinesFrom` con las referencias ya presentes en el folio, así correrlo
// dos veces no duplica líneas. NO crea filas en `payments` — el cobro ya está asentado ahí.
//
// Uso:
//   DATABASE_URL=postgres://... bun run scripts/backfill-prepaid-folio-payments.ts [--apply]
//   DB_PATH=data/managerhotel.db bun run scripts/backfill-prepaid-folio-payments.ts [--apply]
//
// Sin `--apply` corre en seco: dice qué haría y no escribe nada.

import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import { registerSharedModels } from '../src/shared/models'
import { registerFoliosModels } from '../src/modules/folios/model'
import { registerPaymentsModels } from '../src/modules/payments/model'
import { prepaidLinesFrom } from '../src/shared/usecases/prepaid-folio-lines'

const APPLY = process.argv.includes('--apply')

const db = process.env.DATABASE_URL
  ? new PostgresAdapter({ connectionString: process.env.DATABASE_URL })
  : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })

await (db as any).connect?.()
const orm = new ORM(db)
registerSharedModels(orm)
registerFoliosModels(orm)
registerPaymentsModels(orm)

const folioRepo = new OrmRepository<any>(orm, 'Folios')
const chargeRepo = new OrmRepository<any>(orm, 'FolioCharges')
const paymentRepo = new OrmRepository<any>(orm, 'Payment')

const folios = await folioRepo.findMany({ status: 'open' })
console.log(`Folios abiertos: ${folios.length}${APPLY ? '' : '  (corrida en seco — usá --apply para escribir)'}`)

let touched = 0
let created = 0

for (const folio of folios) {
  const reservationId = String(folio.reservationId ?? '')
  if (!reservationId) continue

  const [charges, payments] = await Promise.all([
    chargeRepo.findMany({ folioId: folio.id }),
    paymentRepo.findMany({ hotelId: folio.hotelId, reservationId }),
  ])

  const alreadyReferenced = charges
    .filter((c: any) => c.kind === 'payment')
    .map((c: any) => String(c.reference ?? ''))
    .filter(Boolean)

  const lines = prepaidLinesFrom(payments as any[], alreadyReferenced)
  if (!lines.length) continue

  touched++
  const total = lines.reduce((s, l) => s + (l.kind === 'payment' ? l.amount : -l.amount), 0)
  console.log(`  folio ${folio.id} (reserva ${reservationId.slice(0, 8)}): ${lines.length} línea(s), neto ${total}`)

  if (!APPLY) continue
  const nowIso = new Date().toISOString()
  for (const line of lines) {
    await chargeRepo.create({
      id: crypto.randomUUID(), folioId: folio.id, hotelId: folio.hotelId,
      description: line.description,
      category: 'payment', kind: line.kind, quantity: 1,
      amount: line.amount, taxes: 0, total: line.amount,
      source: 'prepaid-backfill', postedAt: nowIso, reference: line.paymentId,
    })
    created++
  }
}

console.log(APPLY
  ? `Listo: ${touched} folio(s) corregido(s), ${created} línea(s) creada(s).`
  : `Corrida en seco: ${touched} folio(s) necesitan corrección.`)
process.exit(0)
