// PlanCatalog.service.test.ts — GH-31: un solo precio por plan, y sale de la DB.
//
// El bug: el mismo plan valía tres cosas distintas según la pantalla. La landing decía
// "USD 349" para Professional (`pages/landing/index.vue:461` del código viejo), hotel-fundador
// decía "USD 349 / USD 244", y la tabla `plans` del backend dice 99. /panel/suscripcion era la
// única que leía la API. Un visitante veía un número y al suscribirse le cobraban otro.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// El doble se controla con una función normal, no con `vi.fn()`: vitest trackea el resultado de
// un `vi.fn()` con un `.then()` propio y, cuando la implementación rechaza, ese derivado queda
// sin manejar y tumba el test aunque el código bajo prueba capture el error.
let publicPlansImpl: () => Promise<PublicPlan[]>
vi.mock('./Signup.service', () => ({
  SignupService: { publicPlans: () => publicPlansImpl() },
}))

import { type PublicPlan } from './Signup.service'
import {
  toDisplayPlan, fallbackPlans, loadDisplayPlans, formatPlanPrice, roomsLabel,
  PRICE_UNKNOWN_LABEL, PRICE_QUOTE_LABEL, PLAN_PRESENTATION,
} from './PlanCatalog.service'

const dbPlan = (over: Partial<PublicPlan> = {}): PublicPlan => ({
  id: 'plan-professional', name: 'Professional', slug: 'professional',
  price: 99, currency: 'USD', description: 'Para hoteles en crecimiento', features: [],
  ...over,
})

beforeEach(() => {
  publicPlansImpl = async () => []
})

describe('toDisplayPlan — el número que se pinta es el de la fila `plans`', () => {
  it('usa el precio y la moneda de la DB, no el copy de marketing', () => {
    const p = toDisplayPlan(dbPlan())
    expect(p.price).toBe(99)
    expect(p.priceLabel).toBe('USD 99')
    expect(p.priceKnown).toBe(true)
    // Regresión exacta del issue: el literal viejo de la landing.
    expect(p.priceLabel).not.toBe('USD 349')
  })

  it('respeta la moneda de la fila (no asume USD)', () => {
    expect(toDisplayPlan(dbPlan({ price: 5900, currency: 'DOP' })).priceLabel).toBe('DOP 5900')
  })

  it('precio 0 = plan a cotización, sin "/mes"', () => {
    const p = toDisplayPlan(dbPlan({ id: 'plan-ultra', name: 'Ultra', slug: 'ultra', price: 0 }))
    expect(p.quote).toBe(true)
    expect(p.priceLabel).toBe(PRICE_QUOTE_LABEL)
  })

  it('un plan que la DB publica y el front no tiene en su copy igual se pinta', () => {
    // Slug deliberadamente inexistente en `PLAN_PRESENTATION`: el caso es "la DB publicó un plan
    // nuevo y todavía nadie escribió su copy". Antes se usaba `host`, que desde COR-5 SÍ tiene copy
    // — el test habría dejado de probar lo que dice probar.
    expect(PLAN_PRESENTATION.recien_creado).toBeUndefined()
    const p = toDisplayPlan(dbPlan({ id: 'plan-nuevo', name: 'Recién Creado', slug: 'recien_creado', price: 29, description: 'Plan de entrada' }))
    expect(p.name).toBe('Recién Creado')
    expect(p.priceLabel).toBe('USD 29')
    expect(p.desc).toBe('Plan de entrada')
  })

  it('el copy de marketing sí sale del catálogo del front', () => {
    const p = toDisplayPlan(dbPlan())
    expect(p.color).toBe('purple')
    expect(p.featured).toBe(true)
    expect(p.features.length).toBeGreaterThan(0)
  })
})

describe('fallback — la landing nunca queda en blanco ni inventa un precio', () => {
  it('devuelve los planes con el precio marcado como desconocido', () => {
    const plans = fallbackPlans()
    // #30: mismo orden que decide el backend (precio ASC según el seed) — ultra $0 primero.
    expect(plans.map(p => p.slug)).toEqual(['ultra', 'host', 'starter', 'essential', 'professional', 'enterprise'])
    for (const p of plans) {
      expect(p.priceKnown).toBe(false)
      expect(p.price).toBeNull()
      expect(p.priceLabel).toBe(PRICE_UNKNOWN_LABEL)
      // Nada de resucitar los números viejos como "default".
      expect(p.priceLabel).not.toMatch(/\d/)
    }
  })

  it('la API caída cae al fallback y lo avisa, no explota', async () => {
    publicPlansImpl = async () => { throw new Error('network') }
    const res = await loadDisplayPlans()
    expect(res.fromApi).toBe(false)
    expect(res.plans.length).toBeGreaterThan(0)
  })

  it('sin planes publicados también cae al fallback', async () => {
    publicPlansImpl = async () => []
    const res = await loadDisplayPlans()
    expect(res.fromApi).toBe(false)
    expect(res.plans.length).toBeGreaterThan(0)
  })

  it('con planes, respeta el orden y los precios que mandó la API', async () => {
    publicPlansImpl = async () => [
      dbPlan({ id: 'plan-essential', name: 'Essential', slug: 'essential', price: 49 }),
      dbPlan(),
    ]
    const res = await loadDisplayPlans()
    expect(res.fromApi).toBe(true)
    expect(res.plans.map(p => p.priceLabel)).toEqual(['USD 49', 'USD 99'])
  })
})

describe('formatPlanPrice', () => {
  it('moneda vacía cae a USD antes que imprimir " 99"', () => {
    expect(formatPlanPrice(99, '')).toBe('USD 99')
  })
})

// ── CFG-1: el tope de habitaciones es un dato de la tabla `plans`, no copy ─────────────────────
//
// El bug: `PLAN_PRESENTATION` traía los topes hardcodeados y CONTRADECÍAN a la DB — starter decía
// "Hasta 50 habitaciones" contra `{rooms:30}` (backend/scripts/create-plans-table.ts:58) y
// enterprise "Hasta 200" contra `{rooms:9999}` (:60). Es el mismo patrón que este archivo dice
// cerrar para el precio, con el límite en vez del número de plata.
describe('roomsLabel — el tope sale de `plans.limits`', () => {
  it('usa el número de la DB y NO el literal del copy', () => {
    const p = toDisplayPlan(dbPlan({ slug: 'starter', name: 'Starter', limits: { rooms: 30 } }))
    expect(p.rooms).toBe('Hasta 30 habitaciones')
    expect(p.rooms).not.toBe('Hasta 50 habitaciones') // el hardcode viejo
  })

  it('el tope centinela del seed (9999) se muestra como ilimitado, no como "Hasta 200"', () => {
    const p = toDisplayPlan(dbPlan({ slug: 'enterprise', name: 'Enterprise', limits: { rooms: 9999 } }))
    expect(p.rooms).toBe('Habitaciones ilimitadas')
    expect(p.rooms).not.toBe('Hasta 200 habitaciones')
  })

  // CFG-2: quien decide "sin tope" es el servidor. Antes el 9999 estaba duplicado en el frontend:
  // subir el centinela del seed dejaba la landing anunciando "Hasta 99999 habitaciones".
  it('manda `roomsUnlimited` del servidor por encima del centinela local', () => {
    const p = toDisplayPlan(dbPlan({ slug: 'enterprise', name: 'Enterprise', limits: { rooms: 99999, roomsUnlimited: true } }))
    expect(p.rooms).toBe('Habitaciones ilimitadas')
  })

  it('si el servidor dice que NO es ilimitado, se respeta aunque el número sea grande', () => {
    expect(roomsLabel({ rooms: 12000, roomsUnlimited: false }, 'reserva')).toBe('Hasta 12000 habitaciones')
  })

  it('sin `limits` cae al copy de reserva, sin inventar un número', () => {
    const p = toDisplayPlan(dbPlan({ slug: 'professional' }))
    expect(p.rooms).toBe(PLAN_PRESENTATION.professional!.rooms)
  })

  it('un `rooms` basura no pinta "Hasta NaN habitaciones"', () => {
    expect(roomsLabel({ rooms: Number.NaN }, 'reserva')).toBe('reserva')
    expect(roomsLabel({ rooms: 0 }, 'reserva')).toBe('reserva')
    expect(roomsLabel(undefined, 'reserva')).toBe('reserva')
  })

  it('el copy de reserva NO contradice al seed de `plans.limits`', () => {
    // Un fallback que miente es el mismo hardcode, sólo que aparece cuando la API se cae.
    expect(PLAN_PRESENTATION.starter!.rooms).toBe('Hasta 30 habitaciones')
    expect(PLAN_PRESENTATION.enterprise!.rooms).toBe('Habitaciones ilimitadas')
    expect(PLAN_PRESENTATION.essential!.rooms).toBe('Hasta 20 habitaciones')
    expect(PLAN_PRESENTATION.professional!.rooms).toBe('Hasta 100 habitaciones')
  })

  // ── COR-5: `host` existe en el seed y faltaba en el catálogo del frontend ────────────────────
  // `backend/scripts/create-plans-table.ts:57` lo siembra con `sortOrder -1` (el más barato) y
  // `limits {rooms:10, users:1}`. Sin copy ni lugar en `FALLBACK_ORDER`, con la API caída el plan
  // de entrada directamente no aparecía en la landing.
  it('`host` tiene copy y su tope sigue al seed', () => {
    expect(PLAN_PRESENTATION.host).toBeDefined()
    expect(PLAN_PRESENTATION.host!.rooms).toBe('Hasta 10 habitaciones')
    expect(toDisplayPlan(dbPlan({ slug: 'host', name: 'Host', limits: { rooms: 10 } })).rooms).toBe('Hasta 10 habitaciones')
  })

  it('el fallback incluye TODOS los slugs sembrados y en orden de precio ASC (#30)', () => {
    const seeded = ['ultra', 'host', 'starter', 'essential', 'professional', 'enterprise']
    expect(fallbackPlans().map((p) => p.slug)).toEqual(seeded)
    // Y ninguno queda sin copy: `PLAN_PRESENTATION[slug]!` reventaría en runtime.
    for (const slug of seeded) expect(PLAN_PRESENTATION[slug]).toBeDefined()
  })
})
