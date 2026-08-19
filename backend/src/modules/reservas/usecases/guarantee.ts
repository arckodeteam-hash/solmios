import { NotFoundError, AuthError } from 'arckode-framework'
import { hashGuaranteePin, verifyGuaranteePin } from '../../../services/guarantee-pin'
import type { ReservasQueries } from './reservas-queries'

/**
 * Tope de intentos del PIN de garantía (B1, auditoría 2026-08-19): sin esto, un miembro del
 * staff con `reservations:edit` podía probar PINs indefinidamente — el rate-limit global por
 * IP es demasiado generoso para frenar fuerza bruta de un insider autenticado.
 *
 * Estado IN-MEMORY por hotel (no en configuration): el atacante acá es staff autenticado;
 * resetear el contador exigiendo un restart del server implica acceso root, que ya es game
 * over. Reset natural al reiniciar + contador se limpia con PIN correcto o lock expirado.
 */
const MAX_FAILS = 5
const MS_PER_MINUTE = 60_000
const LOCK_MS = 15 * 60 * 1000
const pinFails = new Map<string, { fails: number; lockedUntil: number }>()

/** Blocked? Devuelve los ms restantes de lock, o 0 si libre. */
function remainingLock(hotelId: string, now = Date.now()): number {
  const st = pinFails.get(hotelId)
  if (!st) return 0
  if (st.lockedUntil > now) return st.lockedUntil - now
  if (st.lockedUntil && st.lockedUntil <= now) pinFails.delete(hotelId) // lock expirado
  return 0
}

function registerFail(hotelId: string, now = Date.now()): void {
  const st = pinFails.get(hotelId) ?? { fails: 0, lockedUntil: 0 }
  st.fails += 1
  if (st.fails >= MAX_FAILS) {
    st.lockedUntil = now + LOCK_MS
    st.fails = 0 // el lock consume los fails; al expirar arranca de cero
  }
  pinFails.set(hotelId, st)
}

export async function setGuaranteePin(queries: ReservasQueries, userRepo: any, user: any, body: any): Promise<{ success: boolean }> {
  const hotelId = await resolveHotelIdForUser(queries, userRepo, user)
  if (!hotelId) throw new AuthError('Hotel no encontrado')
  const { pin } = body as { pin?: string }
  if (!pin || !/^\d{4,8}$/.test(String(pin))) throw new Error('PIN inválido (debe ser de 4 a 8 dígitos)')
  const hash = hashGuaranteePin(String(pin), hotelId)
  await queries.upsertConfiguration(hotelId, 'guarantee_pin', hash)
  return { success: true }
}

export async function getGuaranteeHasPin(queries: ReservasQueries, userRepo: any, user: any): Promise<{ hasPin: boolean }> {
  const hotelId = await resolveHotelIdForUser(queries, userRepo, user)
  if (!hotelId) throw new AuthError('Hotel no encontrado')
  const row = await queries.findConfiguration(hotelId, 'guarantee_pin')
  return { hasPin: !!row }
}

export async function unlockGuaranteeCard(queries: ReservasQueries, repo: any, userRepo: any, reservationId: string, user: any, body: any, auth?: any): Promise<any> {
  const r = await repo.findById(reservationId) as any
  if (!r) throw new NotFoundError('Reserva no encontrada')
  const hid = await resolveHotelIdForUser(queries, userRepo, user)
  if (!hid) throw new AuthError('Hotel no encontrado')
  // El assert va DESPUÉS de resolver el hotel del usuario: antes comparaba la reserva contra sí misma.
  if (auth) auth.assertOwnership(r.hotelId, hid, user?.role, 'super_admin')
  if (r.hotelId !== hid) throw new AuthError('Sin acceso a esta reserva')
  if (!r.hasGuaranteeCard && !r.cardLast4) throw new Error('Esta reserva no tiene tarjeta de garantía')
  const pinRow = await queries.findConfiguration(hid, 'guarantee_pin')
  if (!pinRow?.value) throw new Error('No hay PIN de garantía configurado')

  const wait = remainingLock(hid)
  if (wait > 0) throw new AuthError(`Demasiados intentos fallidos: esperá ${Math.ceil(wait / MS_PER_MINUTE)} minuto(s) antes de probar de nuevo`)

  const { pin } = body as { pin?: string }
  if (!pin || !verifyGuaranteePin(String(pin), hid, String(pinRow.value))) {
    registerFail(hid)
    const st = pinFails.get(hid)
    const left = st ? MAX_FAILS - st.fails : MAX_FAILS - 1
    throw new AuthError(left > 0 ? `PIN incorrecto. Te queda(n) ${left} intento(s).` : 'PIN incorrecto.')
  }
  pinFails.delete(hid) // acierto: contador limpio
  return { cardHolder: r.cardHolder || '', cardBrand: r.cardBrand || '', cardLast4: r.cardLast4 || '', cardExpMonth: r.cardExpMonth || '', cardExpYear: r.cardExpYear || '' }
}

async function resolveHotelIdForUser(queries: ReservasQueries, userRepo: any, user: any): Promise<string | undefined> {
  if (user?.hotelId && user?.hotelId !== 'platform') return user.hotelId
  if (user?.id && user?.role !== 'super_admin') {
    const rows = await userRepo.findMany({ id: user.id }) as any[]
    const row: any = rows?.[0]
    if (row?.hotelId) return row.hotelId
  }
  const hotels = await queries.findHotels()
  return (hotels[0] as any)?.id
}


/** Solo tests: reset del contador in-memory entre casos. */
export function __resetPinFailsForTests(): void { pinFails.clear() }
