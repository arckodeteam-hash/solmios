// canales/tests/override-channels.test.ts — Qué canales se republican después de un sync.
//
// Todos los pushes escriben sobre los MISMOS rate plans de la property, así que el último gana.
// Publicar cualquier string que aparezca en la columna `channel` hace que una fila huérfana pise
// el precio del canal que está vendiendo. Pasó en producción el 2026-09-05 (Hotel Boutique Palma):
// cuatro pushes seguidos y el precio final salió de filas de un "canal" que no existe.
import { describe, it, expect } from 'bun:test'
import { listOverrideChannels } from '../usecases/override-channels'

const rates = (...channels: Array<string | undefined | null>) =>
  async () => channels.map((channel) => ({ hotelId: 'h1', channel }))
const activos = (...types: string[]) => async () => types

describe('listOverrideChannels', () => {
  it('devuelve el canal conectado que tiene tarifa propia', async () => {
    const out = await listOverrideChannels(rates('', 'OpenChannel'), 'h1', activos('OpenChannel'))
    expect(out).toEqual(['OpenChannel'])
  })

  it('descarta las filas de un canal que NO está activo: si no, pisa al que sí vende', async () => {
    const out = await listOverrideChannels(
      rates('', 'OpenChannel', '0a70f83f-3a3a-41de-84c5-ab2fecc8b80c'), 'h1', activos('OpenChannel'),
    )
    expect(out).toEqual(['OpenChannel'])
  })

  it('un canal activo SIN tarifa propia no se publica aparte: no hay nada que publicar', async () => {
    const out = await listOverrideChannels(rates('', 'OpenChannel'), 'h1', activos('OpenChannel', 'booking'))
    expect(out).toEqual(['OpenChannel'])
  })

  it('un canal desactivado queda afuera aunque tenga tarifas', async () => {
    const out = await listOverrideChannels(rates('booking'), 'h1', activos())
    expect(out).toEqual([])
  })

  it('hotel sin tarifas por canal → vacío, y el full sync sigue siendo de 2 llamadas', async () => {
    const out = await listOverrideChannels(rates('', '', null, undefined), 'h1', activos('OpenChannel'))
    expect(out).toEqual([])
  })

  it('sin filas de tarifas no se pregunta por los canales activos', async () => {
    let asked = false
    const out = await listOverrideChannels(async () => [], 'h1', async () => { asked = true; return [] })
    expect(out).toEqual([])
    expect(asked).toBe(false)
  })

  it('si listar los canales falla, no se publica ninguno: mejor la base sola que un precio al azar', async () => {
    const out = await listOverrideChannels(rates('OpenChannel'), 'h1', async () => { throw new Error('channex caído') })
    expect(out).toEqual([])
  })

  it('no duplica un canal que aparece en varias filas', async () => {
    const out = await listOverrideChannels(rates('OpenChannel', 'OpenChannel'), 'h1', activos('OpenChannel'))
    expect(out).toEqual(['OpenChannel'])
  })
})
