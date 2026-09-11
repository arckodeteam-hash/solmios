// shared/utils/business-date.ts — "Día contable" de un instante en la zona del hotel (#213).
//
// Por qué existe: el ORM del framework solo arma igualdades en el WHERE (`buildWhere`, sin rangos ni
// IN). Un reporte "del día" no puede pedir `closedAt BETWEEN`: o trae el histórico entero y corta en
// memoria, o guarda el día como VALOR en una columna (`businessDate = 'YYYY-MM-DD'`) y consulta por
// igualdad — un día = una consulta, un rango = N consultas. Esto es lo segundo.
//
// El día se calcula en la zona del hotel, no en UTC: medianoche UTC son las 20:00 en Santo Domingo, y
// la cena de las 21:30 tiene que caer en el cierre de HOY. Misma regla que hotel-schedule.ts.
//
// Lo usan: restaurant (comandas al cerrar/cobrar/cancelar), payments (al crear y al completarse un
// cobro) y el backfill de migrate-db.ts para las filas anteriores a la columna.

/** Fecha ('YYYY-MM-DD') y hora (0-23) de un instante en `timeZone`. Null si el instante no es válido. */
export function localDateHour(at: string | Date, timeZone: string): { date: string; hour: number } | null {
  const t = at instanceof Date ? at.getTime() : Date.parse(at)
  if (!Number.isFinite(t)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(new Date(t))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

/** Día contable ('YYYY-MM-DD') de un instante en la zona del hotel. Null si el instante no es válido. */
export function businessDateOf(at: string | Date, timeZone: string): string | null {
  return localDateHour(at, timeZone)?.date ?? null
}
