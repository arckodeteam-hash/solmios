// services/Caja.service.ts — API client para el módulo Caja (canónico).
// method SIEMPRE en inglés (cash|card|transfer|link|other) — el backend lo persiste así.
import { http } from './http'

export interface CashMovement {
  id?: string
  type: 'income' | 'expense' | 'opening' | 'closing'
  amount: number
  method?: 'cash' | 'card' | 'transfer' | 'link' | 'other'
  concept?: string
  category?: string
  source?: string           // manual | payment_connector | migrated
  guestName?: string
  roomNumber?: string
  reservationId?: string
  folioId?: string
  reference?: string
  notes?: string
  shiftId?: string | null
  createdAt?: string
}

export interface CashShift {
  id: string
  status: 'open' | 'closed'
  openingAmount: number
  countedAmount?: number
  expectedAmount?: number
  difference?: number
  openedBy?: string
  closedBy?: string
  openedAt?: string
  closedAt?: string
}

export interface CashStats { today: number; week: number; month: number; count: number; byMethod: Record<string, number> }
export interface MovementList { data: CashMovement[]; total: number; pages: number; hasNext: boolean; hasPrev: boolean }
export interface Reconcile {
  opening: number; income: number; expense: number
  expected: number; counted: number; difference: number; byMethod: Record<string, number>
  /** Neto firmado por método (ingreso +, egreso −) — esperado por método para el arqueo de cierre. */
  byMethodNet: Record<string, number>
}

// ─── Histórico de turnos (auditoría: quién cerró, diferencias, neto por método) ───
export interface ShiftHistoryRow extends CashShift {
  notes?: string
  denominations?: string
  byMethodNet: Record<string, number>
}
/** Lo que llega del http client: el envelope paginado del framework ({data} + meta.pagination)
 *  se aplana a {data, total} — pages se calcula en la vista con el limit conocido. */
export interface ShiftHistory {
  data: ShiftHistoryRow[]
  total: number
}

// Fábrica: recepción (`/caja`) y restaurante (`/caja/restaurant`) son el MISMO cliente, apuntado
// a la ruta scopeada por punto de venta — el backend ya separa el turno/movimientos por `register`,
// acá solo evitamos duplicar el archivo entero para 2 base paths.
function makeCajaService(base: string) {
  return {
    movements: (params: Record<string, string | number> = {}) => {
      const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join('&')
      return http.get<MovementList>(`${base}/movements${qs ? '?' + qs : ''}`)
    },
    createMovement: (data: Partial<CashMovement>) => http.post<CashMovement>(`${base}/movements`, data),
    updateMovement: (id: string, data: Partial<CashMovement>) => http.put<CashMovement>(`${base}/movements/${id}`, data),
    removeMovement: (id: string) => http.delete<{ success: boolean }>(`${base}/movements/${id}`),
    currentShift: () => http.get<CashShift | null>(`${base}/shifts/current`),
    openShift: (openingAmount: number) => http.post<CashShift>(`${base}/shifts/open`, { openingAmount }),
    // `notes` = motivo del arqueo: el backend lo EXIGE cuando la diferencia sale del centavo de
    // tolerancia (QA-UI caja-2026-08-22 H2/M6) — sin motivo responde 400 con el mensaje en español.
    closeShift: (id: string, countedAmount: number, notes?: string, denominations?: string) =>
      http.post<CashShift>(`${base}/shifts/${id}/close`, { countedAmount, denominations, notes }),
    // Histórico de turnos: filtra por fecha de apertura (from/to YYYY-MM-DD) y pagina.
    shifts: (params: Record<string, string | number> = {}) => {
      const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join('&')
      return http.get<ShiftHistory>(`${base}/shifts${qs ? '?' + qs : ''}`)
    },
    reconcile: (id: string) => http.get<Reconcile>(`${base}/shifts/${id}/reconcile`),
    stats: () => http.get<CashStats>(`${base}/stats`),
  }
}

export const CajaService = makeCajaService('/caja')
export const RestaurantCajaService = makeCajaService('/caja/restaurant')
