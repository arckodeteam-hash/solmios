// canales/tests/push-coalescing.test.ts — Qué se publica en cada ráfaga de cambios.
//
// El coalescer publicaba los canales O la base, nunca las dos. Los cambios GLOBALES —fechas de una
// temporada, días pintados en el planning, copiar tarifas al año próximo, CTA/CTD— agendan sin
// canal, así que salía solo la base y borraba los precios por canal.
//
// Medido en producción el 2026-09-05 (Hotel Boutique Palma): la suite estaba publicada a $330 por
// su canal; se movió la fecha de fin de una temporada —ni una tarifa tocada— y ocho segundos
// después Channex devolvía $120, la tarifa base.
import { describe, it, expect } from 'bun:test'
import { PushCoalescer } from '../usecases/push-coalescing'

/** El debounce se dispara por timer: hay que soltar el event loop para verlo. */
const settle = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms))

function makeCoalescer(over: { overrides?: string[]; failOverrides?: boolean; failPush?: string } = {}) {
  const pushed: Array<string | undefined> = []
  const errors: Array<string | undefined> = []
  const c = new PushCoalescer(
    async (_hotelId, channel) => {
      if (over.failPush !== undefined && channel === over.failPush) throw new Error('channex caído')
      pushed.push(channel)
    },
    1,
    (_hotelId, channel) => { errors.push(channel) },
    over.overrides || over.failOverrides
      ? async () => { if (over.failOverrides) throw new Error('no se pudo listar'); return over.overrides ?? [] }
      : undefined,
  )
  return { c, pushed, errors }
}

describe('PushCoalescer — cambio global (temporadas, planning, restricciones)', () => {
  it('publica la base Y DESPUÉS los canales con tarifa propia', async () => {
    const { c, pushed } = makeCoalescer({ overrides: ['OpenChannel'] })
    c.schedule('h1')
    await settle()
    expect(pushed).toEqual([undefined, 'OpenChannel'])
  })

  it('el orden importa: la base primero, o pisa al canal', async () => {
    const { c, pushed } = makeCoalescer({ overrides: ['OpenChannel', 'booking'] })
    c.schedule('h1')
    await settle()
    expect(pushed).toEqual([undefined, 'OpenChannel', 'booking'])
    expect(pushed.indexOf(undefined)).toBe(0)
  })

  it('hotel sin tarifas por canal → solo la base, una llamada', async () => {
    const { c, pushed } = makeCoalescer({ overrides: [] })
    c.schedule('h1')
    await settle()
    expect(pushed).toEqual([undefined])
  })

  it('sin resolvedor cableado se comporta como antes: solo la base', async () => {
    const { c, pushed } = makeCoalescer()
    c.schedule('h1')
    await settle()
    expect(pushed).toEqual([undefined])
  })

  it('si listar los canales falla, publica la base igual y avisa', async () => {
    const { c, pushed, errors } = makeCoalescer({ failOverrides: true })
    c.schedule('h1')
    await settle()
    expect(pushed).toEqual([undefined])
    expect(errors).toEqual([undefined])
  })
})

describe('PushCoalescer — edición de la tarifa de un canal', () => {
  it('con canal explícito publica SOLO ese canal, sin consultar los demás', async () => {
    let asked = false
    const pushed: Array<string | undefined> = []
    const c = new PushCoalescer(
      async (_h, channel) => { pushed.push(channel) }, 1, () => {},
      async () => { asked = true; return ['booking'] },
    )
    c.schedule('h1', ['OpenChannel'])
    await settle()
    expect(pushed).toEqual(['OpenChannel'])
    expect(asked).toBe(false)
  })

  it('agrupa la ráfaga: dos eventos del mismo canal son un solo push', async () => {
    const { c, pushed } = makeCoalescer({ overrides: [] })
    c.schedule('h1', ['OpenChannel'])
    c.schedule('h1', ['OpenChannel'])
    await settle()
    expect(pushed).toEqual(['OpenChannel'])
  })

  it('canales distintos en la misma ráfaga salen los dos', async () => {
    const { c, pushed } = makeCoalescer({ overrides: [] })
    c.schedule('h1', ['OpenChannel'])
    c.schedule('h1', ['booking'])
    await settle()
    expect(pushed.sort()).toEqual(['OpenChannel', 'booking'].sort())
  })

  it('hoteles distintos no se mezclan', async () => {
    const calls: Array<[string, string | undefined]> = []
    const c = new PushCoalescer(async (h, ch) => { calls.push([h, ch]) }, 1, () => {}, async () => [])
    c.schedule('h1', ['OpenChannel'])
    c.schedule('h2')
    await settle()
    expect(calls).toContainEqual(['h1', 'OpenChannel'])
    expect(calls).toContainEqual(['h2', undefined])
  })
})

describe('PushCoalescer — fallos', () => {
  it('si un canal falla, los demás se publican igual', async () => {
    const { c, pushed, errors } = makeCoalescer({ overrides: ['roto', 'OpenChannel'], failPush: 'roto' })
    c.schedule('h1')
    await settle()
    expect(pushed).toEqual([undefined, 'OpenChannel'])
    expect(errors).toEqual(['roto'])
  })
})
