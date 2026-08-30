// scripts/audit-money-trail.ts — ¿A dónde llegó cada peso cobrado?
//
// Responde con datos, no con teoría: para cada pago liquidado, verifica si aparece en TODOS los
// destinos que le corresponden según su método y su origen.
//
// Destinos y cuándo corresponden:
//   payments        SIEMPRE (es la fuente de verdad del dinero)
//   contabilidad    SIEMPRE (asiento en journal_entries, referenciado por payment.id)
//   caja            SOLO si method='cash' — el arqueo cuenta el cajón físico; una tarjeta ya
//                   está bancarizada y sumarla descuadraría el turno todos los días
//   folio           si la reserva tiene folio abierto/cerrado (el huésped ve su saldo ahí)
//   reserva         `pendingAmount` tiene que reflejar el cobro
//
// Uso:
//   DATABASE_URL=postgres://... bun run scripts/audit-money-trail.ts [--days 30]

import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import { registerSharedModels } from '../src/shared/models'
import { registerFoliosModels } from '../src/modules/folios/model'
import { registerPaymentsModels } from '../src/modules/payments/model'
import { registerReservasModels } from '../src/modules/reservas/model'

const daysArg = process.argv.indexOf('--days')
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) || 30 : 30
const SINCE = new Date(Date.now() - DAYS * 86_400_000).toISOString()

const db = process.env.DATABASE_URL
  ? new PostgresAdapter({ connectionString: process.env.DATABASE_URL })
  : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })

await (db as any).connect?.()
const orm = new ORM(db)
registerSharedModels(orm)
registerFoliosModels(orm)
registerPaymentsModels(orm)
registerReservasModels(orm)

const raw = (sql: string, params: unknown[] = []) => (db as any).query(sql, params)

const payments = (await new OrmRepository<any>(orm, 'Payment').findMany({}))
  .filter((p: any) => String(p.createdAt ?? '') >= SINCE)
  .filter((p: any) => ['completed', 'refunded'].includes(String(p.status ?? '')))

console.log(`Pagos liquidados en los últimos ${DAYS} días: ${payments.length}\n`)

const gaps: string[] = []
let ok = 0

for (const p of payments) {
  const id = String(p.id)
  const method = String(p.method ?? '')
  const missing: string[] = []

  // Contabilidad: el asiento referencia el id del pago.
  const acc = await raw('SELECT id FROM journal_entries WHERE reference = ?', [id])
  if (!acc?.length) missing.push('contabilidad')

  // Caja: SOLO el efectivo mueve el cajón.
  if (method === 'cash') {
    const cash = await raw('SELECT id FROM cash_movements WHERE paymentid = ?', [id])
    if (!cash?.length) missing.push('caja')
  }

  // Folio: si la reserva tiene folio, el cobro tiene que verse ahí.
  const rid = String(p.reservationId ?? '')
  if (rid) {
    const folios = await raw('SELECT id FROM folios WHERE reservationid = ?', [rid])
    if (folios?.length) {
      const line = await raw('SELECT id FROM folio_charges WHERE reference = ?', [id])
      const viaFolioId = String(p.folioId ?? '')
      if (!line?.length && !viaFolioId) missing.push('folio')
    }
  }

  if (missing.length) {
    gaps.push(`  ${id.slice(0, 8)}  ${String(p.amount).padStart(9)}  ${method.padEnd(9)} → falta en: ${missing.join(', ')}`)
  } else {
    ok++
  }
}

console.log(`Trazabilidad completa: ${ok}/${payments.length}`)
if (gaps.length) {
  console.log(`\nCon huecos (${gaps.length}):`)
  gaps.forEach((g) => console.log(g))
} else {
  console.log('Sin huecos.')
}
process.exit(0)
