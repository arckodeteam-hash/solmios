<template>
  <div>
    <div class="mb-6">
      <h2 class="text-xl font-black text-navy">Mis referidos</h2>
      <p class="text-sm text-text-muted mt-0.5">Recomendá SOLMI OS a otro hotel y ganá meses gratis de tu suscripción</p>
    </div>

    <div v-if="loading" class="h-40 animate-pulse rounded-2xl bg-surface"></div>

    <template v-else-if="data">
      <!-- Link + código + QR -->
      <SectionCard title="Tu link para compartir">
        <div class="flex flex-col md:flex-row gap-6 items-start">
          <div class="bg-white rounded-2xl border border-border p-3 shrink-0">
            <QrcodeVue :value="data.shareLink" :size="160" level="M" render-as="svg" />
          </div>
          <div class="flex-1 min-w-0 space-y-3">
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Tu código</label>
              <div class="text-2xl font-black text-navy">{{ data.code }}</div>
            </div>
            <div>
              <label for="referidos-link" class="block text-[10px] font-bold text-text-muted uppercase mb-1">Link</label>
              <div class="flex items-center gap-2">
                <input id="referidos-link" readonly :value="data.shareLink" class="flex-1 px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text-secondary" />
                <button type="button" @click="copyLink" class="px-4 py-2.5 bg-navy text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-navy-light transition-colors">Copiar</button>
              </div>
            </div>
            <div class="flex gap-2">
              <button type="button" @click="shareWhatsapp" class="px-4 py-2 bg-[#25D366]/10 text-[#128C7E] rounded-lg text-xs font-bold cursor-pointer hover:bg-[#25D366]/20 transition-colors">WhatsApp</button>
              <button type="button" @click="shareEmail" class="px-4 py-2 bg-surface border border-border rounded-lg text-xs font-bold text-navy cursor-pointer hover:bg-surface-dark transition-colors">Email</button>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Progreso -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <div class="bg-white rounded-2xl border border-border card-shadow p-5">
          <div class="text-2xl font-black text-teal">{{ data.totalMonthsEarned }}</div>
          <div class="text-[11px] text-text-muted">meses gratis ganados</div>
        </div>
        <div class="bg-white rounded-2xl border border-border card-shadow p-5">
          <div class="text-2xl font-black text-navy">{{ data.referrals.length }}</div>
          <div class="text-[11px] text-text-muted">hoteles referidos</div>
        </div>
        <div class="bg-white rounded-2xl border border-border card-shadow p-5">
          <template v-if="data.referralsUntilNextTier">
            <div class="text-2xl font-black text-navy">{{ data.referralsUntilNextTier }}</div>
            <div class="text-[11px] text-text-muted">referidos más para sumar {{ data.nextTierMonths }} {{ data.nextTierMonths === 1 ? 'mes' : 'meses' }}</div>
          </template>
          <template v-else>
            <div class="text-2xl font-black text-navy">—</div>
            <div class="text-[11px] text-text-muted">sin próximo tramo configurado</div>
          </template>
        </div>
      </div>

      <!-- Mis referidos -->
      <SectionCard title="Mis referidos" class="mt-6">
        <EmptyState v-if="!data.referrals.length" title="Todavía no referiste a nadie" message="Compartí tu link para empezar a sumar meses gratis." />
        <div v-else class="overflow-x-auto">
          <table class="w-full tbl-head">
            <thead><tr class="border-b border-border">
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Hotel</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Desde</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in data.referrals" :key="r.id" class="border-b border-border last:border-0">
                <td class="p-4 text-sm font-bold text-navy">{{ r.referredHotelName }}</td>
                <td class="p-4"><span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="statusClass(r.status)">{{ STATUS_LABELS[r.status] }}</span></td>
                <td class="p-4 text-sm text-text-muted">{{ r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-DO') : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <!-- Mis créditos -->
      <SectionCard title="Mis créditos" class="mt-6">
        <EmptyState v-if="!data.credits.length" title="Todavía no ganaste créditos" message="Se generan cuando un referido cumple los meses de validación del programa." />
        <div v-else class="overflow-x-auto">
          <table class="w-full tbl-head">
            <thead><tr class="border-b border-border">
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Meses</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
              <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Ganado</th>
            </tr></thead>
            <tbody>
              <tr v-for="c in data.credits" :key="c.id" class="border-b border-border last:border-0">
                <td class="p-4 text-sm font-bold text-navy">{{ c.monthsGranted }}</td>
                <td class="p-4"><span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="creditStatusClass(c.status)">{{ CREDIT_LABELS[c.status] }}</span></td>
                <td class="p-4 text-sm text-text-muted">{{ new Date(c.earnedAt).toLocaleDateString('es-DO') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import QrcodeVue from 'qrcode.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useToast } from '@/composables/useToast'
import { ReferralsService, type MyReferrals, type ReferralStatus, type ReferralCreditStatus } from '@/services/Referrals.service'

const toast = useToast()
const loading = ref(true)
const data = ref<MyReferrals | null>(null)

const STATUS_LABELS: Record<ReferralStatus, string> = {
  trial: 'En prueba', active: 'Activo (pagando)', validated: 'Validado', churned: 'Se dio de baja',
}
const CREDIT_LABELS: Record<ReferralCreditStatus, string> = {
  pending: 'Pendiente', released: 'Aplicado', revoked: 'Revocado',
}
function statusClass(s: ReferralStatus): string {
  return { trial: 'bg-cyan/10 text-cyan', active: 'bg-warning/10 text-warning', validated: 'bg-teal/10 text-teal', churned: 'bg-danger/10 text-danger' }[s]
}
function creditStatusClass(s: ReferralCreditStatus): string {
  return { pending: 'bg-warning/10 text-warning', released: 'bg-teal/10 text-teal', revoked: 'bg-danger/10 text-danger' }[s]
}

async function copyLink() {
  if (!data.value) return
  try {
    await navigator.clipboard.writeText(data.value.shareLink)
    toast.success('Link copiado')
  } catch {
    toast.error('No se pudo copiar el link')
  }
}
function shareWhatsapp() {
  if (!data.value) return
  const text = `Te invito a probar SOLMI OS, el sistema que uso para gestionar mi hotel: ${data.value.shareLink}`
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`)
}
function shareEmail() {
  if (!data.value) return
  const subject = 'Te invito a probar SOLMI OS'
  const body = `Hola,\n\nTe quiero recomendar SOLMI OS, el sistema que uso para gestionar mi hotel. Registrate con mi link y arrancás con tu prueba gratis:\n${data.value.shareLink}\n\nSaludos`
  window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
}

onMounted(async () => {
  try {
    data.value = await ReferralsService.me()
  } catch (e: any) {
    toast.error(e.message || 'No se pudo cargar tu programa de referidos')
  } finally {
    loading.value = false
  }
})
</script>
