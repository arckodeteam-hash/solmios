/**
 * Métricas de la PLATAFORMA para el dashboard del super-admin (`/admin`).
 *
 * Existe porque `getAnalytics()` mezclaba dos negocios distintos en la misma respuesta: lo que la
 * plataforma le cobra al hotel (suscripciones) y lo que el hotel le cobra al huésped (reservas).
 * El dashboard terminaba mostrando "MRR" que en realidad era un precio inventado multiplicado por
 * la cantidad de hoteles, y ocupación/ADR que al dueño del SaaS no le dicen nada.
 *
 * Reglas que sostienen los números de acá:
 *
 *  1. **El precio SIEMPRE sale de la tabla `plans`.** Nunca de un mapa hardcodeado. El mapa viejo
 *     (`PLAN_PRICE` en dashboard-queries.ts) tenía Professional en 99 cuando el plan real cuesta
 *     349 y Enterprise en 199 cuando "Cumbre" cuesta 549: el MRR que se mostraba no existía.
 *
 *  2. **MRR es solo lo que está `active`.** Un trial no es plata cobrada. Se reporta aparte como
 *     `mrrEnTrial` (pipeline), que es información útil pero no ingreso.
 *
 *  3. **Un trial vencido que sigue en `trialing` es plata parada, no un cliente.** Nadie lo cortó
 *     ni lo convirtió. Es el dato más accionable del panel y por eso tiene su propia lista.
 *
 *  4. **`hotels.status` viene sucio**: hay filas con `'activo'` (español) además de `'active'`.
 *     Por eso el conteo del dashboard daba 15 y el del sidebar 17 sobre los mismos hoteles.
 *     Se normaliza acá en vez de arrastrar la discrepancia a la pantalla.
 *
 * La función de cálculo es pura (recibe filas, devuelve números) para poder testearla sin base.
 */

const DAY_MS = 86_400_000
/** Un trial que vence dentro de estos días entra en la lista de "por vencer". */
const TRIAL_WARN_DAYS = 7
/** Hotel sin reservas nuevas en este lapso = no está usando el producto (churn que viene). */
const IDLE_DAYS = 30
/** Un hotel recién dado de alta todavía está en onboarding: no se lo marca inactivo. */
const ONBOARDING_GRACE_DAYS = 14
const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
/** Estados de reserva que representan plata real movida por el hotel. */
const REVENUE_STATUSES = ['confirmed', 'checked_in', 'checked_out']

export interface PlanRow { id: string; name: string; slug?: string; price: number; isActive?: number }
export interface HotelRow { id: string; name: string; plan?: string; status?: string; createdAt?: string }
export interface SubRow {
  hotelId: string; planId?: string; status: string
  trialEndsAt?: string | null; currentPeriodEnd?: string | null; canceledAt?: string | null
  stripeCustomerId?: string | null
}
export interface ReservationRow { hotelId: string; status?: string; totalAmount?: number; createdAt?: string; checkIn?: string }
export interface TicketRow { status?: string; priority?: string }
export interface AuditRow { id: string; action?: string; userName?: string; entity?: string; detail?: string; createdAt?: string }

export interface PlatformMetricsInput {
  hotels: HotelRow[]
  subscriptions: SubRow[]
  plans: PlanRow[]
  users: { createdAt?: string }[]
  reservations: ReservationRow[]
  tickets: TicketRow[]
  audit: AuditRow[]
  now?: number
}

export type PipelineMotivo = 'vencido' | 'por_vencer' | 'cobro_fallido' | 'sin_plan'

export interface PipelineItem {
  hotelId: string
  hotelName: string
  planName: string
  planPrice: number
  status: string
  /** Días hasta el fin del trial. Negativo = vencido hace N días. Null = sin fecha. */
  diasRestantes: number | null
  motivo: PipelineMotivo
  tieneStripe: boolean
}

export interface PlanMixItem { id: string; name: string; price: number; hoteles: number; pagos: number; trials: number; mrr: number }
export interface IdleHotelItem { id: string; name: string; planName: string; diasSinActividad: number | null }
export interface SerieItem { label: string; altas: number; volumen: number }
export interface ActivityItem { id: string; action: string; userName: string; entity: string; detail: string; createdAt: string }

export interface PlatformMetrics {
  ingresos: {
    mrr: number
    arr: number
    arpu: number
    clientesPagos: number
    mrrEnTrial: number
    mrrEnRiesgo: number
    conPagoConfigurado: number
    trendMrr: number | null
  }
  clientes: {
    total: number
    activos: number
    inactivos: number
    altasMes: number
    altasMesAnterior: number
    trendAltas: number
    conversion: number | null
  }
  trials: { activos: number; vencidos: number; porVencer: number }
  riesgo: { total: number; vencidos: number; cobrosFallidos: number; expirados: number; cancelados: number }
  pipeline: PipelineItem[]
  planMix: PlanMixItem[]
  sinUso: IdleHotelItem[]
  serie: SerieItem[]
  uso: { volumen30d: number; reservas30d: number; hotelesConActividad: number }
  soporte: { urgentes: number; abiertos: number; enProgreso: number; resueltos: number }
  actividad: ActivityItem[]
}

/** `'activo'` (dato sucio en la base) y `'active'` son el mismo estado. */
export function normalizeHotelStatus(raw: unknown): string {
  const s = String(raw ?? 'active').trim().toLowerCase()
  if (s === 'activo' || s === 'active' || s === '') return 'active'
  if (s === 'inactivo') return 'inactive'
  if (s === 'suspendido') return 'suspended'
  return s
}

function normKey(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

/**
 * Plan real del hotel. Prioridad: el `planId` de la suscripción (es el que se está facturando)
 * y, si no hay, el `hotels.plan` de texto libre — que puede traer el id (`plan-host`), el slug
 * (`host`) o el nombre (`cumbre`), porque nunca se normalizó. Sin match no se inventa precio:
 * devuelve null y el hotel aparece como "sin plan" en vez de sumar un importe que no existe.
 */
export function resolvePlan(hotel: HotelRow, sub: SubRow | undefined, plans: PlanRow[]): PlanRow | null {
  if (sub?.planId) {
    const byId = plans.find((p) => p.id === sub.planId)
    if (byId) return byId
  }
  const raw = normKey(hotel.plan)
  if (!raw) return null
  return plans.find((p) => normKey(p.id) === raw || normKey(p.slug) === raw || normKey(p.name) === raw) ?? null
}

function monthKey(raw: unknown): string | null {
  if (!raw) return null
  const d = new Date(String(raw))
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function lastNMonths(n: number, now: number): { key: string; label: string }[] {
  const ref = new Date(now)
  const out: { key: string; label: string }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS_ES[d.getMonth()] })
  }
  return out
}

function daysUntil(iso: unknown, now: number): number | null {
  if (!iso) return null
  const t = new Date(String(iso)).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - now) / DAY_MS)
}

function pct(cur: number, prev: number): number {
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100)
  return cur > 0 ? 100 : 0
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function computePlatformMetrics(input: PlatformMetricsInput): PlatformMetrics {
  const now = input.now ?? Date.now()
  const { hotels, subscriptions, plans, reservations, tickets, audit } = input

  const subByHotel = new Map<string, SubRow>(subscriptions.map((s) => [s.hotelId, s]))

  // ─── Una pasada por hotel: plan real, estado de la suscripción y urgencia comercial ───
  let mrr = 0
  let mrrEnTrial = 0
  let mrrEnRiesgo = 0
  let clientesPagos = 0
  let conPagoConfigurado = 0
  let trialsActivos = 0
  let trialsVencidos = 0
  let trialsPorVencer = 0
  let cobrosFallidos = 0
  let expirados = 0
  let cancelados = 0
  const pipeline: PipelineItem[] = []
  const planMix = new Map<string, PlanMixItem>()

  for (const h of hotels) {
    const sub = subByHotel.get(h.id)
    const plan = resolvePlan(h, sub, plans)
    const price = Number(plan?.price ?? 0)
    const status = sub?.status ?? 'none'
    const dias = daysUntil(sub?.trialEndsAt, now)
    const tieneStripe = !!sub?.stripeCustomerId

    if (plan) {
      const mix = planMix.get(plan.id) ?? { id: plan.id, name: plan.name, price, hoteles: 0, pagos: 0, trials: 0, mrr: 0 }
      mix.hoteles += 1
      if (status === 'active') { mix.pagos += 1; mix.mrr += price }
      if (status === 'trialing') mix.trials += 1
      planMix.set(plan.id, mix)
    }

    if (status === 'active') {
      mrr += price
      clientesPagos += 1
      if (tieneStripe) conPagoConfigurado += 1
      continue
    }

    if (status === 'trialing') {
      mrrEnTrial += price
      // `dias === null` (trial sin fecha) se trata como vencido: no hay nada que lo sostenga y
      // dejarlo pasar como "activo" es justamente cómo se acumularon los trials eternos.
      if (dias === null || dias < 0) {
        trialsVencidos += 1
        mrrEnRiesgo += price
        pipeline.push({ hotelId: h.id, hotelName: h.name, planName: plan?.name ?? 'Sin plan', planPrice: price, status, diasRestantes: dias, motivo: 'vencido', tieneStripe })
      } else {
        trialsActivos += 1
        if (dias <= TRIAL_WARN_DAYS) {
          trialsPorVencer += 1
          pipeline.push({ hotelId: h.id, hotelName: h.name, planName: plan?.name ?? 'Sin plan', planPrice: price, status, diasRestantes: dias, motivo: 'por_vencer', tieneStripe })
        }
      }
      continue
    }

    if (status === 'past_due') {
      // El cobro falló pero todavía no se cortó: ese MRR está por caerse, no es ingreso firme.
      cobrosFallidos += 1
      mrrEnRiesgo += price
      pipeline.push({ hotelId: h.id, hotelName: h.name, planName: plan?.name ?? 'Sin plan', planPrice: price, status, diasRestantes: dias, motivo: 'cobro_fallido', tieneStripe })
      continue
    }

    if (status === 'expired') { expirados += 1; continue }
    if (status === 'canceled') { cancelados += 1; continue }

    // `none` — hotel sin suscripción: está usando el sistema sin contrato.
    pipeline.push({ hotelId: h.id, hotelName: h.name, planName: plan?.name ?? 'Sin plan', planPrice: price, status, diasRestantes: null, motivo: 'sin_plan', tieneStripe })
  }

  // Orden del pipeline = urgencia comercial, no alfabético: primero lo que ya se venció (y de
  // eso, lo más viejo), después lo que vence en días, al final lo que no tiene contrato.
  const MOTIVO_ORDEN: Record<PipelineMotivo, number> = { cobro_fallido: 0, vencido: 1, por_vencer: 2, sin_plan: 3 }
  pipeline.sort((a, b) => {
    const byMotivo = MOTIVO_ORDEN[a.motivo] - MOTIVO_ORDEN[b.motivo]
    if (byMotivo !== 0) return byMotivo
    const da = a.diasRestantes ?? 0
    const db = b.diasRestantes ?? 0
    if (da !== db) return da - db
    return b.planPrice - a.planPrice
  })

  // ─── Clientes ───
  const hotelesActivos = hotels.filter((h) => normalizeHotelStatus(h.status) === 'active').length
  const buckets = lastNMonths(6, now)
  const curKey = buckets[buckets.length - 1].key
  const prevKey = buckets[buckets.length - 2].key
  const altasMes = hotels.filter((h) => monthKey(h.createdAt) === curKey).length
  const altasMesAnterior = hotels.filter((h) => monthKey(h.createdAt) === prevKey).length

  // Conversión sobre cohortes CERRADAS: solo cuentan los que ya terminaron la prueba (pagaron,
  // se vencieron o se dieron de baja). Meter los trials en curso en el denominador haría que la
  // conversión bajara cada vez que entra un cliente nuevo, que es exactamente al revés.
  const cohorteCerrada = clientesPagos + expirados + cancelados + trialsVencidos
  const conversion = cohorteCerrada > 0 ? Math.round((clientesPagos / cohorteCerrada) * 100) : null

  // ─── Uso real del producto (señal temprana de churn) ───
  const ultimaReservaPorHotel = new Map<string, number>()
  let volumen30d = 0
  let reservas30d = 0
  const volumenPorMes: Record<string, number> = {}
  for (const r of reservations) {
    const t = new Date(String(r.createdAt ?? r.checkIn ?? '')).getTime()
    if (!Number.isNaN(t)) {
      const prev = ultimaReservaPorHotel.get(r.hotelId) ?? 0
      if (t > prev) ultimaReservaPorHotel.set(r.hotelId, t)
    }
    if (!REVENUE_STATUSES.includes(String(r.status))) continue
    const monto = Number(r.totalAmount || 0)
    const k = monthKey(r.createdAt) ?? monthKey(r.checkIn)
    if (k) volumenPorMes[k] = (volumenPorMes[k] || 0) + monto
    if (!Number.isNaN(t) && now - t <= IDLE_DAYS * DAY_MS) { volumen30d += monto; reservas30d += 1 }
  }

  const sinUso: IdleHotelItem[] = []
  for (const h of hotels) {
    if (normalizeHotelStatus(h.status) !== 'active') continue
    const alta = new Date(String(h.createdAt ?? '')).getTime()
    if (!Number.isNaN(alta) && now - alta < ONBOARDING_GRACE_DAYS * DAY_MS) continue
    const ultima = ultimaReservaPorHotel.get(h.id)
    const dias = ultima ? Math.floor((now - ultima) / DAY_MS) : null
    if (dias !== null && dias < IDLE_DAYS) continue
    const plan = resolvePlan(h, subByHotel.get(h.id), plans)
    sinUso.push({ id: h.id, name: h.name, planName: plan?.name ?? 'Sin plan', diasSinActividad: dias })
  }
  // Sin actividad nunca (null) primero: son los que jamás arrancaron.
  sinUso.sort((a, b) => (b.diasSinActividad ?? Number.MAX_SAFE_INTEGER) - (a.diasSinActividad ?? Number.MAX_SAFE_INTEGER))

  const serie: SerieItem[] = buckets.map((b) => ({
    label: b.label,
    altas: hotels.filter((h) => monthKey(h.createdAt) === b.key).length,
    volumen: Math.round(volumenPorMes[b.key] || 0),
  }))

  // ─── Soporte ───
  const soporte = {
    urgentes: tickets.filter((t) => t.priority === 'high' || t.priority === 'urgent').length,
    abiertos: tickets.filter((t) => t.status === 'open').length,
    enProgreso: tickets.filter((t) => t.status === 'in_progress').length,
    resueltos: tickets.filter((t) => t.status === 'closed').length,
  }

  // ─── Actividad: las MÁS RECIENTES. Antes se hacía `.slice(0, 8)` sobre un findMany sin orden,
  // así que la card "Actividad Reciente" mostraba las filas más viejas de la tabla.
  const actividad: ActivityItem[] = [...audit]
    .sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime())
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      action: r.action ?? 'Actividad',
      userName: r.userName ?? '',
      entity: r.entity ?? '',
      detail: r.detail ?? '',
      createdAt: r.createdAt ?? '',
    }))

  return {
    ingresos: {
      mrr: round2(mrr),
      arr: round2(mrr * 12),
      arpu: clientesPagos > 0 ? round2(mrr / clientesPagos) : 0,
      clientesPagos,
      mrrEnTrial: round2(mrrEnTrial),
      mrrEnRiesgo: round2(mrrEnRiesgo),
      conPagoConfigurado,
      // El MRR histórico no se guarda en ningún lado (no hay tabla de eventos de suscripción),
      // así que no se puede calcular una variación honesta. Null y la UI no dibuja la flecha,
      // en vez de mostrar el crecimiento de OTRA métrica como venía pasando.
      trendMrr: null,
    },
    clientes: {
      total: hotels.length,
      activos: hotelesActivos,
      inactivos: hotels.length - hotelesActivos,
      altasMes,
      altasMesAnterior,
      trendAltas: pct(altasMes, altasMesAnterior),
      conversion,
    },
    trials: { activos: trialsActivos, vencidos: trialsVencidos, porVencer: trialsPorVencer },
    riesgo: {
      total: trialsVencidos + cobrosFallidos + expirados,
      vencidos: trialsVencidos,
      cobrosFallidos,
      expirados,
      cancelados,
    },
    pipeline,
    planMix: [...planMix.values()].sort((a, b) => b.mrr - a.mrr || b.hoteles - a.hoteles),
    sinUso,
    serie,
    uso: { volumen30d: Math.round(volumen30d), reservas30d, hotelesConActividad: ultimaReservaPorHotel.size },
    soporte,
    actividad,
  }
}
