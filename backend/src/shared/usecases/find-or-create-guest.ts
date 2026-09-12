// shared/usecases/find-or-create-guest.ts — Un huésped = una ficha (MR-08, #273).
//
// Hasta ahora cada reserva pública (`public-booking.ts`, `public-booking-group.ts`) hacía un
// `tx.create('Guests')` a ciegas: el mismo huésped que reservaba tres veces terminaba con tres
// fichas, y el CRM, el historial de estadías y los auto-mensajes se partían entre ellas. Este
// helper es el ÚNICO lugar donde se decide si un huésped ya existe: busca por email normalizado
// (lower + trim) y, si no hay, por teléfono en E.164 (`shared/utils/phone-e164.ts`), comparando
// también los teléfonos ya cargados normalizados porque los datos viejos están en cualquier
// formato ("809-555-0000", "+1 809 555 0000", "18095550000" son el mismo número).
//
// Recibe un puerto `GuestsPort` estilo `RepositoryAdapter` (filtros sin nombre de modelo) para
// servir tanto al panel (`guestRepo`) como a los POST públicos, que lo llaman DENTRO de su
// `orm.transaction` vía `guestsOnTx(tx)`.
//
// ─── Concurrencia ────────────────────────────────────────────────────────────────────────────
// No hay índice único sobre (hotelId, email): hay duplicados históricos que el script
// `scripts/merge-duplicate-guests.ts` limpia, y un índice único fallaría al crearse. Sin índice,
// dos transacciones concurrentes con el mismo email NUEVO harían check-then-insert las dos y
// crearían dos fichas (en Postgres READ COMMITTED ninguna ve la fila no commiteada de la otra).
//
// Se cierra con el mismo patrón que ya usa `public-booking.ts` para anti-overbooking y promos:
// antes de buscar, un UPDATE trivial sobre la fila del hotel (`Hotels.updatedAt`). En Postgres
// ese UPDATE toma el row lock de la fila hasta el COMMIT, así que la segunda tx se queda
// esperando en su propio UPDATE hasta que la primera commitea; cuando sigue, su `findOne` ya ve
// la ficha recién creada y la reusa. En SQLite la transacción entera ya está serializada sobre
// la única conexión, así que el UPDATE es inocuo. El UPDATE es para SERIALIZAR, no para juzgar:
// no se mira `affected` (un hotel editado por otro motivo no debe rechazar una reserva).
//
// Sin `lockTx` o sin `updateMany` (mocks viejos, callers fuera de tx como el panel) se degrada al
// check-then-insert: no cubre la carrera real pero no rompe al caller.
import { toE164 } from '../utils/phone-e164'

/** Puerto mínimo sobre la tabla Guests, con la forma de `RepositoryAdapter` (filtro sin modelo). */
export interface GuestsPort {
  findOne(filter: Record<string, any>): Promise<any | null>
  findMany?(filter: Record<string, any>): Promise<any[]>
  create(data: Record<string, any>): Promise<any>
  update?(id: string, data: Record<string, any>): Promise<any>
  updateMany?(filter: Record<string, any>, data: Record<string, any>): Promise<number | any>
}

/** Lo único que se le pide a la tx del ORM para tomar el lock de fila del hotel. */
export interface HotelLockPort {
  updateMany?(model: string, filter: Record<string, any>, data: Record<string, any>): Promise<any>
}

export interface FindOrCreateGuestDeps {
  guests: GuestsPort
  /** La tx del ORM (`orm.transaction(tx => ...)`): si tiene `updateMany`, se toma el lock de `Hotels`. */
  lockTx?: HotelLockPort | null
}

export interface FindOrCreateGuestInput {
  hotelId: string
  name: string
  email?: string | null
  phone?: string | null
  /** ISO-3166 alfa-2 para resolver teléfonos sin prefijo; default 'DO' (ver `DEFAULT_COUNTRY`). */
  defaultCountry?: string | null
  /** Campos extra que van SOLO al create (nunca pisan una ficha existente). */
  extra?: Record<string, any>
}

export interface FindOrCreateGuestResult {
  guest: any
  created: boolean
  matchedBy: 'email' | 'phone' | null
}

/**
 * País por defecto para teléfonos sin prefijo. `toE164` sin país rechaza un local de 10 dígitos
 * (809-555-0000 → null); la mayoría de los hoteles de la plataforma y sus huéspedes están en +1,
 * así que sin dato mejor se asume DO. Quien tenga el país del hotel a mano lo pasa.
 */
const DEFAULT_COUNTRY = 'DO'

/**
 * Adaptador de una tx del ORM (`tx.findOne('Guests', f)`) al puerto sin modelo. Una tx sin
 * `findOne` (mocks viejos de los tests que solo saben `create`) no puede buscar y degrada a crear
 * — es "no sé buscar", no "la búsqueda falló": un error real de `findOne` sí se propaga.
 */
export function guestsOnTx(tx: any): GuestsPort {
  const port: GuestsPort = {
    findOne: typeof tx.findOne === 'function' ? (filter) => tx.findOne('Guests', filter) : async () => null,
    create: (data) => tx.create('Guests', data),
  }
  if (typeof tx.findMany === 'function') port.findMany = (filter) => tx.findMany('Guests', filter)
  if (typeof tx.update === 'function') port.update = (id, data) => tx.update('Guests', id, data)
  if (typeof tx.updateMany === 'function') port.updateMany = (filter, data) => tx.updateMany('Guests', filter, data)
  return port
}

export function normalizeGuestEmail(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase()
}

function normalizePhone(phone: string | null | undefined, defaultCountry?: string | null): string | null {
  return toE164(phone, defaultCountry || DEFAULT_COUNTRY)
}

function isBlank(v: unknown): boolean {
  return !String(v ?? '').trim()
}

// Un error de lectura NO es "no existe": tragarlo crearía una ficha duplicada en silencio, que
// es justo lo que este helper evita. Se propaga y la tx del caller hace rollback.
async function findOne(guests: GuestsPort, filter: Record<string, any>): Promise<any | null> {
  return (await guests.findOne(filter)) ?? null
}

async function scanHotel(guests: GuestsPort, hotelId: string): Promise<any[]> {
  if (typeof guests.findMany !== 'function') return []
  return (await guests.findMany({ hotelId })) ?? []
}

async function findByEmail(guests: GuestsPort, hotelId: string, rawEmail: string, normalized: string): Promise<any | null> {
  const exact = await findOne(guests, { hotelId, email: normalized })
  if (exact) return exact
  // Fichas viejas cargadas con mayúsculas: el POST guardaba el email tal cual venía. Primero el
  // literal tipeado (barato, usa el índice); si tampoco, comparación normalizada sobre las fichas
  // del hotel — la capitalización histórica es arbitraria y `findOne` es case-sensitive en PG.
  const asTyped = rawEmail.trim()
  if (asTyped && asTyped !== normalized) {
    const legacy = await findOne(guests, { hotelId, email: asTyped })
    if (legacy) return legacy
  }
  const candidates = await scanHotel(guests, hotelId)
  return candidates.find((g: any) => normalizeGuestEmail(g?.email) === normalized) ?? null
}

async function findByPhone(guests: GuestsPort, hotelId: string, e164: string): Promise<any | null> {
  const plain = await findOne(guests, { hotelId, phone: e164 })
  if (plain) return plain
  const plus = await findOne(guests, { hotelId, phone: `+${e164}` })
  if (plus) return plus
  // Los teléfonos históricos están en cualquier formato: comparar normalizados. Un `+` explícito
  // ya trae su prefijo; uno sin `+` se interpreta con el mismo país que el buscado.
  const candidates = await scanHotel(guests, hotelId)
  return candidates.find((g: any) => !isBlank(g?.phone) && toE164(g.phone, DEFAULT_COUNTRY) === e164) ?? null
}

async function applyPatch(guests: GuestsPort, id: string, patch: Record<string, any>): Promise<void> {
  if (typeof guests.update === 'function') { await guests.update(id, patch); return }
  if (typeof guests.updateMany === 'function') { await guests.updateMany({ id }, patch); return }
}

/**
 * Busca la ficha del huésped por email normalizado y luego por teléfono E.164; si no existe la
 * crea. Nunca pisa datos ya cargados: solo completa `name`/`phone`/`email` cuando estaban vacíos.
 */
export async function findOrCreateGuest(
  deps: FindOrCreateGuestDeps,
  input: FindOrCreateGuestInput,
): Promise<FindOrCreateGuestResult> {
  const { guests, lockTx } = deps
  const hotelId = String(input.hotelId)
  const name = String(input.name ?? '').trim()
  const rawEmail = String(input.email ?? '')
  const email = normalizeGuestEmail(rawEmail)
  const phone = String(input.phone ?? '').trim()
  const e164 = phone ? normalizePhone(phone, input.defaultCountry) : null

  // Lock de fila del hotel ANTES de buscar (ver header): serializa a dos tx concurrentes con el
  // mismo huésped nuevo. `.catch(() => 0)` porque el UPDATE es para serializar, no para juzgar.
  if (lockTx && typeof lockTx.updateMany === 'function') {
    await lockTx.updateMany('Hotels', { id: hotelId }, { updatedAt: new Date().toISOString() }).catch(() => 0)
  }

  let existing: any = null
  let matchedBy: 'email' | 'phone' | null = null
  if (email) {
    existing = await findByEmail(guests, hotelId, rawEmail, email)
    if (existing) matchedBy = 'email'
  }
  if (!existing && e164) {
    existing = await findByPhone(guests, hotelId, e164)
    if (existing) matchedBy = 'phone'
  }

  if (existing) {
    const patch: Record<string, any> = {}
    if (name && isBlank(existing.name)) patch.name = name
    if (phone && isBlank(existing.phone)) patch.phone = phone
    if (email && isBlank(existing.email)) patch.email = email
    if (Object.keys(patch).length > 0) await applyPatch(guests, String(existing.id), patch)
    return { guest: { ...existing, ...patch }, created: false, matchedBy }
  }

  // Mismos campos que creaba `public-booking.ts` antes de este helper; el email queda normalizado.
  const guest = await guests.create({
    id: crypto.randomUUID(), hotelId, name, email, phone: phone || '',
    documentType: 'passport', documentNumber: '', nationality: '', address: '',
    ...(input.extra ?? {}),
  })
  return { guest, created: true, matchedBy: null }
}
