// pages/restaurante/salon-helpers.ts — Lógica pura del mapa de mesas (#204), separada de salon.vue para
// testearla sin montar la página: pestañas por zona, estado visual de la mesa, "hace N min", mozo.
import type { PillTab } from '@/components/ui/PillTabs.vue'
import type { Order, RestaurantTable } from '@/services/Restaurant.service'

// Estados "vivos" de una comanda (aún operable). El resto (paid/charged/cancelled/refunded) ya cerró.
// fix-refund-pos-card: 'processing_payment' también es viva — la mesa sigue tomada mientras la
// Checkout Session de Stripe está abierta (recién se libera al confirmar o al expirar).
export const LIVE_ORDER_STATUSES = ['open', 'sent', 'preparing', 'ready', 'served', 'billed', 'processing_payment'] as const
export const isLiveOrder = (o: Pick<Order, 'status'>): boolean => (LIVE_ORDER_STATUSES as readonly string[]).includes(o.status)

export const ALL_TAB = 'all'
export const LOOSE_TAB = 'loose'
export const DEFAULT_ZONE = 'General'

/** Nombre de zona normalizado: sin espacios de borde, vacío → "General". */
export const zoneOf = (t: Pick<RestaurantTable, 'zone'>): string => t.zone?.trim() || DEFAULT_ZONE

/** Slug estable para `?tab=` (Terraza → terraza, "Salón principal" → salon-principal). */
export function zoneSlug(zone: string): string {
  const s = zone.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'zona'
}

export interface ZoneGroup { zone: string; slug: string; list: RestaurantTable[] }

/** Mesas agrupadas por zona, en orden de aparición (las mesas ya vienen ordenadas por nombre). */
export function groupByZone(tables: RestaurantTable[]): ZoneGroup[] {
  const map = new Map<string, RestaurantTable[]>()
  for (const t of tables) {
    const z = zoneOf(t)
    const arr = map.get(z) ?? []
    arr.push(t)
    map.set(z, arr)
  }
  return [...map.entries()].map(([zone, list]) => ({ zone, slug: zoneSlug(zone), list }))
}

/**
 * Pestañas del salón: `Todas (n) · <zona> (n)… · Sin mesa (n)`. Con una sola zona no se lista (sería
 * idéntica a "Todas"). "Sin mesa" siempre está: room service / para llevar no tienen zona, y un enlace
 * `?tab=loose` tiene que abrir aunque hoy haya 0.
 */
export function zoneTabs(tables: RestaurantTable[], looseCount: number): PillTab[] {
  const groups = groupByZone(tables)
  const tabs: PillTab[] = [{ value: ALL_TAB, label: 'Todas', count: tables.length }]
  if (groups.length > 1) for (const g of groups) tabs.push({ value: g.slug, label: g.zone, count: g.list.length })
  tabs.push({ value: LOOSE_TAB, label: 'Sin mesa', count: looseCount })
  return tabs
}

export type TableVisualState = 'ordering' | 'occupied-no-order' | 'reserved' | 'free'

/**
 * Estado visual de la mesa. La comanda viva manda; sin comanda, el `status` manual: `occupied` a mano
 * (sin comanda) se distingue de una libre y de una con comanda — antes se pintaba de libre.
 */
export function tableState(t: Pick<RestaurantTable, 'status'>, order: Order | undefined): TableVisualState {
  if (order) return 'ordering'
  if (t.status === 'reserved') return 'reserved'
  if (t.status === 'occupied') return 'occupied-no-order'
  return 'free'
}

export const TABLE_STATE_CLASSES: Record<TableVisualState, string> = {
  ordering: 'bg-gold/10 border-gold text-navy',
  'occupied-no-order': 'bg-warning/10 border-warning text-navy',
  reserved: 'bg-navy/5 border-navy/40 text-navy',
  free: 'bg-teal/10 border-teal text-navy',
}

export const TABLE_STATE_LABELS: Record<TableVisualState, string> = {
  ordering: 'Ocupada',
  'occupied-no-order': 'Ocupada (sin comanda)',
  reserved: 'Reservada',
  free: 'Libre',
}

/** "hh:mm" local de un ISO; vacío si no parsea. */
export function hhmm(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

/**
 * Tiempo transcurrido desde `iso` hasta `now`: "recién", "hace 3 min", "hace 1 h 20 min", "hace 2 d 3 h".
 * Pasado el día ya no importan los minutos: una comanda que quedó abierta hace semanas (visto en prod)
 * se lee "hace 37 d", no "hace 906 h 16 min".
 */
export function elapsedLabel(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.floor((now - t) / 60_000))
  if (mins < 1) return 'recién'
  if (mins < MINUTES_PER_HOUR) return `hace ${mins} min`
  const hours = Math.floor(mins / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) {
    const m = mins % MINUTES_PER_HOUR
    return m ? `hace ${hours} h ${m} min` : `hace ${hours} h`
  }
  const days = Math.floor(hours / HOURS_PER_DAY)
  const h = hours % HOURS_PER_DAY
  return h ? `hace ${days} d ${h} h` : `hace ${days} d`
}

/** "actualizado hace Ns" del indicador de refresco. */
export function updatedAgoLabel(lastUpdated: number | null, now: number): string {
  if (!lastUpdated) return ''
  const s = Math.max(0, Math.round((now - lastUpdated) / 1000))
  return s < 60 ? `actualizado hace ${s} s` : `actualizado hace ${Math.floor(s / 60)} min`
}

/** Iniciales del nombre (máx. 2): "Rosa Pérez" → "RP", "carlos" → "C". */
export function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toLocaleUpperCase()).join('')
}

/**
 * Nombre del mozo por `waiterId`. Los ids son `users.id`: se resuelven contra `/usuarios`
 * (TeamService.list), NUNCA contra employee-profiles (regla del CLAUDE.md). Sin match → null,
 * y la mesa no muestra mozo (no se pinta un "Usuario" inventado).
 */
export function resolveWaiter(usersById: Map<string, string>, waiterId: string | undefined): { name: string; initials: string } | null {
  if (!waiterId) return null
  const name = usersById.get(waiterId)?.trim()
  if (!name) return null
  return { name, initials: initials(name) }
}
