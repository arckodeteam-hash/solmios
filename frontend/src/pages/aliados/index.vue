<template>
  <div>
    <div class="mb-6">
      <h2 class="text-xl font-black text-navy">Programa Aliados</h2>
      <p class="text-sm text-text-muted mt-0.5">Convertí tus referidos validados en comisión en dinero, en vez de meses gratis</p>
    </div>

    <!-- Qué es esta vista: la participación del HOTEL en el programa. La configuración
         global (tramos de comisión, pagos, todos los partners) vive en /admin/aliados,
         del lado de la plataforma. -->
    <div class="mb-6 p-4 bg-surface rounded-xl border border-border text-sm text-text-secondary">
      <span class="font-bold text-navy">Tu lugar en el programa:</span>
      acá ves si ya sos elegible, te convertís en Aliado y seguís tus comisiones y tu forma de cobro.
      Para compartir tu link y ver tus referidos, andá a
      <router-link to="/panel/referidos" class="text-cyan font-bold underline">Mis Referidos</router-link>.
    </div>

    <div v-if="loading" class="h-40 animate-pulse rounded-2xl bg-surface"></div>

    <template v-else>
      <!-- Todavía no es partner: mostrar elegibilidad -->
      <template v-if="!myPartner?.partner">
        <SectionCard title="¿Sos elegible?" subtitle="Se necesitan más de 5 referidos validados para convertirte en Aliado">
          <div v-if="eligibility" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-white rounded-2xl border border-border card-shadow p-5">
                <div class="text-2xl font-black text-navy">{{ eligibility.validatedCount }}</div>
                <div class="text-[11px] text-text-muted">referidos validados</div>
              </div>
              <div class="bg-white rounded-2xl border border-border card-shadow p-5">
                <div class="text-2xl font-black" :class="eligibility.isEligible ? 'text-teal' : 'text-text-muted'">
                  {{ eligibility.isEligible ? 'Sí' : 'Todavía no' }}
                </div>
                <div class="text-[11px] text-text-muted">elegible para Aliados</div>
              </div>
            </div>

            <div v-if="eligibility.isEligible" class="p-4 bg-teal/10 rounded-xl">
              <p class="text-sm text-navy font-bold mb-3">
                Cumplís el requisito. Al convertirte en Aliado empezás a cobrar comisión en dinero por cada nuevo referido
                validado, en vez de meses gratis de tu suscripción. Esta decisión es irreversible.
              </p>
              <button type="button" @click="handleConvert" :disabled="converting"
                class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50">
                {{ converting ? 'Convirtiendo...' : 'Convertirme en Aliado' }}
              </button>
            </div>
            <div v-else class="p-4 bg-surface rounded-xl">
              <p class="text-sm text-text-secondary">
                Te {{ referralsMissing === 1 ? 'falta' : 'faltan' }} <span class="font-black text-navy">{{ referralsMissing }}</span>
                {{ referralsMissing === 1 ? 'referido validado' : 'referidos validados' }} para ser elegible.
                Compartí tu link desde <router-link to="/panel/referidos" class="text-cyan font-bold underline">Mis Referidos</router-link>.
              </p>
            </div>
          </div>
        </SectionCard>
      </template>

      <!-- Ya es partner -->
      <template v-else>
        <div class="mb-6 flex items-center gap-3 flex-wrap">
          <span class="text-[11px] font-bold px-3 py-1.5 rounded-full" :class="typeBadgeClass(myPartner.partner.type)">
            {{ TYPE_LABELS[myPartner.partner.type] }}
          </span>
          <span class="text-[11px] font-bold px-3 py-1.5 rounded-full" :class="statusBadgeClass(myPartner.partner.status)">
            {{ STATUS_LABELS[myPartner.partner.status] }}
          </span>
          <span class="text-xs text-text-muted">
            Aliado desde {{ myPartner.partner.becamePartnerAt ? new Date(myPartner.partner.becamePartnerAt).toLocaleDateString('es-DO') : '—' }}
          </span>
        </div>

        <!-- KPIs -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white rounded-2xl border border-border card-shadow p-5">
            <div class="text-2xl font-black text-teal">{{ formatMoney(myPartner.totalEarned) }}</div>
            <div class="text-[11px] text-text-muted">cobrado hasta ahora</div>
          </div>
          <div class="bg-white rounded-2xl border border-border card-shadow p-5">
            <div class="text-2xl font-black text-warning">{{ formatMoney(myPartner.totalPending) }}</div>
            <div class="text-[11px] text-text-muted">pendiente de pago</div>
          </div>
          <div class="bg-white rounded-2xl border border-border card-shadow p-5">
            <div class="text-2xl font-black text-navy">{{ myPartner.commissions.length }}</div>
            <div class="text-[11px] text-text-muted">comisiones generadas</div>
          </div>
        </div>

        <!-- Modalidad de pago -->
        <SectionCard title="Modalidad de pago" subtitle="Cómo querés cobrar tus comisiones" class="mb-6">
          <div class="flex flex-col md:flex-row md:items-center gap-4">
            <select v-model="payoutModeDraft" @change="handlePayoutModeChange" :disabled="savingPayoutMode"
              class="px-4 py-2.5 bg-surface border border-border rounded-xl text-sm font-bold text-navy disabled:opacity-50">
              <option value="monthly">Mensual</option>
              <option v-if="myPartner.partner.type !== 'aliado_certificado'" value="one_time">Pago único</option>
            </select>
            <p v-if="myPartner.partner.type === 'aliado_certificado'" class="text-xs text-text-muted">
              Los Aliados Certificados cobran siempre en modalidad mensual.
            </p>
          </div>
        </SectionCard>

        <!-- Certificación -->
        <SectionCard v-if="myPartner.partner.type === 'aliado'" title="Certificación" subtitle="Subí tu % de comisión certificándote como partner técnico" class="mb-6">
          <p class="text-sm text-text-secondary mb-4">
            Un Aliado Certificado cobra 20% fijo por cada referido validado, sin depender de tramos por volumen.
          </p>
          <button type="button" @click="showCertModal = true" :disabled="certPending"
            class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50">
            {{ certPending ? 'Solicitud en revisión' : 'Solicitar certificación' }}
          </button>
        </SectionCard>

        <!-- Comisiones -->
        <SectionCard title="Mis comisiones">
          <EmptyState v-if="!myPartner.commissions.length" title="Todavía no tenés comisiones" message="Se generan cuando un referido tuyo llega a validado." />
          <div v-else class="overflow-x-auto">
            <table class="w-full tbl-head">
              <thead><tr class="border-b border-border">
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Hotel referido</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">%</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Modalidad</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
                <th class="text-right p-4 text-[10px] font-bold text-text-muted uppercase">Monto</th>
                <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Fecha</th>
              </tr></thead>
              <tbody>
                <tr v-for="c in myPartner.commissions" :key="c.id" class="border-b border-border last:border-0">
                  <td class="p-4 text-sm font-bold text-navy">{{ c.referredHotelName || c.referredHotelId }}</td>
                  <td class="p-4 text-sm">{{ c.percent }}%</td>
                  <td class="p-4 text-sm text-text-secondary">{{ PAYOUT_MODE_LABELS[c.payoutMode] }}</td>
                  <td class="p-4"><span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="commissionStatusClass(c.status)">{{ COMMISSION_STATUS_LABELS[c.status] }}</span></td>
                  <td class="p-4 text-sm text-right tabular-nums">{{ c.payoutAmount != null ? formatMoney(c.payoutAmount) : '—' }}</td>
                  <td class="p-4 text-sm text-text-muted">{{ new Date(c.validatedAt).toLocaleDateString('es-DO') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>

        <!-- #559: soporte a los hoteles referidos, exclusivo de Aliado Certificado -->
        <MyReferredHotels v-if="myPartner.partner.type === 'aliado_certificado'" class="mt-6" />
      </template>
    </template>

    <!-- Modal de certificación -->
    <AppModal v-if="showCertModal" size="md" title="Solicitar certificación" subtitle="Contanos tu experiencia técnica" @close="showCertModal = false">
      <form @submit.prevent="submitCertification" class="space-y-4">
        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">¿Tenés experiencia con páginas web?</label>
          <textarea v-model="certForm.webExperience" rows="2" required
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm"></textarea>
        </div>
        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">¿Programás o configurás sitios/sistemas?</label>
          <textarea v-model="certForm.techSkills" rows="2" required
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm"></textarea>
        </div>
        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Contanos tu experiencia relevante</label>
          <textarea v-model="certForm.background" rows="3" required
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm"></textarea>
        </div>
      </form>
      <template #footer>
        <button @click="showCertModal = false" class="px-5 py-2.5 border border-border rounded-xl text-sm font-bold text-text-secondary cursor-pointer">Cancelar</button>
        <button @click="submitCertification" :disabled="applyingCert" class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50">
          {{ applyingCert ? 'Enviando...' : 'Enviar solicitud' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import MyReferredHotels from '@/components/features/aliados/MyReferredHotels.vue'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth.store'
import {
  AliadosService,
  type EligibilityDTO, type MyPartnerDTO, type PartnerType, type PartnerStatus,
  type PayoutMode, type CommissionStatus,
} from '@/services/Aliados.service'

const toast = useToast()
const auth = useAuthStore()

const loading = ref(true)
const converting = ref(false)
const savingPayoutMode = ref(false)
const applyingCert = ref(false)
const showCertModal = ref(false)

const eligibility = ref<EligibilityDTO | null>(null)
const myPartner = ref<MyPartnerDTO | null>(null)
const payoutModeDraft = ref<PayoutMode>('monthly')
const certForm = ref({ webExperience: '', techSkills: '', background: '' })

// El backend no expone GET "mi solicitud de certificación" (solo apply/approve/reject del
// lado admin) — se infiere localmente: al aplicar con éxito, o si el POST devuelve 409 por
// solicitud ya pendiente, se marca acá. Fallback simple en localStorage por hotelId para que
// sobreviva un refresh (documentado, no hay endpoint mejor sin tocar backend).
const CERT_PENDING_KEY = () => `aliados_cert_pending_${auth.user?.hotelId ?? 'unknown'}`
const certPending = ref(false)

const TYPE_LABELS: Record<PartnerType, string> = { aliado: 'Aliado', aliado_certificado: 'Aliado Certificado' }
const STATUS_LABELS: Record<PartnerStatus, string> = { active: 'Activo', inactive: 'Inactivo' }
const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = { monthly: 'Mensual', one_time: 'Pago único' }
const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending_payout: 'Pendiente de pago', active: 'Activa', paid_out: 'Pagada', cancelled: 'Cancelada',
}

function typeBadgeClass(t: PartnerType): string {
  return t === 'aliado_certificado' ? 'bg-gold/10 text-gold' : 'bg-cyan/10 text-cyan'
}
function statusBadgeClass(s: PartnerStatus): string {
  return s === 'active' ? 'bg-teal/10 text-teal' : 'bg-danger/10 text-danger'
}
function commissionStatusClass(s: CommissionStatus): string {
  return {
    pending_payout: 'bg-warning/10 text-warning', active: 'bg-cyan/10 text-cyan',
    paid_out: 'bg-teal/10 text-teal', cancelled: 'bg-danger/10 text-danger',
  }[s]
}
function formatMoney(v: number): string {
  return `$${Number(v || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const referralsMissing = computed(() => {
  if (!eligibility.value) return 0
  // isEligible = validatedCount > 5 (backend/usecases/eligibility.ts)
  return Math.max(0, 6 - eligibility.value.validatedCount)
})

async function loadMe() {
  myPartner.value = await AliadosService.me()
  if (myPartner.value.partner) {
    payoutModeDraft.value = myPartner.value.partner.payoutMode
  } else {
    eligibility.value = await AliadosService.eligibility()
  }
  certPending.value = localStorage.getItem(CERT_PENDING_KEY()) === '1'
}

async function handleConvert() {
  if (!window.confirm('¿Convertir tu hotel en Aliado? Vas a empezar a cobrar comisión en dinero por tus referidos validados en vez de meses gratis. Esta decisión no se puede deshacer.')) return
  converting.value = true
  try {
    await AliadosService.convert()
    toast.success('¡Listo! Ahora sos Aliado')
    await loadMe()
  } catch (e: any) {
    toast.error(e.message || 'No se pudo completar la conversión')
  } finally {
    converting.value = false
  }
}

async function handlePayoutModeChange() {
  if (!myPartner.value?.partner) return
  savingPayoutMode.value = true
  try {
    const updated = await AliadosService.setPayoutMode(payoutModeDraft.value)
    myPartner.value.partner = updated
    toast.success('Modalidad de pago actualizada')
  } catch (e: any) {
    payoutModeDraft.value = myPartner.value.partner.payoutMode
    toast.error(e.message || 'No se pudo actualizar la modalidad de pago')
  } finally {
    savingPayoutMode.value = false
  }
}

async function submitCertification() {
  applyingCert.value = true
  try {
    await AliadosService.applyForCertification({
      webExperience: certForm.value.webExperience,
      techSkills: certForm.value.techSkills,
      background: certForm.value.background,
    })
    certPending.value = true
    localStorage.setItem(CERT_PENDING_KEY(), '1')
    toast.success('Solicitud enviada, la vamos a revisar')
    showCertModal.value = false
  } catch (e: any) {
    // 409: ya había una solicitud pendiente — igual reflejamos el estado real.
    if (e.status === 409) {
      certPending.value = true
      localStorage.setItem(CERT_PENDING_KEY(), '1')
      showCertModal.value = false
    }
    toast.error(e.message || 'No se pudo enviar la solicitud')
  } finally {
    applyingCert.value = false
  }
}

onMounted(async () => {
  try {
    await loadMe()
  } catch (e: any) {
    toast.error(e.message || 'No se pudo cargar el programa Aliados')
  } finally {
    loading.value = false
  }
})
</script>
