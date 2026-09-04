// ai-gerente/usecases/tools.ts — Tools administrativas del Gerente IA (M17).
// El LLM decide cuál llamar (function calling); executeManagerTool la ejecuta contra los módulos reales.
// Destructivas (cancel/block/adjust) requieren confirmed:true — el LLM debe pedir confirmación verbal antes.

import { assertReservationFitsCapacity } from '../../../shared/usecases/reservation-capacity'

/**
 * Puerto de cancelación hacia `reservas` (lo cablea `connectors/ai-gerente-reservas.ts`).
 * `ai-gerente` NO puede importar `reservas` → tipo estructural.
 *
 * Antes la tool hacía `reservationRepo.update(id, {status:'cancelled'})`: sin política, sin
 * snapshot financiero y sin el evento `onReservationCancelled` que libera el depósito retenido.
 */
export type ReservationCancelPort = (
  reservationId: string,
  hotelId: string,
  reason: string,
) => Promise<{ ok: boolean; error?: string; idempotent?: boolean; refundAmount?: number; cancellationFee?: number }>

export interface ToolRepos {
  reservationRepo: any
  roomRepo: any
  hotelRepo: any
  guestRepo: any
  /** Cancelación real vía el módulo reservas. Ausente = la tool no puede cancelar (falla explícito). */
  cancelReservation?: ReservationCancelPort
  /** `Configuration` (child_policy / room_type_capacity) — auditoría de integridad, 2026-09-04:
   *  `create_reservation` lo necesita para validar capacidad antes de crear (`shared/usecases/
   *  reservation-capacity.ts`), reutilizando exactamente lo que ya usa el flujo público. */
  configRepo?: any
}

const DAY_MS = 86_400_000

/** Disponibilidad real de una room en un rango (anti-overbooking, en memoria — ver mem 1529). */
async function isRoomFree(reservationRepo: any, roomId: string, checkIn: string, checkOut: string): Promise<boolean> {
  const all = await reservationRepo.findMany({ roomId }).catch(() => [])
  const reservations = Array.isArray(all) ? all : (all?.data || [])
  return !reservations.some((r: any) =>
    r.status !== 'cancelled' && new Date(r.checkIn) < new Date(checkOut) && new Date(r.checkOut) > new Date(checkIn),
  )
}

/** Lista de rooms libres de un tipo en un rango. */
async function availableRooms(roomRepo: any, reservationRepo: any, hotelId: string, roomType: string | undefined, checkIn: string, checkOut: string) {
  const filter: any = { hotelId }
  if (roomType) filter.type = roomType
  const allRooms = await roomRepo.findMany(filter).catch(() => [])
  const rooms = Array.isArray(allRooms) ? allRooms : (allRooms?.data || [])
  const out: any[] = []
  for (const r of rooms) if (await isRoomFree(reservationRepo, r.id, checkIn, checkOut)) out.push(r)
  return out
}

// ─── Definición de tools (formato OpenAI function calling) ──────────────
export const MANAGER_TOOLS = [
  { type: 'function', function: { name: 'search_availability', description: 'Buscar habitaciones libres en un rango de fechas.', parameters: { type: 'object', properties: { checkIn: { type: 'string', description: 'YYYY-MM-DD' }, checkOut: { type: 'string', description: 'YYYY-MM-DD' }, roomType: { type: 'string', description: 'single | double | suite | family (opcional)' } }, required: ['checkIn', 'checkOut'] } } },
  { type: 'function', function: { name: 'create_reservation', description: 'Crear una reserva. Si no hay roomId, pasar roomType y se asigna la primera libre.', parameters: { type: 'object', properties: { roomId: { type: 'string' }, roomType: { type: 'string' }, checkIn: { type: 'string' }, checkOut: { type: 'string' }, guestName: { type: 'string' }, guestEmail: { type: 'string' }, guestPhone: { type: 'string' }, adults: { type: 'number' } }, required: ['checkIn', 'checkOut', 'guestName'] } } },
  { type: 'function', function: { name: 'cancel_reservation', description: 'Cancelar una reserva. Requiere confirmación previa del gerente (confirmed:true).', parameters: { type: 'object', properties: { reservationId: { type: 'string' }, confirmed: { type: 'boolean', description: 'true solo si el gerente confirmó explícitamente' } }, required: ['reservationId'] } } },
  { type: 'function', function: { name: 'block_room', description: 'Bloquear una habitación (mantenimiento/cierre). Crea una reserva tipo bloqueo que la ocupa en el calendario. Requiere confirmación.', parameters: { type: 'object', properties: { roomId: { type: 'string' }, checkIn: { type: 'string' }, checkOut: { type: 'string' }, reason: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['roomId', 'checkIn', 'checkOut', 'reason'] } } },
  { type: 'function', function: { name: 'adjust_room_rate', description: 'Ajustar el precio base de una habitación (delta porcentual). Requiere confirmación.', parameters: { type: 'object', properties: { roomId: { type: 'string' }, roomType: { type: 'string' }, deltaPercent: { type: 'number', description: 'Ej: 10 sube 10%, -15 baja 15%' }, confirmed: { type: 'boolean' } }, required: ['deltaPercent'] } } },
  { type: 'function', function: { name: 'checkin_guest', description: 'Hacer check-in de una reserva (status → checked_in).', parameters: { type: 'object', properties: { reservationId: { type: 'string' } }, required: ['reservationId'] } } },
  { type: 'function', function: { name: 'checkout_guest', description: 'Hacer check-out de una reserva (status → checked_out).', parameters: { type: 'object', properties: { reservationId: { type: 'string' } }, required: ['reservationId'] } } },
  { type: 'function', function: { name: 'list_arrivals', description: 'Listar llegadas (check-in) de una fecha.', parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD (default: hoy)' } } } } },
  { type: 'function', function: { name: 'list_departures', description: 'Listar salidas (check-out) de una fecha.', parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD (default: hoy)' } } } } },
]

/** Ejecuta una tool administrativa. Devuelve { ok, ...datos } o { error } o { requiresConfirmation, preview }. */
/** findById + guard de tenant (IA-A3): una tool del Gerente IA solo puede tocar reservas de SU
 *  hotel. El reservationId lo dicta el LLM; sin este guard, una inyección escribía (cancel/checkin/
 *  checkout) sobre reservas de otro hotel. */
async function ownedReservation(reservationRepo: any, id: unknown, hotelId: string): Promise<any | null> {
  if (!id) return null
  const r = await reservationRepo.findById(id as string)
  return r && r.hotelId === hotelId ? r : null
}

export async function executeManagerTool(name: string, args: Record<string, unknown>, hotelId: string, repos: ToolRepos): Promise<Record<string, unknown>> {
  const { reservationRepo, roomRepo } = repos
  const today = new Date().toISOString().split('T')[0]

  switch (name) {
    case 'search_availability': {
      const free = await availableRooms(roomRepo, reservationRepo, hotelId, args.roomType as string, args.checkIn as string, args.checkOut as string)
      return { ok: true, count: free.length, rooms: free.map((r: any) => ({ id: r.id, number: r.number, type: r.type, price: r.basePrice ?? r.price })) }
    }

    case 'create_reservation': {
      let roomId = args.roomId as string
      const checkIn = args.checkIn as string, checkOut = args.checkOut as string
      if (!checkIn || !checkOut) return { error: 'Faltan checkIn y checkOut' }
      if (!roomId) {
        const free = await availableRooms(roomRepo, reservationRepo, hotelId, args.roomType as string, checkIn, checkOut)
        if (free.length === 0) return { error: `No hay habitaciones ${args.roomType || ''} libres del ${checkIn} al ${checkOut}` }
        roomId = free[0].id
      } else if (!(await isRoomFree(reservationRepo, roomId, checkIn, checkOut))) {
        return { error: `La habitación ${roomId} no está libre en esas fechas` }
      }
      const room = await roomRepo.findById(roomId)
      // Auditoría de integridad (cierre, 2026-09-04) — el Gerente IA escribía directo con
      // `reservationRepo.create`, sin ningún chequeo de capacidad (a diferencia del panel y del
      // motor público). Mismo criterio que ambos, reutilizado sin copiar reglas: sin edad por
      // niño acá (la tool no las pide), así que el conservador de `resolveAdminCapacityComposition`
      // decide — un niño sin edad conocida SIEMPRE consume plaza.
      const adults = (args.adults as number) || 2
      await assertReservationFitsCapacity(repos.configRepo, room, { hotelId, adults, children: 0, childrenAges: [] })
      const nights = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / DAY_MS)
      const total = (room?.basePrice ?? room?.price ?? 0) * Math.max(1, nights)
      // Resolver huésped: buscar por nombre, o crear si no existe (Reservations usa guestId FK a guests).
      const guestName = (args.guestName as string) || 'Guest'
      const foundGuests = await repos.guestRepo.findMany({ hotelId, name: guestName }).catch(() => [])
      let guestId = (Array.isArray(foundGuests) ? foundGuests : (foundGuests?.data || []))[0]?.id
      if (!guestId) {
        const g = await repos.guestRepo.create({ id: crypto.randomUUID(), hotelId, name: guestName, email: (args.guestEmail as string) || '', phone: (args.guestPhone as string) || '' } as any)
        guestId = g?.id
      }
      const reservation = await reservationRepo.create({
        id: crypto.randomUUID(), hotelId, roomId, guestId,
        checkIn, checkOut, adults, status: 'confirmed', totalAmount: total, createdAt: new Date().toISOString(),
      } as any)
      return { ok: true, reservationId: reservation.id, guestId, roomId, nights, totalAmount: total }
    }

    case 'cancel_reservation': {
      const r = await ownedReservation(reservationRepo, args.reservationId, hotelId)
      if (!r) return { error: 'Reserva no encontrada' }
      if (!args.confirmed) {
        // Reservations no tiene guestName (mem 1805) — resolver vía guestId → Guests.
        const g = r.guestId ? await repos.guestRepo.findById(r.guestId).catch(() => null) : null
        return { requiresConfirmation: true, action: 'cancel_reservation', reservationId: args.reservationId, guestName: g?.name, status: r.status, preview: `Cancelar la reserva de ${g?.name || args.reservationId}` }
      }
      if (!repos.cancelReservation) return { error: 'No puedo cancelar reservas en este momento (puerto no cableado).' }
      // Cancelación REAL vía el módulo reservas: política del hotel + snapshot financiero +
      // onReservationCancelled (libera el depósito retenido). `hotel-policy` porque la cancela
      // el hotel sobre una reserva propia — mismo efecto que hacerlo desde el panel.
      const out = await repos.cancelReservation(String(args.reservationId), hotelId, 'Cancelada por el gerente vía Gerente IA')
      if (!out.ok) return { error: out.error || 'No se pudo cancelar la reserva' }
      return {
        ok: true, reservationId: args.reservationId, status: 'cancelled',
        idempotent: out.idempotent === true, refundAmount: out.refundAmount, cancellationFee: out.cancellationFee,
      }
    }

    case 'block_room': {
      const { roomId, checkIn, checkOut, reason } = args as any
      if (!args.confirmed) return { requiresConfirmation: true, action: 'block_room', roomId, checkIn, checkOut, reason, preview: `Bloquear habitación ${roomId} del ${checkIn} al ${checkOut} (${reason})` }
      // Reservations no tiene campo `guestName` (mem 1805) — el label del bloqueo va en `notes`.
      const block = await reservationRepo.create({ id: crypto.randomUUID(), hotelId, roomId, notes: `[BLOQUEO] ${reason}`, checkIn, checkOut, status: 'blocked', totalAmount: 0, createdAt: new Date().toISOString() } as any)
      return { ok: true, blockId: block.id, roomId }
    }

    case 'adjust_room_rate': {
      const delta = Number(args.deltaPercent) || 0
      const filter: any = { hotelId }
      if (args.roomId) filter.id = args.roomId
      if (args.roomType) filter.type = args.roomType
      const all = await roomRepo.findMany(filter).catch(() => [])
      const rooms = Array.isArray(all) ? all : (all?.data || [])
      const previewRooms = rooms.map((r: any) => ({ id: r.id, number: r.number, old: r.basePrice ?? r.price, new: Math.round((r.basePrice ?? r.price ?? 0) * (1 + delta / 100)) }))
      if (!args.confirmed) return { requiresConfirmation: true, action: 'adjust_room_rate', deltaPercent: delta, affects: previewRooms.length, previewRooms, preview: `Cambiar precio de ${rooms.length} habitación(es) en ${delta > 0 ? '+' : ''}${delta}%` }
      for (const r of rooms) await roomRepo.update(r.id, { basePrice: Math.round((r.basePrice ?? r.price ?? 0) * (1 + delta / 100)) } as any)
      return { ok: true, updated: rooms.length, deltaPercent: delta }
    }

    case 'checkin_guest': {
      if (!(await ownedReservation(reservationRepo, args.reservationId, hotelId))) return { error: 'Reserva no encontrada' }
      const updated = await reservationRepo.update(args.reservationId, { status: 'checked_in' } as any)
      return updated ? { ok: true, reservationId: args.reservationId, status: 'checked_in' } : { error: 'Reserva no encontrada' }
    }

    case 'checkout_guest': {
      if (!(await ownedReservation(reservationRepo, args.reservationId, hotelId))) return { error: 'Reserva no encontrada' }
      const updated = await reservationRepo.update(args.reservationId, { status: 'checked_out' } as any)
      return updated ? { ok: true, reservationId: args.reservationId, status: 'checked_out' } : { error: 'Reserva no encontrada' }
    }

    case 'list_arrivals': {
      const date = (args.date as string) || today
      const all = await reservationRepo.findMany({ hotelId }).catch(() => [])
      const arrivals = (Array.isArray(all) ? all : (all?.data || [])).filter((r: any) => r.checkIn === date && r.status !== 'cancelled')
      // guestName vía guestId → Guests (Reservations no tiene el campo, mem 1805).
      const gArr = await repos.guestRepo.findMany({ hotelId }).catch(() => [])
      const gByIdArr = new Map((Array.isArray(gArr) ? gArr : (gArr?.data || [])).map((g: any) => [g.id, g.name]))
      return { ok: true, date, count: arrivals.length, arrivals: arrivals.map((r: any) => ({ id: r.id, guestName: gByIdArr.get(r.guestId) || null, roomId: r.roomId })) }
    }

    case 'list_departures': {
      const date = (args.date as string) || today
      const all = await reservationRepo.findMany({ hotelId }).catch(() => [])
      const departures = (Array.isArray(all) ? all : (all?.data || [])).filter((r: any) => r.checkOut === date && r.status !== 'cancelled')
      // guestName vía guestId → Guests (Reservations no tiene el campo, mem 1805).
      const gDep = await repos.guestRepo.findMany({ hotelId }).catch(() => [])
      const gByIdDep = new Map((Array.isArray(gDep) ? gDep : (gDep?.data || [])).map((g: any) => [g.id, g.name]))
      return { ok: true, date, count: departures.length, departures: departures.map((r: any) => ({ id: r.id, guestName: gByIdDep.get(r.guestId) || null, roomId: r.roomId })) }
    }

    default:
      return { error: `Tool desconocida: ${name}` }
  }
}
