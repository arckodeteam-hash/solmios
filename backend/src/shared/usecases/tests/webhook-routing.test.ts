// webhook-routing.test.ts — El criterio de ruteo tiene que ser UNO solo para los dos handlers.
//
// Si cada lado decidiera por su cuenta a quién pertenece un evento, un cobro podría rebotar entre
// ambos (bucle) o no ser de ninguno (descarte silencioso, que es el bug original).
import { describe, it, expect } from 'bun:test'
import { flowOfMetadata, flowOfRawEvent } from '../webhook-routing'

const raw = (metadata: unknown) => JSON.stringify({ data: { object: { metadata } } })

describe('flowOfMetadata', () => {
  it('un link de pago es del flujo de links de pago', () => {
    expect(flowOfMetadata({ paymentRequestId: 'pr-1' })).toBe('payment-request')
  })

  it('una reserva del motor es del motor', () => {
    expect(flowOfMetadata({ reservationId: 'res-1' })).toBe('reservation')
  })

  // Un link de pago se emite CONTRA una reserva, así que la sesión lleva los dos ids. Sin este
  // desempate cada handler podría reclamarlo y el evento rebotaría entre ambos.
  it('con AMBOS ids gana el link de pago: es quien emitió el cobro', () => {
    expect(flowOfMetadata({ paymentRequestId: 'pr-1', reservationId: 'res-1' })).toBe('payment-request')
  })

  it('sin ids conocidos no es de nadie (y quien lo reciba tiene que avisarlo)', () => {
    expect(flowOfMetadata({})).toBe('unknown')
    expect(flowOfMetadata(null)).toBe('unknown')
    expect(flowOfMetadata(undefined)).toBe('unknown')
  })

  it('un id vacío no cuenta como identificador', () => {
    expect(flowOfMetadata({ paymentRequestId: '' })).toBe('unknown')
    expect(flowOfMetadata({ reservationId: '' })).toBe('unknown')
  })

  it('un id que no es string se ignora (metadata viene de afuera)', () => {
    expect(flowOfMetadata({ paymentRequestId: 123 })).toBe('unknown')
  })
})

describe('flowOfRawEvent', () => {
  it('lee el metadata del cuerpo crudo, string o Buffer', () => {
    expect(flowOfRawEvent(raw({ reservationId: 'res-1' }))).toBe('reservation')
    expect(flowOfRawEvent(Buffer.from(raw({ paymentRequestId: 'pr-1' })))).toBe('payment-request')
  })

  it('un body ilegible no rutea a ningún lado', () => {
    expect(flowOfRawEvent('no-es-json')).toBe('unknown')
    expect(flowOfRawEvent('')).toBe('unknown')
  })

  it('un evento sin la forma esperada tampoco rompe', () => {
    expect(flowOfRawEvent('{"otra":"cosa"}')).toBe('unknown')
  })
})
