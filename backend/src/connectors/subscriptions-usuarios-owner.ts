// connectors/subscriptions-usuarios-owner.ts — #28: retomar el pago del alta sin poder loguearse.
//
// Un hotel que abandonó el Checkout tiene credenciales válidas pero el gate de suscripción lo
// corta (`payment_method_required`), así que no hay token con el que pedir una Checkout Session
// nueva. `subscriptions` necesita entonces probar quién es sin emitir sesión — y las contraseñas
// las verifica el módulo que las guarda, nunca otro. `usuarios` expone `verifyOwnerCredentials`
// (sin token, sin datos del usuario, solo el hotelId) y este connector lo inyecta en el puerto.
import type { ConnectorContext } from 'arckode-framework'

interface UsuariosModule {
  verifyOwnerCredentials: (emailOrPhone: string, password: string) => Promise<{ hotelId?: string } | null>
}

export function subscriptionsUsuariosOwnerConnector(ctx: ConnectorContext): void {
  const subscriptions = ctx.resolveModule<{
    setOwnerVerifier: (fn: (email: string, password: string) => Promise<{ hotelId?: string } | null>) => void
  }>('subscriptions')
  const usuarios = ctx.resolveModule<UsuariosModule>('usuarios')

  subscriptions.setOwnerVerifier((email, password) => usuarios.verifyOwnerCredentials(email, password))
}
