// shared/usecases/tests/arrival-setup-cron.test.ts — #274: el cron pasa por syncArrivalSetup
// toda llegada `confirmed` en ventana, aunque nadie haya pasado por el CRUD de reservas.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createArrivalSetupCron } from '../arrival-setup-cron'

// Mediodía UTC para que hoy±N no cruce de día por la zona.
const NOW = new Date('2026-09-12T12:00:00.000Z')
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10)

const RESERVAS = [
  { id: 'hoy', hotelId: 'h1', roomId: 'r1', status: 'confirmed', checkIn: day(0), needsCrib: true },
  { id: 'hoy+2', hotelId: 'h1', roomId: 'r2', status: 'confirmed', checkIn: day(2), needsCrib: true },
  { id: 'hoy+5', hotelId: 'h1', roomId: 'r3', status: 'confirmed', checkIn: day(5), needsCrib: true },
  { id: 'pending-hoy', hotelId: 'h1', roomId: 'r4', status: 'pending', checkIn: day(0), needsCrib: true },
]

/** ORM fake: `findMany(model, filtros)` filtra en memoria por igualdad, como el real. */
function fakeOrm(rows: any[] = RESERVAS) {
  return {
    findMany: async (model: string, where: Record<string, any> = {}) => {
      if (model !== 'Reservations') return []
      return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v))
    },
  }
}

function harness(over: { housekeeping?: any; rows?: any[] } = {}) {
  const synced: string[] = []
  const housekeeping = over.housekeeping === undefined
    ? { syncArrivalSetup: async (r: any) => { synced.push(r.id); return { action: 'created' } } }
    : over.housekeeping
  const cron = createArrivalSetupCron(fakeOrm(over.rows), (n) => (n === 'housekeeping' ? housekeeping : null), silentLogger())
  return { cron, synced }
}

describe('arrival-setup cron (#274)', () => {
  it('sincroniza las confirmed con checkIn hoy y hoy+2; ignora hoy+5 y las pending', async () => {
    const h = harness()
    const r = await h.cron(NOW)
    expect(r).toEqual({ synced: 2, skipped: 0 })
    expect(h.synced.sort()).toEqual(['hoy', 'hoy+2'])
  })

  it('un syncArrivalSetup que rechaza no corta el loop', async () => {
    const synced: string[] = []
    const h = harness({
      housekeeping: {
        syncArrivalSetup: async (r: any) => {
          if (r.id === 'hoy') throw new Error('repo caído')
          synced.push(r.id)
        },
      },
    })
    const r = await h.cron(NOW)
    expect(r).toEqual({ synced: 1, skipped: 1 })
    expect(synced).toEqual(['hoy+2'])
  })

  it('sin módulo housekeeping → {synced:0, skipped:0} sin throw', async () => {
    const h = harness({ housekeeping: null })
    await expect(h.cron(NOW)).resolves.toEqual({ synced: 0, skipped: 0 })
    const sinMetodo = harness({ housekeeping: { create: async () => ({}) } })
    await expect(sinMetodo.cron(NOW)).resolves.toEqual({ synced: 0, skipped: 0 })
  })
})
