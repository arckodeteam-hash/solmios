<template>
  <div>
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Nómina Automatizada</h2>
        <p class="text-sm text-text-muted mt-0.5">Cálculo, liquidación, deducciones y recibos de pago</p>
      </div>
      <button @click="openNewRun" data-testid="payroll-new-run-btn" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>Nueva Liquidación
      </button>
    </div>

    <!-- KPIs — última liquidación -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Empleados" :value="lastRun?.employeeCount ?? 0" icon="users" accent="blue"
        :unit="lastRunLabel" />
      <KpiHeroCard label="Bruto Total" :value="lastRun?.totalGross ?? 0" icon="money" accent="teal"
        :prefix="currencyPrefix" :unit="lastRunLabel" />
      <KpiHeroCard label="Deducciones" :value="lastRun?.totalDeductions ?? 0" icon="checkout" accent="rose"
        :prefix="currencyPrefix" :unit="lastRunLabel" :progress="deductionsShare" />
      <KpiHeroCard label="Neto a Pagar" :value="lastRun?.totalNet ?? 0" icon="checkin" accent="amber"
        :prefix="currencyPrefix" :unit="lastRunLabel" />
    </div>

    <div class="flex gap-2 mb-6 flex-wrap">
      <button v-for="tab in tabs" :key="tab.value" @click="activeTab = tab.value"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
        <span class="w-4 h-4 shrink-0" v-html="tab.icon"></span>{{ tab.label }}
      </button>
    </div>

    <!-- Skeleton de carga -->
    <div v-if="loading" class="rounded-2xl border border-border bg-white p-5 shadow-(--shadow-card)">
      <div class="h-6 w-48 animate-pulse rounded bg-surface"></div>
      <div class="mt-4 space-y-3">
        <div v-for="i in 5" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
      </div>
    </div>

    <!-- Liquidaciones -->
    <SectionCard v-if="activeTab === 'runs' && !loading"
      title="Liquidaciones" :subtitle="`${runs.length} liquidación(es)`" body-class="p-0">
      <template #actions>
        <button @click="openNewRun"
          class="flex items-center gap-1.5 rounded-full bg-cyan px-4 py-2 text-[11px] font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
          <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_PLUS"></span>Nueva Liquidación
        </button>
      </template>

      <EmptyState v-if="runs.length === 0" :icon="ICON_WALLET"
        title="Todavía no hay liquidaciones"
        message="Creá la primera liquidación del período para calcular sueldos, deducciones y recibos.">
        <template #action>
          <button @click="openNewRun"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Nueva liquidación</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Período</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Rango</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Fecha de pago</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Neto</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id" data-testid="payroll-run-row" :data-run-id="run.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="text-sm font-black text-navy">{{ run.period }}</div>
                <div class="text-[11px] text-text-muted lg:hidden">{{ run.startDate }} → {{ run.endDate }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell whitespace-nowrap">
                {{ run.startDate }} → {{ run.endDate }}
                <div class="text-[11px] text-text-muted xl:hidden">Pago: {{ run.paymentDate }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden xl:table-cell whitespace-nowrap">{{ run.paymentDate }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="runStatusClass(run.status)">
                  {{ runStatusLabel(run.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <div class="text-sm font-extrabold text-navy tabular-nums">{{ money(run.totalNet) }}</div>
                <div v-if="run.employeeCount" class="text-[11px] text-text-muted tabular-nums">{{ run.employeeCount }} empleado(s)</div>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button v-if="run.status === 'draft'" @click="calculateRun(run)" data-testid="payroll-calculate-btn" title="Calcular"
                    class="grid h-8 w-8 place-items-center rounded-lg text-teal hover:bg-teal/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CALC"></span>
                  </button>
                  <button v-if="run.status === 'calculated'" @click="approveRun(run)" data-testid="payroll-approve-btn" title="Aprobar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-cyan hover:bg-cyan/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CHECK"></span>
                  </button>
                  <button v-if="run.status === 'approved'" @click="markAsPaid(run)" data-testid="payroll-pay-btn" title="Marcar pagada"
                    class="grid h-8 w-8 place-items-center rounded-lg text-teal hover:bg-teal/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_WALLET"></span>
                  </button>
                  <button v-if="run.status !== 'paid' && run.status !== 'cancelled'" @click="cancelRun(run)" title="Cancelar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_XCIRCLE"></span>
                  </button>
                  <button @click="viewDetails(run)" title="Ver detalle"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EYE"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Config -->
    <SectionCard v-if="activeTab === 'config' && !loading"
      title="Configuración de Nómina" subtitle="Frecuencia, recargos y tasas de deducción">
      <template #actions>
        <button @click="saveConfig"
          class="flex items-center gap-1.5 rounded-full bg-cyan px-4 py-2 text-[11px] font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
          <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_SAVE"></span>Guardar Configuración
        </button>
      </template>

      <div v-if="config" class="grid md:grid-cols-2 gap-4">
        <div>
          <label for="payroll-frecuencia-de-pago" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Frecuencia de pago</label>
          <select id="payroll-frecuencia-de-pago" name="paymentFrequency" v-model="config.paymentFrequency" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none cursor-pointer">
            <option value="weekly">Semanal</option>
            <option value="biweekly">Quincenal</option>
            <option value="monthly">Mensual</option>
          </select>
          <p class="mt-1 text-[10px] text-text-muted">Define cuánto del sueldo mensual se paga por liquidación (semanal ≈ ¼, quincenal ½, mensual completo).</p>
        </div>
        <div>
          <label for="payroll-dia-de-pago" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Día de Pago</label>
          <input id="payroll-dia-de-pago" name="paymentDay" v-model.number="config.paymentDay" type="number" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm tabular-nums focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="payroll-horas-extra-x" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Horas Extra (x)</label>
          <input id="payroll-horas-extra-x" name="overtimeMultiplier" v-model.number="config.overtimeMultiplier" type="number" step="0.1" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm tabular-nums focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="payroll-seguridad-social" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Seguridad Social (%)</label>
          <input id="payroll-seguridad-social" name="socialSecurityRate" v-model.number="config.socialSecurityRate" type="number" step="0.01" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm tabular-nums focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="payroll-seguro-salud" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Seguro Salud (%)</label>
          <input id="payroll-seguro-salud" name="healthInsuranceRate" v-model.number="config.healthInsuranceRate" type="number" step="0.01" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm tabular-nums focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="payroll-moneda" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Moneda</label>
          <input id="payroll-moneda" name="currency" v-model="config.currency" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
        </div>
      </div>
    </SectionCard>

    <!-- Conceptos -->
    <SectionCard v-if="activeTab === 'concepts' && !loading"
      title="Conceptos de Nómina" :subtitle="`${concepts.length} concepto(s)`" body-class="p-0">
      <template #actions>
        <button @click="openNewConcept"
          class="flex items-center gap-1.5 rounded-full bg-cyan px-4 py-2 text-[11px] font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
          <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_PLUS"></span>Nuevo
        </button>
      </template>

      <EmptyState v-if="concepts.length === 0" :icon="ICON_LIST"
        title="Sin conceptos configurados"
        message="Los conceptos definen percepciones, deducciones y aportes que se aplican al calcular la nómina.">
        <template #action>
          <button @click="openNewConcept"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Nuevo concepto</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Código</th>
              <th class="text-left px-4 py-3 text-[10px]">Nombre</th>
              <th class="text-left px-4 py-3 text-[10px]">Tipo</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Método</th>
              <th class="text-right px-4 py-3 text-[10px]">Valor</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in concepts" :key="c.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3 text-sm font-black text-navy whitespace-nowrap">{{ c.code }}</td>
              <td class="px-4 py-3">
                <div class="text-sm font-bold text-navy">{{ c.name }}</div>
                <div class="text-[11px] text-text-muted lg:hidden">{{ conceptMethodLabel(c.calculationMethod) }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="conceptTypeClass(c.type)">
                  {{ conceptTypeLabel(c.type) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">{{ conceptMethodLabel(c.calculationMethod) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <div class="text-sm font-extrabold text-navy tabular-nums">{{ c.value }}</div>
                <div v-if="c.formula" class="text-[11px] text-text-muted">{{ c.formula }}</div>
              </td>
              <td class="px-4 py-3 text-right">
                <span v-if="c.system" class="rounded-full bg-navy/10 px-2.5 py-1 text-[10px] font-extrabold uppercase text-text-secondary">Sistema</span>
                <button v-else @click="deleteConcept(c)" title="Eliminar concepto"
                  class="ml-auto grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
                  <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal: Nueva Liquidación -->
    <AppModal v-if="showNewRunModal" size="md" title="Nueva Liquidación"
      subtitle="Definí el período y la fecha de pago" @close="showNewRunModal = false">
      <div class="space-y-4">
        <div>
          <label for="payroll-periodo" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Período</label>
          <input id="payroll-periodo" name="period" v-model="newRunForm.period" type="month" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="payroll-fecha-inicio" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Fecha inicio</label>
            <input id="payroll-fecha-inicio" name="startDate" v-model="newRunForm.startDate" type="date" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
          </div>
          <div>
            <label for="payroll-fecha-fin" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Fecha fin</label>
            <input id="payroll-fecha-fin" name="endDate" v-model="newRunForm.endDate" type="date" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
          </div>
        </div>
        <div>
          <label for="payroll-fecha-de-pago" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Fecha de pago</label>
          <input id="payroll-fecha-de-pago" name="paymentDate" v-model="newRunForm.paymentDate" type="date" class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
        </div>
        <p v-if="newRunError" class="text-xs font-bold text-coral">{{ newRunError }}</p>
      </div>

      <template #footer>
        <button @click="showNewRunModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="createRun" :disabled="creatingRun"
          class="inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          <span class="h-4 w-4" v-html="ICON_PLUS"></span>
          {{ creatingRun ? 'Creando…' : 'Crear Liquidación' }}
        </button>
      </template>
    </AppModal>

    <PayrollDetailModal
      v-if="detailRun"
      :run="detailRun"
      :currency="payrollCurrency"
      @close="detailRun = null"
    />

    <ConfirmModal
      v-if="confirmDialog"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :confirm-label="confirmDialog.confirmLabel"
      :danger="confirmDialog.danger"
      :loading="confirmLoading"
      @confirm="runConfirm"
      @close="confirmDialog = null"
    />

    <CalculatePayrollModal
      v-if="calcRun"
      :run="calcRun"
      @close="calcRun = null"
      @calculated="onCalculated"
    />

    <FormModal
      v-if="conceptModal"
      title="Nuevo Concepto"
      :fields="conceptFields"
      :loading="savingConcept"
      submit-label="Crear Concepto"
      @close="conceptModal = false"
      @submit="createConcept"
    />
  </div>
</template>


<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { PayrollService, type PayrollRun, type PayrollConfig, type PayrollConcept } from '@/services/Payroll.service'
import CalculatePayrollModal from '@/components/features/CalculatePayrollModal.vue'
import PayrollDetailModal from '@/components/features/PayrollDetailModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth.store'
import { formatCurrency, currencySymbol } from '@/composables/useCurrency'

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5M21 12h-4a1.5 1.5 0 0 0 0 3h4v-3Z"/></svg>'
const ICON_SETTINGS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.752.43.992l1.005.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.216.456a1.125 1.125 0 0 1-1.37-.49l-1.296-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.752-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_LIST = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_CALC = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4.5" y="3" width="15" height="18" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M8 7.5h8M8 12h1.5m3.25 0h1.5m3.25 0h0M8 15.75h1.5m3.25 0h1.5m3.25 0h0M8 19.5h1.5m3.25 0h1.5m3.25 0h0"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
const ICON_XCIRCLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_EYE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 7.5h12M9.75 7.5v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5m-8.25 0 .75 11.25a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.25 7.5"/></svg>'
const ICON_SAVE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7.8c0-1.68 0-2.52.327-3.162a3 3 0 0 1 1.311-1.311C5.28 3 6.12 3 7.8 3h6.982c.478 0 .717 0 .942.055.2.049.39.129.564.237.197.122.367.292.706.632l2.082 2.082c.34.34.51.51.632.706.108.175.188.365.237.564.055.225.055.464.055.942V16.2c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C17.72 21 16.88 21 15.2 21H7.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C3 18.72 3 17.88 3 16.2V7.8Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21v-6.75a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 .75.75V21M7.5 3v3.75a.75.75 0 0 0 .75.75h6a.75.75 0 0 0 .75-.75V3"/></svg>'

const auth = useAuthStore()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))
const toast = useToast()
const activeTab = ref('runs')
const loading = ref(true)

const tabs = [
  { value: 'runs', label: 'Liquidaciones', icon: ICON_WALLET },
  { value: 'config', label: 'Configuración', icon: ICON_SETTINGS },
  { value: 'concepts', label: 'Conceptos', icon: ICON_LIST },
]

const runs = ref<PayrollRun[]>([])
const config = ref<PayrollConfig | null>(null)
const concepts = ref<PayrollConcept[]>([])

// Moneda de la nómina (configurable por hotel). Un único formateador para toda la vista y el modal
// de detalle: antes convivían `toLocaleString()` sin locale (que sigue el idioma del navegador) y
// otro con locale 'es' fijo, y el mismo monto se veía distinto según dónde se lo mirara.
const payrollCurrency = computed(() => config.value?.currency || 'DOP')
const money = (n: number) => formatCurrency(Number(n) || 0, payrollCurrency.value)
const currencyPrefix = computed(() => currencySymbol(payrollCurrency.value))

const calcRun = ref<PayrollRun | null>(null)
const detailRun = ref<PayrollRun | null>(null)
const showNewRunModal = ref(false)
const creatingRun = ref(false)
const newRunError = ref('')
const newRunForm = ref({ period: '', startDate: '', endDate: '', paymentDate: '' })

const lastRun = computed(() => runs.value[0])

// Línea de apoyo de los KPI: siempre dice de qué liquidación son los números.
const lastRunLabel = computed(() => (lastRun.value ? `Período ${lastRun.value.period}` : 'Sin liquidaciones aún'))
// Peso de las deducciones sobre el bruto (anillo del KPI).
const deductionsShare = computed(() => {
  const gross = lastRun.value?.totalGross ?? 0
  if (!gross) return null
  return Math.round(((lastRun.value?.totalDeductions ?? 0) / gross) * 100)
})

function runStatusClass(s: string) {
  return { draft: 'bg-navy/10 text-text-secondary', calculated: 'bg-blue/10 text-blue', approved: 'bg-gold/10 text-gold', paid: 'bg-teal/10 text-teal', cancelled: 'bg-coral/10 text-coral' }[s] ?? 'bg-navy/10 text-text-secondary'
}
function runStatusLabel(s: string) {
  return { draft: 'Borrador', calculated: 'Calculado', approved: 'Aprobado', paid: 'Pagado', cancelled: 'Cancelado' }[s] ?? s
}

function conceptTypeLabel(t: string) {
  return { earning: 'Percepción', deduction: 'Deducción', contribution: 'Aporte', tax: 'Impuesto' }[t] ?? t
}
function conceptTypeClass(t: string) {
  return { earning: 'bg-teal/10 text-teal', deduction: 'bg-coral/10 text-coral', contribution: 'bg-blue/10 text-blue', tax: 'bg-gold/10 text-gold' }[t] ?? 'bg-navy/10 text-text-secondary'
}
function conceptMethodLabel(m: string) {
  return { fixed: 'Monto fijo', percentage: 'Porcentaje', formula: 'Fórmula', hours_based: 'Por horas' }[m] ?? m
}

async function loadData() {
  loading.value = true
  try {
    const [r, c, cn] = await Promise.all([PayrollService.listRuns(hotelId.value), PayrollService.getConfig(hotelId.value), PayrollService.listConcepts(hotelId.value)])
    runs.value = r; config.value = c; concepts.value = cn
  } catch { toast.error('Error al cargar') }
  finally { loading.value = false }
}

onMounted(loadData)

function openNewRun() {
  const today = new Date()
  const period = today.toISOString().slice(0, 7)
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
  newRunForm.value = { period, startDate: `${period}-01`, endDate: monthEnd, paymentDate: today.toISOString().slice(0, 10) }
  newRunError.value = ''
  showNewRunModal.value = true
}

async function createRun() {
  const { period, startDate, endDate, paymentDate } = newRunForm.value
  if (!period || !startDate || !endDate || !paymentDate) { newRunError.value = 'Completá todos los campos'; return }
  creatingRun.value = true
  newRunError.value = ''
  try {
    await PayrollService.createRun(hotelId.value!, { period, startDate, endDate, paymentDate })
    toast.success('Liquidación creada')
    showNewRunModal.value = false
    loadData()
  } catch (e: unknown) {
    newRunError.value = e instanceof Error ? e.message : 'Error al crear la liquidación'
  } finally {
    creatingRun.value = false
  }
}

function calculateRun(run: PayrollRun) {
  calcRun.value = run
}

function onCalculated(result: { employeeCount: number; totalNet: number }) {
  toast.success(`Nómina calculada: ${result.employeeCount} empleados, ${money(result.totalNet)} neto`)
  calcRun.value = null
  loadData()
}

// Confirmaciones con modal propio (no el alert del navegador).
const confirmDialog = ref<{ title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> } | null>(null)
const confirmLoading = ref(false)

async function runConfirm() {
  if (!confirmDialog.value) return
  confirmLoading.value = true
  try { await confirmDialog.value.onConfirm() }
  finally { confirmLoading.value = false; confirmDialog.value = null }
}

function approveRun(run: PayrollRun) {
  confirmDialog.value = {
    title: 'Aprobar liquidación',
    message: `¿Aprobar la liquidación del período ${run.period} por ${money(run.totalNet)} neto? Se generan los recibos.`,
    confirmLabel: 'Aprobar',
    onConfirm: async () => {
      try { await PayrollService.approve(run.id); toast.success('Nómina aprobada — recibos generados'); loadData() }
      catch { toast.error('Error al aprobar') }
    },
  }
}

function markAsPaid(run: PayrollRun) {
  confirmDialog.value = {
    title: 'Marcar como pagada',
    message: `¿Marcar como pagada la liquidación del período ${run.period}? Se asienta el egreso en gastos.`,
    confirmLabel: 'Marcar pagada',
    onConfirm: async () => {
      try { await PayrollService.markAsPaid(run.id); toast.success('Pago registrado'); loadData() }
      catch { toast.error('Error') }
    },
  }
}

function cancelRun(run: PayrollRun) {
  confirmDialog.value = {
    title: 'Cancelar liquidación',
    message: `¿Cancelar la liquidación del período ${run.period}? Esta acción no se puede deshacer.`,
    confirmLabel: 'Sí, cancelar', danger: true,
    onConfirm: async () => {
      try { await PayrollService.cancel(run.id); toast.success('Liquidación cancelada'); loadData() }
      catch { toast.error('Error al cancelar') }
    },
  }
}

function viewDetails(run: PayrollRun) { detailRun.value = run }
async function saveConfig() { try { await PayrollService.updateConfig(hotelId.value!, config.value!); toast.success('Configuración guardada') } catch { toast.error('Error') } }

const conceptModal = ref(false)
const savingConcept = ref(false)
const conceptFields: FormField[] = [
  { key: 'code', label: 'Código', required: true, placeholder: 'OT, BONO…' },
  { key: 'name', label: 'Nombre', required: true, placeholder: 'Horas extra' },
  { key: 'type', label: 'Tipo', type: 'select', required: true, default: 'earning', options: [
    { value: 'earning', label: 'Percepción' }, { value: 'deduction', label: 'Deducción' },
    { value: 'contribution', label: 'Aporte' }, { value: 'tax', label: 'Impuesto' },
  ] },
  { key: 'calculationMethod', label: 'Cálculo', type: 'select', required: true, default: 'fixed', options: [
    { value: 'fixed', label: 'Monto fijo' }, { value: 'percentage', label: 'Porcentaje' },
    { value: 'formula', label: 'Fórmula' }, { value: 'hours_based', label: 'Por horas' },
  ] },
  { key: 'value', label: 'Valor', type: 'number', min: 0 },
]

function openNewConcept() { conceptModal.value = true }

async function createConcept(values: Record<string, string | number>) {
  savingConcept.value = true
  try {
    await PayrollService.createConcept(hotelId.value!, values as unknown as Partial<PayrollConcept>)
    toast.success('Concepto creado')
    conceptModal.value = false
    loadData()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al crear el concepto')
  } finally {
    savingConcept.value = false
  }
}

function deleteConcept(c: PayrollConcept) {
  confirmDialog.value = {
    title: 'Eliminar concepto', message: `¿Eliminar el concepto "${c.code}"?`, confirmLabel: 'Eliminar', danger: true,
    onConfirm: async () => { await PayrollService.deleteConcept(c.id); toast.success('Concepto eliminado'); loadData() },
  }
}
</script>
