import { http } from './http'
import type { Room, RoomType, RoomStatus } from '@/types'

interface RawRoom {
  id: string
  hotelId: string
  number: string
  name?: string
  type: string
  basePrice: number
  status: string
  capacity: number
  maxAdults?: number
  maxChildren?: number
  floor: number
  surfaceArea?: number
  bathrooms?: number
  onlineBookingEnabled?: boolean
  // #648 — solo vienen cuando el request mandó checkIn/checkOut.
  available?: boolean
  unavailableReason?: string
}

// A-2 (2026-08-19): mapa 1:1 con el enum del backend — antes colapsaba twin→double y
// triple/quad→family al LEER, y al guardar ese tipo migrado el backend lo rechazaba
// (round-trip corrupto: editar una triple sin tocar el tipo ya rompía el PUT).
const ROOM_TYPE_MAP: Record<string, RoomType> = {
  single: 'single', sencilla: 'single', individual: 'single', simple: 'single',
  double: 'double', doble: 'double',
  twin: 'twin',
  triple: 'triple',
  quad: 'quad', cuadruple: 'quad',
  suite: 'suite',
  deluxe: 'deluxe',
  presidential: 'presidential',
  family: 'family', familiar: 'family',
  villa: 'villa',
  dorm: 'dorm', compartida: 'dorm',
}

const ROOM_STATUS_MAP: Record<string, RoomStatus> = {
  disponible: 'available', available: 'available',
  ocupada: 'occupied', occupied: 'occupied',
  pendiente: 'pending', pending: 'pending',
  limpieza: 'cleaning', cleaning: 'cleaning', 'en limpieza': 'cleaning',
  'fuera de servicio': 'out_of_service', out_of_service: 'out_of_service', 'mantenimiento': 'out_of_service',
  out_of_order: 'out_of_service', maintenance: 'out_of_service',
}

export function mapRoom(r: RawRoom): Room {
  return {
    id: r.id,
    hotelId: r.hotelId,
    number: r.number,
    name: r.name,
    type: ROOM_TYPE_MAP[r.type?.toLowerCase()] ?? 'double',
    floor: r.floor,
    status: ROOM_STATUS_MAP[r.status?.toLowerCase()] ?? 'available',
    amenities: [],
    maxGuests: r.capacity,
    maxAdults: r.maxAdults ?? undefined,
    maxChildren: r.maxChildren ?? undefined,
    basePrice: r.basePrice,
    surfaceArea: r.surfaceArea,
    bathrooms: r.bathrooms,
    onlineBookingEnabled: r.onlineBookingEnabled !== false,
    available: r.available,
    unavailableReason: r.unavailableReason,
  }
}

interface RoomsResponse {
  data: RawRoom[]
  total: number
  tipos: string[]
  estados: string[]
}

export const RoomService = {
  async list(params?: { hotelId?: string; tipo?: string; estado?: string; type?: string; status?: RoomStatus; limit?: number; checkIn?: string; checkOut?: string }): Promise<{ rooms: Room[]; total: number }> {
    const qs = new URLSearchParams()
    if (params?.hotelId) qs.set('hotelId', params.hotelId)
    if (params?.type) qs.set('tipo', params.type)
    else if (params?.tipo) qs.set('tipo', params.tipo)
    if (params?.status) qs.set('estado', params.status)
    else if (params?.estado) qs.set('estado', params.estado)
    if (params?.limit) qs.set('limit', String(params.limit))
    // #648 — disponibilidad por rango de fechas: el backend anota `available`/`unavailableReason`
    // por habitación cuando ambos vienen. Sin ambos, el backend se comporta igual que antes.
    if (params?.checkIn) qs.set('checkIn', params.checkIn)
    if (params?.checkOut) qs.set('checkOut', params.checkOut)
    const query = qs.toString()
    const data = await http.get<RoomsResponse>(`/habitaciones${query ? `?${query}` : ''}`)
    return { rooms: data.data.map(mapRoom), total: data.total }
  },

  async create(input: Partial<Room> & { hotelId: string }): Promise<Room> {
    const body = {
      number: input.number,
      name: input.name,
      type: input.type,
      basePrice: input.basePrice,
      hotelId: input.hotelId,
      capacity: input.maxGuests ?? 2,
      ...(input.maxAdults != null ? { maxAdults: input.maxAdults } : {}),
      ...(input.maxChildren != null ? { maxChildren: input.maxChildren } : {}),
      floor: input.floor ?? 1,
      surfaceArea: input.surfaceArea ?? 0,
      bathrooms: input.bathrooms ?? 1,
      onlineBookingEnabled: input.onlineBookingEnabled !== false,
    }
    const data = await http.post<RawRoom>('/habitaciones', body)
    return mapRoom(data)
  },

  async update(id: string, patch: Partial<Room>): Promise<Room> {
    const body: Record<string, unknown> = {}
    if (patch.number !== undefined) body.number = patch.number
    if (patch.name !== undefined) body.name = patch.name
    if (patch.type !== undefined) body.type = patch.type
    if (patch.basePrice !== undefined) body.basePrice = patch.basePrice
    if (patch.maxGuests !== undefined) body.capacity = patch.maxGuests
    if (patch.maxAdults !== undefined) body.maxAdults = patch.maxAdults
    if (patch.maxChildren !== undefined) body.maxChildren = patch.maxChildren
    if (patch.floor !== undefined) body.floor = patch.floor
    if (patch.surfaceArea !== undefined) body.surfaceArea = patch.surfaceArea
    if (patch.bathrooms !== undefined) body.bathrooms = patch.bathrooms
    if (patch.onlineBookingEnabled !== undefined) body.onlineBookingEnabled = patch.onlineBookingEnabled
    if (patch.status !== undefined) {
      // El backend exige status en inglés (enum): available, occupied, maintenance, cleaning, out_of_order, reserved.
      // La UI usa 'dirty' (→cleaning) y 'out_of_service' (→out_of_order); el resto pasa igual (ya es inglés).
      const s = patch.status as string
      body.status = s === 'dirty' ? 'cleaning'
        : s === 'out_of_service' ? 'out_of_order'
        : patch.status
    }
    const data = await http.put<RawRoom>(`/habitaciones/${id}`, body)
    return mapRoom(data)
  },

  async delete(id: string): Promise<void> {
    return http.delete(`/habitaciones/${id}`)
  },

  async batchCreate(input: {
    hotelId: string
    type: string
    basePrice: number
    from: number
    to: number
    floor?: number
    capacity?: number
    bathrooms?: number
    surfaceArea?: number
    onlineBookingEnabled?: boolean
  }): Promise<{ data: RawRoom[]; total: number }> {
    return http.post('/habitaciones/batch', input)
  },
}
