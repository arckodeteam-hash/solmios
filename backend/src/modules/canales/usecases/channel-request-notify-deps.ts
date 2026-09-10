// canales/usecases/channel-request-notify-deps.ts — Lo que el aviso de una solicitud necesita leer.
//
// Vive fuera del service por dos motivos: el service ya está en el techo de 200 líneas que impone
// el analyzer (un service más largo es un God Object), y esto es armado de dependencias, no
// lógica de canales. La lógica de QUÉ se avisa está en `shared/usecases/notify-channel-request`.

import { resolvePlatformIdentity } from '../../../shared/utils/platform-identity'
import type { ChannelRequestNotifyDeps } from '../../../shared/usecases/notify-channel-request'
import type { CanalesQueries } from './canales-queries'

/** Los puertos que se inyectan de afuera (correo por email-bootstrap, campanita por connector). */
export type ChannelRequestNotifyPorts = Pick<ChannelRequestNotifyDeps, 'emailSender' | 'sendPlatformEvent' | 'notificaciones'>

export function makeChannelRequestNotifyDeps(
  queries: CanalesQueries,
  logger: { warn(message: string, meta?: Record<string, unknown>): void },
  ports: ChannelRequestNotifyPorts,
): ChannelRequestNotifyDeps {
  return {
    ...ports,
    // `userType: 'admin'` es el dueño de la plataforma (ver "Sistema de Permisos" del CLAUDE.md):
    // el pedido de un hotel es trabajo suyo, no del hotel.
    findAdminUsers: async () => (await queries.findMany('Users', { userType: 'admin' })) as Array<{ id: string; name?: string; email?: string }>,
    findHotel: async (hotelId: string) => ((await queries.findMany('Hotels', { id: hotelId }))[0] as any) ?? null,
    platformIdentity: () => resolvePlatformIdentity({
      findOne: async (q: Record<string, unknown>) => ((await queries.findMany('Configuration', q)) as any[])[0] ?? null,
    } as any),
    publicUrl: process.env.PUBLIC_URL || '',
    logger,
  }
}
