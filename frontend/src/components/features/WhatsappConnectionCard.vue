<template>
  <SectionCard title="WhatsApp Business" :subtitle="subtitulo">
    <template #actions>
      <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide"
        :class="badgeClass">
        <span class="h-2 w-2 rounded-full" :class="puntoClass"></span>{{ badgeLabel }}
      </span>
    </template>

    <!-- Carga -->
    <div v-if="cargando" class="space-y-3">
      <div class="h-4 w-2/3 animate-pulse rounded bg-surface"></div>
      <div class="h-10 w-full animate-pulse rounded bg-surface"></div>
    </div>

    <!-- Conectado -->
    <div v-else-if="conexion?.estado === 'connected'" class="space-y-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div v-if="conexion.displayPhoneNumber">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Número conectado</div>
          <div class="text-lg font-black tabular-nums text-navy">{{ conexion.displayPhoneNumber }}</div>
        </div>
        <div v-if="conexion.verifiedName">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Nombre que ve el huésped</div>
          <div class="text-sm font-bold text-navy">{{ conexion.verifiedName }}</div>
        </div>
        <div v-if="conexion.businessName">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Cuenta de Meta</div>
          <div class="text-sm text-text-secondary">{{ conexion.businessName }}</div>
        </div>
        <div v-if="conexion.qualityRating || conexion.messagingLimit">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Estado en Meta</div>
          <div class="flex flex-wrap items-center gap-2 pt-0.5">
            <span v-if="conexion.qualityRating" class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
              :class="calidadClass">Calidad {{ calidadLabel }}</span>
            <span v-if="limiteLabel" class="rounded-full bg-navy/5 px-2.5 py-1 text-[10px] font-bold text-navy">
              {{ limiteLabel }}
            </span>
          </div>
        </div>
      </div>

      <!-- El hotel sin verificar arranca con tope bajo. Decirlo evita que un "no se envió" se lea
           como una falla del PMS. -->
      <p v-if="conexion.accountReviewStatus && conexion.accountReviewStatus !== 'APPROVED'"
        class="rounded-xl bg-gold/10 px-4 py-3 text-[11px] text-navy">
        El negocio todavía no está verificado ante Meta. Hasta que lo verifiques, WhatsApp limita
        cuántas conversaciones podés iniciar por día.
      </p>

      <button @click="pedirBaja" :disabled="ocupado"
        class="rounded-full border border-border px-4 py-2 text-xs font-bold text-text-secondary transition-colors hover:border-coral hover:text-coral disabled:opacity-50 disabled:cursor-wait">
        {{ ocupado ? 'Desconectando…' : 'Desconectar' }}
      </button>
    </div>

    <!-- Vinculación vieja por QR -->
    <div v-else-if="conexion?.estado === 'legacy_baileys'" class="space-y-4">
      <div class="rounded-xl bg-gold/10 px-4 py-3">
        <div class="text-sm font-bold text-navy">Este hotel usa la conexión anterior</div>
        <p class="mt-1 text-[11px] leading-relaxed text-text-secondary">
          Está vinculado escaneando un código QR, que es una vía no oficial: WhatsApp puede cortarla
          sin aviso y no permite enviar plantillas ni medir entregas. Conviene pasar a la conexión
          oficial de Meta.
        </p>
      </div>
      <button @click="abrirAdvertencia" :disabled="ocupado"
        class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-navy-light disabled:opacity-50">
        Pasar a la conexión oficial
      </button>
    </div>

    <!-- Sin conectar / error -->
    <div v-else class="space-y-4">
      <p v-if="conexion?.connectionError" class="rounded-xl bg-coral/10 px-4 py-3 text-[11px] font-bold text-coral">
        {{ conexion.connectionError }}
      </p>
      <p class="text-sm text-text-secondary">
        Conectá el WhatsApp del hotel para escribirle a los huéspedes desde SOLMI OS y recibir sus
        respuestas acá.
      </p>
      <button @click="abrirAdvertencia" :disabled="ocupado"
        class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-navy-light disabled:opacity-50 disabled:cursor-wait">
        {{ ocupado ? 'Conectando…' : conexion?.estado === 'error' ? 'Reintentar conexión' : 'Conectar WhatsApp' }}
      </button>
    </div>
  </SectionCard>

  <!-- Advertencia previa: el hotel TIENE que saber que el número deja de andar en el celular.
       Si se entera después, perdió su WhatsApp sin haberlo elegido. -->
  <AppModal v-if="mostrarAdvertencia" size="md" title="Antes de conectar" subtitle="Leelo, no se puede deshacer solo"
    @close="mostrarAdvertencia = false">
    <div class="space-y-4">
      <div class="rounded-2xl bg-coral/10 px-4 py-4">
        <div class="text-sm font-bold text-navy">El número que conectes deja de funcionar en la app de WhatsApp</div>
        <p class="mt-1.5 text-[12px] leading-relaxed text-text-secondary">
          Al pasar a la API de Meta, ese número se muda a la nube: quien lo tenga en el celular va a
          dejar de recibir los mensajes ahí. Las conversaciones pasan a verse y responderse desde
          SOLMI OS.
        </p>
      </div>
      <div class="rounded-2xl border border-border px-4 py-4">
        <div class="text-sm font-bold text-navy">Si querés conservar tu WhatsApp de siempre</div>
        <p class="mt-1.5 text-[12px] leading-relaxed text-text-secondary">
          Usá un número nuevo para el hotel. En la ventana de Meta vas a poder registrar uno distinto
          del que usás a diario.
        </p>
      </div>
      <ul class="space-y-1.5 text-[12px] text-text-secondary">
        <li>· Vas a necesitar la cuenta de Facebook del negocio.</li>
        <li>· Meta te va a pedir verificar el número con un código por SMS.</li>
        <li>· No cierres la ventana hasta terminar: el permiso vence en segundos.</li>
      </ul>
    </div>
    <template #footer>
      <button @click="mostrarAdvertencia = false"
        class="text-[11px] font-bold text-text-secondary transition-colors hover:text-navy">Cancelar</button>
      <button @click="conectar"
        class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-navy-light">
        Entiendo, conectar WhatsApp
      </button>
    </template>
  </AppModal>

  <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
    :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
    @confirm="runConfirm" @close="confirmModal = null" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { AiReceptionistService } from '@/services/AiReceptionist.service'
import type { WhatsappConnection } from '@/services/AiReceptionist.service'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { abrirVentanaDeMeta } from '@/composables/useMetaSignup'

const toast = useToast()
const conexion = ref<WhatsappConnection | null>(null)
const cargando = ref(true)
const ocupado = ref(false)
const mostrarAdvertencia = ref(false)

const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => { toast.success('WhatsApp desconectado'); cargar() },
  onError: (e) => toast.error((e as any)?.message || 'No se pudo desconectar'),
})

const ESTADO_LABEL: Record<string, string> = {
  connected: 'Conectado', disconnected: 'Sin conectar', error: 'Con error', legacy_baileys: 'Conexión anterior',
}
const badgeLabel = computed(() => ESTADO_LABEL[conexion.value?.estado || 'disconnected'])
const badgeClass = computed(() => ({
  connected: 'bg-teal/10 text-teal',
  error: 'bg-coral/10 text-coral',
  legacy_baileys: 'bg-gold/10 text-gold',
  disconnected: 'bg-surface text-text-muted',
}[conexion.value?.estado || 'disconnected']))
const puntoClass = computed(() => ({
  connected: 'bg-teal', error: 'bg-coral', legacy_baileys: 'bg-gold', disconnected: 'bg-text-muted',
}[conexion.value?.estado || 'disconnected']))

const subtitulo = computed(() => conexion.value?.estado === 'connected'
  ? 'Los huéspedes te escriben acá y vos les respondés desde el panel'
  : 'Conectá el número del hotel para escribirle a los huéspedes por WhatsApp')

const CALIDAD: Record<string, { label: string; clase: string }> = {
  GREEN: { label: 'alta', clase: 'bg-teal/10 text-teal' },
  YELLOW: { label: 'media', clase: 'bg-gold/10 text-gold' },
  RED: { label: 'baja', clase: 'bg-coral/10 text-coral' },
}
const calidadLabel = computed(() => CALIDAD[conexion.value?.qualityRating || '']?.label || conexion.value?.qualityRating)
const calidadClass = computed(() => CALIDAD[conexion.value?.qualityRating || '']?.clase || 'bg-surface text-text-muted')

/** Meta informa el tope como TIER_250 / TIER_1K…; se traduce a algo legible. */
const limiteLabel = computed(() => {
  const t = conexion.value?.messagingLimit
  if (!t) return null
  const n = t.replace('TIER_', '').replace('K', '.000').replace('M', '.000.000')
  return t === 'TIER_UNLIMITED' ? 'Sin tope diario' : `Hasta ${n} conversaciones por día`
})

async function cargar() {
  cargando.value = true
  try {
    conexion.value = await AiReceptionistService.getWhatsappConnection()
  } catch {
    conexion.value = null
  } finally {
    cargando.value = false
  }
}

function abrirAdvertencia() { mostrarAdvertencia.value = true }

/**
 * Abre la ventana de Meta y manda al servidor el código que devuelve.
 * El código es de un solo uso y vive segundos: no se guarda ni se reintenta con el mismo.
 */
async function conectar() {
  mostrarAdvertencia.value = false
  ocupado.value = true
  try {
    const datos = await abrirVentanaDeMeta()
    if (!datos) { toast.error('Conexión cancelada', 'Se cerró la ventana de Meta antes de terminar'); return }
    conexion.value = await AiReceptionistService.connectWhatsapp(datos)
    toast.success('WhatsApp conectado', conexion.value?.displayPhoneNumber || undefined)
  } catch (e: any) {
    toast.error('No se pudo conectar', e?.message || 'Volvé a intentarlo')
    await cargar()
  } finally {
    ocupado.value = false
  }
}

function pedirBaja() {
  askConfirm({
    title: 'Desconectar WhatsApp',
    message: 'El hotel va a dejar de recibir y enviar mensajes desde SOLMI OS. Recuperar el número en la app del celular es un trámite que se hace del lado de Meta, no desde acá.',
    confirmLabel: 'Desconectar', danger: true,
    run: async () => { await AiReceptionistService.disconnectWhatsapp() },
  })
}

onMounted(cargar)
</script>
