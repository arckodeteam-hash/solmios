<template>
  <div>
    <!-- Accesos directos: son navegación, no información. Van como barra, no como card. -->
    <div class="mb-5 flex flex-wrap items-center gap-2">
      <router-link
        v-for="a in quickActions" :key="a.to" :to="a.to"
        class="flex items-center gap-2 rounded-full border border-border bg-white px-3.5 py-2 text-xs font-bold text-navy transition-colors hover:border-cyan hover:text-cyan"
      >
        <Icon :name="a.icon" :size="14" />{{ a.label }}
      </router-link>
      <span class="ml-auto text-[11px] font-semibold text-text-muted">
        {{ loading ? 'Actualizando…' : `Actualizado ${horaActualizacion}` }}
      </span>
    </div>

    <!-- Error de carga: sin esto la pantalla mostraba ceros como si fueran datos reales. -->
    <div v-if="loadError" class="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-5 py-4">
      <Icon name="alert" :size="18" class="text-danger" />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-black text-navy">No se pudieron cargar las métricas de la plataforma</div>
        <div class="text-xs text-text-muted">{{ loadError }}</div>
      </div>
      <button class="rounded-full bg-navy px-4 py-2 text-xs font-bold text-white" @click="cargar">Reintentar</button>
    </div>

    <!-- ─── 1. El negocio de un vistazo ─────────────────────────────────────── -->
    <div v-if="loading" class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="i in 4" :key="i" class="h-[132px] animate-pulse rounded-[16px] border border-border bg-surface"></div>
    </div>
    <div v-else class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiHeroCard
        label="MRR" :value="ingresos.mrr" prefix="$" icon="money" accent="green"
        :unit="`ARR $${fmt(ingresos.arr)} · ARPU $${fmt(ingresos.arpu)}`"
        :sub-stats="[
          { label: 'Clientes pagando', value: ingresos.clientesPagos },
          { label: 'Con cobro automático', value: ingresos.conPagoConfigurado, tone: ingresos.conPagoConfigurado < ingresos.clientesPagos ? 'text-gold' : 'text-teal' },
        ]"
      />
      <KpiHeroCard
        label="Clientes" :value="clientes.activos" icon="building" accent="blue"
        :unit="`${clientes.total} hoteles en total${clientes.inactivos ? ` · ${clientes.inactivos} inactivos` : ''}`"
        :trend="clientes.altasMesAnterior || clientes.altasMes ? clientes.trendAltas : null" trend-label="vs mes anterior"
        :sub-stats="[
          { label: 'Altas este mes', value: clientes.altasMes },
          { label: 'Convierten a pago', value: clientes.conversion === null ? '—' : `${clientes.conversion}%`, tone: 'text-cyan' },
        ]"
      />
      <KpiHeroCard
        label="En prueba" :value="trials.activos" icon="users" accent="amber"
        :unit="`$${fmt(ingresos.mrrEnTrial)}/mes si convierten`"
        :sub-stats="[
          { label: 'Vencen en 7 días', value: trials.porVencer, tone: trials.porVencer ? 'text-gold' : 'text-navy' },
        ]"
      />
      <KpiHeroCard
        label="En riesgo" :value="riesgo.total" icon="money" accent="rose"
        :unit="`$${fmt(ingresos.mrrEnRiesgo)}/mes sin cobrar`"
        :sub-stats="[
          { label: 'Prueba vencida', value: riesgo.vencidos, tone: riesgo.vencidos ? 'text-danger' : 'text-navy' },
          { label: 'Cobro fallido', value: riesgo.cobrosFallidos, tone: riesgo.cobrosFallidos ? 'text-danger' : 'text-navy' },
        ]"
      />
    </div>

    <!-- ─── 2. Qué hay que hacer hoy + de dónde sale la plata ───────────────── -->
    <div class="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
      <SectionCard
        class="flex flex-col xl:col-span-2"
        title="Requiere acción"
        :subtitle="pipeline.length ? `${pipeline.length} cuentas · $${fmt(pipelineImporte)}/mes en juego` : 'Nada pendiente'"
        body-class="flex flex-1 flex-col p-0"
      >
        <template #actions>
          <router-link to="/admin/subscriptions" class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/20">
            Ver suscripciones
          </router-link>
        </template>

        <SkeletonLoader v-if="loading" variant="table" :rows="5" class="p-4" />
        <EmptyState
          v-else-if="!pipeline.length"
          class="flex-1"
          title="No hay nada pendiente"
          message="Ninguna prueba vencida, ningún cobro fallido y ningún hotel sin plan asignado."
        />
        <div v-else class="overflow-x-auto">
          <table class="tbl-head w-full min-w-[620px] text-sm">
            <thead>
              <tr class="border-b border-border uppercase text-text-muted">
                <th class="p-3 text-left">Hotel</th>
                <th class="p-3 text-left">Situación</th>
                <th class="hidden p-3 text-left sm:table-cell">Plan</th>
                <th class="p-3 text-right">En juego</th>
                <th class="p-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in pipelineVisible" :key="p.hotelId" class="border-b border-border/40 last:border-0 hover:bg-surface/60">
                <td class="p-3">
                  <div class="font-bold text-navy">{{ p.hotelName }}</div>
                  <div class="text-[11px] text-text-muted sm:hidden">{{ p.planName }}</div>
                </td>
                <td class="p-3">
                  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black" :class="MOTIVO[p.motivo].clase">
                    {{ MOTIVO[p.motivo].texto }}
                  </span>
                  <div class="mt-1 text-[11px] text-text-muted">{{ detalleUrgencia(p) }}</div>
                </td>
                <td class="hidden p-3 text-text-secondary sm:table-cell">{{ p.planName }}</td>
                <td class="p-3 text-right font-black tabular-nums" :class="p.planPrice ? 'text-navy' : 'text-text-muted'">
                  {{ p.planPrice ? `$${fmt(p.planPrice)}` : '—' }}
                </td>
                <td class="p-3 text-right">
                  <router-link
                    :to="`/admin/subscriptions?hotel=${p.hotelId}`"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-navy/10 hover:text-navy"
                    :aria-label="`Gestionar ${p.hotelName}`"
                  ><Icon name="edit" :size="15" /></router-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <router-link
          v-if="pipeline.length > PIPELINE_VISIBLE"
          to="/admin/subscriptions"
          class="block border-t border-border py-3 text-center text-[11px] font-bold text-cyan hover:underline"
        >Ver las {{ pipeline.length - PIPELINE_VISIBLE }} cuentas restantes →</router-link>
      </SectionCard>

      <SectionCard class="flex flex-col" body-class="flex flex-1 flex-col p-4 sm:p-5" title="Ingresos por plan" :subtitle="`$${fmt(ingresos.mrr)} de MRR cobrado`">
        <SkeletonLoader v-if="loading" variant="text" :rows="4" />
        <EmptyState v-else-if="!planMix.length" class="flex-1" title="Sin planes asignados" message="Ningún hotel tiene un plan del catálogo." />
        <div v-else class="flex flex-1 flex-col justify-between gap-4">
          <div v-for="p in planMix" :key="p.id">
            <div class="mb-1.5 flex items-baseline justify-between gap-2">
              <span class="text-sm font-bold text-navy">{{ p.name }}</span>
              <span class="text-sm font-black tabular-nums text-teal">${{ fmt(p.mrr) }}</span>
            </div>
            <!-- La barra mide MRR cobrado, no cantidad de hoteles: es lo que responde la card. -->
            <div class="h-2 w-full overflow-hidden rounded-full bg-surface">
              <div class="h-full rounded-full bg-teal transition-[width] duration-500" :style="{ width: `${anchoMrr(p.mrr)}%` }"></div>
            </div>
            <div class="mt-1 flex justify-between text-[10px] text-text-muted">
              <span>{{ p.pagos }} pagando<template v-if="p.trials"> · {{ p.trials }} en prueba</template></span>
              <span>${{ fmt(p.price) }}/mes c/u</span>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>

    <!-- ─── 3. Crecimiento y uso real del producto ──────────────────────────── -->
    <div class="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
      <SectionCard class="flex flex-col xl:col-span-2" body-class="flex flex-1 flex-col p-4 sm:p-5" title="Altas por mes" subtitle="Hoteles nuevos en los últimos 6 meses">
        <template #actions>
          <span class="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white">
            {{ totalAltas }} en el período
          </span>
        </template>
        <SkeletonLoader v-if="loading" variant="text" :rows="3" />
        <EmptyState v-else-if="!totalAltas" title="Sin altas en el período" message="No se dio de alta ningún hotel en los últimos 6 meses." />
        <div v-else class="flex flex-1 flex-col">
          <!-- `items-stretch` + `h-full` en la columna: con `items-end` la columna colapsaba a la
               altura de su texto y el `height:%` de la barra resolvía contra eso — las barras
               nunca se dibujaban y el gráfico salía vacío. `flex-1` + `min-h` deja que el gráfico
               use el alto que le sobra cuando la card vecina es más alta, en vez de dejar el
               vacío abajo. -->
          <div class="flex min-h-44 flex-1 items-stretch gap-2 sm:gap-3">
            <div v-for="(m, i) in serie" :key="i" class="group flex h-full flex-1 flex-col justify-end">
              <div class="mb-1 text-center text-[10px] font-black tabular-nums text-navy">{{ m.altas || '' }}</div>
              <div
                class="w-full rounded-t-lg bg-gradient-to-t from-navy to-cyan transition-opacity group-hover:opacity-80"
                :style="{ height: `${alturaBarra(m.altas)}%` }"
              ></div>
            </div>
          </div>
          <div class="mt-2 flex gap-2 sm:gap-3">
            <div v-for="(m, i) in serie" :key="i" class="flex-1 text-center text-[10px] font-semibold text-text-muted">{{ m.label }}</div>
          </div>
          <!-- Volumen: no es facturación de la plataforma, es la plata que mueven los hoteles.
               Va como línea secundaria porque mide USO del producto, no ingreso propio. -->
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
            <span class="text-text-secondary">Reservas procesadas por los hoteles (30 días)</span>
            <span class="font-black tabular-nums text-navy">
              ${{ fmt(uso.volumen30d) }}
              <span class="font-semibold text-text-muted">· {{ uso.reservas30d }} reservas</span>
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard class="flex flex-col" body-class="flex flex-1 flex-col p-4 sm:p-5" title="Sin actividad" :subtitle="sinUso.length ? `${sinUso.length} hoteles sin reservas hace 30+ días` : 'Todos los hoteles están operando'">
        <SkeletonLoader v-if="loading" variant="list" :rows="3" />
        <EmptyState v-else-if="!sinUso.length" class="flex-1" title="Todos operando" message="Todos los hoteles activos cargaron reservas en el último mes." />
        <div v-else class="space-y-2">
          <div v-for="h in sinUso.slice(0, 6)" :key="h.id" class="flex items-center gap-3 rounded-xl bg-surface p-3">
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold"><Icon name="alert" :size="15" /></span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-bold text-navy">{{ h.name }}</div>
              <div class="text-[10px] text-text-muted">{{ h.planName }}</div>
            </div>
            <span class="shrink-0 text-[11px] font-bold" :class="h.diasSinActividad === null ? 'text-danger' : 'text-gold'">
              {{ h.diasSinActividad === null ? 'Nunca usó' : `${h.diasSinActividad} d` }}
            </span>
          </div>
          <router-link v-if="sinUso.length > 6" to="/admin/hotels" class="block pt-1 text-center text-[11px] font-bold text-cyan hover:underline">
            Ver los {{ sinUso.length }} →
          </router-link>
        </div>
      </SectionCard>
    </div>

    <!-- ─── 4. Operación de la plataforma ───────────────────────────────────── -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <SectionCard class="flex flex-col" body-class="flex flex-1 flex-col p-4 sm:p-5" title="Soporte" :subtitle="`${soporte.abiertos + soporte.enProgreso} tickets sin cerrar`">
        <template #actions>
          <router-link to="/admin/support" class="text-[11px] font-bold text-cyan hover:underline">Ver todos →</router-link>
        </template>
        <SkeletonLoader v-if="loading" variant="text" :rows="4" />
        <div v-else class="flex flex-1 flex-col justify-between gap-3">
          <div v-for="s in soporteFilas" :key="s.label" class="flex flex-1 items-center justify-between rounded-xl bg-surface px-3.5">
            <span class="flex items-center gap-2 text-sm text-text-secondary">
              <span class="h-2 w-2 rounded-full" :class="s.punto"></span>{{ s.label }}
            </span>
            <span class="text-lg font-black tabular-nums" :class="s.valor ? s.tono : 'text-text-muted'">{{ s.valor }}</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard class="flex flex-col" body-class="flex flex-1 flex-col p-4 sm:p-5" title="Salud del sistema" :subtitle="sistemaOk ? 'Todo operativo' : 'Sin respuesta del backend'">
        <div class="flex flex-1 flex-col justify-between gap-3.5">
          <!-- El estado ya no es texto fijo: sale de si la consulta respondió. Antes decía
               "Operativo" incluso con el backend caído, porque estaba escrito en el HTML. -->
          <div class="flex items-center justify-between">
            <span class="text-sm text-text-secondary">Backend</span>
            <span class="flex items-center gap-1.5 text-sm font-bold" :class="sistemaOk ? 'text-teal' : 'text-danger'">
              <span class="h-2 w-2 rounded-full" :class="sistemaOk ? 'bg-teal' : 'bg-danger'"></span>
              {{ sistemaOk ? 'Operativo' : 'Sin respuesta' }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-text-secondary">Base de datos</span>
            <span class="text-sm font-bold" :class="sistemaOk ? 'text-teal' : 'text-danger'">{{ sistemaOk ? 'Conectada' : 'Sin verificar' }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-text-secondary">Uptime</span>
            <span class="text-sm font-bold tabular-nums text-navy">{{ uptimeLabel }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-text-secondary">Memoria (RSS)</span>
            <span class="text-sm font-bold tabular-nums text-navy">{{ fmt(memoriaMb) }} MB</span>
          </div>
          <div class="flex items-center justify-between border-t border-border pt-3">
            <span class="text-sm text-text-secondary">Hoteles usando el sistema</span>
            <span class="text-sm font-bold tabular-nums text-navy">{{ uso.hotelesConActividad }} / {{ clientes.activos }}</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Actividad reciente" subtitle="Últimos movimientos en la plataforma">
        <template #actions>
          <router-link to="/admin/audit" class="text-[11px] font-bold text-cyan hover:underline">Auditoría →</router-link>
        </template>
        <SkeletonLoader v-if="loading" variant="list" :rows="4" />
        <EmptyState v-else-if="!actividad.length" title="Sin actividad" message="Todavía no hay movimientos registrados." />
        <div v-else class="space-y-2.5">
          <div v-for="a in actividad" :key="a.id" class="flex items-start gap-3">
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full" :class="metaAccion(a.action).tinte">
              <Icon :name="metaAccion(a.action).icono" :size="14" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-bold capitalize text-navy">{{ a.action }}</div>
              <div v-if="descripcion(a)" class="truncate text-[10px] text-text-muted">{{ descripcion(a) }}</div>
            </div>
            <span class="shrink-0 whitespace-nowrap text-[10px] text-text-muted">{{ tiempoRelativo(a.createdAt) }}</span>
          </div>
        </div>
      </SectionCard>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Dashboard del super-admin — el panel del dueño de la PLATAFORMA.
 *
 * Responde, en orden de lectura: cuánta plata entra (MRR real), qué cuentas hay que atender hoy
 * (pruebas vencidas, cobros fallidos), de dónde sale ese ingreso (mix de planes), si el negocio
 * crece (altas por mes) y si el producto se usa (hoteles sin actividad).
 *
 * Lo que se sacó a propósito: ocupación, ADR y el P&L consolidado por hotel. Son métricas de la
 * operación HOTELERA — le sirven al hotelero, no al dueño del SaaS — y tienen su lugar en
 * `/admin/analytics`. Mezclarlas acá era lo que hacía que la pantalla no contestara ninguna
 * pregunta del negocio propio.
 */
import { ref, computed, onMounted } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import { SuperAdminService, type PlatformMetrics, type PipelineItem, type PlatformActivityItem } from '@/services/SuperAdmin.service'
import { PlatformService } from '@/services/Platform.service'

const SEGUNDOS_POR_DIA = 86_400
const SEGUNDOS_POR_HORA = 3_600

const metrics = ref<PlatformMetrics | null>(null)
const monitoring = ref<{ uptime?: number; memoria?: number } | null>(null)
const loading = ref(true)
const loadError = ref('')
const actualizadoEn = ref<Date | null>(null)

const quickActions = [
  { to: '/admin/hotels', icon: 'building', label: 'Hoteles' },
  { to: '/admin/subscriptions', icon: 'card', label: 'Suscripciones' },
  { to: '/admin/plans', icon: 'money', label: 'Planes' },
  { to: '/admin/announcements', icon: 'mail', label: 'Anuncios' },
  { to: '/admin/analytics', icon: 'chart', label: 'Reportes' },
]

// Valores neutros mientras carga: la pantalla nunca muestra un número inventado.
const VACIO: PlatformMetrics = {
  ingresos: { mrr: 0, arr: 0, arpu: 0, clientesPagos: 0, mrrEnTrial: 0, mrrEnRiesgo: 0, conPagoConfigurado: 0, trendMrr: null },
  clientes: { total: 0, activos: 0, inactivos: 0, altasMes: 0, altasMesAnterior: 0, trendAltas: 0, conversion: null },
  trials: { activos: 0, vencidos: 0, porVencer: 0 },
  riesgo: { total: 0, vencidos: 0, cobrosFallidos: 0, expirados: 0, cancelados: 0 },
  pipeline: [], planMix: [], sinUso: [], serie: [],
  uso: { volumen30d: 0, reservas30d: 0, hotelesConActividad: 0 },
  soporte: { urgentes: 0, abiertos: 0, enProgreso: 0, resueltos: 0 },
  actividad: [],
}

const m = computed<PlatformMetrics>(() => metrics.value ?? VACIO)
const ingresos = computed(() => m.value.ingresos)
const clientes = computed(() => m.value.clientes)
const trials = computed(() => m.value.trials)
const riesgo = computed(() => m.value.riesgo)
const pipeline = computed(() => m.value.pipeline)
const planMix = computed(() => m.value.planMix)
const sinUso = computed(() => m.value.sinUso)
const serie = computed(() => m.value.serie)
const uso = computed(() => m.value.uso)
const soporte = computed(() => m.value.soporte)
const actividad = computed(() => m.value.actividad)

function fmt(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString('en-US')
}

const pipelineImporte = computed(() => pipeline.value.reduce((s, p) => s + p.planPrice, 0))

/**
 * La tabla muestra solo lo más urgente. Sin tope, una plataforma con decenas de cuentas colgadas
 * estira esta card a miles de píxeles y deja la de al lado con un vacío enorme — que es
 * exactamente el desbalance que tenía el dashboard anterior. El resto se ve en Suscripciones.
 */
const PIPELINE_VISIBLE = 8
const pipelineVisible = computed(() => pipeline.value.slice(0, PIPELINE_VISIBLE))

const MOTIVO: Record<PipelineItem['motivo'], { texto: string; clase: string }> = {
  cobro_fallido: { texto: 'Cobro fallido', clase: 'bg-danger/10 text-danger' },
  vencido: { texto: 'Prueba vencida', clase: 'bg-danger/10 text-danger' },
  por_vencer: { texto: 'Vence pronto', clase: 'bg-gold/15 text-gold' },
  sin_plan: { texto: 'Sin plan', clase: 'bg-text-muted/15 text-text-secondary' },
}

function detalleUrgencia(p: PipelineItem): string {
  if (p.motivo === 'cobro_fallido') return p.tieneStripe ? 'Reintentar el cobro' : 'Sin método de pago'
  if (p.motivo === 'sin_plan') return 'Usa el sistema sin contrato'
  if (p.diasRestantes === null) return 'Sin fecha de vencimiento'
  if (p.diasRestantes < 0) return `Hace ${Math.abs(p.diasRestantes)} ${Math.abs(p.diasRestantes) === 1 ? 'día' : 'días'}`
  if (p.diasRestantes === 0) return 'Vence hoy'
  return `En ${p.diasRestantes} ${p.diasRestantes === 1 ? 'día' : 'días'}`
}

const maxMrrPlan = computed(() => Math.max(...planMix.value.map((p) => p.mrr), 1))
function anchoMrr(mrr: number): number {
  // Un plan cobrado siempre deja ver algo de barra; 0 cobrado es 0 barra.
  return mrr > 0 ? Math.max(4, Math.round((mrr / maxMrrPlan.value) * 100)) : 0
}

const totalAltas = computed(() => serie.value.reduce((s, x) => s + x.altas, 0))
const maxAltas = computed(() => Math.max(...serie.value.map((x) => x.altas), 1))
function alturaBarra(altas: number): number {
  return altas > 0 ? Math.max(6, Math.round((altas / maxAltas.value) * 100)) : 0
}

const soporteFilas = computed(() => [
  { label: 'Urgentes', valor: soporte.value.urgentes, punto: 'bg-danger', tono: 'text-danger' },
  { label: 'Abiertos', valor: soporte.value.abiertos, punto: 'bg-gold', tono: 'text-gold' },
  { label: 'En progreso', valor: soporte.value.enProgreso, punto: 'bg-cyan', tono: 'text-cyan' },
  { label: 'Resueltos', valor: soporte.value.resueltos, punto: 'bg-teal', tono: 'text-teal' },
])

const sistemaOk = computed(() => monitoring.value !== null)
const memoriaMb = computed(() => Number(monitoring.value?.memoria ?? 0))
const uptimeLabel = computed(() => {
  if (!monitoring.value) return '—'
  const s = Number(monitoring.value.uptime ?? 0)
  const d = Math.floor(s / SEGUNDOS_POR_DIA)
  const h = Math.floor((s % SEGUNDOS_POR_DIA) / SEGUNDOS_POR_HORA)
  const min = Math.floor((s % SEGUNDOS_POR_HORA) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${min}m`
  return `${min}m`
})

const horaActualizacion = computed(() =>
  actualizadoEn.value ? actualizadoEn.value.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—',
)

const ACCION_META: { patron: RegExp; icono: string; tinte: string }[] = [
  { patron: /login|auth|sesi/i, icono: 'login', tinte: 'bg-cyan/10 text-cyan' },
  { patron: /creat|crea|add|alta|nuev/i, icono: 'plus', tinte: 'bg-teal/10 text-teal' },
  { patron: /delet|elimin|remov|baja/i, icono: 'trash', tinte: 'bg-danger/10 text-danger' },
  { patron: /updat|edit|modif|cambio/i, icono: 'edit', tinte: 'bg-gold/10 text-gold' },
  { patron: /pago|payment|cobro|factur|invoice/i, icono: 'money', tinte: 'bg-teal/10 text-teal' },
]
function metaAccion(accion: string): { icono: string; tinte: string } {
  return ACCION_META.find((x) => x.patron.test(accion)) ?? { icono: 'bell', tinte: 'bg-navy/10 text-navy' }
}

/** Campos vacíos no se pintan: sin esto salían separadores sueltos tipo " · · ". */
function descripcion(a: PlatformActivityItem): string {
  return [a.userName, a.entity, a.detail].filter(Boolean).join(' · ')
}

function tiempoRelativo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!t || Number.isNaN(t)) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'recién'
  const min = Math.floor(s / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

async function cargar(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    metrics.value = await SuperAdminService.platformMetrics()
    actualizadoEn.value = new Date()
  } catch (e) {
    // El error se muestra en pantalla, no solo en un toast que se va: si no hay datos, la
    // pantalla tiene que decirlo en vez de dibujar ceros.
    loadError.value = e instanceof Error ? e.message : 'Error desconocido'
    metrics.value = null
  } finally {
    loading.value = false
  }
  // Monitoring aparte: si falla, la card de salud lo refleja en vez de decir "Operativo".
  try {
    monitoring.value = await PlatformService.monitoring()
  } catch {
    monitoring.value = null
  }
}

onMounted(cargar)
</script>

<style scoped></style>
