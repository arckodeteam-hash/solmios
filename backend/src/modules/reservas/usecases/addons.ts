// reservas/usecases/addons.ts — CRUD de addons (ReservationAddons).
// Lógica pura. IDOR: create/delete verifican ownership vía la reservation padre
// (CR-28/CR-31). Extraído de composition-root (F2).

import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import type { AddonDTO, CreateAddonDTO } from '../types'
import { assertReservationOwned, type SimpleUser } from './reservation-ownership'
import { syncReservationPending } from '../../../shared/usecases/sync-reservation-pending'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'
import type { ReservationChangedNotifier } from './reservation-changed'

/**
 * RTC-8.10: deps por OBJETO, no posicionales. `createAddon` había llegado a 10 parámetros
 * posicionales y el call site era una línea de 240 caracteres donde el orden era lo único que
 * separaba lo correcto de lo roto (pasar `paidOf` donde va `notifyChanged` compila igual).
 */
export interface AddonUsecaseDeps {
  repo: RepositoryAdapter<AddonDTO>
  reservationRepo: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  /** OBLIGATORIO (COR-1): persistir el saldo sin invalidar la caché del listado deja `GET /api/reservas`
   *  devolviendo el número viejo hasta 300s. */
  notifyChanged: ReservationChangedNotifier
  /** Lo cobrado real (`payments`). OBLIGATORIO — ver `shared/usecases/reservation-paid` (GH-0.2). */
  paidOf: PaidSource
  /** RTC-7.2/RTC-8.8 — recorta los links de pago vivos al total cobrable NUEVO (un extra
   *  `kind:'discount'` al alta y la baja de un `service` bajan el techo igual). OBLIGATORIO y
   *  fail-closed: opcional + `undefined` del service reintroducía la divergencia en silencio
   *  (`crud.ts:307` argumenta lo mismo); el puerto hermano de payment-requests es fail-closed. */
  ceilingGuard: (reservationId: string, hotelId: string) => Promise<void>
}

export async function listAddons(
  repo: RepositoryAdapter<AddonDTO>,
  reservationRepo: RepositoryAdapter<any>,
  userRepo: RepositoryAdapter<any>,
  auth: Auth,
  reservationId: string,
  user: SimpleUser,
): Promise<AddonDTO[]> {
  await assertReservationOwned(reservationRepo, userRepo, auth, reservationId, user) // IDOR fix — list también debe validar ownership
  return repo.findMany({ reservationId })
}

export async function createAddon(
  deps: AddonUsecaseDeps,
  params: { reservationId: string; dto: CreateAddonDTO; user: SimpleUser },
): Promise<AddonDTO> {
  const { repo, reservationRepo, userRepo, auth } = deps
  const res = await assertReservationOwned(reservationRepo, userRepo, auth, params.reservationId, params.user) // IDOR CR-31
  const created = await repo.create({
    reservationId: params.reservationId,
    hotelId: res.hotelId,
    description: params.dto.description,
    kind: params.dto.kind === 'discount' ? 'discount' : 'service',
    amount: Number(params.dto.amount) || 0,
    quantity: Number(params.dto.quantity) || 1,
  } as Omit<AddonDTO, 'id'>)
  // Un extra cambia el total cobrable: la columna persistida `pendingAmount` (la que lee el
  // listado/planning) queda vieja si no se recalcula acá.
  // SEC-4: la query de extras lleva `hotelId` — `reservationId` puede venir de un payload.
  const pendingAmount = await syncReservationPending(reservationRepo, (rid) => repo.findMany({ reservationId: rid, hotelId: res.hotelId }), params.reservationId, deps.paidOf, res)
  // ...y la caché del listado queda vieja si no se invalida DESPUÉS de persistirlo.
  await deps.notifyChanged({ ...res, pendingAmount })
  // RTC-7.2: mismo orden que en la baja — persistir, resincronizar, y recién ahí recortar los links
  // (el clamp relee la reserva y sus extras, así que necesita ver el alta ya escrita).
  if (res.hotelId) await deps.ceilingGuard(params.reservationId, String(res.hotelId))
  return created
}

/** Devuelve el addon Y su reserva: el notificador del cambio de saldo necesita la fila entera. */
async function assertAddonOwned(
  repo: RepositoryAdapter<AddonDTO>,
  reservationRepo: RepositoryAdapter<any>,
  userRepo: RepositoryAdapter<any>,
  auth: Auth,
  id: string,
  user: SimpleUser,
): Promise<{ addon: AddonDTO; reservation: any }> {
  const a = await repo.findById(id)
  if (!a) throw new NotFoundError('Addon no encontrado')
  const reservation = a.reservationId ? await reservationRepo.findById(a.reservationId) : null
  const hotelId = a.hotelId || (reservation as any)?.hotelId
  const me = await userRepo.findById(user.id)
  auth.assertOwnership(hotelId, me?.hotelId ?? '', user.role, 'super_admin') // IDOR CR-28
  return { addon: a, reservation }
}

export async function deleteAddon(
  deps: AddonUsecaseDeps,
  params: { id: string; user: SimpleUser },
): Promise<void> {
  const { repo, reservationRepo, userRepo, auth } = deps
  const { addon, reservation } = await assertAddonOwned(repo, reservationRepo, userRepo, auth, params.id, params.user)
  await repo.delete(params.id)
  // Mismo motivo que en el alta: dar de baja un extra baja el total cobrable.
  if (addon.reservationId) {
    // SEC-4: `hotelId` en la query de extras (ver el alta). Sale de la fila ya validada por ownership.
    const scopeHotelId = (reservation as any)?.hotelId ?? addon.hotelId
    const pendingAmount = await syncReservationPending(
      reservationRepo, (rid) => repo.findMany({ reservationId: rid, hotelId: scopeHotelId }), addon.reservationId, deps.paidOf, reservation,
    )
    await deps.notifyChanged({ ...(reservation ?? { id: addon.reservationId, hotelId: addon.hotelId }), pendingAmount })
    if (scopeHotelId) await deps.ceilingGuard(addon.reservationId, String(scopeHotelId))
  }
}
