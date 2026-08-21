// reservas/tests/money-port.test.ts — El camino reserva → dinero pasa por el puerto, no por el ORM.
//
// `usecases/reservas-queries.ts` leía `Folios`, `Invoices` y `Payment` con `orm.findMany` directo:
// tres tablas de tres módulos ajenos, contra la regla que `usecases/message-log.ts` escribe textual
// ("nunca acceso directo a otro módulo — va por conector"). Ahora leen los dueños y el resultado
// llega por `usecases/money-port.ts`, cableado en `connectors/reservas-money.ts`.

import { describe, it, expect } from 'bun:test'
import { ReservasQueries } from '../usecases/reservas-queries'
import { buildReservationMoneyPort, paidReposFrom, requireMoneyPort, type MoneyOwners } from '../usecases/money-port'

/** ORM que explota: si algo del camino del dinero lo toca, el test lo delata. */
const ormProhibido = {
  findMany: (model: string) => { throw new Error(`acceso directo al ORM: ${model}`) },
  findById: async () => null,
  create: async (d: any) => d,
  update: async () => {},
}

function owners(over: Partial<MoneyOwners> = {}): MoneyOwners {
  return {
    folios: { foliosOfReservation: async () => [{ id: 'f1' }], reservationIdOfFolio: async () => 'r-folio' },
    facturas: { invoicesOfReservation: async () => [{ id: 'inv1' }], reservationIdOfInvoice: async () => 'r-invoice' },
    payments: { paymentsLinkedTo: async () => [{ id: 'p1' }] },
    ...over,
  }
}

describe('requireMoneyPort', () => {
  it('sin puerto cableado rompe fuerte: devolver 0 en silencio es el bug GH-0.2', () => {
    expect(() => requireMoneyPort(null)).toThrow(/falta el puerto de dinero/)
    expect(() => requireMoneyPort(undefined)).toThrow(/reservas-money no cableado/)
  })
})

describe('ReservasQueries · el dinero NO sale del ORM', () => {
  it('paidRepos consulta a los módulos dueños, nunca a orm.findMany', async () => {
    const q = new ReservasQueries(ormProhibido)
    q.setMoneyPort(buildReservationMoneyPort(owners()))
    const repos = q.paidRepos
    expect(await repos.folioRepo.findMany({ hotelId: 'h1', reservationId: 'r1' })).toEqual([{ id: 'f1' }])
    expect(await repos.invoiceRepo.findMany({ hotelId: 'h1', reservationId: 'r1' })).toEqual([{ id: 'inv1' }])
    expect(await repos.paymentRepo.findMany({ hotelId: 'h1', folioId: 'f1' })).toEqual([{ id: 'p1' }])
  })

  it('sin puerto, pedir el dinero rompe en vez de leer tablas ajenas', () => {
    const q = new ReservasQueries(ormProhibido)
    expect(() => q.paidRepos).toThrow(/falta el puerto de dinero/)
  })

  it('el resto de las consultas del módulo siguen usando el ORM (no se rompió nada más)', async () => {
    const q = new ReservasQueries({ ...ormProhibido, findMany: async () => [{ id: 'c1' }] })
    expect(await q.getCompanions('r1')).toEqual([{ id: 'c1' }])
  })
})

describe('paidReposFrom · multi-tenancy', () => {
  it('una lectura sin hotelId rompe: leería las filas de TODOS los hoteles', async () => {
    const repos = paidReposFrom(buildReservationMoneyPort(owners()))
    await expect(repos.folioRepo.findMany({ reservationId: 'r1' } as any)).rejects.toThrow(/sin hotelId/)
    await expect(repos.invoiceRepo.findMany({ reservationId: 'r1' } as any)).rejects.toThrow(/sin hotelId/)
    await expect(repos.paymentRepo.findMany({ folioId: 'f1' } as any)).rejects.toThrow(/sin hotelId/)
  })

  it('propaga el hotelId y el vínculo tal como llegan', async () => {
    const vistos: any[] = []
    const port = buildReservationMoneyPort(owners({
      payments: { paymentsLinkedTo: async (h, ref) => { vistos.push([h, ref]); return [] } },
    }))
    await paidReposFrom(port).paymentRepo.findMany({ hotelId: 'h9', invoiceId: 'inv7' } as any)
    expect(vistos[0][0]).toBe('h9')
    expect(vistos[0][1]).toMatchObject({ invoiceId: 'inv7' })
  })
})

describe('reservationIdOf · camino inverso (COR-1)', () => {
  it('el vínculo DIRECTO gana: es el único que tiene el cobro de una reprogramación', async () => {
    const port = buildReservationMoneyPort(owners())
    expect(await port.reservationIdOf('h1', { reservationId: 'r-directo', folioId: 'f1' })).toBe('r-directo')
  })

  it('sin vínculo directo cae al folio, y sin folio a la factura', async () => {
    const port = buildReservationMoneyPort(owners())
    expect(await port.reservationIdOf('h1', { folioId: 'f1' })).toBe('r-folio')
    expect(await port.reservationIdOf('h1', { invoiceId: 'inv1' })).toBe('r-invoice')
  })

  it('un folio de otro hotel no resuelve (el dueño devuelve null) y se prueba la factura', async () => {
    const port = buildReservationMoneyPort(owners({
      folios: { foliosOfReservation: async () => [], reservationIdOfFolio: async () => null },
    }))
    expect(await port.reservationIdOf('h1', { folioId: 'f1', invoiceId: 'inv1' })).toBe('r-invoice')
  })

  it('sin hotelId no se resuelve nada (cross-tenant)', async () => {
    const port = buildReservationMoneyPort(owners())
    expect(await port.reservationIdOf('', { reservationId: 'r1' })).toBeNull()
  })

  it('un movimiento sin ningún vínculo devuelve null, no una reserva al azar', async () => {
    const port = buildReservationMoneyPort(owners())
    expect(await port.reservationIdOf('h1', {})).toBeNull()
  })
})
