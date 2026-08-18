import { http } from './http'

/**
 * Proveedor de servicios — servicio externo de mantenimiento del hotel
 * (plomero, electricista, técnico A/C, etc.).
 * Los campos de BD/API van en inglés; la UI los rotula en español.
 */
export interface TechnicalProvider {
  id: string
  hotelId?: string
  name: string
  specialty?: string
  phone?: string
  email?: string
  address?: string
  /** Tarifa en texto libre, ej. "RD$1500 por visita" */
  rate?: string
  notes?: string
  /** CSV de días en inglés, ej. "mon,tue,wed,thu,fri" */
  workDays?: string
  /** "HH:mm" */
  workStart?: string
  /** "HH:mm" */
  workEnd?: string
  active?: boolean
  createdAt?: string
  updatedAt?: string
}

export type CreateTechnicalProviderInput = Omit<TechnicalProvider, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateTechnicalProviderInput = Partial<CreateTechnicalProviderInput>

const BASE = '/mantenimiento/proveedores'

function toList(res: unknown): TechnicalProvider[] {
  if (Array.isArray(res)) return res as TechnicalProvider[]
  const data = (res as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as TechnicalProvider[]) : []
}

export const TechnicalProvidersService = {
  /**
   * Por defecto el backend oculta los de baja. La vista de administración
   * (`/panel/operaciones/proveedores`) los gestiona — reactivar, catálogo
   * completo — y por eso pasa `includeInactive`.
   */
  async list(includeInactive = false): Promise<TechnicalProvider[]> {
    const res = await http.get<unknown>(includeInactive ? `${BASE}?includeInactive=1` : BASE)
    return toList(res)
  },

  create(input: CreateTechnicalProviderInput): Promise<TechnicalProvider> {
    return http.post<TechnicalProvider>(BASE, input)
  },

  update(id: string, input: UpdateTechnicalProviderInput): Promise<TechnicalProvider> {
    return http.put<TechnicalProvider>(`${BASE}/${id}`, input)
  },

  remove(id: string): Promise<void> {
    return http.delete<void>(`${BASE}/${id}`)
  },
}
