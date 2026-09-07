// impersonate.ts — El super admin "entra" a la cuenta de un usuario cliente.
//
// Soporte necesita ver el panel EXACTAMENTE como lo ve el cliente que reporta un
// problema. Hasta acá eso se simulaba en el frontend (se pintaba una franja pero el
// token seguía siendo el del admin, así que la API devolvía los datos de la plataforma
// y no los del hotel). Acá se emite un token de verdad, acotado al hotel del target.
//
// CRÍTICO: la impersonación NO emite refresh token y NO escribe `users.token` del
// target. `usecases/token-session.ts` guarda ahí el jti del refresh vigente y la sesión
// de refresh es single-session: pisarlo desloguearía al cliente real en medio de su
// trabajo. De ahí las dos consecuencias de diseño: el token es de vida corta (2h) y no
// se renueva — cuando expira, el admin vuelve a entrar.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError, ForbiddenError } from 'arckode-framework'

export interface ImpersonateDeps {
  repo: RepositoryAdapter<any>
  hotelRepo?: RepositoryAdapter<any>
  auth: Auth
}

/** Vida corta a propósito: sin refresh token, la sesión de soporte muere sola. */
export const IMPERSONATION_TTL = '2h'

export async function impersonateUser(
  deps: ImpersonateDeps,
  actor: { id: string; role: string },
  targetUserId: string,
): Promise<{
  token: string
  user: {
    id: string
    name: string
    email: string
    role: string
    hotelId: string | null
    hotelName: string
    permissions: string[]
  }
}> {
  if (actor.role !== 'super_admin') throw new AuthError('Solo un super admin puede impersonar')

  const target = await deps.repo.findById(targetUserId)
  if (!target) throw new NotFoundError('Usuario no encontrado')

  if (target.id === actor.id) throw new ForbiddenError('No podés impersonarte a vos mismo')
  // Un super admin ya ve todo: impersonar a otro solo serviría para actuar en su nombre.
  if (target.role === 'super_admin') throw new ForbiddenError('No se puede impersonar a otro super admin')
  if (target.active === 0) throw new ForbiddenError('El usuario está inactivo')

  // Mismo criterio que switch-hotel: el nombre del hotel es decorativo (la franja de
  // aviso), así que si no hay hotelRepo o el usuario no tiene hotel, queda vacío.
  let hotelName = ''
  if (deps.hotelRepo && target.hotelId) {
    const hotels = await deps.hotelRepo.findMany({})
    hotelName = hotels.find((h: any) => h.id === target.hotelId)?.name ?? ''
  }

  const token = (deps.auth as any).createToken({
    id: target.id,
    role: 'super_admin',      // conserva el bypass total de permisos del admin: entra a ver, no a pelear con los permisos del rol del cliente
    hotelId: target.hotelId,  // pero acotado a los datos del hotel del cliente
    userType: 'merchant',     // y bloqueado en las rutas de plataforma (requireUserType('admin'))
    impersonatedBy: actor.id,
  }, IMPERSONATION_TTL)
  // Ni createRefreshToken ni repo.update(target.id, ...): ver la nota de cabecera.

  return {
    token,
    user: {
      id: target.id,
      name: target.name,
      email: target.email,
      // OJO, es la distinción menos obvia del archivo: acá va el rol REAL del target
      // (lo que la franja de aviso muestra: "estás viendo como hotel_admin de X"),
      // mientras que el rol DENTRO del token es super_admin para no perder el bypass.
      role: target.role,
      hotelId: target.hotelId ?? null,
      hotelName,
      // Comodín total, coherente con el rol del token (ver resolve-permissions.ts:
      // super_admin ⇒ ['*:*']). La UI no debe esconderle nada al admin que entró.
      permissions: ['*:*'],
    },
  }
}
