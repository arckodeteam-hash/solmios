// folios/usecases/folio-entries.ts — Alta de líneas en el folio: cargos y pagos.
// Extraído del service para mantenerlo < 200 líneas.
//
// Un pago se guarda como una línea más del folio, con `total` negativo: el saldo es la suma
// de todas las líneas (ver folio-math.computeTotals). Por eso ambos comparten esta forma.

import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { FolioDTO, FolioChargeDTO, PostChargeDTO, ApplyPaymentDTO, CurrentUser } from '../types'
import { taxRateFor, applyTax, computeTotals } from './folio-math'
import { recordFolioPayment, normalizeFolioPaymentMethod, type FolioPaymentPort } from './payment-port'
// Tolerancia de centavos: UNA sola en todo el dominio de dinero (shared/utils/money.ts).
import { BALANCE_EPSILON } from '../../../shared/utils/money'

const now = () => new Date().toISOString()

/**
 * Detecta la violación de UNIQUE/PK en SQLite y Postgres (el mensaje difiere por motor). Mismo
 * criterio que `PaymentEventStore.isDuplicateError` (services/payment-gateway/payment-events.ts) —
 * replicado acá (no importado) porque ese store es de webhooks de pasarela, un scope distinto.
 */
function isDuplicateError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e).toLowerCase()
  return (
    msg.includes('unique constraint') ||   // SQLite: "UNIQUE constraint failed"
    msg.includes('duplicate key') ||        // Postgres: "duplicate key value violates unique constraint"
    msg.includes('constraint failed')
  )
}

/**
 * Claim-first (idempotencia-settlement-pos): si `reference` es una idempotency key del POS
 * (`'pos:' + orderId`), un UNIQUE index parcial (hotelId,reference) WHERE source='pos' es la
 * barrera atómica. Se intenta crear; si el insert choca contra el índice (reintento/concurrencia),
 * se busca y devuelve el cargo YA creado en vez de duplicarlo. Sin `reference` (o sin prefijo
 * `pos:`), el comportamiento es el de siempre: create liso.
 */
async function createChargeIdempotent(
  deps: FolioEntriesDeps,
  payload: Record<string, unknown> & { hotelId: string },
  reference?: string,
): Promise<FolioChargeDTO> {
  if (!reference || !reference.startsWith('pos:')) {
    return (await deps.chargeRepo.create(payload as any)) as FolioChargeDTO
  }
  try {
    return (await deps.chargeRepo.create(payload as any)) as FolioChargeDTO
  } catch (e) {
    if (!isDuplicateError(e)) throw e
    const existing = await deps.chargeRepo.findMany({ hotelId: payload.hotelId, reference } as any)
    if (existing[0]) {
      deps.logger.info('Cargo POS duplicado detectado — devolviendo el existente', {
        hotelId: payload.hotelId, reference,
      })
      return existing[0] as FolioChargeDTO
    }
    throw e // constraint disparó pero no encontramos la fila: error real, no silenciar
  }
}

export interface FolioEntriesDeps {
  folioRepo: RepositoryAdapter<FolioDTO>
  chargeRepo: RepositoryAdapter<FolioChargeDTO>
  configRepo: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  logger: Logger
  paymentPort?: FolioPaymentPort | null
  /** Fallback de taxRateFor a hotels.taxRate — ver el comentario en folio-math.ts. */
  hotelsRepo?: RepositoryAdapter<any>
}

/** Carga el folio, valida ownership y que esté abierto. */
/** Carga el folio, verifica que sea del hotel del usuario y que esté abierto. */
export async function assertOpenFolio(deps: FolioEntriesDeps, folioId: string, user: CurrentUser): Promise<FolioDTO> {
  const folio = await deps.folioRepo.findById(folioId)
  if (!folio) throw new NotFoundError('Folio no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(folio.hotelId, me?.hotelId ?? '', user.role, 'super_admin')
  if (folio.status !== 'open') throw new ValidationError('El folio no está abierto')
  return folio
}

export async function postCharge(
  deps: FolioEntriesDeps,
  folioId: string,
  dto: PostChargeDTO,
  user: CurrentUser,
): Promise<{ folio: FolioDTO; charge: FolioChargeDTO }> {
  const folio = await assertOpenFolio(deps, folioId, user)

  const qty = Number(dto.quantity) || 1
  const base = (Number(dto.amount) || 0) * qty
  if (base <= 0) throw new ValidationError('El monto del cargo debe ser positivo')

  const rate = await taxRateFor(deps.configRepo, folio.hotelId, deps.hotelsRepo)
  const { tax, total } = applyTax(base, rate)
  const charge = await createChargeIdempotent(deps, {
    folioId, hotelId: folio.hotelId, description: dto.description,
    category: dto.category ?? 'other', kind: 'charge', quantity: qty,
    amount: base, taxes: tax, total, source: dto.source ?? 'manual', reference: dto.reference,
    postedAt: now(),
  }, dto.reference)

  deps.logger.info('Cargo agregado al folio', {
    folioId, chargeId: charge.id, description: dto.description, base, tax, total,
  })
  return { folio, charge }
}

export async function applyPayment(
  deps: FolioEntriesDeps,
  folioId: string,
  dto: ApplyPaymentDTO,
  user: CurrentUser,
): Promise<{ folio: FolioDTO; charge: FolioChargeDTO }> {
  const folio = await assertOpenFolio(deps, folioId, user)

  const amount = Number(dto.amount) || 0
  if (amount <= 0) throw new ValidationError('El monto del pago debe ser positivo')

  const charges = await deps.chargeRepo.findMany({ folioId })
  const { balance } = computeTotals(charges as FolioChargeDTO[])
  if (amount > balance + BALANCE_EPSILON) {
    throw new ValidationError(`El pago ($${amount}) excede el saldo pendiente ($${balance})`)
  }

  const method = normalizeFolioPaymentMethod(dto.method)

  // Asiento del dinero PRIMERO: si no se puede registrar en `payments` (caja, conciliación), el
  // pago entero falla y el folio queda intacto. Bajar el saldo sin asentar la plata es peor.
  const payment = await recordFolioPayment(deps.paymentPort ?? null, deps.logger, {
    hotelId: folio.hotelId,
    folioId,
    guestId: folio.guestId ?? null,
    amount,
    currency: folio.currency ?? 'USD',
    method,
    reference: dto.reference,
    description: `Pago de folio ${folioId.slice(0, 8)}`,
  })

  const charge = await deps.chargeRepo.create({
    folioId, hotelId: folio.hotelId,
    description: `Pago${dto.method ? ` (${dto.method})` : ''}${dto.reference ? ` · Ref ${dto.reference}` : ''}`,
    category: 'payment', kind: 'payment', quantity: 1, amount: -amount, taxes: 0,
    total: -amount, source: method, postedAt: now(),
  } as any)

  deps.logger.info('Pago aplicado al folio', {
    folioId, chargeId: charge.id, amount, method,
    balanceBefore: balance, balanceAfter: balance - amount, paymentId: payment?.id ?? null,
  })
  return { folio, charge: charge as FolioChargeDTO }
}
