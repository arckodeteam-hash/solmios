<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
      <div>
        <h2 class="text-xl font-black text-navy">API Keys & Webhooks</h2>
        <p class="text-sm text-text-muted mt-0.5">Accesos de sistemas externos a la plataforma, y avisos de la plataforma hacia ellos</p>
      </div>
      <button v-if="activeTab === 'keys'" @click="showCreateKey = true" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-xl hover:bg-navy-light transition-colors cursor-pointer">
        + Nueva API Key
      </button>
      <button v-else @click="openCreateWebhook" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-xl hover:bg-navy-light transition-colors cursor-pointer">
        + Nuevo Webhook
      </button>
    </div>

    <!-- Tabs: dos cosas distintas (entrar vs. avisar), una a la vez -->
    <div class="flex gap-2 flex-wrap mb-5" role="tablist">
      <button v-for="tab in tabs" :key="tab.value" role="tab" :aria-selected="activeTab === tab.value" @click="activeTab = tab.value"
        class="px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
        {{ tab.label }}
        <span v-if="tab.count !== null" class="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full" :class="activeTab === tab.value ? 'bg-white/20' : 'bg-surface text-text-muted'">{{ tab.count }}</span>
      </button>
    </div>

    <!-- ===== Tab: Claves API ===== -->
    <div v-if="activeTab === 'keys'" class="space-y-5">
      <InfoNotice title="¿Para qué sirve una API Key?" storage-key="apikeys">
        <p>Es la credencial con la que <strong>un sistema externo</strong> (un motor de reservas propio, un PMS, un script del hotel) entra a la <strong>API pública</strong> de SOLMI OS sin usuario ni contraseña. Va en el header <code>x-api-key</code> de cada petición a <code>/api/public/v1/*</code>.</p>
        <p>Cada clave tiene un <strong>alcance</strong>: <code>read:rooms</code> lista habitaciones, <code>read:reservations</code> consulta una reserva, <code>write:reservations</code> crea reservas. Sin el alcance, la API responde 403. Si la clave es de un hotel, solo ve los datos de ese hotel; "Global" ve todos.</p>
        <p>El valor completo <strong>se muestra una sola vez</strong> al crearla (acá se guarda un hash). <strong>Revocar</strong> la corta al instante y se puede reactivar; <strong>eliminar</strong> es definitivo y queda en la auditoría. "Peticiones" y "Último uso" los cuenta el servidor cada vez que la clave entra.</p>
      </InfoNotice>

      <SectionCard title="Claves API" :subtitle="`${apiKeys.length} clave${apiKeys.length === 1 ? '' : 's'}`" body-class="p-0">
        <SkeletonLoader v-if="loading" variant="table" :rows="4" class="p-5" />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[840px] tbl-head">
            <thead>
              <tr>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Nombre / alcance</th>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Clave</th>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Hotel</th>
                <th class="text-right py-3 px-4 text-[10px] font-bold uppercase">Peticiones</th>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Último uso</th>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Estado</th>
                <th class="text-right py-3 px-4 text-[10px] font-bold uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="key in apiKeys" :key="key.id" class="border-b border-border/50 hover:bg-surface/50 transition-colors">
                <td class="py-3 px-4">
                  <div class="text-xs font-bold text-navy">{{ key.name }}</div>
                  <div v-if="key.scopes.length" class="flex flex-wrap gap-1 mt-1">
                    <span v-for="s in key.scopes" :key="s" class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-surface text-text-muted">{{ s }}</span>
                  </div>
                  <div v-else class="text-[10px] text-coral mt-0.5">Sin alcance: no puede llamar a nada</div>
                </td>
                <td class="py-3 px-4">
                  <code class="text-[10px] font-mono text-text-muted bg-surface px-2 py-0.5 rounded" title="Solo se guarda el hash; el valor completo se mostró al crearla">{{ key.masked }}</code>
                </td>
                <td class="py-3 px-4 text-xs text-navy">{{ key.hotel }}</td>
                <td class="py-3 px-4 text-right text-xs font-bold text-navy tabular-nums">{{ key.requests.toLocaleString('es') }}</td>
                <td class="py-3 px-4 text-xs text-text-muted">{{ key.lastUsed }}</td>
                <td class="py-3 px-4">
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="key.active ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">
                    {{ key.active ? 'Activa' : 'Revocada' }}
                  </span>
                </td>
                <td class="py-3 px-4 text-right whitespace-nowrap">
                  <button @click="revokeKey(key.id)" class="text-[10px] font-bold hover:underline cursor-pointer" :class="key.active ? 'text-coral' : 'text-teal'">
                    {{ key.active ? 'Revocar' : 'Reactivar' }}
                  </button>
                  <button v-if="!key.active" @click="deleteKey(key.id)" class="ml-3 text-[10px] font-bold text-text-muted hover:text-coral hover:underline cursor-pointer">Eliminar</button>
                </td>
              </tr>
              <tr v-if="!apiKeys.length">
                <td colspan="7">
                  <EmptyState title="Sin API keys" message="Todavía no generaste ninguna clave. Creá una para que un sistema externo pueda consultar o crear reservas.">
                    <template #action>
                      <button @click="showCreateKey = true" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white cursor-pointer">+ Nueva API Key</button>
                    </template>
                  </EmptyState>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- ===== Tab: Webhooks ===== -->
    <div v-else class="space-y-5">
      <InfoNotice title="¿Para qué sirve un webhook?" storage-key="webhooks">
        <p>Es el camino inverso a la API Key: acá <strong>SOLMI OS le avisa al servidor del hotel</strong> cuando pasa algo. Cada vez que ocurre uno de los eventos suscritos (<code>reservation.created</code>, <code>payment.completed</code>…), la plataforma hace un <code>POST</code> con el dato en JSON a la URL configurada.</p>
        <p>Cada envío va <strong>firmado</strong> con HMAC-SHA256 en el header <code>x-solmios-signature</code>, usando el secreto que se muestra <strong>una sola vez</strong> al crearlo: así el servidor del hotel verifica que el aviso es nuestro y no de cualquiera. La URL tiene que ser <strong>pública</strong> (no vale <code>localhost</code> ni una IP privada).</p>
        <p>Si el destino no responde 2xx, se <strong>reintenta 3 veces</strong> (1 s, 3 s, 9 s) y recién ahí cuenta como fallido. "Probar" manda un evento <code>ping</code> real a ese webhook; "Entregados" y "Fallidos" son entregas reales, no estimaciones. Más de 5 fallos marca el webhook como <strong>degradado</strong>.</p>
      </InfoNotice>

      <SectionCard title="Webhooks" :subtitle="`${webhooks.length} suscripci${webhooks.length === 1 ? 'ón' : 'ones'}`" body-class="p-0">
        <SkeletonLoader v-if="loadingWebhooks" variant="table" :rows="3" class="p-5" />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[840px] tbl-head">
            <thead>
              <tr>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">URL</th>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Eventos</th>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Hotel</th>
                <th class="text-right py-3 px-4 text-[10px] font-bold uppercase">Entregados</th>
                <th class="text-right py-3 px-4 text-[10px] font-bold uppercase">Fallidos</th>
                <th class="text-left py-3 px-4 text-[10px] font-bold uppercase">Estado</th>
                <th class="text-right py-3 px-4 text-[10px] font-bold uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="wh in webhooks" :key="wh.id" class="border-b border-border/50 hover:bg-surface/50 transition-colors">
                <td class="py-3 px-4 text-[10px] text-text-muted font-mono truncate max-w-[250px]" :title="wh.url">{{ wh.url }}</td>
                <td class="py-3 px-4">
                  <div class="flex flex-wrap gap-1">
                    <span v-for="ev in wh.events" :key="ev" class="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-surface text-text-muted">{{ ev }}</span>
                  </div>
                </td>
                <td class="py-3 px-4 text-xs text-navy">{{ wh.hotel }}</td>
                <td class="py-3 px-4 text-right text-xs font-bold text-teal tabular-nums">{{ wh.delivered }}</td>
                <td class="py-3 px-4 text-right text-xs tabular-nums" :class="wh.failed > 0 ? 'font-bold text-coral' : 'text-text-muted'">{{ wh.failed }}</td>
                <td class="py-3 px-4">
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="wh.failed > 5 ? 'bg-coral/10 text-coral' : 'bg-teal/10 text-teal'">
                    {{ wh.failed > 5 ? 'Degradado' : 'Saludable' }}
                  </span>
                </td>
                <td class="py-3 px-4 text-right whitespace-nowrap">
                  <button @click="testWebhook(wh.id)" :disabled="testingId === wh.id" class="text-[10px] font-bold text-cyan hover:underline cursor-pointer mr-3 disabled:opacity-50 disabled:cursor-wait">
                    {{ testingId === wh.id ? 'Probando…' : 'Probar' }}
                  </button>
                  <button @click="deleteWebhook(wh.id)" class="text-[10px] font-bold text-coral hover:underline cursor-pointer">Eliminar</button>
                </td>
              </tr>
              <tr v-if="!webhooks.length">
                <td colspan="7">
                  <EmptyState title="Sin webhooks" message="Configurá un webhook para que el servidor de un hotel reciba los eventos de la plataforma.">
                    <template #action>
                      <button @click="openCreateWebhook" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white cursor-pointer">+ Nuevo Webhook</button>
                    </template>
                  </EmptyState>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- Create Webhook Modal -->
    <AppModal v-if="showCreateWebhook" size="sm" title="Nuevo Webhook" @close="showCreateWebhook = false">
      <div class="space-y-3">
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">URL de destino</label>
          <input v-model="newWebhook.url" type="text" placeholder="https://tu-servidor.com/webhooks/solmios" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan" />
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Hotel</label>
          <select v-model="newWebhook.hotel" class="w-full h-10 px-4 rounded-xl border border-border text-sm cursor-pointer">
            <option value="">Seleccioná un hotel</option>
            <option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Eventos</label>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="ev in webhookEvents" :key="ev" @click="toggleWebhookEvent(ev)"
              class="text-[10px] font-bold px-2 py-1 rounded-full border transition-all cursor-pointer"
              :class="newWebhook.events.includes(ev) ? 'bg-cyan border-cyan text-navy' : 'bg-surface border-border text-text-muted hover:border-cyan'">
              {{ ev }}
            </button>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="showCreateWebhook = false" class="bg-surface text-navy text-sm font-bold rounded-xl cursor-pointer px-4 py-2.5">Cancelar</button>
        <button @click="createWebhook" :disabled="creatingWebhook" class="bg-navy text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50 px-4 py-2.5">
          {{ creatingWebhook ? 'Creando...' : 'Crear' }}
        </button>
      </template>
    </AppModal>

    <!-- Reveal new webhook secret (one-time — necesario para configurar la verificación HMAC) -->
    <AppModal v-if="revealWebhookSecret" size="md" title="Guardá el secreto del webhook ahora" @close="revealWebhookSecret = null">
      <p class="text-xs text-coral font-bold mb-3">⚠️ Por seguridad no se volverá a mostrar. Usalo para verificar la firma HMAC-SHA256 (header x-solmios-signature) en tu servidor.</p>
      <div class="bg-surface rounded-xl p-3 flex items-center gap-2">
        <code class="flex-1 text-xs font-mono text-navy break-all">{{ revealWebhookSecret }}</code>
        <button @click="copyWebhookSecret" class="shrink-0 px-3 py-1.5 bg-navy text-white text-[10px] font-bold rounded-lg cursor-pointer hover:bg-navy-light">Copiar</button>
      </div>
      <template #footer>
        <button @click="revealWebhookSecret = null" class="bg-surface text-navy text-sm font-bold rounded-xl cursor-pointer px-4 py-2.5">Listo, ya lo guardé</button>
      </template>
    </AppModal>

    <!-- Create API Key Modal -->
    <AppModal v-if="showCreateKey" size="sm" title="Nueva API Key" @close="showCreateKey = false">
      <div class="space-y-3">
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nombre</label>
          <input v-model="newKey.name" type="text" placeholder="Ej: Conexión Channex" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan" />
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Hotel</label>
          <select v-model="newKey.hotel" class="w-full h-10 px-4 rounded-xl border border-border text-sm cursor-pointer">
            <option value="">Global (todos)</option>
            <option v-for="h in hotels" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Alcance</label>
          <p class="text-[10px] text-text-muted mb-1.5">Solo lo que la API pública sabe hacer. Sin alcance, la clave no puede llamar a nada.</p>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="s in scopes" :key="s.value" @click="toggleScope(s.value)" :title="s.label"
              class="text-[10px] font-bold px-2 py-1 rounded-full border transition-all cursor-pointer"
              :class="newKey.scopes.includes(s.value) ? 'bg-cyan border-cyan text-navy' : 'bg-surface border-border text-text-muted hover:border-cyan'">
              {{ s.value }}
            </button>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="showCreateKey = false" class="bg-surface text-navy text-sm font-bold rounded-xl cursor-pointer px-4 py-2.5">Cancelar</button>
        <button @click="generateKey" :disabled="creating" class="bg-navy text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50 px-4 py-2.5">
          {{ creating ? 'Generando...' : 'Generar' }}
        </button>
      </template>
    </AppModal>

    <!-- Reveal new API Key (one-time secret — persistente, no toast) -->
    <AppModal v-if="revealKey" size="md" title="Guardá tu API Key ahora" @close="revealKey = null">
      <p class="text-xs text-coral font-bold mb-3">⚠️ Por seguridad no se volverá a mostrar. Copiala y guardala en un lugar seguro.</p>
      <div class="bg-surface rounded-xl p-3 flex items-center gap-2">
        <code class="flex-1 text-xs font-mono text-navy break-all">{{ revealKey }}</code>
        <button @click="copyPlainKey" class="shrink-0 px-3 py-1.5 bg-navy text-white text-[10px] font-bold rounded-lg cursor-pointer hover:bg-navy-light">Copiar</button>
      </div>
      <template #footer>
        <button @click="revealKey = null" class="bg-surface text-navy text-sm font-bold rounded-xl cursor-pointer px-4 py-2.5">Listo, ya la guardé</button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import InfoNotice from '@/components/ui/InfoNotice.vue'
import { ApikeysService } from '@/services/Apikeys.service'
import { WebhooksService } from '@/services/Webhooks.service'
import { SuperAdminService } from '@/services/SuperAdmin.service'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'

const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e) => toast.error(e instanceof Error ? e.message : 'Error'),
})
const showCreateKey = ref(false)
const creating = ref(false)
const loading = ref(true)
const revealKey = ref<string | null>(null)
const hotels = ref<Array<{ id: string; name: string }>>([])

// Solo los alcances que la API pública chequea de verdad (backend publicapi/controller.ts:
// assertScope). Antes se ofrecían 8, de los que 5 no abrían ninguna ruta.
const scopes = [
  { value: 'read:rooms', label: 'GET /api/public/v1/rooms — listar habitaciones' },
  { value: 'read:reservations', label: 'GET /api/public/v1/reservations/:id — consultar una reserva' },
  { value: 'write:reservations', label: 'POST /api/public/v1/reservations — crear reservas' },
]

/** `lastUsed` llega ISO del servidor (validate-key.ts) o vacío si la clave nunca entró. */
function formatLastUsed(iso: string | null | undefined): string {
  if (!iso) return 'Nunca'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const newKey = ref<{ name: string; hotel: string; scopes: string[] }>({ name: '', hotel: '', scopes: [] })

const apiKeys = ref<any[]>([])

const webhookEvents = [
  'reservation.created', 'reservation.updated', 'reservation.checked_out',
  'payment.completed', 'payment.failed', 'payment.refunded',
]

const showCreateWebhook = ref(false)
const creatingWebhook = ref(false)
const loadingWebhooks = ref(true)
const revealWebhookSecret = ref<string | null>(null)
const testingId = ref<string | null>(null)
const newWebhook = ref<{ url: string; hotel: string; events: string[] }>({ url: '', hotel: '', events: [] })

const webhooks = ref<any[]>([])

type TabValue = 'keys' | 'webhooks'
const activeTab = ref<TabValue>('keys')
const tabs = computed<Array<{ value: TabValue; label: string; count: number | null }>>(() => [
  { value: 'keys', label: 'Claves API', count: loading.value ? null : apiKeys.value.length },
  { value: 'webhooks', label: 'Webhooks', count: loadingWebhooks.value ? null : webhooks.value.length },
])

async function loadHotels() {
  try {
    const r = await SuperAdminService.hotels()
    const list = (r as any)?.data || (r as any)?.hotels || []
    hotels.value = list.map((h: any) => ({ id: h.id, name: h.name }))
  } catch { hotels.value = [] }
}

async function loadKeys() {
  loading.value = true
  try {
    const r = await ApikeysService.list()
    apiKeys.value = (r.data || []).map((k: any) => ({
      id: k.id,
      name: k.name,
      scopes: String(k.scope || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      masked: k.masked || '••••••••',
      hotel: k.hotelId ? (hotels.value.find(h => h.id === k.hotelId)?.name || k.hotelId) : 'Global',
      requests: k.requests || 0,
      lastUsed: formatLastUsed(k.lastUsed),
      active: k.active === 1 || k.active === true,
    }))
  } catch {
    apiKeys.value = []
    toast.error('No se pudieron cargar las API keys')
  } finally { loading.value = false }
}

async function loadWebhooks() {
  loadingWebhooks.value = true
  try {
    const r = await WebhooksService.list()
    webhooks.value = (r.data || []).map((w: any) => ({
      id: w.id,
      url: w.url,
      events: w.events || [],
      hotel: w.hotelId ? (hotels.value.find(h => h.id === w.hotelId)?.name || w.hotelId) : 'Global',
      delivered: w.delivered || 0,
      failed: w.failed || 0,
    }))
  } catch {
    webhooks.value = []
    toast.error('No se pudieron cargar los webhooks')
  } finally { loadingWebhooks.value = false }
}

onMounted(async () => {
  await loadHotels()
  await loadKeys()
  await loadWebhooks()
})

function toggleScope(s: string) {
  const idx = newKey.value.scopes.indexOf(s)
  if (idx >= 0) newKey.value.scopes.splice(idx, 1)
  else newKey.value.scopes.push(s)
}

async function generateKey() {
  if (!newKey.value.name) { toast.error('Nombre requerido'); return }
  creating.value = true
  try {
    const created = await ApikeysService.create({
      name: newKey.value.name,
      hotelId: newKey.value.hotel || undefined,
      scope: newKey.value.scopes.join(','),
    })
    // Si el backend devuelve la clave en plain text, mostrarla una sola vez (modal persistente — un toast auto-cerraría y perdería el secret)
    const plainKey = (created as { plainKey?: string } | null)?.plainKey
    if (plainKey) {
      revealKey.value = plainKey
    } else {
      toast.success('API Key creada')
    }
    showCreateKey.value = false
    newKey.value = { name: '', hotel: '', scopes: [] }
    await loadKeys()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al crear API Key')
  } finally {
    creating.value = false
  }
}

function revokeKey(id: string) {
  const key = apiKeys.value.find(k => k.id === id)
  if (!key) return
  if (key.active) {
    askConfirm({
      title: 'Revocar API Key',
      message: `¿Revocar la API Key "${key.name}"? Dejará de funcionar inmediatamente.`,
      confirmLabel: 'Revocar', danger: true,
      run: async () => {
        await ApikeysService.revoke(id)
        key.active = false
        toast.success('Revocada')
      },
    })
  } else {
    reactivateKey(id, key)
  }
}

async function reactivateKey(id: string, key: any) {
  try {
    await ApikeysService.reactivate(id)
    key.active = true
    toast.success('Reactivada')
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
}

async function copyPlainKey() {
  try {
    await navigator.clipboard.writeText(revealKey.value || '')
    toast.success('API Key copiada')
  } catch { toast.error('No se pudo copiar') }
}

function deleteKey(id: string) {
  askConfirm({
    title: 'Eliminar API Key',
    message: '¿Eliminar definitivamente esta API Key? No se puede deshacer.',
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await ApikeysService.remove(id)
      apiKeys.value = apiKeys.value.filter(k => k.id !== id)
      toast.success('Eliminada')
    },
  })
}

function openCreateWebhook() {
  newWebhook.value = { url: '', hotel: '', events: [] }
  showCreateWebhook.value = true
}

function toggleWebhookEvent(ev: string) {
  const idx = newWebhook.value.events.indexOf(ev)
  if (idx >= 0) newWebhook.value.events.splice(idx, 1)
  else newWebhook.value.events.push(ev)
}

async function createWebhook() {
  if (!newWebhook.value.url) { toast.error('URL requerida'); return }
  if (!newWebhook.value.hotel) { toast.error('Seleccioná un hotel'); return }
  if (!newWebhook.value.events.length) { toast.error('Seleccioná al menos un evento'); return }
  creatingWebhook.value = true
  try {
    const created = await WebhooksService.create({
      hotelId: newWebhook.value.hotel, url: newWebhook.value.url, events: newWebhook.value.events,
    })
    const secret = (created as { secret?: string } | null)?.secret
    if (secret) revealWebhookSecret.value = secret
    else toast.success('Webhook creado')
    showCreateWebhook.value = false
    await loadWebhooks()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al crear el webhook')
  } finally {
    creatingWebhook.value = false
  }
}

async function testWebhook(id: string) {
  testingId.value = id
  try {
    const result = await WebhooksService.test(id)
    if (result?.delivered) toast.success('Entrega exitosa: el endpoint respondió 2xx')
    else toast.error('No se pudo entregar: el endpoint no respondió 2xx tras los reintentos')
    await loadWebhooks()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al probar el webhook')
  } finally {
    testingId.value = null
  }
}

function deleteWebhook(id: string) {
  askConfirm({
    title: 'Eliminar webhook',
    message: '¿Eliminar definitivamente este webhook? Dejará de recibir eventos.',
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await WebhooksService.remove(id)
      webhooks.value = webhooks.value.filter(w => w.id !== id)
      toast.success('Eliminado')
    },
  })
}

async function copyWebhookSecret() {
  try {
    await navigator.clipboard.writeText(revealWebhookSecret.value || '')
    toast.success('Secreto copiado')
  } catch { toast.error('No se pudo copiar') }
}
</script>
