// #46 — el hotel cambia su plan por su cuenta "pagando lo que falta de su suscripción".
// El Checkout no sirve para esto: con una suscripción viva corta con 409 a propósito (BUG-9, ver
// create-checkout-session.test.ts). El camino es `stripe.subscriptions.update()` sobre el ítem que
// ya existe con `proration_behavior:'always_invoice'`, que factura y cobra EXACTAMENTE la diferencia.
//
// #84 — dos cambios de comportamiento cubiertos acá: el destino puede ser CUALQUIER plan activo
// distinto del actual, incluido uno más barato (CA 2/25), y el plan sólo se aplica si el prorrateo
// se pudo cobrar: con `payment_behavior:'error_if_incomplete'` un rechazo lanza y no toca nada
// (CA 4/5).
import { describe, it, expect, mock, beforeEach, afterAll, setSystemTime } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { RepositoryAdapter } from 'arckode-framework'
import { ConflictError, ErrorContract, ValidationError } from 'arckode-framework'

// `mock.module` es GLOBAL al proceso de bun test (misma advertencia que
// tests/create-checkout-session.test.ts): se parte del módulo real y solo se pisa `getClient`,
// que sin STRIPE_SECRET_KEY devolvería null y taparía todo con "Stripe no está configurado".
const actualStripe = await import('../../../services/stripe-service')
const realStripeService = { ...(actualStripe as any).StripeService }

/** `null` = plataforma sin Stripe configurado (el caso que NO puede romper con un crash). */
let stripeClient: any = null
let retrieves: string[] = []
let updates: any[] = []
let previews: any[] = []
let invoiceRetrieves: string[] = []
/** La factura que Stripe devuelve como `latest_invoice` del update: el cobro puede fallar. */
let invoiceOnUpdate: any = { id: 'in_1', status: 'paid', amount_due: 25000, amount_paid: 25000, currency: 'usd' }
/** Con un valor acá, el update de Stripe devuelve OTRO price: simula que no quedó aplicado
 *  (por ejemplo, una respuesta cacheada por idempotencia). `null` = quedó aplicado. */
let priceOnUpdate: string | null = null

mock.module('../../../services/stripe-service', () => ({
  ...actualStripe,
  StripeService: { ...realStripeService, getClient: async () => stripeClient },
}))

afterAll(() => {
  mock.module('../../../services/stripe-service', () => ({
    ...actualStripe,
    StripeService: realStripeService,
  }))
})

const { previewUpgrade, applyUpgrade, PaymentProviderError } = await import('../usecases/upgrade-plan')

// Fin del período vigente que devuelve Stripe en el ítem (la API 2025-08-27 lo movió ahí).
const PERIOD_END = 1893456000

function fakeStripe() {
  return {
    subscriptions: {
      retrieve: async (id: string) => {
        retrieves.push(id)
        return { id, items: { data: [{ id: 'si_1', current_period_end: PERIOD_END, price: { id: 'price_ess_99' } }] } }
      },
      update: async (id: string, params: any, options?: any) => {
        updates.push({ id, params, options })
        // Stripe devuelve el ítem YA con el price nuevo: el usecase lo confirma antes de
        // reflejar el plan en local. `priceOnUpdate` deja simular que NO quedó aplicado.
        const price = { id: priceOnUpdate ?? params?.items?.[0]?.price }
        return { id, items: { data: [{ id: 'si_1', current_period_end: PERIOD_END, price }] }, latest_invoice: invoiceOnUpdate }
      },
    },
    invoices: {
      createPreview: async (params: any) => {
        previews.push(params)
        return { id: 'in_preview', status: 'draft', amount_due: 25000, currency: 'usd' }
      },
      retrieve: async (id: string) => { invoiceRetrieves.push(id); return invoiceOnUpdate },
    },
  }
}

/** Escrituras hechas por los dobles: sirve para que el `updatedAt` sellado sea estrictamente
 *  creciente aunque el reloj esté congelado con `setSystemTime`. */
let escrituras = 0

function repoOf(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (f: any = {}) => rows.filter(r => Object.entries(f).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => rows.find(r => r.id === id) ?? null,
    create: async (r: any) => { rows.push(r); return r },
    // El ORM pisa `updatedAt` en TODA escritura cuando el modelo declara `timestamps: true`
    // (kernel/db/orm.ts: `if (def.timestamps) record.updatedAt = now`), y `SubscriptionsModel` lo
    // declara. El doble lo replica porque de ese sello depende la clave de idempotencia: un doble
    // que no lo moviera daría verde con el bug puesto.
    update: async (id: string, patch: any) => {
      const r = rows.find(x => x.id === id)
      if (r) Object.assign(r, patch, { updatedAt: new Date(Date.now() + (++escrituras)).toISOString() })
      return r
    },
  } as unknown as RepositoryAdapter<any>
}

/** Registra CADA escritura sobre la fila de suscripción (id + patch), sin sacarle el efecto real. */
function espiarEscrituras(deps: any): Array<{ id: string, patch: any }> {
  const vistas: Array<{ id: string, patch: any }> = []
  const original = deps.subscriptionsRepo.update.bind(deps.subscriptionsRepo)
  deps.subscriptionsRepo.update = (async (id: string, patch: any) => {
    vistas.push({ id, patch })
    return original(id, patch)
  }) as any
  return vistas
}

/** El rechazo de tarjeta tal como lo tira stripe-node desde `subscriptions.update`. */
function conTarjetaRechazada(client: any, mensaje = 'Your card was declined.'): void {
  client.subscriptions.update = async (id: string, params: any, options?: any) => {
    updates.push({ id, params, options })
    throw errorDeStripe('StripeCardError', mensaje)
  }
}

const ESSENTIAL = { id: 'plan-ess', name: 'Esencial', slug: 'esencial', price: 99, currency: 'USD', stripePriceId: 'price_ess_99', isActive: 1 }
const PRO = { id: 'plan-pro', name: 'Professional', slug: 'pro', price: 349, currency: 'USD', stripePriceId: 'price_pro_349', isActive: 1 }
const SIN_PRECIO = { id: 'plan-enterprise', name: 'Enterprise', slug: 'enterprise', price: 999, currency: 'USD', isActive: 1 }
/** Planes RETIRADOS del catálogo, con su price bien configurado: lo único que los descalifica es
 *  el flag. Van los DOS porque el flag viaja en dos formas —`false` y `0`— y `loadUpgrade` chequea
 *  las dos: cubrir una sola dejaría media guarda sin probar. */
const RETIRADO_FALSE = { id: 'plan-retirado-false', name: 'Legacy Boutique', slug: 'legacy-boutique', price: 149, currency: 'USD', stripePriceId: 'price_legacy_149', isActive: false }
const RETIRADO_CERO = { id: 'plan-retirado-cero', name: 'Legacy Starter', slug: 'legacy-starter', price: 49, currency: 'USD', stripePriceId: 'price_legacy_49', isActive: 0 }

/** Hotel pagando el plan barato: la fila que el gate elegiría (active + stripeSubscriptionId). */
function activeSub(over: any = {}) {
  return {
    id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'active',
    stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    currentPeriodEnd: '2029-12-31T00:00:00.000Z',
    // El modelo declara `timestamps: true`: toda fila real trae `updatedAt`, y de ahí sale el
    // token del intento en la clave de idempotencia.
    updatedAt: '2026-09-01T00:00:00.000Z', ...over,
  }
}

/** Un error como los que tira stripe-node: lo que lo distingue es `type`, igual que en
 *  `payment-requests/usecases/live-session.ts`. */
function errorDeStripe(type: string, message: string, code?: string): Error {
  return Object.assign(new Error(message), { type, ...(code ? { code } : {}) })
}

/** Logger con la misma forma que `silentLogger()` pero que guarda lo que se le pidió loguear:
 *  #339 exige que un fallo de Stripe quede en `error` con hotel y plan, no sólo que suba. */
function loggerEspia() {
  const errores: Array<[string, any]> = []
  const logger = {
    error: (msg: string, ctx?: any) => { errores.push([msg, ctx]) },
    warn: () => {}, info: () => {}, debug: () => {},
  }
  return { logger: logger as any, errores }
}

/** #339: lo que TODO fallo de Stripe (que no sea de tarjeta) tiene que cumplir al salir del
 *  usecase — un `ErrorContract` que el router mapea a 502 con el motivo de Stripe, en vez del 500
 *  "Error interno del servidor" sin explicación que veía la persona. */
function esperarErrorDelProveedor(err: any, motivo: string | RegExp): void {
  expect(err).toBeInstanceOf(ErrorContract)
  expect(err).toBeInstanceOf(PaymentProviderError)
  expect(err.httpStatus).toBe(502)
  expect(err.errorCode).toBe('PAYMENT_PROVIDER_ERROR')
  expect(err.message).toMatch(motivo)
  expect(err.message).not.toMatch(/método de pago/i)
}

function setup(subs: any[]) {
  const subRows = subs
  const hotelRows = [{ id: 'h1', name: 'Hotel Sol', email: 'dueno@hotel.com', plan: 'esencial' }]
  const deps = {
    subscriptionsRepo: repoOf(subRows),
    hotelsRepo: repoOf(hotelRows),
    plansRepo: repoOf([ESSENTIAL, PRO, SIN_PRECIO, RETIRADO_FALSE, RETIRADO_CERO]),
    logger: silentLogger(),
  }
  return { deps, subRows, hotelRows }
}

beforeEach(() => {
  retrieves = []
  updates = []
  previews = []
  invoiceRetrieves = []
  invoiceOnUpdate = { id: 'in_1', status: 'paid', amount_due: 25000, amount_paid: 25000, currency: 'usd' }
  priceOnUpdate = null
  stripeClient = fakeStripe()
})

describe('applyUpgrade — el criterio de aceptación de #46', () => {
  it('mueve el ÍTEM existente al price del plan caro con always_invoice y deja el plan local en el nuevo', async () => {
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    // Se actualiza la suscripción que YA existe (no se crea una segunda: eso es BUG-9).
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('sub_1')
    expect(updates[0].params.items).toEqual([{ id: 'si_1', price: 'price_pro_349' }])
    expect(updates[0].params.proration_behavior).toBe('always_invoice')

    // Se cobró la diferencia y quedó paga.
    expect(res.applied).toBe(true)
    expect(res.paid).toBe(true)
    expect(res.invoiceStatus).toBe('paid')
    expect(res.amountCharged).toBe(25000)
    expect(res.currency).toBe('usd')
    expect(res.planId).toBe('plan-pro')
    expect(res.previousPlanId).toBe('plan-ess')

    // Y el plan local ya es el nuevo, sin esperar el webhook (que igual llega y es idempotente).
    expect(subRows[0].planId).toBe('plan-pro')
    expect(hotelRows[0].plan).toBe('pro')
  })

  it('si la factura del prorrateo NO quedó paga: no canta victoria y NO cambia el plan local (#92)', async () => {
    // #84 (CA 4/5): un RECHAZO de tarjeta ya no llega hasta acá — con `error_if_incomplete` Stripe
    // revierte el ítem y el update lanza (ver el test de la tarjeta rechazada). Este caso es el
    // otro: el update SÍ volvió —o sea el ítem quedó movido en Stripe— pero la factura sigue
    // `open`. Es exactamente lo que pasa con ACH/SEPA (#92): el PaymentIntent queda `processing`
    // días, y si después rebota Stripe anula la factura sin devolver el ítem. Reflejar el plan
    // acá dejaba al hotel con un plan que nunca pagó — el plan local se queda donde está y lo
    // aplica el webhook `invoice.paid` si el cobro entra.
    invoiceOnUpdate = { id: 'in_2', status: 'open', amount_due: 25000, amount_paid: 0, currency: 'usd' }
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(res.applied).toBe(true) // en Stripe el ítem sí se movió: no se miente en ninguna dirección
    expect(res.paid).toBe(false)
    expect(res.invoiceStatus).toBe('open')
    expect(res.amountCharged).toBe(25000)
    expect(res.previousPlanId).toBe('plan-ess')
    // Sin cobro confirmado, ni la fuente de verdad ni el espejo cambian.
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  // #84 (CA 4 y 5): un pago fallido NO puede cambiar el plan. `error_if_incomplete` hace que Stripe
  // revierta el ítem y devuelva error en vez de dejar el plan nuevo con la factura colgada, que es
  // lo que hacía `allow_incomplete`.
  it('pide error_if_incomplete: sin cobro no hay cambio de plan', async () => {
    const { deps } = setup([activeSub()])

    await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(updates[0].params.payment_behavior).toBe('error_if_incomplete')
  })

  // #84 (CA 2/25): "Suscribirse a [plan]" tiene que iniciar el cambio para CUALQUIER plan que no
  // sea el actual. Con `always_invoice` un downgrade no cobra: genera crédito (amount_due 0) y la
  // factura sale paga, así que el mismo camino sirve en las dos direcciones.
  it('BAJA de plan: no lanza, manda el price del plan barato y deja el plan local ahí', async () => {
    invoiceOnUpdate = { id: 'in_credit', status: 'paid', amount_due: 0, amount_paid: 0, currency: 'usd' }
    const { deps, subRows, hotelRows } = setup([activeSub({ planId: 'plan-pro' })])

    const res = await applyUpgrade(deps, 'h1', 'plan-ess')

    expect(updates).toHaveLength(1)
    expect(updates[0].params.items).toEqual([{ id: 'si_1', price: 'price_ess_99' }])
    expect(updates[0].params.proration_behavior).toBe('always_invoice')
    expect(res.applied).toBe(true)
    expect(res.paid).toBe(true)
    expect(res.planId).toBe('plan-ess')
    expect(res.previousPlanId).toBe('plan-pro')
    // El crédito no se cobra: el monto es 0 y aun así el cambio queda hecho.
    expect(res.amountCharged).toBe(0)
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  // #84 (CA 5 y 29): con la tarjeta rechazada Stripe revierte el ítem y lanza. El plan actual del
  // hotel tiene que quedar EXACTAMENTE como estaba, y el motivo de Stripe tiene que llegar al
  // usuario: un error genérico no le dice qué arreglar.
  it('TARJETA RECHAZADA: lanza con el motivo de Stripe y no escribe el plan en local', async () => {
    const { deps, subRows, hotelRows } = setup([activeSub()])
    // Todo update sobre la fila de suscripción queda registrado: el criterio es que NINGUNO traiga
    // `planId` (el plan actual quedó intacto).
    const escritas = espiarEscrituras(deps)
    conTarjetaRechazada(stripeClient)

    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }

    expect(err).toBeInstanceOf(ValidationError)
    // El motivo de Stripe NO se tapa: es lo único que explica QUÉ falló.
    expect(err.message).toContain('Your card was declined.')
    expect(err.message).toMatch(/no cambió/i)
    // Y el plan actual quedó intacto, en la fila y en el espejo del hotel.
    expect(escritas.some(e => 'planId' in e.patch)).toBe(false)
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  // Revisión #84: el intento RECHAZADO tiene que dejar rastro en la fila. Con
  // `error_if_incomplete` no se escribe nada del negocio, así que `updatedAt` quedaba quieto y el
  // reintento reusaba la clave de idempotencia: Stripe le devolvía el error cacheado hasta 24h.
  // El toque va con el patch VACÍO: el ORM le agrega `updatedAt` igual, y así no puede pisar un
  // `status` que el webhook haya movido mientras Stripe respondía.
  it('TARJETA RECHAZADA: toca la fila activa para mover updatedAt, sin cambiar un solo dato', async () => {
    const { deps, subRows } = setup([activeSub()])
    const antes = { ...subRows[0] }
    const escritas = espiarEscrituras(deps)
    conTarjetaRechazada(stripeClient)

    await expect(applyUpgrade(deps, 'h1', 'plan-pro')).rejects.toBeInstanceOf(ValidationError)

    // Hubo escritura sobre la fila ACTIVA (la que el gate elige), y no trae `planId`.
    expect(escritas).toHaveLength(1)
    expect(escritas[0].id).toBe('s1')
    expect('planId' in escritas[0].patch).toBe(false)
    // No escribe NINGÚN campo de negocio: el patch va vacío y `updatedAt` lo pone el ORM. Si acá
    // volviera a aparecer un campo, sería un leer-modificar-escribir capaz de revertir el `status`
    // que el webhook cambió mientras Stripe respondía.
    expect(escritas[0].patch).toEqual({})
    // Lo ÚNICO que se movió es `updatedAt` (lo sella el ORM en toda escritura).
    expect(subRows[0].updatedAt).not.toBe(antes.updatedAt)
    expect({ ...subRows[0], updatedAt: antes.updatedAt }).toEqual(antes)
  })

  // BEST-EFFORT, mismo criterio que el reflejo local post-cobro: si la marca del intento fallara,
  // el error que la persona tiene que leer es el RECHAZO de la tarjeta, no el de una escritura
  // interna. Tapárselo la dejaría sin saber qué arreglar.
  it('si la marca del intento rechazado falla, igual sube el motivo del rechazo', async () => {
    const { deps } = setup([activeSub()])
    conTarjetaRechazada(stripeClient)
    deps.subscriptionsRepo.update = (async () => { throw new Error('DB caída') }) as any

    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }

    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toContain('Your card was declined.')
    expect(err.message).not.toContain('DB caída')
  })

  // Re-revisión #46: sin clave de idempotencia, dos pedidos concurrentes del mismo hotel (dos
  // pestañas, doble clic, un reintento superpuesto) leen los dos el estado local viejo, los dos
  // pasan el chequeo de "ya estás en ese plan" y los dos facturan su prorrateo: doble cobro real.
  it('manda una clave de idempotencia que describe la transición, para que dos pedidos concurrentes no cobren dos veces', async () => {
    const { deps } = setup([activeSub()])

    await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(updates).toHaveLength(1)
    const clave = updates[0].options?.idempotencyKey
    expect(typeof clave).toBe('string')
    // La clave identifica el INTENTO: hotel, suscripción de Stripe, plan destino y el `updatedAt`
    // de la fila leída. Atarla sólo a origen→destino haría que Stripe devolviera la respuesta
    // CACHEADA de 24h en un A→B→A→B legítimo del mismo día.
    // La clave es EXACTAMENTE el intento: prefijo + el `updatedAt` del snapshot leído, sin ningún
    // componente de reloj. Si volviera a colgarse de un bucket de tiempo, esta igualdad cae.
    expect(clave).toBe('upgrade:h1:sub_1:plan-pro:2026-09-01T00:00:00.000Z')
  })

  // Revisión #84: la ráfaga concurrente (doble clic, dos pestañas) es lo ÚNICO que la clave tiene
  // que colapsar. Los dos pedidos leyeron el MISMO snapshot antes de que ninguno tocara la fila,
  // así que comparten `updatedAt` y Stripe los resuelve como una sola operación: un solo cobro.
  it('dos pedidos con el MISMO snapshot y en el mismo instante comparten clave: la ráfaga se dedupe', async () => {
    // Cada llamada estrena `setup`: aplicar el plan escribe la fila y un segundo intento sobre el
    // mismo `deps` cortaría con "Ya estás en ese plan". El snapshot leído es idéntico en las dos.
    const claveDe = async () => {
      const { deps } = setup([activeSub()])
      updates = []
      await applyUpgrade(deps, 'h1', 'plan-pro')
      return updates[0].options?.idempotencyKey as string
    }

    try {
      setSystemTime(new Date('2026-09-08T12:00:00.000Z'))
      const primera = await claveDe()
      const concurrente = await claveDe()
      expect(concurrente).toBe(primera)
    } finally {
      setSystemTime()
    }
  })

  // EL BUG QUE ESTE FIX ELIMINA (revisión #84): con `error_if_incomplete` un cobro rechazado no
  // escribe nada del negocio, así que antes `updatedAt` no se movía y el reintento reusaba la
  // clave; Stripe devolvía el ERROR CACHEADO (viven 24h) sin volver a intentar el cobro. El hotel
  // corregía su tarjeta, reintentaba a los 10 segundos y recibía el mismo rechazo, contra el
  // "intentá de nuevo" que el propio código le muestra. Ahora el rechazo TOCA la fila, así que el
  // reintento estrena clave SIN esperar ninguna ventana de tiempo.
  it('el reintento tras un rechazo estrena clave en el acto, sin que pase un solo segundo del reloj', async () => {
    try {
      // El reloj queda CONGELADO en los dos intentos: cualquier bucket de tiempo daría el mismo
      // valor, así que lo único que puede distinguir las claves es el rastro que dejó el rechazo.
      setSystemTime(new Date('2026-09-08T12:00:00.000Z'))
      const { deps, subRows } = setup([activeSub()])
      conTarjetaRechazada(stripeClient)

      await expect(applyUpgrade(deps, 'h1', 'plan-pro')).rejects.toBeInstanceOf(ValidationError)
      const rechazada = updates[0].options?.idempotencyKey as string
      expect(rechazada).toBe('upgrade:h1:sub_1:plan-pro:2026-09-01T00:00:00.000Z')
      // El rechazo dejó rastro: éste es el snapshot que va a leer el reintento.
      const trasElRechazo = subRows[0].updatedAt as string
      expect(trasElRechazo).not.toBe('2026-09-01T00:00:00.000Z')

      // Tarjeta corregida, mismo instante: Stripe ya cobra.
      stripeClient.subscriptions.update = fakeStripe().subscriptions.update
      updates = []
      const res = await applyUpgrade(deps, 'h1', 'plan-pro')

      const reintento = updates[0].options?.idempotencyKey as string
      expect(reintento).not.toBe(rechazada)
      // Y la clave nueva es exactamente el intento nuevo: el `updatedAt` que dejó el rechazo, sin
      // ningún componente de reloj. Si la clave volviera a colgarse del bucket, esto cae.
      expect(reintento).toBe(`upgrade:h1:sub_1:plan-pro:${trasElRechazo}`)
      expect(res.applied).toBe(true)
      expect(subRows[0].planId).toBe('plan-pro')
    } finally {
      setSystemTime()
    }
  })

  // FALLBACK: una fila sin `updatedAt` (base vieja, doble incompleto) no tiene con qué distinguir
  // un intento de otro. Ahí y sólo ahí entra el bucket de `VENTANA_DEDUP_MS`: sigue colapsando la
  // ráfaga y estrena clave a la ventana siguiente. Con `updatedAt` el reloj no participa.
  it('sin updatedAt cae al bucket de tiempo: dedupea la ráfaga y estrena clave en la ventana siguiente', async () => {
    const claveDe = async () => {
      const { deps } = setup([activeSub({ updatedAt: undefined })])
      updates = []
      await applyUpgrade(deps, 'h1', 'plan-pro')
      return updates[0].options?.idempotencyKey as string
    }

    try {
      setSystemTime(new Date('2026-09-08T12:00:30.000Z'))
      const primera = await claveDe()
      // El token es el bucket de 60s del reloj (VENTANA_DEDUP_MS), nada más: no hay snapshot que
      // mirar.
      const bucket = Math.floor(Date.parse('2026-09-08T12:00:30.000Z') / 60_000)
      expect(primera).toBe(`upgrade:h1:sub_1:plan-pro:t${bucket}`)
      // Doble clic / dos pestañas: mismo instante, misma fila → MISMA clave, Stripe cobra una vez.
      expect(await claveDe()).toBe(primera)

      setSystemTime(new Date('2026-09-08T12:01:30.000Z'))
      expect(await claveDe()).not.toBe(primera)
    } finally {
      setSystemTime()
    }
  })

  // Revisión #84: el `catch` del update envolvía CUALQUIER error de Stripe en "revisá tu método de
  // pago". Un price inválido, un timeout o una caída de la API salían disfrazados de problema de
  // la tarjeta del hotel: la persona revisa una tarjeta que está bien y el log no grita lo que es
  // un fallo de infraestructura. Sólo el `StripeCardError` se traduce a tarjeta.
  //
  // #339: el resto tampoco puede subir CRUDO — el router sólo mapea `ErrorContract`, así que un
  // error de stripe-node terminaba en un 500 "Error interno del servidor" sin motivo. Sale como
  // `PaymentProviderError` (502) con lo que dijo Stripe y queda en el log con hotel y plan.
  it('un error de Stripe que NO es de tarjeta sale como PaymentProviderError 502, sin disfrazarse de método de pago', async () => {
    const { deps, subRows, hotelRows } = setup([activeSub()])
    const { logger, errores } = loggerEspia()
    deps.logger = logger
    const escritas = espiarEscrituras(deps)
    const original = errorDeStripe('StripeAPIError', 'An error occurred with our connection to Stripe.')
    stripeClient.subscriptions.update = async () => { throw original }

    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }

    // Se traduce a un error que el router SÍ sabe devolver, con el motivo de Stripe a la vista.
    esperarErrorDelProveedor(err, /An error occurred with our connection to Stripe/)
    expect(err).not.toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/plan actual no cambió/i)
    // Y queda en el log como error del sistema, con lo necesario para investigarlo.
    expect(errores).toHaveLength(1)
    expect(errores[0][0]).toMatch(/error de Stripe, no del método de pago/i)
    expect(errores[0][1]).toMatchObject({
      hotelId: 'h1', planId: 'plan-pro', stripeType: 'StripeAPIError',
      error: 'An error occurred with our connection to Stripe.',
    })
    // Pero la fila SÍ se marca: Stripe cachea la respuesta de cualquier error una vez que el
    // endpoint empezó a ejecutarse, así que sin el rastro el reintento —tras un error transitorio
    // ya resuelto— reusaría la clave y recibiría el mismo error cacheado por hasta 24h.
    expect(escritas).toHaveLength(1)
    expect(escritas[0].id).toBe('s1')
    expect(escritas[0].patch).toEqual({})   // sólo mueve `updatedAt`, ni un dato del negocio
    expect(subRows[0].updatedAt).not.toBe('2026-09-01T00:00:00.000Z')  // la marca del intento
    // Y nada del negocio se movió: el plan sigue siendo el que el hotel paga.
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  it('un StripeInvalidRequestError (price mal configurado) tampoco se traduce como tarjeta, pero igual marca el intento', async () => {
    const { deps, subRows } = setup([activeSub()])
    const escritas = espiarEscrituras(deps)
    const original = errorDeStripe('StripeInvalidRequestError', 'No such price: price_pro_349', 'resource_missing')
    stripeClient.subscriptions.update = async () => { throw original }

    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }

    esperarErrorDelProveedor(err, /No such price: price_pro_349/)
    expect(err.message).not.toMatch(/revisá tu método de pago/i)
    expect(subRows[0].planId).toBe('plan-ess')
    // Corregido el `stripePriceId` del plan, el reintento tiene que EJECUTARSE: sin la marca
    // chocaría con el mismo error cacheado bajo la clave de idempotencia.
    expect(escritas).toHaveLength(1)
    expect(escritas[0].patch).toEqual({})
  })

  // #339: el `retrieve` de `loadUpgrade` corre ANTES del update. Si falla ahí, no hay intento que
  // marcar (nada llegó a la clave de idempotencia) y el error tiene que salir con el mismo contrato.
  it('si Stripe falla al LEER la suscripción antes del cobro: PaymentProviderError 502, sin update ni marca', async () => {
    const { deps, subRows } = setup([activeSub()])
    const escritas = espiarEscrituras(deps)
    stripeClient.subscriptions.retrieve = async () => { throw errorDeStripe('StripeConnectionError', 'Request timed out') }

    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }

    esperarErrorDelProveedor(err, /Request timed out/)
    expect(updates).toHaveLength(0)
    expect(escritas).toHaveLength(0)
    expect(subRows[0].planId).toBe('plan-ess')
  })

  // Si Stripe devolviera una respuesta cacheada por idempotencia (o el ítem no fuera el que se
  // mandó a cambiar), escribir el plan nuevo en local afirmaría algo falso: el hotel quedaría con
  // el plan pago sin que Stripe lo haya cobrado.
  it('si Stripe NO quedó en el plan destino, no refleja nada en local y lo dice', async () => {
    priceOnUpdate = 'price_ess_99' // el ítem siguió en el plan viejo
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(res.applied).toBe(false)
    expect(res.paid).toBe(false)
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).not.toBe('pro')
  })

  it('con latest_invoice sin expandir (solo el id) va a buscarla antes de decir que se cobró', async () => {
    invoiceOnUpdate = 'in_3'
    const { deps } = setup([activeSub()])
    stripeClient.invoices.retrieve = async (id: string) => {
      invoiceRetrieves.push(id)
      return { id, status: 'paid', amount_due: 25000, currency: 'usd' }
    }

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(invoiceRetrieves).toEqual(['in_3'])
    expect(res.paid).toBe(true)
  })

  // Revisión #46: la tarjeta ya se cobró en `subscriptions.update`. Leer la factura es una
  // llamada de RED más y, si fallaba, la excepción subía: el hotel quedaba cobrado mirando un
  // error, sin reflejo del plan nuevo y sin un solo log del cobro. Justo el escenario que el
  // archivo dice evitar, pero blindado sólo para el fallo de escritura local.
  it('si falla la lectura de la factura DESPUÉS del cobro, no lanza: no afirma pago y deja el plan al webhook (#92)', async () => {
    invoiceOnUpdate = 'in_4'
    const { deps, subRows, hotelRows } = setup([activeSub()])
    stripeClient.invoices.retrieve = async () => { throw new Error('Stripe timeout') }

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    // No se pierde el cambio (en Stripe el ítem se movió) ni se le tira un 500 al hotel.
    expect(res.applied).toBe(true)
    // Y NO se afirma un cobro que no se pudo confirmar...
    expect(res.paid).toBe(false)
    expect(res.invoiceStatus).toBeNull()
    // ...ni se refleja un plan cuyo cobro no se pudo confirmar: "no sé" entra por la misma
    // puerta que "open". Lo aplica `invoice.paid` (handle-stripe-event.ts) cuando Stripe confirma.
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  // #92: el camino sincrónico de tarjeta no cambia — factura `paid` en la misma respuesta, plan
  // local en el acto. Es lo que ya cubre el primer test del describe; este fija que el reflejo
  // depende del status de la factura y no de que el update haya vuelto.
  it('con la factura `paid` en la respuesta refleja el plan local en el acto (tarjeta, #92 no lo frena)', async () => {
    invoiceOnUpdate = { id: 'in_5', status: 'paid', amount_due: 25000, amount_paid: 25000, currency: 'usd' }
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(res.paid).toBe(true)
    expect(subRows[0].planId).toBe('plan-pro')
    expect(hotelRows[0].plan).toBe('pro')
  })
})

describe('previewUpgrade — cuánto va a pagar, sin cobrar', () => {
  it('devuelve el monto prorrateado y NO llama a ningún método que cobre', async () => {
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await previewUpgrade(deps, 'h1', 'plan-pro')

    expect(res).toEqual({
      planId: 'plan-pro',
      planName: 'Professional',
      amountDue: 25000,
      currency: 'usd',
      currentPlanId: 'plan-ess',
      currentPlanName: 'Esencial',
      periodEnd: new Date(PERIOD_END * 1000).toISOString(),
    })
    // Nada que cobre ni que cambie el plan: ni update en Stripe ni escritura local.
    expect(updates).toHaveLength(0)
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  it('cotiza con el MISMO proration_behavior que el cobro (o el número mostrado sería otro)', async () => {
    const { deps } = setup([activeSub()])
    await previewUpgrade(deps, 'h1', 'plan-pro')
    expect(previews).toHaveLength(1)
    expect(previews[0].subscription).toBe('sub_1')
    expect(previews[0].subscription_details.items).toEqual([{ id: 'si_1', price: 'price_pro_349' }])
    expect(previews[0].subscription_details.proration_behavior).toBe('always_invoice')
  })

  // #84 (CA 2/25): ANTES esto era "downgrade → ValidationError que manda al portal". El criterio
  // cambió: bajar de plan es un destino válido y se cotiza igual que subir, así que el test que
  // afirmaba el rechazo ahora afirma lo contrario. El Billing Portal sigue existiendo, sólo dejó
  // de ser el único camino. (El cobro del downgrade se cubre arriba, en el caso que BAJA de plan.)
  it('el preview de un plan MÁS BARATO cotiza en vez de cortar', async () => {
    const { deps } = setup([activeSub({ planId: 'plan-pro' })])

    const res = await previewUpgrade(deps, 'h1', 'plan-ess')

    expect(previews).toHaveLength(1)
    expect(previews[0].subscription_details.items).toEqual([{ id: 'si_1', price: 'price_ess_99' }])
    expect(res.planId).toBe('plan-ess')
    expect(res.currentPlanId).toBe('plan-pro')
  })

  // #339 — "Error interno del servidor" al calcular el cambio de plan. `createPreview` lanzaba (un
  // `stripePriceId` que Stripe no conoce, una caída de su API) y el error subía crudo: el router
  // sólo mapea `ErrorContract`, así que la persona veía un 500 sin motivo y el log no tenía ni el
  // hotel. Tiene que salir como 502 del proveedor, con lo que dijo Stripe, y logueado con contexto.
  it('si createPreview falla en Stripe: PaymentProviderError 502 con el motivo, logueado y sin escribir nada', async () => {
    const { deps, subRows, hotelRows } = setup([activeSub()])
    const { logger, errores } = loggerEspia()
    deps.logger = logger
    const escritas = espiarEscrituras(deps)
    stripeClient.invoices.createPreview = async () => {
      throw errorDeStripe('StripeInvalidRequestError', 'No such price: price_x', 'resource_missing')
    }

    let err: any
    try { await previewUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }

    esperarErrorDelProveedor(err, /No such price: price_x/)
    expect(err.message).toMatch(/calcular el cambio de plan/i)
    expect(errores).toHaveLength(1)
    expect(errores[0][1]).toMatchObject({
      hotelId: 'h1', planId: 'plan-pro', stripeSubscriptionId: 'sub_1',
      stripeType: 'StripeInvalidRequestError', stripeCode: 'resource_missing', error: 'No such price: price_x',
    })
    // El preview no cobra ni escribe, y fallar tampoco: ni update en Stripe ni escritura local.
    expect(updates).toHaveLength(0)
    expect(escritas).toHaveLength(0)
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  it('si subscriptions.retrieve falla en Stripe: mismo contrato (502 con el motivo), sin escribir nada', async () => {
    const { deps, subRows } = setup([activeSub()])
    const { logger, errores } = loggerEspia()
    deps.logger = logger
    const escritas = espiarEscrituras(deps)
    stripeClient.subscriptions.retrieve = async () => { throw errorDeStripe('StripeAPIError', 'Stripe is down') }

    let err: any
    try { await previewUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }

    esperarErrorDelProveedor(err, /Stripe is down/)
    expect(err.message).toMatch(/leer tu suscripción en Stripe/i)
    expect(errores).toHaveLength(1)
    expect(errores[0][1]).toMatchObject({ hotelId: 'h1', planId: 'plan-pro', stripeType: 'StripeAPIError' })
    expect(previews).toHaveLength(0)
    expect(escritas).toHaveLength(0)
    expect(subRows[0].planId).toBe('plan-ess')
  })

  // Un rechazo PROPIO (plan retirado, mismo plan, sin suscripción) no es un fallo de Stripe: tiene
  // su status y su mensaje y NO puede salir envuelto en un 502 que le mienta a la persona.
  it('un ValidationError propio (plan desactivado) sigue saliendo como ValidationError, no envuelto en 502', async () => {
    const { deps } = setup([activeSub()])
    const { logger, errores } = loggerEspia()
    deps.logger = logger

    let err: any
    try { await previewUpgrade(deps, 'h1', 'plan-retirado-false') } catch (e) { err = e }

    expect(err).toBeInstanceOf(ValidationError)
    expect(err).not.toBeInstanceOf(PaymentProviderError)
    expect(err.httpStatus).toBe(400)
    expect(err.message).toMatch(/desactivado/i)
    expect(errores).toHaveLength(0)
    expect(previews).toHaveLength(0)
  })
})

describe('upgrade — lo que NO se deja hacer', () => {
  it('el mismo plan → ValidationError "Ya estás en ese plan", sin tocar Stripe', async () => {
    const { deps } = setup([activeSub({ planId: 'plan-pro' })])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/ya estás en ese plan/i)
    expect(updates).toHaveLength(0)
  })

  it('sin suscripción viva en Stripe (trialing sin stripeSubscriptionId) → ConflictError que remite al checkout', async () => {
    const { deps } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'trialing', stripeCustomerId: 'cus_1' }])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)
    expect(err.message).toMatch(/checkout/i)
    expect(updates).toHaveLength(0)
  })

  it('sin ninguna fila de suscripción tampoco: el alta va por el checkout normal', async () => {
    const { deps } = setup([])
    await expect(applyUpgrade(deps, 'h1', 'plan-pro')).rejects.toBeInstanceOf(ConflictError)
  })

  it('plan destino sin stripePriceId → ValidationError, igual que el checkout', async () => {
    const { deps } = setup([activeSub()])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-enterprise') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/sin precio configurado en Stripe/i)
    expect(updates).toHaveLength(0)
  })

  // CA 28 en negativo: "los planes PERMITIDOS". Un plan retirado del catálogo no se vende, y la
  // guarda tiene que cortar ANTES de tocar plata: si cortara después del `update`, el hotel se
  // comería una factura de prorrateo por una operación que el backend igual iba a rechazar.
  // Se prueban las DOS formas del flag porque el código chequea las dos (`false` y `0`): la base
  // guarda el booleano como entero en SQLite y como booleano en Postgres, así que cubrir una sola
  // dejaría media guarda sin ejercitar.
  for (const retirado of [RETIRADO_FALSE, RETIRADO_CERO]) {
    const forma = JSON.stringify(retirado.isActive)

    it(`plan destino desactivado (isActive: ${forma}) → ValidationError, sin llamar a Stripe ni escribir la fila`, async () => {
      const { deps, subRows, hotelRows } = setup([activeSub()])
      const antes = { ...subRows[0] }
      const escritas = espiarEscrituras(deps)

      let err: any
      try { await applyUpgrade(deps, 'h1', retirado.id) } catch (e) { err = e }

      expect(err).toBeInstanceOf(ValidationError)
      expect(err.message).toBe('Ese plan está desactivado')
      // Ni una sola llamada a Stripe: ni la lectura de la suscripción ni el update que factura.
      expect(retrieves).toHaveLength(0)
      expect(updates).toHaveLength(0)
      // Y la fila local intacta, `updatedAt` incluido: no hubo NINGUNA escritura.
      expect(escritas).toHaveLength(0)
      expect(subRows[0]).toEqual(antes)
      expect(hotelRows[0].plan).toBe('esencial')
    })

    it(`previewUpgrade tampoco cotiza un plan desactivado (isActive: ${forma})`, async () => {
      const { deps } = setup([activeSub()])

      let err: any
      try { await previewUpgrade(deps, 'h1', retirado.id) } catch (e) { err = e }

      expect(err).toBeInstanceOf(ValidationError)
      expect(err.message).toBe('Ese plan está desactivado')
      // Mostrar un precio de algo que no se puede contratar sería ofrecerlo.
      expect(previews).toHaveLength(0)
      expect(retrieves).toHaveLength(0)
    })
  }

  it('plan destino inexistente → NotFoundError (404)', async () => {
    const { deps } = setup([activeSub()])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-inventado') } catch (e) { err = e }
    expect(err.httpStatus).toBe(404)
    expect(updates).toHaveLength(0)
  })

  it('Stripe sin configurar en la plataforma → ValidationError, sin crash', async () => {
    stripeClient = null
    const { deps } = setup([activeSub()])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/Stripe no está configurado/i)
    await expect(previewUpgrade(deps, 'h1', 'plan-pro')).rejects.toBeInstanceOf(ValidationError)
  })
})
