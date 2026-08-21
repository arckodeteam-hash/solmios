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
  repo: RepositoryAdapter<AddonDTO>,
  reservationRepo: RepositoryAdapter<any>,
  userRepo: RepositoryAdapter<any>,
  auth: Auth,
  reservationId: string,
  dto: CreateAddonDTO,
  user: SimpleUser,
  /** OBLIGATORIO (COR-1): persistir el saldo sin invalidar la caché del listado deja `GET /api/reservas`
   *  devolviendo el número viejo hasta 300s. Opcional = el bug vuelve en silencio. */
  notifyChanged: ReservationChangedNotifier,
  /** Lo cobrado real (`payments`). OBLIGATORIO — ver `shared/usecases/reservation-paid` (GH-0.2). */
  paidOf: PaidSource,
): Promise<AddonDTO> {
  const res = await assertReservationOwned(reservationRepo, userRepo, auth, reservationId, user) // IDOR CR-31
  const created = await repo.create({
    reservationId,
    hotelId: res.hotelId,
    description: dto.description,
    kind: dto.kind === 'discount' ? 'discount' : 'service',
    amount: Number(dto.amount) || 0,
    quantity: Number(dto.quantity) || 1,
  } as Omit<AddonDTO, 'id'>)
  // Un extra cambia el total cobrable: la columna persistida `pendingAmount` (la que lee el
  // listado/planning) queda vieja si no se recalcula acá.
  // SEC-4: la query de extras lleva `hotelId` — `reservationId` puede venir de un payload.
  const pendingAmount = await syncReservationPending(reservationRepo, (rid) => repo.findMany({ reservationId: rid, hotelId: res.hotelId }), reservationId, paidOf, res)
  // ...y la caché del listado queda vieja si no se invalida DESPUÉS de persistirlo.
  await notifyChanged({ ...res, pendingAmount })
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
  repo: RepositoryAdapter<AddonDTO>,
  reservationRepo: RepositoryAdapter<any>,
  userRepo: RepositoryAdapter<any>,
  auth: Auth,
  id: string,
  user: SimpleUser,
  /** OBLIGATORIO — ver `createAddon`. */
  notifyChanged: ReservationChangedNotifier,
  /** OBLIGATORIO — ver `createAddon`. */
  paidOf: PaidSource,
  /** SEC3-2 — recorta los links de pago vivos al total cobrable NUEVO (un extra menos es techo
   *  menos). Lo cablea el service desde `orchestrationDeps` (connector `reservas-payment-requests`). */
  ceilingGuard?: (reservationId: string, hotelId: string) => Promise<void>,
): Promise<void> {
  const { addon, reservation } = await assertAddonOwned(repo, reservationRepo, userRepo, auth, id, user)
  await repo.delete(id)
  // Mismo motivo que en el alta: dar de baja un extra baja el total cobrable.
  if (addon.reservationId) {
    // SEC-4: `hotelId` en la query de extras (ver el alta). Sale de la fila ya validada por ownership.
    const scopeHotelId = (reservation as any)?.hotelId ?? addon.hotelId
    const pendingAmount = await syncReservationPending(
      reservationRepo, (rid) => repo.findMany({ reservationId: rid, hotelId: scopeHotelId }), addon.reservationId, paidOf, reservation,
    )
    await notifyChanged({ ...(reservation ?? { id: addon.reservationId, hotelId: addon.hotelId }), pendingAmount })
    if (ceilingGuard && scopeHotelId) await ceilingGuard(addon.reservationId, String(scopeHotelId))
  }
}
