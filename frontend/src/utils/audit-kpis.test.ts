// audit-kpis.test.ts — #137: los KPIs de /admin/audit salen del log, no del HTML.
import { describe, it, expect } from 'vitest'
import { auditKpis, isAccessEvent, todayUtc } from './audit-kpis'

const HOY = '2026-09-11'

describe('auditKpis (#137)', () => {
  it('con N eventos de hoy muestra exactamente N; 0 si no hubo', () => {
    expect(auditKpis([], HOY).eventsToday).toBe(0)
    const rows = [
      { date: HOY, actionKey: 'reservation.create', entity: 'reservation' },
      { date: HOY, actionKey: 'user.delete', entity: 'user' },
      { date: '2026-09-09', actionKey: 'reservation.create', entity: 'reservation' },
    ]
    expect(auditKpis(rows, HOY).eventsToday).toBe(2)
  })

  it('logins = solo los accesos auditados DE HOY (auth.* / entidad auth), nunca un fijo', () => {
    const rows = [
      { date: HOY, actionKey: 'auth.impersonate', entity: 'user' },
      { date: HOY, actionKey: 'login', entity: 'auth' },
      { date: '2026-09-09', actionKey: 'auth.impersonate', entity: 'user' }, // ayer: no cuenta
      { date: HOY, actionKey: 'reservation.create', entity: 'reservation' },
    ]
    expect(auditKpis(rows, HOY).loginsToday).toBe(2)
    expect(auditKpis([{ date: HOY, actionKey: 'reservation.create' }], HOY).loginsToday).toBe(0)
  })

  it('total y fecha del registro más viejo = la ventana real del log, no "90 días"', () => {
    const k = auditKpis([
      { date: '2026-09-09' }, { date: '2026-07-03' }, { date: HOY }, { date: '' },
    ], HOY)
    expect(k.total).toBe(4)
    expect(k.oldestDate).toBe('2026-07-03')
    expect(auditKpis([], HOY).oldestDate).toBe('')
  })

  it('isAccessEvent reconoce auth.* y entidad auth, e ignora el resto', () => {
    expect(isAccessEvent({ actionKey: 'auth.impersonate', entity: 'user' })).toBe(true)
    expect(isAccessEvent({ actionKey: 'x', entity: 'auth' })).toBe(true)
    expect(isAccessEvent({ actionKey: 'invoice.pay', entity: 'invoice' })).toBe(false)
  })

  it('todayUtc usa el huso del backend (UTC)', () => {
    expect(todayUtc(new Date('2026-09-11T03:00:00.000Z'))).toBe('2026-09-11')
    expect(todayUtc(new Date('2026-09-10T23:59:59.000Z'))).toBe('2026-09-10')
  })
})
