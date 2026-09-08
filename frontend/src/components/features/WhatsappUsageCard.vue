<template>
  <SectionCard title="Consumo de WhatsApp" :subtitle="subtitulo">
    <template #actions>
      <button @click="sincronizar" :disabled="sincronizando"
        class="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/15 disabled:opacity-50">
        {{ sincronizando ? 'Actualizando…' : 'Actualizar' }}
      </button>
    </template>

    <div v-if="cargando" class="space-y-3">
      <div class="h-8 w-1/3 animate-pulse rounded bg-surface"></div>
      <div class="h-3 w-full animate-pulse rounded bg-surface"></div>
    </div>

    <div v-else-if="!consumo" class="text-sm text-text-muted">
      Todavía no hay datos de consumo. Aparecen cuando el hotel empieza a conversar por WhatsApp.
    </div>

    <div v-else class="space-y-5">
      <!-- Cifra y barra -->
      <div>
        <div class="flex flex-wrap items-end gap-2">
          <span class="text-3xl font-black tabular-nums text-navy">{{ consumo.conversaciones }}</span>
          <span class="pb-1 text-sm text-text-muted">
            conversaciones{{ consumo.cupo !== null ? ` de ${consumo.cupo}` : '' }} este mes
          </span>
        </div>

        <div v-if="consumo.cupo !== null" class="mt-3">
          <div class="h-2 w-full overflow-hidden rounded-full bg-surface">
            <div class="h-full rounded-full transition-all" :class="barraClase"
              :style="{ width: `${Math.min(100, Math.round((consumo.usoDelCupo ?? 0) * 100))}%` }"></div>
          </div>
          <p class="mt-1.5 text-[11px] text-text-muted">
            {{ Math.round((consumo.usoDelCupo ?? 0) * 100) }}% del cupo del plan
          </p>
        </div>
      </div>

      <!-- Aviso ANTES del corte, no después: el hotel tiene que poder reaccionar. -->
      <div v-if="consumo.agotado" class="rounded-2xl bg-coral/10 px-4 py-3">
        <div class="text-sm font-bold text-navy">Se agotó el cupo del mes</div>
        <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">
          Podés seguir respondiendo las conversaciones abiertas, pero no iniciar nuevas hasta el mes
          que viene o hasta ampliar el plan.
        </p>
      </div>
      <div v-else-if="consumo.cerca" class="rounded-2xl bg-gold/10 px-4 py-3">
        <div class="text-sm font-bold text-navy">Te queda poco cupo</div>
        <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">
          Llevás el {{ Math.round((consumo.usoDelCupo ?? 0) * 100) }}% de las conversaciones
          incluidas. Al llegar al tope vas a poder responder, pero no iniciar conversaciones nuevas.
        </p>
      </div>

      <!-- Desglose: el precio de Meta depende de la categoría, por eso se muestra separado -->
      <div v-if="consumo.porCategoria.length">
        <div class="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-muted">Por tipo</div>
        <div class="space-y-1.5">
          <div v-for="c in consumo.porCategoria" :key="c.category"
            class="flex items-center justify-between rounded-xl bg-surface px-3 py-2">
            <span class="text-xs font-bold text-navy">{{ etiquetaCategoria(c.category) }}</span>
            <span class="text-xs tabular-nums text-text-secondary">
              {{ c.conversations }}<span v-if="c.cost > 0" class="ml-2 font-bold text-navy">{{ moneda(c.cost) }}</span>
            </span>
          </div>
        </div>
      </div>

      <p class="text-[10px] leading-relaxed text-text-muted">
        Los números los informa Meta, que cobra por conversación de 24 horas y no por mensaje.
        <span v-if="consumo.ultimaSync">Última actualización: {{ cuando(consumo.ultimaSync) }}.</span>
      </p>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { AiReceptionistService } from '@/services/AiReceptionist.service'
import type { ConsumoWhatsapp } from '@/services/AiReceptionist.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const consumo = ref<ConsumoWhatsapp | null>(null)
const cargando = ref(true)
const sincronizando = ref(false)

const subtitulo = computed(() => consumo.value?.costo
  ? `${moneda(consumo.value.costo)} facturados por Meta este mes`
  : 'Lo que el hotel lleva conversado este mes')

const barraClase = computed(() => consumo.value?.agotado ? 'bg-coral' : consumo.value?.cerca ? 'bg-gold' : 'bg-teal')

/** Categorías de Meta. El nombre técnico no le dice nada a un recepcionista. */
const CATEGORIAS: Record<string, string> = {
  UTILITY: 'Avisos de la reserva',
  MARKETING: 'Promociones',
  AUTHENTICATION: 'Códigos de verificación',
  SERVICE: 'Respuestas al huésped',
}
const etiquetaCategoria = (c: string): string => CATEGORIAS[c] ?? c

function moneda(v: number): string {
  const m = consumo.value?.moneda || 'USD'
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency: m }).format(v)
  } catch {
    return `${v} ${m}`
  }
}

function cuando(iso: string): string {
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function cargar() {
  cargando.value = true
  try {
    consumo.value = await AiReceptionistService.consumoWhatsapp()
  } catch {
    consumo.value = null
  } finally {
    cargando.value = false
  }
}

/** Pide a Meta el número al día. El cron lo hace solo; esto es para no esperarlo. */
async function sincronizar() {
  sincronizando.value = true
  try {
    await AiReceptionistService.sincronizarConsumo()
    await cargar()
    toast.success('Consumo actualizado')
  } catch (e: any) {
    toast.error('No se pudo actualizar', e?.message || 'Revisá la conexión de WhatsApp')
  } finally {
    sincronizando.value = false
  }
}

onMounted(cargar)
</script>
