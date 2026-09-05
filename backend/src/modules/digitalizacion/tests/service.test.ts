// digitalizacion/tests/service.test.ts — Reglas de negocio del expediente, con repos en memoria.
//
// Un test por regla del issue: quién es candidato, cuándo NO se abre expediente y qué exige cada
// paso para pasar a 'listo' (incluida la dependencia googleMaps → googleHotel). Sin DB real: el
// servicio solo habla con dos RepositoryAdapter, así que alcanza con dos fakes.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import { DigitalizacionService, type DigitalizacionHotelRow } from '../service'
import type { DigitalizationCaseDTO } from '../types'

// Repo fake genérico: mismo contract que OrmRepository (solo lo que usa el service).
function makeRepo<T extends { id: string }>(seed: T[] = []) {
  const rows = new Map<string, T>(seed.map((r) => [r.id, { ...r }]))
  let seq = seed.length
  const repo: RepositoryAdapter<T> = {
    async findMany(filters: any = {}, opts: any = {}) {
      const out = [...rows.values()].filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as any)[k] === v),
      )
      const order = opts.orderBy as any[] | undefined
      if (order) {
        out.sort((a, b) => {
          for (const { field, dir } of order) {
            const cmp = String((a as any)[field]).localeCompare(String((b as any)[field]))
            if (cmp !== 0) return dir === 'DESC' || dir === 'desc' ? -cmp : cmp
          }
          return 0
        })
      }
      return out
    },
    async findOne(filters: any) {
      return (
        [...rows.values()].find((r) =>
          Object.entries(filters).every(([k, v]) => (r as any)[k] === v),
        ) ?? null
      )
    },
    async findById(id: string) {
      return rows.get(id) ?? null
    },
    async create(data: any) {
      const row = {
        id: data.id ?? `id-${++seq}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      } as T
      rows.set(row.id, row)
      return row
    },
    async update(id: string, data: any) {
      const cur = rows.get(id)
      if (!cur) return null
      const next = { ...cur, ...data, updatedAt: new Date().toISOString() } as T
      rows.set(id, next)
      return next
    },
    async delete(id: string) {
      return rows.delete(id)
    },
  } as any
  return { repo, rows }
}

const log = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} } as unknown as Logger

function hotel(partial: Partial<DigitalizacionHotelRow> & { id: string }): DigitalizacionHotelRow {
  return { name: `Hotel ${partial.id}`, slug: partial.id, locality: 'Punta Cana', website: null, ...partial }
}

function expediente(
  partial: Partial<DigitalizationCaseDTO> & { id: string; hotelId: string },
): DigitalizationCaseDTO {
  return {
    hotelName: `Hotel ${partial.hotelId}`,
    status: 'abierto',
    websiteStatus: 'pendiente',
    templateKey: null,
    siteUrl: null,
    configStatus: 'pendiente',
    configFee: null,
    configCurrency: 'USD',
    configPaid: false,
    googleMapsStatus: 'pendiente',
    googlePlaceId: null,
    googleMapsUrl: null,
    googleHotelStatus: 'pendiente',
    bookingEngineStatus: 'pendiente',
    bookingEngineUrl: null,
    notes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  }
}

function build(hotels: DigitalizacionHotelRow[] = [], cases: DigitalizationCaseDTO[] = []) {
  const casos = makeRepo<DigitalizationCaseDTO>(cases)
  const hoteles = makeRepo<DigitalizacionHotelRow>(hotels)
  return { svc: new DigitalizacionService(casos.repo, hoteles.repo, log), rows: casos.rows }
}

describe('digitalizacion — candidatos', () => {
  it('lista solo hoteles sin web y sin expediente vivo', async () => {
    const { svc } = build(
      [
        hotel({ id: 'h1' }), // sin web y sin expediente → candidato
        hotel({ id: 'h2', website: 'https://hotel2.com' }), // ya tiene web → fuera
        hotel({ id: 'h3', website: '   ' }), // solo espacios → sigue sin nada → candidato
        hotel({ id: 'h4' }), // sin web pero con expediente abierto → fuera
      ],
      [expediente({ id: 'c1', hotelId: 'h4', status: 'abierto' })],
    )
    const candidatos = await svc.listCandidates()
    expect(candidatos.map((c) => c.hotelId).sort()).toEqual(['h1', 'h3'])
    expect(candidatos[0]).toMatchObject({ name: 'Hotel h1', slug: 'h1', city: 'Punta Cana' })
  })

  it('un expediente completado también saca al hotel de candidatos; uno cancelado lo devuelve', async () => {
    const { svc } = build(
      [hotel({ id: 'h1' }), hotel({ id: 'h2' })],
      [
        expediente({ id: 'c1', hotelId: 'h1', status: 'completado' }),
        expediente({ id: 'c2', hotelId: 'h2', status: 'cancelado' }),
      ],
    )
    const candidatos = await svc.listCandidates()
    expect(candidatos.map((c) => c.hotelId)).toEqual(['h2'])
  })
})

describe('digitalizacion — apertura del expediente', () => {
  it('abre con todos los pasos en pendiente y la configuración sin cobrar', async () => {
    const { svc } = build([hotel({ id: 'h1', name: 'Hotel Solmi' })])
    const caso = await svc.create({ hotelId: 'h1' })
    expect(caso.status).toBe('abierto')
    expect(caso.hotelName).toBe('Hotel Solmi')
    expect(caso.websiteStatus).toBe('pendiente')
    expect(caso.googleHotelStatus).toBe('pendiente')
    expect(caso.configPaid).toBe(false)
    expect(caso.configFee).toBeNull()
  })

  it('no abre expediente para un hotel que YA tiene página web (ValidationError)', async () => {
    const { svc } = build([hotel({ id: 'h1', website: 'https://hotel1.com' })])
    expect(svc.create({ hotelId: 'h1' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('404 si el hotel no existe', async () => {
    const { svc } = build([hotel({ id: 'h1' })])
    expect(svc.create({ hotelId: 'no-existe' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('un segundo expediente para el mismo hotel es ConflictError', async () => {
    const { svc } = build(
      [hotel({ id: 'h1' })],
      [expediente({ id: 'c1', hotelId: 'h1', status: 'abierto' })],
    )
    expect(svc.create({ hotelId: 'h1' })).rejects.toBeInstanceOf(ConflictError)
  })

  it('tras cancelar, el hotel puede volver a entrar al programa', async () => {
    const { svc } = build(
      [hotel({ id: 'h1' })],
      [expediente({ id: 'c1', hotelId: 'h1', status: 'cancelado' })],
    )
    const nuevo = await svc.create({ hotelId: 'h1' })
    expect(nuevo.status).toBe('abierto')
  })
})

describe('digitalizacion — reglas de cierre de cada paso', () => {
  it('website listo sin templateKey es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    expect(svc.advanceStep('c1', { step: 'website', status: 'listo' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('templateKey fuera del catálogo es ValidationError aunque el paso no se cierre', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    expect(
      svc.advanceStep('c1', { step: 'website', status: 'en_progreso', templateKey: 'inventada' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('config listo con configPaid false es ValidationError (la configuración se cobra)', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1', configFee: 300 })])
    expect(
      svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: false }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('config con configFee <= 0 es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    expect(
      svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: true, configFee: 0 }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('googleMaps listo sin googlePlaceId es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    expect(svc.advanceStep('c1', { step: 'googleMaps', status: 'listo' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('googleHotel listo con googleMaps pendiente es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1', googleMapsStatus: 'pendiente' })])
    expect(svc.advanceStep('c1', { step: 'googleHotel', status: 'listo' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('googleHotel listo pasa cuando googleMaps ya está listo', async () => {
    const { svc } = build(
      [],
      [expediente({ id: 'c1', hotelId: 'h1', googleMapsStatus: 'listo', googlePlaceId: 'place-1' })],
    )
    const caso = await svc.advanceStep('c1', { step: 'googleHotel', status: 'listo' })
    expect(caso.googleHotelStatus).toBe('listo')
    expect(caso.status).toBe('abierto') // faltan los otros pasos
  })

  it('bookingEngine listo sin bookingEngineUrl es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    expect(svc.advanceStep('c1', { step: 'bookingEngine', status: 'listo' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('guarda los datos del paso aunque quede en progreso', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    const caso = await svc.advanceStep('c1', {
      step: 'googleMaps',
      status: 'en_progreso',
      googlePlaceId: 'place-1',
      googleMapsUrl: 'https://maps.google.com/?cid=1',
    })
    expect(caso.googleMapsStatus).toBe('en_progreso')
    expect(caso.googlePlaceId).toBe('place-1')
  })

  it('404 al avanzar un expediente inexistente', async () => {
    const { svc } = build()
    expect(svc.advanceStep('nada', { step: 'website', status: 'listo' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('digitalizacion — cierre automático del expediente', () => {
  it('con los cinco pasos en listo el expediente queda completado', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await svc.advanceStep('c1', { step: 'website', status: 'listo', templateKey: 'classic' })
    await svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: true, configFee: 350 })
    await svc.advanceStep('c1', { step: 'googleMaps', status: 'listo', googlePlaceId: 'place-1' })
    await svc.advanceStep('c1', { step: 'googleHotel', status: 'listo' })
    const final = await svc.advanceStep('c1', {
      step: 'bookingEngine',
      status: 'listo',
      bookingEngineUrl: 'https://reservas.solmios.com/h1',
    })
    expect(final.status).toBe('completado')
  })

  it('con cuatro pasos listos sigue abierto', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await svc.advanceStep('c1', { step: 'website', status: 'listo', templateKey: 'modern' })
    await svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: true })
    await svc.advanceStep('c1', { step: 'googleMaps', status: 'listo', googlePlaceId: 'place-1' })
    const caso = await svc.advanceStep('c1', { step: 'googleHotel', status: 'listo' })
    expect(caso.status).toBe('abierto')
  })

  it('dispara onCaseUpdated en cada avance', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    const vistos: string[] = []
    svc.setSockets({ onCaseUpdated: async (c) => { vistos.push(c.id) } })
    await svc.advanceStep('c1', { step: 'website', status: 'en_progreso' })
    expect(vistos).toEqual(['c1'])
  })
})

describe('digitalizacion — listado, edición y borrado', () => {
  it('list devuelve todos los expedientes, más recientes primero', async () => {
    const { svc } = build(
      [],
      [
        expediente({ id: 'c1', hotelId: 'h1', createdAt: '2026-09-01T00:00:00.000Z' }),
        expediente({ id: 'c2', hotelId: 'h2', createdAt: '2026-09-03T00:00:00.000Z' }),
      ],
    )
    const res = await svc.list()
    expect(res.total).toBe(2)
    expect(res.data.map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('update valida el status contra el enum y guarda notas', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    const caso = await svc.update('c1', { status: 'cancelado', notes: 'El hotel lo pospone' })
    expect(caso.status).toBe('cancelado')
    expect(caso.notes).toBe('El hotel lo pospone')
    expect(svc.update('c1', { status: 'archivado' as any })).rejects.toBeInstanceOf(ValidationError)
  })

  it('update permite bonificar la configuración con configFee 0', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    const caso = await svc.update('c1', { configFee: 0 })
    expect(caso.configFee).toBe(0)
  })

  it('getById / update / remove dan 404 si el expediente no existe', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    expect(svc.getById('nada')).rejects.toBeInstanceOf(NotFoundError)
    expect(svc.update('nada', { notes: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    await svc.remove('c1')
    expect(svc.remove('c1')).rejects.toBeInstanceOf(NotFoundError)
  })
})
