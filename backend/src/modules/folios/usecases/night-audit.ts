import { roomChargeRate } from '../../../shared/usecases/room-charge-rate'
export async function postNightAuditRoomCharges(orm: any, listFolios: any, openFolio: any, postCharge: any, user: any, query?: any): Promise<any> {
  if (!orm) return { posted: 0, error: 'ORM no disponible' }
  // Multi-tenant: solo super_admin puede targetear otro hotel vía ?hotelId=.
  // Un merchant queda forzado a su propio hotelId del token (anti-patrón query||token).
  const isSuper = user?.role === 'super_admin'
  let hotelId = (isSuper ? (query?.hotelId as string) : undefined) || user?.hotelId as string
  if (!hotelId || hotelId === 'platform') {
    const hotels = await orm.findMany('Hotels', {}); const first: any = hotels[0]
    hotelId = first?.id
  }
  if (!hotelId) return { posted: 0, error: 'hotelId requerido' }
  const t = new Date().toISOString().split('T')[0]
  const reservations = await orm.findMany('Reservations', { hotelId }) as any[]
  const rooms = await orm.findMany('Rooms', { hotelId }) as any[]
  const roomById = new Map(rooms.map((r: any) => [r.id, r]))
  const inHouse = reservations.filter((r: any) => r.status === 'checked_in' && r.checkIn && r.checkOut && String(r.checkIn).slice(0, 10) <= t && t <= String(r.checkOut).slice(0, 10))
  let posted = 0
  let skipped = 0
  const mockUser = { id: 'system', role: 'super_admin', hotelId }
  for (const res of inHouse) {
    const room = roomById.get(res.roomId); if (!room) continue
    let folio = (await listFolios({ reservationId: res.id, status: 'open' } as any, mockUser as any)).data?.[0]
    if (!folio) folio = await openFolio({ hotelId, reservationId: res.id, guestId: res.guestId, roomId: res.roomId }, mockUser as any)
    // El filtro de dedup se hace EN MEMORIA a propósito. Antes decía
    // `findMany('FolioCharges', { folioId, description: { contains: t } })`, pero el `buildWhere`
    // del framework (kernel/db/orm-utils.ts) no soporta operadores: traduce cada clave a
    // `campo = ?`, así que ese `{ contains }` viajaba como objeto y NUNCA matcheaba. Resultado:
    // el cron —que corre cada 3 horas— posteaba el cargo de la habitación en CADA pasada.
    // Reproducido: 3 pasadas → 3 cargos de la misma noche, 300 en vez de 100.
    //
    // Se compara contra la descripción porque es lo que comparten el cargo del check-in y el del
    // night audit ("Habitación 101 — 2026-08-05"): así una noche ya cobrada al registrarse no se
    // vuelve a cobrar acá.
    const folioCharges = await orm.findMany('FolioCharges', { folioId: folio.id }) as any[]
    const alreadyPosted = (folioCharges ?? []).some((c: any) => String(c?.description ?? '').includes(t))
    if (alreadyPosted) {
      skipped++
      continue
    }
    // Mismo precio que cotizó la reserva: temporada → room_rates → rooms.basePrice. Con
    // `rooms.basePrice` a secas, cada noche de la estadía se facturaba fuera de temporada.
    const nightRate = await roomChargeRate(orm, {
      hotelId: folio.hotelId, date: t, roomType: String(room.type || ''),
      guests: Number(folio.guests) || 1, fallbackPrice: Number(room.basePrice) || 0,
    })
    await postCharge(folio.id, { description: `Habitación ${room.number} — ${t}`, category: 'room', amount: nightRate, quantity: 1, source: 'night_audit' }, mockUser as any)
    posted++
  }
  return { posted, skipped, date: t }
}
