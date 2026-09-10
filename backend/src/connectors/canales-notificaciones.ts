// connectors/canales-notificaciones.ts — Wire: canales → notificaciones
//
// Un pedido de conexión de OTA tiene que aparecer en la campanita del super-admin. `canales` no
// puede importar `notificaciones` (regla: un módulo no importa a otro), así que el puerto se
// inyecta desde acá. La lógica de QUÉ se avisa vive en `shared/usecases/notify-channel-request`.
//
// `resolveModule` se llama en cada aviso y no una sola vez al cablear: si notificaciones no está
// disponible en ese momento, el pedido igual se registra (el aviso es best-effort por diseño).

import type { ConnectorContext } from 'arckode-framework'
import type { ChannelRequestNotificationPort } from '../shared/usecases/notify-channel-request'

export function canalesNotificacionesConnector(ctx: ConnectorContext): void {
  const canales = ctx.resolveModule<{
    setChannelRequestNotifyPorts: (p: { notificaciones?: ChannelRequestNotificationPort }) => void
  }>('canales')

  canales.setChannelRequestNotifyPorts({
    notificaciones: {
      create: (dto, user) => ctx.resolveModule<ChannelRequestNotificationPort>('notificaciones').create(dto, user),
    },
  })
}
