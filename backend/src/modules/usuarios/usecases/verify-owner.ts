// usuarios/usecases/verify-owner.ts — #28: probar quién sos cuando el login te está bloqueando.
//
// Existe para un único caso: el alta que exige tarjeta y quedó a medias. Ese hotel tiene
// credenciales válidas, pero `assertHotelCanOperate` lo corta con `payment_method_required`, así
// que no hay token con el que pedir una Checkout Session nueva. Para poder retomar el pago hace
// falta demostrar identidad SIN emitir sesión.
//
// Deliberadamente devuelve lo mínimo —el hotelId, o `null`— y no distingue "no existe" de "clave
// equivocada" de "cuenta desactivada": quien llama es un endpoint público y no puede convertirse
// en un oráculo de qué cuentas existen.
import { looksLikePhone, normalizePhone } from './normalize-phone'
import { verifyPassword } from './password'

interface RepoLike {
  findOne(filter: Record<string, unknown>): Promise<any>
}

export async function verifyOwnerCredentials(
  repo: RepoLike,
  emailOrPhone: string,
  password: string,
): Promise<{ hotelId?: string } | null> {
  const trimmed = String(emailOrPhone || '').trim()
  if (!trimmed || !password) return null

  // Mismo criterio de resolución que el login (email o teléfono normalizado): si acá se buscara
  // solo por email, alguien que se registró con teléfono no podría retomar su propio pago.
  const user = looksLikePhone(trimmed)
    ? await repo.findOne({ phone: normalizePhone(trimmed) || '' })
    : await repo.findOne({ email: trimmed.toLowerCase() })

  if (!user || user.active === 0) return null
  if (!(await verifyPassword(password, user.password))) return null
  return { hotelId: user.hotelId }
}
