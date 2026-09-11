// connectors/restaurante-payments.ts — POS → payments (RES-5). SOLO cablea: el cobro directo
// (cash/transfer) crea un payment `completed` por el total bruto. El cobro con tarjeta (fix-refund-pos-card)
// abre una Stripe Checkout Session real vía `chargeCard` y escucha el socket inverso
// (onPaymentCompleted/onPaymentExpired) para confirmar/revertir la comanda cuando el webhook llega.
// La caja y el asiento de caja los hace payments (onPaymentCompleted); el ingreso "Ventas Restaurante"
// lo reconoce RES-6.
import type { ConnectorContext } from 'arckode-framework'
import type { RecordPaymentInput, ChargeCardPaymentInput } from '../modules/restaurant'
import type { CurrentUser } from '../modules/restaurant/types'

// fix-refund-pos-card: expiración corta de la Checkout Session del POS. El producto pidió 15min;
// Stripe exige un mínimo de 30min (`STRIPE_CHECKOUT_EXPIRY_MIN_MINUTES` en stripe-gateway.ts) — se
// pide el valor de producto y el gateway lo clampea, PERO se documenta acá el valor real esperado
// (30min) para que el test de expiración no asuma 15.
const POS_CARD_CHECKOUT_EXPIRY_MINUTES = 30

interface PaymentsModule {
  createPayment: (dto: Record<string, unknown>) => Promise<{ id: string }>
  // Total refund when `amount` is omitted. Returns the new `type:'refund'` payment row.
  refundPayment: (paymentId: string, amount?: number, user?: { id?: string; role?: string }) => Promise<{ id: string }>
  // #214 (COR-5): devolución por método (tarjeta → Stripe; cash/transfer → asiento `refund` sin pasarela). La decisión vive en payments.
  refundPaymentByMethod?: (paymentId: string, user?: { id?: string; role?: string }) => Promise<{ id: string }>
  // #214 (COR-2): ¿ya existe un payment con esta idempotency key? Para conciliar un puerto que falló DESPUÉS de cobrar.
  findByReference?: (hotelId: string, reference: string) => Promise<{ id: string; method: string; status: string } | null>
  // fix-refund-pos-card
  chargeCard: (dto: Record<string, unknown>, actor?: { id?: string; role?: string }) => Promise<{ payment: { id: string }; checkoutUrl: string }>
  setSockets: (s: Record<string, (data: any) => Promise<void>>) => void
}

interface RestaurantModule {
  setSettlementDeps: (p: any) => void
  // fix-refund-pos-card: llamados desde el socket inverso de payments (webhook de Stripe).
  settlePaidOrder: (orderId: string, paymentId: string, user: CurrentUser) => Promise<void>
  unsettleOrder: (orderId: string, user: CurrentUser) => Promise<void>
  // #214: lo mismo para UNA PARTE de un cobro dividido (metadata.orderPaymentId).
  settleOrderPayment: (partId: string, paymentId: string, user: CurrentUser) => Promise<unknown>
  expireOrderPayment: (partId: string, user: CurrentUser) => Promise<unknown>
}

export function restaurantePaymentsConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<RestaurantModule>('restaurant')
  const payments = () => ctx.resolveModule<PaymentsModule>('payments')

  restaurant.setSettlementDeps({
    recordPayment: async (input: RecordPaymentInput) => {
      const payment = await payments().createPayment({
        hotelId: input.hotelId,
        type: 'charge',
        method: input.method,
        status: 'completed',   // dinero recibido en el mostrador
        amount: input.amount,
        currency: input.currency,   // moneda del hotel (M3); si undefined, payments defaultea
        description: input.description,
        folioId: input.folioId,
        // Idempotency key (idempotencia-settlement-pos): `payment-crud.create` reclama esta
        // reference atómico contra un UNIQUE index parcial (hotelId,reference) WHERE reference LIKE
        // 'pos:%'. Un doble-click o un reintento tras crash con la MISMA orden pide el MISMO
        // reference → devuelve el payment ya creado en vez de duplicar el cobro.
        // #214: una PARTE de un cobro dividido trae la suya (`pos:<orderId>:<n>`) — mismo índice.
        reference: input.reference ?? 'pos:' + input.orderId,
        // Tag de origen: payments-caja lo lee para asentar el efectivo en el cajón del
        // restaurante, NO en el de recepción (antes se mezclaban en un único turno del hotel).
        metadata: { source: 'restaurant', orderId: input.orderId, ...(input.metadata ?? {}) },
      })
      return { paymentId: payment.id }
    },
    // fix-refund-pos-card: cobro con tarjeta REAL (Checkout Session), reusa payments.chargeCard
    // (mismo usecase que folios). Mismo esquema de `reference: 'pos:'+orderId` que recordPayment
    // (idempotencia-settlement-pos) y mismo tag de origen en metadata para el socket inverso de abajo.
    chargeCardPayment: async (input: ChargeCardPaymentInput) => {
      const result = await payments().chargeCard({
        hotelId: input.hotelId,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        reference: input.reference ?? 'pos:' + input.orderId,
        metadata: { source: 'restaurant', orderId: input.orderId, ...(input.metadata ?? {}) },
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        expiresInMinutes: POS_CARD_CHECKOUT_EXPIRY_MINUTES,
      })
      return { paymentId: result.payment.id, checkoutUrl: result.checkoutUrl }
    },
    // RES-6 refund: full refund of the original POS payment. The port discards the returned
    // PaymentDTO (caller expects Promise<void>). Synthetic system user — the refund fires from
    // the restaurant socket, not an HTTP request, mirroring restaurante-inventario's `sys`.
    // Inline param types: the local module cast uses `any` for setSettlementDeps, which disables
    // contextual inference for the callback params. Annotate to match SettlementPorts.refundPayment.
    // #214 (COR-5): por método — tarjeta → Stripe; efectivo/transferencia → asiento `refund` sin pasarela
    // (`payments.refundPaymentByMethod`). Sin ese método cableado (payments viejo), el camino de siempre: solo tarjeta.
    refundPayment: async ({ paymentId }: { paymentId: string }, _user: CurrentUser) => {
      const sysUser = { id: 'system', role: 'super_admin' }
      const p = payments()
      await (p.refundPaymentByMethod ? p.refundPaymentByMethod(paymentId, sysUser) : p.refundPayment(paymentId, undefined, sysUser))
    },
    // #214 (COR-2): antes de dar por "sin efecto" un fallo del puerto, el POS pregunta si el cobro con esa
    // referencia igual quedó asentado (y concilia en vez de borrar la parte).
    findPaymentByReference: async ({ hotelId, reference }: { hotelId: string; reference: string }) => {
      const row = await payments().findByReference?.(hotelId, reference)
      return row ? { paymentId: row.id, status: row.status, method: row.method } : null
    },
  })

  // fix-refund-pos-card: socket inverso — payments avisa cuando el webhook de Stripe confirma o
  // expira un cobro. Filtra por metadata.source==='restaurant': un cobro de folios/reservas con el
  // mismo evento NO debe tocar una orden del POS. Todos los módulos ya están instanciados acá (los
  // conectores corren DESPUÉS de crear todos los módulos — System.init()), así que resolver 'payments'
  // ahora mismo (no en un callback) es seguro.
  const sys: CurrentUser = { id: 'system', role: 'super_admin' }
  payments().setSockets({
    onPaymentCompleted: async (payment: any) => {
      const orderId = payment?.metadata?.orderId
      if (payment?.metadata?.source !== 'restaurant' || !orderId) return
      // El callback SOLO confirma cobros CON TARJETA diferidos (Checkout Session → la orden quedó
      // `processing_payment` esperando el webhook). cash/transfer son inmediatos: recordPayment los
      // crea `completed` y payOrder() ya marca la orden `paid` por su cuenta — llamar settlePaidOrder
      // acá chocaría con su guard de estado (la orden no está `processing_payment`) y rompería el
      // cobro directo, dejando el payment colgando sin marcar la comanda (bug e2e 2026-08-01).
      // #213: una devolución (`type:'refund'`) hereda `metadata.source/orderId` del cobro para que el
      // cierre del día la reste; nace `completed` y también pasa por acá. No es un cobro a confirmar.
      if (payment?.method !== 'card' || payment?.type !== 'charge') return
      // #214: el cobro es UNA PARTE de una cuenta dividida → confirma esa parte (y cierra la comanda si
      // era la última), no la comanda entera.
      const partId = payment?.metadata?.orderPaymentId
      await (partId ? restaurant.settleOrderPayment(String(partId), payment.id, sys) : restaurant.settlePaidOrder(orderId, payment.id, sys))
    },
    onPaymentExpired: async (payment: any) => {
      const orderId = payment?.metadata?.orderId
      if (payment?.metadata?.source !== 'restaurant' || !orderId) return
      const partId = payment?.metadata?.orderPaymentId
      await (partId ? restaurant.expireOrderPayment(String(partId), sys) : restaurant.unsettleOrder(orderId, sys))
    },
  })
}
