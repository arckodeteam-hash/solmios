// facturas/usecases/audit.ts — Puerto de auditoría contable.
// El módulo facturas NO importa auditlog: declara el puerto y el connector
// `facturas-auditlog` inyecta la implementación (ver src/connectors/).
//
// Auditar nunca puede tumbar la operación de negocio: si el registro falla, se loguea
// como error y la factura/cobro sigue su curso. Un audit log caído no debe impedir cobrar.

import type { Logger } from 'arckode-framework'

export type AuditAction =
  | 'invoice.create'
  | 'invoice.pay'
  | 'invoice.delete'
  | 'invoice.credit_note'
  | 'invoice.email'
  /** #253 — factura emitida desde la reserva (sin folio), vinculando pagos existentes. */
  | 'invoice.issued_from_reservation'

export interface AuditEntry {
  hotelId?: string
  userId?: string
  action: AuditAction
  entityId: string
  detail?: string
}

export interface AuditPort {
  record(entry: AuditEntry): Promise<void>
}

/** Registra la entrada si hay puerto conectado. Absorbe cualquier fallo del audit log. */
export async function auditSafely(
  port: AuditPort | null,
  logger: Logger,
  entry: AuditEntry,
): Promise<void> {
  if (!port) return
  try {
    await port.record(entry)
  } catch (e) {
    logger.error('No se pudo registrar la auditoría de facturación', {
      action: entry.action,
      entityId: entry.entityId,
      error: (e as Error).message,
    } as any)
  }
}
