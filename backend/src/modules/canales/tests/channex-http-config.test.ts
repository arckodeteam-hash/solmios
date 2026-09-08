// canales/tests/channex-http-config.test.ts — CA-4: el techo de peticiones por minuto que el
// operador guarda en el Super Admin es el que el transporte respeta, EN CALIENTE.
//
// Lo que se mide es el limiter, no la red: reloj y sleep falsos (el archivo acepta `opts.now` y
// `opts.sleep`), así que el test corre en milisegundos y afirma sobre las esperas que el limiter
// habría hecho de verdad — mismo patrón que channex-http.test.ts y ari-outbox/tests/rate-limit.e2e.
//
// Y cubre el otro lado del contrato: el techo solo aplica a los ARI updates (POST /availability y
// /restrictions). El GET y el CRUD de contenido siguen sin consumir budget; si eso se rompiera, un
// full sync se auto-bloquearía antes del primer push de tarifas.

import { describe, it, expect, afterEach } from 'bun:test'
import {
  createChannexHttp,
  setChannexMaxPerMinute,
  resetChannexHttpForTests,
  DEFAULT_MAX_PER_MINUTE,
} from '../usecases/channex-http'

const WINDOW_MS = 60_000
const ARI_URL = 'https://api.channex.io/api/v1/availability'

const jsonResponse = () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })

function fakeClock(start = Date.parse('2026-09-08T10:00:00.000Z')) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

/** Transporte con fetch, reloj y sleep falsos: registra lo que sale y lo que se esperó. */
function makeTransport(maxPerMinute?: number) {
  const clock = fakeClock()
  const salidas: Array<{ url: string; method: string; at: number }> = []
  const sleeps: number[] = []
  const http = createChannexHttp(
    (async (url: any, init: any) => {
      salidas.push({ url: String(url), method: String(init?.method ?? 'GET'), at: clock.now() })
      return jsonResponse()
    }) as unknown as typeof fetch, // el fake no implementa `preconnect`, que el tipo global exige
    {
      ...(maxPerMinute === undefined ? {} : { maxPerMinute }),
      windowMs: WINDOW_MS,
      now: clock.now,
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms) }, // el sleep falso corre el reloj
    },
  )
  const ari = () => http.request(ARI_URL, { method: 'POST', body: '{}' })
  return { clock, http, ari, salidas, sleeps }
}

describe('CA-4 — el techo de peticiones por minuto contra Channex', () => {
  it('con maxPerMinute 2, el tercer ARI update espera la ventana y los dos primeros no', async () => {
    const { ari, salidas, sleeps } = makeTransport(2)

    await ari()
    await ari()
    expect(sleeps).toEqual([]) // los dos primeros entran de una

    await ari()
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThanOrEqual(WINDOW_MS) // esperó a que expirara el más viejo
    expect(salidas).toHaveLength(3)                     // esperó, no descartó
    expect(salidas[2]!.at - salidas[0]!.at).toBeGreaterThanOrEqual(WINDOW_MS)
  })

  it('después de setMaxPerMinute(5) entran cinco seguidos sin esperar', async () => {
    const { http, ari, salidas, sleeps } = makeTransport(2)

    http.setMaxPerMinute(5)
    for (let i = 0; i < 5; i++) await ari()

    expect(salidas).toHaveLength(5)
    expect(sleeps).toEqual([])
    // El sexto ya no entra: el techo nuevo también es un techo.
    await ari()
    expect(sleeps).toHaveLength(1)
  })

  it('el cambio alcanza a un push que YA está esperando su turno', async () => {
    // El limiter lee el techo en CADA vuelta del loop de espera, no una sola vez al entrar. Para
    // probarlo, el sleep de este caso NO corre el reloj: la ventana nunca se vacía sola, así que la
    // única forma de que el request salga es que la vuelta siguiente vea el techo nuevo. Si se
    // leyera al entrar, el push quedaría esperando para siempre (por eso el corte a las 5 vueltas:
    // una regresión falla el test en vez de colgar la suite).
    const clock = fakeClock()
    const salidas: number[] = []
    let esperas = 0
    let http: ReturnType<typeof createChannexHttp>
    http = createChannexHttp(
      (async () => { salidas.push(clock.now()); return jsonResponse() }) as unknown as typeof fetch,
      {
        maxPerMinute: 1,
        windowMs: WINDOW_MS,
        now: clock.now,
        sleep: async () => {
          esperas++
          if (esperas > 5) throw new Error('el limiter no releyó el techo: seguiría esperando para siempre')
          // El operador sube el techo mientras el push está trabado en la ventana.
          if (esperas === 1) http.setMaxPerMinute(10)
        },
      },
    )
    const ari = () => http.request(ARI_URL, { method: 'POST', body: '{}' })

    await ari()          // consume el único slot del techo viejo
    await ari()          // entra en espera y sale gracias al techo nuevo, sin que el reloj avance

    expect(salidas).toHaveLength(2)
    expect(salidas[1]).toBe(salidas[0])  // mismo instante: no hubo que esperar la ventana
    expect(esperas).toBe(1)
  })

  it('un techo inválido (0 o no numérico) NO cambia el límite vigente', async () => {
    const { http, ari, salidas, sleeps } = makeTransport(2)

    // Un 0 congelaría la cola para siempre y un 'x' rompería las comparaciones: los dos se ignoran.
    http.setMaxPerMinute(0)
    http.setMaxPerMinute('x' as unknown as number)

    await ari()
    await ari()
    expect(sleeps).toEqual([]) // sigue rigiendo el 2: si el 0 hubiera entrado, ya estaría esperando
    await ari()
    expect(sleeps).toHaveLength(1)
    expect(salidas).toHaveLength(3)
  })

  it('el techo NO se le aplica al tráfico que no es ARI update', async () => {
    const { http, ari, salidas, sleeps } = makeTransport(1)

    // GET y CRUD de contenido: un full sync hace decenas y no puede auto-bloquearse.
    for (let i = 0; i < 5; i++) await http.request('https://api.channex.io/api/v1/room_types', { method: 'GET' })
    await http.request('https://api.channex.io/api/v1/rate_plans', { method: 'POST', body: '{}' })
    await ari() // el único que consume budget: entra sin esperar

    expect(salidas).toHaveLength(7)
    expect(sleeps).toEqual([])
  })
})

describe('setChannexMaxPerMinute — el valor guardado aplicado al transporte compartido', () => {
  // El singleton lo comparte todo el módulo: se deja como estaba para no arrastrar el cambio a
  // los tests que corren después en este mismo archivo.
  afterEach(() => { setChannexMaxPerMinute(DEFAULT_MAX_PER_MINUTE); resetChannexHttpForTests() })

  it('acepta un entero válido y descarta lo inválido sin tirar', () => {
    expect(() => setChannexMaxPerMinute(6)).not.toThrow()
    expect(() => setChannexMaxPerMinute(0)).not.toThrow()
    expect(() => setChannexMaxPerMinute('x' as unknown as number)).not.toThrow()
  })
})
