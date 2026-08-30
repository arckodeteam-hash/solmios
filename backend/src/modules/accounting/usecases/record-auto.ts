// accounting/usecases/record-auto.ts — Asiento automático desde un conector (CTB-4).
// Recibe líneas con CÓDIGO de cuenta (no id): las resuelve contra el plan del hotel, crea el
// asiento y lo postea directo. Idempotente (dedup por reference+referenceType en createJournalEntry).
//
// Self-gating: si el hotel no tiene el plan de cuentas seedeado (algún código no resuelve), es
// no-op — así la contabilidad automática solo corre para hoteles que la configuraron. Best-effort:
// el conector envuelve la llamada en try/catch, un fallo acá nunca rompe el módulo origen.
import { createJournalEntry, postEntry, type JournalDeps } from './journal-entry'
import { seedChartOfAccounts, taxNameOf } from './seed-chart-of-accounts'

export interface AutoLineInput { code: string; debit?: number; credit?: number; description?: string }

export interface RecordAutoInput {
  entryDate: string
  reference?: string
  referenceType?: string
  description?: string
  lines: AutoLineInput[]
}

export async function recordAutoEntry(
  deps: JournalDeps, hotelId: string, input: RecordAutoInput,
): Promise<{ id?: string; skipped?: boolean; deduped?: boolean }> {
  if (!hotelId || !Array.isArray(input.lines) || input.lines.length < 2) return { skipped: true }

  // Resolver códigos → accountId.
  //
  // Antes, si el hotel no tenía plan de cuentas esto devolvía `skipped` EN SILENCIO. El plan solo
  // se creaba si alguien apretaba "sembrar" a mano (`POST /api/accounting/seed`), así que todo
  // hotel nuevo cobraba plata que nunca quedaba asentada y nadie se enteraba (auditoría
  // 2026-08-30: un cobro de 220 del "Hotel Demo Canales" sin asiento, por eso).
  //
  // Ahora, ante la primera cuenta faltante se siembra el plan base y se reintenta UNA vez. El
  // seed es idempotente, así que un hotel con plan parcial completa lo que le falte y uno que ya
  // lo tiene no paga el costo (la primera búsqueda acierta y nunca se llega acá).
  let resolved = await resolveLines(deps, hotelId, input.lines)
  if (!resolved) {
    const seeded = await seedIfPossible(deps, hotelId)
    if (!seeded) return { skipped: true }
    resolved = await resolveLines(deps, hotelId, input.lines)
    if (!resolved) return { skipped: true }
  }
  const res = await createJournalEntry(deps, hotelId, {
    entryDate: input.entryDate, description: input.description,
    reference: input.reference, referenceType: input.referenceType, source: 'connector',
    lines: resolved,
  })
  // Los asientos automáticos se postean directo (no quedan en draft). Si vino dedupeado, ya estaba.
  if (!res.deduped) await postEntry(deps, res.id, hotelId)
  return { id: res.id, deduped: res.deduped }
}


/** Resuelve todas las líneas a `accountId`. Null si falta alguna cuenta. */
async function resolveLines(
  deps: JournalDeps,
  hotelId: string,
  lines: RecordAutoInput['lines'],
): Promise<{ accountId: string; debit?: number; credit?: number; description?: string }[] | null> {
  const out: { accountId: string; debit?: number; credit?: number; description?: string }[] = []
  for (const l of lines) {
    const acc = (await deps.accounts.findMany({ hotelId, code: l.code }))[0]
    if (!acc) return null
    out.push({ accountId: acc.id, debit: l.debit, credit: l.credit, description: l.description })
  }
  return out
}

/**
 * Siembra el plan base para un hotel que todavía no lo tiene. Best-effort: si falla, el asiento
 * se saltea como antes — que no se pueda crear el plan no puede tumbar el cobro que lo disparó.
 */
async function seedIfPossible(deps: JournalDeps, hotelId: string): Promise<boolean> {
  try {
    // El nombre del impuesto lo configura el HOTEL (`hotels.taxName`), no la plataforma: un
    // hotel mexicano no puede terminar con cuentas llamadas "ITBIS". Si no se puede leer, el
    // seed usa su default y el hotel puede renombrarlas desde su Plan de Cuentas.
    let taxName: string | undefined
    try {
      const hotel = await (deps.orm as any).findMany?.('Hotels', { id: hotelId })
      taxName = taxNameOf(hotel?.[0])
    } catch { /* default del seed */ }
    const res = await seedChartOfAccounts(deps.accounts, hotelId, taxName)
    return res.created > 0
  } catch {
    return false
  }
}
