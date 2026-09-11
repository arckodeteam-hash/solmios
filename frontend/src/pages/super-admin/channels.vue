<template>
  <div>
    <!-- Cuenta Channex de la plataforma: credenciales, webhook, properties y vencimiento del plan. -->
    <ChannexPlatformConfig class="mb-6" @loaded="cuenta = $event" />

    <!-- Bandeja de solicitudes: lo que los hoteles pidieron conectar. El alta de una OTA la hace
         una persona (contrato + credenciales de la OTA), así que esta tabla es el puesto de
         trabajo: quién pidió, a qué teléfono llamarlo y cuándo quedamos en hacerlo. -->
    <SectionCard title="Solicitudes de conexión" :subtitle="subtituloBandeja" body-class="p-0">
      <template #actions>
        <button v-for="f in FILTROS" :key="f.value" @click="cambiarFiltro(f.value)"
          class="px-3 py-1.5 rounded-full text-[11px] font-black transition-colors cursor-pointer border"
          :class="filtro === f.value
            ? 'bg-white text-navy border-white'
            : 'bg-white/10 text-white/80 border-white/15 hover:bg-white/20'">
          {{ f.label }}
          <span v-if="counts[f.value]" class="ml-1 tabular-nums opacity-70">{{ counts[f.value] }}</span>
        </button>
      </template>

      <!-- Carga: esqueleto, no "Cargando…" -->
      <div v-if="cargando" class="p-5 space-y-3">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded bg-surface"></div>
      </div>

      <!-- El error se dice y se puede reintentar, no se traga en un toast que ya se fue. -->
      <EmptyState v-else-if="error" icon="⚠️" title="No se pudieron cargar las solicitudes" :message="error">
        <template #action>
          <button @click="cargar" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white cursor-pointer">Reintentar</button>
        </template>
      </EmptyState>

      <EmptyState v-else-if="!requests.length && filtro === 'all'" icon="📡"
        title="Ningún hotel pidió conectar una OTA todavía"
        message="Cuando un hotel apriete “Solicitar Conexión” en su panel, el pedido aparece acá y les llega un aviso." />

      <EmptyState v-else-if="!requests.length" icon="✅"
        :title="`Nada en “${etiquetaFiltro}”`"
        message="No hay solicitudes en este corte. Probá con otro filtro para ver el resto.">
        <template #action>
          <button @click="cambiarFiltro('all')" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white cursor-pointer">Ver todas</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm tbl-head">
          <thead>
            <tr class="text-[11px]">
              <th class="text-left px-4 py-3">Hotel</th>
              <th class="text-left px-4 py-3">Canal</th>
              <th class="text-left px-4 py-3">Quién pidió</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Próxima acción</th>
              <th class="sticky right-0 z-10 bg-surface px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in requests" :key="r.id"
              class="group border-t border-border align-top transition-colors hover:bg-surface/60"
              :class="r.overdue ? 'border-l-4 border-l-coral' : ''">
              <td class="px-4 py-3">
                <div class="font-bold text-navy whitespace-nowrap">{{ r.hotelName || r.hotelId }}</div>
                <div v-if="r.hotelPhone" class="text-[11px] text-text-muted">{{ r.hotelPhone }}</div>
                <!-- Sin property no hay dónde crear el canal en Channex: se dice acá, no al final. -->
                <div v-if="!r.channexPropertyId" class="mt-1 inline-block rounded-md bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                  Sin property en Channex
                </div>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <div>{{ r.channelName || r.channel }}</div>
                <div class="text-[11px] text-text-muted">Pedido {{ fechaCorta(r.createdAt) }}</div>
              </td>
              <td class="px-4 py-3 text-text-secondary">
                <div v-if="r.requestedByName">{{ r.requestedByName }}</div>
                <div v-if="r.requestedByEmail" class="text-[11px] text-text-muted">{{ r.requestedByEmail }}</div>
                <div v-if="r.contactPhone" class="text-[11px] font-bold text-navy">{{ r.contactPhone }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-black" :class="badge(r.status)">
                  {{ r.statusLabel }}
                </span>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <div v-if="r.appointmentAt" :class="r.overdue ? 'text-coral font-bold' : 'text-navy'">
                  <!-- "Vencida" en su propia línea: metido delante de la fecha, a 1280px la celda
                       partía la hora en cuatro renglones. -->
                  <div v-if="r.overdue" class="text-[10px] font-black uppercase tracking-wide">Cita vencida</div>
                  {{ fechaHora(r.appointmentAt) }}
                  <div v-if="r.appointmentMedium" class="text-[11px] font-normal text-text-muted">
                    {{ medio(r.appointmentMedium) }}<span v-if="r.contactName"> · {{ r.contactName }}</span>
                  </div>
                </div>
                <button v-else-if="puedeAgendar(r)" @click="abrirAgenda(r)"
                  class="rounded-full border-2 border-navy px-3 py-1 text-[11px] font-black text-navy transition-colors hover:bg-navy hover:text-white cursor-pointer">
                  Agendar cita
                </button>
                <span v-else class="text-[11px] text-text-muted">{{ r.closedAt ? `Cerrada el ${fecha(r.closedAt)}` : 'Sin cita' }}</span>
                <div class="mt-0.5 text-[11px]" :class="r.assignedToName ? 'text-text-secondary' : 'text-text-muted'">
                  {{ r.assignedToName || 'Sin asignar' }}
                </div>
              </td>
              <td class="sticky right-0 z-10 bg-white px-4 py-3 text-right transition-colors group-hover:bg-surface">
                <button @click="abrirDetalle(r)"
                  class="rounded-full bg-navy px-3.5 py-1.5 text-[11px] font-black text-white transition-colors hover:bg-navy-light cursor-pointer whitespace-nowrap">
                  Abrir
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Los pasos del alta manual, en orden y con el enlace a donde se hace cada uno. Antes acá
         había un instructivo de cómo cargar la API key, que es lo único que NO se hace por caso. -->
    <SectionCard title="Cómo se da de alta un canal" subtitle="El alta de una OTA es manual: estos son los pasos, en orden"
      class="mt-6" body-class="p-4 sm:p-5">
      <ol class="space-y-3">
        <li v-for="(paso, i) in pasosAlta" :key="paso.titulo" class="flex gap-3">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy text-[11px] font-black text-white">{{ i + 1 }}</span>
          <div class="min-w-0">
            <div class="text-sm font-bold text-navy">{{ paso.titulo }}</div>
            <p class="text-sm text-text-secondary">{{ paso.detalle }}</p>
            <component :is="paso.externo ? 'a' : 'router-link'"
              v-bind="paso.externo ? { href: paso.link, target: '_blank', rel: 'noopener' } : { to: paso.link }"
              class="mt-1 inline-block text-[11px] font-black text-cyan underline decoration-dotted">
              {{ paso.cta }}{{ paso.externo ? ' ↗' : '' }}
            </component>
          </div>
        </li>
      </ol>
    </SectionCard>

    <!-- ── Detalle del caso ──────────────────────────────────────────────────────────────── -->
    <AppModal v-if="detalle" size="xl" :title="`${detalle.channelName || detalle.channel} · ${detalle.hotelName || detalle.hotelId}`"
      :subtitle="detalle.statusLabel" body-class="p-0" @close="detalle = null">
      <div class="grid lg:grid-cols-[1.1fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-border">
        <!-- Izquierda: lo que hace falta para el alta manual (REQ-CAN-05) -->
        <div class="p-5 space-y-5">
          <div v-if="detalle.overdue" class="rounded-xl border-2 border-coral/30 bg-coral/10 px-4 py-3 text-sm font-bold text-coral">
            La cita del {{ fechaHora(detalle.appointmentAt) }} ya pasó y el caso sigue esperando. Reprogramá o avanzá el estado.
          </div>

          <section v-if="detalle.message">
            <h4 class="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-text-muted">Mensaje del hotel</h4>
            <p class="whitespace-pre-line rounded-xl bg-surface px-4 py-3 text-sm text-text-secondary">{{ detalle.message }}</p>
          </section>

          <section>
            <h4 class="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-muted">Contacto</h4>
            <dl class="space-y-1.5 text-sm">
              <div v-for="d in datosContacto" :key="d.label" class="flex gap-2">
                <dt class="w-32 shrink-0 text-text-muted">{{ d.label }}</dt>
                <dd class="min-w-0 font-bold text-navy break-words">{{ d.value }}</dd>
              </div>
            </dl>
          </section>

          <section>
            <h4 class="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-muted">En Channex</h4>
            <p v-if="detalle.channexPropertyId" class="text-sm text-text-secondary">
              Property <span class="font-mono text-xs font-bold text-navy">{{ detalle.channexPropertyId }}</span>
              · {{ detalle.mappedRoomTypes }} tipo(s) de habitación mapeados
            </p>
            <p v-else class="text-sm font-bold text-gold">
              Sin property en Channex — el hotel debe Sincronizar primero desde su panel.
            </p>
            <a :href="detalle.channexUrl" target="_blank" rel="noopener"
              class="mt-2 inline-block rounded-full border-2 border-navy px-4 py-1.5 text-[11px] font-black text-navy transition-colors hover:bg-navy hover:text-white">
              Abrir en Channex ↗
            </a>
          </section>

          <!-- Acciones. El selector solo ofrece las transiciones que el backend acepta: ofrecer
               un estado que va a volver 409 es prometer algo que no se puede hacer. -->
          <section class="space-y-3 border-t border-border pt-4">
            <div class="flex flex-wrap items-center gap-2">
              <button v-if="puedeAgendar(detalle)" @click="abrirAgenda(detalle)"
                class="rounded-full bg-navy px-4 py-2 text-xs font-black text-white hover:bg-navy-light cursor-pointer">
                {{ detalle.appointmentAt ? 'Reprogramar cita' : 'Agendar cita' }}
              </button>
              <button v-for="s in avancesSimples" :key="s" @click="cambiarEstado(detalle!, s)" :disabled="guardando"
                class="rounded-full border-2 border-navy px-4 py-2 text-xs font-black text-navy transition-colors hover:bg-navy hover:text-white cursor-pointer disabled:opacity-50">
                {{ LABELS[s] }}
              </button>
              <button v-if="puedeRechazar" @click="rechazo = { id: detalle.id, motivo: '' }" :disabled="guardando"
                class="rounded-full border-2 border-coral px-4 py-2 text-xs font-black text-coral transition-colors hover:bg-coral hover:text-white cursor-pointer disabled:opacity-50">
                Rechazar
              </button>
              <!-- El canal propio no necesita credenciales de nadie: se conecta de un click. -->
              <button v-if="detalle.channel === 'solmios-open' && detalle.status !== 'connected'"
                @click="conectarPropio(detalle)" :disabled="conectando"
                class="rounded-full bg-teal px-4 py-2 text-xs font-black text-white hover:opacity-90 cursor-pointer disabled:opacity-50">
                {{ conectando ? 'Conectando…' : 'Conectar ahora' }}
              </button>
            </div>
            <p v-if="!avancesSimples.length && !puedeRechazar && !puedeAgendar(detalle)" class="text-xs text-text-muted">
              El caso está {{ detalle.statusLabel.toLowerCase() }}: no admite más cambios. Si hace falta retomarlo, el hotel lo pide de nuevo.
            </p>
            <p v-if="detalle.resolutionReason" class="rounded-xl bg-surface px-4 py-3 text-sm text-text-secondary">
              <span class="font-bold text-navy">Motivo del cierre:</span> {{ detalle.resolutionReason }}
            </p>
          </section>

          <section class="border-t border-border pt-4">
            <h4 class="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-muted">Nota interna</h4>
            <textarea id="nota-interna" name="notaInterna" aria-label="Nota interna" v-model="nota" rows="3" placeholder="Solo la vemos nosotros. Podés usar varias líneas."
              class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none"></textarea>
            <button @click="guardarNota" :disabled="guardando || nota === (detalle.notes || '')"
              class="mt-2 rounded-full bg-navy px-4 py-2 text-xs font-black text-white hover:bg-navy-light cursor-pointer disabled:opacity-40">
              Guardar nota
            </button>
          </section>
        </div>

        <!-- Derecha: el historial. Quién hizo qué y cuándo (REQ-CAN-04). -->
        <div class="p-5">
          <h4 class="mb-3 text-[10px] font-bold uppercase tracking-wide text-text-muted">Historial</h4>
          <p v-if="!actividades.length" class="text-sm text-text-muted">Todavía no hay movimientos registrados.</p>
          <ol v-else class="space-y-3">
            <li v-for="a in actividades" :key="a.id" class="border-l-2 border-border pl-3">
              <div class="text-sm font-bold text-navy">{{ describir(a) }}</div>
              <div class="text-[11px] text-text-muted">
                {{ fechaHora(a.createdAt) }}<span v-if="a.actorName"> · {{ a.actorName }}</span>
              </div>
              <p v-if="a.note" class="mt-1 whitespace-pre-line text-xs text-text-secondary">{{ a.note }}</p>
            </li>
          </ol>
        </div>
      </div>
    </AppModal>

    <!-- ── Agendar / reprogramar ─────────────────────────────────────────────────────────── -->
    <AppModal v-if="agenda" size="md" :title="agenda.reprograma ? 'Reprogramar la cita' : 'Agendar la cita'"
      subtitle="El hotel recibe un correo con la fecha, la hora y quién lo va a contactar" @close="agenda = null">
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="mb-1.5 block text-[10px] font-bold uppercase text-text-muted">Fecha</span>
            <input id="cita-fecha" name="citaFecha" v-model="agenda.fecha" type="date" :min="hoyIso"
              class="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm focus:border-navy focus:outline-none" />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-[10px] font-bold uppercase text-text-muted">Hora</span>
            <input id="cita-hora" name="citaHora" v-model="agenda.hora" type="time"
              class="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm focus:border-navy focus:outline-none" />
          </label>
        </div>
        <label class="block">
          <span class="mb-1.5 block text-[10px] font-bold uppercase text-text-muted">Medio</span>
          <select id="cita-medio" name="citaMedio" v-model="agenda.medium"
            class="w-full cursor-pointer rounded-xl border border-border bg-surface px-3 py-2.5 text-sm focus:border-navy focus:outline-none">
            <option v-for="m in MEDIOS" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1.5 block text-[10px] font-bold uppercase text-text-muted">Con quién hablamos</span>
          <input id="cita-contacto" name="citaContacto" v-model="agenda.contactName" placeholder="Nombre de la persona del hotel"
            class="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm focus:border-navy focus:outline-none" />
        </label>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1.5 block text-[10px] font-bold uppercase text-text-muted">Teléfono</span>
            <input id="cita-telefono" name="citaTelefono" v-model="agenda.contactPhone" placeholder="809-000-0000"
              class="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm focus:border-navy focus:outline-none" />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-[10px] font-bold uppercase text-text-muted">Correo (opcional)</span>
            <input id="cita-correo" name="citaCorreo" v-model="agenda.contactEmail" type="email" placeholder="Si no ponés, va al que pidió"
              class="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm focus:border-navy focus:outline-none" />
          </label>
        </div>
      </div>
      <template #footer>
        <button @click="agenda = null" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="confirmarAgenda" :disabled="guardando || !agendaCompleta"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light cursor-pointer disabled:opacity-40">
          {{ guardando ? 'Guardando…' : 'Confirmar y avisar al hotel' }}
        </button>
      </template>
    </AppModal>

    <!-- ── Rechazar: el motivo es obligatorio y viaja en el correo al hotel ───────────────── -->
    <AppModal v-if="rechazo" size="sm" title="Rechazar la solicitud"
      subtitle="El hotel recibe este motivo por correo" @close="rechazo = null">
      <textarea id="motivo-rechazo" name="motivoRechazo" aria-label="Motivo del rechazo" v-model="rechazo.motivo" rows="4" placeholder="Ej: el hotel todavía no tiene contrato firmado con Booking."
        class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none"></textarea>
      <template #footer>
        <button @click="rechazo = null" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="confirmarRechazo" :disabled="guardando || !rechazo.motivo.trim()"
          class="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 cursor-pointer disabled:opacity-40">
          Rechazar y avisar
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import ChannexPlatformConfig from '@/components/features/ChannexPlatformConfig.vue'
import type { ChannexStatus } from '@/services/Platform.service'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useToast } from '@/composables/useToast'
import { ChannelService, CHANNEL_REQUEST_CLASSES, CHANNEL_REQUEST_MEDIUM_LABELS, type ChannelRequestStatus } from '@/services/Channel.service'
import {
  ChannelRequestsAdminService, CHANNEL_REQUEST_ADMIN_LABELS as LABELS,
  CHANNEL_REQUEST_FILTERS as FILTROS, CHANNEL_REQUEST_MEDIUMS as MEDIOS,
  type AdminChannelRequest, type ChannelRequestActivity, type ChannelRequestFilter, type ChannelRequestMedium,
} from '@/services/ChannelRequest.service'

const toast = useToast()

/** Estado de la cuenta que emite la tarjeta de arriba: de ahí sale a qué dashboard enlazar. */
const cuenta = ref<ChannexStatus | null>(null)
const dashboard = computed(() => cuenta.value?.dashboardUrl || 'https://staging.channex.io')

const pasosAlta = computed(() => [
  {
    titulo: 'El hotel sincroniza su property',
    detalle: 'Desde su panel → Canales → Sincronizar. Sin property no hay dónde crear el canal, y la fila de la bandeja lo avisa.',
    link: '/admin/hoteles', cta: 'Ver hoteles', externo: false,
  },
  {
    titulo: 'Agendá la llamada con el hotel',
    detalle: 'Necesitás sus credenciales de la extranet de la OTA: eso no se resuelve por correo. La cita queda registrada y el hotel recibe el aviso.',
    link: '/admin/channels', cta: 'Bandeja de solicitudes', externo: false,
  },
  {
    titulo: 'Creá el canal en Channex',
    detalle: 'En el dashboard, sobre la property del hotel, con el contrato y las credenciales de la OTA.',
    link: dashboard.value, cta: 'Abrir dashboard de Channex', externo: true,
  },
  {
    titulo: 'Mapeá los rate plans',
    detalle: 'Cada tipo y tarifa nuestro contra el de la OTA. Un canal con 0 mapeos no publica nada aunque figure activo.',
    link: dashboard.value, cta: 'Mapeo en Channex', externo: true,
  },
  {
    titulo: 'Probá y cerrá el caso',
    detalle: 'Verificá que la disponibilidad llegue y que entre una reserva de prueba; después movés la solicitud a “Conectada”.',
    link: '/admin/channex-queue', cta: 'Cola de Channex', externo: false,
  },
])

const requests = ref<AdminChannelRequest[]>([])
const counts = ref<Record<string, number>>({})
const transiciones = ref<Record<string, ChannelRequestStatus[]>>({})
const filtro = ref<ChannelRequestFilter>('attention')
const cargando = ref(true)
const error = ref('')
const guardando = ref(false)
const conectando = ref(false)

const etiquetaFiltro = computed(() => FILTROS.find((f) => f.value === filtro.value)?.label ?? 'Todas')
const subtituloBandeja = computed(() => {
  const vencidas = counts.value.overdue ?? 0
  const sinAtender = counts.value.pending ?? 0
  if (!requests.value.length && !sinAtender && !vencidas) return 'Lo que los hoteles pidieron conectar'
  const partes = [`${sinAtender} sin atender`]
  if (vencidas) partes.push(`${vencidas} con la cita vencida`)
  return partes.join(' · ')
})

const badge = (s: ChannelRequestStatus) => CHANNEL_REQUEST_CLASSES[s] ?? 'bg-surface text-text-muted border-2 border-border'
const medio = (m?: string | null) => (m ? CHANNEL_REQUEST_MEDIUM_LABELS[m] ?? m : '')

const fecha = (iso?: string | null) => iso
  ? new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
  : ''
/** "10 sept 2026". La fila es angosta y el "de" del formato largo cuesta 30px de scroll. */
const fechaCorta = (iso?: string | null) => fecha(iso).replace(/ de /g, ' ')
const fechaHora = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : ''

/** Se puede agendar mientras el backend acepte la transición a `scheduled`. */
const puedeAgendar = (r: AdminChannelRequest) => (transiciones.value[r.status] ?? []).includes('scheduled')

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    const res = await ChannelRequestsAdminService.list(filtro.value)
    requests.value = res.requests ?? []
    counts.value = res.counts ?? {}
    transiciones.value = res.transitions ?? {}
  } catch (e) {
    error.value = mensaje(e, 'No se pudieron cargar las solicitudes')
  } finally {
    cargando.value = false
  }
}

function cambiarFiltro(f: ChannelRequestFilter) {
  filtro.value = f
  cargar()
}

/** El motivo real del servidor (un 409 explica POR QUÉ no se puede), no un texto genérico. */
function mensaje(e: unknown, fallback: string): string {
  const msg = (e as { message?: string })?.message
  return msg && msg !== 'Error' ? msg : fallback
}

// ── Detalle ────────────────────────────────────────────────────────────────────────────────
const detalle = ref<AdminChannelRequest | null>(null)
const actividades = ref<ChannelRequestActivity[]>([])
const nota = ref('')

const datosContacto = computed(() => {
  const r = detalle.value
  if (!r) return []
  // Los campos vacíos NO se pintan: una ficha llena de guiones no informa nada.
  return [
    { label: 'Pidió', value: r.requestedByName || '' },
    { label: 'Correo', value: r.requestedByEmail || '' },
    { label: 'Teléfono del pedido', value: r.contactPhone || '' },
    { label: 'Teléfono del hotel', value: r.hotelPhone },
    { label: 'Correo del hotel', value: r.hotelEmail },
    { label: 'Contacto de la cita', value: r.contactName || '' },
    { label: 'Responsable', value: r.assignedToName },
  ].filter((d) => !!d.value)
    .filter((d, i, todos) => todos.findIndex((o) => o.value === d.value) === i)
})

/** Los avances que NO necesitan un formulario aparte (agendar y rechazar tienen el suyo). */
const avancesSimples = computed<ChannelRequestStatus[]>(() => {
  const r = detalle.value
  if (!r) return []
  return (transiciones.value[r.status] ?? []).filter((s) => s !== 'scheduled' && s !== 'rejected')
})
const puedeRechazar = computed(() => (transiciones.value[detalle.value?.status ?? ''] ?? []).includes('rejected'))

async function abrirDetalle(r: AdminChannelRequest) {
  detalle.value = r
  nota.value = r.notes || ''
  actividades.value = []
  try {
    const full = await ChannelRequestsAdminService.get(r.id)
    detalle.value = full
    nota.value = full.notes || ''
    actividades.value = full.activities ?? []
  } catch (e) {
    toast.error(mensaje(e, 'No se pudo abrir la solicitud'))
  }
}

const KINDS: Record<string, string> = {
  created: 'El hotel pidió la conexión',
  status_changed: 'Cambio de estado',
  appointment_scheduled: 'Cita agendada',
  appointment_rescheduled: 'Cita reprogramada',
  note_added: 'Nota interna',
  notified_hotel: 'Aviso enviado al hotel',
  notified_admin: 'Aviso al equipo',
  reminder_sent: 'Recordatorio de la cita',
}

function describir(a: ChannelRequestActivity): string {
  if (a.kind === 'status_changed' && a.fromStatus && a.toStatus) {
    return `${LABELS[a.fromStatus as ChannelRequestStatus] ?? a.fromStatus} → ${LABELS[a.toStatus as ChannelRequestStatus] ?? a.toStatus}`
  }
  return KINDS[a.kind] ?? a.kind
}

/** Tras cualquier mutación: se recarga el caso abierto y la bandeja (los contadores cambian). */
async function refrescar(id: string) {
  await cargar()
  if (detalle.value?.id === id) await abrirDetalle({ ...detalle.value })
}

async function cambiarEstado(r: AdminChannelRequest, status: ChannelRequestStatus) {
  guardando.value = true
  try {
    await ChannelRequestsAdminService.update(r.id, { status })
    toast.success(`Solicitud en “${LABELS[status]}”`)
    await refrescar(r.id)
  } catch (e) {
    toast.error(mensaje(e, 'No se pudo cambiar el estado'))
  } finally {
    guardando.value = false
  }
}

async function guardarNota() {
  const r = detalle.value
  if (!r) return
  guardando.value = true
  try {
    await ChannelRequestsAdminService.addNote(r.id, nota.value)
    toast.success('Nota guardada')
    await refrescar(r.id)
  } catch (e) {
    toast.error(mensaje(e, 'No se pudo guardar la nota'))
  } finally {
    guardando.value = false
  }
}

// ── Agendar ────────────────────────────────────────────────────────────────────────────────
interface AgendaForm {
  id: string
  reprograma: boolean
  fecha: string
  hora: string
  medium: ChannelRequestMedium
  contactName: string
  contactPhone: string
  contactEmail: string
}
const agenda = ref<AgendaForm | null>(null)
const hoyIso = new Date().toISOString().slice(0, 10)

const agendaCompleta = computed(() => {
  const a = agenda.value
  return !!(a && a.fecha && a.hora && a.contactName.trim().length >= 2 && a.contactPhone.trim().length >= 5)
})

function abrirAgenda(r: AdminChannelRequest) {
  const cita = r.appointmentAt ? new Date(r.appointmentAt) : null
  agenda.value = {
    id: r.id,
    reprograma: !!r.appointmentAt,
    fecha: cita ? localDate(cita) : hoyIso,
    hora: cita ? localTime(cita) : '10:00',
    medium: (r.appointmentMedium as ChannelRequestMedium) || 'call',
    // Se precargan los datos que ya tenemos: el admin no debería tipear lo que el hotel ya dijo.
    contactName: r.contactName || r.requestedByName || '',
    contactPhone: r.contactPhone || r.hotelPhone || '',
    contactEmail: r.contactEmail || r.requestedByEmail || '',
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

async function confirmarAgenda() {
  const a = agenda.value
  if (!a || !agendaCompleta.value) return
  guardando.value = true
  try {
    // `new Date(fecha, hora)` local → ISO: la hora que el admin escribe es la del servidor/panel,
    // no UTC. Mandar `${fecha}T${hora}` crudo la interpretaría como UTC y correría la cita.
    const [y, m, d] = a.fecha.split('-').map(Number)
    const [hh, mm] = a.hora.split(':').map(Number)
    const at = new Date(y!, (m ?? 1) - 1, d!, hh ?? 0, mm ?? 0).toISOString()
    await ChannelRequestsAdminService.schedule(a.id, {
      at, medium: a.medium,
      contactName: a.contactName.trim(),
      contactPhone: a.contactPhone.trim(),
      contactEmail: a.contactEmail.trim() || undefined,
    })
    toast.success('Cita agendada. Le avisamos al hotel por correo.')
    agenda.value = null
    await refrescar(a.id)
  } catch (e) {
    toast.error(mensaje(e, 'No se pudo agendar la cita'))
  } finally {
    guardando.value = false
  }
}

// ── Rechazar ───────────────────────────────────────────────────────────────────────────────
const rechazo = ref<{ id: string; motivo: string } | null>(null)

async function confirmarRechazo() {
  const r = rechazo.value
  if (!r || !r.motivo.trim()) return
  guardando.value = true
  try {
    await ChannelRequestsAdminService.update(r.id, { status: 'rejected', resolutionReason: r.motivo.trim() })
    toast.success('Solicitud rechazada. Le avisamos al hotel con el motivo.')
    rechazo.value = null
    await refrescar(r.id)
  } catch (e) {
    toast.error(mensaje(e, 'No se pudo rechazar la solicitud'))
  } finally {
    guardando.value = false
  }
}

/**
 * Conecta el canal propio del hotel que lo pidió y deja la solicitud en "Conectada".
 * `?hotelId=` apunta al hotel de la solicitud: el endpoint es de admin y resuelve el tenant del
 * query solo para super_admin.
 */
async function conectarPropio(r: AdminChannelRequest) {
  conectando.value = true
  try {
    const res = await ChannelService.connectOpenChannelFor(r.hotelId)
    if (!res?.success) { toast.error(res?.message || 'Channex rechazó la conexión'); return }
    toast.success(res.message)
    // El estado se mueve por el mismo camino que el resto. Si desde el estado actual no se puede
    // cerrar el caso, se dice: dejar la fila diciendo "Conectada" saltándose la máquina de estados
    // es exactamente el agujero que este cambio vino a tapar.
    if ((transiciones.value[r.status] ?? []).includes('connected')) {
      await ChannelRequestsAdminService.update(r.id, { status: 'connected' })
    } else {
      toast.warning('El canal quedó conectado en Channex', `La solicitud sigue en “${r.statusLabel}”: cerrala cuando termines la gestión.`)
    }
    await refrescar(r.id)
  } catch (e) {
    toast.error(mensaje(e, 'No se pudo conectar el canal'))
  } finally {
    conectando.value = false
  }
}

onMounted(cargar)
</script>
