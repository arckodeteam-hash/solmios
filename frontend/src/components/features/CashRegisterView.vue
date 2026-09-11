<script setup lang="ts">
// components/features/CashRegisterView.vue — Vista de caja (turno + movimientos + arqueo +
// histórico de turnos), parametrizada por `service` para que recepción y restaurante compartan
// la MISMA UI apuntando a su propio punto de venta (el backend ya separa turno/movimientos por
// `register`). Antes esto vivía duplicada a mano en pages/caja/index.vue; ahora esa página es un
// wrapper de 3 líneas.
//
// QA-UI caja-2026-08-22: el arqueo de cierre ya NO viene prellenado con el esperado (H2) — el
// cajero cuenta cada método y la diferencia se calcula en vivo; si no cuadra, el motivo es
// obligatorio (el backend lo exige). La matemática vive en utils/cash-arqueo.ts (pura y testeada).
//
// Claridad (2ª pasada sobre el mismo reporte): la vista tiene que EXPLICARSE SOLA —
//   · Un número protagonista ("Esperado en cajón (efectivo)") con la cuenta visible al lado.
//   · Turno abierto >24h avisa (ámbar) y >7 días grita (rojo) — en prod hubo turnos de 45 días.
//   · Sin turno: guía de 3 pasos en vez de un formulario desnudo.
//   · Cada número con su micro-texto; la tarjeta/transferencia se cuenta aparte, a la vista.
//
// #212 (caja del restaurante, aplica a las dos cajas porque es el mismo componente):
//   · Cero `$` literales: todo monto pasa por `money()` con la moneda del hotel (formatCurrency).
//   · Concepto obligatorio (mín. 3) en un movimiento manual, con el error inline y el botón apagado.
//   · Un cobro del POS (`reference: pos:<orderId>`) enlaza a su comanda; el concepto ya dice mesa.
//   · "Editar" solo en manuales del turno ABIERTO (el backend rechaza el resto con 409).
//   · Tablas sin `min-w`: en <lg las columnas secundarias bajan como línea de la fila.
import { ref, computed, onMounted } from 'vue'
import type { CashMovement, CashShift, CashStats, Reconcile, ShiftHistory, ShiftHistoryRow } from '@/services/Caja.service'
import { HotelService } from '@/services/Hotel.service'
import { TeamService } from '@/services/Team.service'
import { formatCurrency } from '@/composables/useCurrency'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import PillTabs, { type PillTab } from '@/components/ui/PillTabs.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { BALANCE_EPSILON, buildArqueo, denominationsFor, expectedCashInDrawer, round2, sumDenominations } from '@/utils/cash-arqueo'

interface CashServiceLike {
  movements: (params?: Record<string, string | number>) => Promise<{ data: CashMovement[]; pages?: number }>
  createMovement: (data: Partial<CashMovement>) => Promise<CashMovement>
  updateMovement: (id: string, data: Partial<CashMovement>) => Promise<CashMovement>
  removeMovement: (id: string) => Promise<{ success: boolean }>
  currentShift: () => Promise<CashShift | null>
  openShift: (openingAmount: number) => Promise<CashShift>
  closeShift: (id: string, countedAmount: number, notes?: string, denominations?: string) => Promise<CashShift>
  reconcile: (id: string) => Promise<Reconcile>
  stats: () => Promise<CashStats>
  shifts: (params?: Record<string, string | number>) => Promise<ShiftHistory>
}

const props = withDefaults(defineProps<{
  service: CashServiceLike
  title?: string
  subtitle?: string
  emptyMessage?: string
  /** Reloj inyectable: la edad del turno (alerta de turno viejo) tiene que ser testeable sin fake timers. */
  nowFn?: () => Date
}>(), {
  title: 'Caja',
  subtitle: 'Movimientos, turnos y arqueo',
  emptyMessage: 'Registrá un ingreso o un egreso para empezar a mover la caja.',
  nowFn: () => new Date(),
})

const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5M21 12h-4a1.5 1.5 0 0 0 0 3h4v-3Z"/></svg>'
const ICON_LOCK_OPEN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7.5a4 4 0 0 1 7.5-2M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg>'
const ICON_LOCK_CLOSED = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7.5a4 4 0 1 1 8 0V11M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_MINUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15"/></svg>'
const ICON_SCALE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18M5 7l-2.5 6a2.5 2.5 0 0 0 5 0L5 7Zm14 0-2.5 6a2.5 2.5 0 0 0 5 0L19 7ZM4 7h16M8 21h8"/></svg>'
const ICON_CASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path stroke-linecap="round" d="M6 9v.01M18 15v.01"/></svg>'
const ICON_CARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><path stroke-linecap="round" d="M2 10h20"/></svg>'
const ICON_BANK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10 12 3l9 7M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M9 20v-6h6v6"/></svg>'
const ICON_LINK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5 21 3M16.5 3H21v4.5M10.5 13.5 3 21M7.5 21H3v-4.5"/></svg>'
const ICON_DOTS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>'
const ICON_ALERT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 3.5v.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>'
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>'
const ICON_PENCIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v4.75A2 2 0 0 1 17.5 21h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h4.75"/></svg>'

const movMethods = [
  { value: 'cash', label: 'Efectivo', icon: ICON_CASH },
  { value: 'card', label: 'Tarjeta', icon: ICON_CARD },
  { value: 'transfer', label: 'Transferencia', icon: ICON_BANK },
  { value: 'link', label: 'Link', icon: ICON_LINK },
  { value: 'other', label: 'Otro', icon: ICON_DOTS },
]

const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Movimiento eliminado'),
  onError: (e) => toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined),
})

const stats = ref<CashStats | null>(null)
const currentShift = ref<CashShift | null>(null)
// Desglose del turno ABIERTO (fondo/efectivo por lado/tarjeta aparte): sale del MISMO getter
// read-only que usa el arqueo de cierre, así el número del hero y el del cierre no pueden discrepar.
const currentReconcile = ref<Reconcile | null>(null)
const movements = ref<CashMovement[]>([])
const page = ref(1)
const pages = ref(1)
const loading = ref(false)

// Modal registrar/editar movimiento. `editing` = el movimiento manual que se está corrigiendo
// (concepto/monto); null = alta.
const showMov = ref(false)
const submitting = ref(false)
const editing = ref<CashMovement | null>(null)
const movForm = ref({ type: 'income' as 'income' | 'expense', amount: 0, method: 'cash' as 'cash' | 'card' | 'transfer' | 'link' | 'other', concept: '', guestName: '', roomNumber: '' })

// #212: concepto obligatorio (mín. 3 caracteres) — el backend lo exige igual (schema), acá se
// explica antes de mandar: botón apagado + mensaje inline, no un toast después.
const CONCEPT_MIN = 3
const conceptError = computed(() => {
  const c = movForm.value.concept.trim()
  if (!c) return 'Indicá el concepto'
  if (c.length < CONCEPT_MIN) return `El concepto necesita al menos ${CONCEPT_MIN} caracteres`
  return ''
})
const amountError = computed(() => (!movForm.value.amount || movForm.value.amount <= 0 ? 'El importe debe ser mayor a 0' : ''))
const movValid = computed(() => !conceptError.value && !amountError.value)

// Modal cerrar turno (arqueo). Los campos de conteo arrancan VACÍOS: el cajero cuenta y carga
// lo que hay — si vinieran prellenados con el esperado, cerrar sin contar cuadraría siempre.
const showClose = ref(false)
const reconcile = ref<Reconcile | null>(null)
const closing = ref(false)
const countedByMethod = ref<Record<string, number | null>>({})
const closeReason = ref('')
// Moneda del hotel (settings). Se carga junto con la caja: TODO monto de la vista sale de `money()`.
// Sin settings (red caída) cae a USD — nunca a un símbolo inventado ni a un string vacío.
const hotelCurrency = ref('')
const currency = computed(() => hotelCurrency.value || 'USD')
const money = (n: number | null | undefined) => formatCurrency(Number(n || 0), currency.value)
const useDenominations = ref(false)
const denomCounts = ref<Record<string, number | null>>({})

// Abrir turno
const openingAmount = ref(0)
const opening = ref(false)

// Tab histórico de turnos
const SHIFTS_PAGE_SIZE = 20
const tab = ref<'movimientos' | 'turnos'>('movimientos')
const CASH_TABS: PillTab[] = [{ value: 'movimientos', label: 'Movimientos' }, { value: 'turnos', label: 'Turnos' }]
const shifts = ref<ShiftHistoryRow[]>([])
const shiftsTotal = ref(0)
const shiftsPage = ref(1)
const shiftsPages = ref(1)
const shiftsLoading = ref(false)
const histFrom = ref('')
const histTo = ref('')
const userNames = ref<Record<string, string>>({})

const METHOD_LABEL: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', link: 'Link', other: 'Otro' }

onMounted(load)

async function load() {
  loading.value = true
  try {
    const [s, sh, m, settings] = await Promise.all([
      props.service.stats(), props.service.currentShift(), props.service.movements({ page: page.value, limit: 20 }),
      // Moneda del hotel (#212): best-effort, una sola vez por sesión de la vista.
      hotelCurrency.value ? null : HotelService.settings().catch(() => null),
    ])
    stats.value = s
    currentShift.value = sh
    movements.value = m.data || []
    pages.value = m.pages ?? 1
    if (settings?.hotel?.currency) hotelCurrency.value = settings.hotel.currency
    // Hero del turno: si hay turno abierto, su desglose (best-effort — sin él el hero muestra
    // solo el fondo y la vista sigue siendo operable).
    currentReconcile.value = sh?.id ? await props.service.reconcile(sh.id).catch(() => null) : null
  } catch (e: unknown) {
    toast.error('No se pudo cargar la caja', e instanceof Error ? e.message : undefined)
  } finally {
    loading.value = false
  }
}

async function loadMovements(p: number) {
  page.value = p
  try {
    const m = await props.service.movements({ page: p, limit: 20 })
    movements.value = m.data || []
    pages.value = m.pages ?? 1
  } catch (e: unknown) {
    toast.error('Error al cargar movimientos')
  }
}

function openMovModal(type: 'income' | 'expense') {
  editing.value = null
  movForm.value = { type, amount: 0, method: 'cash', concept: '', guestName: '', roomNumber: '' }
  showMov.value = true
}

/** #212: corregir concepto/monto de un movimiento manual del turno abierto. */
function openEditModal(m: CashMovement) {
  if (!canEdit(m)) return
  editing.value = m
  movForm.value = {
    type: m.type === 'expense' ? 'expense' : 'income', amount: Number(m.amount || 0),
    method: m.method || 'cash', concept: m.concept || '', guestName: m.guestName || '', roomNumber: m.roomNumber || '',
  }
  showMov.value = true
}

/** Manual (no generado por un cobro ni un gasto) y del turno que sigue ABIERTO: lo mismo que
 *  exige el backend — el botón no aparece donde el PUT daría 409. */
function canEdit(m: CashMovement): boolean {
  if (!m.id || !isManual(m)) return false
  if (!currentShift.value || currentShift.value.status !== 'open') return false
  return m.shiftId === currentShift.value.id
}

const isManual = (m: CashMovement) => !m.source || m.source === 'manual'

/** Comanda del POS detrás de un cobro automático: `reference: pos:<orderId>` (restaurante-payments) o,
 *  para UNA parte de una cuenta dividida (#214), `pos:<orderId>:<n>` — el `:<n>` NO es parte del id. */
const POS_REFERENCE = /^pos:([^:]+)(?::\d+)?$/
function orderIdOf(m: CashMovement): string | null {
  return POS_REFERENCE.exec(m.reference || '')?.[1] ?? null
}

async function saveMov() {
  if (!movValid.value) return
  submitting.value = true
  try {
    const concept = movForm.value.concept.trim()
    if (editing.value?.id) {
      await props.service.updateMovement(editing.value.id, { concept, amount: movForm.value.amount })
      toast.success('Movimiento actualizado')
    } else {
      await props.service.createMovement({ ...movForm.value, concept })
      toast.success(movForm.value.type === 'income' ? 'Ingreso registrado' : 'Egreso registrado')
    }
    showMov.value = false
    editing.value = null
    await load()
  } catch (e: unknown) {
    toast.error(editing.value ? 'No se pudo actualizar el movimiento' : 'No se pudo registrar el movimiento', e instanceof Error ? e.message : undefined)
  } finally {
    submitting.value = false
  }
}

function removeMov(m: CashMovement) {
  if (!m.id) return
  askConfirm({
    title: 'Eliminar movimiento',
    message: `¿Eliminar movimiento "${m.concept || 'sin concepto'}" (${money(m.amount)})? No se puede deshacer.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await props.service.removeMovement(m.id!)
      await load()
    },
  })
}

async function doOpenShift() {
  opening.value = true
  try {
    await props.service.openShift(openingAmount.value || 0)
    toast.success('Turno abierto')
    openingAmount.value = 0
    await load()
  } catch (e: unknown) {
    toast.error('No se pudo abrir el turno', e instanceof Error ? e.message : undefined)
  } finally {
    opening.value = false
  }
}

// Denominaciones de la moneda del hotel (si no tiene configuradas → campo libre de total contado).
const denomSet = computed(() => denominationsFor(hotelCurrency.value))

/** Desglose vivo del arqueo: esperado vs contado por método + totales (matemática en la util). */
const arqueo = computed(() => {
  if (!reconcile.value) return null
  const counted = { ...countedByMethod.value }
  if (useDenominations.value && denomSet.value.length) {
    counted.cash = sumDenominations(denomCounts.value, denomSet.value)
  }
  return buildArqueo({
    opening: reconcile.value.opening,
    byMethodNet: reconcile.value.byMethodNet || {},
    countedByMethod: counted,
  })
})

const closeValid = computed(() => {
  if (!arqueo.value) return false
  if (arqueo.value.pendingCount) return false
  if (arqueo.value.requiresReason) return closeReason.value.trim().length > 0
  return true
})

async function openCloseModal() {
  if (!currentShift.value?.id) return
  try {
    if (!hotelCurrency.value) {
      const settings = await HotelService.settings().catch(() => null)
      hotelCurrency.value = settings?.hotel?.currency || ''
    }
    // Conteo SIEMPRE vacío al abrir: prellenar con el esperado era un arqueo de mentira (H2).
    countedByMethod.value = {}
    denomCounts.value = {}
    useDenominations.value = false
    closeReason.value = ''
    reconcile.value = await props.service.reconcile(currentShift.value.id)
    showClose.value = true
  } catch (e: unknown) {
    toast.error('No se pudo cargar el arqueo', e instanceof Error ? e.message : undefined)
  }
}

async function doCloseShift() {
  if (!currentShift.value?.id || !arqueo.value || !closeValid.value) return
  const cash = arqueo.value.methods.find(m => m.method === 'cash')
  if (!cash || cash.counted === null) return
  closing.value = true
  try {
    // denominations: conteo físico por billete/moneda (opcional, lo persiste el turno).
    const denominations = useDenominations.value && denomSet.value.length
      ? JSON.stringify(denomSet.value.reduce<Record<string, number>>((acc, d) => {
          const qty = denomCounts.value[String(d)]
          if (qty) acc[String(d)] = qty
          return acc
        }, {}))
      : undefined
    await props.service.closeShift(currentShift.value.id, cash.counted, closeReason.value.trim() || undefined, denominations)
    toast.success('Turno cerrado')
    showClose.value = false
    await load()
    if (tab.value === 'turnos') await loadShifts(1)
  } catch (e: unknown) {
    toast.error('No se pudo cerrar el turno', e instanceof Error ? e.message : undefined)
  } finally {
    closing.value = false
  }
}

/** Diferencia legible: "Cuadra" dentro del centavo de tolerancia, si no ±X en la moneda del hotel. */
function fmtDiffCell(d: number | null): string {
  if (d === null) return '—'
  if (Math.abs(d) <= BALANCE_EPSILON) return 'Cuadra'
  return d >= 0 ? `+${money(d)}` : `-${money(Math.abs(d))}`
}

const movCount = computed(() => stats.value?.count ?? 0)

// ─── Claridad: el turno abierto se explica solo (número protagonista + cuenta visible) ───

/** La cuenta que arma el protagonista: fondo + ingresos efectivo − egresos efectivo = esperado.
 *
 * `expected` se DERIVA de los mismos términos que la cuenta imprime (expectedCashInDrawer), NO se
 * toma del payload: si el `expected` almacenado del turno difiere de la suma de sus movimientos
 * (legacy), el hero y la cuenta dejarían de cerrar entre sí — dos números que dicen ser lo mismo.
 * Los términos son los del reconcile del turno COMPLETO (incluye movimientos cargados antes de
 * esta sesión: es el turno, no la sesión). */
const heroMath = computed(() => {
  const rec = currentReconcile.value
  if (!rec) return null
  const opening = round2(rec.opening)
  const cashIncome = round2(rec.cashIncome ?? 0)
  const cashExpense = round2(rec.cashExpense ?? 0)
  return {
    opening,
    cashIncome,
    cashExpense,
    expected: expectedCashInDrawer(opening, cashIncome, cashExpense),
  }
})

/** Cobros del turno que NO están en el cajón (tarjeta/transferencia/link): neto por método. */
const nonCashMethods = computed(() => {
  const net = currentReconcile.value?.byMethodNet || {}
  return Object.entries(net)
    .filter(([k, v]) => k !== 'cash' && Math.abs(Number(v) || 0) > BALANCE_EPSILON)
    .map(([k, v]) => ({ method: k, net: round2(Number(v) || 0) }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
})

const nonCashTotal = computed(() => round2(nonCashMethods.value.reduce((acc, m) => acc + m.net, 0)))

/** "Tarjeta" · "Tarjeta y transferencia" — nombra los métodos que realmente tuvo el turno. */
const nonCashLabel = computed(() => {
  const labels = nonCashMethods.value.map(m => METHOD_LABEL[m.method] || m.method)
  if (!labels.length) return 'Tarjeta/transferencia'
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
})

// ─── Turno viejo: un turno abierto no puede pasar desapercibido (M3) ───

const STALE_WARN_HOURS = 24
const STALE_DANGER_HOURS = 24 * 7

const shiftAgeHours = computed(() => {
  const openedAt = currentShift.value?.openedAt
  if (!openedAt) return null
  const opened = new Date(openedAt).getTime()
  if (Number.isNaN(opened)) return null
  return Math.max((props.nowFn().getTime() - opened) / 3_600_000, 0)
})

/** "hace 3 h" · "hace 2 días" — edad legible del turno abierto, siempre a la vista. */
const shiftAgeText = computed(() => {
  const h = shiftAgeHours.value
  if (h === null) return ''
  if (h < 1) return 'hace un rato'
  if (h < 24) return `hace ${Math.floor(h)} h`
  const days = Math.floor(h / 24)
  return `hace ${days} día${days === 1 ? '' : 's'}`
})

/** >24h avisa en ámbar; >7 días grita en rojo. El turno zombie del demo (meses) luce su alerta. */
const shiftAlert = computed<{ level: 'warn' | 'danger'; days: number } | null>(() => {
  const h = shiftAgeHours.value
  if (h === null || h < STALE_WARN_HOURS) return null
  return { level: h >= STALE_DANGER_HOURS ? 'danger' : 'warn', days: Math.floor(h / 24) }
})

function sourceLabel(source?: string) {
  if (source === 'payment_connector') return 'Auto'
  if (source === 'migrated') return 'Migrado'
  return 'Manual'
}

// ─── Histórico de turnos (H1: la diferencia de cierre existía en la DB y no se veía nunca) ───
async function loadShifts(p = 1) {
  shiftsLoading.value = true
  try {
    // Cajero/cerrador: nombres por /api/usuarios (regla del repo — NUNCA employee-profiles).
    if (!Object.keys(userNames.value).length) {
      const team = await TeamService.list().catch(() => null)
      userNames.value = Object.fromEntries((team?.data || []).map(u => [u.id, u.name]))
    }
    const params: Record<string, string | number> = { page: p, limit: SHIFTS_PAGE_SIZE }
    if (histFrom.value) params.from = histFrom.value
    if (histTo.value) params.to = histTo.value
    const res = await props.service.shifts(params)
    shifts.value = res.data || []
    shiftsTotal.value = res.total || 0
    shiftsPage.value = p
    // El http client aplana el envelope paginado a {data, total}: pages sale del total conocido.
    shiftsPages.value = Math.max(Math.ceil(shiftsTotal.value / SHIFTS_PAGE_SIZE), 1)
  } catch (e: unknown) {
    toast.error('No se pudo cargar el histórico de turnos', e instanceof Error ? e.message : undefined)
  } finally {
    shiftsLoading.value = false
  }
}

function switchTab(t: 'movimientos' | 'turnos') {
  tab.value = t
  if (t === 'turnos' && !shifts.value.length && !shiftsLoading.value) loadShifts(1)
}

function clearShiftFilters() {
  histFrom.value = ''
  histTo.value = ''
  loadShifts(1)
}

/** Resuelve users.id → nombre (fallback "Usuario": nunca mostrar el ID crudo). */
function userName(id?: string): string {
  if (!id) return '—'
  return userNames.value[id] || 'Usuario'
}

/** Métodos presentes en los turnos cargados (columnas dinámicas del desglose). */
const historyMethods = computed(() => {
  const keys = new Set<string>()
  for (const s of shifts.value) for (const mk of Object.keys(s.byMethodNet || {})) keys.add(mk)
  return [...keys].sort((a, b) => (a === 'cash' ? -1 : b === 'cash' ? 1 : a.localeCompare(b)))
})

const fmtDate = (iso?: string) => (iso || '').slice(0, 10)
const fmtTime = (iso?: string) => (iso || '').slice(11, 16)

// Export del histórico visible (respeta los filtros activos). CSV con BOM para que Excel
// respete los acentos — mismo patrón que el export de habitaciones.
function exportShiftsCsv() {
  const rows = shifts.value
  if (!rows.length) return
  const esc = (v: string) => /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const header = ['Fecha', 'Abrió', 'Cerró', 'Cajero que cerró', 'Fondo', 'Contado', 'Esperado', 'Diferencia',
    ...historyMethods.value.map(mk => `${METHOD_LABEL[mk] || mk} (neto)`), 'Motivo', 'Estado']
  const lines = [header.join(',')]
  for (const s of rows) {
    const cells = [
      fmtDate(s.openedAt),
      userName(s.openedBy),
      s.closedAt ? `${fmtDate(s.closedAt)} ${fmtTime(s.closedAt)}` : '—',
      s.closedBy ? userName(s.closedBy) : '—',
      String(s.openingAmount ?? 0),
      s.countedAmount !== undefined && s.countedAmount !== null ? String(s.countedAmount) : '—',
      s.expectedAmount !== undefined && s.expectedAmount !== null ? String(s.expectedAmount) : '—',
      s.difference !== undefined && s.difference !== null ? String(s.difference) : '—',
      ...historyMethods.value.map(mk => String((s.byMethodNet || {})[mk] ?? '')),
      s.notes || '',
      s.status === 'closed' ? 'Cerrado' : 'Abierto',
    ]
    lines.push(cells.map(esc).join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `turnos-caja-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  toast.success(`CSV exportado (${rows.length} turno(s))`)
}

const fmtDenom = (d: number) => money(d)
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">{{ title }}</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-xs text-text-muted mt-0.5">{{ subtitle }}</p>
      </div>
      <!-- Jerarquía de botones: con turno abierto los movimientos son acciones secundarias del
           header; sin turno el único primario es "Abrir turno" (vive en la guía de abajo).
           `header-actions`: enlaces propios de cada caja (#213: la del restaurante enlaza al cierre del día). -->
      <div class="flex flex-wrap items-center gap-2">
        <slot name="header-actions" />
        <template v-if="currentShift">
          <button @click="openMovModal('income')" class="flex items-center gap-1.5 bg-teal text-white font-extrabold text-sm px-4 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
            <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
            Ingreso
          </button>
          <button @click="openMovModal('expense')" class="flex items-center gap-1.5 bg-coral text-white font-extrabold text-sm px-4 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
            <span class="w-4 h-4 shrink-0" v-html="ICON_MINUS"></span>
            Egreso
          </button>
        </template>
      </div>
    </div>

    <!-- Carga del hero: sin esto el estado "sin turno" (guía) parpadea durante el fetch inicial. -->
    <div v-if="loading" class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6 space-y-4">
      <div class="h-5 w-40 animate-pulse rounded-lg bg-surface"></div>
      <div class="h-14 w-72 animate-pulse rounded-xl bg-surface"></div>
      <div class="h-4 w-96 max-w-full animate-pulse rounded-lg bg-surface"></div>
    </div>

    <!-- Turno ABIERTO — un solo número protagonista con la cuenta que lo arma a la vista -->
    <template v-else-if="currentShift">
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <!-- Turno viejo: abierto >24h avisa, >7 días grita (M3: hubo turnos de 45 días en prod) -->
        <div v-if="shiftAlert" role="alert" data-testid="shift-age-alert"
          class="mb-5 flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-bold"
          :class="shiftAlert.level === 'danger' ? 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]' : 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]'">
          <span class="mt-0.5 block w-4 h-4 shrink-0" v-html="ICON_ALERT"></span>
          <p data-testid="shift-age-text">
            Este turno está abierto hace {{ shiftAlert.days }} día{{ shiftAlert.days === 1 ? '' : 's' }} —
            cerralo con arqueo para que la caja cuadre.
          </p>
        </div>

        <div class="flex items-start justify-between flex-wrap gap-4">
          <div class="flex items-center gap-4 min-w-0">
            <div class="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-teal/10">
              <span class="w-6 h-6 text-teal" v-html="ICON_LOCK_OPEN"></span>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-base font-black text-navy">Turno abierto</h3>
                <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-teal/10 text-teal">{{ shiftAgeText }}</span>
              </div>
              <p class="text-xs text-text-muted mt-0.5">
                Abierto {{ (currentShift.openedAt || '').slice(0, 16).replace('T', ' ') }} ·
                Fondo <span class="font-bold tabular-nums">{{ money(heroMath?.opening ?? currentShift.openingAmount) }}</span>
              </p>
            </div>
          </div>
          <button @click="openCloseModal" class="flex items-center gap-1.5 rounded-full bg-coral text-white text-sm font-extrabold px-5 py-2.5 hover:shadow-lg transition-all cursor-pointer">
            <span class="w-4 h-4 shrink-0" v-html="ICON_SCALE"></span>
            Cerrar turno (arqueo)
          </button>
        </div>

        <!-- Protagonista: lo que debería haber de efectivo, con la cuenta que lo arma -->
        <div class="mt-6 rounded-2xl bg-surface/70 border border-border px-5 py-5">
          <div class="text-[10px] font-extrabold uppercase tracking-[1.5px] text-text-muted">
            Esperado en cajón (efectivo)
          </div>
          <div class="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span class="font-black tabular-nums leading-none tracking-tight text-navy text-[clamp(38px,4.5vw,56px)]" data-testid="hero-expected">
              {{ money(heroMath?.expected ?? currentShift.openingAmount) }}
            </span>
            <span class="text-xs text-text-muted">lo que debería haber en el cajón, según los movimientos del turno</span>
          </div>
          <!-- La cuenta VISIBLE: si no concilia con lo que el cajero cuenta, acá se ve por qué.
               Los separadores viven DENTRO de cada span (una línea por término): el condense de
               whitespace de Vue borra los nodos de texto newline-only entre elementos y la ecuación
               quedaría pegada ("fondo+ 1,000"). -->
          <p v-if="heroMath" class="mt-3 text-xs sm:text-sm text-text-secondary tabular-nums" data-testid="hero-math"><span class="font-bold text-navy">{{ money(heroMath.opening) }} fondo</span> <span class="font-bold text-teal">+ {{ money(heroMath.cashIncome) }} ingresos en efectivo</span> <span class="font-bold text-coral">- {{ money(heroMath.cashExpense) }} egresos en efectivo</span> <span class="font-extrabold text-navy">= {{ money(heroMath.expected) }}</span></p>
          <!-- Lo que NO está en el cajón se muestra aparte: es la brecha que antes "no cerraba" -->
          <p class="mt-2 text-xs text-text-secondary tabular-nums border-t border-border pt-2.5" data-testid="hero-noncash"><span class="inline-flex items-center gap-1.5"><span class="w-3.5 h-3.5 text-cyan" v-html="ICON_CARD"></span> Cobros con {{ nonCashLabel.toLowerCase() }} del turno: <span class="font-bold text-navy">{{ money(nonCashTotal) }}</span></span> <span class="text-text-muted">— se cuentan aparte (cupones o cierre de terminal), no están en el cajón.</span></p>
        </div>
      </div>

      <!-- Números del turno que alimentan al protagonista — cada uno con SU micro-texto -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div class="rounded-[16px] border border-border bg-white shadow-(--shadow-card) px-4 py-3.5">
          <div class="text-[10px] font-extrabold uppercase tracking-wide text-text-muted">Fondo inicial</div>
          <div class="mt-0.5 text-xl font-black text-navy tabular-nums" data-testid="turn-opening">{{ money(heroMath?.opening ?? currentShift.openingAmount) }}</div>
          <div class="mt-0.5 text-[11px] text-text-muted">efectivo con el que arrancó el turno</div>
        </div>
        <div class="rounded-[16px] border border-border bg-white shadow-(--shadow-card) px-4 py-3.5">
          <div class="text-[10px] font-extrabold uppercase tracking-wide text-text-muted">Ingresos en efectivo</div>
          <div class="mt-0.5 text-xl font-black text-teal tabular-nums" data-testid="turn-cash-income">+{{ money(heroMath?.cashIncome ?? 0) }}</div>
          <div class="mt-0.5 text-[11px] text-text-muted">cobros del turno que entraron al cajón</div>
        </div>
        <div class="rounded-[16px] border border-border bg-white shadow-(--shadow-card) px-4 py-3.5">
          <div class="text-[10px] font-extrabold uppercase tracking-wide text-text-muted">Egresos en efectivo</div>
          <div class="mt-0.5 text-xl font-black text-coral tabular-nums" data-testid="turn-cash-expense">-{{ money(heroMath?.cashExpense ?? 0) }}</div>
          <div class="mt-0.5 text-[11px] text-text-muted">pagos y gastos salidos del cajón</div>
        </div>
        <div class="rounded-[16px] border border-border bg-white shadow-(--shadow-card) px-4 py-3.5">
          <div class="text-[10px] font-extrabold uppercase tracking-wide text-text-muted">{{ nonCashLabel }} del turno</div>
          <div class="mt-0.5 text-xl font-black text-cyan tabular-nums" data-testid="turn-noncash">{{ money(nonCashTotal) }}</div>
          <div class="mt-0.5 text-[11px] text-text-muted">cobros sin efectivo: se cuentan aparte, con cupones</div>
        </div>
      </div>
    </template>

    <!-- Sin turno abierto — guía de 3 pasos en vez de un número sin contexto -->
    <div v-else class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6 sm:p-8">
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-navy/5">
          <span class="w-6 h-6 text-navy/40" v-html="ICON_LOCK_CLOSED"></span>
        </div>
        <div>
          <h3 class="text-lg font-black text-navy">La caja se maneja por turnos</h3>
          <p class="text-xs text-text-muted mt-0.5">No hay ningún turno abierto. Tres pasos y la caja cuadra sola:</p>
        </div>
      </div>

      <ol class="mt-6 grid gap-4 sm:grid-cols-3" data-testid="shift-guide">
        <li class="rounded-2xl border border-border bg-surface/50 px-4 py-4">
          <div class="flex items-center gap-2.5">
            <span class="grid h-7 w-7 place-items-center rounded-full bg-navy text-white text-xs font-black">1</span>
            <span class="text-sm font-black text-navy">Abrí un turno</span>
          </div>
          <p class="mt-2 text-xs text-text-secondary leading-relaxed">Cargá el fondo inicial: la plata con la que arranca el cajón.</p>
        </li>
        <li class="rounded-2xl border border-border bg-surface/50 px-4 py-4">
          <div class="flex items-center gap-2.5">
            <span class="grid h-7 w-7 place-items-center rounded-full bg-navy text-white text-xs font-black">2</span>
            <span class="text-sm font-black text-navy">Registrá ingresos y egresos</span>
          </div>
          <p class="mt-2 text-xs text-text-secondary leading-relaxed">Cada cobro o gasto del turno queda en la lista de movimientos.</p>
        </li>
        <li class="rounded-2xl border border-border bg-surface/50 px-4 py-4">
          <div class="flex items-center gap-2.5">
            <span class="grid h-7 w-7 place-items-center rounded-full bg-navy text-white text-xs font-black">3</span>
            <span class="text-sm font-black text-navy">Contá la caja y cerrá con arqueo</span>
          </div>
          <p class="mt-2 text-xs text-text-secondary leading-relaxed">El cierre compara lo contado contra lo esperado y guarda la diferencia.</p>
        </li>
      </ol>

      <div class="mt-6 flex flex-wrap items-end gap-3 border-t border-border pt-5">
        <div>
          <label for="open-amount" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Fondo inicial</label>
          <input id="open-amount" v-model.number="openingAmount" type="number" min="0" step="0.01" placeholder="0.00"
            class="w-36 px-4 py-2.5 rounded-xl border border-border text-sm text-navy font-bold text-right tabular-nums focus:outline-none focus:border-navy" />
        </div>
        <button @click="doOpenShift" :disabled="opening" class="flex items-center gap-1.5 rounded-full bg-teal text-white text-sm font-extrabold px-5 py-2.5 hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
          <span class="w-4 h-4 shrink-0" v-html="ICON_LOCK_OPEN"></span>
          {{ opening ? 'Abriendo...' : 'Abrir turno' }}
        </button>
        <p class="text-[11px] text-text-muted basis-full sm:basis-auto">El fondo queda como punto de partida del arqueo: esperado = fondo + efectivo del turno.</p>
      </div>
    </div>

    <!-- Tabs: operación del día / histórico de turnos (#203: componente compartido PillTabs) -->
    <PillTabs :tabs="CASH_TABS" :model-value="tab" aria-label="Secciones de caja" @update:model-value="switchTab($event as 'movimientos' | 'turnos')" />

    <!-- Movimientos -->
    <SectionCard v-if="tab === 'movimientos'" title="Movimientos" :subtitle="`${movCount} registro(s)`" body-class="p-0">
      <!-- Carga -->
      <div v-if="loading" class="p-4 space-y-3">
        <div v-for="i in 5" :key="i" class="h-12 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <!-- Sin datos (esta vista no tiene filtros: un solo mensaje posible). El CTA de registrar
           solo existe con turno abierto: un movimiento sin turno queda huérfano de todo arqueo. -->
      <EmptyState v-else-if="!movements.length"
        :icon="ICON_WALLET"
        title="Sin movimientos registrados"
        :message="emptyMessage">
        <template v-if="currentShift" #action>
          <button @click="openMovModal('income')"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Registrar ingreso</button>
        </template>
      </EmptyState>

      <!-- #212: sin `min-w` (en tablet la página no scrollea). Fecha, método y origen viven en
           columnas propias en ≥lg y bajan como línea de apoyo bajo el concepto en <lg. -->
      <div v-else class="overflow-x-auto">
        <table class="w-full tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Fecha</th>
              <th class="text-left px-4 py-3 text-[10px]">Concepto</th>
              <th class="text-left px-4 py-3 text-[10px] hidden sm:table-cell">Tipo</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Método</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Origen</th>
              <th class="text-right px-4 py-3 text-[10px]">Monto</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in movements" :key="m.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors" :data-testid="`mov-${m.id}`">
              <td class="px-4 py-3 text-xs text-text-muted tabular-nums whitespace-nowrap hidden lg:table-cell">{{ (m.createdAt || '').slice(0, 16).replace('T', ' ') }}</td>
              <td class="px-4 py-3 min-w-0">
                <!-- Cobro del POS: el concepto ya dice "Comanda CMD-… · Mesa 3" y enlaza a la comanda.
                     Un movimiento sin concepto (automático viejo) lo decimos, no dejamos la celda muda. -->
                <router-link v-if="orderIdOf(m)" :to="`/panel/restaurante/comanda/${orderIdOf(m)}`"
                  class="block max-w-[260px] truncate text-sm font-bold text-navy underline decoration-navy/30 underline-offset-2 hover:decoration-navy"
                  :title="`Abrir ${m.concept || 'la comanda'}`" data-testid="mov-order-link">
                  {{ m.concept || 'Ver comanda' }}
                </router-link>
                <div v-else class="max-w-[260px] truncate text-sm font-bold" :class="m.concept ? 'text-navy' : 'text-text-muted'">
                  {{ m.concept || 'Sin concepto' }}
                </div>
                <div v-if="m.guestName" class="max-w-[260px] truncate text-[11px] text-text-muted">{{ m.guestName }}</div>
                <!-- <lg: fecha · método · origen suben como línea de apoyo; <sm también el tipo -->
                <div class="text-[11px] text-text-muted lg:hidden tabular-nums">
                  <span class="sm:hidden" :class="m.type === 'income' ? 'text-teal' : 'text-coral'">{{ m.type === 'income' ? 'Ingreso' : 'Egreso' }} · </span>{{ (m.createdAt || '').slice(0, 16).replace('T', ' ') }}<span v-if="METHOD_LABEL[m.method || ''] || m.method"> · {{ METHOD_LABEL[m.method || ''] || m.method }}</span> · {{ sourceLabel(m.source) }}
                </div>
                <!-- lg…xl: la columna Origen todavía no existe; solo lo no-manual merece la línea -->
                <div v-if="sourceLabel(m.source) !== 'Manual'" class="text-[11px] text-text-muted hidden lg:block xl:hidden">{{ sourceLabel(m.source) }}</div>
              </td>
              <td class="px-4 py-3 hidden sm:table-cell">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="m.type === 'income' ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">
                  {{ m.type === 'income' ? 'Ingreso' : 'Egreso' }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">
                {{ METHOD_LABEL[m.method || ''] || m.method }}
              </td>
              <td class="px-4 py-3 hidden xl:table-cell">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="m.source === 'payment_connector' ? 'bg-cyan/10 text-cyan' : 'bg-surface text-text-muted'">
                  {{ sourceLabel(m.source) }}
                </span>
              </td>
              <td class="px-4 py-3 text-right text-sm font-black tabular-nums whitespace-nowrap" :class="m.type === 'income' ? 'text-teal' : 'text-coral'">
                {{ m.type === 'income' ? '+' : '-' }}{{ money(m.amount) }}
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <!-- Editar (#212): solo manuales del turno abierto. Los automáticos y los de un
                       turno cerrado no tienen botón — el backend los rechaza igual (409). -->
                  <button v-if="canEdit(m)" @click="openEditModal(m)" title="Editar movimiento" aria-label="Editar movimiento"
                    class="grid h-8 w-8 place-items-center rounded-lg text-navy hover:bg-navy/10 transition-colors cursor-pointer" data-testid="mov-edit">
                    <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                  </button>
                  <!-- Los movimientos generados por la pasarela no se borran a mano. -->
                  <button v-if="m.source !== 'payment_connector'" @click="removeMov(m)" title="Eliminar movimiento" aria-label="Eliminar movimiento"
                    class="grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Paginación -->
      <div v-if="pages > 1" class="flex items-center justify-between border-t border-border px-4 py-3">
        <span class="text-[11px] font-bold text-text-muted">Página {{ page }} de {{ pages }}</span>
        <div class="flex items-center gap-1">
          <button @click="loadMovements(page - 1)" :disabled="page <= 1" aria-label="Página anterior de movimientos" class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
          <button @click="loadMovements(page + 1)" :disabled="page >= pages" aria-label="Página siguiente de movimientos" class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
        </div>
      </div>
    </SectionCard>

    <!-- Histórico de turnos: quién abrió/cerró, fondo, arqueo y diferencia de CADA turno.
         Antes estos datos vivían en la DB sin ninguna pantalla que los mostrara (H1). -->
    <SectionCard v-else title="Histórico de turnos" :subtitle="`${shiftsTotal} turno(s)`" body-class="p-0">
      <!-- Filtros + export -->
      <div class="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border">
        <div>
          <label for="shifts-from" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Desde</label>
          <input id="shifts-from" v-model="histFrom" type="date" @change="loadShifts(1)"
            class="px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <div>
          <label for="shifts-to" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Hasta</label>
          <input id="shifts-to" v-model="histTo" type="date" @change="loadShifts(1)"
            class="px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <button v-if="histFrom || histTo" @click="clearShiftFilters"
          class="text-xs font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer pb-2.5">Limpiar filtros</button>
        <div class="ml-auto pb-0.5">
          <button @click="exportShiftsCsv" :disabled="!shifts.length"
            class="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-extrabold text-navy hover:border-navy/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            <span class="w-3.5 h-3.5" v-html="ICON_DOWNLOAD"></span>
            Exportar CSV
          </button>
        </div>
      </div>

      <!-- Carga -->
      <div v-if="shiftsLoading" class="p-4 space-y-3">
        <div v-for="i in 5" :key="i" class="h-12 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <EmptyState v-else-if="!shifts.length"
        :icon="ICON_SCALE"
        title="Sin turnos en este período"
        message="Abrí un turno, mové la caja y cerralo con arqueo: acá queda la auditoría de cada cierre.">
      </EmptyState>

      <!-- #212: sin `min-w`. En <lg quedan Apertura (con el cierre debajo), Diferencia y Estado;
           fondo, neto por método, esperado y contado bajan como línea de apoyo bajo la apertura. -->
      <div v-else class="overflow-x-auto">
        <table class="w-full tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Apertura</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Cierre</th>
              <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Fondo</th>
              <th v-for="mk in historyMethods" :key="mk" class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">{{ METHOD_LABEL[mk] || mk }} (neto)</th>
              <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Esperado</th>
              <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Contado</th>
              <th class="text-right px-4 py-3 text-[10px]">Diferencia</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Motivo</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shifts" :key="s.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3 min-w-0">
                <div class="text-sm font-bold text-navy tabular-nums">{{ fmtDate(s.openedAt) }}</div>
                <div class="text-[11px] text-text-muted">{{ fmtTime(s.openedAt) }} · {{ userName(s.openedBy) }}</div>
                <!-- <lg: cierre, fondo, esperado, contado y motivo como líneas de apoyo -->
                <div class="lg:hidden text-[11px] text-text-muted tabular-nums mt-0.5 space-y-0.5">
                  <div v-if="s.closedAt">Cierre {{ fmtDate(s.closedAt) }} {{ fmtTime(s.closedAt) }} · {{ userName(s.closedBy) }}</div>
                  <div>
                    Fondo {{ money(s.openingAmount || 0) }}<template v-if="s.expectedAmount !== undefined && s.expectedAmount !== null"> · Esperado {{ money(s.expectedAmount) }}</template><template v-if="s.countedAmount !== undefined && s.countedAmount !== null"> · Contado {{ money(s.countedAmount) }}</template>
                  </div>
                  <div v-if="s.notes" class="truncate max-w-[260px]" :title="s.notes">{{ s.notes }}</div>
                </div>
                <div v-if="s.notes" class="hidden lg:block xl:hidden truncate max-w-[200px] text-[11px] text-text-muted" :title="s.notes">{{ s.notes }}</div>
              </td>
              <td class="px-4 py-3 whitespace-nowrap hidden lg:table-cell">
                <template v-if="s.closedAt">
                  <div class="text-sm font-bold text-navy tabular-nums">{{ fmtDate(s.closedAt) }}</div>
                  <div class="text-[11px] text-text-muted">{{ fmtTime(s.closedAt) }} · {{ userName(s.closedBy) }}</div>
                </template>
                <span v-else class="text-sm text-text-muted">—</span>
              </td>
              <td class="px-4 py-3 text-right text-sm text-text-secondary tabular-nums hidden lg:table-cell">{{ money(s.openingAmount || 0) }}</td>
              <td v-for="mk in historyMethods" :key="mk" class="px-4 py-3 text-right text-sm text-text-secondary tabular-nums hidden lg:table-cell">
                {{ (s.byMethodNet || {})[mk] !== undefined ? money(s.byMethodNet[mk] || 0) : '—' }}
              </td>
              <td class="px-4 py-3 text-right text-sm font-bold text-navy tabular-nums hidden lg:table-cell">{{ s.expectedAmount !== undefined && s.expectedAmount !== null ? money(s.expectedAmount) : '—' }}</td>
              <td class="px-4 py-3 text-right text-sm text-text-secondary tabular-nums hidden lg:table-cell">{{ s.countedAmount !== undefined && s.countedAmount !== null ? money(s.countedAmount) : '—' }}</td>
              <td class="px-4 py-3 text-right text-sm font-black tabular-nums whitespace-nowrap"
                :class="s.difference === undefined || s.difference === null ? 'text-text-muted' : Math.abs(s.difference) <= BALANCE_EPSILON ? 'text-teal' : s.difference > 0 ? 'text-teal' : 'text-coral'">
                {{ fmtDiffCell(s.difference ?? null) }}
              </td>
              <td class="px-4 py-3 hidden xl:table-cell">
                <div class="max-w-[200px] truncate text-xs text-text-muted" :title="s.notes">{{ s.notes || '—' }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="s.status === 'closed' ? 'bg-navy/5 text-text-secondary' : 'bg-teal/10 text-teal'">
                  {{ s.status === 'closed' ? 'Cerrado' : 'Abierto' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Paginación -->
      <div v-if="shiftsPages > 1" class="flex items-center justify-between border-t border-border px-4 py-3">
        <span class="text-[11px] font-bold text-text-muted">Página {{ shiftsPage }} de {{ shiftsPages }} · {{ shiftsTotal }} turno(s)</span>
        <div class="flex items-center gap-1">
          <button @click="loadShifts(shiftsPage - 1)" :disabled="shiftsPage <= 1" aria-label="Página anterior de turnos" class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
          <button @click="loadShifts(shiftsPage + 1)" :disabled="shiftsPage >= shiftsPages" aria-label="Página siguiente de turnos" class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
        </div>
      </div>
    </SectionCard>

    <!-- Modal registrar movimiento -->
    <AppModal v-if="showMov" size="md"
      :title="editing ? 'Editar movimiento' : movForm.type === 'income' ? 'Registrar ingreso' : 'Registrar egreso'"
      :subtitle="editing ? 'Corregí el concepto o el importe (turno abierto)' : movForm.type === 'income' ? 'Entra plata a la caja' : 'Sale plata de la caja'"
      @close="showMov = false; editing = null">
      <div class="space-y-4">
        <div>
          <label for="mov-amount" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Importe ({{ currency }})</label>
          <input id="mov-amount" v-model.number="movForm.amount" type="number" min="0" step="0.01" placeholder="0.00" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-bold text-navy text-right tabular-nums focus:outline-none focus:border-navy" />
        </div>
        <!-- Al editar solo cambian concepto e importe: el método y el tipo son del asiento original. -->
        <div v-if="!editing">
          <span class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Método</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="method in movMethods"
              :key="method.value"
              type="button"
              @click="movForm.method = method.value as typeof movForm.method"
              class="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold border transition-all cursor-pointer"
              :class="movForm.method === method.value ? 'border-navy bg-navy text-white' : 'border-border text-text-secondary hover:border-navy/30'"
            >
              <span class="w-3.5 h-3.5 shrink-0" v-html="method.icon"></span>
              {{ method.label }}
            </button>
          </div>
        </div>
        <div>
          <label for="mov-concept" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Concepto <span class="text-coral">*</span></label>
          <input id="mov-concept" v-model="movForm.concept" placeholder="Ej: Compra de insumos" required
            :aria-invalid="conceptError ? 'true' : 'false'" aria-describedby="mov-concept-error"
            class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none"
            :class="conceptError ? 'border-coral/60 focus:border-coral' : 'border-border focus:border-navy'" />
          <!-- #212: el error se ve ANTES de tocar Guardar (el botón queda apagado mientras exista) -->
          <p id="mov-concept-error" class="mt-1.5 text-[11px] font-bold" :class="conceptError ? 'text-coral' : 'text-text-muted'" data-testid="mov-concept-error">
            {{ conceptError || 'Para qué entró o salió la plata: queda en el arqueo y en el histórico.' }}
          </p>
        </div>
        <div v-if="!editing" class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label for="mov-guest" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Huésped (opcional)</label>
            <input id="mov-guest" v-model="movForm.guestName" placeholder="Nombre" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="mov-room" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Hab. (opcional)</label>
            <input id="mov-room" v-model="movForm.roomNumber" placeholder="Nº" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
        </div>
      </div>

      <template #footer>
        <button @click="showMov = false; editing = null" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveMov" :disabled="submitting || !movValid" data-testid="mov-save"
          class="rounded-full text-white text-sm font-extrabold px-5 py-2.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :class="movForm.type === 'income' ? 'bg-teal hover:bg-teal-light' : 'bg-coral hover:opacity-90'">
          {{ submitting ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar' }}
        </button>
      </template>
    </AppModal>

    <!-- Modal cerrar turno (arqueo honesto): el conteo NO viene prellenado. Por cada método,
         esperado vs contado vs diferencia en vivo; si no cuadra, el motivo es obligatorio. -->
    <AppModal v-if="showClose && reconcile && arqueo" size="lg"
      title="Cerrar turno — arqueo"
      subtitle="Contá la plata de cada método y cargá lo que hay realmente"
      @close="showClose = false">
      <!-- Resumen del turno -->
      <div class="space-y-2.5 pb-5 border-b border-border text-sm">
        <div class="flex justify-between"><span class="text-text-muted">Fondo inicial</span><span class="font-bold text-navy tabular-nums">{{ money(reconcile.opening) }}</span></div>
        <div class="flex justify-between"><span class="text-text-muted">Ingresos (todos los métodos)</span><span class="font-bold text-teal tabular-nums">+{{ money(reconcile.income) }}</span></div>
        <div class="flex justify-between"><span class="text-text-muted">Egresos (todos los métodos)</span><span class="font-bold text-coral tabular-nums">-{{ money(reconcile.expense) }}</span></div>
        <div class="flex justify-between pt-2.5 border-t border-border"><span class="font-extrabold text-navy">Esperado en cajón (efectivo)</span><span class="font-extrabold text-navy text-base tabular-nums">{{ money(arqueo.methods.find(m => m.method === 'cash')?.expected ?? 0) }}</span></div>
        <p class="text-[11px] text-text-muted leading-relaxed">
          Solo el efectivo está en el cajón: los cobros con tarjeta/transferencia se cuentan aparte (cupones o cierre de terminal) y no suman al esperado en efectivo.
        </p>
      </div>

      <!-- Desglose por método: esperado vs contado vs diferencia (en vivo) -->
      <div class="py-5">
        <h4 class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Conteo por método</h4>
        <div class="rounded-xl border border-border overflow-hidden">
          <table class="w-full">
            <thead>
              <tr class="bg-surface">
                <th class="text-left px-4 py-2.5 text-[10px] font-extrabold uppercase text-text-muted">Método</th>
                <th class="text-right px-4 py-2.5 text-[10px] font-extrabold uppercase text-text-muted">Esperado</th>
                <th class="text-right px-4 py-2.5 text-[10px] font-extrabold uppercase text-text-muted">Contado (real)</th>
                <th class="text-right px-4 py-2.5 text-[10px] font-extrabold uppercase text-text-muted">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in arqueo.methods" :key="m.method" class="border-t border-border">
                <td class="px-4 py-2.5 text-sm font-bold text-navy whitespace-nowrap">
                  {{ METHOD_LABEL[m.method] || m.method }}<span v-if="m.method === 'cash'" class="text-text-muted font-normal"> (cajón)</span>
                </td>
                <td class="px-4 py-2.5 text-right text-sm text-text-secondary tabular-nums">{{ money(m.expected) }}</td>
                <td class="px-4 py-2.5 text-right">
                  <!-- Efectivo con denominaciones activas: el contado es la suma del desglose. -->
                  <span v-if="m.method === 'cash' && useDenominations && denomSet.length"
                    class="text-sm font-black text-navy tabular-nums" :data-testid="'counted-' + m.method">
                    {{ money(m.counted ?? 0) }}
                  </span>
                  <input v-else :id="'close-count-' + m.method" v-model.number="countedByMethod[m.method]"
                    type="number" min="0" step="0.01" placeholder="Contá y cargá"
                    class="w-36 px-3 py-2 rounded-lg border border-border text-sm font-bold text-navy text-right tabular-nums focus:outline-none focus:border-navy" />
                </td>
                <td class="px-4 py-2.5 text-right text-sm font-black tabular-nums whitespace-nowrap"
                  :class="m.difference === null ? 'text-text-muted' : Math.abs(m.difference) <= BALANCE_EPSILON ? 'text-teal' : m.difference > 0 ? 'text-teal' : 'text-coral'">
                  {{ fmtDiffCell(m.difference) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t-2 border-navy bg-surface/60">
                <td class="px-4 py-2.5 text-sm font-black text-navy">Total</td>
                <td class="px-4 py-2.5 text-right text-sm font-black text-navy tabular-nums">{{ money(arqueo.totalExpected) }}</td>
                <td class="px-4 py-2.5 text-right text-sm font-black text-navy tabular-nums">{{ arqueo.totalCounted === null ? '—' : money(arqueo.totalCounted) }}</td>
                <td class="px-4 py-2.5 text-right text-base font-black tabular-nums whitespace-nowrap"
                  :class="arqueo.totalDifference === null ? 'text-text-muted' : Math.abs(arqueo.totalDifference) <= BALANCE_EPSILON ? 'text-teal' : arqueo.totalDifference > 0 ? 'text-teal' : 'text-coral'">
                  {{ fmtDiffCell(arqueo.totalDifference) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Desglose por denominaciones (solo efectivo, opcional, si la moneda las tiene) -->
      <div v-if="denomSet.length" class="pb-5 border-b border-border">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input id="close-use-denominations" v-model="useDenominations" type="checkbox" class="w-4 h-4 accent-navy cursor-pointer" />
          <span class="text-sm font-bold text-navy">Contar el efectivo por denominaciones</span>
          <span class="text-[11px] text-text-muted">({{ hotelCurrency }})</span>
        </label>
        <div v-if="useDenominations" class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div v-for="d in denomSet" :key="d" class="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <span class="text-xs font-bold text-text-secondary tabular-nums w-16 shrink-0">{{ fmtDenom(d) }}</span>
            <span class="text-xs text-text-muted">×</span>
            <input :id="'close-denom-' + d" v-model.number="denomCounts[String(d)]" type="number" min="0" step="1" placeholder="0"
              :aria-label="`Cantidad de ${fmtDenom(d)}`"
              class="w-16 px-2 py-1 rounded-lg border border-border text-sm font-bold text-navy text-right tabular-nums focus:outline-none focus:border-navy" />
          </div>
        </div>
        <p v-if="useDenominations" class="mt-3 text-sm font-bold text-navy tabular-nums" data-testid="denominations-total">
          Efectivo contado: {{ money((arqueo.methods.find(m => m.method === 'cash')?.counted) ?? 0) }}
        </p>
      </div>

      <!-- Motivo: obligatorio cuando la diferencia no cuadra -->
      <div class="pt-5">
        <div v-if="arqueo.requiresReason">
          <label for="close-reason" class="text-[11px] font-bold text-coral uppercase tracking-wide mb-2 block">
            Motivo de la diferencia (obligatorio)
          </label>
          <textarea id="close-reason" v-model="closeReason" rows="3"
            placeholder="Ej: faltante de cambio en el cierre, cobro duplicado devuelto, error de vuelto…"
            class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-coral"></textarea>
          <p class="text-[11px] text-text-muted mt-1.5">La diferencia queda registrada en el histórico del turno junto a este motivo.</p>
        </div>
        <p v-else-if="!arqueo.pendingCount" class="text-xs font-bold text-teal">El arqueo cuadra — no hace falta motivo.</p>
        <p v-if="arqueo.pendingCount" class="text-xs font-bold text-text-muted">Contá todos los métodos para habilitar el cierre.</p>
      </div>

      <template #footer>
        <button @click="showClose = false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="doCloseShift" :disabled="closing || !closeValid" class="rounded-full bg-coral text-white text-sm font-extrabold px-5 py-2.5 hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50">
          {{ closing ? 'Cerrando...' : 'Confirmar cierre' }}
        </button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>
