<template>
  <div>
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Notificaciones Push</h2>
        <p class="text-sm text-text-muted mt-0.5">Alta y baja de tokens de dispositivo para avisos push (chat, tareas)</p>
      </div>
    </div>

    <!-- Aviso de alcance -->
    <div class="rounded-[20px] border border-gold/30 bg-gold/5 p-4 mb-6 flex gap-3 items-start">
      <span class="w-5 h-5 text-gold shrink-0 mt-0.5" v-html="ICON_INFO"></span>
      <p class="text-xs text-navy/80">
        Los dispositivos se registran automáticamente desde la app móvil al iniciar sesión.
        Este panel lista los dispositivos de tu hotel y permite alta/baja manual para <strong>soporte</strong>.
      </p>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Dispositivos" :value="tokens.length" icon="bookings" accent="blue"
        :unit="`${uniqueUsers} usuario(s) con push`" />
      <KpiHeroCard label="Android" :value="androidCount" icon="users" accent="green"
        :unit="platformUnit(androidCount)" :progress="platformShare(androidCount)" />
      <KpiHeroCard label="iOS" :value="iosCount" icon="users" accent="purple"
        :unit="platformUnit(iosCount)" :progress="platformShare(iosCount)" />
      <KpiHeroCard label="Web" :value="webCount" icon="building" accent="teal"
        :unit="platformUnit(webCount)" :progress="platformShare(webCount)" />
    </div>

    <!-- Listado de dispositivos del hotel -->
    <SectionCard
      title="Dispositivos registrados"
      :subtitle="`${filteredTokens.length} de ${tokens.length} dispositivo(s)`"
      body-class="p-0"
    >
      <template #actions>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" v-html="ICON_SEARCH"></span>
          <input id="push-tokens-search-query" name="searchQuery" aria-label="Buscar token, plataforma o usuario"
            v-model="searchQuery"
            type="text"
            placeholder="Buscar token, plataforma o usuario..."
            class="w-full sm:w-64 pl-9 pr-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-cyan focus:bg-white/15 transition-colors"
          />
        </div>
        <button @click="loadTokens" :disabled="loading" title="Actualizar listado"
          class="grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors cursor-pointer disabled:opacity-50">
          <span class="h-4 w-4" :class="loading ? 'animate-spin' : ''" v-html="ICON_REFRESH"></span>
        </button>
        <button @click="openRegisterModal"
          class="px-4 py-2 rounded-full bg-cyan text-navy text-sm font-bold hover:shadow-lg transition-all cursor-pointer">
          Registrar
        </button>
      </template>

      <!-- Carga -->
      <div v-if="loading" class="p-4 space-y-2">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
      </div>

      <EmptyState
        v-else-if="!filteredTokens.length"
        :icon="ICON_DEVICE_EMPTY"
        :title="searchQuery ? 'Sin resultados' : 'No hay dispositivos registrados'"
        :message="searchQuery
          ? 'Probá con otro término de búsqueda.'
          : 'Los dispositivos aparecen acá cuando alguien inicia sesión en la app móvil. También podés dar de alta un token manualmente.'"
      >
        <template #action>
          <button v-if="searchQuery" @click="searchQuery = ''"
            class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Limpiar búsqueda
          </button>
          <button v-else @click="openRegisterModal"
            class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Registrar dispositivo
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Token</th>
              <th class="text-left px-4 py-3 text-[10px]">Plataforma</th>
              <th class="text-left px-4 py-3 text-[10px]">Usuario</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Registrado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in filteredTokens" :key="t.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="font-mono text-[11px] text-navy truncate max-w-[220px]" :title="t.token">{{ t.token }}</div>
                <div class="text-[11px] text-text-muted tabular-nums lg:hidden">{{ formatDate(t.createdAt) }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide"
                  :class="platformMeta(t.platform).class">
                  {{ platformMeta(t.platform).label }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy/10 text-[10px] font-black text-navy">
                    {{ initialsOf(t.userId) }}
                  </div>
                  <span class="text-sm font-bold text-navy truncate max-w-[160px]">{{ userNameOf(t.userId) }}</span>
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary tabular-nums hidden lg:table-cell">{{ formatDate(t.createdAt) }}</td>
              <td class="px-4 py-3 text-right">
                <button @click="unregisterToken(t.token)" title="Dar de baja"
                  class="grid h-8 w-8 ml-auto place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                  <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Historial de acciones de esta sesión -->
    <SectionCard v-if="activity.length" title="Actividad de esta sesión"
      :subtitle="`${activity.length} acción(es)`" class="mt-6">
      <ul class="space-y-2">
        <li v-for="(a, i) in activity" :key="i" class="flex items-center gap-2 text-xs">
          <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="a.ok ? 'bg-teal' : 'bg-coral'"></span>
          <span class="text-text-muted tabular-nums">{{ a.time }}</span>
          <span class="text-navy">{{ a.message }}</span>
        </li>
      </ul>
    </SectionCard>

    <!-- Registrar dispositivo -->
    <AppModal v-if="showRegisterModal" size="md" title="Registrar dispositivo"
      subtitle="Alta manual de un token de Firebase (ej. reportado por soporte)" @close="closeRegisterModal">
      <div class="space-y-3">
        <div>
          <label for="push-tokens-token-fcm" class="block text-[11px] font-bold text-navy uppercase mb-2">Token FCM *</label>
          <input id="push-tokens-token-fcm" name="token" v-model="registerForm.token" type="text" placeholder="Token del dispositivo" class="w-full px-4 py-2.5 rounded-full border border-border text-sm font-mono" />
        </div>
        <div>
          <label for="push-tokens-plataforma" class="block text-[11px] font-bold text-navy uppercase mb-2">Plataforma</label>
          <select id="push-tokens-plataforma" name="platform" v-model="registerForm.platform" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
            <option value="">Sin especificar</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
            <option value="web">Web</option>
          </select>
        </div>
      </div>
      <template #footer>
        <button @click="closeRegisterModal" class="px-5 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="register" :disabled="registering" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ registering ? 'Registrando...' : 'Registrar' }}
        </button>
      </template>
    </AppModal>

    <!-- Dar de baja por token -->
    <AppModal v-if="showUnregisterModal" size="md" title="Dar de baja dispositivo"
      subtitle="El backend solo borra el token si pertenece a tu usuario" @close="closeUnregisterModal">
      <div>
        <label for="push-tokens-token-fcm-2" class="block text-[11px] font-bold text-navy uppercase mb-2">Token FCM *</label>
        <input id="push-tokens-token-fcm-2" name="token" v-model="unregisterForm.token" type="text" placeholder="Token del dispositivo" class="w-full px-4 py-2.5 rounded-full border border-border text-sm font-mono" />
      </div>
      <template #footer>
        <button @click="closeUnregisterModal" class="px-5 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="unregister" :disabled="unregistering" class="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
          {{ unregistering ? 'Dando de baja...' : 'Dar de baja' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { PushTokensService } from '@/services/PushTokens.service'
import { TeamService, type TeamMember } from '@/services/Team.service'
import type { PushToken } from '@/types'
import { useToast } from '@/composables/useToast'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const SVG_OPEN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
const ICON_INFO = `${SVG_OPEN}<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`
const ICON_SEARCH = `${SVG_OPEN}<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`
const ICON_REFRESH = `${SVG_OPEN}<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`
const ICON_TRASH = `${SVG_OPEN}<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`
const ICON_DEVICE_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>'

const toast = useToast()

const registerForm = ref({ token: '', platform: '' })
const unregisterForm = ref({ token: '' })
const registering = ref(false)
const unregistering = ref(false)

const showRegisterModal = ref(false)
const showUnregisterModal = ref(false)

interface ActivityEntry { time: string; message: string; ok: boolean }
const activity = ref<ActivityEntry[]>([])

const tokens = ref<PushToken[]>([])
const loading = ref(false)
const searchQuery = ref('')

// Los nombres del personal se resuelven SIEMPRE contra /api/usuarios (TeamService),
// nunca contra employee-profiles: los ids de RRHH no matchean con users.id.
const userNames = ref<Record<string, string>>({})

function openRegisterModal() {
  showRegisterModal.value = true
}
function closeRegisterModal() {
  showRegisterModal.value = false
}
function closeUnregisterModal() {
  showUnregisterModal.value = false
}

const PLATFORM_META: Record<string, { label: string; class: string }> = {
  android: { label: 'Android', class: 'bg-teal/10 text-teal' },
  ios: { label: 'iOS', class: 'bg-navy/10 text-navy' },
  web: { label: 'Web', class: 'bg-cyan/10 text-cyan' },
}

function platformMeta(platform: string | null) {
  const key = (platform || '').toLowerCase()
  return PLATFORM_META[key] || { label: 'Sin especificar', class: 'bg-gold/10 text-gold' }
}

function countPlatform(platform: string) {
  return tokens.value.filter(t => (t.platform || '').toLowerCase() === platform).length
}

const androidCount = computed(() => countPlatform('android'))
const iosCount = computed(() => countPlatform('ios'))
const webCount = computed(() => countPlatform('web'))
const uniqueUsers = computed(() => new Set(tokens.value.map(t => t.userId)).size)

function platformShare(count: number) {
  if (!tokens.value.length) return 0
  return Math.round((count / tokens.value.length) * 100)
}
function platformUnit(count: number) {
  return `${platformShare(count)}% del total`
}

function userNameOf(userId: string) {
  return userNames.value[userId] || 'Sin usuario'
}

function initialsOf(userId: string) {
  const name = userNames.value[userId]
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

function formatDate(value: string) {
  return new Date(value).toLocaleString()
}

const filteredTokens = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return tokens.value
  return tokens.value.filter(t =>
    t.token.toLowerCase().includes(q) ||
    platformMeta(t.platform).label.toLowerCase().includes(q) ||
    userNameOf(t.userId).toLowerCase().includes(q)
  )
})

async function loadUserNames() {
  try {
    const res = await TeamService.list()
    const map: Record<string, string> = {}
    for (const m of (res.data || []) as TeamMember[]) map[m.id] = m.name
    userNames.value = map
  } catch {
    // Sin el directorio de usuarios la tabla sigue siendo útil: cae a "Sin usuario".
  }
}

async function loadTokens() {
  loading.value = true
  try {
    tokens.value = await PushTokensService.list()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error al cargar dispositivos'
    toast.error(message)
  } finally {
    loading.value = false
  }
}

async function unregisterToken(token: string) {
  try {
    await PushTokensService.unregister(token)
    toast.success('Dispositivo dado de baja')
    logActivity(`Dado de baja: ${token.slice(0, 16)}…`, true)
    await loadTokens()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error al dar de baja'
    toast.error(message)
    logActivity(`Error al dar de baja: ${message}`, false)
  }
}

onMounted(() => {
  loadTokens()
  loadUserNames()
})

function logActivity(message: string, ok: boolean) {
  activity.value.unshift({ time: new Date().toLocaleTimeString(), message, ok })
}

async function register() {
  if (!registerForm.value.token.trim()) {
    toast.error('El token es obligatorio')
    return
  }
  registering.value = true
  try {
    await PushTokensService.register({
      token: registerForm.value.token.trim(),
      platform: registerForm.value.platform || undefined,
    })
    toast.success('Dispositivo registrado')
    logActivity(`Registrado: ${registerForm.value.token.trim().slice(0, 16)}…`, true)
    registerForm.value = { token: '', platform: '' }
    showRegisterModal.value = false
    await loadTokens()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error al registrar'
    toast.error(message)
    logActivity(`Error al registrar: ${message}`, false)
  } finally {
    registering.value = false
  }
}

async function unregister() {
  if (!unregisterForm.value.token.trim()) {
    toast.error('El token es obligatorio')
    return
  }
  unregistering.value = true
  try {
    await PushTokensService.unregister(unregisterForm.value.token.trim())
    toast.success('Dispositivo dado de baja')
    logActivity(`Dado de baja: ${unregisterForm.value.token.trim().slice(0, 16)}…`, true)
    unregisterForm.value = { token: '' }
    showUnregisterModal.value = false
    await loadTokens()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error al dar de baja'
    toast.error(message)
    logActivity(`Error al dar de baja: ${message}`, false)
  } finally {
    unregistering.value = false
  }
}
</script>

<style scoped></style>
