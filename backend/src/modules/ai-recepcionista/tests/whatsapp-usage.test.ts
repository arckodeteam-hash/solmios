// ai-recepcionista/tests/whatsapp-usage.test.ts — Consumo, cupo y corte.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import {
  sincronizarConsumo, consumoDelMes, assertPuedeIniciarConversacion,
  cupoDesdeLimits, rangoDelMes, CUPO_POR_DEFECTO, UMBRAL_AVISO,
} from '../usecases/whatsapp-usage'

const log = silentLogger()
const MES = '2026-09'

function makeDeps(opts: { filas?: any[]; cupo?: number | null; deMeta?: any[] } = {}) {
  let filas = [...(opts.filas ?? [])]
  const escrituras: any[] = []
  return {
    escrituras,
    filas: () => filas,
    deps: {
      logger: log,
      usageRepo: {
        findMany: async (f: any) => filas.filter((x) =>
          Object.entries(f).every(([k, v]) => String(x[k]) === String(v))),
        create: async (d: any) => { filas.push(d); escrituras.push({ tipo: 'create', d }); return d },
        update: async (id: string, d: any) => {
          const i = filas.findIndex((x) => x.id === id)
          filas[i] = { ...filas[i], ...d }
          escrituras.push({ tipo: 'update', id, d })
          return filas[i]
        },
      },
      cupoPort: { cupoMensual: async () => (opts.cupo === undefined ? 1000 : opts.cupo) },
      meta: {
        credentialsFor: async () => ({ wabaId: 'W', phoneNumberId: 'P', accessToken: 'T' }),
        getUsage: async () => opts.deMeta ?? [],
      },
    } as any,
  }
}

const fila = (date: string, category: string, conversations: number, cost = 0, id = `${date}-${category}`) =>
  ({ id, hotelId: 'h1', date, category, conversations, cost, currency: 'USD', syncedAt: '2026-09-07T10:00:00.000Z' })

describe('sincronizarConsumo', () => {
  it('guarda lo que informa Meta', async () => {
    const { deps, filas } = makeDeps({
      deMeta: [{ date: '2026-09-01', category: 'UTILITY', conversations: 12, cost: 0.6, currency: 'USD' }],
    })
    const out = await sincronizarConsumo(deps, 'h1', MES)
    expect(out.guardados).toBe(1)
    expect(filas()[0]).toMatchObject({ category: 'UTILITY', conversations: 12 })
  })

  // Meta corrige sus propios números durante las horas siguientes. Si sumáramos en vez de
  // reemplazar, una corrección se convertiría en un cobro doble al hotel.
  it('reemplaza el día en vez de sumar, para que una corrección de Meta no duplique', async () => {
    const { deps, escrituras, filas } = makeDeps({
      filas: [fila('2026-09-01', 'UTILITY', 12)],
      deMeta: [{ date: '2026-09-01', category: 'UTILITY', conversations: 9, cost: 0.45 }],
    })
    await sincronizarConsumo(deps, 'h1', MES)
    expect(escrituras[0].tipo).toBe('update')
    expect(filas().length).toBe(1)
    expect(filas()[0].conversations).toBe(9)
  })

  it('un hotel sin conectar no puede sincronizar', async () => {
    const { deps } = makeDeps()
    deps.meta.credentialsFor = async () => null
    expect(sincronizarConsumo(deps, 'h1', MES)).rejects.toThrow(/no conectó/)
  })

  it('un mes sin consumo no es un error', async () => {
    const { deps } = makeDeps({ deMeta: [] })
    expect((await sincronizarConsumo(deps, 'h1', MES)).guardados).toBe(0)
  })
})

describe('consumoDelMes', () => {
  it('suma el mes y desglosa por categoría', async () => {
    const { deps } = makeDeps({
      filas: [
        fila('2026-09-01', 'UTILITY', 10, 0.5),
        fila('2026-09-02', 'UTILITY', 5, 0.25),
        fila('2026-09-02', 'MARKETING', 3, 0.9),
      ],
    })
    const r = await consumoDelMes(deps, 'h1', MES)
    expect(r.conversaciones).toBe(18)
    expect(r.costo).toBe(1.65)
    expect(r.porCategoria[0]).toEqual({ category: 'UTILITY', conversations: 15, cost: 0.75 })
  })

  it('no mezcla meses', async () => {
    const { deps } = makeDeps({ filas: [fila('2026-08-31', 'UTILITY', 100), fila('2026-09-01', 'UTILITY', 7)] })
    expect((await consumoDelMes(deps, 'h1', MES)).conversaciones).toBe(7)
  })

  it('avisa al acercarse al tope, antes de cortar', async () => {
    const { deps } = makeDeps({ filas: [fila('2026-09-01', 'UTILITY', 800)], cupo: 1000 })
    const r = await consumoDelMes(deps, 'h1', MES)
    expect(r.usoDelCupo).toBe(UMBRAL_AVISO)
    expect(r.cerca).toBe(true)
    expect(r.agotado).toBe(false)
  })

  it('marca agotado al llegar al tope', async () => {
    const { deps } = makeDeps({ filas: [fila('2026-09-01', 'UTILITY', 1000)], cupo: 1000 })
    const r = await consumoDelMes(deps, 'h1', MES)
    expect(r.agotado).toBe(true)
    expect(r.cerca).toBe(false)
  })

  it('sin tope no hay porcentaje ni corte', async () => {
    const { deps } = makeDeps({ filas: [fila('2026-09-01', 'UTILITY', 99999)], cupo: null })
    const r = await consumoDelMes(deps, 'h1', MES)
    expect(r.usoDelCupo).toBeNull()
    expect(r.agotado).toBe(false)
  })

  it('un mes sin datos devuelve cero, no rompe', async () => {
    const { deps } = makeDeps()
    const r = await consumoDelMes(deps, 'h1', MES)
    expect(r.conversaciones).toBe(0)
    expect(r.porCategoria).toEqual([])
  })
})

describe('assertPuedeIniciarConversacion', () => {
  // Sin este corte, un hotel que manda 5.000 conversaciones las paga la plataforma.
  it('deja iniciar mientras haya cupo', async () => {
    const { deps } = makeDeps({ filas: [fila('2026-09-01', 'UTILITY', 10)], cupo: 1000 })
    await assertPuedeIniciarConversacion(deps, 'h1')
  })

  it('corta al agotarse, con un mensaje que dice qué hacer', async () => {
    const { deps } = makeDeps({ filas: [fila('2026-09-01', 'UTILITY', 1000)], cupo: 1000 })
    expect(assertPuedeIniciarConversacion(deps, 'h1')).rejects.toThrow(/tope de 1000 conversaciones/)
  })

  it('sin tope nunca corta', async () => {
    const { deps } = makeDeps({ filas: [fila('2026-09-01', 'UTILITY', 99999)], cupo: null })
    await assertPuedeIniciarConversacion(deps, 'h1')
  })
})

describe('cupoDesdeLimits', () => {
  it('toma el cupo del plan', () => {
    expect(cupoDesdeLimits({ rooms: 100, whatsappConversations: 5000 })).toBe(5000)
  })

  // Un plan sin el campo no puede quedar sin tope: el que paga las conversaciones es la plataforma.
  it('un plan que no lo declara cae al default, no a ilimitado', () => {
    expect(cupoDesdeLimits({ rooms: 100 })).toBe(CUPO_POR_DEFECTO)
    expect(cupoDesdeLimits(null)).toBe(CUPO_POR_DEFECTO)
    expect(cupoDesdeLimits('basura')).toBe(CUPO_POR_DEFECTO)
  })

  it('null explícito sí es sin tope', () => {
    expect(cupoDesdeLimits({ whatsappConversations: null })).toBeNull()
  })

  // 0 es "este plan no incluye WhatsApp", que no es lo mismo que "no configurado".
  it('cero significa sin WhatsApp', () => {
    expect(cupoDesdeLimits({ whatsappConversations: 0 })).toBe(0)
  })
})

describe('rangoDelMes', () => {
  it('cubre el mes calendario en UTC, que es como agrupa Meta', () => {
    const { desde, hasta } = rangoDelMes('2026-09')
    expect(desde.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(hasta.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('cruza bien el fin de año', () => {
    expect(rangoDelMes('2026-12').hasta.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})
