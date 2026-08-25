// auditlog/types.ts — DTOs y tipos de queries (generado desde model.ts).
// Responsabilidad ÚNICA: contrato TypeScript del módulo. El schema de DB vive en ./model.ts.

export interface AuditlogDTO {
  id: string
  hotelId?: string
  userId?: string
  userName?: string
  action: string
  entity?: string
  entityId?: string
  detail?: string
  ip?: string
  createdAt: string
  updatedAt: string
}

export interface CreateAuditlogDTO {
  hotelId?: string
  userId?: string
  userName?: string
  action: string
  entity?: string
  entityId?: string
  detail?: string
  ip?: string
}

export interface UpdateAuditlogDTO {
  hotelId?: string
  userId?: string
  userName?: string
  action?: string
  entity?: string
  entityId?: string
  detail?: string
  ip?: string
}

// ─── Consultas ─────────────────────────────────────────
export interface AuditlogQuery {
  hotelId?: string
  status?: string
  type?: string
  category?: string
  search?: string
  /** Filtros del panel (/panel/config/auditoria, M3 qa-ui config-2026-08-22). */
  userId?: string
  action?: string
  /** Rango de fechas ISO (YYYY-MM-DD), límites inclusive. */
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface AuditlogPaginated {
  data: AuditlogDTO[]
  total: number
}
