<script setup lang="ts">
// components/features/ReservationModal.vue — Detalle de reserva completo (F3 match-misterplan).
// Modal two-panel en modo LECTURA. Botón "Editar" emite @edit (el padre abre el form existente).
// Acciones: Confirmar / Anular / Factura (imprimible) + bonos (alojamiento / cliente).
// Spec: openspec/changes/match-misterplan/specs/reservation-modal/spec.md (REQ-1 a REQ-12).

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { pushModal, popModal } from '@/composables/useModalStack'
import { ReservationService } from '@/services/Reservation.service'
import { WhatsappService } from '@/services/Whatsapp.service'
import type { WhatsappTemplate } from '@/services/Whatsapp.service'
import { AiReceptionistService } from '@/services/AiReceptionist.service'
import { PaymentsService } from '@/services/Payments.service'
import { FoliosService } from '@/services/Folios.service'
import { AutoMessagesService } from '@/services/AutoMessages.service'
import { AddonsService } from '@/services/Addons.service'
import { ConfigService } from '@/services/Platform.service'
import { ApiError } from '@/services/http'
import { HotelService, type HotelData } from '@/services/Hotel.service'
import { RoomService } from '@/services/Room.service'
import { TTLockService, type LockDevice } from '@/services/TTLock.service'
import { effectiveCheckInTime, effectiveCheckOutTime, hasCustomSchedule, hotelCheckInTime, hotelCheckOutTime } from '@/utils/hotel-schedule'
import { paymentStateBadge } from '@/utils/payment-state'
import ChannelIcon from '@/components/ui/ChannelIcon.vue'
import AppModal from '@/components/ui/AppModal.vue'
import CancelReservationModal from '@/components/features/CancelReservationModal.vue'
import MarkPaidModal from '@/components/features/MarkPaidModal.vue'
import RoomLockModal from '@/components/features/RoomLockModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'
import { useConfirm } from '@/composables/useConfirm'
import { useInvoiceActions } from '@/composables/useInvoiceActions'
import { nationalityToFlag, languageToFlag } from '@/composables/useCountryFlag'
import type { ReservationDetail, ReservationDetailAddon, ReservationPriceBreakdown, ReservationInvoiceView, CurrencyConfig, GuaranteeCardData, AuditLogEntry, CancellableReservation, Reservation, PaymentAttemptView } from '@/types'

const props = defineProps<{ reservationId: string }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit', detail: ReservationDetail): void
  (e: 'changed'): void
}>()

const toast = useToast()
const { can } = usePermissions()
const MS_PER_DAY = 86_400_000

const detail = ref<ReservationDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const showCancel = ref(false)
const showMarkPaid = ref(false)
const autoSend = ref(true)
const conditions = ref({ gdpr: false, marketing: false, terms: false })
const otherCharges = ref(0)
const otherChargesDraft = ref('0')
const currency = ref<CurrencyConfig | null>(null)
const waTemplates = ref<{ id?: string; title?: string; channel?: string; whatsappBody?: string | null }[]>([])
/** Plantillas APROBADAS por Meta: las únicas que se pueden mandar por la API. */
const metaTemplates = ref<WhatsappTemplate[]>([])
/** ¿El hotel conectó su WhatsApp? Sin conexión el envío real no existe y queda el enlace de siempre. */
const waConectado = ref(false)
const enviandoMeta = ref('')
const addons = ref<ReservationDetailAddon[]>([])
const auditLogs = ref<AuditLogEntry[]>([])
const newAddon = ref({ description: '', amount: 0, kind: 'service' as 'service' | 'discount' })
const folioCharges = ref<{ description?: string; amount?: number; kind?: string }[] | null>(null)
// Requerimiento 13 (Administración | Composición de huéspedes, 2026-09-03) — cuando esta reserva
// es UNA habitación de una reserva de varias (`d.groupId`), acá quedan las DEMÁS habitaciones del
// mismo grupo, para mostrar la composición de cada una (adultos/niños/edades/reclasificación) sin
// tener que abrir cada reserva por separado.
const groupRooms = ref<Reservation[]>([])
const otherGroupRooms = computed(() => groupRooms.value.filter((r) => r.id !== props.reservationId))

/** Trae las reservas hermanas (mismo `groupId`) + el catálogo de habitaciones del hotel, para
 *  poder mostrar "Habitación N · tipo" de cada una — `GET /api/reservas?groupId=` no hace join
 *  con `rooms` (mismo criterio que el resto del listado, sin enriquecer), así que se resuelve
 *  acá igual que `pages/reservations/index.vue` (mapa roomId → room). */
async function loadGroupRooms(hotelId: string, groupId: string) {
  try {
    const [{ reservations }, { rooms }] = await Promise.all([
      ReservationService.list({ groupId, limit: 50 }),
      RoomService.list({ hotelId }),
    ])
    const byRoomId = new Map(rooms.map((r) => [r.id, r]))
    groupRooms.value = reservations.map((r) => {
      const room = byRoomId.get(r.roomId)
      return room ? { ...r, roomNumber: room.number, roomType: room.type } : r
    })
  } catch {
    groupRooms.value = []
  }
}
// Emisor de la factura (nombre, dirección, RNC, impuesto). Se carga del hotel de la reserva.
const hotelInfo = ref<HotelData | null>(null)
// 'charges' = comprobante de cargos de la reserva. NO es una factura: no lleva numeración fiscal
// ni NCF y no entra al libro de ventas. La factura real se emite con `POST /api/reservas/:id/invoice`
// (REQ-FDR-02) desde el botón "Facturar" de este modal (ver `facturar()`); el backend es quien
// controla el numerador y la vincula con los pagos ya registrados.
type PrintMode = 'detail' | 'voucherLodging' | 'voucherClient' | 'charges' | 'quote'
const printMode = ref<PrintMode>('detail')
/** Cuántos envíos muestra la tarjeta "Historial de Envíos" (el detalle los devuelve ordenados
 *  por fecha, más reciente primero). El historial completo vive en Marketing → Mensajes. */
const MESSAGE_LOG_PREVIEW = 5

// Tarjeta de garantía (MisterPlan): se revela solo tras ingresar el PIN del hotel.
const guaranteeUnlocked = ref(false)
const guaranteePin = ref('')
const guaranteeCard = ref<GuaranteeCardData | null>(null)
const guaranteeError = ref('')
const unlocking = ref(false)
const sendingLockCode = ref(false)

// Cerradura de la habitación (independiente de si ya hay un código generado para la reserva):
// deja generar el código / revisar conexión desde acá aunque `d.lockCodes` todavía esté vacío
// (antes, sin código previo, esta vista no ofrecía ninguna acción sobre la cerradura).
const roomLockDevice = ref<LockDevice | null>(null)
const generatingLockCode = ref(false)
const checkingLockStatus = ref(false)
// Gestor completo de la cerradura (RoomLockModal): permite ASIGNAR una cerradura cuando la
// habitación no tiene, y administrar batería/gateway/apertura cuando sí.
const showRoomLockManager = ref(false)
function openRoomLockManager() { showRoomLockManager.value = true }

/**
 * Abrir / cerrar la puerta desde la reserva. Una sola bandera para las dos: no tiene sentido pedir
 * abrir mientras se está cerrando, y evita que el usuario dispare las dos órdenes contra la misma
 * cerradura. No todos los modelos cierran en remoto; si el de esta habitación no lo hace, el
 * backend devuelve el motivo de TTLock y se muestra tal cual.
 */
const doorAction = ref<'lock' | 'unlock' | null>(null)
const doorBusy = computed(() => doorAction.value !== null)

async function operateDoor(action: 'lock' | 'unlock') {
  const id = roomLockDevice.value?.id
  if (!id || doorBusy.value) return
  doorAction.value = action
  try {
    if (action === 'unlock') await TTLockService.unlockLock(id)
    else await TTLockService.lockLock(id)
    toast.success(action === 'unlock' ? 'Puerta abierta' : 'Puerta cerrada')
  } catch (e) {
    toast.error((e as Error).message || (action === 'unlock' ? 'No se pudo abrir la puerta' : 'No se pudo cerrar la puerta'))
  } finally {
    doorAction.value = null
  }
}
const doorUnlock = () => operateDoor('unlock')
const doorLock = () => operateDoor('lock')
async function onRoomLockChanged() {
  await load()
  if (d.value?.roomId) await loadRoomLockDevice(d.value.roomId)
}

async function loadRoomLockDevice(roomId?: string | null) {
  roomLockDevice.value = null
  if (!roomId || !can('ttlock', 'view')) return
  try {
    const { data } = await TTLockService.listLocks()
    roomLockDevice.value = data.find((l) => l.roomId === roomId) || null
  } catch {
    roomLockDevice.value = null
  }
}

// Creación manual de código: form colapsable con el PIN elegido por el staff (4-9 dígitos).
const manualLockOpen = ref(false)
const manualLockCode = ref('')
const copiedLockCode = ref('')
const revokingLockCode = ref(false)

/** Una reserva = UN código vigente. La UI muestra solo este; los anteriores van al historial. */
const currentLockCode = computed<any | null>(() => {
  const live = (d.value?.lockCodes || []).filter((lc: any) => lc.status === 'active' || lc.status === 'pending')
  return live[live.length - 1] ?? null
})
const oldLockCodes = computed<any[]>(() =>
  (d.value?.lockCodes || []).filter((lc: any) => lc.status !== 'active' && lc.status !== 'pending'),
)

/** Desactivar el código vigente: borra el PIN de la cerradura física y lo marca revocado. */
async function revokeLockCode() {
  const cur = currentLockCode.value
  if (!cur || revokingLockCode.value) return
  if (!confirm(`¿Desactivar el código ${cur.code}? Se borra de la cerradura y el huésped no podrá abrir.`)) return
  revokingLockCode.value = true
  try {
    await TTLockService.revokeCode(String(cur.id))
    toast.success('Código desactivado')
    await load()
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo desactivar el código')
  } finally {
    revokingLockCode.value = false
  }
}

async function generateLockCode(customCode?: string) {
  if (!d.value) return
  if (customCode !== undefined) {
    if (!/^\d{4,9}$/.test(customCode)) {
      toast.error('Código manual inválido', 'Debe tener entre 4 y 9 dígitos')
      return
    }
    const dup = (d.value.lockCodes || []).some((lc: any) => lc.code === customCode && (lc.status === 'active' || lc.status === 'pending'))
    if (dup) { toast.error('Ese PIN ya está activo para esta reserva'); return }
  }
  generatingLockCode.value = true
  try {
    await TTLockService.generateCode(d.value.id, customCode)
    toast.success(customCode ? 'Código creado' : 'Código de cerradura generado')
    manualLockOpen.value = false
    manualLockCode.value = ''
    await load()
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo generar el código')
  } finally {
    generatingLockCode.value = false
  }
}

/** WhatsApp con el código pre-cargado — link wa.me directo al chat del huésped, no requiere
 *  creds de Meta Business (la API de WhatsApp del backend sigue sin credenciales). */
/** Fecha "YYYY-MM-DD" → "14 de agosto de 2026" para mensajes de WhatsApp. */
function waDate(s?: string | null): string {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return s }
}

/** WhatsApp con el mismo contenido de la plantilla de bienvenida (email checkin_welcome):
 *  saludo, hotel, código, habitación, horarios y WiFi — solo las líneas con datos.
 *  SIN emojis: los code points de 4 bytes se corrompen (�) en algún punto de la cadena
 *  navegador→wa.me→WhatsApp (verificado en producción); los caracteres de 2-3 bytes (—, ¡, ó)
 *  llegan bien, así que el mensaje usa guiones como bullets. */
function lockCodeWaLink(code: string, startDate?: string | null, endDate?: string | null): string | null {
  const g = d.value?.guest
  const h = hotelInfo.value as any
  const room = d.value?.room?.number
  const lines = [
    `Bienvenido${g?.name ? ', ' + g.name : ''}`,
    '',
    `Nos complace darle la bienvenida a ${h?.name || 'nuestro hotel'}.`,
    '',
    `- Acceso al hotel — Código: ${code}`,
    room ? `- Habitación ${room} — Código: ${code}` : `- Código de acceso: ${code}`,
  ]
  if (startDate && endDate) {
    // Horario EFECTIVO de ESTA reserva (early check-in / late checkout) con el del hotel de
    // respaldo. Antes leía `h.checkInTime`, campo inexistente → siempre decía 14:00 (fix 2026-08-29).
    lines.push(`- Check-in: ${waDate(startDate)} a partir de las ${effectiveCheckInTime(d.value, h)}`)
    lines.push(`- Check-out: ${waDate(endDate)} hasta las ${effectiveCheckOutTime(d.value, h)}`)
  }
  if (h?.wifiNetwork) lines.push(`- WiFi: ${h.wifiNetwork}${h.wifiPassword ? ' — Contraseña: ' + h.wifiPassword : ''}`)
  lines.push('', '¡Que disfrutes tu estancia!' + (h?.phone ? ` Cualquier cosa, llamá al ${h.phone}.` : ''))
  return waLink(g?.phone, lines.join('\n'))
}

async function copyLockCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    copiedLockCode.value = code
    setTimeout(() => { if (copiedLockCode.value === code) copiedLockCode.value = '' }, 1500)
  } catch { toast.error('No se pudo copiar') }
}

/** "Ping": resincroniza batería/estado online contra la nube de TTLock (no abre la puerta). */
async function checkLockStatus() {
  if (!roomLockDevice.value) return
  checkingLockStatus.value = true
  try {
    await TTLockService.sync()
    await loadRoomLockDevice(d.value?.room?.id)
    toast.success('Estado de la cerradura actualizado')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo consultar la cerradura')
  } finally {
    checkingLockStatus.value = false
  }
}

async function unlockGuarantee() {
  if (!d.value) return
  guaranteeError.value = ''
  unlocking.value = true
  try {
    guaranteeCard.value = await ReservationService.unlockGuaranteeCard(d.value.id, guaranteePin.value)
    guaranteeUnlocked.value = true
  } catch (e) {
    guaranteeError.value = (e as Error).message || 'PIN incorrecto'
    guaranteeUnlocked.value = false
  } finally {
    unlocking.value = false
  }
}

const CARD_BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', other: 'Otra' }
function cardBrandLabel(b?: string): string {
  if (!b) return '—'
  return CARD_BRANDS[b] || b
}

// ── Carga ──
async function load(opts?: { silent?: boolean }) {
  // `silent`: refresco en caliente tras tocar extras/otros cobros o registrar un envío. NO toca
  // `loading` (con `loading=true` el AppModal se cierra un instante — `:open="!loading && !!d"` —
  // y el modal parpadea; y ponerlo en `false` al terminar destaparía una carga real en vuelo)
  // NI resetea la tarjeta de garantía: el staff acaba de destrabarla con el PIN y volver a
  // bloquearla en medio del flujo por haber cargado un extra es perder el trabajo hecho.
  const silent = !!opts?.silent
  if (!silent) {
    loading.value = true
    guaranteeUnlocked.value = false
    guaranteeCard.value = null
    guaranteePin.value = ''
    guaranteeError.value = ''
  }
  try {
    const d = await ReservationService.getById(props.reservationId)
    detail.value = d
    autoSend.value = d?.autoSendEnabled ?? true
    conditions.value = { gdpr: !!d?.gdprAccepted, marketing: !!d?.marketingAccepted, terms: !!d?.termsAccepted }
    // COR-7 — En un refresco SILENCIOSO el operador puede estar tipeando en "Otros cobros":
    // pisarle el input le borra lo que estaba por guardar. El borrador sólo se reescribe si
    // sigue en sincronía con el último valor conocido del servidor (o sea: no lo tocó).
    const serverOtherCharges = Number(d?.otherCharges ?? 0)
    const draftIsDirty = silent && Number(otherChargesDraft.value) !== Number(otherCharges.value)
    otherCharges.value = serverOtherCharges
    if (!draftIsDirty) otherChargesDraft.value = String(serverOtherCharges)
    addons.value = d?.addons ?? []
    // Requerimiento 13 — sin `groupId` no hay hermanas que traer; se limpia por si el modal se
    // reabrió sobre OTRA reserva (misma instancia del componente, `reservationId` cambia por prop).
    groupRooms.value = []
    // Config + plantillas WA en paralelo (no bloquean el detalle)
    Promise.all([
      ConfigService.get('currency_config').then((c: CurrencyConfig) => { currency.value = c }).catch(() => {}),
      AutoMessagesService.list().then((r) => {
        waTemplates.value = (r.data || []).filter((m) => m.channel === 'whatsapp' || m.channel === 'both')
      }).catch(() => {}),
      ReservationService.getAudit(props.reservationId).then((r) => { auditLogs.value = r.data || [] }).catch(() => {}),
      HotelService.settings(d?.hotelId).then((s) => { hotelInfo.value = (s as { hotel?: HotelData }).hotel ?? null }).catch(() => {}),
      loadRoomLockDevice(d?.room?.id),
      // Requerimiento 13 — las demás habitaciones de esta reserva de varias (mismo groupId), para
      // mostrar la composición de cada una.
      d?.groupId ? loadGroupRooms(d.hotelId, d.groupId) : Promise.resolve(),
    ]).catch(() => {})
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo cargar la reserva')
    if (!silent) emit('close')
  } finally {
    if (!silent) loading.value = false
  }
}

// D7 — Historial (audit trail): etiquetas legibles + formato de fecha.
function auditLabel(action: string): string {
  const m: Record<string, string> = {
    create: 'Reserva creada', update: 'Actualizada', delete: 'Eliminada',
    checkin: 'Check-in', checkout: 'Check-out', no_show: 'No-show',
  }
  return m[action] || action
}
function fmtAuditDate(iso?: string | null): string {
  if (!iso) return '—'
  const dt = new Date(iso)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

watch(() => props.reservationId, (id) => { if (id) load() }, { immediate: true })

// El padre monta/desmonta este componente con v-if: su sola existencia ES el modal
// abierto, así que el bloqueo de scroll del body va en el ciclo de vida del componente
// (mismo patrón que AppModal.vue) — sin esto, la rueda del mouse sobre el modal también
// scrollea la página de atrás.
onMounted(() => { document.body.style.overflow = 'hidden'; pushModal(); cargarEnvioMeta() })
onBeforeUnmount(() => { document.body.style.overflow = ''; popModal() })

// ── Computed ──
const d = computed(() => detail.value)
const nights = computed(() => {
  if (!d.value?.checkIn || !d.value?.checkOut) return 0
  return Math.max(1, Math.round((new Date(d.value.checkOut).getTime() - new Date(d.value.checkIn).getTime()) / MS_PER_DAY))
})
// Horario de acceso de ESTA reserva: lo acordado con el huésped pisa el general del hotel.
// Es el MISMO cálculo que usa el backend para la ventana del código de la cerradura
// (`shared/utils/hotel-schedule.ts`), así lo que se ve acá es lo que abre la puerta.
const scheduleCheckIn = computed(() => effectiveCheckInTime(d.value, hotelInfo.value))
const scheduleCheckOut = computed(() => effectiveCheckOutTime(d.value, hotelInfo.value))
const scheduleIsCustom = computed(() => hasCustomSchedule(d.value))
const hotelCheckIn = computed(() => hotelCheckInTime(hotelInfo.value))
const hotelCheckOut = computed(() => hotelCheckOutTime(hotelInfo.value))

// Total cobrable y pendiente: los calcula el BACKEND (shared/utils/reservation-balance.ts) para que
// el renglón "Pendiente de cobro", el monto que se le manda a Stripe y el documento impreso digan
// todos lo mismo. Acá NO se re-deriva la fórmula: una copia local es una segunda fuente de verdad
// que nada obliga a moverse junto con la del servidor. El modal no se muestra hasta tener el
// detalle cargado (`:open="!loading && !!d"`), así que siempre hay número del backend.
const grandTotal = computed(() => d.value?.chargeableTotal ?? 0)
const pending = computed(() => d.value?.pendingAmount ?? 0)
/**
 * Lo que el huésped pagó DE MÁS. `pendingAmount` recorta en 0, así que sin esta fila un excedente
 * se veía idéntico a una reserva saldada: quien pagó $210 por una estadía que después bajó a $195
 * quedaba en "Pendiente: 0" y esos $15 no aparecían en ninguna pantalla del panel.
 */
const credit = computed(() => d.value?.creditAmount ?? 0)
// Lo COBRADO según `payments` (backend `shared/usecases/reservation-paid.ts`). Los documentos
// impresos decían "Pagado" mostrando `deposit`, que no incluye lo cobrado por folio ni por
// factura: con "Pendiente" ya calculado sobre `payments`, TOTAL − Pagado no cerraba (GH-0.2).
const paidTotal = computed(() => d.value?.paidAmount ?? d.value?.deposit ?? 0)
const pricePerNight = computed(() => {
  const n = nights.value
  return n > 0 ? Math.round(((d.value?.totalAmount ?? 0) / n) * 100) / 100 : d.value?.room?.basePrice ?? 0
})
const locator = computed(() => d.value?.externalLocator || `#${(d.value?.id || '').slice(-6)}`)
const addonsTotal = computed(() => d.value?.addonsTotal ?? 0)

// ── #269 Extras pagados online ──────────────────────────────────────────
// El motor público materializa upsells/amenidades como `reservation_addons` con
// `source:'booking_engine'`: YA están dentro de `totalAmount` (no suman al pendiente) y no se
// editan desde el CRUD manual de "Otros servicios y descuentos". Los manuales del recepcionista
// siguen con `source:'manual'` (o sin source en filas viejas).
const BOOKING_ENGINE_SOURCE = 'booking_engine'
const isBookingEngineAddon = (a: ReservationDetailAddon) => a.source === BOOKING_ENGINE_SOURCE
/** Addons que sí edita recepción (servicios/descuentos): alimentan la lista, el CRUD y el documento. */
const manualAddons = computed(() => addons.value.filter((a) => !isBookingEngineAddon(a)))
/** Addons del motor (upsell / child_amenity / room_amenity), sólo lectura. */
const paidExtras = computed(() => addons.value.filter(isBookingEngineAddon))
const PAID_EXTRA_KIND_LABELS: Record<string, string> = {
  upsell: 'Upsell',
  child_amenity: 'Amenidad infantil',
  room_amenity: 'Amenidad habitación',
  meal_plan: 'Régimen',
}
function paidExtraKindLabel(kind?: string | null): string {
  return (kind && PAID_EXTRA_KIND_LABELS[kind]) || 'Extra'
}
/** Importe de la línea (unitario × cantidad), sin impuesto — lo que muestra la sección. */
function paidExtraLineAmount(a: ReservationDetailAddon): number {
  return Math.round((a.amount ?? 0) * (a.quantity ?? 1) * 100) / 100
}
/** `priceBreakdown` parseado: según el driver la fila llega como objeto o como string JSON. */
const priceBreakdown = computed<ReservationPriceBreakdown | null>(() => {
  const raw = d.value?.priceBreakdown
  if (!raw) return null
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : null } catch { return null }
  }
  return typeof raw === 'object' ? raw : null
})
const pbNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const paidExtrasBreakdownTotal = computed(() => {
  const pb = priceBreakdown.value
  return pb ? pbNum(pb.upsellsTotal) + pbNum(pb.childAmenitiesTotal) + pbNum(pb.roomAmenitiesTotal) + pbNum(pb.mealPlanTotal) : 0
})
/** Sección "Extras pagados": sólo si hay filas del motor o el desglose trae extras > 0. */
const showPaidExtras = computed(() => paidExtras.value.length > 0 || paidExtrasBreakdownTotal.value > 0)
/** Filas del desglose de `priceBreakdown` en el orden del documento (las de importe 0 se omiten, salvo subtotal/total). */
const priceBreakdownRows = computed(() => {
  const pb = priceBreakdown.value
  if (!pb) return []
  const rows: { label: string; amount: number; negative?: boolean; strong?: boolean }[] = []
  rows.push({ label: 'Subtotal', amount: pbNum(pb.subtotal) })
  if (pbNum(pb.upsellsTotal) > 0) rows.push({ label: 'Extras (upsells)', amount: pbNum(pb.upsellsTotal) })
  if (pbNum(pb.childAmenitiesTotal) > 0) rows.push({ label: 'Amenidades infantiles', amount: pbNum(pb.childAmenitiesTotal) })
  if (pbNum(pb.roomAmenitiesTotal) > 0) rows.push({ label: 'Amenidades de habitación', amount: pbNum(pb.roomAmenitiesTotal) })
  if (pbNum(pb.mealPlanTotal) > 0) rows.push({ label: 'Régimen', amount: pbNum(pb.mealPlanTotal) })
  if (pbNum(pb.promoDiscount) > 0) rows.push({ label: 'Promoción', amount: -pbNum(pb.promoDiscount), negative: true })
  for (const t of pb.taxBreakdown ?? []) {
    rows.push({ label: `${t?.name || 'Impuesto'} (${pbNum(t?.rate)}%)`, amount: pbNum(t?.amount) })
  }
  if (!(pb.taxBreakdown?.length) && pbNum(pb.taxes) > 0) rows.push({ label: 'Impuestos', amount: pbNum(pb.taxes) })
  rows.push({ label: 'Total', amount: pbNum(pb.total), strong: true })
  return rows
})
const secondaryTotal = computed(() => {
  const rate = currency.value?.exchangeRate
  return rate && rate > 0 ? Math.round(grandTotal.value * rate * 100) / 100 : null
})
const secondaryCurrency = computed(() => currency.value?.secondaryCurrency || 'DOP')
const checkinUrl = computed(() => d.value?.checkinCode ? `${window.location.origin}/checkin/${d.value.checkinCode}` : null)

// ── Comprobante de cargos ───────────────────────────────────────────────
// NO es una factura: no lleva numeración fiscal ni NCF (eso vive en el módulo Facturación).
// El nombre de estos computeds acompaña al de `PrintMode`/`rm-charges` — que se llamaran
// `invoice*` sugería un documento fiscal que este modal no emite (STR-4).
// Impuesto: tasa/nombre del hotel (config real, NO hardcode). En hotelería el precio va
// con impuesto INCLUIDO: se desglosa la base y el impuesto contenido en el total, sin
// alterar lo que paga el huésped. Si el hotel no tiene tasa, no se desglosa.
const chargesTaxRate = computed(() => Number(hotelInfo.value?.taxRate ?? 0))
const chargesTaxName = computed(() => hotelInfo.value?.taxName || 'Impuesto')
const chargesTax = computed(() => {
  const r = chargesTaxRate.value
  return r > 0 ? Math.round((grandTotal.value - grandTotal.value / (1 + r / 100)) * 100) / 100 : 0
})
const chargesSubtotal = computed(() => Math.round((grandTotal.value - chargesTax.value) * 100) / 100)
const chargesDate = computed(() => new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }))

/**
 * CLN-1: los dos documentos imprimibles (comprobante de cargos y cotización/proforma) comparten el
 * 90% del markup. En vez de dos bloques gemelos de ~50 líneas —donde un arreglo entra en uno y se
 * olvida en el otro, y los dos muestran importes— hay UN bloque y acá lo que los distingue.
 */
interface PrintDoc {
  kind: 'charges' | 'quote'
  /** Clase que la media query de impresión usa para mostrar sólo el documento pedido. */
  cls: string
  title: string
  /** Aviso "SIN VALOR FISCAL" bajo el título. */
  fiscalWarning: boolean
  numberLabel: string
  showStatus: boolean
  /** RNC del hotel: sólo en el comprobante de cargos, que sí describe cobros hechos. */
  showTaxId: boolean
  showGuestDocument: boolean
  totalLabel: string
  /** Filas "Pagado"/"Pendiente". Una cotización no describe cobros: no las lleva. */
  showPayments: boolean
  notes: string[]
  showNoTaxNote: boolean
}

const printDocs = computed<PrintDoc[]>(() => [
  {
    kind: 'charges', cls: 'rm-charges', title: 'COMPROBANTE DE CARGOS',
    fiscalWarning: true, numberLabel: 'Reserva Nº', showStatus: true,
    showTaxId: true, showGuestDocument: true,
    totalLabel: 'TOTAL', showPayments: true,
    notes: [
      'Este documento detalla los cargos de la reserva. <b>No es una factura</b>: no tiene numeración '
      + 'fiscal ni NCF y no constituye comprobante ante la autoridad tributaria. '
      + 'La factura se emite desde Facturación.',
    ],
    showNoTaxNote: true,
  },
  {
    kind: 'quote', cls: 'rm-quote', title: 'COTIZACIÓN / PROFORMA',
    fiscalWarning: false, numberLabel: 'Nº', showStatus: false,
    showTaxId: false, showGuestDocument: false,
    totalLabel: 'TOTAL ESTIMADO', showPayments: false,
    notes: ['Documento informativo · No válido como factura fiscal'],
    showNoTaxNote: false,
  },
])
// Conceptos: alojamiento + extras (addons, descuentos en negativo) + otros cargos.
// #269 — Los extras del motor (`source:'booking_engine'`) YA viven dentro de `totalAmount`. Para
// que el documento los muestre sin alterar el total: cada extra va como línea propia por su valor
// con impuesto (unitario × cantidad × (1 + taxRate)) y "Alojamiento" es el RESTO
// (`totalAmount − Σ extras`), así la suma de conceptos sigue dando exactamente `totalAmount`
// sin depender del redondeo de `priceBreakdown` (que además es base sin impuesto y con la promo
// aplicada sobre el conjunto). Si no hay extras del motor, el documento no cambia.
const chargesItems = computed(() => {
  const items: { desc: string; amount: number }[] = []
  const roomLabel = d.value?.room ? `Alojamiento — Hab. ${d.value.room.number || ''} ${d.value.room.type || ''}`.trim() : 'Alojamiento'
  const engineLines = paidExtras.value.map((a) => {
    const qty = a.quantity ?? 1
    const gross = Math.round((a.amount ?? 0) * qty * (1 + (a.taxRate ?? 0) / 100) * 100) / 100
    return { desc: `${a.description || paidExtraKindLabel(a.kind)}${qty > 1 ? ` (×${qty})` : ''} · pagado online`, amount: gross }
  })
  const engineTotal = engineLines.reduce((acc, l) => acc + l.amount, 0)
  const total = d.value?.totalAmount ?? 0
  const lodging = engineLines.length ? Math.round((total - engineTotal) * 100) / 100 : total
  items.push({ desc: `${roomLabel} · ${nights.value} noche${nights.value === 1 ? '' : 's'}`, amount: lodging })
  items.push(...engineLines)
  for (const a of manualAddons.value) {
    const sign = a.kind === 'discount' ? -1 : 1
    const qty = a.quantity ?? 1
    items.push({ desc: (a.kind === 'discount' ? 'Descuento — ' : '') + (a.description || 'Extra') + (qty > 1 ? ` (×${qty})` : ''), amount: sign * (a.amount ?? 0) * qty })
  }
  if ((otherCharges.value || 0) !== 0) items.push({ desc: 'Otros cargos', amount: otherCharges.value })
  return items
})

// ── Helpers de formato ──
function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const dt = new Date(s.length <= 10 ? `${s}T12:00:00` : s)
  return isNaN(dt.getTime()) ? String(s) : dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  const dt = new Date(s)
  return isNaN(dt.getTime()) ? String(s) : dt.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function money(n?: number, currency?: string): string {
  const cur = currency || d.value?.currency || 'USD'
  const sym = cur === 'USD' ? 'US$' : cur === 'DOP' ? 'RD$' : cur + ' '
  return `${sym}${(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function moneySecondary(n: number): string {
  return `${secondaryCurrency.value === 'DOP' ? 'RD$' : secondaryCurrency.value + ' '}${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function stLabel(s?: string): string {
  const m: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmada', checked_in: 'Check-in', checked_out: 'Check-out', cancelled: 'Cancelada', no_show: 'No-show' }
  return m[s || ''] || s || '—'
}
function srcLabel(s?: string): string {
  const m: Record<string, string> = { direct: 'Directa', booking: 'Booking', expedia: 'Expedia', airbnb: 'Airbnb', agoda: 'Agoda', trip: 'Trip', google: 'Google', whatsapp: 'WhatsApp', phone: 'Teléfono', email: 'Email', walk_in: 'Walk-in' }
  return m[s || ''] || (s || '—')
}
function srcDot(s?: string): string {
  const m: Record<string, string> = { direct: 'bg-teal', booking: 'bg-cyan', expedia: 'bg-gold', airbnb: 'bg-coral', google: 'bg-blue-400', whatsapp: 'bg-emerald-400', agoda: 'bg-purple-400', trip: 'bg-pink-400' }
  return m[s || ''] || 'bg-white/70'
}
function regimeLabel(r?: string): string {
  const m: Record<string, string> = { room_only: 'Solo alojamiento', breakfast: 'Desayuno incluido', half_board: 'Media pensión', full_board: 'Pensión completa', all_inclusive: 'Todo incluido' }
  return m[r || ''] || (r || '—')
}
function payMethodLabel(p?: string | null): string {
  const m: Record<string, string> = { transfer: 'Transferencia', card: 'Tarjeta', cash: 'Efectivo', link: 'Link de pago', deposit: 'Depósito' }
  return m[p || ''] || (p || 'No especificado')
}
// Tarea 21 (Identificar bebés, 2026-09-08) — `childrenAgesDetail[].classification` del backend
// (shared/usecases/child-composition.ts) suma un cuarto balde ('baby') a los tres que ya había
// (free/paying/adult). Se saca a función aparte porque el ternario anidado de 3 ramas ya era el
// límite de lo legible en el template; una rama más ahí adentro hubiera sido ilegible.
function childClassificationLabel(c: string): string {
  const m: Record<string, string> = {
    baby: 'bebé, no consume plaza', free: 'no consume plaza', paying: 'consume plaza', adult: 'cuenta como adulto por edad',
  }
  return m[c] || c
}
// ── Historial de cobros (2026-08-30, pedido del cliente) ────────────────────
// La tarjeta mostraba un total "Pagado" y recepción no podía responder "¿por dónde pagó?".
// El backend lo arma en `shared/usecases/reservation-payment-history.ts`, desde la MISMA
// recolección con la que calcula el total — el desglose cuadra con el número de arriba.
const paymentHistory = computed(() => d.value?.paymentHistory ?? [])
// REQ-RWP-02 — intentos en la pasarela (Stripe/Azul…), más reciente primero. Los arma el backend
// en `shared/usecases/payment-attempt-view.ts` desde el PaymentAttemptStore: acá no se derivan.
const paymentAttempts = computed<PaymentAttemptView[]>(() => d.value?.paymentAttempts ?? [])

function attemptKindBadge(kind?: string | null): { label: string; cls: string } {
  const m: Record<string, { label: string; cls: string }> = {
    checkout_created: { label: 'Checkout abierto', cls: 'bg-blue-100 text-blue-700' },
    paid: { label: 'Pagado', cls: 'bg-teal/10 text-teal' },
    failed: { label: 'Rechazado', cls: 'bg-coral/10 text-coral' },
    expired: { label: 'Expirado', cls: 'bg-gray-100 text-gray-500' },
    refunded: { label: 'Devuelto', cls: 'bg-purple/10 text-purple' },
    pending: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' },
  }
  return m[kind || ''] || { label: kind || '—', cls: 'bg-gray-100 text-gray-500' }
}

function providerLabel(p?: string | null): string {
  const m: Record<string, string> = { stripe: 'Stripe', azul: 'Azul', cardnet: 'CardNet', paypal: 'PayPal' }
  const key = (p || '').toLowerCase()
  if (m[key]) return m[key]
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '—'
}

async function copyProviderRef(ref: string) {
  try {
    await navigator.clipboard.writeText(ref)
    toast.success('Referencia copiada')
  } catch { toast.error('No se pudo copiar') }
}

function paymentStatusLabel(status?: string | null): { label: string; cls: string } {
  const m: Record<string, { label: string; cls: string }> = {
    completed: { label: 'Cobrado', cls: 'bg-teal/10 text-teal' },
    pending: { label: 'Pendiente', cls: 'bg-gold/10 text-gold' },
    processing: { label: 'Procesando', cls: 'bg-gold/10 text-gold' },
    failed: { label: 'Fallido', cls: 'bg-coral/10 text-coral' },
    refunded: { label: 'Devuelto', cls: 'bg-purple/10 text-purple' },
  }
  return m[status || ''] || { label: status || '—', cls: 'bg-gray-100 text-gray-500' }
}

// Requerimiento 14 — badge pendiente/parcial/pagada: sale de `d.paymentState` (backend) vía `@/utils/payment-state`.
// REQ-RWP-02 — reemplaza al aviso anterior (`hasFailedPayment`), que sólo veía `payments` y nunca
// los intentos que no terminaron en cobro (rechazado/expirado en la pasarela). Se avisa sólo si el
// ÚLTIMO intento falló y la reserva no quedó pagada por otra vía: un fallo seguido de un cobro
// exitoso no es aviso.
const lastAttemptFailure = computed(() => {
  const last = paymentAttempts.value[0]
  if (!last || (last.kind !== 'failed' && last.kind !== 'expired') || d.value?.paymentState === 'paid') return null
  return last
})
function waLink(phone?: string | null, body?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}${body ? `?text=${encodeURIComponent(body)}` : ''}` : null
}

// ── Acciones ──
// Solo 'confirmed': anular NO es un cambio de estado más. Va por CancelReservationModal →
// POST /reservas/:id/cancel, que aplica la política del hotel (penalidad/reembolso), guarda el
// motivo y libera el depósito retenido. Con `update({status:'cancelled'})` nada de eso pasaba —
// y el backend ahora lo rechaza con 409, así que este camino tampoco existe ya del lado servidor.
// #272 (MR-07) — el reembolso web se dispara al cancelar; si Stripe falló queda `failed` y el
// hotel lo reintenta desde acá. 'done'/'pending'/'none' no ofrecen el botón: no hay nada que
// reintentar (o ya está en curso).
const canRetryRefund = computed(() =>
  d.value?.status === 'cancelled' && d.value?.refundStatus === 'failed' && can('reservations', 'edit'),
)
function refundStateBadge(status?: string | null): { label: string; cls: string } | null {
  const m: Record<string, { label: string; cls: string }> = {
    done: { label: 'Reembolsado', cls: 'bg-teal/10 text-teal' },
    pending: { label: 'Reembolso en proceso', cls: 'bg-amber-100 text-amber-800' },
    failed: { label: 'Reembolso fallido', cls: 'bg-coral/10 text-coral' },
  }
  return m[status || ''] ?? null
}
const refundBadge = computed(() => d.value?.status === 'cancelled' ? refundStateBadge(d.value?.refundStatus) : null)

async function retryRefund() {
  if (!d.value) return
  saving.value = true
  try {
    const res = await ReservationService.retryRefund(d.value.id)
    if (res.refundStatus === 'done') toast.success('Reembolso procesado')
    else toast.warning('El reembolso sigue sin completarse', 'La pasarela no lo aceptó: revisá el pago en Stripe')
    await load({ silent: true })
    emit('changed')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo reintentar el reembolso')
  } finally {
    saving.value = false
  }
}

async function setStatus(status: 'confirmed') {
  if (!d.value) return
  saving.value = true
  try {
    await ReservationService.update(d.value.id, { status })
    toast.success('Reserva confirmada')
    await load()
    emit('changed')
  } catch (e) {
    toast.error((e as Error).message || 'Error al actualizar')
  } finally {
    saving.value = false
  }
}

/** La reserva abierta, con la forma que pide CancelReservationModal. */
const cancellable = computed<CancellableReservation | null>(() => {
  const r = d.value
  if (!r) return null
  return {
    id: r.id,
    guestName: r.guest?.name ?? '',
    roomNumber: r.room?.number ?? '',
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    amount: r.totalAmount ?? undefined,
  }
})

async function onCancelled() {
  showCancel.value = false
  await load()
  emit('changed')
}

/**
 * Cobro manual guardado (REQ-RWP-06). Se recarga el detalle en silencio para que el badge
 * `payment-state-badge`, "Pendiente de cobro" y el "Historial de cobros" (con `Registró:`)
 * salgan del backend recalculado; `changed` refresca el listado del padre. No se toca
 * `deposit` desde acá: el anticipo es un dato de la reserva y el cobro vive en `payments`.
 */
async function onMarkPaid() {
  showMarkPaid.value = false
  await load({ silent: true })
  emit('changed')
}

// ── Horario de acceso de la reserva (2026-08-29, pedido de cliente) ──
// El hotel define un horario general (Configuración → Hotel), pero con un huésped puntual se
// acuerda otra cosa: entra a las 10 en vez de a las 15, o se va a las 18. Eso se pacta EN LA
// RESERVA, y es lo que define desde/hasta cuándo abre el código de la cerradura.
const scheduleOpen = ref(false)
const savingSchedule = ref(false)
const scheduleDraft = ref({ checkInTime: '', checkOutTime: '' })

function openScheduleEditor() {
  scheduleDraft.value = {
    checkInTime: d.value?.checkInTime || '',
    checkOutTime: d.value?.checkOutTime || '',
  }
  scheduleOpen.value = true
}

async function saveSchedule() {
  if (!d.value) return
  savingSchedule.value = true
  try {
    // '' es intencional: limpia el acuerdo y devuelve la reserva al horario del hotel.
    await ReservationService.update(d.value.id, {
      checkInTime: scheduleDraft.value.checkInTime || '',
      checkOutTime: scheduleDraft.value.checkOutTime || '',
    })
    scheduleOpen.value = false
    await load()
    emit('changed')
    toast.success('Horario actualizado')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar el horario')
  } finally {
    savingSchedule.value = false
  }
}

async function toggleAutoSend() {
  if (!d.value) return
  const next = !autoSend.value
  autoSend.value = next
  try {
    await ReservationService.update(d.value.id, { autoSendEnabled: next })
    toast.success(next ? 'Envíos automáticos activados' : 'Envíos automáticos desactivados')
  } catch (e) {
    autoSend.value = !next
    toast.error((e as Error).message || 'No se pudo guardar')
  }
}

async function toggleCondition(key: 'gdpr' | 'marketing' | 'terms') {
  if (!d.value) return
  const next = !conditions.value[key]
  conditions.value[key] = next
  try {
    if (key === 'gdpr') await ReservationService.update(d.value.id, { gdprAccepted: next })
    else if (key === 'marketing') await ReservationService.update(d.value.id, { marketingAccepted: next })
    else await ReservationService.update(d.value.id, { termsAccepted: next })
  } catch (e) {
    conditions.value[key] = !next
    toast.error((e as Error).message || 'No se pudo guardar')
  }
}

async function saveOtherCharges() {
  if (!d.value) return
  const val = Number(otherChargesDraft.value) || 0
  if (val === otherCharges.value) return
  saving.value = true
  try {
    await ReservationService.update(d.value.id, { otherCharges: val })
    otherCharges.value = val
    // Refresco: "Pendiente de cobro" y el monto del link de pago los recalcula el backend.
    await load({ silent: true })
    toast.success('Otros cobros actualizados')
  } catch (e) {
    otherChargesDraft.value = String(otherCharges.value)
    toast.error((e as Error).message || 'No se pudo guardar')
  } finally {
    saving.value = false
  }
}

async function sendLockCodeEmail() {
  if (!d.value) return
  sendingLockCode.value = true
  try {
    const res = await ReservationService.sendLockCodeEmail(d.value.id)
    toast.success(`Código enviado a ${res.sentTo}`)
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo enviar el email')
  } finally {
    sendingLockCode.value = false
  }
}

/** Link de pago ya emitido y sin cobrar para esta reserva (si lo hay). */
const openPaymentRequest = computed(() => (d.value?.payments ?? []).find((p) => p.status === 'pending' && !!p.id))
/** Monto por el que se emitió ese link. Es lo que cobraría el Checkout si se reusa tal cual. */
const openPaymentAmount = computed(() => Number(openPaymentRequest.value?.amount) || 0)
/**
 * GH-0.1 — El link vigente quedó por un monto distinto del saldo actual.
 *
 * Reusar el link sin mirar su monto es un undercharge silencioso: reserva de $300 → link →
 * se carga un extra de $200 → el saldo pasa a $500 y el Checkout salía igual por $300. El
 * `CENTAVO` de tolerancia evita reemitir por diferencias de redondeo.
 */
const CENTAVO = 0.01
const paymentLinkOutdated = computed(() =>
  !!openPaymentRequest.value && Math.abs(openPaymentAmount.value - pending.value) > CENTAVO)

async function requirePayment() {
  if (!d.value) return
  if (pending.value <= 0) { toast.info('Sin monto pendiente'); return }
  saving.value = true
  try {
    const email = d.value.guest?.email
    // COR-4/SEC-2 — Un click = un PaymentRequest nuevo por el pendiente COMPLETO. Con tres clicks
    // quedaban tres links de $500 vivos sobre un saldo de $500. El backend ahora lo rechaza
    // (el techo del monto descuenta los links `pending`), así que acá se REUSA el que ya existe en
    // vez de chocar contra un 400: mismo cobro, misma sesión de Stripe.
    // GH-0.1 — pero SOLO si su monto sigue siendo el saldo. Si quedó desfasado (se cargó un extra,
    // se cobró algo por folio) se le actualiza el importe al saldo de hoy antes de abrir el
    // Checkout: `create-checkout` emite una sesión de Stripe NUEVA con `pr.amount`, así que el
    // huésped paga lo que debe. El backend revalida el techo excluyendo este mismo request.
    const existing = openPaymentRequest.value
    // Actualizar el monto de un link es `PUT /payment-requests/:id` → `billing:edit`, que el rol
    // `receptionist` NO tiene (`shared/permissions.ts`: view + create). Sin permiso se avisa y se
    // corta: abrir el Checkout por el monto viejo sería el undercharge silencioso que este fix cierra.
    if (existing?.id && paymentLinkOutdated.value && !can('billing', 'edit')) {
      toast.error(`El link vigente es por ${money(openPaymentAmount.value)} y el saldo es ${money(pending.value)}: actualizarlo necesita permiso de edición de facturación.`)
      return
    }
    const created = existing?.id
      ? (paymentLinkOutdated.value
        ? await PaymentsService.update(existing.id, { amount: pending.value })
        : { id: existing.id })
      : await PaymentsService.create({ reservationId: d.value.id, amount: pending.value, sentTo: email || undefined, sentVia: email ? 'email' : 'link' })
    if (!created.id) { toast.error('No se pudo crear el requerimiento de pago'); return }
    const checkout = await PaymentsService.createStripeCheckout(created.id)
    if (checkout?.url) {
      // B2 (auditoría 2026-08-19): sin email del huésped el requerimiento era huérfano —
      // se abría una ventana que nadie recibía. Ahora el link queda en el portapapeles
      // para que el staff lo envíe por el canal que corresponda (WhatsApp, presencial).
      if (email) {
        // SEC-5: mismo criterio que `waSend` — la pestaña del Checkout de Stripe no puede
        // quedarse con `window.opener` del panel.
        window.open(checkout.url, '_blank', 'noopener,noreferrer')
        toast.success('Requerimiento de pago enviado por email')
      } else {
        await navigator.clipboard?.writeText(checkout.url).catch(() => {})
        toast.warning('El huésped no tiene email: link de pago copiado — envíaselo por WhatsApp o mostráselo')
      }
      // El renglón "Link de pago vigente" tiene que mostrar el monto REAL del link recién emitido.
      await load({ silent: true })
    }
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo generar el link de pago')
  } finally {
    saving.value = false
  }
}

async function viewMovements() {
  if (!d.value) return
  try {
    const list = await FoliosService.list(d.value.hotelId)
    const folio = (list || []).find((f) => f.reservationId === d.value!.id)
    if (!folio) { toast.info('Sin folio abierto (la reserva no está checked-in)'); return }
    const full = await FoliosService.get(folio.id)
    folioCharges.value = (full.charges || []).map((c) => ({ description: c.description ?? undefined, amount: c.amount ?? undefined, kind: c.kind ?? undefined }))
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo cargar el folio')
  }
}

async function addAddon() {
  if (!d.value || !newAddon.value.description.trim()) return
  try {
    const created = await AddonsService.create(d.value.id, { description: newAddon.value.description.trim(), kind: newAddon.value.kind, amount: newAddon.value.amount, quantity: 1 })
    addons.value.push(created)
    newAddon.value = { description: '', amount: 0, kind: 'service' }
    await load({ silent: true })
    toast.success('Servicio agregado')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo agregar')
  }
}

async function removeAddon(id: string) {
  try {
    await AddonsService.remove(id)
    addons.value = addons.value.filter((a) => a.id !== id)
    await load({ silent: true })
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo eliminar')
  }
}

/**
 * Abre WhatsApp con la plantilla y DEJA RASTRO en `message_logs`.
 *
 * El envío es manual (lo despacha el staff desde su propio WhatsApp), así que el log se asienta
 * como `queued` — "preparado y abierto", no `sent`: el sistema no puede confirmar la entrega y
 * marcarlo como enviado sería mentirle al historial. Si el log falla, el envío NO se cancela
 * (abrir WhatsApp es lo que el usuario pidió), pero se avisa para que no crea que quedó registrado.
 */
async function waSend(body?: string | null, templateTitle?: string) {
  const phone = d.value?.guest?.phone
  const link = waLink(phone, body)
  if (!link) { toast.error('Sin teléfono del huésped'); return }
  // SEC-5: `noopener` — sin él la pestaña de WhatsApp recibe `window.opener` y puede redirigir
  // la del panel (tabnabbing). `noreferrer` va de la mano y evita filtrar la URL de la reserva.
  window.open(link, '_blank', 'noopener,noreferrer')
  if (!d.value) return
  try {
    await ReservationService.logManualMessage(d.value.id, {
      messageType: 'whatsapp',
      recipient: phone || undefined,
      reference: templateTitle || 'mensaje libre',
      status: 'queued',
    })
    await load({ silent: true })
  } catch {
    toast.warning('WhatsApp abierto, pero no se pudo registrar el envío en el historial')
  }
}

/**
 * Envío REAL por la Cloud API de Meta, desde el servidor.
 *
 * Distinto de `waSend`, que abre WhatsApp en el navegador del recepcionista y no puede confirmar
 * nada: acá el mensaje sale del hotel, vuelve con acuse, y el estado de entrega lo dicta Meta.
 * Solo se ofrece con plantillas APROBADAS: fuera de la ventana de 24 h Meta rechaza cualquier otra
 * cosa, y el intento se cobra igual.
 */
async function enviarPorMeta(t: WhatsappTemplate) {
  if (!d.value || !t.id || enviandoMeta.value) return
  enviandoMeta.value = t.id
  try {
    const out = await ReservationService.sendWhatsapp(d.value.id, { templateId: t.id })
    toast.success('WhatsApp enviado', out.status === 'sent' ? 'Meta lo aceptó y lo está entregando' : undefined)
    await load({ silent: true })
  } catch (e: any) {
    toast.error('No se pudo enviar', e?.message || 'Revisá la conexión de WhatsApp del hotel')
  } finally {
    enviandoMeta.value = ''
  }
}

/** Carga lo que hace falta para ofrecer el envío real: conexión del hotel y plantillas aprobadas. */
async function cargarEnvioMeta() {
  try {
    const conn = await AiReceptionistService.getWhatsappConnection()
    waConectado.value = conn?.estado === 'connected'
  } catch {
    waConectado.value = false
  }
  if (!waConectado.value) return
  try {
    const r = await WhatsappService.list()
    metaTemplates.value = (r.data || []).filter((t) => t.approvalStatus === 'approved' && t.isActive !== false)
  } catch {
    metaTemplates.value = []
  }
}

function printAs(mode: PrintMode) {
  printMode.value = mode
  setTimeout(() => {
    window.print()
    setTimeout(() => { printMode.value = 'detail' }, 500)
  }, 60)
}

function editar() { if (d.value) emit('edit', d.value) }

// ── Facturas (REQ-FDR-02/03, #254) ──
// Las facturas ya emitidas de la reserva vienen en `d.invoices` (más reciente primero). Imprimir /
// PDF / Email son las mismas acciones de /panel/billing (`useInvoiceActions`); emitir es
// `POST /api/reservas/:id/invoice`: el backend controla el numerador (número + NCF) y vincula los
// pagos ya registrados — este modal no fabrica numeración por su cuenta.
const {
  printFrame, printInvoice, downloadPdf,
  showEmailModal, emailTarget, emailTo, emailError, sendingEmail,
  openEmailModal, closeEmailModal, confirmEmail,
} = useInvoiceActions()

const invoicesCard = ref<HTMLElement | null>(null)
const issuing = ref(false)

function invoiceStatusBadge(status?: string): { label: string; cls: string } {
  const m: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
    paid: { label: 'Pagada', cls: 'bg-teal/10 text-teal' },
    overdue: { label: 'Vencida', cls: 'bg-coral/10 text-coral' },
    cancelled: { label: 'Anulada', cls: 'bg-gray-100 text-gray-500' },
    draft: { label: 'Borrador', cls: 'bg-gray-100 text-gray-500' },
  }
  return m[status || ''] || { label: status || '—', cls: 'bg-gray-100 text-gray-500' }
}

/** Una nota de crédito resta: se muestra en negativo para que el total de la tarjeta se lea sin sumar mentalmente. */
function invoiceAmount(inv: ReservationInvoiceView): string {
  if (inv.type === 'credit_note') return `-${money(Math.abs(inv.amount), inv.currency)}`
  return money(inv.amount, inv.currency)
}

function scrollToInvoices() {
  const el = invoicesCard.value
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: async () => {
    toast.success('Factura emitida')
    await load({ silent: true })
    emit('changed')
    await nextTick()
    scrollToInvoices()
  },
  onError: async (e) => {
    // 409: la reserva ya tenía factura (otro operador la emitió mientras este modal estaba abierto).
    // No es un error del usuario: se recarga y se muestra la existente en la tarjeta.
    if (e instanceof ApiError && e.status === 409) {
      toast.warning('Ya tiene factura')
      await load({ silent: true })
      await nextTick()
      scrollToInvoices()
      return
    }
    toast.error((e as Error)?.message || 'No se pudo emitir la factura')
  },
})

/** Botón "Facturar": si ya hay factura, muestra la existente; si no, confirma y emite. */
function facturar() {
  if (!d.value) return
  if (d.value.invoices?.length) { scrollToInvoices(); return }
  const total = d.value.chargeableTotal ?? d.value.totalAmount ?? 0
  const guestName = d.value.guest?.name || 'el huésped'
  askConfirm({
    title: 'Emitir factura',
    message: `Se emitirá la factura por ${money(total, d.value.currency || undefined)} a nombre de ${guestName}. Los pagos ya registrados quedan vinculados.`,
    confirmLabel: 'Facturar',
    run: async () => {
      if (!d.value) return
      issuing.value = true
      try { await ReservationService.issueInvoice(d.value.id) } finally { issuing.value = false }
    },
  })
}
</script>

<template>
  <AppModal :open="!loading && !!d" size="3xl" body-class="p-0" @close="emit('close')">
    <template #header>
      <div class="flex items-center gap-3 flex-wrap">
        <div>
          <div class="text-[10px] uppercase font-bold text-white/50">Reserva</div>
          <h3 class="text-lg font-black text-white leading-tight">{{ locator }}</h3>
        </div>
        <span class="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/15 text-white">
          <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          {{ stLabel(d?.status) }}
        </span>
        <span class="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/15 text-white">
          <ChannelIcon :channel="d?.source || d?.channel || 'direct'" :size="14" class="ring-1 ring-white/40 rounded-[4px]" />
          {{ srcLabel(d?.source || d?.channel) }}
        </span>
        <button v-if="d?.status === 'pending' && can('reservations','edit')" @click="setStatus('confirmed')" :disabled="saving" class="flex items-center gap-1.5 px-3 py-1.5 max-sm:min-h-11 bg-teal text-white rounded-lg text-xs font-bold cursor-pointer hover:opacity-90 disabled:opacity-50">
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
          Confirmar
        </button>
        <button v-if="d?.status !== 'cancelled' && d?.status !== 'checked_out' && can('reservations','edit')" @click="showCancel = true" :disabled="saving" class="flex items-center gap-1.5 px-3 py-1.5 max-sm:min-h-11 bg-coral/90 text-white rounded-lg text-xs font-bold cursor-pointer hover:opacity-90 disabled:opacity-50">
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          Anular
        </button>
        <!-- #272 (MR-07) — el reembolso web quedó `failed` en Stripe: se reintenta desde acá
             (POST /reservas/:id/retry-refund). Con 'done' o 'pending' el botón no existe. -->
        <button v-if="canRetryRefund" data-testid="retry-refund" @click="retryRefund" :disabled="saving" class="flex items-center gap-1.5 px-3 py-1.5 max-sm:min-h-11 bg-amber-500 text-white rounded-lg text-xs font-bold cursor-pointer hover:opacity-90 disabled:opacity-50" title="El reembolso en la pasarela falló: vuelve a intentarlo con el mismo monto">
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
          {{ saving ? 'Reintentando…' : 'Reintentar reembolso' }}
        </button>
        <button @click="printAs('charges')" class="flex items-center gap-1.5 px-3 py-1.5 max-sm:min-h-11 bg-white/10 text-white rounded-lg text-xs font-bold cursor-pointer hover:bg-white/20" title="Imprime el detalle de cargos de la reserva. NO es una factura: no lleva numeración fiscal ni NCF.">
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.83a42.5 42.5 0 0110.56 0M6.34 18l-.34 3.72a1.12 1.12 0 001.12 1.23h9.4a1.12 1.12 0 001.12-1.23L17.66 18M17.66 18h1.09c1.06 0 1.98-.72 2-1.78a72 72 0 000-3.45c-.02-1.06-.94-1.77-2-1.77H5.25c-1.06 0-1.98.71-2 1.77a72 72 0 000 3.45c.02 1.06.94 1.78 2 1.78h1.09M17.66 18H6.34M17.66 18v-4.5a2.25 2.25 0 00-2.25-2.25h-6.5a2.25 2.25 0 00-2.25 2.25V18"/></svg>
          Cargos
        </button>
        <button v-if="can('billing','create')" data-testid="invoice-issue-button" @click="facturar" :disabled="issuing" class="flex items-center gap-1.5 px-3 py-1.5 max-sm:min-h-11 bg-white/10 text-white rounded-lg text-xs font-bold cursor-pointer hover:bg-white/20 disabled:opacity-50" title="Emitir la factura con numeración fiscal (si ya tiene, muestra la existente)">
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h2M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>
          {{ issuing ? 'Facturando…' : 'Facturar' }}
        </button>
        <button v-if="can('reservations','edit')" @click="editar" class="flex items-center gap-1.5 px-3 py-1.5 max-sm:min-h-11 bg-cyan text-navy rounded-lg text-xs font-black cursor-pointer hover:opacity-90">
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.932zM19.5 21H4.5a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5h9"/></svg>
          Editar
        </button>
      </div>
    </template>

    <!-- ═══ BODY: masonry de una sola vista (sin pasos, sin columnas fijas) — las tarjetas
         fluyen para no dejar huecos cuando una condicional no aplica (área de impresión) ═══ -->
    <div v-if="d" :class="'print-' + printMode">
      <div class="rm-cards rm-print-area p-5 columns-1 lg:columns-2 lg:gap-5">

            <!-- Datos de la Reserva -->
            <details open class="rm-card bg-white border border-border/70 border-l-[3px] border-l-navy/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h1M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg></span> Datos de la Reserva
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-2 text-sm">
                <div class="flex justify-between gap-3"><span class="text-text-muted">Origen</span><span class="font-bold text-right">{{ srcLabel(d.source || d.channel) }}</span></div>
                <div class="flex justify-between gap-3"><span class="text-text-muted">Comisión</span><span class="font-bold text-right">{{ d.commission ? `${d.commission}%` : '—' }}{{ d.commissionAmount ? ` (${money(d.commissionAmount)})` : '' }}</span></div>
                <div class="flex justify-between gap-3"><span class="text-text-muted">Localizador interno</span><span class="font-mono text-right text-xs">{{ d.id.slice(-8) }}</span></div>
                <div v-if="d.externalLocator" class="flex justify-between gap-3"><span class="text-text-muted">Localizador OTA</span><span class="font-mono text-right text-xs">{{ d.externalLocator }}</span></div>
                <div class="flex justify-between gap-3"><span class="text-text-muted">Creada</span><span class="text-right flex items-center gap-1"><svg class="h-3 w-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2"/></svg>{{ fmtDateTime(d.createdAt) }}</span></div>
                <div class="flex justify-between gap-3 items-center bg-cyan/8 rounded-xl px-3 py-2 -mx-1"><span class="text-text-muted flex items-center gap-1.5"><svg class="h-3.5 w-3.5 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>Entrada – Salida</span><span class="font-bold text-right text-navy">{{ fmtDate(d.checkIn) }} – {{ fmtDate(d.checkOut) }} <span class="text-text-muted font-normal">({{ nights }}n)</span></span></div>
                <!-- Horario de acceso (2026-08-29): lo que realmente abre la puerta. Sale del
                     acuerdo con este huésped o, en su defecto, del horario del hotel. -->
                <div class="flex justify-between gap-3 items-center" data-testid="reservation-schedule">
                  <span class="text-text-muted">Horario</span>
                  <span class="font-bold text-right text-navy">
                    {{ scheduleCheckIn }} – {{ scheduleCheckOut }}
                    <span v-if="scheduleIsCustom" class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gold/15 text-gold align-middle">Acordado</span>
                    <span v-else class="ml-1 text-[10px] text-text-muted font-normal">(del hotel)</span>
                  </span>
                </div>
                <!-- Check-in / check-out REALIZADOS. El backend siempre guardó `checkedInAt`
                     (reservas/usecases/checkin.ts), pero ninguna vista lo mostraba: el recepcionista
                     hacía el check-in y no veía en ningún lado que hubiera quedado registrado. -->
                <div v-if="d.checkedInAt" class="flex justify-between gap-3 items-center bg-teal/8 rounded-xl px-3 py-2 -mx-1" data-testid="reservation-checked-in">
                  <span class="text-text-muted flex items-center gap-1.5">
                    <svg class="h-3.5 w-3.5 text-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>Check-in realizado
                  </span>
                  <span class="font-bold text-right text-teal">{{ fmtDateTime(d.checkedInAt) }}</span>
                </div>
                <div v-if="d.checkedOutAt" class="flex justify-between gap-3 items-center" data-testid="reservation-checked-out">
                  <span class="text-text-muted flex items-center gap-1.5">
                    <svg class="h-3.5 w-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>Check-out realizado
                  </span>
                  <span class="font-bold text-right">{{ fmtDateTime(d.checkedOutAt) }}</span>
                </div>
                <div v-if="d.promoCode" class="flex justify-between gap-3"><span class="text-text-muted">Código promo</span><span class="font-bold text-right">{{ d.promoCode }}</span></div>
                <div v-if="d.otaNotes" class="pt-2 border-t border-border/50">
                  <div class="text-text-muted text-xs mb-1">Comentario del canal (OTA)</div>
                  <div class="text-xs bg-surface rounded-lg p-2 border border-border/70 whitespace-pre-wrap">{{ d.otaNotes }}</div>
                </div>
                <div v-if="d.notes" class="pt-2 border-t border-border/50">
                  <div class="text-text-muted text-xs mb-1">Notas</div>
                  <div class="text-xs bg-surface rounded-lg p-2 border border-border/70 whitespace-pre-wrap">{{ d.notes }}</div>
                </div>
                <div v-if="d.ownerNotes" class="pt-2 border-t border-border/50">
                  <div class="text-text-muted text-xs mb-1">Notas del propietario</div>
                  <div class="text-xs bg-white rounded-lg p-2 border border-border whitespace-pre-wrap">{{ d.ownerNotes }}</div>
                </div>
              </div>
            </details>

            <!-- Datos del Cliente (bandera + idioma) -->
            <div class="rm-card bg-white border border-border/70 border-l-[3px] border-l-navy/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a8.25 8.25 0 0115 0"/></svg></span>
                <h4 class="text-sm font-black text-navy">Datos del Cliente</h4>
              </div>
              <div v-if="d.guest" class="space-y-2 text-sm">
                <div class="flex justify-between gap-3 items-center"><span class="text-text-muted">Nombre</span><span class="font-bold text-navy text-lg">{{ nationalityToFlag(d.guest.nationality) }} {{ d.guest.name }}</span></div>
                <div v-if="d.guest.email" class="flex justify-between gap-3"><span class="text-text-muted">Email</span><a :href="`mailto:${d.guest.email}`" class="text-teal hover:underline truncate text-right">{{ d.guest.email }}</a></div>
                <div v-if="d.guest.phone" class="flex justify-between gap-3"><span class="text-text-muted">Teléfono</span><a :href="`tel:${d.guest.phone}`" class="text-teal hover:underline">{{ d.guest.phone }}</a></div>
                <div class="flex justify-between gap-3"><span class="text-text-muted">WhatsApp</span><a v-if="waLink(d.guest.phone)" :href="waLink(d.guest.phone)!" target="_blank" class="text-emerald-600 hover:underline">Escribir →</a><span v-else class="text-text-muted">—</span></div>
                <div v-if="d.guest.nationality" class="flex justify-between gap-3"><span class="text-text-muted">Nacionalidad</span><span class="text-right">{{ nationalityToFlag(d.guest.nationality) }} {{ d.guest.nationality }}</span></div>
                <div v-if="d.guest.language" class="flex justify-between gap-3"><span class="text-text-muted">Idioma</span><span class="font-bold text-right">{{ languageToFlag(d.guest.language) }} {{ d.guest.language }}</span></div>
                <div v-if="d.guest.document" class="flex justify-between gap-3"><span class="text-text-muted">Documento</span><span class="font-mono text-right text-xs">{{ d.guest.document }}</span></div>
              </div>
              <div v-else class="text-sm text-text-muted italic py-2">Sin huésped asociado</div>
            </div>

            <!-- Elementos de la Reserva -->
            <details open class="rm-card bg-white border border-border/70 border-l-[3px] border-l-navy/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l8-4v18M13 21V9l6 3v9M9 9h.01M9 13h.01M9 17h.01"/></svg></span> Elementos de la Reserva
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-3 text-sm">
                <div v-if="d.room">
                  <div class="font-bold text-navy">Habitación {{ d.room.number }} <span class="text-text-muted font-normal">{{ d.room.name || d.room.type }}</span></div>
                  <div class="text-xs text-text-muted">Asignada: ({{ fmtDate(d.checkIn) }})</div>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs bg-surface rounded-lg p-3 border border-border/70">
                  <div><span class="text-text-muted">Régimen:</span> <span class="font-bold">{{ regimeLabel(d.regime) }}</span></div>
                  <div><span class="text-text-muted">Huéspedes:</span> <span class="font-bold">{{ d.adults ?? 0 }} pax{{ d.children ? ` +${d.children}n` : '' }}</span>
                    <!-- Requerimiento 13 — desglose por niño (declarada/efectiva/balde) del backend
                         (`childrenAgesDetail`): reemplaza la nota genérica "alguna cuenta como
                         adulto" por CUÁL edad puntual, para que el panel nunca muestre 0 niños +
                         edades sin explicar por qué. -->
                    <div v-if="d.childrenAgesDetail?.length" class="mt-0.5 space-y-0.5">
                      <span v-for="(c, i) in d.childrenAgesDetail" :key="i" class="block text-[11px] font-normal" :class="c.classification === 'adult' ? 'text-amber-700' : c.classification === 'baby' ? 'text-cyan-700' : 'text-text-muted'">{{ c.declaredAge }} año(s) declarado(s)<template v-if="c.effectiveAge !== c.declaredAge"> (hoy {{ c.effectiveAge }}, reagendada)</template> — {{ childClassificationLabel(c.classification) }}</span>
                    </div>
                  </div>
                  <!-- Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — lo que el
                       huésped pidió al reservar online (solo aparece si pidió cuna; nada nuevo
                       para reservas cargadas a mano en el panel, que no tienen este composer). -->
                  <div v-if="d.needsCrib" class="col-span-2">
                    <span class="text-text-muted">Bebé:</span>
                    <span class="font-bold" data-testid="reservation-crib">Cuna</span>
                  </div>
                  <div><span class="text-text-muted">Noches:</span> <span class="font-bold">{{ nights }}</span></div>
                  <div><span class="text-text-muted">Precio/noche:</span> <span class="font-bold">{{ money(pricePerNight) }}</span></div>
                </div>
                <div class="flex justify-between items-center pt-2 border-t border-border/50">
                  <span class="text-text-muted text-xs">{{ nights }} noches × {{ money(pricePerNight) }}</span>
                  <span class="font-black text-teal text-lg flex items-center gap-1">{{ money(d.totalAmount) }}</span>
                </div>
              </div>
            </details>

            <!-- Requerimiento 13 (Administración | Composición de huéspedes, 2026-09-03) — reserva
                 de varias habitaciones: esta reserva es SOLO una de ellas (`d.groupId`). Se listan
                 las demás con su propia composición, para no tener que abrir cada una por separado. -->
            <details v-if="d.groupId && otherGroupRooms.length" open class="rm-card bg-white border border-border/70 border-l-[3px] border-l-navy/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l8-4v18M13 21V9l6 3v9M9 9h.01M9 13h.01M9 17h.01"/></svg></span>
                Otras habitaciones de esta reserva ({{ otherGroupRooms.length }})
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-2 text-xs">
                <div v-for="room in otherGroupRooms" :key="room.id" class="bg-surface rounded-lg p-3 border border-border/70">
                  <div class="font-bold text-navy">{{ room.roomNumber ? `Habitación ${room.roomNumber}` : 'Habitación' }} <span class="text-text-muted font-normal">{{ room.roomType || '' }}</span></div>
                  <div class="mt-0.5"><span class="text-text-muted">Huéspedes:</span> <span class="font-bold">{{ room.adults ?? 0 }} pax{{ room.children ? ` +${room.children}n` : '' }}</span>
                    <span v-if="room.childrenAges?.length" class="block text-[11px] font-normal text-text-muted">Edades declaradas: {{ room.childrenAges.join(', ') }} años<template v-if="room.childrenAges.length > (room.children ?? 0)"> (alguna cuenta como adulto por edad, ver política de niños)</template></span>
                  </div>
                </div>
              </div>
            </details>

            <!-- Importe y Pago -->
            <div class="rm-card bg-white border border-border/70 border-l-[3px] border-l-teal/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                <span class="w-7 h-7 rounded-lg bg-teal/10 flex items-center justify-center text-teal"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></span>
                <h4 class="text-sm font-black text-navy">Importe y Pago</h4>
                <!-- Requerimiento 14 — estado único, comprensible, sourced del backend (nunca de
                     `deposit` a secas: ver el comentario de `paymentStateBadge` en el script). -->
                <span data-testid="payment-state-badge" class="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" :class="paymentStateBadge(d.paymentState).cls">{{ paymentStateBadge(d.paymentState).label }}</span>
              </div>
              <!-- REQ-RWP-02 — aviso ámbar si el último intento en la pasarela no terminó en cobro. -->
              <p v-if="lastAttemptFailure" class="mb-2 text-[11px] leading-tight text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5" data-testid="failed-payment-warning">
                El último intento de cobro no se completó ({{ lastAttemptFailure.failureMessage || attemptKindBadge(lastAttemptFailure.kind).label }}). El huésped puede reintentar desde el correo de recuperación o usted puede generar un link de pago.
              </p>
              <div class="space-y-1.5 text-sm">
                <button v-if="can('billing','view')" @click="viewMovements" class="flex justify-between w-full hover:text-teal cursor-pointer"><span class="text-text-muted">Caja</span><span class="text-teal font-bold">Ver movimientos →</span></button>
                <div class="flex justify-between"><span class="text-text-muted">Forma de pago</span><span class="text-right">{{ payMethodLabel(d.paymentMethod) }}</span></div>
                <div class="flex justify-between bg-teal/5 rounded px-2 py-1"><span class="text-text-muted">Importe de la reserva</span><span class="font-bold text-navy">{{ money(d.totalAmount) }}</span></div>
                <div class="flex justify-between"><span class="text-text-muted">Anticipo</span><span class="font-bold text-navy">{{ d.deposit && d.deposit > 0 ? money(d.deposit) : 'Sin anticipo' }}</span></div>
                <!-- Otros cobros editable -->
                <div class="flex justify-between items-center gap-2">
                  <span class="text-text-muted">Otros cobros</span>
                  <span v-if="can('reservations','edit')" class="flex items-center gap-1">
                    <input v-model="otherChargesDraft" type="number" min="0" step="0.01" class="w-20 px-2 py-0.5 text-right rounded border border-border text-xs" @keyup.enter="saveOtherCharges" />
                    <button @click="saveOtherCharges" :disabled="saving" class="text-teal hover:underline cursor-pointer disabled:opacity-50">
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                    </button>
                  </span>
                  <span v-else class="font-bold text-navy">{{ money(otherCharges) }}</span>
                </div>
                <div class="flex justify-between border-t border-border/50 pt-1.5"><span class="font-bold text-text-secondary">Pendiente de cobro</span><span class="font-black" :class="pending > 0 ? 'text-coral' : 'text-teal'">{{ money(pending) }}</span></div>
                <!-- #272 (MR-07) — reserva cancelada desde la web: monto a devolver y estado REAL del
                     reembolso en la pasarela (no se infiere: lo persiste el backend). -->
                <div v-if="refundBadge" class="flex justify-between items-center gap-2" data-testid="refund-row">
                  <span class="text-text-muted">Reembolso</span>
                  <span class="flex items-center gap-2">
                    <span v-if="Number(d.refundAmount) > 0" class="font-bold text-navy">{{ money(Number(d.refundAmount)) }}</span>
                    <span data-testid="refund-state-badge" class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="refundBadge.cls">{{ refundBadge.label }}</span>
                  </span>
                </div>
                <div v-if="credit > 0" data-testid="reservation-credit" class="flex justify-between"><span class="font-bold text-teal">A favor del huésped</span><span class="font-black text-teal">{{ money(credit) }}</span></div>
                <div v-if="secondaryTotal !== null" class="flex justify-between"><span class="text-text-muted">Total ({{ secondaryCurrency }})</span><span class="font-bold text-purple">{{ moneySecondary(secondaryTotal) }}</span></div>
                <!-- GH-0.1: el monto del link vivo NO se veía en ninguna pantalla, así que un link
                     emitido por menos que el saldo pasaba desapercibido. -->
                <div v-if="openPaymentRequest" class="flex justify-between items-center gap-2">
                  <span class="text-text-muted">Link de pago vigente</span>
                  <span class="font-bold" :class="paymentLinkOutdated ? 'text-coral' : 'text-teal'">{{ money(openPaymentAmount) }}</span>
                </div>
                <p v-if="paymentLinkOutdated" class="text-[11px] leading-tight text-coral">
                  El link vigente es por {{ money(openPaymentAmount) }} y el saldo es {{ money(pending) }}: al generarlo de nuevo se actualiza a {{ money(pending) }}.
                </p>
                <!-- REQ-RWP-06 (#249): cobro manual YA recibido fuera de Stripe (efectivo /
                     transferencia / tarjeta en mostrador). Entra a `payments` con quién lo registró;
                     antes se "confirmaba" cambiando el status y la plata no quedaba en ningún lado. -->
                <button v-if="can('billing','create')" data-testid="mark-paid-button" @click="showMarkPaid = true" :disabled="saving || pending <= 0" class="w-full mt-2 flex items-center justify-center gap-1.5 py-2 bg-teal text-white rounded-lg text-xs font-black cursor-pointer hover:opacity-90 disabled:opacity-50">
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  Registrar pago
                </button>
                <button v-if="can('billing','create')" @click="requirePayment" :disabled="saving || pending <= 0" class="w-full mt-2 flex items-center justify-center gap-1.5 py-2 bg-cyan text-navy rounded-lg text-xs font-black cursor-pointer hover:opacity-90 disabled:opacity-50">
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 6.75h19.5A1.5 1.5 0 0123.25 8.25v9a1.5 1.5 0 01-1.5 1.5H2.25a1.5 1.5 0 01-1.5-1.5v-9a1.5 1.5 0 011.5-1.5zM6 15h3"/></svg>
                  Crear link de pago Stripe
                </button>
              </div>
              <!-- Historial de cobros (2026-08-30): antes solo se veía el total "Pagado" y no
                   había forma de saber por dónde entró la plata, con qué referencia ni quién la
                   cargó. El listado de /panel/billing es global del hotel y no filtra por reserva. -->
              <details class="mt-3 pt-3 border-t border-teal/20" data-testid="payment-history" open>
                <summary class="text-xs font-black text-navy cursor-pointer select-none flex items-center gap-1.5">
                  Historial de cobros
                  <span v-if="paymentHistory.length" class="text-[10px] font-bold text-text-muted">({{ paymentHistory.length }})</span>
                </summary>
                <div v-if="paymentHistory.length" class="mt-2 space-y-2">
                  <div v-for="p in paymentHistory" :key="p.id" class="rounded-lg border border-border/60 bg-surface px-2.5 py-2" data-testid="payment-history-row">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs font-black tabular-nums" :class="p.amount < 0 ? 'text-purple' : 'text-teal'">
                        {{ p.amount < 0 ? '−' : '+' }}{{ money(Math.abs(p.amount)) }}
                      </span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" :class="paymentStatusLabel(p.status).cls">{{ paymentStatusLabel(p.status).label }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-2 mt-0.5">
                      <span class="text-[11px] text-text-secondary font-bold">{{ payMethodLabel(p.method) }}</span>
                      <span class="text-[10px] text-text-muted">{{ fmtDateTime(p.createdAt) }}</span>
                    </div>
                    <div v-if="p.registeredBy" class="text-[10px] text-text-muted mt-0.5">Registró: {{ p.registeredBy }}</div>
                    <div v-if="p.reference" class="text-[10px] text-text-muted font-mono truncate mt-0.5" :title="p.reference">Ref: {{ p.reference }}</div>
                  </div>
                </div>
                <div v-else class="mt-2 text-xs text-text-muted italic">Todavía no se registró ningún cobro para esta reserva.</div>
              </details>

              <!-- REQ-RWP-02 — Pasarela de pago: cada intento (checkout, pago, rechazo, expiración,
                   devolución) con tarjeta, referencia del proveedor y links al dashboard/recibo. -->
              <details class="mt-3 pt-3 border-t border-teal/20" data-testid="payment-attempts" open>
                <summary class="text-xs font-black text-navy cursor-pointer select-none flex items-center gap-1.5">
                  Pasarela de pago
                  <span v-if="paymentAttempts.length" class="text-[10px] font-bold text-text-muted">({{ paymentAttempts.length }})</span>
                </summary>
                <div v-if="paymentAttempts.length" class="mt-2 space-y-2">
                  <div v-for="a in paymentAttempts" :key="a.id" class="rounded-lg border border-border/60 bg-surface px-2.5 py-2" data-testid="payment-attempt-row">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs font-black tabular-nums text-navy">{{ money(a.amount) }} <span class="text-[10px] font-bold text-text-muted">{{ a.currency }}</span></span>
                      <span class="flex items-center gap-1 shrink-0">
                        <span v-if="a.mode === 'test'" class="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-100 text-gray-500 uppercase">test</span>
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full" :class="attemptKindBadge(a.kind).cls">{{ attemptKindBadge(a.kind).label }}</span>
                      </span>
                    </div>
                    <div class="flex items-center justify-between gap-2 mt-0.5">
                      <span class="text-[11px] text-text-secondary font-bold">{{ providerLabel(a.provider) }}<template v-if="a.cardBrand || a.cardLast4"> · {{ a.cardBrand }} ····{{ a.cardLast4 }}</template></span>
                      <span class="text-[10px] text-text-muted">{{ fmtDateTime(a.occurredAt) }}</span>
                    </div>
                    <div v-if="a.kind === 'failed' && a.failureMessage" class="text-[11px] text-coral font-bold mt-0.5" data-testid="payment-attempt-failure">{{ a.failureMessage }}</div>
                    <div v-if="a.providerRef" class="flex items-center gap-1.5 mt-0.5 min-w-0">
                      <code class="font-mono text-[10px] text-text-muted truncate" :title="a.providerRef">{{ a.providerRef }}</code>
                      <button type="button" @click="copyProviderRef(a.providerRef)" class="text-[10px] font-bold text-teal hover:underline shrink-0" data-testid="payment-attempt-copy">Copiar</button>
                    </div>
                    <div v-if="a.dashboardUrl || a.receiptUrl" class="flex items-center gap-3 mt-1">
                      <a v-if="a.dashboardUrl" :href="a.dashboardUrl" target="_blank" rel="noopener noreferrer" class="text-teal font-bold text-[10px] hover:underline">Ver en Stripe</a>
                      <a v-if="a.receiptUrl" :href="a.receiptUrl" target="_blank" rel="noopener noreferrer" class="text-teal font-bold text-[10px] hover:underline">Recibo</a>
                    </div>
                  </div>
                </div>
                <div v-else class="mt-2 text-xs text-text-muted italic">Esta reserva no pasó por la pasarela.</div>
              </details>

              <!-- Movimientos del folio (inline) -->
              <div v-if="folioCharges" class="mt-3 pt-3 border-t border-teal/20">
                <div class="text-xs font-black text-navy mb-1">Movimientos de caja</div>
                <div v-if="folioCharges.length" class="space-y-1 text-xs">
                  <div v-for="(c, i) in folioCharges" :key="i" class="flex justify-between"><span class="truncate">{{ c.description || '—' }}</span><span class="font-bold" :class="c.kind === 'payment' ? 'text-teal' : 'text-navy'">{{ money(c.amount) }}</span></div>
                </div>
                <div v-else class="text-xs text-text-muted italic">Sin movimientos</div>
              </div>
            </div>

            <!-- Facturas (REQ-FDR-03, #254): las facturas ya emitidas de ESTA reserva (`d.invoices`),
                 con las mismas acciones que /panel/billing. Sin factura: el botón emite de verdad. -->
            <div ref="invoicesCard" data-testid="invoices-card" class="rm-card bg-white border border-border/70 border-l-[3px] border-l-navy/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h2M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg></span>
                <h4 class="text-sm font-black text-navy">Facturas</h4>
                <span v-if="d.invoices?.length" class="ml-auto text-[10px] font-bold text-text-muted">({{ d.invoices.length }})</span>
              </div>
              <div v-if="d.invoices?.length" class="space-y-2">
                <div v-for="inv in d.invoices" :key="inv.id" class="rounded-lg border border-border/60 bg-surface px-2.5 py-2" data-testid="invoice-row">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-black text-navy truncate" :title="inv.ncf ? `NCF ${inv.ncf}` : undefined">{{ inv.number }}</span>
                    <span class="flex items-center gap-1 shrink-0">
                      <span v-if="inv.type === 'credit_note'" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple/10 text-purple">Nota de crédito</span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full" :class="invoiceStatusBadge(inv.status).cls">{{ invoiceStatusBadge(inv.status).label }}</span>
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 mt-0.5">
                    <span class="text-[10px] text-text-muted">{{ fmtDate(inv.issuedAt) }}</span>
                    <span class="text-xs font-black tabular-nums" :class="inv.type === 'credit_note' ? 'text-purple' : 'text-navy'">{{ invoiceAmount(inv) }}</span>
                  </div>
                  <!-- NC: el backend la crea con amountPaid=0 → balance=amount, pero no es deuda por cobrar; no se muestra saldo. -->
                  <div v-if="inv.type !== 'credit_note'" class="flex items-center justify-between gap-2 mt-0.5">
                    <span class="text-[10px] text-text-muted">Saldo</span>
                    <span class="text-[11px] font-bold tabular-nums" :class="inv.balance > 0 ? 'text-coral' : 'text-teal'">{{ money(inv.balance, inv.currency) }}</span>
                  </div>
                  <div v-if="can('billing','view')" class="flex items-center gap-3 mt-1.5">
                    <button type="button" data-testid="invoice-print" @click="printInvoice(inv)" class="text-[10px] font-bold text-teal hover:underline cursor-pointer">Imprimir</button>
                    <button type="button" data-testid="invoice-pdf" @click="downloadPdf(inv)" class="text-[10px] font-bold text-teal hover:underline cursor-pointer">PDF</button>
                    <button type="button" data-testid="invoice-email" @click="openEmailModal(inv)" class="text-[10px] font-bold text-teal hover:underline cursor-pointer">Email</button>
                  </div>
                </div>
              </div>
              <div v-else>
                <p class="text-xs text-text-muted italic">Esta reserva todavía no tiene factura.</p>
                <button v-if="can('billing','create')" data-testid="invoice-issue-empty" @click="facturar" :disabled="issuing" class="w-full mt-2 flex items-center justify-center gap-1.5 py-2 bg-navy text-white rounded-lg text-xs font-black cursor-pointer hover:opacity-90 disabled:opacity-50">
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h2M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>
                  {{ issuing ? 'Facturando…' : 'Facturar' }}
                </button>
              </div>
            </div>

            <!-- Tarjeta de garantía (MisterPlan): protegida con PIN — si no hay tarjeta, no ocupa una
                 tarjeta propia (nota breve, deja el espacio libre para lo siguiente). -->
            <div v-if="d.hasGuaranteeCard" class="rm-card bg-white border border-border/70 border-l-[3px] border-l-coral/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                <span class="w-7 h-7 rounded-lg bg-coral/10 flex items-center justify-center text-coral"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg></span>
                <h4 class="text-sm font-black text-navy">Tarjeta de garantía</h4>
              </div>
              <!-- Bloqueada: pedir PIN -->
              <div v-if="!guaranteeUnlocked && !can('reservations','edit')" class="text-xs text-text-muted italic">
                Tarjeta cargada y protegida. Tu rol no puede revelarla.
              </div>
              <div v-else-if="!guaranteeUnlocked">
                <p class="text-xs text-text-secondary mb-2">Tarjeta cargada y protegida. Ingresá el PIN del hotel para ver los datos.</p>
                <div class="flex gap-2">
                  <!-- autocomplete="new-password": es el PIN del hotel, no la credencial del
                       usuario — el gestor no tiene nada válido que ofrecer acá, y sin esto Chrome
                       lo rellenaba solo. Mismo criterio que donde se define, en settings (GH-32). -->
                  <input v-model="guaranteePin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN" @keyup.enter="unlockGuarantee"
                    autocomplete="new-password" name="guarantee-pin"
                    class="flex-1 px-3 py-2 rounded-lg border border-border text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-coral/20 focus:border-coral transition" />
                  <button @click="unlockGuarantee" :disabled="unlocking || !guaranteePin" class="px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold disabled:opacity-50 hover:bg-navy/90 transition">{{ unlocking ? '...' : 'Ver' }}</button>
                </div>
                <p v-if="guaranteeError" class="text-xs text-coral mt-2 font-semibold">{{ guaranteeError }}</p>
              </div>
              <!-- Desbloqueada: mostrar datos parciales -->
              <div v-else class="space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-text-muted">Titular</span><span class="font-semibold text-right">{{ guaranteeCard?.cardHolder || '—' }}</span></div>
                <div class="flex justify-between"><span class="text-text-muted">Tarjeta</span><span class="font-mono font-semibold">•••• {{ guaranteeCard?.cardLast4 }}</span></div>
                <div class="flex justify-between"><span class="text-text-muted">Marca</span><span class="font-semibold">{{ cardBrandLabel(guaranteeCard?.cardBrand) }}</span></div>
                <div class="flex justify-between"><span class="text-text-muted">Vencimiento</span><span class="font-mono font-semibold">{{ guaranteeCard?.cardExpMonth }}/{{ guaranteeCard?.cardExpYear }}</span></div>
                <button @click="guaranteeUnlocked = false; guaranteePin = ''" class="mt-2 text-[11px] text-text-muted underline">Volver a bloquear</button>
              </div>
            </div>

            <!-- #269 Extras pagados online (motor de reservas): sólo lectura, ya incluidos en el total -->
            <div v-if="showPaidExtras" data-testid="paid-extras" class="rm-card bg-white border border-border/70 border-l-[3px] border-l-teal/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                <span class="w-7 h-7 rounded-lg bg-teal/10 flex items-center justify-center text-teal"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></span>
                <h4 class="text-sm font-black text-navy">Extras pagados</h4>
                <span class="ml-auto text-[10px] text-text-muted">Incluidos en el total de la reserva</span>
              </div>
              <div class="space-y-1.5 text-sm" :class="priceBreakdownRows.length ? 'mb-3' : ''">
                <div v-for="a in paidExtras" :key="a.id" class="flex justify-between items-center gap-2" data-testid="paid-extra-line">
                  <span class="flex items-center gap-1.5 min-w-0">
                    <span class="truncate">{{ a.description || paidExtraKindLabel(a.kind) }}<span v-if="(a.quantity ?? 1) > 1" class="text-text-muted"> ×{{ a.quantity }}</span></span>
                    <span class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple/10 text-purple">{{ paidExtraKindLabel(a.kind) }}</span>
                    <span class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal/10 text-teal">Pagado online</span>
                  </span>
                  <span class="font-bold text-navy shrink-0">{{ money(paidExtraLineAmount(a)) }}</span>
                </div>
                <div v-if="!paidExtras.length" class="text-xs text-text-muted italic">El desglose trae extras pero la reserva aún no tiene las líneas materializadas (pendiente de backfill)</div>
              </div>
              <div v-if="priceBreakdownRows.length" class="pt-2 border-t border-border/50 space-y-1 text-xs" data-testid="price-breakdown">
                <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Desglose del motor</div>
                <div v-for="(r, i) in priceBreakdownRows" :key="i" class="flex justify-between gap-2" :class="r.strong ? 'pt-1 border-t border-border/50 text-sm font-black text-navy' : ''">
                  <span :class="r.strong ? '' : 'text-text-secondary'">{{ r.label }}</span>
                  <span class="font-bold tabular-nums" :class="r.negative ? 'text-coral' : 'text-navy'">{{ money(r.amount) }}</span>
                </div>
              </div>
            </div>

            <!-- Otros servicios y descuentos -->
            <div class="rm-card bg-white border border-border/70 border-l-[3px] border-l-purple/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                <span class="w-7 h-7 rounded-lg bg-purple/10 flex items-center justify-center text-purple"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg></span>
                <h4 class="text-sm font-black text-navy">Otros servicios y descuentos</h4>
              </div>
              <div class="space-y-1.5 text-sm mb-3">
                <div v-for="a in manualAddons" :key="a.id" class="flex justify-between items-center gap-2">
                  <span class="truncate">
                    <span v-if="a.kind === 'discount'" class="text-coral font-bold">−</span>
                    <span v-else class="text-teal font-bold">+</span>
                    {{ a.description }}
                  </span>
                  <span class="flex items-center gap-2 shrink-0">
                    <span class="font-bold" :class="a.kind === 'discount' ? 'text-coral' : 'text-navy'">{{ money((a.kind === 'discount' ? -1 : 1) * (a.amount ?? 0) * (a.quantity ?? 1)) }}</span>
                    <button v-if="can('reservations','delete')" @click="removeAddon(a.id)" class="text-coral hover:underline cursor-pointer">
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </span>
                </div>
                <div v-if="!manualAddons.length" class="text-xs text-text-muted italic">Sin servicios adicionales</div>
              </div>
              <div v-if="can('reservations','edit')" class="flex gap-2">
                <input v-model="newAddon.description" type="text" placeholder="Descripción" class="flex-1 px-2 py-1.5 rounded-lg border border-border text-xs" @keyup.enter="addAddon" />
                <input v-model.number="newAddon.amount" type="number" min="0" step="0.01" placeholder="Monto" class="w-20 px-2 py-1.5 rounded-lg border border-border text-xs" />
                <select v-model="newAddon.kind" class="px-2 py-1.5 rounded-lg border border-border text-xs cursor-pointer">
                  <option value="service">Servicio</option>
                  <option value="discount">Descuento</option>
                </select>
                <button @click="addAddon" class="px-3 bg-purple text-white rounded-lg text-xs font-bold cursor-pointer hover:opacity-90">+</button>
              </div>
            </div>

            <!-- Acompañantes -->
            <div class="rm-card bg-white border border-border/70 border-l-[3px] border-l-navy/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.943-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg></span>
                <h4 class="text-sm font-black text-navy">Acompañantes <span class="text-text-muted font-normal">({{ d.companions?.length || 0 }})</span></h4>
              </div>
              <div v-if="d.companions && d.companions.length" class="space-y-1.5 text-sm">
                <div v-for="c in d.companions" :key="c.id" class="flex justify-between gap-3 items-center">
                  <span class="font-bold flex items-center gap-1">{{ c.name }} <span v-if="c.isMainGuest" class="text-coral" title="Huésped principal">*</span></span>
                  <span class="text-text-muted text-xs text-right">{{ [c.documentNumber, c.nationality].filter(Boolean).join(' · ') || '—' }}</span>
                </div>
              </div>
              <div v-else class="text-xs text-text-muted italic">Sin acompañantes</div>
            </div>

            <!-- Check-in digital (mapeo de QScanPro de MisterPlan) -->
            <div v-if="d.checkinCode" class="rm-card bg-white border border-border/70 border-l-[3px] border-l-cyan/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-2">
                <span class="w-7 h-7 rounded-lg bg-cyan/10 flex items-center justify-center text-cyan"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/></svg></span>
                <h4 class="text-sm font-black text-navy">Check-in digital</h4>
              </div>
              <div class="text-center py-2 bg-cyan/5 rounded-lg border-2 border-dashed border-cyan">
                <div class="text-[10px] font-bold text-text-muted uppercase">Código de conexión</div>
                <div class="text-2xl font-black text-cyan tracking-wider mt-1 font-mono">{{ d.checkinCode }}</div>
              </div>
              <p class="text-xs text-text-muted mt-2">Usa este código para el check-in digital del huésped. <a v-if="checkinUrl" :href="checkinUrl" target="_blank" class="text-cyan font-bold hover:underline">Abrir formulario →</a></p>
            </div>

            <!-- Cerradura (si hay código) -->
            <details v-if="d.lockCodes && d.lockCodes.length" open class="rm-card bg-white border border-border/70 border-l-[3px] border-l-teal/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-teal/10 flex items-center justify-center text-teal"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg></span> Cerradura
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-2">
                <div v-if="roomLockDevice" class="flex items-center gap-2 text-xs text-text-muted mb-2">
                  <span class="h-2 w-2 rounded-full" :class="roomLockDevice.status === 'online' ? 'bg-teal' : 'bg-gray-300'"></span>
                  {{ roomLockDevice.status === 'online' ? 'En línea' : (roomLockDevice.status || 'Desconocido') }}
                  <span v-if="roomLockDevice.batteryLevel != null"> · 🔋 {{ roomLockDevice.batteryLevel }}%</span>
                </div>
                <!-- Operar la puerta desde la reserva, que es donde se está mirando al huésped.
                     Antes esto vivía sólo detrás del engranaje (RoomLockModal): había que abrir un
                     segundo modal para algo que se necesita en el momento, y sin etiqueta que lo
                     dijera. Las dos mitades juntas — abrir sin poder cerrar deja la puerta abierta. -->
                <div v-if="roomLockDevice && can('ttlock','edit')" class="grid grid-cols-2 gap-2" data-testid="lock-door-actions">
                  <button @click="doorUnlock" :disabled="doorBusy || roomLockDevice.status !== 'online'"
                    class="py-2 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {{ doorAction === 'unlock' ? 'Abriendo…' : 'Abrir puerta' }}
                  </button>
                  <button @click="doorLock" :disabled="doorBusy || roomLockDevice.status !== 'online'"
                    class="py-2 rounded-lg border-2 border-navy text-navy text-xs font-bold hover:bg-navy hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {{ doorAction === 'lock' ? 'Cerrando…' : 'Cerrar puerta' }}
                  </button>
                </div>
                <p v-if="roomLockDevice && roomLockDevice.status !== 'online'" class="text-[10px] text-text-muted">
                  La cerradura debe estar en línea para operarla en remoto.
                </p>
                <!-- Horario de acceso: lo que define desde/hasta cuándo abre el PIN. Antes no
                     existía en ningún lado y el código se generaba a medianoche UTC (2026-08-29). -->
                <div class="bg-surface rounded-lg p-3 border border-border/70" data-testid="lock-schedule">
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="text-[10px] uppercase font-bold text-text-muted">Horario de acceso</div>
                      <div class="text-sm font-black text-navy" data-testid="lock-schedule-value">
                        {{ scheduleCheckIn }} → {{ scheduleCheckOut }}
                        <span v-if="scheduleIsCustom" class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gold/15 text-gold align-middle">Acordado con el huésped</span>
                        <span v-else class="ml-1 text-[10px] text-text-muted font-normal">horario del hotel</span>
                      </div>
                    </div>
                    <button v-if="can('reservations','edit') && !scheduleOpen" @click="openScheduleEditor" data-testid="lock-schedule-edit"
                      title="Acordar otro horario con este huésped (entrada anticipada o salida tardía)"
                      class="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg border border-border text-text-secondary hover:text-navy hover:border-navy/40 cursor-pointer transition-colors">Cambiar</button>
                  </div>
                  <div v-if="scheduleOpen" class="mt-3 space-y-2" data-testid="lock-schedule-form">
                    <div class="flex gap-2">
                      <label class="flex-1 text-[10px] uppercase font-bold text-text-muted">Entrada
                        <input v-model="scheduleDraft.checkInTime" type="time" data-testid="lock-schedule-in"
                          class="mt-1 w-full px-2 py-1.5 rounded-lg border border-border text-sm font-bold text-navy focus:border-navy focus:outline-none" />
                      </label>
                      <label class="flex-1 text-[10px] uppercase font-bold text-text-muted">Salida
                        <input v-model="scheduleDraft.checkOutTime" type="time" data-testid="lock-schedule-out"
                          class="mt-1 w-full px-2 py-1.5 rounded-lg border border-border text-sm font-bold text-navy focus:border-navy focus:outline-none" />
                      </label>
                    </div>
                    <p class="text-[10px] text-text-muted">Vacío = usa el horario general del hotel ({{ hotelCheckIn }} → {{ hotelCheckOut }}).</p>
                    <div class="flex gap-2">
                      <button @click="saveSchedule" :disabled="savingSchedule" data-testid="lock-schedule-save"
                        class="flex-1 px-3 py-2 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors">{{ savingSchedule ? 'Guardando…' : 'Guardar horario' }}</button>
                      <button @click="scheduleOpen = false" class="px-3 py-2 text-xs font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
                    </div>
                  </div>
                  <!-- Honestidad sobre el hardware: el PIN ya cargado en la cerradura conserva la
                       ventana con la que se creó. Cambiar el horario NO lo reescribe: hay que
                       regenerarlo. Decirlo evita que alguien crea que el cambio ya viajó. -->
                  <p v-if="currentLockCode && scheduleIsCustom" class="text-[10px] text-gold mt-2" data-testid="lock-schedule-warning">
                    El código vigente conserva el horario con el que se generó. Regeneralo para aplicar este.
                  </p>
                </div>
                <!-- SOLO el código VIGENTE (una reserva = un código). Los anteriores van al
                     historial colapsado de abajo, sin botones — nunca más "dos códigos" listados. -->
                <div v-if="currentLockCode" data-testid="lock-code-box" class="bg-surface rounded-lg p-3 border border-border/70">
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="text-[10px] uppercase font-bold text-text-muted">Código de acceso</div>
                      <div class="text-xl font-black text-teal tracking-wider" data-testid="lock-code">{{ currentLockCode.code || '—' }}</div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <span data-testid="lock-code-status" class="text-[10px] font-bold px-2 py-1 rounded-full" :class="currentLockCode.status === 'active' ? 'bg-teal/10 text-teal' : 'bg-gold/10 text-gold'">{{ currentLockCode.status === 'pending' ? 'pendiente (offline)' : 'activo' }}</span>
                      <button v-if="currentLockCode.code" @click="copyLockCode(currentLockCode.code)" :title="copiedLockCode === currentLockCode.code ? 'Copiado' : 'Copiar código'" data-testid="lock-code-copy"
                        class="text-[10px] font-bold px-2 py-1 rounded-lg border border-border text-text-secondary hover:text-navy hover:border-navy/40 cursor-pointer transition-colors">{{ copiedLockCode === currentLockCode.code ? '✓' : 'Copiar' }}</button>
                      <a v-if="lockCodeWaLink(currentLockCode.code, currentLockCode.startDate, currentLockCode.endDate)" :href="lockCodeWaLink(currentLockCode.code, currentLockCode.startDate, currentLockCode.endDate)!" target="_blank" rel="noopener" title="Enviar el código por WhatsApp al huésped" data-testid="lock-code-whatsapp"
                        class="text-[10px] font-bold px-2 py-1 rounded-lg bg-teal text-white hover:bg-teal-light cursor-pointer transition-colors">WhatsApp</a>
                    </div>
                  </div>
                  <div v-if="currentLockCode.startDate || currentLockCode.endDate" class="text-[10px] text-text-muted mt-1">{{ currentLockCode.startDate || '?' }} → {{ currentLockCode.endDate || '?' }}</div>
                  <p v-if="currentLockCode.status === 'pending'" class="text-[10px] text-gold mt-1">La cerradura estaba offline: el PIN queda registrado y se aplicará al volver la conexión.</p>
                </div>
                <p v-else class="text-xs text-text-muted">Sin código vigente — el anterior fue desactivado. Generá uno nuevo cuando lo necesites.</p>
                <button v-if="currentLockCode && can('reservations','edit')" @click="sendLockCodeEmail" :disabled="sendingLockCode" class="flex w-full items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-teal text-white text-sm font-bold hover:bg-teal/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors">
                  <svg v-if="!sendingLockCode" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>
                  <svg v-else class="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  {{ sendingLockCode ? 'Enviando…' : 'Enviar código por email' }}
                </button>
                <div v-if="can('ttlock','edit')" class="flex gap-2">
                  <button v-if="currentLockCode" @click="generateLockCode()" :disabled="generatingLockCode" data-testid="lock-regenerate-btn"
                    title="Genera un PIN nuevo y revoca el anterior — la reserva siempre queda con UN solo código vigente."
                    class="flex-1 px-3 py-2 rounded-lg border border-border text-text-secondary text-xs font-bold hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors">
                    {{ generatingLockCode ? 'Generando…' : 'Regenerar automático' }}
                  </button>
                  <button v-else @click="generateLockCode()" :disabled="generatingLockCode" data-testid="lock-generate-btn"
                    class="flex-1 px-3 py-2 rounded-lg bg-teal text-white text-xs font-bold hover:bg-teal-light disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors">
                    {{ generatingLockCode ? 'Generando…' : 'Generar código' }}
                  </button>
                  <button v-if="!manualLockOpen" @click="manualLockOpen = true" data-testid="lock-manual-toggle"
                    class="px-3 py-2 rounded-lg border border-border text-text-secondary text-xs font-bold hover:bg-surface cursor-pointer transition-colors whitespace-nowrap">{{ currentLockCode ? 'Cambiar código' : 'Crear manual' }}</button>
                  <button v-if="currentLockCode" @click="revokeLockCode" :disabled="revokingLockCode" data-testid="lock-revoke-btn"
                    title="Borra el PIN de la cerradura física — el huésped deja de poder abrir."
                    class="px-3 py-2 rounded-lg border border-coral/30 text-coral text-xs font-bold hover:bg-coral/5 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap">{{ revokingLockCode ? 'Desactivando…' : 'Desactivar' }}</button>
                </div>
                <div v-if="manualLockOpen" data-testid="lock-manual-form" class="bg-surface rounded-lg p-3 border border-border/70">
                  <div class="text-[10px] uppercase font-bold text-text-muted mb-1.5">{{ currentLockCode ? 'Nuevo código — reemplaza el actual (4-9 dígitos)' : 'Código manual (4-9 dígitos)' }}</div>
                  <div class="flex gap-2">
                    <input v-model="manualLockCode" type="text" inputmode="numeric" maxlength="9" placeholder="Ej: 2580" aria-label="Código manual de 4 a 9 dígitos" data-testid="lock-manual-input"
                      class="flex-1 px-3 py-2 rounded-lg border border-border text-sm font-mono font-bold tracking-widest focus:border-navy focus:outline-none" @keydown.enter="generateLockCode(manualLockCode.trim())" />
                    <button @click="generateLockCode(manualLockCode.trim())" :disabled="generatingLockCode" data-testid="lock-manual-create"
                      class="px-4 py-2 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap">{{ generatingLockCode ? 'Guardando…' : (currentLockCode ? 'Reemplazar' : 'Crear') }}</button>
                    <button @click="manualLockOpen = false; manualLockCode = ''" class="px-2 py-2 text-xs font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
                  </div>
                </div>

                <!-- Historial: códigos anteriores (revocados/vencidos). Sin botones — no se envían. -->
                <details v-if="oldLockCodes.length" class="pt-1">
                  <summary class="text-[11px] font-bold text-text-muted cursor-pointer select-none">{{ oldLockCodes.length }} código(s) anterior(es)</summary>
                  <div v-for="(lc, i) in oldLockCodes" :key="i" class="flex items-center gap-2 py-1 opacity-60">
                    <code class="text-sm font-mono text-text-secondary">{{ lc.code }}</code>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{{ lc.status }}</span>
                    <span class="text-[10px] text-text-muted ml-auto">{{ lc.startDate || '?' }} → {{ lc.endDate || '?' }}</span>
                  </div>
                </details>
                <button v-if="roomLockDevice && can('ttlock','edit')" @click="checkLockStatus" :disabled="checkingLockStatus" class="flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-text-secondary text-xs font-bold hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors">
                  {{ checkingLockStatus ? 'Consultando…' : `Actualizar estado (${roomLockDevice.status === 'online' ? '🟢' : '⚪'} ${roomLockDevice.batteryLevel ?? '—'}%)` }}
                </button>
              </div>
            </details>

            <!-- Cerradura asignada al cuarto pero SIN código todavía: antes esta vista no ofrecía
                 ninguna acción acá (solo aparecía la tarjeta de arriba si ya había un código). -->
            <div v-else-if="roomLockDevice" class="rm-card bg-white border border-border/70 border-l-[3px] border-l-teal/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-2">
                <span class="w-7 h-7 rounded-lg bg-teal/10 flex items-center justify-center text-teal"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0 1 10 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg></span>
                <h4 class="text-sm font-black text-navy">Cerradura</h4>
                <span class="ml-auto text-[10px] font-bold px-2 py-1 rounded-full" :class="roomLockDevice.status === 'online' ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-500'">{{ roomLockDevice.status === 'online' ? 'En línea' : (roomLockDevice.status || 'Desconocido') }}</span>
              </div>
              <p class="text-xs text-text-muted mb-3">{{ roomLockDevice.name || 'Cerradura' }} asignada a esta habitación — todavía no se generó un código de acceso para esta reserva.</p>
              <div v-if="can('ttlock','edit')" class="flex gap-2">
                <button @click="generateLockCode()" :disabled="generatingLockCode" class="flex flex-1 items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-teal text-white text-sm font-bold hover:bg-teal/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors">
                  {{ generatingLockCode ? 'Generando…' : 'Generar código de cerradura' }}
                </button>
                <button v-if="!manualLockOpen" @click="manualLockOpen = true" data-testid="lock-manual-toggle"
                  class="px-3 py-2.5 rounded-lg border border-border text-text-secondary text-xs font-bold hover:bg-surface cursor-pointer transition-colors whitespace-nowrap">Crear manual</button>
                <button @click="checkLockStatus" :disabled="checkingLockStatus" class="px-3 py-2.5 rounded-lg border border-border text-text-secondary text-xs font-bold hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap">
                  {{ checkingLockStatus ? '…' : `${roomLockDevice.batteryLevel ?? '—'}% 🔋` }}
                </button>
                <button @click="openRoomLockManager" title="Gestionar cerradura: asignar, batería, gateway, códigos fijos" data-testid="lock-open-manager"
                  class="px-3 py-2.5 rounded-lg border border-border text-text-secondary text-xs font-bold hover:bg-surface cursor-pointer transition-colors whitespace-nowrap">⚙️</button>
              </div>
              <!-- Misma pareja de acciones que en la tarjeta con código: la puerta se opera aunque
                   la reserva todavía no tenga PIN generado. -->
              <div v-if="can('ttlock','edit')" class="grid grid-cols-2 gap-2 mt-2">
                <button @click="doorUnlock" :disabled="doorBusy || roomLockDevice.status !== 'online'"
                  class="py-2 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  {{ doorAction === 'unlock' ? 'Abriendo…' : 'Abrir puerta' }}
                </button>
                <button @click="doorLock" :disabled="doorBusy || roomLockDevice.status !== 'online'"
                  class="py-2 rounded-lg border-2 border-navy text-navy text-xs font-bold hover:bg-navy hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  {{ doorAction === 'lock' ? 'Cerrando…' : 'Cerrar puerta' }}
                </button>
              </div>
              <div v-if="manualLockOpen && can('ttlock','edit')" data-testid="lock-manual-form" class="mt-2 bg-surface rounded-lg p-3 border border-border/70">
                <div class="text-[10px] uppercase font-bold text-text-muted mb-1.5">Código manual (4-9 dígitos)</div>
                <div class="flex gap-2">
                  <input v-model="manualLockCode" type="text" inputmode="numeric" maxlength="9" placeholder="Ej: 2580" aria-label="Código manual de 4 a 9 dígitos" data-testid="lock-manual-input"
                    class="flex-1 px-3 py-2 rounded-lg border border-border text-sm font-mono font-bold tracking-widest focus:border-navy focus:outline-none" @keydown.enter="generateLockCode(manualLockCode.trim())" />
                  <button @click="generateLockCode(manualLockCode.trim())" :disabled="generatingLockCode" data-testid="lock-manual-create"
                    class="px-4 py-2 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap">{{ generatingLockCode ? 'Creando…' : 'Crear' }}</button>
                  <button @click="manualLockOpen = false; manualLockCode = ''" class="px-2 py-2 text-xs font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
                </div>
              </div>
            </div>
            <!-- Sin cerradura asignada a la habitación: la sección existe IGUAL (antes desaparecía
                 sin explicar nada y no se entendía por qué no había cerradura) y ofrece abrir el
                 gestor, que permite ASIGNAR una cerradura a esta habitación desde acá mismo. -->
            <div v-if="!roomLockDevice && !(d.lockCodes && d.lockCodes.length) && can('ttlock','view')" data-testid="lock-unassigned-card"
              class="rm-card bg-white border border-border/70 border-l-[3px] border-l-teal/60 rounded-2xl p-4 shadow-card">
              <div class="flex items-center gap-2 mb-1">
                <span class="w-7 h-7 rounded-lg bg-teal/10 flex items-center justify-center text-teal text-sm">🔒</span>
                <h4 class="text-sm font-black text-navy">Cerradura</h4>
              </div>
              <p class="text-xs text-text-muted mb-3">Esta habitación no tiene cerradura TTLock asignada. Asignale una para generar códigos de acceso al huésped.</p>
              <button v-if="can('ttlock','edit')" @click="openRoomLockManager" data-testid="lock-open-manager"
                class="px-4 py-2 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy-light cursor-pointer transition-colors">Asignar cerradura…</button>
            </div>
            <p v-if="!d.checkinCode && !roomLockDevice && !(d.lockCodes && d.lockCodes.length)" class="rm-card text-xs text-text-muted italic px-1">Sin check-in digital</p>

            <!-- Comunicaciones -->
            <details open class="rm-card bg-white border border-border/70 border-l-[3px] border-l-teal/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-teal/10 flex items-center justify-center text-teal"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg></span> Comunicaciones
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-2 text-sm">
                <button @click="printAs('quote')" class="flex w-full items-center gap-2 text-left px-3 py-2 bg-surface rounded-lg border border-border/70 hover:border-teal hover:text-teal cursor-pointer" title="Imprimir cotización / proforma de esta reserva">
                  <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h1M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>
                  Cotización / Proforma
                </button>
                <button @click="printAs('voucherLodging')" class="flex w-full items-center gap-2 text-left px-3 py-2 bg-surface rounded-lg border border-border/70 hover:border-teal hover:text-teal cursor-pointer">
                  <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h1M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>
                  Bono del alojamiento
                </button>
                <button @click="printAs('voucherClient')" class="flex w-full items-center gap-2 text-left px-3 py-2 bg-surface rounded-lg border border-border/70 hover:border-teal hover:text-teal cursor-pointer">
                  <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h1M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>
                  Bono para el Cliente
                </button>
                <a v-if="checkinUrl" :href="checkinUrl" target="_blank" class="flex w-full items-center gap-2 text-left px-3 py-2 bg-surface rounded-lg border border-border/70 hover:border-teal hover:text-teal">
                  <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>
                  Autocheckin (check-in digital)
                </a>
              </div>
            </details>

            <!-- Comunicación con el Cliente -->
            <details class="rm-card bg-white border border-border/70 border-l-[3px] border-l-purple/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-purple/10 flex items-center justify-center text-purple"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.216.456a1.125 1.125 0 01-1.37-.49l-1.296-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg></span> Comunicación con el Cliente
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1">
                <label class="flex items-center justify-between gap-3 text-sm py-2 cursor-pointer">
                  <span class="text-text-secondary">Los envíos de esta reserva se enviarán automáticamente</span>
                  <button type="button" @click="toggleAutoSend" :disabled="saving || !can('reservations','edit')" class="relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :class="autoSend ? 'bg-teal' : 'bg-gray-300'">
                    <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow" :class="autoSend ? 'translate-x-5' : ''"></span>
                  </button>
                </label>
                <div v-if="d.messageLogs && d.messageLogs.length" class="mt-2 pt-2 border-t border-border/50">
                  <div class="text-text-muted text-xs mb-1">Envíos registrados</div>
                  <div v-for="(log, i) in d.messageLogs.slice(0, MESSAGE_LOG_PREVIEW)" :key="log.id || i" class="text-xs flex justify-between gap-2 py-0.5">
                    <span class="truncate">{{ log.messageType || 'Mensaje' }}<span v-if="log.reference" class="text-text-muted"> · {{ log.reference }}</span></span>
                    <span class="font-bold shrink-0" :class="log.status === 'sent' ? 'text-teal' : 'text-gold'">{{ log.status }}</span>
                  </div>
                </div>
              </div>
            </details>

            <!-- Envío REAL por Meta. Va antes que el enlace wa.me porque es el camino bueno: sale
                 del servidor, vuelve con acuse y el estado de entrega lo dicta Meta. -->
            <details v-if="waConectado && metaTemplates.length && can('reservations','edit')" open
              class="rm-card overflow-hidden rounded-2xl border border-border/70 border-l-[3px] border-l-teal bg-white shadow-card">
              <summary class="flex cursor-pointer list-none select-none items-center gap-2 p-4 text-sm font-black text-teal">
                <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-teal/10 text-teal">
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m22 2-7 20-4-9-9-4Z"/></svg>
                </span> Enviar por WhatsApp
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="space-y-2 px-4 pb-4 pt-1 text-sm">
                <!-- El número destino, completo y a la vista: mandarle la reserva de un huésped a
                     otro número no se deshace. -->
                <p class="text-[11px] text-text-muted">
                  Se envía a <strong class="text-navy tabular-nums">{{ d?.guest?.phone || 'sin teléfono cargado' }}</strong>
                </p>
                <button v-for="t in metaTemplates" :key="t.id" @click="enviarPorMeta(t)"
                  :disabled="!!enviandoMeta || !d?.guest?.phone"
                  class="flex w-full cursor-pointer items-center justify-between rounded-lg border border-teal/25 bg-surface px-3 py-2 transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-50">
                  <span>{{ t.name }}</span>
                  <span class="text-xs font-bold text-teal">{{ enviandoMeta === t.id ? 'Enviando…' : 'Enviar →' }}</span>
                </button>
                <p class="text-[10px] leading-relaxed text-text-muted">
                  Solo aparecen las plantillas que Meta aprobó. El envío queda registrado en el
                  historial con su estado de entrega real.
                </p>
              </div>
            </details>

            <!-- Plantillas WhatsApp -->
            <details v-if="waTemplates.length && can('reservations','edit')" class="rm-card bg-white border border-border/70 border-l-[3px] border-l-emerald-400 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-emerald-700 select-none">
                <span class="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg></span> Plantillas de WhatsApp Web
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-2 text-sm">
                <button v-for="t in waTemplates" :key="t.id" @click="waSend(t.whatsappBody, t.title)" class="w-full flex items-center justify-between px-3 py-2 bg-surface rounded-lg border border-emerald-200 hover:border-emerald-400 cursor-pointer">
                  <span>{{ t.title }}</span><span class="text-emerald-600 text-xs">Enviar →</span>
                </button>
              </div>
            </details>

            <!-- Historial de cambios (D7 audit trail) -->
            <details open class="rm-card bg-white border border-border/70 border-l-[3px] border-l-navy/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></span> Historial
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-1">
                <p v-if="!auditLogs.length" class="text-xs text-text-muted italic">Sin eventos registrados</p>
                <div v-for="l in auditLogs" :key="l.id" class="text-xs flex justify-between gap-2 py-1 border-b border-border/40 last:border-0">
                  <span class="font-bold text-navy">{{ auditLabel(l.action) }}</span>
                  <span class="text-text-muted whitespace-nowrap">{{ fmtAuditDate(l.createdAt) }}</span>
                </div>
              </div>
            </details>

            <!-- Condiciones de la Reserva: al final — es la sección menos consultada y la que
                 menos cambia (checkboxes legales), no compite por espacio con lo operativo. -->
            <details class="rm-card bg-white border border-border/70 border-l-[3px] border-l-gold/60 rounded-2xl overflow-hidden shadow-card">
              <summary class="flex items-center gap-2 p-4 cursor-pointer list-none font-black text-sm text-navy select-none">
                <span class="w-7 h-7 rounded-lg bg-gold/10 flex items-center justify-center text-gold"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></span> Condiciones de la Reserva
                <span class="ml-auto text-text-muted transition-transform duration-200"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg></span>
              </summary>
              <div class="px-4 pb-4 pt-1 space-y-2 text-sm">
                <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" :checked="conditions.gdpr" :disabled="!can('reservations','edit')" @change="toggleCondition('gdpr')" class="w-4 h-4 accent-navy disabled:opacity-50" /> Protección de datos (LOPD)</label>
                <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" :checked="conditions.marketing" :disabled="!can('reservations','edit')" @change="toggleCondition('marketing')" class="w-4 h-4 accent-navy disabled:opacity-50" /> Deseo recibir información adicional</label>
                <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" :checked="conditions.terms" :disabled="!can('reservations','edit')" @change="toggleCondition('terms')" class="w-4 h-4 accent-navy disabled:opacity-50" /> Normas de Uso y Seguridad</label>
              </div>
            </details>
      </div>

      <!-- ═══ BONOS (ocultos en pantalla, visibles solo al imprimir) ═══ -->
      <div v-if="d" class="rm-voucher rm-voucher-lodging">
          <h2 style="text-align:center;font-size:20px;font-weight:900;margin-bottom:4px">BONO DEL ALOJAMIENTO</h2>
          <p style="text-align:center;font-size:12px;color:#666;margin-bottom:16px">Comprobante interno</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="padding:4px 0;color:#666">Reserva</td><td style="font-weight:bold">{{ locator }}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Huésped</td><td style="font-weight:bold">{{ d.guest?.name }}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Habitación</td><td style="font-weight:bold">{{ d.room?.number }} {{ d.room?.name || d.room?.type }}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Entrada – Salida</td><td style="font-weight:bold">{{ fmtDate(d.checkIn) }} – {{ fmtDate(d.checkOut) }} ({{ nights }} noches)</td></tr>
            <tr><td style="padding:4px 0;color:#666">Huéspedes</td><td>{{ d.adults }} adultos{{ d.children ? `, ${d.children} niños` : '' }}{{ d.childrenAges?.length ? ` (edades: ${d.childrenAges.join(', ')})` : '' }}</td></tr>
            <tr><td style="padding:8px 0 4px;color:#666;border-top:1px solid #ddd">Total</td><td style="font-weight:900;font-size:16px;border-top:1px solid #ddd">{{ money(grandTotal) }}</td></tr>
          </table>
        </div>
        <div v-if="d" class="rm-voucher rm-voucher-client">
          <h2 style="text-align:center;font-size:20px;font-weight:900;margin-bottom:4px">BONO PARA EL CLIENTE</h2>
          <p style="text-align:center;font-size:12px;color:#666;margin-bottom:16px">Gracias por su reserva</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            <tr><td style="padding:4px 0;color:#666">Estimado/a</td><td style="font-weight:bold">{{ d.guest?.name }}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Habitación</td><td style="font-weight:bold">{{ d.room?.number }}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Check-in / Check-out</td><td>{{ fmtDate(d.checkIn) }} / {{ fmtDate(d.checkOut) }}</td></tr>
            <tr v-if="d.checkinCode"><td style="padding:4px 0;color:#666">Código de check-in</td><td style="font-weight:bold;font-family:monospace">{{ d.checkinCode }}</td></tr>
            <tr><td style="padding:8px 0 4px;color:#666;border-top:1px solid #ddd">Total abonado</td><td style="font-weight:900;font-size:16px;border-top:1px solid #ddd">{{ money(paidTotal) }}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Pendiente</td><td>{{ money(pending) }}</td></tr>
          </table>
          <p style="text-align:center;font-size:11px;color:#999;margin-top:24px">{{ d.ownerNotes }}</p>
        </div>

        <!-- ═══ DOCUMENTOS IMPRIMIBLES (ocultos en pantalla, visibles solo al imprimir) ═══
             CLN-1: el comprobante de cargos y la cotización/proforma eran DOS bloques con ~50
             líneas idénticas (encabezado del hotel, cliente + estadía, tabla de conceptos, marco
             de totales y pie). Dos copias del mismo markup significan que un arreglo entra en una
             y se olvida en la otra — y las dos muestran importes. Ahora es UN bloque y lo que
             cambia entre documentos está declarado en `printDocs`, no repetido. -->
        <template v-if="d">
        <div v-for="doc in printDocs" :key="doc.kind" class="rm-voucher" :class="doc.cls">
          <!-- Emisor -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a2b4c;padding-bottom:16px;margin-bottom:20px">
            <div>
              <h1 style="font-size:22px;font-weight:900;color:#1a2b4c;margin:0">{{ hotelInfo?.name || 'Hotel' }}</h1>
              <p v-if="hotelInfo?.address" style="font-size:12px;color:#555;margin:4px 0 0">{{ hotelInfo.address }}<span v-if="hotelInfo?.municipality || hotelInfo?.province">, {{ [hotelInfo.municipality, hotelInfo.province].filter(Boolean).join(', ') }}</span></p>
              <p style="font-size:12px;color:#555;margin:2px 0 0"><span v-if="hotelInfo?.phone">Tel: {{ hotelInfo.phone }}</span><span v-if="hotelInfo?.email"> · {{ hotelInfo.email }}</span></p>
              <p v-if="doc.showTaxId && hotelInfo?.ownerTaxId" style="font-size:12px;color:#555;margin:2px 0 0">RNC: {{ hotelInfo.ownerTaxId }}</p>
            </div>
            <div style="text-align:right">
              <div style="font-size:20px;font-weight:900;color:#1a2b4c;letter-spacing:1px">{{ doc.title }}</div>
              <div v-if="doc.fiscalWarning" style="font-size:10px;font-weight:bold;color:#d97706;letter-spacing:.5px;margin-top:2px">DOCUMENTO SIN VALOR FISCAL</div>
              <div style="font-size:12px;color:#555;margin-top:4px">{{ doc.numberLabel }} {{ locator }}</div>
              <div style="font-size:12px;color:#555">Fecha: {{ chargesDate }}</div>
              <div v-if="doc.showStatus" style="font-size:11px;color:#888;margin-top:2px">Estado: {{ stLabel(d.status) }}</div>
            </div>
          </div>
          <!-- Cliente + estadía -->
          <div style="display:flex;justify-content:space-between;gap:24px;margin-bottom:20px">
            <div style="flex:1">
              <div style="font-size:10px;font-weight:bold;color:#999;text-transform:uppercase;margin-bottom:4px">Cliente</div>
              <div style="font-size:14px;font-weight:bold;color:#1a2b4c">{{ d.guest?.name || 'Consumidor final' }}</div>
              <div v-if="doc.showGuestDocument && d.guest?.document" style="font-size:12px;color:#555">{{ d.guest.documentType || 'Doc' }}: {{ d.guest.document }}</div>
              <div v-if="d.guest?.email" style="font-size:12px;color:#555">{{ d.guest.email }}</div>
              <div v-if="d.guest?.phone" style="font-size:12px;color:#555">{{ d.guest.phone }}</div>
            </div>
            <div style="flex:1;text-align:right">
              <div style="font-size:10px;font-weight:bold;color:#999;text-transform:uppercase;margin-bottom:4px">Estadía</div>
              <div style="font-size:12px;color:#555">Entrada: <b style="color:#1a2b4c">{{ fmtDate(d.checkIn) }}</b></div>
              <div style="font-size:12px;color:#555">Salida: <b style="color:#1a2b4c">{{ fmtDate(d.checkOut) }}</b></div>
              <div style="font-size:12px;color:#555">{{ nights }} noche(s) · {{ d.adults }} adulto(s){{ d.children ? ', ' + d.children + ' niño(s)' : '' }}</div>
            </div>
          </div>
          <!-- Conceptos -->
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
            <thead>
              <tr style="border-bottom:2px solid #1a2b4c">
                <th style="text-align:left;padding:8px 0;font-size:11px;text-transform:uppercase;color:#555">Concepto</th>
                <th style="text-align:right;padding:8px 0;font-size:11px;text-transform:uppercase;color:#555">Importe</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in chargesItems" :key="i" style="border-bottom:1px solid #eee">
                <td style="padding:8px 0;color:#333">{{ it.desc }}</td>
                <td style="padding:8px 0;text-align:right;font-weight:bold;color:#1a2b4c">{{ money(it.amount) }}</td>
              </tr>
            </tbody>
          </table>
          <!-- Totales -->
          <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
            <table style="font-size:13px;min-width:260px">
              <tbody>
              <tr v-if="chargesTax > 0"><td style="padding:4px 16px 4px 0;color:#555">Subtotal</td><td style="padding:4px 0;text-align:right;font-weight:bold">{{ money(chargesSubtotal) }}</td></tr>
              <tr v-if="chargesTax > 0"><td style="padding:4px 16px 4px 0;color:#555">{{ chargesTaxName }} ({{ chargesTaxRate }}%)</td><td style="padding:4px 0;text-align:right;font-weight:bold">{{ money(chargesTax) }}</td></tr>
              <tr style="border-top:2px solid #1a2b4c"><td style="padding:8px 16px 4px 0;font-weight:900;color:#1a2b4c;font-size:15px">{{ doc.totalLabel }}</td><td style="padding:8px 0 4px;text-align:right;font-weight:900;color:#1a2b4c;font-size:15px">{{ money(grandTotal) }}</td></tr>
              <tr v-if="doc.showPayments"><td style="padding:4px 16px 4px 0;color:#555">Pagado</td><td style="padding:4px 0;text-align:right;color:#16a34a;font-weight:bold">{{ money(paidTotal) }}</td></tr>
              <tr v-if="doc.showPayments && pending > 0"><td style="padding:4px 16px 4px 0;color:#555">Pendiente</td><td style="padding:4px 0;text-align:right;color:#d97706;font-weight:bold">{{ money(pending) }}</td></tr>
              </tbody>
            </table>
          </div>
          <!-- Pie -->
          <div style="border-top:1px solid #ddd;padding-top:12px;text-align:center">
            <p style="font-size:11px;color:#999;margin:0">Gracias por su preferencia · {{ hotelInfo?.name }}</p>
            <p v-for="(nota, i) in doc.notes" :key="i" style="font-size:10px;color:#888;margin:6px 0 0" v-html="nota"></p>
            <p v-if="doc.showNoTaxNote && chargesTax === 0" style="font-size:10px;color:#bbb;margin:4px 0 0">Sin desglose de impuesto (el hotel no tiene tasa configurada)</p>
          </div>
        </div>
        </template>
    </div>

    <template #footer>
      <div class="flex items-center gap-2 text-sm mr-auto">
        <span class="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center text-navy shrink-0"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h1M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg></span>
        <span>
          <span class="text-text-muted">Total: </span>
          <span class="font-black text-navy text-lg">{{ money(grandTotal) }}</span>
          <span v-if="secondaryTotal !== null" class="text-purple font-bold ml-2">≈ {{ moneySecondary(secondaryTotal) }}</span>
        </span>
      </div>
      <button @click="emit('close')" class="px-5 py-2.5 border border-border/60 rounded-full text-sm font-bold text-text-secondary cursor-pointer hover:bg-white transition">Cerrar</button>
      <button @click="editar" class="flex items-center gap-1.5 px-6 py-2.5 bg-teal text-white rounded-full text-sm font-black cursor-pointer hover:opacity-90 transition">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.932zM19.5 21H4.5a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5h9"/></svg>
        Editar Reserva
      </button>
    </template>
  </AppModal>

  <!-- Anular: apilado sobre ReservationModal (AppModal resuelve el stack de Escape/scroll-lock entre
       instancias). NO es un ConfirmModal genérico: anular mueve plata (penalidad, reembolso, depósito
       retenido), así que hay que ver el cálculo y dar un motivo antes de confirmar. -->
  <CancelReservationModal :open="showCancel" :reservation="cancellable"
    @close="showCancel = false" @cancelled="onCancelled" />

  <!-- Registrar pago manual (REQ-RWP-06, #249): apilado igual que Anular. Al guardar se recarga
       el detalle (badge de pago + "Historial de cobros" con quién lo registró) y se avisa al
       listado. `pending` sale del backend: el modal lo usa de tope y valor inicial. -->
  <MarkPaidModal :open="showMarkPaid" :reservation-id="d?.id ?? ''" :pending="pending" :currency="d?.currency || undefined"
    @close="showMarkPaid = false" @paid="onMarkPaid" />

  <!-- Emitir factura (REQ-FDR-02, #254): confirmación estilada antes del POST /reservas/:id/invoice. -->
  <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
    :confirm-label="confirmModal.confirmLabel" :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />

  <!-- Enviar factura por email (mismo form que /panel/billing; la lógica vive en useInvoiceActions). -->
  <AppModal v-if="showEmailModal && emailTarget" size="md"
    :title="`Enviar factura #${emailTarget.number}`" @close="closeEmailModal">
    <form class="space-y-4" @submit.prevent="confirmEmail">
      <div>
        <label for="rm-email-to" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Email del destinatario</label>
        <input
          id="rm-email-to"
          v-model.trim="emailTo"
          type="email"
          autocomplete="email"
          placeholder="huesped@ejemplo.com"
          class="w-full rounded-xl border px-4 py-2.5 text-sm transition-colors focus:outline-none"
          :class="emailError ? 'border-red-400 focus:border-red-500' : 'border-border focus:border-navy'"
          @input="emailError = ''"
        />
        <p v-if="emailError" class="mt-2 text-xs font-bold text-red-500">{{ emailError }}</p>
      </div>
    </form>
    <template #footer>
      <button @click="closeEmailModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
      <button @click="confirmEmail" :disabled="sendingEmail || !emailTo"
        class="rounded-full bg-teal px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-light transition-colors cursor-pointer disabled:opacity-50">
        {{ sendingEmail ? 'Enviando…' : 'Enviar' }}
      </button>
    </template>
  </AppModal>

  <!-- Iframe oculto para Imprimir factura (useInvoiceActions.printFrame). -->
  <iframe ref="printFrame" class="hidden" style="position:absolute;width:0;height:0;border:0;"></iframe>

  <!-- Gestor completo de la cerradura de la habitación de esta reserva (se teletransporta a
       body, no afecta el layout del detalle). Se monta on-demand y refresca el detalle al
       cambiar algo (código generado / cerradura asignada). -->
  <RoomLockModal v-if="showRoomLockManager && d" :room-id="d.roomId ?? null" :room-number="String(d.room?.number ?? '')"
    :reservation-id="d.id" @close="showRoomLockManager = false" @changed="onRoomLockChanged" />

  <!-- Loading -->
  <Teleport to="body">
    <div v-if="loading" class="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 backdrop-blur-sm">
      <div class="bg-white rounded-2xl px-8 py-6 flex items-center gap-3">
        <div class="w-5 h-5 border-2 border-navy border-t-transparent rounded-full animate-spin"></div>
        <span class="text-sm font-bold text-navy">Cargando reserva…</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
details > summary::-webkit-details-marker { display: none; }
details[open] > summary .ml-auto { transform: rotate(180deg); }
/* Los bonos no se ven en pantalla */
.rm-voucher { display: none; }
/* Masonry de tarjetas: fluyen en 2 columnas (CSS columns, no grid fijo) para que una
   tarjeta condicional ausente (sin tarjeta de garantía, sin cerradura, etc.) no deje un
   hueco vacío al lado — la siguiente tarjeta sube a ocupar ese espacio. */
.rm-card { break-inside: avoid; margin-bottom: 1rem; }
</style>

<style>
/* Print: por defecto imprime el detalle (.rm-print-area). Modos bono cambian el área visible. */
@media print {
  body * { visibility: hidden; }
  .rm-print-area, .rm-print-area * { visibility: visible; }
  .rm-print-area { position: absolute; left: 0; top: 0; width: 100%; max-height: none; overflow: visible; }
  .rm-no-print { display: none !important; }
  /* En papel, una sola columna: el salto de columna a mitad de página es más difícil
     de seguir leyendo que en pantalla. */
  .rm-cards { columns: 1 !important; }

  /* Modo bono alojamiento */
  .print-voucherLodging .rm-print-area { display: none !important; }
  .print-voucherLodging .rm-voucher-lodging { display: block !important; position: fixed; left: 0; top: 0; width: 100%; padding: 24px; visibility: visible; }
  .print-voucherLodging .rm-voucher-lodging, .print-voucherLodging .rm-voucher-lodging * { visibility: visible; }
  /* Modo bono cliente */
  .print-voucherClient .rm-print-area { display: none !important; }
  .print-voucherClient .rm-voucher-client { display: block !important; position: fixed; left: 0; top: 0; width: 100%; padding: 24px; visibility: visible; }
  .print-voucherClient .rm-voucher-client, .print-voucherClient .rm-voucher-client * { visibility: visible; }
  /* Modo factura */
  .print-charges .rm-print-area { display: none !important; }
  /* position: fixed (NO absolute): ancla el documento a la PÁGINA. Con absolute se anclaba al
     .modal-panel centrado (con overflow:hidden) y el contenido caía fuera del A4 → hoja en blanco. */
  .print-charges .rm-charges { display: block !important; position: fixed; left: 0; top: 0; width: 100%; padding: 32px 40px; visibility: visible; }
  .print-charges .rm-charges, .print-charges .rm-charges * { visibility: visible; }
  /* Modo cotización */
  .print-quote .rm-print-area { display: none !important; }
  .print-quote .rm-quote { display: block !important; position: fixed; left: 0; top: 0; width: 100%; padding: 32px 40px; visibility: visible; }
  .print-quote .rm-quote, .print-quote .rm-quote * { visibility: visible; }
}
</style>
