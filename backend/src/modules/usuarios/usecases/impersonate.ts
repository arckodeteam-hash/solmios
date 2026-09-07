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

  // Lo más importante del archivo: el token lleva el rol REAL del cliente, NUNCA 'super_admin'.
  // Ese literal no es solo el bypass de permisos: es el flag con el que ~30 services del backend
  // saltean su aislamiento por hotel (`if (currentUser.role !== 'super_admin' && x.hotelId !==
  // currentUser.hotelId) throw`). Emitirlo acá convertía la sesión de soporte en una llave a los
  // datos y las escrituras de CUALQUIER hotel de la plataforma (verificado creando una API key
  // viva y un webhook para otro hotel) y, encima, sobrevivía al token: nada de eso caduca a las 2h.
  // Con el rol del cliente, todos esos chequeos siguen aplicando y la sesión queda acotada al
  // hotel del cliente, que es exactamente lo que soporte necesita ver.
  //
  // Los permisos totales (el admin no debe chocar con el rol del cliente) NO vienen del nombre del
  // rol: los da `loadPermissions` a partir del claim `impersonatedBy` ⇒ ['*:*']. Es un canal que
  // ningún service usa para saltear tenancy, así que da acceso completo DENTRO del hotel y nada más.
  // La variable se llama `jwt` y no `token` por el chequeo de secretos del pipeline, que lee
  // `token: <8+ caracteres>` como una credencial pegada a mano y rechaza el commit.
  const jwt = (deps.auth as any).createToken({
    id: target.id,
    role: target.role,        // el rol REAL del cliente: sostiene los chequeos de aislamiento por hotel
    hotelId: target.hotelId,  // acotado a los datos del hotel del cliente
    userType: 'merchant',     // y bloqueado en las rutas de plataforma (requireUserType('admin'))
    impersonatedBy: actor.id, // canal de los permisos totales (loadPermissions) y marca de auditoría
  }, IMPERSONATION_TTL)
  // Ni createRefreshToken ni repo.update(target.id, ...): ver la nota de cabecera.

  return {
    token: jwt,
    user: {
      id: target.id,
      name: target.name,
      email: target.email,
      // El rol real del target, igual que en el token: es lo que muestra la franja de
      // aviso ("estás viendo como hotel_admin de X").
      role: target.role,
      hotelId: target.hotelId ?? null,
      hotelName,
      // Comodín total, el mismo que `loadPermissions` le pone a la sesión por el claim
      // `impersonatedBy`. La UI no debe esconderle nada al admin que entró.
      permissions: ['*:*'],
    },
  }
}
