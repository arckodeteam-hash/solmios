// platform-metrics.test.ts — Métricas del negocio SaaS del dashboard `/admin`.
//
// El escenario base es un recorte de PRODUCCIÓN al 2026-09-09, porque los bugs que motivaron
// este usecase solo se ven con datos así: 17 hoteles, un solo cobro real por Stripe, y una pila
// de trials vencidos que nadie cortó. El dashboard viejo mostraba $1.433 de MRR sobre esa misma
// base; el real es $414.

import { describe, it, expect } from 'bun:test'
import {
  computePlatformMetrics, resolvePlan, normalizeHotelStatus,
  type PlatformMetricsInput,
} from '../usecases/platform-metrics'

const NOW = new Date('2026-09-09T12:00:00Z').getTime()
const DAY = 86_400_000
const iso = (d: number): string => new Date(NOW + d * DAY).toISOString()

const PLANS = [
  { id: 'plan-host', name: 'Host', slug: 'host', price: 65 },
  { id: 'plan-professional', name: 'Professional', slug: 'professional', price: 349 },
  { id: 'plan-enterprise', name: 'Cumbre', slug: 'enterprise', price: 549 },
  { id: 'plan-starter', name: 'Ecencial', slug: 'starter', price: 129 },
]

function input(over: Partial<PlatformMetricsInput> = {}): PlatformMetricsInput {
  return {
    hotels: [], subscriptions: [], plans: PLANS, users: [],
    reservations: [], tickets: [], audit: [], now: NOW, ...over,
  }
}

describe('normalizeHotelStatus', () => {
  it("trata 'activo' y 'active' como el mismo estado", () => {
    // Producción tiene 15 filas con 'active' y 2 con 'activo': por eso el dashboard contaba 15
    // hoteles activos y el sidebar 17 sobre exactamente los mismos datos.
    expect(normalizeHotelStatus('activo')).toBe('active')
    expect(normalizeHotelStatus('active')).toBe('active')
    expect(normalizeHotelStatus('ACTIVE ')).toBe('active')
    expect(normalizeHotelStatus(undefined)).toBe('active')
    expect(normalizeHotelStatus('suspended')).toBe('suspended')
  })
})

describe('resolvePlan', () => {
  it('prioriza el planId de la suscripción sobre el texto libre del hotel', () => {
    const plan = resolvePlan({ id: 'h1', name: 'H', plan: 'host' }, { hotelId: 'h1', planId: 'plan-professional', status: 'active' }, PLANS)
    expect(plan?.price).toBe(349)
  })

  it('matchea el texto libre del hotel por id, slug o nombre', () => {
    expect(resolvePlan({ id: 'h', name: 'H', plan: 'plan-host' }, undefined, PLANS)?.price).toBe(65)
    expect(resolvePlan({ id: 'h', name: 'H', plan: 'professional' }, undefined, PLANS)?.price).toBe(349)
    // 'cumbre' es el NOMBRE de plan-enterprise: el mapa hardcodeado viejo no lo conocía y le
    // asignaba el fallback de 49.
    expect(resolvePlan({ id: 'h', name: 'H', plan: 'cumbre' }, undefined, PLANS)?.price).toBe(549)
  })

  it('devuelve null en vez de inventar un precio cuando el plan no existe', () => {
    expect(resolvePlan({ id: 'h', name: 'H', plan: 'plan-que-no-existe' }, undefined, PLANS)).toBeNull()
    expect(resolvePlan({ id: 'h', name: 'H' }, undefined, PLANS)).toBeNull()
  })
})

describe('computePlatformMetrics — ingresos', () => {
  it('el MRR cuenta SOLO las suscripciones active, con el precio de la tabla plans', () => {
    const m = computePlatformMetrics(input({
      hotels: [
        { id: 'h1', name: 'Test Property', plan: 'professional', status: 'active' },
        { id: 'h2', name: 'Boutique Palma', plan: 'host', status: 'active' },
        { id: 'h3', name: 'En prueba', plan: 'cumbre', status: 'active' },
        { id: 'h4', name: 'Vencido', plan: 'professional', status: 'active' },
      ],
      subscriptions: [
        { hotelId: 'h1', planId: 'plan-professional', status: 'active' },
        { hotelId: 'h2', planId: 'plan-host', status: 'active', stripeCustomerId: 'cus_1' },
        { hotelId: 'h3', planId: 'plan-enterprise', status: 'trialing', trialEndsAt: iso(10) },
        { hotelId: 'h4', planId: 'plan-professional', status: 'expired', trialEndsAt: iso(-30) },
      ],
    }))
    expect(m.ingresos.mrr).toBe(414)          // 349 + 65 — no los $1.433 del cálculo viejo
    expect(m.ingresos.arr).toBe(4968)
    expect(m.ingresos.clientesPagos).toBe(2)
    expect(m.ingresos.arpu).toBe(207)
    expect(m.ingresos.mrrEnTrial).toBe(549)   // potencial, NO ingreso
    expect(m.ingresos.conPagoConfigurado).toBe(1)
  })

  it('no reporta variación de MRR: no hay histórico del que derivarla', () => {
    // El dashboard viejo mostraba "+76% vs ayer" en la card de MRR, pero ese número era la
    // variación del revenue de RESERVAS entre dos meses. Mejor null que el trend de otra métrica.
    expect(computePlatformMetrics(input()).ingresos.trendMrr).toBeNull()
  })

  it('un trial sin fecha de fin cuenta como vencido, no como activo', () => {
    const m = computePlatformMetrics(input({
      hotels: [{ id: 'h1', name: 'Sin fecha', plan: 'host', status: 'active' }],
      subscriptions: [{ hotelId: 'h1', planId: 'plan-host', status: 'trialing' }],
    }))
    expect(m.trials.vencidos).toBe(1)
    expect(m.trials.activos).toBe(0)
  })
})

describe('computePlatformMetrics — trials y riesgo', () => {
  const escenario = input({
    hotels: [
      { id: 'v1', name: 'Cachela', plan: 'starter', status: 'active' },
      { id: 'v2', name: 'don Luis', plan: 'professional', status: 'active' },
      { id: 'p1', name: 'Playa bachata', plan: 'host', status: 'active' },
      { id: 'p2', name: 'Sander Seibo', plan: 'host', status: 'active' },
      { id: 'f1', name: 'Cobro fallido', plan: 'professional', status: 'active' },
      { id: 'n1', name: 'SolmiOS Corp', status: 'active' },
    ],
    subscriptions: [
      { hotelId: 'v1', planId: 'plan-starter', status: 'trialing', trialEndsAt: iso(-45) },
      { hotelId: 'v2', planId: 'plan-professional', status: 'trialing', trialEndsAt: iso(-1) },
      { hotelId: 'p1', planId: 'plan-host', status: 'trialing', trialEndsAt: iso(4) },
      { hotelId: 'p2', planId: 'plan-host', status: 'trialing', trialEndsAt: iso(15) },
      { hotelId: 'f1', planId: 'plan-professional', status: 'past_due' },
      { hotelId: 'n1', status: 'none' },
    ],
  })

  it('separa trial vigente, por vencer y ya vencido', () => {
    const m = computePlatformMetrics(escenario)
    expect(m.trials.vencidos).toBe(2)   // -45 y -1 días
    expect(m.trials.activos).toBe(2)    // +4 y +15 días
    expect(m.trials.porVencer).toBe(1)  // solo el de +4 entra en la ventana de 7 días
  })

  it('el MRR en riesgo suma trials vencidos y cobros fallidos', () => {
    const m = computePlatformMetrics(escenario)
    expect(m.ingresos.mrrEnRiesgo).toBe(129 + 349 + 349)
    expect(m.riesgo.vencidos).toBe(2)
    expect(m.riesgo.cobrosFallidos).toBe(1)
  })

  it('ordena el pipeline por urgencia comercial, no alfabéticamente', () => {
    const m = computePlatformMetrics(escenario)
    expect(m.pipeline.map((p) => p.motivo)).toEqual(['cobro_fallido', 'vencido', 'vencido', 'por_vencer', 'sin_plan'])
    // Dentro de "vencido", primero el que lleva más tiempo colgado.
    expect(m.pipeline[1].hotelName).toBe('Cachela')
    expect(m.pipeline[1].diasRestantes).toBe(-45)
  })

  it('un hotel sin suscripción entra al pipeline como sin_plan', () => {
    const m = computePlatformMetrics(escenario)
    const sinPlan = m.pipeline.find((p) => p.motivo === 'sin_plan')
    expect(sinPlan?.hotelName).toBe('SolmiOS Corp')
    expect(sinPlan?.planPrice).toBe(0)
  })
})

describe('computePlatformMetrics — conversión y clientes', () => {
  it('calcula la conversión solo sobre cohortes cerradas', () => {
    // 2 pagaron, 1 se venció, 1 quedó colgado con el trial vencido → 2 de 4.
    // El trial en curso NO entra: si contara, sumar un cliente nuevo bajaría la conversión.
    const m = computePlatformMetrics(input({
      hotels: [
        { id: 'a', name: 'A', plan: 'host', status: 'active' },
        { id: 'b', name: 'B', plan: 'host', status: 'active' },
        { id: 'c', name: 'C', plan: 'host', status: 'active' },
        { id: 'd', name: 'D', plan: 'host', status: 'active' },
        { id: 'e', name: 'E', plan: 'host', status: 'active' },
      ],
      subscriptions: [
        { hotelId: 'a', planId: 'plan-host', status: 'active' },
        { hotelId: 'b', planId: 'plan-host', status: 'active' },
        { hotelId: 'c', planId: 'plan-host', status: 'expired' },
        { hotelId: 'd', planId: 'plan-host', status: 'trialing', trialEndsAt: iso(-5) },
        { hotelId: 'e', planId: 'plan-host', status: 'trialing', trialEndsAt: iso(20) },
      ],
    }))
    expect(m.clientes.conversion).toBe(50)
  })

  it('sin cohortes cerradas la conversión es null, no 0%', () => {
    const m = computePlatformMetrics(input({
      hotels: [{ id: 'a', name: 'A', plan: 'host', status: 'active' }],
      subscriptions: [{ hotelId: 'a', planId: 'plan-host', status: 'trialing', trialEndsAt: iso(10) }],
    }))
    expect(m.clientes.conversion).toBeNull()
  })

  it("cuenta como activos los hoteles con status 'activo' en español", () => {
    const m = computePlatformMetrics(input({
      hotels: [
        { id: 'a', name: 'A', status: 'active' },
        { id: 'b', name: 'B', status: 'activo' },
        { id: 'c', name: 'C', status: 'suspended' },
      ],
    }))
    expect(m.clientes.activos).toBe(2)
    expect(m.clientes.total).toBe(3)
  })
})

describe('computePlatformMetrics — uso del producto', () => {
  it('marca sin uso a los hoteles sin reservas en 30 días, salvo los recién dados de alta', () => {
    const m = computePlatformMetrics(input({
      hotels: [
        { id: 'usa', name: 'Con actividad', plan: 'host', status: 'active', createdAt: iso(-200) },
        { id: 'zombi', name: 'Zombi', plan: 'host', status: 'active', createdAt: iso(-200) },
        { id: 'nunca', name: 'Nunca arrancó', plan: 'host', status: 'active', createdAt: iso(-200) },
        { id: 'nuevo', name: 'Recién dado de alta', plan: 'host', status: 'active', createdAt: iso(-3) },
      ],
      reservations: [
        { hotelId: 'usa', status: 'confirmed', totalAmount: 500, createdAt: iso(-2) },
        { hotelId: 'zombi', status: 'confirmed', totalAmount: 800, createdAt: iso(-90) },
      ],
    }))
    expect(m.sinUso.map((h) => h.name)).toEqual(['Nunca arrancó', 'Zombi'])
    expect(m.sinUso[0].diasSinActividad).toBeNull()
    expect(m.sinUso[1].diasSinActividad).toBe(90)
    expect(m.uso.volumen30d).toBe(500)
    expect(m.uso.reservas30d).toBe(1)
  })

  it('el volumen ignora reservas canceladas', () => {
    const m = computePlatformMetrics(input({
      reservations: [
        { hotelId: 'h', status: 'confirmed', totalAmount: 100, createdAt: iso(-1) },
        { hotelId: 'h', status: 'cancelled', totalAmount: 900, createdAt: iso(-1) },
      ],
    }))
    expect(m.uso.volumen30d).toBe(100)
  })
})

describe('computePlatformMetrics — actividad', () => {
  it('devuelve las entradas MÁS RECIENTES del audit log', () => {
    // El bug viejo: `findMany` sin orden + `.slice(0, 8)` mostraba las filas más viejas bajo el
    // título "Actividad Reciente" (en producción, todas "hace 68 d").
    const m = computePlatformMetrics(input({
      audit: [
        { id: 'viejo', action: 'login', createdAt: iso(-68) },
        { id: 'nuevo', action: 'create', createdAt: iso(-1) },
        { id: 'medio', action: 'update', createdAt: iso(-10) },
      ],
    }))
    expect(m.actividad.map((a) => a.id)).toEqual(['nuevo', 'medio', 'viejo'])
  })
})

describe('computePlatformMetrics — mix de planes', () => {
  it('agrupa por plan real y reporta el MRR cobrado de cada uno', () => {
    const m = computePlatformMetrics(input({
      hotels: [
        // 'enterprise' (slug) y 'cumbre' (nombre) son EL MISMO plan: el dashboard viejo los
        // mostraba como dos filas distintas en "Distribución por Plan".
        { id: 'a', name: 'A', plan: 'enterprise', status: 'active' },
        { id: 'b', name: 'B', plan: 'cumbre', status: 'active' },
        { id: 'c', name: 'C', plan: 'host', status: 'active' },
      ],
      subscriptions: [
        { hotelId: 'a', planId: 'plan-enterprise', status: 'active' },
        { hotelId: 'b', planId: 'plan-enterprise', status: 'trialing', trialEndsAt: iso(5) },
        { hotelId: 'c', planId: 'plan-host', status: 'active' },
      ],
    }))
    expect(m.planMix).toHaveLength(2)
    expect(m.planMix[0]).toMatchObject({ name: 'Cumbre', hoteles: 2, pagos: 1, trials: 1, mrr: 549 })
    expect(m.planMix[1]).toMatchObject({ name: 'Host', hoteles: 1, pagos: 1, mrr: 65 })
  })
})
