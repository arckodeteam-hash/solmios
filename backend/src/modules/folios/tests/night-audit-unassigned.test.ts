import { describe, it, expect } from 'bun:test'
import { postNightAuditRoomCharges } from '../usecases/night-audit'

// #262 REQ-HAC-07: con HAC-01 la reserva nace con roomId = null hasta el check-in. Una `checked_in`
// sin habitación no debería existir (assertRoomAssigned), pero el cron del night audit no puede
// depender de eso: la salta sin excepción, sin abrir folio ni postear cargo, y sigue con las demás.
function shift(n: number): string { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

function setup(opts: { reservations: any[]; rooms: any[]; existingFolios?: any[]; existingCharges?: Record<string, any[]> }) {
  const posted: any[] = []
  const opened: any[] = []
  const folios: any[] = [...(opts.existingFolios || [])]
  const charges = opts.existingCharges || {}
  const orm = {
    findMany: async (table: string, filter: any) => {
      if (table === 'Reservations') return opts.reservations
      if (table === 'Rooms') return opts.rooms
      if (table === 'Hotels') return [{ id: 'h1' }]
      if (table === 'FolioCharges') return charges[filter.folioId] || []
      return []
    },
  }
  const listFolios = async (q: any) => ({ data: folios.filter((f) => f.reservationId === q.reservationId && f.status === q.status) })
  const openFolio = async (d: any) => { const f = { id: 'folio-' + d.reservationId, ...d, status: 'open' }; folios.push(f); opened.push(f); return f }
  const postCharge = async (folioId: string, charge: any) => { posted.push({ folioId, ...charge }) }
  return { orm, listFolios, openFolio, postCharge, posted, opened }
}

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }

describe('#262 REQ-HAC-07 — night audit tolera roomId nulo', () => {
  it('checked_in de hoy con roomId null → termina sin excepción, posted 0, no abre folio ni postea', async () => {
    const s = setup({
      reservations: [{ id: 'r1', hotelId: 'h1', roomId: null, guestId: 'g1', status: 'checked_in', checkIn: shift(0), checkOut: shift(2) }],
      rooms: [{ id: 'rm1', number: '101', basePrice: 100 }],
    })

    const result = await postNightAuditRoomCharges(s.orm, s.listFolios, s.openFolio, s.postCharge, user)

    expect(result.posted).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.error).toBeUndefined()
    expect(s.opened).toHaveLength(0)
    expect(s.posted).toHaveLength(0)
  })

  it('la reserva sin habitación no corta el loop: otra checked_in CON habitación en la misma corrida sí postea', async () => {
    const s = setup({
      reservations: [
        { id: 'r1', hotelId: 'h1', roomId: null, guestId: 'g1', status: 'checked_in', checkIn: shift(0), checkOut: shift(2) },
        { id: 'r2', hotelId: 'h1', roomId: 'rm1', guestId: 'g2', status: 'checked_in', checkIn: shift(-1), checkOut: shift(2) },
      ],
      rooms: [{ id: 'rm1', number: '101', basePrice: 100 }],
    })

    const result = await postNightAuditRoomCharges(s.orm, s.listFolios, s.openFolio, s.postCharge, user)

    expect(result.posted).toBe(1)
    expect(s.opened.map((f) => f.reservationId)).toEqual(['r2'])
    expect(s.posted).toHaveLength(1)
    expect(s.posted[0]).toMatchObject({ folioId: 'folio-r2', amount: 100, category: 'room', source: 'night_audit' })
    expect(String(s.posted[0].description)).toContain('101')
  })
})
