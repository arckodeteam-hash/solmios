// promo-codes/usecases/promo-crud.ts — Admin CRUD de códigos promocionales (F2 2.2).
//
// Reglas de negocio:
//  - Ownership IDOR: toda operación admin valida que el code pertenezca al hotel del
//    JWT. `findOne({id})` + `auth.assertOwnership(record.hotelId, user.hotelId, ...)`.
//    (Mismo patrón textual que landing/usecases/blocks-crud.ts.)
//  - Multi-tenant: TODO filtrado por hotelId. NUNCA exponer codes de otros hoteles.
//  - Unique (hotelId, code): el service captura la violación del UNIQUE index físico
//    (`promo_codes_hotel_code`, migrate-db.ts) y la traduce a ValidationError en vez
//    de dejar pasar el error crudo del motor (SQLite/PG mensajes distintos).
//  - `code` se normaliza UPPERCASE al crear/editar (case-insensitive desde el lado del
//    huésped: "welcome10" ≡ "WELCOME10"). El UNIQUE index es case-sensitive a nivel
//    físico → la normalización a uppercase acá garantiza que no haya dos codes que
//    colisionen por casing distinto.
//  - Validación de `kind` (enum cerrado) y `value` (0-100 si percent, >=0 si fixed)
//    vive acá: depende del `kind`, el validador no soporta unión discriminada.
//  - NO incrementa `uses` (eso ocurre en task 2.5 al crear la reserva con éxito).
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en model.ts. Si lo
// agregás acá, declaralo allá también (case-sensitive) o se descarta silenciosamente.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  PromoCodeDTO, CreatePromoCodeDTO, UpdatePromoCodeDTO, PromoCodeKind, CurrentUser,
} from '../types'
import { windowEpochMs } from './promo-validate'

export interface PromoCrudDeps {
  promoCodes: RepositoryAdapter<PromoCodeDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
}

// ─── helpers ───────────────────────────────────────────────────────────────

/** Hotel efectivo del JWT; rechaza si el usuario no tiene hotel asignado. */
function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

/** Valida que `t` esté en el enum cerrado. */
function assertKind(t: unknown): PromoCodeKind {
  if (t !== 'percent' && t !== 'fixed') {
    throw new ValidationError("kind debe ser 'percent' o 'fixed'")
  }
  return t
}

/** Valida el value según kind: porcentaje en [0,100], fijo >=0. */
function assertValueForKind(kind: PromoCodeKind, value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError('value debe ser un número >= 0')
  }
  if (kind === 'percent' && n > 100) {
    throw new ValidationError('value para kind=percent debe estar en [0, 100]')
  }
  return n
}

/**
 * Detecta la violación de UNIQUE/PK en SQLite y Postgres (el mensaje difiere por motor).
 * Mismo criterio que folio-entries.isDuplicateError — replicado acá (no importado) para
 * mantener el módulo aislado (no cruza a folios solo por una función de 4 líneas).
 */
function isDuplicateError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e).toLowerCase()
  return (
    msg.includes('unique constraint') ||     // SQLite: "UNIQUE constraint failed"
    msg.includes('duplicate key') ||          // Postgres: "duplicate key value violates unique constraint"
    msg.includes('constraint failed') ||
    msg.includes('promo_codes_hotel_code')    // nombre físico del index (defensivo)
  )
}

/** Normaliza el code a UPPERCASE y trimea espacios. */
function normalizeCode(raw: string): string {
  return String(raw ?? '').trim().toUpperCase()
}

// ─── PC-3 (auditoría 2026-08-19): fechas y rangos ─────────────────────────────────────
// Antes validFrom/validTo eran `type:'string'` sin formato ni coherencia, y maxUses/minAmount
// sin rango. Consecuencias reales: fecha mal tipeada ("31/12/2026") → inparseable → runtime la
// trataba como "sin ventana" → código vigente PARA SIEMPRE; maxUses:-5 → uses >= -5 siempre
// true → agotado permanente; maxUses:0 → código inutilizable creado sin error.

/** Acepta date-only "YYYY-MM-DD" o ISO completa con hora/zona. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** Valida el formato de una fecha de ventana; null si el campo viene ausente/vacío. */
function assertDateField(label: string, v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (!ISO_DATE_RE.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ValidationError(`${label} debe ser fecha ISO válida (YYYY-MM-DD)`)
  }
  return s
}

/** maxUses: entero >= 1, o null (ausente) = ilimitado. */
function assertMaxUses(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError('maxUses debe ser entero >= 1 (vacío = ilimitado)')
  }
  return n
}

/** minAmount: número >= 0, o null = sin mínimo. */
function assertMinAmount(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError('minAmount debe ser un número >= 0')
  }
  return n
}

/**
 * Coherencia de la ventana usando la MISMA semántica de runtime (windowEpochMs: date-only
 * 'to' = fin de día) — así "from y to el mismo día date-only" es válido acá y en validate.
 * Fechas legacy corruptas (NaN) no bloquean el update de OTROS campos (NaN vs NaN no compara).
 */
function assertWindowOrder(validFrom: string | null, validTo: string | null): void {
  if (!validFrom || !validTo) return
  const from = windowEpochMs(validFrom, 'from')
  const to = windowEpochMs(validTo, 'to')
  if (from !== null && to !== null && !Number.isNaN(from) && !Number.isNaN(to) && to <= from) {
    throw new ValidationError('validTo debe ser posterior a validFrom')
  }
}

/**
 * Resuelve el hotelId efectivo del usuario (vía userRepo, no del JWT directo) y lo
 * compara contra `resourceHotelId` con `auth.assertOwnership`. Patrón landing/blocks-crud.
 */
async function assertOwnershipOf(deps: PromoCrudDeps, resourceHotelId: string, user: CurrentUser): Promise<void> {
  const me = await deps.userRepo.findOne({ id: user.id })
  deps.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
}

// ─── list ──────────────────────────────────────────────────────────────────
/**
 * Lista los códigos del hotel del admin. Orden: `createdAt` DESC (más recientes primero),
 * que es lo que el admin espera ver al abrir la pantalla de promo codes.
 */
export async function list(
  deps: PromoCrudDeps,
  user: CurrentUser,
): Promise<{ data: PromoCodeDTO[]; total: number }> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const all = await deps.promoCodes.findMany({ hotelId })
  all.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return { data: all, total: all.length }
}

// ─── create ────────────────────────────────────────────────────────────────
/**
 * Crea un código. Normaliza code a UPPERCASE y valida kind/value. Si el código ya
 * existe para el hotel, captura el duplicate error del UNIQUE index físico y lo
 * traduce a ValidationError (escenario acceptance: 2 codes iguales → error).
 */
export async function create(
  deps: PromoCrudDeps,
  dto: CreatePromoCodeDTO,
  user: CurrentUser,
): Promise<PromoCodeDTO> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  if (!dto.code || !String(dto.code).trim()) throw new ValidationError('code es requerido')
  const kind = assertKind(dto.kind)
  const value = assertValueForKind(kind, dto.value)
  // PC-3: ventana y rangos — una fecha inválida ya no puede crear un código eterno.
  const validFrom = assertDateField('validFrom', dto.validFrom)
  const validTo = assertDateField('validTo', dto.validTo)
  assertWindowOrder(validFrom, validTo)
  const minAmount = assertMinAmount(dto.minAmount)
  const maxUses = assertMaxUses(dto.maxUses)

  const record: Omit<PromoCodeDTO, 'id'> = {
    hotelId,
    code: normalizeCode(dto.code),
    kind,
    value,
    minAmount,
    maxUses,
    uses: 0,
    validFrom,
    validTo,
    active: typeof dto.active === 'boolean' ? dto.active : true,
  } as any

  try {
    return await deps.promoCodes.create(record as any) as PromoCodeDTO
  } catch (e) {
    if (isDuplicateError(e)) {
      throw new ValidationError(`Ya existe un código "${record.code}" para este hotel`)
    }
    throw e
  }
}

// ─── update ────────────────────────────────────────────────────────────────
/**
 * Edita un código existente. Ownership post-findById (analyzer lo exige). Validación
 * de kind/value y captura del duplicate error si cambia `code` a uno existente.
 */
export async function update(
  deps: PromoCrudDeps,
  id: string,
  dto: UpdatePromoCodeDTO,
  user: CurrentUser,
): Promise<PromoCodeDTO> {
  const existing = await deps.promoCodes.findOne({ id })
  if (!existing) throw new NotFoundError('Código promocional no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)

  const patch: Record<string, unknown> = {}
  if (dto.code !== undefined) patch.code = normalizeCode(dto.code)
  if (dto.kind !== undefined) patch.kind = assertKind(dto.kind)
  if (dto.value !== undefined) {
    // Resolvemos el kind final (dto.kind si viene, si no el existente) para validar value.
    const finalKind = (patch.kind as PromoCodeKind | undefined) ?? existing.kind
    patch.value = assertValueForKind(finalKind, dto.value)
  }
  if (dto.minAmount !== undefined) patch.minAmount = assertMinAmount(dto.minAmount)
  if (dto.maxUses !== undefined) patch.maxUses = assertMaxUses(dto.maxUses)
  if (dto.uses !== undefined) {
    const u = Number(dto.uses)
    if (!Number.isFinite(u) || u < 0) throw new ValidationError('uses debe ser >= 0')
    patch.uses = u
  }
  if (dto.validFrom !== undefined) patch.validFrom = assertDateField('validFrom', dto.validFrom)
  if (dto.validTo !== undefined) patch.validTo = assertDateField('validTo', dto.validTo)
  if (dto.active !== undefined) patch.active = dto.active
  // PC-3: la ventana FINAL (mezcla patch + existente) debe ser coherente. `??` no sirve acá:
  // null es un valor legítimo del patch (limpiar la ventana), no "ausente".
  assertWindowOrder(
    (dto.validFrom !== undefined ? patch.validFrom : existing.validFrom) as string | null,
    (dto.validTo !== undefined ? patch.validTo : existing.validTo) as string | null,
  )

  try {
    const updated = await deps.promoCodes.update(id, patch as Partial<Omit<PromoCodeDTO, 'id'>>)
    if (!updated) throw new NotFoundError('Código promocional no encontrado')
    return updated
  } catch (e) {
    if (isDuplicateError(e) && patch.code) {
      throw new ValidationError(`Ya existe un código "${patch.code}" para este hotel`)
    }
    throw e
  }
}

// ─── delete ────────────────────────────────────────────────────────────────
/**
 * Borra un código (hard delete). Ownership post-findById. Preferimos borrar sobre
 * desactivar porque el admin ya tiene toggle `active` para desactivar sin perder
 * histórico (la operación inversa de `active=false` es trivial).
 */
export async function remove(
  deps: PromoCrudDeps,
  id: string,
  user: CurrentUser,
): Promise<{ id: string; deleted: true }> {
  const existing = await deps.promoCodes.findOne({ id })
  if (!existing) throw new NotFoundError('Código promocional no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)
  const ok = await deps.promoCodes.delete(id)
  if (!ok) throw new NotFoundError('Código promocional no encontrado')
  return { id, deleted: true }
}
