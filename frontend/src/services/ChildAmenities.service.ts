import { http } from './http'

/** Amenidades para niños/bebés (REQ-01, #233). Catálogo ABIERTO por hotel — a diferencia de
 *  `meal-plans` (3 códigos fijos), acá el admin da de alta lo que quiera (nombre libre + precio),
 *  edita, activa/desactiva y elimina. La cuna NO vive acá: sigue siendo el toggle Sí/No de
 *  `childPolicy.cribAvailable` en la página del motor de reservas.
 *  API: `/api/child-amenities` (admin, auth) — el widget lee las activas vía
 *  `GET /api/public/hotels/:slug/child-amenities` (sin auth). */
export interface ChildAmenity {
  id: string
  hotelId: string
  name: string
  /** Precio en la moneda del hotel. 0 = gratuita. */
  price: number
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateChildAmenityInput {
  name: string
  price: number
  active?: boolean
  sortOrder?: number
}

export interface UpdateChildAmenityInput {
  name?: string
  price?: number
  active?: boolean
  sortOrder?: number
}

const BASE = '/child-amenities'

export const ChildAmenitiesService = {
  async list(): Promise<ChildAmenity[]> {
    const res = await http.get<{ data: ChildAmenity[]; total: number }>(BASE)
    return res.data
  },

  create(input: CreateChildAmenityInput): Promise<ChildAmenity> {
    return http.post<ChildAmenity>(BASE, input)
  },

  update(id: string, input: UpdateChildAmenityInput): Promise<ChildAmenity> {
    return http.put<ChildAmenity>(`${BASE}/${id}`, input)
  },

  remove(id: string): Promise<{ id: string; deleted: true }> {
    return http.delete<{ id: string; deleted: true }>(`${BASE}/${id}`)
  },
}
