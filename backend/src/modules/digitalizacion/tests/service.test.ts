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
    await expect(svc.create({ hotelId: 'h1' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('404 si el hotel no existe', async () => {
    const { svc } = build([hotel({ id: 'h1' })])
    await expect(svc.create({ hotelId: 'no-existe' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('un segundo expediente para el mismo hotel es ConflictError', async () => {
    const { svc } = build(
      [hotel({ id: 'h1' })],
      [expediente({ id: 'c1', hotelId: 'h1', status: 'abierto' })],
    )
    await expect(svc.create({ hotelId: 'h1' })).rejects.toBeInstanceOf(ConflictError)
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
    await expect(svc.advanceStep('c1', { step: 'website', status: 'listo' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('templateKey fuera del catálogo es ValidationError aunque el paso no se cierre', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await expect(
      svc.advanceStep('c1', { step: 'website', status: 'en_progreso', templateKey: 'inventada' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('config listo con configPaid false es ValidationError (la configuración se cobra)', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1', configFee: 300 })])
    await expect(
      svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: false }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('config con configFee negativo es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await expect(
      svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: true, configFee: -1 }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  // Regresión: exigir `configFee > 0` para cerrar el paso dejaba trabado para siempre a un
  // expediente con la configuración bonificada — nunca llegaba a 'completado' y el hotel quedaba
  // fuera de listCandidates sin poder volver a entrar. 0 es un importe válido; el cobro lo
  // acredita configPaid, y ese sí se exige.
  it('una configuracion bonificada (configFee 0, configPaid true) puede cerrar el paso', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    const caso = await svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: true, configFee: 0 })
    expect(caso.configStatus).toBe('listo')
    expect(caso.configFee).toBe(0)
  })

  // Regresión: la URL se validaba con trim() pero se persistía cruda, guardando los espacios.
  it('una URL con espacios se guarda recortada', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    const caso = await svc.advanceStep('c1', {
      step: 'bookingEngine', status: 'listo', bookingEngineUrl: '  https://reservas.test/x  ',
    })
    expect(caso.bookingEngineUrl).toBe('https://reservas.test/x')
  })

  it('googleMaps listo sin googlePlaceId es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await expect(svc.advanceStep('c1', { step: 'googleMaps', status: 'listo' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('googleHotel listo con googleMaps pendiente es ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1', googleMapsStatus: 'pendiente' })])
    await expect(svc.advanceStep('c1', { step: 'googleHotel', status: 'listo' })).rejects.toBeInstanceOf(
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
    await expect(svc.advanceStep('c1', { step: 'bookingEngine', status: 'listo' })).rejects.toBeInstanceOf(
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
    await expect(svc.advanceStep('nada', { step: 'website', status: 'listo' })).rejects.toBeInstanceOf(
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
    await expect(svc.update('c1', { status: 'archivado' as any })).rejects.toBeInstanceOf(ValidationError)
  })

  it('update permite bonificar la configuración con configFee 0', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    const caso = await svc.update('c1', { configFee: 0 })
    expect(caso.configFee).toBe(0)
  })

  it('getById / update / remove dan 404 si el expediente no existe', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await expect(svc.getById('nada')).rejects.toBeInstanceOf(NotFoundError)
    await expect(svc.update('nada', { notes: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    await svc.remove('c1')
    await expect(svc.remove('c1')).rejects.toBeInstanceOf(NotFoundError)
  })
})

// Regresiones de la revisión adversarial: estados imposibles que el servicio dejaba pasar.
describe('digitalizacion — coherencia del expediente (regresiones)', () => {
  it('no deja reabrir Google Maps mientras Google Hotel esté listo (ValidationError)', async () => {
    const { svc } = build(
      [],
      [
        expediente({
          id: 'c1',
          hotelId: 'h1',
          googleMapsStatus: 'listo',
          googlePlaceId: 'place-1',
          googleHotelStatus: 'listo',
        }),
      ],
    )
    // Sin la guarda quedaría "Google Hotel listo sin Maps", que el issue declara imposible.
    await expect(
      svc.advanceStep('c1', { step: 'googleMaps', status: 'en_progreso' }),
    ).rejects.toBeInstanceOf(ValidationError)
    // Bajando primero Google Hotel, sí se puede reabrir Google Maps.
    await svc.advanceStep('c1', { step: 'googleHotel', status: 'en_progreso' })
    const caso = await svc.advanceStep('c1', { step: 'googleMaps', status: 'en_progreso' })
    expect(caso.googleMapsStatus).toBe('en_progreso')
  })

  it('si un paso se reabre, el expediente completado vuelve a abierto', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await svc.advanceStep('c1', { step: 'website', status: 'listo', templateKey: 'classic' })
    await svc.advanceStep('c1', { step: 'config', status: 'listo', configPaid: true, configFee: 350 })
    await svc.advanceStep('c1', { step: 'googleMaps', status: 'listo', googlePlaceId: 'place-1' })
    await svc.advanceStep('c1', { step: 'googleHotel', status: 'listo' })
    const completo = await svc.advanceStep('c1', {
      step: 'bookingEngine',
      status: 'listo',
      bookingEngineUrl: 'https://reservas.solmios.com/h1',
    })
    expect(completo.status).toBe('completado')

    const reabierto = await svc.advanceStep('c1', { step: 'bookingEngine', status: 'en_progreso' })
    expect(reabierto.status).toBe('abierto')

    // Y al volver a cerrarlo se completa otra vez: el estado es función de los cinco pasos.
    const recompletado = await svc.advanceStep('c1', { step: 'bookingEngine', status: 'listo' })
    expect(recompletado.status).toBe('completado')
  })

  it('un expediente cancelado no se auto-completa ni se reabre solo', async () => {
    const { svc } = build(
      [],
      [
        expediente({
          id: 'c1',
          hotelId: 'h1',
          status: 'cancelado',
          websiteStatus: 'listo',
          templateKey: 'classic',
          configStatus: 'listo',
          configPaid: true,
          googleMapsStatus: 'listo',
          googlePlaceId: 'place-1',
          googleHotelStatus: 'listo',
          bookingEngineUrl: 'https://reservas.solmios.com/h1',
        }),
      ],
    )
    const caso = await svc.advanceStep('c1', { step: 'bookingEngine', status: 'listo' })
    expect(caso.bookingEngineStatus).toBe('listo')
    expect(caso.status).toBe('cancelado') // cancelar es decisión del operador, no la pisa el cálculo
  })

  it('avanzar un paso NO escribe los campos de otro paso', async () => {
    const { svc } = build(
      [],
      [
        expediente({
          id: 'c1',
          hotelId: 'h1',
          configStatus: 'listo',
          configPaid: true,
          configFee: 300,
          googlePlaceId: 'place-1',
        }),
      ],
    )
    // Desmarcar el cobro colándolo en el avance de otro paso no puede funcionar.
    const caso = await svc.advanceStep('c1', {
      step: 'website',
      status: 'en_progreso',
      templateKey: 'classic',
      configPaid: false,
      configFee: 1,
      googlePlaceId: 'otro-place',
    })
    expect(caso.templateKey).toBe('classic')
    expect(caso.configPaid).toBe(true)
    expect(caso.configFee).toBe(300)
    expect(caso.googlePlaceId).toBe('place-1')
  })

  it('un string vacío borra el dato y un dato en blanco no cierra el paso', async () => {
    const { svc } = build(
      [],
      [expediente({ id: 'c1', hotelId: 'h1', siteUrl: 'https://mal-tipeada.com' })],
    )
    const borrado = await svc.advanceStep('c1', { step: 'website', status: 'en_progreso', siteUrl: '  ' })
    expect(borrado.siteUrl).toBeNull()

    await expect(
      svc.advanceStep('c1', { step: 'googleMaps', status: 'listo', googlePlaceId: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

// Hallazgo H2 de la revisión: un dato ya cargado no se podía borrar desde la pantalla. El vacío
// se rechazaba en el borde HTTP (`type: 'url'` / `enum` en validators/schema.ts) antes de llegar a
// la regla de borrado del usecase, y encima un expediente recién abierto —todo vacío— no podía ni
// guardar sus datos. La validación de formato bajó al usecase; acá se prueban las dos mitades.
describe('digitalizacion — borrar un dato cargado (regresiones H2)', () => {
  it('mandar siteUrl vacío borra la URL cargada y deja el expediente en null', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1', siteUrl: 'https://vieja.com' })])
    const caso = await svc.advanceStep('c1', { step: 'website', status: 'en_progreso', siteUrl: '' })
    expect(caso.siteUrl).toBeNull()
  })

  it('una URL no vacía mal formada da ValidationError', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await expect(
      svc.advanceStep('c1', { step: 'website', status: 'en_progreso', siteUrl: 'no-es-una-url' }),
    ).rejects.toBeInstanceOf(ValidationError)
    // `new URL` sola aceptaría `javascript:`; la regla exige http(s) porque la pantalla la linkea.
    await expect(
      svc.advanceStep('c1', { step: 'googleMaps', status: 'en_progreso', googleMapsUrl: 'javascript:alert(1)' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      svc.advanceStep('c1', { step: 'bookingEngine', status: 'en_progreso', bookingEngineUrl: 'ftp://reservas' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('un templateKey fuera del catálogo da ValidationError aunque el paso no se marque listo', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    await expect(
      svc.advanceStep('c1', { step: 'website', status: 'en_progreso', templateKey: 'inventada' }),
    ).rejects.toBeInstanceOf(ValidationError)
    // Misma guarda por la otra ruta que escribe el campo.
    await expect(svc.update('c1', { templateKey: 'inventada' })).rejects.toBeInstanceOf(ValidationError)
  })

  // `update` es la otra puerta que escribe las URLs. Como el schema HTTP las bajó a `string` para
  // dejar entrar el vacío, sin este chequeo sería la puerta de atrás para guardar basura.
  it('update valida el formato de las URLs y acepta el vacío como borrado', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1', siteUrl: 'https://vieja.com' })])
    await expect(svc.update('c1', { siteUrl: 'no-es-una-url' })).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.update('c1', { googleMapsUrl: 'javascript:alert(1)' })).rejects.toBeInstanceOf(ValidationError)
    await expect(svc.update('c1', { bookingEngineUrl: 'ftp://reservas' })).rejects.toBeInstanceOf(ValidationError)

    const borrado = await svc.update('c1', { siteUrl: '' })
    expect(borrado.siteUrl).toBeNull()
    const puesta = await svc.update('c1', { siteUrl: 'https://nueva.com' })
    expect(puesta.siteUrl).toBe('https://nueva.com')
  })

  it('un expediente recién abierto guarda sus datos con todos los campos vacíos', async () => {
    const { svc } = build([hotel({ id: 'h1' })])
    const abierto = await svc.create({ hotelId: 'h1' })

    // Lo que manda la pantalla al tocar "Guardar datos" sin haber cargado nada todavía.
    const guardado = await svc.update(abierto.id, {
      templateKey: '',
      siteUrl: '',
      googlePlaceId: '',
      googleMapsUrl: '',
      bookingEngineUrl: '',
      notes: '',
    })
    expect(guardado.status).toBe('abierto')
    // Hallazgo H1: el test afirmaba solo el status. El vacío tiene que quedar como null —no como
    // '' guardado, que para el resto del código no es ni un dato ni "sin dato"—.
    expect(guardado.templateKey).toBeNull()
    expect(guardado.googlePlaceId).toBeNull()
    expect(guardado.siteUrl).toBeNull()
    expect(guardado.googleMapsUrl).toBeNull()
    expect(guardado.bookingEngineUrl).toBeNull()
    expect(guardado.notes).toBeNull()

    // Y por la ruta del avance el vacío se persiste como null, no como dato cargado.
    const avanzado = await svc.advanceStep(abierto.id, {
      step: 'website',
      status: 'en_progreso',
      templateKey: '',
      siteUrl: '',
    })
    expect(avanzado.templateKey).toBeNull()
    expect(avanzado.siteUrl).toBeNull()
  })
})

// Re-revisión adversarial: `update` escribía los mismos campos que `advanceStep` sin ninguna de sus
// invariantes. Los tres hallazgos, uno por caso, todos por la ruta de `update`.
describe('digitalizacion — update no es una puerta de atrás (regresiones H1-H3)', () => {
  it('H1: el vacío por update BORRA el dato (null), no guarda un string vacío', async () => {
    const { svc } = build(
      [],
      [expediente({ id: 'c1', hotelId: 'h1', templateKey: 'classic', googlePlaceId: 'place-1', notes: 'algo' })],
    )
    const caso = await svc.update('c1', { templateKey: '', googlePlaceId: '  ', notes: '' })
    expect(caso.templateKey).toBeNull()
    expect(caso.googlePlaceId).toBeNull()
    expect(caso.notes).toBeNull()
  })

  it('H2: update no acepta status completado a mano — se llega completando los cinco pasos', async () => {
    const { svc } = build([], [expediente({ id: 'c1', hotelId: 'h1' })])
    // Con los cinco pasos en 'pendiente' esto cerraba el expediente y sacaba al hotel de candidatos.
    await expect(svc.update('c1', { status: 'completado' })).rejects.toBeInstanceOf(ValidationError)
    expect((await svc.getById('c1')).status).toBe('abierto')
    // Cancelar y reabrir sí son decisiones del operador.
    expect((await svc.update('c1', { status: 'cancelado' })).status).toBe('cancelado')
    expect((await svc.update('c1', { status: 'abierto' })).status).toBe('abierto')
  })

  it('H2: reabrir un cancelado con los cinco pasos listos lo deja completado, no abierto', async () => {
    const { svc } = build(
      [],
      [
        expediente({
          id: 'c1',
          hotelId: 'h1',
          status: 'cancelado',
          websiteStatus: 'listo',
          templateKey: 'classic',
          configStatus: 'listo',
          configPaid: true,
          configFee: 300,
          googleMapsStatus: 'listo',
          googlePlaceId: 'place-1',
          googleHotelStatus: 'listo',
          bookingEngineStatus: 'listo',
          bookingEngineUrl: 'https://reservas.solmios.com/h1',
        }),
      ],
    )
    const reabierto = await svc.update('c1', { status: 'abierto' })
    expect(reabierto.status).toBe('completado')
  })

  it('H3: update no puede vaciar el dato de un paso que ya está listo', async () => {
    const { svc } = build(
      [],
      [
        expediente({
          id: 'c1',
          hotelId: 'h1',
          googleMapsStatus: 'listo',
          googlePlaceId: 'place-1',
          googleHotelStatus: 'listo',
          websiteStatus: 'listo',
          templateKey: 'classic',
        }),
      ],
    )
    // Borrar el placeId dejaría Google Maps "listo sin su ficha" —y Google Hotel listo sin Maps—,
    // exactamente el estado que `assertStepNotLocked` bloquea por la ruta del avance.
    await expect(svc.update('c1', { googlePlaceId: '' })).rejects.toBeInstanceOf(ValidationError)
    // Y la plantilla del paso web ya cerrado tampoco se puede sacar.
    await expect(svc.update('c1', { templateKey: '' })).rejects.toBeInstanceOf(ValidationError)
    const sinTocar = await svc.getById('c1')
    expect(sinTocar.googlePlaceId).toBe('place-1')
    expect(sinTocar.templateKey).toBe('classic')
  })

  it('H3: con el paso pendiente, vaciar el dato desde update sigue siendo válido', async () => {
    const { svc } = build(
      [],
      [expediente({ id: 'c1', hotelId: 'h1', googleMapsStatus: 'en_progreso', googlePlaceId: 'place-1' })],
    )
    const caso = await svc.update('c1', { googlePlaceId: '' })
    expect(caso.googlePlaceId).toBeNull()
    expect(caso.status).toBe('abierto')
  })
})
