// audit-kpis.ts — Los KPIs de /admin/audit se CALCULAN sobre el log cargado (#137).
//
// Antes eran cuatro literales en el HTML ("1,247 eventos hoy" con 0 eventos, "Retención: 90 días"
// sin ningún proceso de purga). Para un registro de auditoría, afirmar una política que no existe
// es una declaración de cumplimiento falsa. Acá no hay ningún número que no salga de las filas.
//
// "Errores" y "Retención" no vuelven: el audit log no registra errores (no existe el concepto en el
// modelo) y no hay retención (nada borra filas). En su lugar se muestra lo que sí es verdad: cuántos
// registros hay y desde cuándo.

export interface AuditKpiRow {
  /** Fecha del evento en `YYYY-MM-DD` (UTC, como la guarda `createdAt`). */
  date: string
  /** Acción cruda (`auth.impersonate`, `reservation.delete`, …). */
  actionKey?: string
  entity?: string
}

export interface AuditKpis {
  /** Filas con fecha de hoy. 0 si no hubo — nunca un número fijo. */
  eventsToday: number
  /** Accesos AUDITADOS de hoy: acciones `auth.*`/`login*` o entidad `auth`. El login común no se
   *  audita, así que este número es lo que el log sabe, no "cuánta gente entró". */
  loginsToday: number
  /** Total de filas cargadas. */
  total: number
  /** Fecha del registro más viejo (`YYYY-MM-DD`) o '' sin filas. Es la ventana REAL del log. */
  oldestDate: string
}

export function isAccessEvent(row: Pick<AuditKpiRow, 'actionKey' | 'entity'>): boolean {
  const action = String(row.actionKey ?? '').toLowerCase()
  const entity = String(row.entity ?? '').toLowerCase()
  return entity === 'auth' || action.startsWith('auth.') || action.startsWith('login')
}

/** `today` en `YYYY-MM-DD` (UTC): se inyecta para que el test no dependa del reloj. */
export function auditKpis(rows: ReadonlyArray<AuditKpiRow>, today: string): AuditKpis {
  let eventsToday = 0
  let loginsToday = 0
  let oldestDate = ''
  for (const r of rows) {
    const d = String(r.date ?? '').slice(0, 10)
    if (!d) continue
    if (d === today) {
      eventsToday++
      if (isAccessEvent(r)) loginsToday++
    }
    if (!oldestDate || d < oldestDate) oldestDate = d
  }
  return { eventsToday, loginsToday, total: rows.length, oldestDate }
}

/** Hoy en UTC, el mismo huso en el que `createdAt` llega del backend. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
