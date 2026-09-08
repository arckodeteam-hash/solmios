// ai-recepcionista/usecases/whatsapp-connection-deps.ts — Cablea la conexión con el cliente real.
//
// Existe para que el service no tenga que conocer el cliente HTTP ni leer el entorno: le pide las
// dependencias armadas y delega. Los tests del usecase inyectan las suyas y no pasan por acá.

import type { Logger } from 'arckode-framework'
import {
  exchangeCode, subscribeApp, unsubscribeApp, registerPhoneNumber,
  getPhoneNumber, getWabaInfo,
} from '../../../services/whatsapp-cloud-client'
import { resolverCredencialesApp } from '../../../infrastructure/meta-app-config'
import type { ConnectionDeps } from './whatsapp-connection'

/**
 * `platformConfigRepo` es el repo de `configuration`, donde el super_admin puede haber guardado el
 * secreto desde el panel. El entorno gana sobre eso (ver `resolverCredencialesApp`).
 *
 * Se resuelve en cada llamada, no al arrancar: así un secreto cargado después —por el panel o por
 * un reinicio con la variable puesta— toma efecto sin que nadie se acuerde de tocar otra cosa.
 */
export async function connectionDepsFor(
  configRepo: any,
  logger: Logger,
  platformConfigRepo?: any,
): Promise<ConnectionDeps> {
  return {
    configRepo,
    logger,
    app: platformConfigRepo ? await resolverCredencialesApp(platformConfigRepo) : null,
    client: { exchangeCode, subscribeApp, unsubscribeApp, registerPhoneNumber, getPhoneNumber, getWabaInfo },
    registrationPin: process.env.META_REGISTRATION_PIN,
  }
}
