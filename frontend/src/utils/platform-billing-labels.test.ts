// Las etiquetas de /admin/billing y la regla que anticipa qué correo va a salir.
import { describe, it, expect } from 'vitest'
import {
  statusLabel, statusBadge, methodLabel, templateLabel, expectedTemplate,
  invoiceLabel, shortDate, money,
} from './platform-billing-labels'

describe('etiquetas de estado y método', () => {
  it('traduce los estados reales de la API', () => {
    expect(statusLabel('paid')).toBe('Pagada')
    expect(statusLabel('open')).toBe('Pendiente')
    expect(statusLabel('failed')).toBe('Cobro fallido')
    expect(statusLabel('void')).toBe('Anulada')
  })

  it('un estado desconocido se muestra crudo, no vacío (mejor un dato feo que ninguno)', () => {
    expect(statusLabel('lo_que_sea')).toBe('lo_que_sea')
    expect(statusBadge('lo_que_sea')).toContain('text-text-muted')
  })

  it('el badge usa fondo /10 + texto del color', () => {
    expect(statusBadge('paid')).toBe('bg-teal/10 text-teal')
    expect(statusBadge('failed')).toBe('bg-danger/10 text-danger')
  })

  it('traduce el método', () => {
    expect(methodLabel('card')).toBe('Tarjeta')
    expect(methodLabel('manual')).toBe('Manual')
  })
})

describe('expectedTemplate — anticipa la plantilla que elige el backend', () => {
  it('un cobro fallido avisa del rechazo', () => {
    expect(expectedTemplate({ status: 'failed', isRecurring: true })).toBe('payment_failed')
  })

  it('pendiente CON tarjeta avisa de la renovación automática', () => {
    expect(expectedTemplate({ status: 'open', isRecurring: true })).toBe('subscription_renewal_auto')
  })

  it('pendiente SIN tarjeta pide que pague el hotel', () => {
    expect(expectedTemplate({ status: 'open', isRecurring: false })).toBe('subscription_renewal_manual')
  })

  it('las tres plantillas tienen nombre legible', () => {
    expect(templateLabel('payment_failed')).toBe('Aviso de cobro rechazado')
    expect(templateLabel('subscription_renewal_auto')).toContain('automática')
    expect(templateLabel('subscription_renewal_manual')).toContain('vencimiento')
  })
})

describe('invoiceLabel — cómo se identifica una factura en la tabla', () => {
  it('con número de Stripe, el número', () => {
    expect(invoiceLabel({ number: 'SOLM-0001', method: 'card', reference: '', id: 'abc12345-x' })).toBe('SOLM-0001')
  })

  it('una manual no tiene número: se identifica por su referencia', () => {
    expect(invoiceLabel({ number: '', method: 'manual', reference: 'TRF-1234', id: 'abc12345-x' })).toBe('Manual · TRF-1234')
  })

  it('sin número ni referencia, un id corto (nunca vacío)', () => {
    expect(invoiceLabel({ number: '', method: 'card', reference: '', id: 'abcdef1234' })).toBe('abcdef12')
  })
})

describe('formatos', () => {
  it('una fecha ausente NO se pinta como "—"', () => {
    expect(shortDate('')).toBe('')
    expect(shortDate('no-es-fecha')).toBe('')
  })

  it('el monto lleva SU moneda, no un $ fijo', () => {
    expect(money(49, 'USD')).toBe('USD 49.00')
    expect(money(1234.5, 'DOP')).toContain('DOP')
  })
})

describe('subscriptionStatusLabel — las MISMAS palabras que /admin/subscriptions', () => {
  it('traduce el estado de la suscripción del hotel', async () => {
    const { subscriptionStatusLabel } = await import('./platform-billing-labels')
    expect(subscriptionStatusLabel('past_due')).toBe('Pago pendiente')
    expect(subscriptionStatusLabel('active')).toBe('Activa')
    expect(subscriptionStatusLabel('trialing')).toBe('En prueba')
  })
})

describe('isoFromDayInput — la fecha del formulario que el backend acepta', () => {
  it('HOY viaja como el instante actual, no como el mediodía (o el backend lo lee como futuro)', async () => {
    const { isoFromDayInput } = await import('./platform-billing-labels')
    // 11:25 en una zona UTC-4: el mediodía LOCAL son las 16:00 UTC, todavía en el futuro.
    const now = new Date('2026-09-10T15:25:00.000Z')
    const hoyLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(isoFromDayInput(hoyLocal, now)).toBe(now.toISOString())
    expect(new Date(isoFromDayInput(hoyLocal, now)).getTime()).toBeLessThanOrEqual(now.getTime())
  })

  it('otro día usa el mediodía local: no se corre de día al pasar a UTC', async () => {
    const { isoFromDayInput } = await import('./platform-billing-labels')
    const iso = isoFromDayInput('2026-10-01', new Date('2026-09-10T15:25:00.000Z'))
    expect(new Date(iso).getDate()).toBe(1)
    expect(new Date(iso).getMonth()).toBe(9)
  })

  it('vacío devuelve vacío', async () => {
    const { isoFromDayInput } = await import('./platform-billing-labels')
    expect(isoFromDayInput('')).toBe('')
  })
})
