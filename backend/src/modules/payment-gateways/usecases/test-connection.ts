// payment-gateways/usecases/test-connection.ts — golpea de verdad al proveedor.
//
// Extraído de service.ts para no pasar las 200 líneas (God Object). Antes de esta extracción, el
// código instanciaba SIEMPRE un StripeGateway sin mirar `row.provider` — inofensivo mientras
// `IMPLEMENTED_PROVIDERS` solo tenía Stripe, pero con Azul/CardNet agregados hubiera armado un
// StripeGateway con un AuthKey de Azul y llamado a la API de Stripe con la llave equivocada.
//
// Azul Payment Page y CardNet Ztrans no exponen un endpoint de "verificar credenciales" público
// (no hay sandbox real contra el que probar esto todavía): para esos dos se valida el FORMATO de
// lo guardado (el constructor del adapter tira si falta un campo requerido) y se avisa que la
// única verificación real es un pago de prueba. PayPal sí tiene endpoint (el token OAuth2), así
// que para ese se verifica de verdad contra la API.

import type { PaymentGatewayRow, TestConnectionResult } from '../types'
import { IMPLEMENTED_PROVIDERS } from '../../../services/payment-gateway/types'
import { decryptCredentials } from '../../../services/payment-gateway/crypto'
import { StripeGateway } from '../../../services/payment-gateway/stripe-gateway'
import { AzulGateway, toAzulCredentials } from '../../../services/payment-gateway/azul-gateway'
import { CardnetGateway, toCardnetCredentials } from '../../../services/payment-gateway/cardnet-gateway'
import { PayPalGateway, toPayPalCredentials } from '../../../services/payment-gateway/paypal-gateway'

export async function testGatewayConnection(row: PaymentGatewayRow): Promise<TestConnectionResult> {
  if (!IMPLEMENTED_PROVIDERS.includes(row.provider)) {
    return { ok: false, message: `El adapter de ${row.provider} todavía no está implementado` }
  }

  try {
    const creds = decryptCredentials(row.credentials) as any

    if (row.provider === 'stripe') {
      const gw = new StripeGateway(creds, row.mode)
      const account = await gw.retrieveAccount()
      return {
        ok: true,
        message: `Conectado a ${account.name || 'la cuenta'} (${row.mode})`,
        accountName: account.name,
      }
    }

    if (row.provider === 'azul') {
      new AzulGateway(toAzulCredentials(creds), row.mode) // valida merchantId/authKey al construir
      return {
        ok: true,
        message: 'Credenciales de Azul guardadas con el formato esperado. Azul Payment Page no ' +
          'expone un endpoint de verificación: confirmá con un pago real en modo prueba antes de pasar a producción.',
      }
    }

    if (row.provider === 'cardnet') {
      new CardnetGateway(toCardnetCredentials(creds), row.mode) // valida comercio/terminal/llave al construir
      return {
        ok: true,
        message: 'Credenciales de CardNet guardadas con el formato esperado. No hay endpoint ' +
          'público de test de credenciales: confirmá con un pago real en modo prueba antes de pasar a producción.',
      }
    }

    if (row.provider === 'paypal') {
      // A diferencia de Azul/CardNet, PayPal SÍ tiene con qué verificar de verdad: el token
      // OAuth2 de client_credentials. Credenciales revocadas, mal copiadas o de la otra cuenta
      // fallan acá y no en el primer cobro real del huésped.
      const gw = new PayPalGateway(toPayPalCredentials(creds), row.mode) // valida clientId/clientSecret al construir
      await gw.getAccessToken()
      return {
        ok: true,
        message: `Credenciales de PayPal válidas: la app REST respondió el token OAuth2 (${row.mode}).`,
      }
    }

    return { ok: false, message: `El adapter de ${row.provider} todavía no está implementado` }
  } catch (e: any) {
    return { ok: false, message: e?.message || 'No se pudo conectar con la pasarela' }
  }
}
