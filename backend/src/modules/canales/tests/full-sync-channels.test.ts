// canales/tests/full-sync-channels.test.ts — Sincronizar no puede tirar abajo los precios del canal.
//
// El ARI post-sync publicaba SOLO la tarifa base del hotel. Un hotel con precio propio por canal lo
// perdía en cada sincronización: medido en producción el 2026-09-04 (Hotel Boutique Palma), la suite
// pasó de $330 —su precio de temporada alta en el canal— a $120, la tarifa base, y se quedó ahí.
// Desde el fix de inventario el sync además corre solo al dar de alta o de baja una habitación, así
// que el agujero se abría en el flujo normal, no solo apretando el botón.
import { describe, it, expect } from 'bun:test'
import { pushFullSyncAri, type FullSyncDeps } from '../usecases/full-sync'

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any

function makeDeps(over: Partial<FullSyncDeps> = {}) {
  const order: string[] = []
  const deps: FullSyncDeps = {
    pushAll: async () => { order.push('availability') },
    pushRates: async (channel) => { order.push(channel ? `rates:${channel}` : 'rates:base') },
    logger: silent,
    ...over,
  }
  return { deps, order }
}

describe('pushFullSyncAri', () => {
  it('sin canales con tarifa propia son EXACTAMENTE 2 llamadas (test 1 de la certificación)', async () => {
    const { deps, order } = makeDeps({ overrideChannels: async () => [] })
    await pushFullSyncAri(deps, 'h1')
    expect(order).toEqual(['availability', 'rates:base'])
  })

  it('sin `overrideChannels` cableado tampoco cambia nada (comportamiento previo intacto)', async () => {
    const { deps, order } = makeDeps()
    await pushFullSyncAri(deps, 'h1')
    expect(order).toEqual(['availability', 'rates:base'])
  })

  it('el canal con tarifa propia se publica DESPUÉS de la base, o la base lo pisa', async () => {
    const { deps, order } = makeDeps({ overrideChannels: async () => ['OpenChannel'] })
    await pushFullSyncAri(deps, 'h1')
    expect(order).toEqual(['availability', 'rates:base', 'rates:OpenChannel'])
    expect(order.indexOf('rates:base')).toBeLessThan(order.indexOf('rates:OpenChannel'))
  })

  it('varios canales: todos, y todos después de la base', async () => {
    const { deps, order } = makeDeps({ overrideChannels: async () => ['OpenChannel', 'booking'] })
    await pushFullSyncAri(deps, 'h1')
    expect(order).toEqual(['availability', 'rates:base', 'rates:OpenChannel', 'rates:booking'])
  })

  it('si el push de un canal falla, el sync de estructura NO se invalida: se loguea', async () => {
    const errors: unknown[] = []
    const { deps } = makeDeps({
      overrideChannels: async () => ['OpenChannel'],
      pushRates: async (channel) => { if (channel) throw new Error('channex caído') },
      logger: { ...silent, error: (...a: unknown[]) => { errors.push(a) } } as any,
    })
    await expect(pushFullSyncAri(deps, 'h1')).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })
})
