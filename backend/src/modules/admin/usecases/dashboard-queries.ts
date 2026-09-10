import { computePlatformMetrics, type PlatformMetrics } from './platform-metrics'

/**
 * Precio de respaldo por plan, SOLO para hoteles cuyo `hotels.plan` de texto libre no matchea
 * ninguna fila de `plans`. La fuente de verdad es la tabla `plans` (ver `planPriceResolver`):
 * este mapa quedaba desactualizado contra el catálogo real (tenía Professional en 99 cuando
 * cuesta 349) y por eso el MRR del panel mostraba un número que no existía.
 */
const PLAN_PRICE_FALLBACK: Record<string, number> = { enterprise: 199, professional: 99, starter: 49, essential: 49 }
const BYTES_PER_MB = 1024 * 1024

export class DashboardQueries {
  constructor(private readonly orm: any) {}

  /**
   * Hoteles para el listado del super-admin, con el usuario al que se impersona desde la fila
   * (botón "Entrar" de `/admin/hotels`).
   *
   * El botón necesita un `userId`: la impersonación es SIEMPRE contra un usuario, nunca contra un
   * hotel (`usuarios/usecases/impersonate.ts` emite el token con el rol REAL de esa persona, que es
   * lo que sostiene el aislamiento por hotel). Así que acá se resuelve, por hotel, a quién entrar.
   *
   * Criterio de elección, en orden:
   *  1. Un `hotel_admin` activo — es el dueño de la cuenta y ve todo el panel.
   *  2. Si no hay, cualquier otro usuario activo del hotel: es preferible entrar como recepcionista
   *     a no poder entrar. La UI muestra el rol, así que el admin sabe con qué ojos está mirando.
   *  3. Nadie activo → `ownerUserId: null` y el frontend deshabilita el botón.
   *
   * Nunca un `super_admin`: `impersonateUser` lo rechaza con 403, así que ofrecerlo sería un botón
   * que falla al clickearlo.
   *
   * Desempate por `id` (no por `createdAt`, que puede faltar en filas viejas): con dos hotel_admin
   * el resultado tiene que ser el MISMO en cada request, o el botón entra a una cuenta distinta
   * según el orden que devuelva la base.
   *
   * Los usuarios se cargan UNA vez y se agrupan en un Map — una consulta por hotel adentro del loop
   * sería N+1 (mismo patrón que `listUsers`).
   */
  async listHotels(): Promise<{ data: any[]; total: number }> {
    const hotels = await this.orm.findMany('Hotels', {}) as any[]
    const users = await this.orm.findMany('Users', {}) as any[]

    const candidatesByHotel = new Map<string, any[]>()
    for (const u of users) {
      // `active` puede venir 1/0 (INTEGER en la base) o true/false: solo se descarta lo que es
      // explícitamente inactivo. Una fila vieja sin la columna se considera activa.
      if (!u.hotelId || u.role === 'super_admin' || u.active === 0 || u.active === false) continue
      const list = candidatesByHotel.get(u.hotelId)
      if (list) list.push(u)
      else candidatesByHotel.set(u.hotelId, [u])
    }

    const data = hotels.map((h: any) => {
      const candidates = candidatesByHotel.get(h.id) ?? []
      const sorted = [...candidates].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      const owner = sorted.find((u) => u.role === 'hotel_admin') ?? sorted[0] ?? null
      return {
        ...h,
        ownerUserId: owner?.id ?? null,
        ownerName: owner?.name ?? '',
        ownerRole: owner?.role ?? '',
      }
    })

    return { data, total: data.length }
  }

  /**
   * Usuarios para el listado del super-admin. Dos correcciones sobre la versión anterior:
   *
   * 1. `hotelName`: antes se devolvía la fila cruda, sin el nombre del hotel, y la pantalla
   *    `/super-admin/users` cae a `u.hotelName ?? 'Plataforma'` — o sea que la columna
   *    "Hotel / Propiedad" decía "Plataforma" para TODOS, incluso para el usuario de un hotel.
   *    Se resuelve con un `Map` de hoteles cargado UNA vez (mismo patrón que `listSubscriptions`);
   *    una consulta por usuario adentro del loop sería N+1. Sin `hotelId` (o con uno que ya no
   *    existe) queda `''` y el frontend muestra "Plataforma", que ahí sí es la verdad.
   *
   * 2. Campos sensibles: además de `password` se sacan `token`, `resetToken` y `resetExpires`.
   *    `resetToken` es el token de recuperación de contraseña: filtrarlo permite tomar la cuenta
   *    de cualquier usuario. Que solo lo vea un super admin no es motivo para que viaje.
   */
  async listUsers(): Promise<{ data: any[]; total: number }> {
    const users = await this.orm.findMany('Users', {}) as any[]
    const hotels = await this.orm.findMany('Hotels', {}) as any[]
    const hotelNameById = new Map(hotels.map((h: any) => [h.id, h.name]))

    const data = users.map((u: any) => {
      // Fuera todo lo que sirve para AUTENTICARSE como el usuario: la contraseña, el jti de
      // sesión, el token de recuperación (permite resetear la clave y tomar la cuenta), y el
      // `pinHash` del PIN de staff — son 6 dígitos, o sea 10^6 combinaciones: un hash filtrado
      // se crackea offline en segundos y habilita el login por PIN de esa persona.
      const { password, token, resetToken, resetExpires, pinHash, emailVerificationToken, emailVerificationExpires, ...rest } = u
      return { ...rest, hotelName: (u.hotelId && hotelNameById.get(u.hotelId)) || '' }
    })
    return { data, total: data.length }
  }

  /**
   * Suscripción REAL de cada hotel a la plataforma (tabla `subscriptions` + `plans`), no el
   * `hotels.plan` de texto libre con un precio inventado en `PLAN_PRICE`. Antes esta consulta
   * ignoraba por completo el módulo `subscriptions`: el super-admin veía "Pagado" para
   * cualquier hotel con estado `active` en `hotels` (nada que ver con el cobro de Stripe) y un
   * MRR que sumaba el precio de planes que nadie facturó. `mrr` acá solo cuenta lo que
   * REALMENTE está `active` en Stripe — `trialing`/`past_due`/`expired`/`canceled` no suman.
   */
  async listSubscriptions(): Promise<{ data: any[]; total: number; mrrTotal: number }> {
    const hotels = await this.orm.findMany('Hotels', {})
    const subs = await this.orm.findMany('Subscriptions', {}) as any[]
    const plans = await this.orm.findMany('Plans', {}) as any[]
    const subByHotel = new Map(subs.map((s: any) => [s.hotelId, s]))
    const planById = new Map(plans.map((p: any) => [p.id, p]))

    const data = hotels.map((h: any) => {
      const sub = subByHotel.get(h.id)
      const plan = sub?.planId ? planById.get(sub.planId) : undefined
      const status = sub?.status ?? 'none'
      return {
        hotelId: h.id,
        hotelName: h.name,
        status,
        planId: sub?.planId ?? '',
        planName: plan?.name ?? '',
        trialEndsAt: sub?.trialEndsAt ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        canceledAt: sub?.canceledAt ?? null,
        hasStripeCustomer: !!sub?.stripeCustomerId,
        mrr: status === 'active' ? Number(plan?.price ?? 0) : 0,
        specialCategory: sub?.specialCategory ?? null,
      }
    })
    return { data, total: data.length, mrrTotal: data.reduce((s: number, r: any) => s + r.mrr, 0) }
  }

  /**
   * Audit log ORDENADO por fecha descendente. `findMany` no garantiza orden, así que cualquier
   * consumidor que corte con `.slice(0, N)` para mostrar "lo último" se llevaba las filas más
   * VIEJAS de la tabla — que es lo que pasaba en la card "Actividad Reciente" del dashboard.
   */
  async listAuditLogs(): Promise<{ data: any[]; total: number }> {
    const rows = await this.orm.findMany('Auditlog', {}) as any[]
    const data = [...rows].sort(
      (a: any, b: any) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime(),
    )
    return { data, total: data.length }
  }

  async listAnnouncements(): Promise<{ data: any[]; total: number }> {
    const data = await this.orm.findMany('Announcements', {})
    return { data, total: data.length }
  }

  async getPublicUsers(): Promise<any[]> {
    // Seguridad (V6): endpoint público sin auth (alimenta los botones de login demo, pre-auth).
    // Solo expone usuarios DEMO (name/email/role, sin id ni credenciales). Fail-closed: en
    // producción, o si NODE_ENV no está seteado (deploy mal configurado), no devuelve nada salvo
    // DEMO_LOGIN=1 explícito. Así una config sin NODE_ENV no filtra la lista de cuentas demo.
    const env = process.env.NODE_ENV
    if ((env === 'production' || !env) && process.env.DEMO_LOGIN !== '1') return []
    const rows = (await this.orm.findMany('Users', { isDemo: 1, active: 1 })) as any[]
    return rows.filter((u: any) => u && u.email).map((u: any) => ({ name: u.name, email: u.email, role: u.role }))
  }

  /** Últimos N meses como buckets ordenados (viejo → nuevo). */
  private lastNMonths(n: number): { key: string; label: string }[] {
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const now = new Date()
    const out: { key: string; label: string }[] = []
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()] })
    }
    return out
  }

  /** Clave `YYYY-MM` de una fecha ISO; null si no parsea. */
  private monthKeyOf(raw: any): string | null {
    if (!raw) return null
    const d = new Date(String(raw))
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  async getAnalytics(): Promise<any> {
    const hs = await this.orm.findMany('Hotels', {})
    // El precio sale del catálogo real (`plans`), no de un mapa hardcodeado que quedó viejo:
    // Professional figuraba en 99 cuando cuesta 349 y "Cumbre" en 199 cuando cuesta 549.
    const planRows = await this.orm.findMany('Plans', {}) as any[]
    const priceOf = (raw: any): number => {
      const key = String(raw ?? '').trim().toLowerCase()
      const hit = planRows.find((p: any) => [p.id, p.slug, p.name].some((v: any) => String(v ?? '').trim().toLowerCase() === key))
      return Number(hit?.price ?? PLAN_PRICE_FALLBACK[key] ?? 49)
    }
    const us = await this.orm.findMany('Users', {})
    const rs = await this.orm.findMany('Reservations', {})
    const rooms = await this.orm.findMany('Rooms', {})
    // DT-14: P&L consolidado cross-hotel. Mismo criterio que el módulo `reports` (reservas
    // primaria + gastos, NO depende de que el hotel tenga contabilidad/accounting activado —
    // ese módulo es opt-in por hotel, esto tiene que andar para TODOS). "Neto" acá es una
    // aproximación operativa (revenue de reservas − gastos), no un P&L contable formal con
    // devengo/ITBIS — para eso está `contabilidad` por hotel, que si está activo, ya es exacto.
    const exps = await this.orm.findMany('Expenses', {})
    const MS_PER_DAY = 86_400_000
    const nights = (a: any, b: any): number => {
      if (!a || !b) return 0
      const d1 = new Date(String(a).slice(0, 10)).getTime()
      const d2 = new Date(String(b).slice(0, 10)).getTime()
      return d2 > d1 ? Math.round((d2 - d1) / MS_PER_DAY) : 0
    }
    // PC-2.2 — desglose por hotel con ocupación/ADR reales (cross-hotel)
    const hotelsBreakdown = hs.map((h: any) => {
      const hRooms = rooms.filter((r: any) => r.hotelId === h.id)
      const hRes = rs.filter((r: any) => r.hotelId === h.id && ['confirmed', 'checked_in'].includes(r.status))
      const revenue = hRes.reduce((s: number, r: any) => s + Number(r.totalAmount || 0), 0)
      const nightsSold = hRes.reduce((s: number, r: any) => s + nights(r.checkIn, r.checkOut), 0)
      // DT-14: gastos del hotel (todas las fuentes: manual/nómina/compras/etc — misma tabla
      // que lee `reports`, sin filtrar por `paid` porque el P&L es devengado, no de caja).
      const gastos = exps.filter((e: any) => e.hotelId === h.id).reduce((s: number, e: any) => s + Number(e.amount || 0), 0)
      return {
        id: h.id, name: h.name, plan: h.plan || 'essential', status: h.status || 'active',
        mrr: priceOf(h.plan),
        rooms: hRooms.length, reservations: hRes.length,
        occupancy: hRooms.length > 0 ? Math.min(100, Math.round((hRes.length / hRooms.length) * 100)) : 0,
        adr: nightsSold > 0 ? Math.round(revenue / nightsSold) : 0,
        revenue, gastos, neto: Math.round((revenue - gastos + Number.EPSILON) * 100) / 100,
      }
    })
    const activeBreakdown = hotelsBreakdown.filter((h: any) => h.status === 'active')
    const avgOccupancy = activeBreakdown.length > 0
      ? Math.round(activeBreakdown.reduce((s: number, h: any) => s + h.occupancy, 0) / activeBreakdown.length)
      : 0
    const totalRevenue = rs.reduce((s: number, r: any) => s + Number(r.totalAmount || 0), 0)
    const totalNightsSold = rs.reduce((s: number, r: any) => s + nights(r.checkIn, r.checkOut), 0)
    const avgADR = totalNightsSold > 0 ? Math.round(totalRevenue / totalNightsSold) : 0

    // Ingresos mensuales reales (últimos 6 meses) — suma de totalAmount de reservas activas por mes.
    // Se agrupa por createdAt (cuándo entró la reserva); si falta, cae a checkIn.
    const REVENUE_STATUSES = ['confirmed', 'checked_in', 'checked_out']
    const buckets = this.lastNMonths(6)
    const revByMonth: Record<string, number> = {}
    for (const r of rs) {
      if (!REVENUE_STATUSES.includes(r.status)) continue
      const key = this.monthKeyOf(r.createdAt) ?? this.monthKeyOf(r.checkIn)
      if (!key) continue
      revByMonth[key] = (revByMonth[key] || 0) + Number(r.totalAmount || 0)
    }
    const monthlyRevenue = buckets.map((b) => ({ label: b.label, value: Math.round(revByMonth[b.key] || 0) }))

    // MRR por plan (para el revenue de "Distribución por Plan")
    const byPlanRevenue: Record<string, number> = {}
    for (const h of hs) {
      const plan = String(h.plan || 'essential')
      byPlanRevenue[plan] = (byPlanRevenue[plan] || 0) + priceOf(plan)
    }

    // Trends reales: altas de este mes vs el anterior (crecimiento del período).
    const [prevKey, curKey] = [buckets[4].key, buckets[5].key]
    const createdIn = (rows: any[], key: string): number =>
      rows.filter((x: any) => this.monthKeyOf(x.createdAt) === key).length
    const pct = (cur: number, prev: number): number =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0)
    const trends = {
      hoteles: pct(createdIn(hs, curKey), createdIn(hs, prevKey)),
      usuarios: pct(createdIn(us, curKey), createdIn(us, prevKey)),
      reservas: pct(createdIn(rs, curKey), createdIn(rs, prevKey)),
      mrr: pct(monthlyRevenue[5].value, monthlyRevenue[4].value),
    }

    // DT-14: totales derivados de hotelsBreakdown (no de `rs`/`totalRevenue` de arriba — ese
    // suma TODAS las reservas sin filtrar por status, sería inconsistente con el desglose por
    // hotel de esta misma respuesta, que sí filtra confirmed/checked_in).
    const pnlConsolidado = {
      revenue: Math.round(hotelsBreakdown.reduce((s: number, h: any) => s + h.revenue, 0) * 100) / 100,
      gastos: Math.round(hotelsBreakdown.reduce((s: number, h: any) => s + h.gastos, 0) * 100) / 100,
      neto: Math.round(hotelsBreakdown.reduce((s: number, h: any) => s + h.neto, 0) * 100) / 100,
    }

    return {
      mrr: hs.reduce((s: number, h: any) => s + priceOf(h.plan), 0),
      totalHoteles: hs.length, totalUsuarios: us.length, totalReservas: rs.length,
      activeHotels: hs.filter((h: any) => h.status === 'active').length,
      byPlan: hs.reduce((a: any, h: any) => ((a[h.plan] = (a[h.plan] || 0) + 1), a), {}),
      byPlanRevenue,
      avgOccupancy, avgADR, hotelsBreakdown, pnlConsolidado,
      topByRevenue: [...hotelsBreakdown].sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 5),
      topByOccupancy: [...hotelsBreakdown].sort((a: any, b: any) => b.occupancy - a.occupancy).slice(0, 5),
      npsScore: 0, ticketPromedio: 0, monthlyRevenue, trends,
    }
  }

  /**
   * Métricas del negocio SaaS para el dashboard del super-admin. Es una consulta aparte de
   * `getAnalytics()` a propósito: aquella responde "cómo le va a los hoteles" (ocupación, ADR,
   * P&L) y esta responde "cómo le va a la plataforma" (MRR, trials, churn). Mezclarlas fue lo
   * que llevó a mostrar un MRR que en realidad era revenue de reservas.
   */
  async getPlatformMetrics(): Promise<PlatformMetrics> {
    const [hotels, subscriptions, plans, users, reservations, tickets, audit] = await Promise.all([
      this.orm.findMany('Hotels', {}),
      this.orm.findMany('Subscriptions', {}),
      this.orm.findMany('Plans', {}),
      this.orm.findMany('Users', {}),
      this.orm.findMany('Reservations', {}),
      this.orm.findMany('Tickets', {}),
      this.orm.findMany('Auditlog', {}),
    ])
    return computePlatformMetrics({
      hotels: hotels as any[], subscriptions: subscriptions as any[], plans: plans as any[],
      users: users as any[], reservations: reservations as any[], tickets: tickets as any[],
      audit: audit as any[],
    })
  }

  async getMonitoring(): Promise<any> {
    const tickets = await this.orm.findMany('Tickets', {}) as any[]
    return {
      hoteles: await this.orm.count('Hotels'),
      usuarios: await this.orm.count('Users'),
      reservas: await this.orm.count('Reservations'),
      ticketsAbiertos: tickets.filter((t: any) => t.status === 'open').length,
      ticketsEnProgreso: tickets.filter((t: any) => t.status === 'in_progress').length,
      ticketsUrgentes: tickets.filter((t: any) => t.priority === 'high' || t.priority === 'urgent').length,
      ticketsResueltos: tickets.filter((t: any) => t.status === 'closed').length,
      uptime: process.uptime(),
      memoria: Math.round(process.memoryUsage().rss / BYTES_PER_MB),
    }
  }
}
