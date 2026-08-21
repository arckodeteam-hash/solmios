<script setup lang="ts">
// pages/tesoreria/caja-chica.vue — Fondos fijos (caja chica) con custodio, tope y saldo persistido.
// v1 backend: sin dinero real, la reposición se completa a mano (request→completed, sin tocar banco).
import { ref, computed, onMounted } from 'vue'
import {
  CajaChicaService,
  type PettyCashFund, type PettyCashReplenishment,
} from '@/services/CajaChica.service'
import { TeamService, type TeamMember } from '@/services/Team.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { usePermissions } from '@/composables/usePermissions'

const toast = useToast()
const { can } = usePermissions()
// v1 reusa el permiso de treasury (submódulo treasury.petty-cash) — mismo gate que Bancos/Proveedores.
const createPerm = computed(() => can('treasury', 'create'))
const editPerm = computed(() => can('treasury', 'edit'))
const deletePerm = computed(() => can('treasury', 'delete'))

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => { toast.success('Fondo eliminado'); load() },
  onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudo eliminar'),
})

const loading = ref(true)
const saving = ref(false)
const funds = ref<PettyCashFund[]>([])
const team = ref<TeamMember[]>([])

const money = (n: number, currency?: string): string => `${currencySymbol(currency || 'USD')}${Number(n || 0).toFixed(2)}`
const custodianName = (id: string): string => team.value.find((t) => t.id === id)?.name || 'Sin asignar'

const activeFunds = computed(() => funds.value.filter((f) => f.active !== 0))
const totalBalance = computed(() => activeFunds.value.reduce((s, f) => s + Number(f.currentBalance || 0), 0))
const totalTarget = computed(() => activeFunds.value.reduce((s, f) => s + Number(f.targetAmount || 0), 0))
const custodianCount = computed(() => new Set(activeFunds.value.map((f) => f.custodianId)).size)

async function load() {
  loading.value = true
  try {
    const [f, t] = await Promise.all([
      CajaChicaService.listFunds(),
      TeamService.list().catch(() => ({ data: [] as TeamMember[], total: 0 })),
    ])
    funds.value = f.data
    team.value = t.data
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar la caja chica')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ─── Alta/edición de fondo ───
const fundModal = ref<{ mode: 'create' | 'edit'; fund: PettyCashFund | null } | null>(null)
const fundForm = ref<{ name: string; custodianId: string; targetAmount: number | string; currency: string; notes: string }>(
  { name: '', custodianId: '', targetAmount: '', currency: CurrencyCode.USD, notes: '' },
)

function newFund() {
  fundForm.value = { name: '', custodianId: '', targetAmount: '', currency: CurrencyCode.USD, notes: '' }
  fundModal.value = { mode: 'create', fund: null }
}
function editFund(f: PettyCashFund) {
  fundForm.value = { name: f.name, custodianId: f.custodianId, targetAmount: f.targetAmount, currency: f.currency || 'USD', notes: f.notes || '' }
  fundModal.value = { mode: 'edit', fund: f }
}
async function saveFund() {
  if (!fundForm.value.name.trim()) { toast.warning('El nombre es obligatorio'); return }
  if (!fundForm.value.custodianId) { toast.warning('Elegí un custodio'); return }
  const targetAmount = Number(fundForm.value.targetAmount)
  if (!(targetAmount > 0)) { toast.warning('El tope debe ser mayor a 0'); return }
  saving.value = true
  try {
    const payload = {
      name: fundForm.value.name.trim(), custodianId: fundForm.value.custodianId,
      targetAmount, currency: fundForm.value.currency, notes: fundForm.value.notes.trim() || undefined,
    }
    if (fundModal.value?.mode === 'edit' && fundModal.value.fund) {
      await CajaChicaService.updateFund(fundModal.value.fund.id, payload)
    } else {
      await CajaChicaService.createFund(payload)
    }
    toast.success('Guardado')
    fundModal.value = null
    await load()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
  } finally {
    saving.value = false
  }
}
function delFund(f: PettyCashFund) {
  askConfirm({
    title: 'Eliminar fondo', message: `¿Eliminar el fondo "${f.name}"?`,
    confirmLabel: 'Eliminar', danger: true,
    run: () => CajaChicaService.deleteFund(f.id),
  })
}

// ─── Reposición: v1 sin dinero real — solicitar y completar en el mismo paso ───
const replenishModal = ref<PettyCashFund | null>(null)
const replenishAmount = ref<number | string>('')
const replenishing = ref(false)

function openReplenish(f: PettyCashFund) {
  replenishModal.value = f
  replenishAmount.value = Math.max(Number(f.targetAmount) - Number(f.currentBalance), 0)
}
async function doReplenish() {
  if (!replenishModal.value) return
  const amount = Number(replenishAmount.value)
  if (!(amount > 0)) { toast.warning('El monto debe ser mayor a 0'); return }
  replenishing.value = true
  try {
    const req = await CajaChicaService.requestReplenishment({ fundId: replenishModal.value.id, amount })
    await CajaChicaService.completeReplenishment(req.id)
    toast.success('Fondo repuesto')
    replenishModal.value = null
    await load()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo reponer')
  } finally {
    replenishing.value = false
  }
}

// ─── Historial de reposiciones ───
const historyFund = ref<PettyCashFund | null>(null)
const history = ref<PettyCashReplenishment[]>([])
const loadingHistory = ref(false)
async function openHistory(f: PettyCashFund) {
  historyFund.value = f
  loadingHistory.value = true
  history.value = []
  try {
    history.value = (await CajaChicaService.listReplenishments(f.id)).data
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar el historial')
  } finally {
    loadingHistory.value = false
  }
}
const STATUS_LABELS: Record<string, string> = { requested: 'Solicitada', completed: 'Completada', cancelled: 'Cancelada' }
const fmtDate = (s?: string): string => s ? new Date(s).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
</script>

<template>
  <div class="space-y-6">
    <header class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-navy">Caja chica</h1>
        <p class="text-sm text-text-muted mt-0.5">Fondos fijos con custodio para gastos menores e imprevistos.</p>
      </div>
      <button v-if="createPerm" @click="newFund" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold hover:bg-navy/90">
        <span class="w-4 h-4" v-html="ICON_PLUS" /> Nuevo fondo
      </button>
    </header>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <KpiHeroCard label="Fondos activos" :value="activeFunds.length" icon="building" accent="blue" />
      <KpiHeroCard label="Saldo total" :value="totalBalance" icon="money" accent="green"
        :prefix="currencySymbol('USD')" :unit="`de ${money(totalTarget)} de tope`" />
      <KpiHeroCard label="Custodios" :value="custodianCount" icon="users" accent="purple" />
    </div>

    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>

    <SectionCard v-else title="Fondos" subtitle="Saldo persistido: baja al registrar un gasto, sube al reponer.">
      <EmptyState v-if="!funds.length" title="Sin fondos de caja chica"
        message="Creá un fondo con su custodio y tope para empezar a registrar gastos menores.">
        <template v-if="createPerm" #action>
          <button @click="newFund" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Nuevo fondo</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-sm tbl-head">
          <thead>
            <tr>
              <th class="py-2 pr-3 text-left">Fondo</th>
              <th class="py-2 px-3 text-left">Custodio</th>
              <th class="py-2 px-3 text-right">Saldo / Tope</th>
              <th class="py-2 pl-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="f in funds" :key="f.id" class="hover:bg-surface/50">
              <td class="py-2.5 pr-3">
                <div class="flex items-center gap-1.5">
                  <span class="font-bold text-navy">{{ f.name }}</span>
                  <span v-if="f.active === 0" class="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-muted font-bold">Inactivo</span>
                </div>
                <div v-if="f.notes" class="text-[11px] text-text-muted truncate max-w-[220px]">{{ f.notes }}</div>
              </td>
              <td class="py-2.5 px-3 text-text-secondary">{{ custodianName(f.custodianId) }}</td>
              <td class="py-2.5 px-3 text-right tabular-nums">
                <span :class="f.currentBalance < f.targetAmount * 0.2 ? 'text-coral font-black' : 'text-navy font-bold'">{{ money(f.currentBalance, f.currency) }}</span>
                <span class="text-text-muted"> / {{ money(f.targetAmount, f.currency) }}</span>
                <div class="mt-1 h-1.5 rounded-full bg-surface overflow-hidden w-32 ml-auto">
                  <div class="h-full rounded-full bg-teal" :style="{ width: `${Math.min(100, (f.currentBalance / (f.targetAmount || 1)) * 100)}%` }" />
                </div>
              </td>
              <td class="py-2.5 pl-3 text-right whitespace-nowrap">
                <button v-if="editPerm" @click="openReplenish(f)" class="text-xs font-bold text-teal hover:underline">Reponer</button>
                <button @click="openHistory(f)" class="ml-2 text-xs font-bold text-navy hover:underline">Historial</button>
                <button v-if="editPerm" @click="editFund(f)" class="ml-2 text-xs font-bold text-navy hover:underline">Editar</button>
                <button v-if="deletePerm" @click="delFund(f)" class="ml-2 text-xs font-bold text-coral hover:underline">Eliminar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Alta/edición de fondo -->
    <AppModal v-if="fundModal" :title="fundModal.mode === 'create' ? 'Nuevo fondo' : 'Editar fondo'" size="md" @close="fundModal = null">
      <div class="space-y-4">
        <div>
          <label for="tesoreria-caja-chica-nombre" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nombre</label>
          <input id="tesoreria-caja-chica-nombre" name="name" required aria-required="true" v-model="fundForm.name" type="text" placeholder="ej: Caja chica recepción"
            class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <div>
          <label for="tesoreria-caja-chica-custodio" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Custodio</label>
          <select id="tesoreria-caja-chica-custodio" name="custodianId" required aria-required="true" v-model="fundForm.custodianId" class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy">
            <option value="">Seleccionar…</option>
            <option v-for="m in team" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="tesoreria-caja-chica-tope-del-fondo" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Tope del fondo</label>
            <input id="tesoreria-caja-chica-tope-del-fondo" name="targetAmount" required aria-required="true" v-model.number="fundForm.targetAmount" type="number" min="0" step="0.01"
              class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="tesoreria-caja-chica-moneda" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Moneda</label>
            <input id="tesoreria-caja-chica-moneda" name="currency" v-model="fundForm.currency" type="text" maxlength="3"
              class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
        </div>
        <div>
          <label for="tesoreria-caja-chica-notas" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Notas</label>
          <textarea id="tesoreria-caja-chica-notas" name="notes" v-model="fundForm.notes" rows="2"
            class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy resize-none" />
        </div>
      </div>
      <template #footer>
        <button @click="fundModal = null" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy">Cancelar</button>
        <button @click="saveFund" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light disabled:opacity-50">
          {{ saving ? 'Guardando…' : 'Guardar' }}
        </button>
      </template>
    </AppModal>

    <!-- Reposición -->
    <AppModal v-if="replenishModal" title="Reponer fondo" :subtitle="replenishModal.name" size="sm" @close="replenishModal = null">
      <p class="text-xs text-text-muted mb-3">
        v1 no mueve dinero real: registrá la reposición cuando ya hayas repuesto el efectivo a mano.
      </p>
      <label for="tesoreria-caja-chica-monto-a-reponer" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Monto a reponer</label>
      <input id="tesoreria-caja-chica-monto-a-reponer" name="replenishAmount" required aria-required="true" v-model.number="replenishAmount" type="number" min="0" step="0.01"
        class="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
      <p class="text-[11px] text-text-muted mt-1.5">
        Saldo actual {{ money(replenishModal.currentBalance, replenishModal.currency) }} → quedará en
        {{ money(replenishModal.currentBalance + Number(replenishAmount || 0), replenishModal.currency) }} (tope {{ money(replenishModal.targetAmount, replenishModal.currency) }}).
      </p>
      <template #footer>
        <button @click="replenishModal = null" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy">Cancelar</button>
        <button @click="doReplenish" :disabled="replenishing" class="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal/80 disabled:opacity-50">
          {{ replenishing ? 'Reponiendo…' : 'Reponer' }}
        </button>
      </template>
    </AppModal>

    <!-- Historial de reposiciones -->
    <AppModal v-if="historyFund" :title="`Reposiciones — ${historyFund.name}`" size="lg" @close="historyFund = null">
      <div v-if="loadingHistory" class="py-10 text-center text-text-muted">Cargando…</div>
      <EmptyState v-else-if="!history.length" title="Sin reposiciones" message="Este fondo todavía no tiene reposiciones registradas." />
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-[11px] font-bold text-text-muted uppercase border-b border-border">
              <th class="py-2 pr-3">Fecha</th>
              <th class="py-2 px-3">Estado</th>
              <th class="py-2 px-3 text-right">Monto</th>
              <th class="py-2 pl-3">Nota</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="r in history" :key="r.id">
              <td class="py-2 pr-3 text-text-secondary whitespace-nowrap">{{ fmtDate(r.createdAt) }}</td>
              <td class="py-2 px-3">
                <span :class="['text-xs font-bold px-1.5 py-0.5 rounded', r.status === 'completed' ? 'bg-teal/10 text-teal' : r.status === 'cancelled' ? 'bg-coral/10 text-coral' : 'bg-gold/10 text-gold']">
                  {{ STATUS_LABELS[r.status] || r.status }}
                </span>
              </td>
              <td class="py-2 px-3 text-right tabular-nums font-bold text-navy">{{ money(r.amount, historyFund.currency) }}</td>
              <td class="py-2 pl-3 text-text-muted">{{ r.notes || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppModal>

    <ConfirmModal v-if="confirmModal" v-bind="confirmModal" :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>
