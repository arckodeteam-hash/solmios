import { describe, it, expect } from 'bun:test'
import { PaymentCrudUseCase } from '../usecases/payment-crud'

// El payload de creación es una allow-list explícita campo por campo: lo que no está ahí se
// descarta en silencio, aunque el modelo Y el DTO lo declaren. Así se perdía `createdBy` y el
// historial de cobros de la reserva mostraba todos los pagos sin responsable (2026-08-30).

function crud() {
  const created: any[] = []
  const repo: any = {
    create: async (row: any) => { const r = { id: 'p1', ...row }; created.push(r); return r },
    findMany: async () => [],
    findOne: async () => null,
    findById: async () => null,
    update: async () => ({}),
  }
  const log: any = { info() {}, warn() {}, error() {}, child: () => log }
  return { created, uc: new PaymentCrudUseCase(repo, log) }
}

const DTO: any = {
  hotelId: 'h1', type: 'charge', method: 'cash', status: 'completed',
  amount: 25.5, currency: 'USD', description: 'Cobro en recepción',
}

describe('quién registró el cobro', () => {
  it('persiste el usuario que lo cargó', async () => {
    const { created, uc } = crud()
    await uc.create({ ...DTO, createdBy: 'user-rosa' })
    expect(created[0].createdBy).toBe('user-rosa')
  })

  it('un cobro del sistema queda sin responsable, no con basura', async () => {
    const { created, uc } = crud()
    await uc.create({ ...DTO })
    expect(created[0].createdBy).toBe('')
  })

  it('no rompe el resto del payload', async () => {
    const { created, uc } = crud()
    await uc.create({ ...DTO, createdBy: 'u1' })
    expect(created[0].amount).toBe(25.5)
    expect(created[0].method).toBe('cash')
    expect(created[0].status).toBe('completed')
  })
})
