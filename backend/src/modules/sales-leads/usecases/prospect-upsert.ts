// sales-leads/usecases/prospect-upsert.ts — Lo que ventas anota sobre un prospecto (REQ-PIPE-03).
//
// `sales_prospects` no existe hasta que alguien anota algo: el primer PUT la crea, los siguientes
// la pisan campo a campo. La clave es `hotel:<id>` o `lead:<id>` — la misma que devuelve el GET —
// y tiene que apuntar a algo real: anotar un "próximo paso" sobre un hotel que no existe es una
// fila huérfana que nadie va a ver nunca.
//
// Todo cambio deja rastro en `audit_log` con `hotelId='platform'`: es una acción del dueño del SaaS
// sobre su embudo, no contenido de un hotel. Se escribe por el repo inyectado (sin importar el
// módulo auditlog) y NUNCA tumba la operación: un audit caído no debe frenar a ventas.
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import { SALES_LOST_REASONS } from '../types'
import type { SalesLeadDTO, SalesProspectDTO, UpdateSalesProspectDTO } from '../types'
import { assertAssignable } from './assignees'

export const PLATFORM_HOTEL_ID = 'platform'
export const PROSPECT_AUDIT_ACTION = 'sales_prospect.update'

export type ProspectTarget = { kind: 'hotel'; hotelId: string } | { kind: 'lead'; leadId: string }
export type ProspectActor = { id?: string; name?: string; email?: string } | undefined

export interface UpsertProspectDeps {
  salesProspects: RepositoryAdapter<SalesProspectDTO>
  hotels: RepositoryAdapter<any>
  salesLeads: RepositoryAdapter<SalesLeadDTO>
  auditlog: RepositoryAdapter<any>
  /** `users`: `assignedTo` tiene que ser un admin activo de la plataforma (SEC-3). */
  users: RepositoryAdapter<any>
  logger: Logger
  now?: () => Date
}

const KEY_RE = /^(hotel|lead):(.+)$/

export function parseProspectKey(key: string): ProspectTarget {
  const m = KEY_RE.exec(String(key ?? '').trim())
  if (!m) throw new ValidationError('key: debe ser hotel:<id> o lead:<id>')
  return m[1] === 'hotel' ? { kind: 'hotel', hotelId: m[2] } : { kind: 'lead', leadId: m[2] }
}

const EDITABLE: ReadonlyArray<keyof UpdateSalesProspectDTO> = [
  'nextStepAt', 'nextStepNote', 'assignedTo', 'contactedAt', 'lostAt', 'lostReason', 'notes',
]

/**
 * Solo lo que vino en el body (parcial). `undefined` = no tocar; `null` = limpiar.
 * `lostReason` fuera del enum se rechaza acá también (el schema ya lo corta en HTTP; esto cubre a
 * quien llame al service desde un cron o un test sin pasar por el controller).
 */
function pickChanges(input: UpdateSalesProspectDTO): Partial<SalesProspectDTO> {
  const changes: Record<string, unknown> = {}
  for (const f of EDITABLE) {
    if (input[f] === undefined) continue
    changes[f] = input[f]
  }
  // COR-5: un `<select>` vacío manda ''. "Sin asignar" es null en la base, nunca cadena vacía.
  if (changes.assignedTo === '') changes.assignedTo = null
  if (changes.lostReason != null && !(SALES_LOST_REASONS as readonly string[]).includes(String(changes.lostReason))) {
    throw new ValidationError(`lostReason: debe ser una de ${SALES_LOST_REASONS.join(', ')}`)
  }
  return changes as Partial<SalesProspectDTO>
}

async function assertTargetExists(deps: UpsertProspectDeps, target: ProspectTarget): Promise<void> {
  if (target.kind === 'hotel') {
    const hotel = await deps.hotels.findById(target.hotelId)
    if (!hotel) throw new NotFoundError('Hotel no encontrado')
    return
  }
  const lead = await deps.salesLeads.findById(target.leadId)
  if (!lead) throw new NotFoundError('Lead no encontrado')
}

function targetFilter(target: ProspectTarget): Record<string, string> {
  return target.kind === 'hotel' ? { hotelId: target.hotelId } : { leadId: target.leadId }
}

export async function upsertProspect(
  deps: UpsertProspectDeps,
  target: ProspectTarget,
  input: UpdateSalesProspectDTO,
  actor: ProspectActor,
): Promise<SalesProspectDTO> {
  const now = deps.now ? deps.now() : new Date()
  const changes = pickChanges(input)
  await assertTargetExists(deps, target)
  await assertAssignable(deps.users, changes.assignedTo)

  const existing = await deps.salesProspects.findOne(targetFilter(target))

  // Perdido: marcar el motivo sin fecha sella la fecha; limpiar el motivo sin tocar la fecha la
  // limpia también. Un "perdido" es (fecha, motivo): no tiene sentido que quede la mitad.
  if (changes.lostReason && changes.lostAt === undefined && !existing?.lostAt) {
    changes.lostAt = now.toISOString()
  }
  if (changes.lostReason === null && changes.lostAt === undefined) {
    changes.lostAt = null
  }

  let saved: SalesProspectDTO | null
  if (existing) {
    saved = Object.keys(changes).length > 0
      ? await deps.salesProspects.update(existing.id, changes)
      : existing
    if (!saved) throw new NotFoundError('Prospecto no encontrado')
  } else {
    saved = await deps.salesProspects.create({
      hotelId: target.kind === 'hotel' ? target.hotelId : null,
      leadId: target.kind === 'lead' ? target.leadId : null,
      nextStepAt: null,
      nextStepNote: null,
      assignedTo: null,
      contactedAt: null,
      lostAt: null,
      lostReason: null,
      notes: null,
      sequenceSent: {},
      ...changes,
    } as Omit<SalesProspectDTO, 'id'>)
  }

  await auditProspectChange(deps, target, changes, actor)
  return saved
}

/** Fila en `audit_log` (hotelId='platform'). Best-effort: se loguea y sigue si falla. */
async function auditProspectChange(
  deps: UpsertProspectDeps,
  target: ProspectTarget,
  changes: Partial<SalesProspectDTO>,
  actor: ProspectActor,
): Promise<void> {
  const entityId = target.kind === 'hotel' ? `hotel:${target.hotelId}` : `lead:${target.leadId}`
  try {
    await deps.auditlog.create({
      hotelId: PLATFORM_HOTEL_ID,
      userId: actor?.id ?? null,
      userName: actor?.name ?? actor?.email ?? null,
      action: PROSPECT_AUDIT_ACTION,
      entity: 'sales_prospect',
      entityId,
      detail: JSON.stringify(changes),
    })
  } catch (e) {
    deps.logger.error('sales-pipeline: no se pudo registrar la auditoría', { entityId, error: (e as Error).message })
  }
}

/**
 * FE-15: al borrar un `sales_lead`, su prospecto (`sales_prospects.leadId`) se va con él. Best-effort
 * (el módulo no usa transacciones): el lead ya no existe; un prospecto huérfano solo se loguea.
 */
export async function removeProspectOfLead(
  prospects: RepositoryAdapter<SalesProspectDTO> | undefined,
  logger: Logger,
  leadId: string,
): Promise<void> {
  if (!prospects) return
  try {
    const orphans = await prospects.findMany({ leadId })
    for (const p of orphans) await prospects.delete(p.id)
  } catch (e) {
    logger.warn('sales-leads: no se pudo borrar el prospecto del lead eliminado', { leadId, error: String(e) })
  }
}
