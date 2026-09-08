// ai-recepcionista/usecases/whatsapp-connection-deps.ts — Cablea la conexión con el cliente real.
//
// Existe para que el service no tenga que conocer el cliente HTTP ni leer el entorno: le pide las
// dependencias armadas y delega. Los tests del usecase inyectan las suyas y no pasan por acá.

import type { Logger } from 'arckode-framework'
import {
  exchangeCode, subscribeApp, unsubscribeApp, registerPhoneNumber,
  getPhoneNumber, getWabaInfo, appCredentialsFromEnv,
} from '../../../services/whatsapp-cloud-client'
import type { ConnectionDeps } from './whatsapp-connection'

export function connectionDepsFor(configRepo: any, logger: Logger): ConnectionDeps {
  return {
    configRepo,
    logger,
    // Se lee en cada llamada, no al arrancar: así un servidor al que le cargan el secreto y lo
    // reinician no necesita que nadie se acuerde de tocar otra cosa.
    app: appCredentialsFromEnv(),
    client: { exchangeCode, subscribeApp, unsubscribeApp, registerPhoneNumber, getPhoneNumber, getWabaInfo },
    registrationPin: process.env.META_REGISTRATION_PIN,
  }
}
