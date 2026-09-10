<template>
  <SectionCard title="Channel Manager (Channex)" subtitle="Cuenta única de la plataforma. Todos los hoteles sincronizan OTAs con estas credenciales.">
    <template #actions>
      <a v-if="channex.dashboardUrl" :href="channex.dashboardUrl" target="_blank" rel="noopener"
        class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-black text-white transition-colors hover:bg-white/20">
        Abrir dashboard ↗
      </a>
      <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black" :class="badge.cls">
        <span class="h-2 w-2 rounded-full" :class="badge.dot"></span>{{ badge.label }}
      </span>
    </template>

    <!-- ── Alertas: lo que corta la operación va arriba de todo ──────────────────────────────
         El plan de Channex venció el 2026-09-09 y ninguna pantalla lo decía: el síntoma que se
         ve es "no entran reservas", tres capas más abajo. -->
    <div v-if="alertaPlan" class="mb-4 rounded-xl border-2 px-4 py-3 text-sm font-bold"
      :class="alertaPlan.grave ? 'border-coral/40 bg-coral/10 text-coral' : 'border-gold/40 bg-gold/10 text-gold'">
      {{ alertaPlan.texto }}
    </div>
    <div v-if="channex.hasKey && !channex.webhook.registered" class="mb-4 rounded-xl border-2 border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
      <span class="font-bold">El webhook de reservas no está registrado en Channex.</span>
      Las reservas de las OTAs entran solo cuando pasa el cron, con retraso.
      <span v-if="channex.webhook.error" class="block text-[11px] opacity-80">Channex respondió: {{ channex.webhook.error }}</span>
    </div>

    <!-- ── Salud de la cuenta ───────────────────────────────────────────────────────────── -->
    <div v-if="channex.hasKey" class="mb-5 grid gap-3 sm:grid-cols-3">
      <div v-for="m in metricas" :key="m.label" class="rounded-2xl border border-border bg-surface px-4 py-3">
        <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ m.label }}</div>
        <div class="mt-0.5 text-lg font-black tabular-nums" :class="m.tone">{{ m.value }}</div>
        <div v-if="m.hint" class="text-[11px] text-text-muted">{{ m.hint }}</div>
      </div>
    </div>

    <!-- Properties sin dueño: ocupan lugar (y plata) en el plan y nadie las ve desde el panel. -->
    <div v-if="channex.properties.orphans.length" class="mb-5 rounded-2xl border border-border bg-surface px-4 py-3">
      <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">
        Properties sin hotel ({{ channex.properties.orphans.length }})
      </div>
      <ul class="mt-2 space-y-1 text-sm">
        <li v-for="o in channex.properties.orphans" :key="o.id" class="flex flex-wrap items-baseline gap-2">
          <span class="font-bold text-navy">{{ o.title || 'Sin título' }}</span>
          <a :href="`${channex.dashboardUrl}/properties/${o.id}`" target="_blank" rel="noopener"
            class="font-mono text-[11px] text-text-muted underline decoration-dotted hover:text-navy">{{ o.id }}</a>
        </li>
      </ul>
      <p class="mt-2 text-[11px] text-text-muted">
        Ningún hotel de la plataforma las referencia: suelen quedar de pruebas o de altas a medias.
      </p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div>
        <label class="mb-2 block text-[10px] font-bold uppercase text-text-muted">API Key de Channex</label>
        <input v-model="apiKey" type="password" autocomplete="new-password"
          :placeholder="channex.hasKey ? `Guardada (${channex.keyMasked}) — escribí para reemplazar` : 'Pegá tu user-api-key de Channex'"
          class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
      </div>
      <div>
        <label class="mb-2 block text-[10px] font-bold uppercase text-text-muted">Entorno</label>
        <select v-model="channex.environment" class="w-full cursor-pointer rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
          <option value="staging">Staging (modo prueba)</option>
          <option value="production">Producción (OTAs reales)</option>
        </select>
      </div>
      <div>
        <label class="mb-2 block text-[10px] font-bold uppercase text-text-muted">User ID de Channex</label>
        <input v-model="channex.channexUserId" type="text" placeholder="ID de usuario de nuestra cuenta Channex"
          class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
        <p class="mt-1 text-[11px] text-text-muted">El webhook lo usa para ignorar los eventos que generamos nosotros y quedarse solo con los de la OTA. Vaciar el campo no lo borra: para cambiarlo, escribí el nuevo id.</p>
      </div>
      <div>
        <label class="mb-2 block text-[10px] font-bold uppercase text-text-muted">Vence el plan de Channex</label>
        <input id="channex-plan-expira" name="channexPlanExpira" aria-label="Vencimiento del plan de Channex" v-model="channex.planExpiresAt" type="date"
          class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
        <p class="mt-1 text-[11px] text-text-muted">Channex no lo expone por API: se carga a mano. Cuando vence, deja de entrar el feed de reservas.</p>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button @click="save" :disabled="guardando" class="cursor-pointer rounded-xl bg-navy px-5 py-2.5 text-sm font-black text-white hover:bg-navy/90 disabled:opacity-50">
        {{ guardando ? 'Guardando…' : 'Guardar credenciales' }}
      </button>
      <button @click="test" :disabled="testing" class="cursor-pointer rounded-xl bg-surface px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface-dark disabled:opacity-50">
        {{ testing ? 'Probando…' : 'Probar conexión' }}
      </button>
      <span v-if="testResult" class="text-xs font-bold" :class="testResult.ok ? 'text-teal' : 'text-coral'">
        {{ testResult.ok ? '✓' : '✕' }} {{ testResult.msg }}
      </span>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { ChannexAdminService, type ChannexStatus } from '@/services/Platform.service'
import { useToast } from '@/composables/useToast'

/** A cuántos días del vencimiento la alerta se pone roja (espejo del backend). */
const DIAS_ALERTA_PLAN = 15

// La pantalla que envuelve esta tarjeta reusa el estado (el entorno decide a qué dashboard
// enlazan los pasos del alta manual): se emite en vez de que la página lo vuelva a pedir.
const emit = defineEmits<{ loaded: [ChannexStatus] }>()

const toast = useToast()
const channex = ref<ChannexStatus>({
  environment: 'staging', hasKey: false, keyMasked: '', channexUserId: '',
  dashboardUrl: '', webhook: { registered: false, callbackUrl: '' },
  properties: { inAccount: 0, hotelsWithProperty: 0, orphans: [] },
  planExpiresAt: '', planDaysLeft: null, planExpired: false,
})
const apiKey = ref('')   // solo se envía si el admin escribe algo (nunca se muestra la key guardada)
const testing = ref(false)
const guardando = ref(false)
const testResult = ref<{ ok: boolean; msg: string } | null>(null)

// Badge de estado en vivo: Sin configurar / Verificando / Conectado / Sin conexión.
const badge = computed(() => {
  if (!channex.value.hasKey) return { label: 'Sin configurar', cls: 'bg-gold/15 text-gold', dot: 'bg-gold' }
  if (testing.value) return { label: 'Verificando…', cls: 'bg-navy/10 text-navy', dot: 'bg-navy animate-pulse' }
  if (testResult.value?.ok) return { label: 'Conectado', cls: 'bg-teal/15 text-teal', dot: 'bg-teal' }
  if (testResult.value && !testResult.value.ok) return { label: 'Sin conexión', cls: 'bg-coral/15 text-coral', dot: 'bg-coral' }
  return { label: 'Configurada', cls: 'bg-teal/15 text-teal', dot: 'bg-teal' }
})

const fecha = (iso: string) => iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
  : ''

/** Rojo si venció o falta poco; nada si está lejos o si no se cargó la fecha. */
const alertaPlan = computed(() => {
  const dias = channex.value.planDaysLeft
  if (dias === null) return null
  const cuando = fecha(channex.value.planExpiresAt)
  if (dias < 0) return { grave: true, texto: `Plan de Channex vencido el ${cuando} — la ingesta de reservas puede estar cortada.` }
  if (dias === 0) return { grave: true, texto: `El plan de Channex vence hoy (${cuando}). Renovalo antes de que corte la ingesta de reservas.` }
  if (dias <= DIAS_ALERTA_PLAN) return { grave: true, texto: `El plan de Channex vence en ${dias} día(s), el ${cuando}.` }
  return null
})

const metricas = computed(() => {
  const p = channex.value.properties
  return [
    {
      label: 'Properties en la cuenta',
      value: p.error ? '—' : String(p.inAccount),
      hint: p.error ? p.error : `${p.hotelsWithProperty} usadas por hoteles`,
      tone: 'text-navy',
    },
    {
      label: 'Sin hotel',
      value: p.error ? '—' : String(p.orphans.length),
      hint: p.orphans.length ? 'Revisar y dar de baja' : 'Todo mapeado',
      tone: p.orphans.length ? 'text-gold' : 'text-teal',
    },
    {
      label: 'Webhook de reservas',
      value: channex.value.webhook.registered ? 'Registrado' : 'Sin registrar',
      hint: channex.value.webhook.registered ? 'Las reservas entran al instante' : 'Registralo en Canales → Cola de Channex',
      tone: channex.value.webhook.registered ? 'text-teal' : 'text-gold',
    },
  ]
})

async function load() {
  try {
    channex.value = await ChannexAdminService.status()
    emit('loaded', channex.value)
    if (channex.value.hasKey) test()   // auto-verifica al abrir: el estado se ve sin tocar nada
  } catch { /* sin permiso / no seteado */ }
}

async function save() {
  guardando.value = true
  try {
    channex.value = await ChannexAdminService.save({
      environment: channex.value.environment,
      apiKey: apiKey.value.trim() || undefined,
      channexUserId: channex.value.channexUserId?.trim() || undefined,
      // Se manda SIEMPRE (aunque vaya vacío): es el único campo que se puede borrar, porque es un
      // dato cargado a mano y una fecha equivocada dispara alarmas falsas.
      planExpiresAt: channex.value.planExpiresAt ?? '',
    })
    emit('loaded', channex.value)
    apiKey.value = ''
    testResult.value = null
    toast.success('Credenciales de Channex guardadas')
  } catch { toast.error('No se pudieron guardar las credenciales') } finally { guardando.value = false }
}

async function test() {
  testing.value = true
  testResult.value = null
  try {
    const r = await ChannexAdminService.test()
    testResult.value = { ok: r.success, msg: r.message }
  } catch (e) {
    testResult.value = { ok: false, msg: (e as { message?: string })?.message || 'Error al probar la conexión' }
  } finally { testing.value = false }
}

onMounted(load)
</script>
