// cash/types.ts — DTOs y tipos de queries (contrato TypeScript del módulo).
// El schema de DB vive en ./model.ts — son conceptos distintos.

export type MovementType = 'income' | 'expense' | 'opening' | 'closing'
export type MovementMethod = 'cash' | 'card' | 'transfer' | 'link' | 'other'
export type ShiftStatus = 'open' | 'closed'
// Punto de venta físico dueño del turno/movimiento. reception = mostrador (default histórico,
// gate hotel_admin), restaurant = caja del POS (gate permiso `restaurant`). Cada uno solo ve/opera
// lo suyo — nunca se mezclan pagos de mesas con el cajón de recepción ni al revés.
export type CashRegister = 'reception' | 'restaurant'

export interface CashMovementDTO {
  id: string
  hotelId: string
  shiftId?: string | null
  register?: CashRegister
  type: MovementType
  amount: number
  method?: MovementMethod
  concept?: string
  category?: string
  source?: string
  guestName?: string
  roomNumber?: string
  reservationId?: string
  folioId?: string
  paymentId?: string
  expenseId?: string
  reference?: string
  createdBy?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface CreateMovementDTO {
  type: MovementType
  amount: number
  method?: MovementMethod
  concept?: string
  category?: string
  guestName?: string
  roomNumber?: string
  reservationId?: string
  folioId?: string
  reference?: string
  notes?: string
  // hotelId NUNCA del body — el service lo fuerza desde el JWT (P0 IDOR).
}

export interface UpdateMovementDTO {
  type?: MovementType
  amount?: number
  method?: MovementMethod
  concept?: string
  category?: string
  guestName?: string
  roomNumber?: string
  reference?: string
  notes?: string
}

export interface CashShiftDTO {
  id: string
  hotelId: string
  status: ShiftStatus
  register?: CashRegister
  openingAmount: number
  countedAmount?: number
  expectedAmount?: number
  difference?: number
  denominations?: string
  openedBy?: string
  closedBy?: string
  openedAt?: string
  closedAt?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface OpenShiftDTO {
  openingAmount?: number
  notes?: string
}

export interface CloseShiftDTO {
  countedAmount: number
  denominations?: string  // JSON string con conteo de billetes
  notes?: string
}

export interface MovementQuery {
  hotelId?: string
  register?: CashRegister
  shiftId?: string
  type?: MovementType
  method?: MovementMethod
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface CashPaginated {
  data: CashMovementDTO[]
  total: number
  limit: number
  offset: number
  pages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface ReconcileResult {
  shift: CashShiftDTO
  opening: number
  income: number
  expense: number
  expected: number
  counted: number
  difference: number
  byMethod: Record<string, number>
  /** Neto firmado por método (ingreso +, egreso −). Esperado por método para el arqueo de cierre. */
  byMethodNet: Record<string, number>
}

// ─── Histórico de turnos (auditoría: quién cerró, diferencias, totales por método) ───

/** Turno del histórico enriquecido con el desglose neto por método de sus movimientos. */
export interface ShiftHistoryRow extends CashShiftDTO {
  byMethodNet: Record<string, number>
}

export interface ShiftHistoryQuery {
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface ShiftHistoryPage {
  data: ShiftHistoryRow[]
  total: number
  page: number
  limit: number
  pages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface CashStats {
  today: number
  week: number
  month: number
  count: number
  byMethod: Record<string, number>
}

// Usuario autenticado extraído del JWT (req.user).
export interface CurrentUser {
  id: string
  hotelId?: string
  role: string
}
