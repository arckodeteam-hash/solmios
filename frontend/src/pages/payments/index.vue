<template>
  <div>
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">Links de Pago</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-xs text-text-muted mt-0.5">Cobros pendientes enviados a huéspedes — seguimiento de estado</p>
      </div>
      <button @click="openNew" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo Link
      </button>
    </div>

    <!-- Stats — KpiHeroCard (animan solos) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Pendientes" :value="pendingCount" icon="bookings" accent="rose"
        unit="Links esperando pago" />
      <KpiHeroCard label="Pagados" :value="paidCount" icon="checkin" accent="teal"
        unit="Links ya cobrados" :progress="paidShare" />
      <KpiHeroCard label="Cobrado (total)" :value="paidAmountValue" icon="money" accent="blue"
        prefix="$" unit="Ingresado por links" />
      <KpiHeroCard label="Por cobrar" :value="pendingAmountValue" icon="checkout" accent="amber"
        prefix="$" unit="Monto de links pendientes" />
    </div>

    <!-- Listado -->
    <SectionCard title="Links de pago" :subtitle="`${filtered.length} de ${payments.length} link(s)`" body-class="p-0">
      <template #actions>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" v-html="ICON_SEARCH"></span>
          <input
            id="payment-links-search"
            name="search"
            v-model="search"
            type="text"
            aria-label="Buscar links de pago por reserva o destinatario"
            placeholder="Buscar por reserva o destinatario..."
            class="w-full sm:w-72 pl-9 pr-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-cyan focus:bg-white/15 transition-colors"
          />
        </div>
        <select id="payment-links-filter-status" name="filterStatus" aria-label="Filtrar links de pago por estado" v-model="filterStatus" class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="">Todos los estados</option>
          <option class="text-navy" value="pending">Pendientes</option>
          <option class="text-navy" value="paid">Pagados</option>
          <option class="text-navy" value="expired">Expirados</option>
          <option class="text-navy" value="cancelled">Cancelados</option>
        </select>
      </template>

      <!-- Carga -->
      <div v-if="loading" class="p-4 sm:p-5 space-y-3">
        <div v-for="n in 5" :key="n" class="flex items-center gap-4">
          <div class="h-9 flex-1 animate-pulse rounded bg-surface"></div>
          <div class="h-9 w-24 animate-pulse rounded bg-surface hidden sm:block"></div>
          <div class="h-9 w-20 animate-pulse rounded bg-surface"></div>
        </div>
      </div>

      <EmptyState
        v-else-if="filtered.length === 0"
        :icon="ICON_CARD"
        :title="hasFilters ? 'Sin resultados' : 'Todavía no hay links de pago'"
        :message="hasFilters ? 'Probá con otro término de búsqueda o quitá el filtro de estado.' : 'Creá un link para cobrarle a un huésped de forma remota.'"
      >
        <template #action>
          <button v-if="hasFilters" @click="clearFilters" class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Limpiar filtros
          </button>
          <button v-else @click="openNew" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Crear link
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[900px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Reserva</th>
              <th class="text-left px-4 py-3 text-[10px]">Destinatario</th>
              <th class="text-right px-4 py-3 text-[10px]">Monto</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Enviado vía</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Fecha</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in filtered" :key="p.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div v-if="p.reservationId" class="text-xs font-bold text-navy tabular-nums">{{ p.reservationId.slice(0, 8) }}</div>
                <div v-else class="text-xs text-text-muted">Sin reserva</div>
                <div v-if="p.guestName" class="text-[11px] text-text-muted truncate">{{ p.guestName }}</div>
                <!-- En <xl la columna Fecha está oculta: el dato sube acá -->
                <div class="text-[11px] text-text-muted xl:hidden">{{ formatDate(p.createdAt) }}</div>
              </td>
              <td class="px-4 py-3">
                <div v-if="p.sentTo" class="text-sm text-navy truncate max-w-[220px]">{{ p.sentTo }}</div>
                <div v-else class="text-sm text-text-muted">Sin destinatario</div>
                <!-- En <lg la columna Enviado vía está oculta -->
                <div class="text-[11px] text-text-muted lg:hidden">{{ channelLabel(p.sentVia) }}</div>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="text-sm font-extrabold text-navy tabular-nums">{{ formatMoney(p.amount) }}</div>
                <div class="text-[10px] text-text-muted">{{ p.currency || 'USD' }}</div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <span class="flex items-center gap-1.5 text-sm text-text-secondary">
                  <span class="h-3.5 w-3.5 shrink-0 text-text-muted" v-html="channelIcon(p.sentVia)"></span>
                  {{ channelLabel(p.sentVia) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide" :class="statusClass(p.status)">
                  {{ statusLabel(p.status) }}
                </span>
              </td>
              <td class="px-4 py-3 hidden xl:table-cell">
                <div class="text-[11px] text-text-secondary">{{ formatDate(p.createdAt) }}</div>
                <div v-if="p.paidAt" class="text-[10px] font-bold text-teal">Pagado {{ formatDate(p.paidAt) }}</div>
              </td>
              <td class="px-4 py-3 text-right" @click.stop>
                <div class="flex items-center justify-end gap-1">
                  <button v-if="stripeConfigured && p.status === 'pending'" @click="createStripe(p)" title="Crear link de pago Stripe"
                    class="grid h-8 w-8 place-items-center rounded-lg text-purple hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CARD"></span>
                  </button>
                  <button v-if="p.stripePaymentUrl && p.status === 'pending'" @click="copyStripeUrl(p)" title="Copiar URL de pago"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_LINK"></span>
                  </button>
                  <button v-if="p.status === 'pending'" @click="resend(p, 'email')" title="Reenviar email"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_ENVELOPE"></span>
                  </button>
                  <button v-if="p.status === 'pending'" @click="resend(p, 'whatsapp')" title="Reenviar WhatsApp"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-teal/10 hover:text-teal transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CHAT"></span>
                  </button>
                  <button v-if="p.status === 'pending'" @click="markAsPaid(p)" title="Marcar pagado (manual)"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-teal/10 hover:text-teal transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CHECK_PLAIN"></span>
                  </button>
                  <button v-if="p.status === 'pending'" @click="cancel(p)" title="Cancelar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_X"></span>
                  </button>
                  <button @click="remove(p)" title="Eliminar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal Nuevo link -->
    <AppModal v-if="newModal.show" size="md" title="Nuevo Link de Pago"
      subtitle="Cobro remoto a un huésped" @close="newModal.show = false">
      <div class="space-y-4">
        <div>
          <label for="payment-link-reservation" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Reserva *</label>
          <select id="payment-link-reservation" name="reservationId" required aria-required="true" v-model="newForm.reservationId" class="w-full px-4 py-2.5 rounded-xl border text-sm cursor-pointer focus:outline-none"
            :class="attemptedSubmit && reservationError ? 'border-coral focus:border-coral' : 'border-border focus:border-navy'">
            <option value="">Seleccionar...</option>
            <option v-for="r in reservations" :key="r.id" :value="r.id">
              {{ r.guestName }} · Hab. {{ r.roomNumber }} · {{ formatDate(r.checkIn) }}
            </option>
          </select>
          <p v-if="attemptedSubmit && reservationError" class="text-[10px] text-coral font-bold mt-1">{{ reservationError }}</p>
        </div>
        <div>
          <label for="payment-link-amount" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Monto *</label>
          <div class="relative">
            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-text-muted pointer-events-none">$</span>
            <input id="payment-link-amount" name="amount" required aria-required="true" v-model="amountDisplay" type="text" inputmode="decimal" placeholder="0.00"
              @focus="amountFocused = true" @blur="amountFocused = false; roundAmount()"
              class="w-full pl-7 pr-4 py-2.5 rounded-xl border text-sm font-bold text-navy text-right tabular-nums focus:outline-none"
              :class="attemptedSubmit && amountError ? 'border-coral focus:border-coral' : 'border-border focus:border-navy'" />
          </div>
          <p v-if="attemptedSubmit && amountError" class="text-[10px] text-coral font-bold mt-1">{{ amountError }}</p>
          <p v-if="selectedReservation" class="text-[10px] text-text-muted mt-1">
            Pendiente aprox: {{ formatMoney(reservationPendingAmount) }}
            <button @click="newForm.amount = reservationPendingAmount" type="button" class="text-teal hover:underline cursor-pointer ml-2 font-bold">Usar</button>
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="payment-link-sent-to" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Enviar a</label>
            <input id="payment-link-sent-to" name="sentTo" v-model="newForm.sentTo" :type="sentToInputType" :placeholder="sentToPlaceholder" autocomplete="off"
              class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none"
              :class="attemptedSubmit && sentToError ? 'border-coral focus:border-coral' : 'border-border focus:border-navy'" />
            <p v-if="attemptedSubmit && sentToError" class="text-[10px] text-coral font-bold mt-1">{{ sentToError }}</p>
          </div>
          <div>
            <label for="payment-link-sent-via" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Vía</label>
            <select id="payment-link-sent-via" name="sentVia" v-model="newForm.sentVia" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer focus:outline-none focus:border-navy">
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </select>
          </div>
        </div>
      </div>

      <template #footer>
        <button @click="newModal.show = false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="create" :disabled="creating" class="rounded-full bg-navy text-white text-sm font-extrabold px-5 py-2.5 hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ creating ? 'Creando...' : 'Crear link' }}
        </button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { PaymentsService } from '@/services/Payments.service'
import type { PaymentRequest } from '@/services/Payments.service'
import { ReservationService } from '@/services/Reservation.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { CurrencyCode } from '@/types/currency'

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"/></svg>'
const ICON_CHECK_PLAIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>'
const ICON_LINK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5 21 3M16.5 3H21v4.5M10.5 13.5 3 21M7.5 21H3v-4.5"/></svg>'
const ICON_CARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><path stroke-linecap="round" d="M2 10h20"/></svg>'
const ICON_ENVELOPE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>'
const ICON_CHAT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"/></svg>'
const ICON_PHONE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3"/></svg>'
const ICON_X = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>'

const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e) => toast.error((e as any)?.message || 'Error'),
})
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const payments = ref<PaymentRequest[]>([])
const reservations = ref<any[]>([])
const loading = ref(true)
const creating = ref(false)
const search = ref('')
const filterStatus = ref('')

const newModal = ref({ show: false })
const newForm = ref<{ reservationId: string; amount: number | null; sentTo: string; sentVia: 'email' | 'whatsapp' | 'sms' }>({
  reservationId: '', amount: null, sentTo: '', sentVia: 'email',
})

const selectedReservation = computed(() => reservations.value.find(r => r.id === newForm.value.reservationId))
const reservationPendingAmount = computed(() => {
  const r = selectedReservation.value
  if (!r) return 0
  return Math.max(0, Math.round(((r.totalAmount || 0) - (r.deposit || 0)) * 100) / 100)
})
const stripeConfigured = ref(false)

// Validación del formulario "Nuevo Link" — solo se muestra tras el primer intento de envío.
const attemptedSubmit = ref(false)
const reservationError = computed(() => (!newForm.value.reservationId ? 'Seleccioná una reserva' : ''))
const amountError = computed(() => {
  const a = newForm.value.amount
  if (a === null || a === undefined || Number.isNaN(a)) return 'Ingresá un monto'
  if (a <= 0) return 'El monto debe ser mayor a $0'
  return ''
})
const sentToError = computed(() => {
  const v = newForm.value.sentTo.trim()
  if (!v) return '' // opcional
  if (newForm.value.sentVia === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Email inválido'
  }
  return /^[+]?[\d\s()-]{7,}$/.test(v) ? '' : 'Teléfono inválido'
})
const formValid = computed(() => !reservationError.value && !amountError.value && !sentToError.value)

const sentToInputType = computed(() => (newForm.value.sentVia === 'email' ? 'email' : 'tel'))
const sentToPlaceholder = computed(() => (newForm.value.sentVia === 'email' ? 'email@ejemplo.com' : '+1 809 555 0101'))

function roundAmount() {
  if (typeof newForm.value.amount === 'number' && !Number.isNaN(newForm.value.amount)) {
    newForm.value.amount = Math.round(newForm.value.amount * 100) / 100
  }
}

// Campo Monto con separador de miles (5,000.00). Mientras está enfocado se
// edita el número crudo (sin comas, más natural para tipear); al perder el
// foco se muestra formateado. La fuente de verdad sigue siendo newForm.amount.
const amountFocused = ref(false)
const amountDisplay = computed<string>({
  get() {
    const a = newForm.value.amount
    if (a === null || a === undefined || Number.isNaN(a)) return ''
    if (amountFocused.value) return String(a)
    return a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  },
  set(val: string) {
    const cleaned = val.replace(/,/g, '').replace(/[^0-9.]/g, '')
    if (cleaned === '') { newForm.value.amount = null; return }
    const num = Number(cleaned)
    newForm.value.amount = Number.isNaN(num) ? null : num
  },
})

async function checkStripeStatus() {
  try {
    const s = await PaymentsService.status()
    stripeConfigured.value = s.configured
  } catch { stripeConfigured.value = false }
}

async function createStripe(p: PaymentRequest) {
  if (!p.id) return
  try {
    const r = await PaymentsService.createStripeCheckout(p.id)
    p.stripePaymentUrl = r.url
    p.stripeSessionId = r.sessionId
    // Abrir en nueva ventana
    window.open(r.url, '_blank')
    toast.success('Sesión de pago Stripe creada')
  } catch (e: any) {
    toast.error(e.message || 'Error al crear sesión Stripe')
  }
}

async function copyStripeUrl(p: PaymentRequest) {
  if (!p.stripePaymentUrl) return
  try {
    await navigator.clipboard.writeText(p.stripePaymentUrl)
    toast.success('URL copiada al portapapeles')
  } catch {
    toast.error('No se pudo copiar')
  }
}

const stats = computed(() => {
  const pending = payments.value.filter(p => p.status === 'pending')
  const paid = payments.value.filter(p => p.status === 'paid')
  return {
    pending: pending.length,
    paid: paid.length,
    pendingAmount: pending.reduce((s, p) => s + (p.amount || 0), 0),
    paidAmount: paid.reduce((s, p) => s + (p.amount || 0), 0),
  }
})

const pendingCount = computed(() => stats.value.pending)
const paidCount = computed(() => stats.value.paid)
const paidAmountValue = computed(() => stats.value.paidAmount)
const pendingAmountValue = computed(() => stats.value.pendingAmount)

// Los KPI los anima KpiHeroCard internamente (useCountUp propio) — no envolver acá.
// % de links cobrados sobre el total pendiente + pagado (anillo de progreso).
const paidShare = computed(() => {
  const total = pendingCount.value + paidCount.value
  return total === 0 ? 0 : Math.round((paidCount.value / total) * 100)
})

const hasFilters = computed(() => !!search.value || !!filterStatus.value)
function clearFilters() {
  search.value = ''
  filterStatus.value = ''
}

const filtered = computed(() => {
  let list = [...payments.value]
  if (filterStatus.value) list = list.filter(p => p.status === filterStatus.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(p =>
      (p.reservationId || '').toLowerCase().includes(q) ||
      (p.sentTo || '').toLowerCase().includes(q) ||
      (p.guestName || '').toLowerCase().includes(q)
    )
  }
  return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
})

async function load() {
  loading.value = true
  try {
    const r = await PaymentsService.list()
    payments.value = (r.data || []) as PaymentRequest[]
  } catch {
    payments.value = []
    toast.error('No se pudieron cargar los pagos')
  } finally {
    loading.value = false
  }
}

async function loadReservations() {
  try {
    const r = await ReservationService.list({ hotelId: hotelId.value })
    reservations.value = (r.reservations || []).map((x: any) => ({
      id: x.id,
      guestName: x.guestName || 'Sin nombre',
      roomNumber: x.roomNumber || 's/n',
      checkIn: x.checkIn,
      totalAmount: x.totalAmount,
      deposit: x.deposit,
    }))
  } catch { reservations.value = [] }
}

function openNew() {
  newForm.value = { reservationId: '', amount: null, sentTo: '', sentVia: 'email' }
  attemptedSubmit.value = false
  newModal.value.show = true
  if (reservations.value.length === 0) loadReservations()
}

async function create() {
  attemptedSubmit.value = true
  roundAmount()
  if (!formValid.value) {
    toast.error('Revisá los campos marcados')
    return
  }
  creating.value = true
  try {
    await PaymentsService.create({
      reservationId: newForm.value.reservationId,
      amount: newForm.value.amount as number,
      sentTo: newForm.value.sentTo,
      sentVia: newForm.value.sentVia,
    })
    toast.success('Link de pago creado')
    newModal.value.show = false
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Error')
  } finally {
    creating.value = false
  }
}

async function markAsPaid(p: PaymentRequest) {
  try {
    // `paidAt` lo pone el SERVIDOR (payment-requests/usecases/update-request.ts): es el sello de
    // cuándo entró la plata, no un dato del navegador. Se toma el que devuelve la respuesta.
    const updated = await PaymentsService.update(p.id!, { status: 'paid' })
    p.status = updated.status
    p.paidAt = updated.paidAt
    toast.success('Marcado como pagado')
  } catch (e: any) {
    toast.error(e.message || 'Error')
  }
}

function cancel(p: PaymentRequest) {
  askConfirm({
    title: 'Cancelar link',
    message: '¿Cancelar este link de pago?',
    confirmLabel: 'Cancelar link', danger: true,
    run: async () => {
      await PaymentsService.update(p.id!, { status: 'cancelled' })
      p.status = 'cancelled'
      toast.success('Cancelado')
    },
  })
}

function remove(p: PaymentRequest) {
  askConfirm({
    title: 'Eliminar link',
    message: '¿Eliminar este link? No se puede deshacer.',
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await PaymentsService.remove(p.id!)
      payments.value = payments.value.filter(x => x.id !== p.id)
      toast.success('Eliminado')
    },
  })
}

function resend(p: PaymentRequest, channel: 'email' | 'whatsapp') {
  const dest = p.sentTo || ''
  if (!dest) { toast.error('Sin destinatario'); return }
  const text = `Link de pago: ${formatMoney(p.amount)} ${p.currency || 'USD'}`
  if (channel === 'email') {
    window.open(`mailto:${dest}?subject=${encodeURIComponent('Link de pago')}&body=${encodeURIComponent(text)}`)
  } else {
    const clean = dest.replace(/[^0-9]/g, '')
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(text)}`)
  }
  toast.success(`Reenviado por ${channel}`)
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: CurrencyCode.USD, minimumFractionDigits: 2 }).format(n || 0)
}
function formatDate(d?: string): string {
  if (!d) return '—'
  return new Date(d.includes('T') ? d : d + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}
function statusLabel(s: string): string {
  const m: Record<string, string> = { pending: 'Pendiente', paid: 'Pagado', expired: 'Expirado', cancelled: 'Cancelado' }
  return m[s] || s
}
function statusClass(s: string): string {
  const m: Record<string, string> = {
    pending: 'bg-gold/10 text-gold',
    paid: 'bg-teal/10 text-teal',
    expired: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-coral/10 text-coral',
  }
  return m[s] || 'bg-gray-100 text-gray-500'
}
function channelIcon(c?: string): string {
  const m: Record<string, string> = { email: ICON_ENVELOPE, whatsapp: ICON_CHAT, sms: ICON_PHONE }
  return m[c || ''] || ICON_ENVELOPE
}
function channelLabel(c?: string): string {
  const m: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' }
  return m[c || ''] || (c || 'Sin canal')
}

onMounted(() => {
  load()
  checkStripeStatus()
})
</script>

<style scoped>
/* Las transiciones de entrada/salida del modal ahora las aporta AppModal. */
</style>
