// pages/restaurante/reportes-date.ts — Fechas del cierre del día en la zona del HOTEL (#213, auditoría).
// "Hoy" no es el del navegador: un gerente que mira desde otra zona (o con la hora del equipo mal)
// vería el cierre de otro día. La zona la trae el propio reporte (`timezone`, `hotels.timezone`).

/** 'YYYY-MM-DD' de ahora en una zona IANA (Intl). Sin zona o zona inválida → la del navegador. */
export function todayIn(timeZone: string | undefined, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const at = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    return `${at('year')}-${at('month')}-${at('day')}`
  } catch {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
}

/** Suma `n` días a una fecha 'YYYY-MM-DD' (aritmética de calendario, sin zona: la fecha ya es la del hotel). */
export function shiftDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
