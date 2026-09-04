// reservas/tests/controller-childrenages.test.ts — Requerimiento 11 (Persistencia de la
// composición, 2026-09-03).
//
// FIX: `validators/schema.ts` documentaba (en un comentario) que el controller reincorporaba
// `childrenAges` crudo desde `req.body`, mismo patrón que `bookingengine` — pero esa
// reincorporación nunca se había escrito. Una reserva cargada a mano desde el panel
// (`/panel/reservas`, staff por teléfono/OTA) con edades de niños las perdía en silencio, porque
// el validador nativo de arckode-framework descarta `type:'array'` sin avisar.
import { describe, it, expect } from 'bun:test'
import { ReservasController } from '../controller'

function makeController(service: { create: (dto: any, user: any) => Promise<any>; update: (id: string, dto: any, user: any) => Promise<any> }) {
  return new ReservasController(
    service as any, { info() {}, warn() {}, error() {}, debug() {} } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any,
  )
}

const USER = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const BASE_CREATE_BODY = {
  hotelId: 'h1', roomId: 'r1', checkIn: '2026-10-01', checkOut: '2026-10-03',
  totalAmount: 200, adults: 2, children: 1,
}

describe('ReservasController.store — reincorpora childrenAges (Requerimiento 11)', () => {
  it('con childrenAges en el body: llega intacto al dto que recibe el service', async () => {
    let received: any = null
    const controller = makeController({
      create: async (dto) => { received = dto; return { id: 'res-1', ...dto } },
      update: async () => { throw new Error('no debería llamarse') },
    })

    await controller.store({ body: { ...BASE_CREATE_BODY, childrenAges: [4, 9] }, user: USER } as any)

    expect(received.childrenAges).toEqual([4, 9])
    expect(received.adults).toBe(2)
    expect(received.children).toBe(1)
  })

  it('sin childrenAges en el body: el dto NO trae la clave (no se inventa un `[]`)', async () => {
    let received: any = null
    const controller = makeController({
      create: async (dto) => { received = dto; return { id: 'res-1', ...dto } },
      update: async () => { throw new Error('no debería llamarse') },
    })

    await controller.store({ body: { ...BASE_CREATE_BODY }, user: USER } as any)

    expect('childrenAges' in received).toBe(false)
  })

  it('childrenAges no-array en el body se ignora (no revienta, no se cuela basura)', async () => {
    let received: any = null
    const controller = makeController({
      create: async (dto) => { received = dto; return { id: 'res-1', ...dto } },
      update: async () => { throw new Error('no debería llamarse') },
    })

    await controller.store({ body: { ...BASE_CREATE_BODY, childrenAges: 'no-es-un-array' }, user: USER } as any)

    expect('childrenAges' in received).toBe(false)
  })
})

describe('ReservasController.update — reincorpora childrenAges sin arriesgar borrarla por omisión (Requerimiento 11)', () => {
  it('con childrenAges en el body: llega al dto de update', async () => {
    let received: any = null
    const controller = makeController({
      create: async () => { throw new Error('no debería llamarse') },
      update: async (_id, dto) => { received = dto; return { id: 'res-1', ...dto } },
    })

    await controller.update({ params: { id: 'res-1' }, body: { adults: 3, childrenAges: [6, 10] }, user: USER } as any)

    expect(received.childrenAges).toEqual([6, 10])
    expect(received.adults).toBe(3)
  })

  it('editar SOLO adults/children sin mandar childrenAges: la clave no viaja en el dto — el UPDATE parcial no toca la columna existente', async () => {
    let received: any = null
    const controller = makeController({
      create: async () => { throw new Error('no debería llamarse') },
      update: async (_id, dto) => { received = dto; return { id: 'res-1', ...dto } },
    })

    // Escenario típico del panel: el staff corrige la cantidad de adultos/niños de una reserva
    // ya creada por el motor público, sin tocar las edades.
    await controller.update({ params: { id: 'res-1' }, body: { adults: 4, children: 2 }, user: USER } as any)

    expect(received.adults).toBe(4)
    expect(received.children).toBe(2)
    expect('childrenAges' in received).toBe(false) // NUNCA se manda `[]` por omisión
  })
})
