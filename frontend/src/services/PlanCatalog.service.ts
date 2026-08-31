import { SignupService, type PublicPlan, type PublicPlanLimits } from './Signup.service'

/**
 * Catálogo de planes para las pantallas que los muestran (landing pública, Hotel Fundador y
 * la tarjeta "Plan" de Configuración).
 *
 * Regla (GH-31): **el precio y el nombre de un plan salen de la tabla `plans`**, vía
 * `GET /api/public/plans` — nunca de un literal en el template. Es la misma regla que ya rige
 * para impuestos y moneda en facturación (CLAUDE.md, "Facturación — reglas"). Antes había tres
 * juegos de precios distintos para el mismo plan (landing, hotel-fundador y settings) y ninguno
 * coincidía con la DB, así que un visitante veía USD 349 y al suscribirse le cobraban otra cosa.
 *
 * Lo único que vive acá es el **copy de marketing** (color, descripción y lista de beneficios):
 * eso no está en la DB y no es un dato de negocio.
 *
 * CFG-1: el **tope de habitaciones** SÍ es un dato de negocio y estaba hardcodeado acá,
 * contradiciendo a la tabla — starter decía "Hasta 50 habitaciones" contra `{rooms:30}`
 * (`backend/scripts/create-plans-table.ts:58`) y enterprise "Hasta 200" contra `{rooms:9999}`
 * (`:60`). Exactamente el mismo patrón que este archivo dice cerrar, con el límite en vez del
 * precio. Ahora sale de `plans.limits` (`GET /api/public/plans`) y el literal de abajo es sólo el
 * texto de reserva para cuando la API no contestó.
 */

/** Copy de marketing por slug de plan. Sin precio y sin nombre: esos son datos de la DB. */
export interface PlanPresentation {
  color: string
  /** SÓLO fallback: con la API arriba, el tope sale de `plans.limits`. */
  rooms: string
  desc: string
  features: string[]
  badge?: string
  featured?: boolean
}

/**
 * El slug es la clave real de la tabla `plans` (`backend/scripts/create-plans-table.ts`).
 * `rooms` acá es SÓLO el texto de reserva y está alineado con el seed de `plans.limits`: starter 30,
 * enterprise 9999 (ilimitado). Antes decía 50 y 200 — un fallback que contradice la tabla es la
 * misma mentira que el hardcode, sólo que aparece cuando la API se cae.
 */
export const PLAN_PRESENTATION: Record<string, PlanPresentation> = {
  // COR-5: `host` (#567) existe en el seed con `sortOrder -1` —es el plan MÁS barato— y no tenía
  // copy ni lugar en el fallback: con la API caída desaparecía de la landing. Los textos siguen al
  // seed (`limits {rooms:10, users:1}`, módulos planning/reservations/guests), no a un supuesto.
  host: {
    color: 'teal', rooms: 'Hasta 10 habitaciones',
    desc: 'Para apartamentos y alquileres turísticos que recién arrancan.',
    features: ['Planning de reservas', 'Check-in digital', 'Ficha de huéspedes', 'Motor de reservas básico', '1 usuario'],
  },
  essential: {
    color: 'navy', rooms: 'Hasta 20 habitaciones',
    desc: 'Para micro-hoteles, posadas y apartamentos turísticos.',
    features: ['PMS Central completo', 'Channel Manager (6+ OTAs)', 'Motor de reservas sin comisión', 'Creador de sitio web', 'Dashboard operativo', 'Facturación electrónica LATAM', 'Soporte por email'],
  },
  starter: {
    color: 'teal', rooms: 'Hasta 30 habitaciones',
    desc: 'Para hoteles boutique pequeños en crecimiento.',
    features: ['Todo lo del plan Essential', 'Recepción Digital (Check-In/Out online)', 'App SOLMI Staff para empleados', 'Housekeeping Inteligente', 'CRM y Fidelización básico', 'SOLMI Academy completa', 'Soporte prioritario'],
  },
  professional: {
    color: 'purple', rooms: 'Hasta 100 habitaciones',
    desc: 'La solución inteligente para hoteles y apartahoteles.',
    badge: 'Más Popular', featured: true,
    features: ['Todo lo del plan Starter', 'Recepcionista Virtual con IA', 'Revenue Manager con IA', 'Nómina Automatizada', 'Marketing Automatizado', 'Business Intelligence avanzado', 'API Abierta e integraciones', 'Soporte dedicado con SLA'],
  },
  enterprise: {
    color: 'gold', rooms: 'Habitaciones ilimitadas',
    desc: 'Para hoteles grandes y cadenas boutique.',
    features: ['Todo lo del plan Professional', 'Gerente Virtual con IA (briefings diarios)', 'Multipropiedad (hasta 3 propiedades)', 'Comunidad SOLMI (eventos y red)', 'App SOLMI Guest para huéspedes', 'Reportes ejecutivos consolidados', 'Account Manager dedicado', 'Onboarding premium incluido'],
  },
  ultra: {
    color: 'coral', rooms: '200+ hab. · Ilimitado',
    desc: 'Para cadenas regionales, grupos hoteleros y franquicias.',
    badge: 'Premium',
    features: ['Todos los 27 módulos sin límite', 'Multipropiedad ilimitada', 'Gerente Virtual IA personalizado', 'Integraciones a medida', 'Capacitación presencial', 'SLA < 1 hora de respuesta', 'Gerente de cuenta ejecutivo dedicado', 'Precio según volumen de propiedades'],
  },
}

/**
 * Orden de los planes cuando la API no contestó y hay que mostrar algo igual: el MISMO que
 * decide el backend (#30), del más barato al más caro según el seed
 * (`backend/scripts/create-plans-table.ts`): host 29, essential 39, starter 49, professional 99,
 * enterprise 199. COR-5: `host` faltaba y la landing caída escondía el plan de entrada.
 * Essential va ANTES que Starter (auditoría Meta 2026-08-26): Starter dice "Todo lo del plan
 * Essential" en su copy — para que la promesa tenga sentido, Essential tiene que ser el más barato.
 * `ultra` (a cotización, sin precio numérico) va AL FINAL — pedido del cliente sobre #30: con
 * precio ASC el $0 salía primero, pero comparar precio recién tiene sentido entre los planes que
 * sí muestran un número; "a cotización" es la salida de escape, no la puerta de entrada.
 */
const FALLBACK_ORDER = ['host', 'essential', 'starter', 'professional', 'enterprise', 'ultra']

/** Lo que la API pudo no haber contestado se muestra así — nunca un número inventado. */
export const PRICE_UNKNOWN_LABEL = 'Consultar'
/** Precio 0 en la tabla `plans` = plan a cotización (el caso de `ultra`). */
export const PRICE_QUOTE_LABEL = 'A cotización'
/**
 * CFG-2: la casilla de ventas sale del build (`VITE_SALES_EMAIL`), no de un literal. Cambiarla no
 * puede exigir un cambio de código; el default sólo evita un `mailto:` vacío si falta la variable.
 */
export const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || 'ventas@solmios.com'
export const SALES_MAILTO = `mailto:${SALES_EMAIL}`

/**
 * CFG-2: el centinela de "sin tope" lo decide el SERVIDOR (`publicLimits` manda
 * `limits.roomsUnlimited` ya resuelto contra `UNLIMITED_LIMIT_SENTINEL`). Esta constante quedó
 * SÓLO como respaldo para una respuesta vieja sin ese campo: mientras el 9999 estaba duplicado
 * acá, subir el centinela del seed dejaba la landing anunciando "Hasta 9999 habitaciones".
 */
export const UNLIMITED_ROOMS_FALLBACK_THRESHOLD = 9999

/**
 * Tope de habitaciones tal como se muestra. Sale de la DB; el copy local es sólo el fallback.
 * Un `rooms` ausente o no numérico NO inventa un número: cae al texto de reserva.
 */
export function roomsLabel(limits: PublicPlanLimits | undefined, fallback: string): string {
  const rooms = Number(limits?.rooms)
  if (!Number.isFinite(rooms) || rooms <= 0) return fallback
  const unlimited = limits?.roomsUnlimited ?? rooms >= UNLIMITED_ROOMS_FALLBACK_THRESHOLD
  if (unlimited) return 'Habitaciones ilimitadas'
  return `Hasta ${rooms} habitaciones`
}

/** Un plan listo para pintar: datos de la DB + copy de marketing, ya resueltos. */
export interface DisplayPlan {
  id: string
  name: string
  slug: string
  /** Precio mensual de la DB. `null` si la API no respondió. */
  price: number | null
  currency: string
  /** Texto ya formateado ("USD 99", "A cotización" o "Consultar"). */
  priceLabel: string
  /** `false` cuando el precio no pudo leerse de la DB — la vista lo tiene que decir. */
  priceKnown: boolean
  /** Plan a cotización: no se contrata online, va a ventas. */
  quote: boolean
  color: string
  rooms: string
  desc: string
  features: string[]
  badge?: string
  featured?: boolean
}

export function formatPlanPrice(price: number, currency: string): string {
  return `${currency || 'USD'} ${price}`
}

/** Fila de `plans` + copy → tarjeta. Un plan nuevo en la DB sin copy usa el suyo propio. */
export function toDisplayPlan(p: PublicPlan): DisplayPlan {
  const pres = PLAN_PRESENTATION[p.slug]
  const price = Number(p.price)
  const known = Number.isFinite(price)
  const quote = known && price <= 0
  return {
    id: p.id || p.slug,
    name: p.name,
    slug: p.slug,
    price: known ? price : null,
    currency: p.currency || 'USD',
    priceLabel: !known ? PRICE_UNKNOWN_LABEL : quote ? PRICE_QUOTE_LABEL : formatPlanPrice(price, p.currency),
    priceKnown: known,
    quote,
    color: pres?.color ?? 'navy',
    // CFG-1: el tope viene de `plans.limits`; `pres.rooms` es sólo el texto de reserva.
    rooms: roomsLabel(p.limits, pres?.rooms ?? ''),
    desc: pres?.desc ?? p.description ?? '',
    // `plans.features` guarda el resumen de topes ("30 habitaciones", "2 usuarios"), no los
    // beneficios comerciales: el copy de marketing manda y la fila de la DB queda de respaldo
    // para un plan nuevo que todavía no tenga copy. La precedencia es explícita a propósito.
    features: pres?.features ?? (p.features as string[] | undefined) ?? [],
    badge: pres?.badge,
    featured: pres?.featured,
  }
}

/**
 * Qué mostrar si `/api/public/plans` no contesta. La landing es la puerta de entrada: dejarla
 * en blanco pierde al visitante. Se muestra el copy con el precio marcado como desconocido —
 * mentir con un precio viejo es peor que decir "Consultar".
 */
export function fallbackPlans(): DisplayPlan[] {
  return FALLBACK_ORDER.map((slug) => {
    const pres = PLAN_PRESENTATION[slug]!
    return {
      id: slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      slug,
      price: null,
      currency: 'USD',
      priceLabel: PRICE_UNKNOWN_LABEL,
      priceKnown: false,
      // `ultra` es a cotización por definición del producto, no por el precio de la DB.
      quote: slug === 'ultra',
      color: pres.color,
      rooms: pres.rooms,
      desc: pres.desc,
      features: pres.features,
      badge: pres.badge,
      featured: pres.featured,
    }
  })
}

export interface LoadPlansResult {
  plans: DisplayPlan[]
  /** `false` = se está mostrando el fallback (API caída o sin planes publicados). */
  fromApi: boolean
}

/** Planes publicados, ya listos para pintar. Nunca lanza: la landing no puede quedar vacía. */
export async function loadDisplayPlans(): Promise<LoadPlansResult> {
  try {
    const list = await SignupService.publicPlans()
    if (!list.length) return { plans: fallbackPlans(), fromApi: false }
    return { plans: list.map(toDisplayPlan), fromApi: true }
  } catch {
    return { plans: fallbackPlans(), fromApi: false }
  }
}

/**
 * STR-D: fachada con el mismo nombre-objeto que el resto de los `*.service.ts` del panel
 * (`XxxService.metodo()`). Este archivo era el único de los 84 que sólo exportaba funciones
 * sueltas, y esa asimetría es la que hace que alguien no lo encuentre y vuelva a escribir el
 * catálogo a mano en una vista nueva.
 *
 * La consumen las TRES vistas del catálogo — `pages/landing`, `pages/hotel-fundador` y
 * `pages/settings` —: una fachada que nadie usa es código muerto, no un punto de entrada. Las
 * exportaciones nombradas siguen existiendo porque son la unidad que testea
 * `PlanCatalog.service.test.ts`.
 */
export const PlanCatalogService = {
  load: loadDisplayPlans,
  fallback: fallbackPlans,
  toDisplay: toDisplayPlan,
  formatPrice: formatPlanPrice,
  roomsLabel,
}
