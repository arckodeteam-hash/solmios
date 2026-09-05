// connectors/tests/habitaciones-pricing.test.ts — Cambiar el precio de una habitación re-deriva las
// tarifas guardadas. Sin esto, la OTA publica el precio nuevo (el push deriva de `Rooms`) y el motor
// de reservas sigue cobrando el viejo, que es la fila que quedó en `room_rates`.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { habitacionesPricingConnector } from '../habitaciones-pricing'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function makeCtx(resync: (hotelId: string) => Promise<number>) {
  const captured: any = { sockets: {} }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'habitaciones') return { setSockets: (s: any) => Object.assign(captured.sockets, s) }
      if (name === 'pricing') return { resyncBasePrices: resync }
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured }
}

describe('habitacionesPricingConnector', () => {
  it('editar una habitación re-deriva las tarifas de ese hotel', async () => {
    const calls: string[] = []
    const { ctx, captured } = makeCtx(async (h) => { calls.push(h); return 1 })
    habitacionesPricingConnector(ctx, 30)

    await captured.sockets.onHabitacionesUpdated({ hotelId: 'h1', type: 'suite', basePrice: 120 })
    await sleep(80)

    expect(calls).toEqual(['h1'])
  })

  it('dar de alta una habitación también', async () => {
    const calls: string[] = []
    const { ctx, captured } = makeCtx(async (h) => { calls.push(h); return 1 })
    habitacionesPricingConnector(ctx, 30)

    await captured.sockets.onHabitacionesCreated({ hotelId: 'h2', type: 'double', basePrice: 80 })
    await sleep(80)

    expect(calls).toEqual(['h2'])
  })

  // Una carga en lote emite un evento por habitación: sin agrupar serían 12 barridos de room_rates.
  it('una ráfaga de altas del mismo hotel resuelve en un solo barrido', async () => {
    const calls: string[] = []
    const { ctx, captured } = makeCtx(async (h) => { calls.push(h); return 1 })
    habitacionesPricingConnector(ctx, 40)

    for (let i = 0; i < 5; i++) await captured.sockets.onHabitacionesCreated({ hotelId: 'h1' })
    await sleep(100)

    expect(calls).toEqual(['h1'])
  })

  it('hoteles distintos no se mezclan', async () => {
    const calls: string[] = []
    const { ctx, captured } = makeCtx(async (h) => { calls.push(h); return 1 })
    habitacionesPricingConnector(ctx, 30)

    await captured.sockets.onHabitacionesUpdated({ hotelId: 'h1' })
    await captured.sockets.onHabitacionesUpdated({ hotelId: 'h2' })
    await sleep(80)

    expect(calls.sort()).toEqual(['h1', 'h2'])
  })

  it('un evento sin hotel no dispara nada', async () => {
    const calls: string[] = []
    const { ctx, captured } = makeCtx(async (h) => { calls.push(h); return 1 })
    habitacionesPricingConnector(ctx, 30)

    await captured.sockets.onHabitacionesUpdated({ type: 'suite' })
    await sleep(80)

    expect(calls).toHaveLength(0)
  })

  // El resync es fire-and-forget dentro del coalescer: si falla, no puede tumbar el guardado de la
  // habitación (que ya está persistido) ni dejar una promesa sin capturar.
  it('un fallo del resync no se propaga', async () => {
    const { ctx, captured } = makeCtx(async () => { throw new Error('DB caída') })
    habitacionesPricingConnector(ctx, 30)

    await captured.sockets.onHabitacionesUpdated({ hotelId: 'h1' })
    await sleep(80)
  })
})
