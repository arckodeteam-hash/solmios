import { isCleaning, isUnderMaintenance } from '../../../shared/usecases/room-status'
export async function getDashboardData(orm: any, hotelId: string): Promise<any> {
  const [rooms, res, guests] = await Promise.all([
    orm.findMany('Rooms', { hotelId }),
    orm.findMany('Reservations', { hotelId }),
    orm.findMany('Guests', { hotelId }),
  ])
  const occupied = rooms.filter((r: any) => r.status === 'occupied').length
  // `dirty` y `out_of_service` NO existen en el enum de `rooms.status`
  // (available|occupied|maintenance|cleaning|out_of_order|reserved): los dos contadores daban
  // SIEMPRE 0 y el panel mostraba el hotel sin limpieza ni mantenimiento pendiente.
  const dirty = rooms.filter((r: any) => isCleaning(r.status)).length
  const maintenance = rooms.filter((r: any) => isUnderMaintenance(r.status)).length
  const t = new Date().toISOString().split('T')[0]
  const revenueToday = res.filter((r: any) => String(r.checkIn || '').slice(0, 10) === t).reduce((s: number, r: any) => s + (r.totalAmount || 0), 0)
  const checkins = res.filter((r: any) => r.checkIn && String(r.checkIn).slice(0, 10) === t && (r.status === 'confirmed' || r.status === 'checked_in')).length
  const checkouts = res.filter((r: any) => r.checkOut && String(r.checkOut).slice(0, 10) === t && (r.status === 'checked_in' || r.status === 'checked_out')).length
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const occYesterday = rooms.length ? Math.round((rooms.filter((r: any) => r.status === 'occupied').length / rooms.length) * 100) : 0
  const revYesterday = res.filter((r: any) => String(r.checkIn || '').slice(0, 10) === yesterday).reduce((s: number, r: any) => s + (r.totalAmount || 0), 0)
  const occToday = rooms.length ? Math.round((occupied / rooms.length) * 100) : 0
  return {
    ocupacion: occToday, revenue: res.reduce((s: number, r: any) => s + (r.totalAmount || 0), 0), revenueToday,
    totalRooms: rooms.length, occupied, checkins, checkouts,
    huespedes: guests.length, reservas: res.length, dirty, maintenance,
    roomsByType: rooms.reduce((a: any, r: any) => ((a[r.type] = (a[r.type] || 0) + 1), a), {}),
    roomsByStatus: rooms.reduce((a: any, r: any) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
    trends: {
      ocupacion: { value: occYesterday, direction: occToday > occYesterday ? 'up' : occToday < occYesterday ? 'down' : 'stable' },
      revenue: { value: revYesterday, direction: revenueToday > revYesterday ? 'up' : revenueToday < revYesterday ? 'down' : 'stable' },
    },
  }
}

export async function getPlanningData(orm: any, hotelId: string): Promise<any> {
  const [rooms, reservas, guests] = await Promise.all([
    orm.findMany('Rooms', { hotelId }),
    orm.findMany('Reservations', { hotelId }),
    orm.findMany('Guests', { hotelId }),
  ])
  const guestMap = new Map((guests as any[]).map((g: any) => [g.id, g]))
  const roomMap = new Map((rooms as any[]).map((r: any) => [r.id, r]))
  const enriched = (reservas as any[]).map((r: any) => {
    const guest = guestMap.get(r.guestId); const room = roomMap.get(r.roomId)
    const deposit = Number(r.deposit) || 0; const total = Number(r.totalAmount) || 0
    return { ...r, guestName: guest?.name || 'Guest', guestEmail: guest?.email || '', roomNumber: room?.number || '', paymentStatus: deposit >= total && total > 0 ? 'paid' : deposit > 0 ? 'partial' : 'pending' }
  })
  return { rooms, reservas: enriched }
}

export async function getCheckinListData(orm: any, hotelId: string): Promise<any> {
  const res = await orm.findMany('Reservations', { hotelId }) as any[]
  const guests = await orm.findMany('Guests', { hotelId })
  const rooms = await orm.findMany('Rooms', { hotelId })
  const guestMap = new Map(guests.map((g: any) => [g.id, g]))
  const roomMap = new Map(rooms.map((r: any) => [r.id, r]))
  const t = new Date().toISOString().split('T')[0]
  const checkins = res.filter((r: any) => r.checkIn && String(r.checkIn).slice(0, 10) === t && ['confirmed', 'pending'].includes(r.status))
  const checkouts = res.filter((r: any) => r.checkOut && String(r.checkOut).slice(0, 10) === t && (r.status === 'checked_in' || r.status === 'checked_out'))
  const enrich = (list: any[]) => list.map((r: any) => { const g: any = guestMap.get(r.guestId); const rm: any = roomMap.get(r.roomId); return { ...r, guestName: g?.name || 'Guest', guestEmail: g?.email || '', roomNumber: rm?.number || '' } })
  return { checkins: enrich(checkins), checkouts: enrich(checkouts), pendingCheckins: checkins.length, todayCheckouts: checkouts.length }
}

export async function resolveHotelId(orm: any, req: any): Promise<string | undefined> {
  const q = req?.query || {}
  if (q.hotelId) return q.hotelId as string
  const userHotel = req?.user?.hotelId
  if (userHotel && userHotel !== 'platform') return userHotel as string
  if (req?.user?.id && req?.user?.role !== 'super_admin') {
    const uRows = await orm.findMany('Users', { id: req.user.id })
    const u: any = uRows?.[0]
    if (u?.hotelId) return u.hotelId
  }
  return ((await orm.findMany('Hotels', {}))[0] as any)?.id
}
