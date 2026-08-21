<template>
  <div>
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">Folios In-House</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-xs text-text-muted mt-0.5">Cuentas abiertas de huéspedes con check-in activo — cargos, pagos y facturación</p>
      </div>
      <div class="flex gap-2">
        <button @click="load" :disabled="loading" class="flex items-center gap-1.5 px-4 py-2 border border-border rounded-full text-sm font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer disabled:opacity-50">
          <span class="w-4 h-4 shrink-0" v-html="ICON_REFRESH"></span>
          {{ loading ? 'Cargando...' : 'Refrescar' }}
        </button>
        <button @click="postAllRoomCharges" :disabled="posting"
          class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
          <span class="w-4 h-4 shrink-0" v-html="ICON_BUILDING"></span>
          {{ posting ? 'Posteando...' : 'Postear cargos habitación (todos)' }}
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Folios Abiertos" :value="foliosCount" icon="building" accent="blue"
        unit="Cuentas de huéspedes in-house" />
      <KpiHeroCard label="Total Cargos" :value="totalCharges" icon="money" accent="teal"
        prefix="$" :unit="`${totalChargeCount} movimiento(s) posteado(s)`" />
      <KpiHeroCard label="Total Pagos" :value="totalPayments" icon="checkin" accent="purple"
        prefix="$" unit="Cobrado contra folios abiertos" />
      <KpiHeroCard label="Balance Pendiente" :value="totalBalance" icon="checkout" accent="amber"
        prefix="$" unit="Por cobrar antes del check-out" :progress="collectedShare" />
    </div>

    <!-- Lista -->
    <SectionCard title="Folios abiertos" :subtitle="`${foliosCount} cuenta(s) in-house`" body-class="p-0">
      <template #actions>
        <span class="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[11px] font-bold tabular-nums text-white">
          Balance {{ formatMoney(totalBalance) }}
        </span>
      </template>

      <!-- Carga -->
      <div v-if="loading && folios.length === 0" class="p-4 sm:p-5 space-y-3">
        <div v-for="i in 4" :key="i" class="h-14 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <EmptyState v-else-if="folios.length === 0"
        :icon="ICON_DOCUMENT"
        title="Sin folios abiertos"
        message="Los folios se abren automáticamente al hacer check-in de una reserva.">
        <template #action>
          <button @click="load" :disabled="loading"
            class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer disabled:opacity-50">
            Refrescar
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Huésped</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Abierto</th>
              <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Cargos</th>
              <th class="text-right px-4 py-3 text-[10px] hidden xl:table-cell">Pagos</th>
              <th class="text-right px-4 py-3 text-[10px]">Balance</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="f in folios" :key="f.id">
              <tr @click="toggleFolio(f.id)" :data-folio-id="f.id"
                class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="h-9 w-9 shrink-0 grid place-items-center rounded-full bg-cyan/10 text-[11px] font-black tabular-nums text-cyan">
                      {{ f.roomNumber || (f.guestName || 'F').charAt(0).toUpperCase() }}
                    </div>
                    <div class="min-w-0">
                      <div class="max-w-[220px] truncate text-sm font-black" :class="f.guestName ? 'text-navy' : 'text-text-muted'">
                        {{ f.guestName || `Folio ${f.id.slice(0, 8)}` }}
                      </div>
                      <div class="text-[11px] text-text-muted">
                        <span v-if="f.roomNumber">Hab. {{ f.roomNumber }} · </span>{{ f.chargeCount || 0 }} cargo(s)
                        <span class="lg:hidden"> · Abierto {{ formatDate(f.openedAt) }}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">{{ formatDate(f.openedAt) }}</td>
                <td class="px-4 py-3 text-right text-sm font-bold tabular-nums text-navy hidden lg:table-cell">{{ formatMoney(f.chargesTotal || 0) }}</td>
                <td class="px-4 py-3 text-right text-sm font-bold tabular-nums text-teal hidden xl:table-cell">{{ formatMoney(f.paymentsTotal || 0) }}</td>
                <td class="px-4 py-3 text-right text-sm font-black tabular-nums" :class="(f.balance || 0) > 0 ? 'text-coral' : 'text-teal'">
                  {{ formatMoney(f.balance || 0) }}
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center justify-end gap-1">
                    <button @click.stop="openChargeModal(f)" title="Agregar cargo"
                      class="h-8 w-8 grid place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                      <span class="h-4 w-4" v-html="ICON_PLUS"></span>
                    </button>
                    <button @click.stop="openPayModal(f)" title="Registrar pago"
                      class="h-8 w-8 grid place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                      <span class="h-4 w-4" v-html="ICON_CARD"></span>
                    </button>
                    <button @click.stop="toggleFolio(f.id)" :title="expanded.has(f.id) ? 'Ocultar detalle' : 'Ver detalle'"
                      class="h-8 w-8 grid place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                      <span class="h-4 w-4 transition-transform" :class="expanded.has(f.id) ? 'rotate-180' : ''" v-html="ICON_CHEVRON_DOWN"></span>
                    </button>
                  </div>
                </td>
              </tr>

              <!-- Detalle expandido -->
              <tr v-if="expanded.has(f.id)" class="border-b border-border last:border-0">
                <td colspan="6" class="bg-surface/40 px-4 py-4 sm:px-5">
                  <!-- Cargos -->
                  <div class="pb-4 border-b border-border">
                    <div class="flex items-center justify-between mb-3">
                      <h4 class="text-[10px] font-bold text-text-muted uppercase tracking-wide">Cargos y pagos</h4>
                      <button @click.stop="openChargeModal(f)" class="text-[11px] font-bold text-teal hover:text-navy transition-colors cursor-pointer">+ Agregar cargo</button>
                    </div>
                    <p v-if="!f.charges || f.charges.length === 0" class="py-2 text-xs text-text-muted">Sin movimientos registrados. Posteá los cargos de habitación con el botón superior.</p>
                    <div v-else class="divide-y divide-border">
                      <div v-for="c in f.charges" :key="c.id" class="py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="h-2 w-2 rounded-full shrink-0" :class="c.kind === 'payment' ? 'bg-teal' : 'bg-navy/30'"></span>
                          <div class="min-w-0">
                            <div class="font-bold text-navy truncate">{{ c.description || categoryLabel(c.category) }}</div>
                            <div class="text-[10px] text-text-muted">
                              {{ categoryLabel(c.category) }}<span v-if="c.postedAt"> · {{ formatDate(c.postedAt) }}</span><span v-if="c.source"> · {{ c.source }}</span>
                            </div>
                          </div>
                        </div>
                        <div class="shrink-0 text-right">
                          <div class="font-bold tabular-nums" :class="c.kind === 'payment' ? 'text-teal' : 'text-navy'">
                            {{ c.kind === 'payment' ? '-' : '+' }}{{ formatMoney(c.total) }}
                          </div>
                          <div v-if="c.quantity > 1" class="text-[10px] text-text-muted tabular-nums">{{ c.quantity }}u × {{ formatMoney(c.amount) }}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Totales -->
                  <div class="grid grid-cols-3 gap-3 py-4 border-b border-border">
                    <div>
                      <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Cargos</div>
                      <div class="mt-0.5 text-sm font-bold tabular-nums text-navy">{{ formatMoney(f.chargesTotal || 0) }}</div>
                    </div>
                    <div>
                      <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Pagos</div>
                      <div class="mt-0.5 text-sm font-bold tabular-nums text-teal">{{ formatMoney(f.paymentsTotal || 0) }}</div>
                    </div>
                    <div>
                      <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Balance</div>
                      <div class="mt-0.5 text-sm font-bold tabular-nums" :class="(f.balance || 0) > 0 ? 'text-coral' : 'text-teal'">{{ formatMoney(f.balance || 0) }}</div>
                    </div>
                  </div>

                  <!-- Acciones -->
                  <div class="pt-4 flex items-center justify-end gap-4">
                    <button @click.stop="openPayModal(f)" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">
                      Registrar pago
                    </button>
                    <button @click.stop="closeAndInvoice(f)" data-testid="folio-close-invoice-btn" :disabled="closing === f.id"
                      class="rounded-full bg-navy text-white text-sm font-extrabold px-5 py-2.5 hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
                      {{ closing === f.id ? 'Cerrando...' : 'Cerrar y facturar' }}
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal Agregar cargo -->
    <AppModal v-if="chargeModal.show" size="md" title="Cargo a Folio"
      :subtitle="folioSubtitle(chargeModal.folio)" @close="chargeModal.show = false">
      <div class="space-y-4">
        <div>
          <label for="folio-charge-category" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Categoría</label>
          <select id="folio-charge-category" name="chargeCategory" v-model="chargeForm.category" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer focus:outline-none focus:border-navy">
            <option value="room">Habitación</option>
            <option value="minibar">Minibar</option>
            <option value="restaurant">Restaurante</option>
            <option value="laundry">Lavandería</option>
            <option value="spa">SPA</option>
            <option value="service">Servicio</option>
            <option value="other">Otro</option>
          </select>
        </div>
        <div>
          <label for="folio-charge-description" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Descripción <span class="text-coral">*</span></label>
          <input id="folio-charge-description" name="chargeDescription" required aria-required="true" v-model="chargeForm.description" type="text" placeholder="Ej: Cena - menú del día" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="folio-charge-amount" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Monto unitario <span class="text-coral">*</span></label>
            <input id="folio-charge-amount" name="chargeAmount" required aria-required="true" v-model.number="chargeForm.amount" type="number" min="0" step="0.01" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-bold tabular-nums text-navy text-right focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="folio-charge-quantity" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Cantidad</label>
            <input id="folio-charge-quantity" name="chargeQuantity" v-model.number="chargeForm.quantity" type="number" min="1" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-bold tabular-nums text-navy text-right focus:outline-none focus:border-navy" />
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="chargeModal.show = false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveCharge" :disabled="savingCharge" class="rounded-full bg-navy text-white text-sm font-extrabold px-5 py-2.5 hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ savingCharge ? 'Guardando...' : 'Agregar' }}
        </button>
      </template>
    </AppModal>

    <!-- Modal Registrar pago -->
    <AppModal v-if="payModal.show" size="md" title="Registrar Pago"
      :subtitle="folioSubtitle(payModal.folio)" @close="payModal.show = false">
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Balance del folio</span>
          <span class="text-sm font-black tabular-nums" :class="(payModal.folio?.balance || 0) > 0 ? 'text-coral' : 'text-teal'">
            {{ formatMoney(payModal.folio?.balance || 0) }}
          </span>
        </div>
        <div>
          <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Método</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="method in paymentMethods"
              :key="method.value"
              type="button"
              @click="payForm.method = method.value"
              class="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold border transition-all cursor-pointer"
              :class="payForm.method === method.value ? 'border-navy bg-navy text-white' : 'border-border text-text-secondary hover:border-navy/30'"
            >
              <span class="w-3.5 h-3.5 shrink-0" v-html="method.icon"></span>
              {{ method.label }}
            </button>
          </div>
        </div>
        <div>
          <label for="folio-pay-amount" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Monto <span class="text-coral">*</span></label>
          <div class="flex gap-2">
            <input id="folio-pay-amount" name="payAmount" required aria-required="true" v-model.number="payForm.amount" type="number" min="0" step="0.01" :placeholder="String(payModal.folio?.balance || 0)" class="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold tabular-nums text-navy text-right focus:outline-none focus:border-navy" />
            <button @click="payForm.amount = payModal.folio?.balance || 0" type="button" class="px-3.5 py-2 rounded-full border border-border text-text-secondary text-xs font-bold hover:border-navy/30 transition-colors cursor-pointer">Total</button>
          </div>
        </div>
        <div>
          <label for="folio-pay-reference" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Referencia (opcional)</label>
          <input id="folio-pay-reference" name="payReference" v-model="payForm.reference" type="text" placeholder="Ej: TXN-12345" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
      </div>
      <template #footer>
        <button @click="payModal.show = false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="savePayment" :disabled="savingPay" class="rounded-full bg-teal text-white text-sm font-extrabold px-5 py-2.5 hover:bg-teal-light transition-colors cursor-pointer disabled:opacity-50">
          {{ savingPay ? 'Guardando...' : 'Registrar' }}
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
import { FoliosService } from '@/services/Folios.service'
import type { Folio } from '@/services/Folios.service'
import { OperationsService } from '@/services/Operations.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { CurrencyCode } from '@/types/currency'

const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>'
const ICON_DOCUMENT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>'
const ICON_CARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'
const ICON_REFRESH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>'
const ICON_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
const ICON_CASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>'
const ICON_BANK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>'
const ICON_LINK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'

const paymentMethods = [
  { value: 'cash', label: 'Efectivo', icon: ICON_CASH },
  { value: 'card', label: 'Tarjeta', icon: ICON_CARD },
  { value: 'transfer', label: 'Transferencia', icon: ICON_BANK },
  { value: 'link', label: 'Link de pago', icon: ICON_LINK },
]

const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Folio cerrado y factura generada'),
  onError: (e) => toast.error((e as any)?.message || 'Error al cerrar folio'),
})
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const folios = ref<Folio[]>([])
const loading = ref(false)
const posting = ref(false)
const closing = ref<string | null>(null)
const expanded = ref<Set<string>>(new Set())

const foliosCount = computed(() => folios.value.length)
const totalCharges = computed(() => folios.value.reduce((s, f) => s + (f.chargesTotal || 0), 0))
const totalPayments = computed(() => folios.value.reduce((s, f) => s + (f.paymentsTotal || 0), 0))
const totalBalance = computed(() => folios.value.reduce((s, f) => s + (f.balance || 0), 0))
const totalChargeCount = computed(() => folios.value.reduce((s, f) => s + (f.chargeCount || 0), 0))
// % de lo cargado que ya está cobrado — alimenta el anillo del KPI de balance.
const collectedShare = computed(() => {
  const charges = totalCharges.value
  if (charges <= 0) return 0
  return Math.min(100, Math.round((totalPayments.value / charges) * 100))
})

// Los KPI los anima KpiHeroCard internamente (useCountUp propio).

async function load() {
  loading.value = true
  try {
    folios.value = await FoliosService.list(hotelId.value, 'open')
  } catch (e: any) {
    toast.error(e.message || 'Error al cargar folios')
    folios.value = []
  } finally {
    loading.value = false
  }
}

function toggleFolio(id: string) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
  // Cargar detalle del folio si no tiene charges
  const f = folios.value.find(x => x.id === id)
  if (s.has(id) && f && (!f.charges || f.charges.length === 0)) {
    FoliosService.get(id).then(detail => {
      const idx = folios.value.findIndex(x => x.id === id)
      if (idx >= 0) folios.value[idx] = { ...folios.value[idx], ...detail }
    }).catch(() => {})
  }
}

async function postAllRoomCharges() {
  if (posting.value) return
  posting.value = true
  try {
    await OperationsService.nightAuditRun(hotelId.value)
    toast.success('Cargos de habitación posteados a folios in-house')
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Error al postear cargos')
  } finally {
    posting.value = false
  }
}

// Modal cargo
const chargeModal = ref<{ show: boolean; folio: Folio | null }>({ show: false, folio: null })
const chargeForm = ref<{ category: string; description: string; amount: number; quantity: number }>({ category: 'service', description: '', amount: 0, quantity: 1 })
const savingCharge = ref(false)

function openChargeModal(f: Folio) {
  chargeModal.value = { show: true, folio: f }
  chargeForm.value = { category: 'service', description: '', amount: 0, quantity: 1 }
}

async function saveCharge() {
  if (!chargeModal.value.folio) return
  if (!chargeForm.value.amount || chargeForm.value.amount <= 0) {
    toast.error('Monto debe ser mayor a 0')
    return
  }
  savingCharge.value = true
  try {
    await FoliosService.charge(chargeModal.value.folio.id, {
      description: chargeForm.value.description,
      amount: chargeForm.value.amount,
      category: chargeForm.value.category,
      quantity: chargeForm.value.quantity,
    })
    toast.success('Cargo agregado')
    chargeModal.value.show = false
    // Recargar el folio específico
    const detail = await FoliosService.get(chargeModal.value.folio.id)
    const idx = folios.value.findIndex(f => f.id === detail.id)
    if (idx >= 0) folios.value[idx] = detail
  } catch (e: any) {
    toast.error(e.message || 'Error')
  } finally {
    savingCharge.value = false
  }
}

// Modal pago
const payModal = ref<{ show: boolean; folio: Folio | null }>({ show: false, folio: null })
const payForm = ref<{ method: string; amount: number; reference: string }>({ method: 'cash', amount: 0, reference: '' })
const savingPay = ref(false)

function openPayModal(f: Folio) {
  payModal.value = { show: true, folio: f }
  payForm.value = { method: 'cash', amount: f.balance || 0, reference: '' }
}

async function savePayment() {
  if (!payModal.value.folio) return
  if (!payForm.value.amount || payForm.value.amount <= 0) {
    toast.error('Monto debe ser mayor a 0')
    return
  }
  savingPay.value = true
  try {
    await FoliosService.pay(payModal.value.folio.id, {
      amount: payForm.value.amount,
      method: payForm.value.method,
      reference: payForm.value.reference,
    })
    toast.success('Pago registrado')
    payModal.value.show = false
    const detail = await FoliosService.get(payModal.value.folio.id)
    const idx = folios.value.findIndex(f => f.id === detail.id)
    if (idx >= 0) folios.value[idx] = detail
  } catch (e: any) {
    toast.error(e.message || 'Error')
  } finally {
    savingPay.value = false
  }
}

function closeAndInvoice(f: Folio) {
  askConfirm({
    title: 'Cerrar folio',
    message: `¿Cerrar folio de ${f.guestName} y generar factura?`,
    confirmLabel: 'Cerrar y facturar', danger: false,
    run: async () => {
      closing.value = f.id
      try {
        await FoliosService.closeAndInvoice(f.id)
        folios.value = folios.value.filter(x => x.id !== f.id)
      } finally {
        closing.value = null
      }
    },
  })
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: CurrencyCode.USD, minimumFractionDigits: 2 }).format(n || 0)
}

// Subtítulo del modal: solo los datos que existen, sin "—" sueltos.
function folioSubtitle(f: Folio | null): string {
  if (!f) return ''
  const parts: string[] = []
  if (f.guestName) parts.push(f.guestName)
  if (f.roomNumber) parts.push(`Hab. ${f.roomNumber}`)
  return parts.length ? parts.join(' · ') : `Folio ${f.id.slice(0, 8)}`
}

function formatDate(d?: string | null): string {
  if (!d) return 'Sin fecha'
  return new Date(d.includes('T') ? d : d + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

function categoryLabel(c: string): string {
  const m: Record<string, string> = { room: 'Habitación', minibar: 'Minibar', restaurant: 'Restaurante', laundry: 'Lavandería', spa: 'SPA', service: 'Servicio', other: 'Otro' }
  return m[c] || c
}

onMounted(load)
</script>

<style scoped></style>
