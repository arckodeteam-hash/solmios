<template>
  <div>
    <!-- Header -->
    <div class="flex items-center gap-2.5 mb-1.5">
      <h2 class="text-xl font-black text-navy">Proveedores de servicios</h2>
      <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
        <span class="relative flex h-1.5 w-1.5">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
          <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
        </span>
        En vivo
      </span>
    </div>

    <div class="flex items-start justify-between gap-3 mb-6 flex-wrap">
      <p class="text-sm text-text-secondary max-w-lg">A quién llamar cuando algo no se arregla adentro.</p>
      <button @click="openNew" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer shrink-0">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo proveedor de servicios
      </button>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Proveedores" :value="providers.length" icon="users" accent="blue"
        unit="Contactos guardados" />
      <KpiHeroCard label="Activos" :value="activeCount" icon="checkin" accent="teal"
        :unit="inactiveCount ? `${inactiveCount} inactivo(s)` : 'Todos disponibles'" :progress="activeSharePct" />
      <KpiHeroCard label="Sin WhatsApp" :value="noWaCount" icon="building" accent="amber"
        unit="Falta código de país" />
    </div>

    <!-- Directorio -->
    <SectionCard title="Directorio" :subtitle="`${filteredProviders.length} de ${providers.length} proveedor(es)`">
      <template #actions>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" v-html="ICON_SEARCH"></span>
          <input id="technical-providers-search" name="search" aria-label="Buscar nombre, especialidad, zona"
            v-model="search"
            type="text"
            placeholder="Buscar nombre, especialidad, zona..."
            class="pl-9 pr-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 w-56 focus:outline-none focus:border-cyan"
          />
        </div>
        <select id="technical-providers-filter-status" name="statusFilter" aria-label="Filtrar proveedores por estado" v-model="statusFilter"
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="all">Todos</option>
          <option class="text-navy" value="active">Activos</option>
          <option class="text-navy" value="inactive">Inactivos</option>
        </select>
      </template>

      <!-- Loading -->
      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="h-40 animate-pulse rounded-2xl bg-surface"></div>
      </div>

      <!-- Error -->
      <EmptyState
        v-else-if="error"
        :icon="ICON_WRENCH"
        title="No se pudieron cargar los proveedores"
        :message="error"
      >
        <template #action>
          <button @click="load" class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Reintentar</button>
        </template>
      </EmptyState>

      <!-- Sin datos -->
      <EmptyState
        v-else-if="providers.length === 0"
        :icon="ICON_WRENCH"
        title="Todavía no cargaste ningún proveedor de servicios"
        message="Sumá al plomero, electricista o técnico de A/C de confianza para tenerlos a mano."
      >
        <template #action>
          <button @click="openNew" class="flex items-center gap-1.5 mx-auto bg-navy text-white font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
            <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
            Nuevo proveedor de servicios
          </button>
        </template>
      </EmptyState>

      <!-- Filtro sin resultados -->
      <EmptyState
        v-else-if="filteredProviders.length === 0"
        :icon="ICON_SEARCH"
        title="Sin proveedores con este filtro"
        message="Probá con otra búsqueda o mirá todos los proveedores."
      >
        <template #action>
          <button @click="clearFilters" class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Ver todos</button>
        </template>
      </EmptyState>

      <!-- Lista -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="p in filteredProviders"
          :key="p.id"
          class="rounded-[20px] border border-border bg-white p-5 shadow-(--shadow-card) transition-transform duration-300 hover:-translate-y-0.5 flex flex-col"
        >
          <div class="flex items-start gap-3 mb-3">
            <div class="w-11 h-11 rounded-xl bg-navy/10 flex items-center justify-center shrink-0">
              <span class="text-sm font-black text-navy">{{ initials(p.name) }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="text-base font-black text-navy truncate">{{ p.name }}</h3>
                <span
                  class="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  :class="p.active === false ? 'bg-surface text-text-muted' : 'bg-teal/10 text-teal'"
                >{{ p.active === false ? 'Inactivo' : 'Activo' }}</span>
              </div>
              <p v-if="p.specialty || p.phone" class="text-xs text-text-secondary mt-0.5 truncate">
                {{ p.specialty || 'Sin especialidad' }}<template v-if="p.phone"> · {{ p.phone }}</template>
              </p>
              <div v-if="p.phone" class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <a
                  v-if="waHref(p.phone)"
                  :href="waHref(p.phone)!"
                  target="_blank"
                  rel="noopener"
                  class="text-[10px] font-bold px-2 py-1 rounded-lg bg-success/10 text-success hover:bg-success/20"
                >WhatsApp</a>
                <button
                  v-else
                  type="button"
                  @click="openEdit(p)"
                  title="WhatsApp necesita el número con código de país (ej: +1 809 555 0000). Tocá para completarlo."
                  class="text-[10px] font-bold px-2 py-1 rounded-lg bg-warning/10 text-warning hover:bg-warning/20 cursor-pointer"
                >Falta código de país</button>
                <a :href="telHref(p.phone)" class="text-[10px] font-bold px-2 py-1 rounded-lg bg-navy/10 text-navy hover:bg-navy/20">Llamar</a>
              </div>
            </div>
          </div>

          <div class="space-y-2 text-xs mb-4">
            <div class="flex items-center gap-2 text-text-secondary">
              <span class="w-3.5 h-3.5 shrink-0 text-text-muted" v-html="ICON_CLOCK"></span>
              <span>{{ scheduleLabel(p) }}</span>
            </div>
            <div v-if="p.rate" class="flex items-center gap-2 text-text-secondary">
              <span class="w-3.5 h-3.5 shrink-0 text-text-muted" v-html="ICON_WALLET"></span>
              <span>{{ p.rate }}</span>
            </div>
            <div v-if="p.address" class="flex items-center gap-2 text-text-secondary">
              <span class="w-3.5 h-3.5 shrink-0 text-text-muted" v-html="ICON_PIN"></span>
              <span class="truncate">{{ p.address }}</span>
            </div>
            <div v-if="p.email" class="flex items-center gap-2 text-text-secondary">
              <span class="w-3.5 h-3.5 shrink-0 text-text-muted" v-html="ICON_MAIL"></span>
              <a :href="`mailto:${p.email}`" class="truncate hover:text-navy hover:underline">{{ p.email }}</a>
            </div>
          </div>

          <div v-if="p.notes" class="text-[11px] text-text-muted italic mb-4 line-clamp-2">{{ p.notes }}</div>

          <div class="flex items-center justify-end gap-1 pt-3 mt-auto border-t border-border">
            <button
              v-if="p.active === false"
              @click="reactivate(p)"
              title="Reactivar proveedor dado de baja"
              class="text-[10px] font-extrabold px-2.5 py-1 rounded-lg bg-teal/10 text-teal hover:bg-teal/20 cursor-pointer"
            >Reactivar</button>
            <button @click="openEdit(p)" title="Editar" aria-label="Editar"
              class="w-8 h-8 grid place-items-center rounded-lg text-text-secondary hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
              <span class="w-4 h-4" v-html="ICON_EDIT"></span>
            </button>
            <button @click="askDelete(p)" title="Eliminar" aria-label="Eliminar"
              class="w-8 h-8 grid place-items-center rounded-lg text-text-secondary hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer">
              <span class="w-4 h-4" v-html="ICON_TRASH"></span>
            </button>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- Modal: alta / edición -->
    <AppModal
      :open="showModal"
      size="lg"
      :title="editing ? 'Editar proveedor de servicios' : 'Nuevo proveedor de servicios'"
      subtitle="Datos de contacto y disponibilidad"
      @close="closeModal"
    >
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2">
          <label for="technical-providers-nombre" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Nombre *</label>
          <input id="technical-providers-nombre" name="name" required aria-required="true" v-model="form.name" maxlength="120" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" :class="nameError ? 'border-danger' : ''" placeholder="Ej: Juan el plomero">
          <p v-if="nameError" class="text-[10px] text-danger mt-1">{{ nameError }}</p>
        </div>

        <div>
          <label for="technical-providers-especialidad" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Especialidad</label>
          <input id="technical-providers-especialidad" name="specialty" v-model="form.specialty" maxlength="80" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="Plomería, Electricidad...">
        </div>
        <div>
          <label for="technical-providers-telefono" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Teléfono</label>
          <input id="technical-providers-telefono" name="phone" v-model="form.phone" maxlength="40" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="+1 809 555 0000">
          <p class="text-[10px] text-text-muted mt-1">Con código de país (+1, +34…) para poder abrir WhatsApp.</p>
        </div>

        <div>
          <label for="technical-providers-email" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Email</label>
          <input id="technical-providers-email" name="email" v-model="form.email" type="email" maxlength="120" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="correo@ejemplo.com">
        </div>
        <div>
          <label for="technical-providers-direccion-zona" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Dirección / zona</label>
          <input id="technical-providers-direccion-zona" name="address" v-model="form.address" maxlength="160" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="Zona / barrio">
        </div>

        <div class="col-span-2">
          <label for="technical-providers-tarifa" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Tarifa</label>
          <input id="technical-providers-tarifa" name="rate" v-model="form.rate" maxlength="80" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="Ej: RD$1500 por visita">
        </div>

        <div class="col-span-2">
          <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Días de trabajo</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="d in DAYS"
              :key="d.key"
              type="button"
              @click="toggleDay(d.key)"
              class="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors cursor-pointer"
              :class="selectedDays.has(d.key) ? 'bg-navy text-white border-navy' : 'bg-white text-text-secondary border-border hover:border-navy/30'"
            >{{ d.label }}</button>
          </div>
        </div>

        <div>
          <label for="technical-providers-desde" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Desde</label>
          <input id="technical-providers-desde" name="workStart" v-model="form.workStart" type="time" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
        </div>
        <div>
          <label for="technical-providers-hasta" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Hasta</label>
          <input id="technical-providers-hasta" name="workEnd" v-model="form.workEnd" type="time" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" :class="scheduleError ? 'border-danger' : ''">
          <p v-if="scheduleError" class="text-[10px] text-danger mt-1">{{ scheduleError }}</p>
        </div>

        <div class="col-span-2">
          <label for="technical-providers-notas" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Notas</label>
          <textarea id="technical-providers-notas" name="notes" v-model="form.notes" rows="3" maxlength="500" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy resize-none" placeholder="Detalles, referencias, disponibilidad..."></textarea>
        </div>

        <div class="col-span-2 flex items-center gap-2">
          <input id="tp-active" v-model="form.active" type="checkbox" class="w-4 h-4 accent-cyan cursor-pointer">
          <label for="tp-active" class="text-xs font-bold text-text-secondary cursor-pointer">Proveedor activo</label>
        </div>
      </div>

      <template #footer>
        <button @click="closeModal" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <button @click="save" :disabled="saving" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-extrabold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando...' : (editing ? 'Guardar cambios' : 'Crear proveedor') }}
        </button>
      </template>
    </AppModal>

    <!-- Modal: confirmar eliminación (baja lógica — se puede revertir con Reactivar) -->
    <ConfirmModal
      v-if="deleteTarget"
      title="Eliminar proveedor"
      :message="`¿Dar de baja a ${deleteTarget.name}? Deja de aparecer en los tickets nuevos, y podés reactivarlo desde el filtro Inactivos.`"
      confirm-label="Dar de baja"
      danger
      :loading="deleting"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import {
  TechnicalProvidersService,
  type TechnicalProvider,
  type CreateTechnicalProviderInput,
} from '@/services/TechnicalProviders.service'

const auth = useAuthStore()
const toast = useToast()
const hotelId = computed(() =>
  auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined
)

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_CLOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 12h.01M3 10h18"/></svg>'
const ICON_PIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>'
const ICON_MAIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>'
const ICON_WRENCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>'
const ICON_EDIT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.5v4.875A2.625 2.625 0 0 1 16.875 21H5.625A2.625 2.625 0 0 1 3 18.375V7.125A2.625 2.625 0 0 1 5.625 4.5H10.5"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>'

// Orden canónico de días (inglés) + etiqueta corta ES.
const DAYS: Array<{ key: string; label: string }> = [
  { key: 'mon', label: 'Lun' },
  { key: 'tue', label: 'Mar' },
  { key: 'wed', label: 'Mié' },
  { key: 'thu', label: 'Jue' },
  { key: 'fri', label: 'Vie' },
  { key: 'sat', label: 'Sáb' },
  { key: 'sun', label: 'Dom' },
]
const DAY_ORDER = DAYS.map(d => d.key)
const DAY_LABEL: Record<string, string> = Object.fromEntries(DAYS.map(d => [d.key, d.label]))

const providers = ref<TechnicalProvider[]>([])
const loading = ref(false)
const error = ref('')

const search = ref('')
const statusFilter = ref<'all' | 'active' | 'inactive'>('all')

const showModal = ref(false)
const editing = ref<TechnicalProvider | null>(null)
const saving = ref(false)
const nameError = ref('')
const scheduleError = ref('')
const selectedDays = ref<Set<string>>(new Set())

const deleteTarget = ref<TechnicalProvider | null>(null)
const deleting = ref(false)

interface ProviderForm {
  name: string
  specialty: string
  phone: string
  email: string
  address: string
  rate: string
  notes: string
  workStart: string
  workEnd: string
  active: boolean
}

function emptyForm(): ProviderForm {
  return { name: '', specialty: '', phone: '', email: '', address: '', rate: '', notes: '', workStart: '', workEnd: '', active: true }
}
const form = ref<ProviderForm>(emptyForm())

// ── KPIs ──────────────────────────────────────────────────────────────────
const activeCount = computed(() => providers.value.filter(p => p.active !== false).length)
const inactiveCount = computed(() => providers.value.length - activeCount.value)
const activeSharePct = computed(() => providers.value.length ? Math.round((activeCount.value / providers.value.length) * 100) : 0)
// Mismo criterio que el badge de la card: tiene teléfono pero sin '+' → wa.me no lo resuelve.
const noWaCount = computed(() =>
  providers.value.filter(p => p.active !== false && p.phone && !p.phone.trim().startsWith('+')).length
)

// ── Filtro ────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
const filteredProviders = computed(() => {
  const q = norm(search.value.trim())
  return providers.value.filter(p => {
    if (statusFilter.value === 'active' && p.active === false) return false
    if (statusFilter.value === 'inactive' && p.active !== false) return false
    if (!q) return true
    return norm(p.name).includes(q) || norm(p.specialty ?? '').includes(q) || norm(p.address ?? '').includes(q)
  })
})
function clearFilters() {
  search.value = ''
  statusFilter.value = 'all'
}

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    // Vista de ADMINISTRACIÓN: trae también los de baja para poder reactivarlos
    // y que KPIs/filtros no mientan. El selector de tickets sigue viendo solo activos.
    providers.value = await TechnicalProvidersService.list(true)
  } catch {
    error.value = 'No se pudieron cargar los proveedores de servicios.'
  } finally {
    loading.value = false
  }
}

/** Reactiva un proveedor dado de baja (la baja es lógica — el botón deshace el "Eliminar"). */
async function reactivate(p: TechnicalProvider) {
  try {
    await TechnicalProvidersService.update(p.id, { active: true })
    toast.success(`${p.name} reactivado`)
    await load()
  } catch {
    toast.error('No se pudo reactivar el proveedor')
  }
}

/**
 * Link de WhatsApp, o null si el número no es resoluble.
 *
 * wa.me EXIGE el número en formato internacional completo. Un '809-555-0000' cargado sin prefijo
 * armaba 'wa.me/8095550000', que WhatsApp no resuelve: el botón existía y no contactaba a nadie.
 *
 * No se asume ningún prefijo: el sistema no guarda código telefónico en ningún lado (`hotels.country`
 * es el NOMBRE del país en español, no un dial code, y no existe countryCode/phonePrefix). Adivinar
 * el prefijo mandaría a un contacto equivocado, que es peor que no ofrecer el link. Por eso: sólo se
 * construye el link cuando el número ya viene internacionalizado con '+'.
 */
function waHref(phone?: string): string | null {
  const raw = String(phone ?? '').trim()
  if (!raw.startsWith('+')) return null
  const digits = raw.slice(1).replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

/** Link de marcado. `tel:` sí acepta números locales, así que se conserva el '+' y se limpia el resto. */
function telHref(phone?: string): string {
  const raw = String(phone ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  return `tel:${raw.startsWith('+') ? '+' : ''}${digits}`
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]?.toUpperCase() ?? '').join('') || '?'
}

// CSV de días → etiqueta legible. "Lun a Vie" si es un tramo contiguo, si no "Lun, Mié, Vie".
function daysLabel(csv?: string): string {
  const set = parseDays(csv)
  if (set.length === 0) return ''
  if (set.length === 1) return DAY_LABEL[set[0]!] ?? ''
  const idxs = set.map(k => DAY_ORDER.indexOf(k)).sort((a, b) => a - b)
  const contiguous = idxs.every((v, i) => i === 0 || v === idxs[i - 1]! + 1)
  if (contiguous && idxs.length >= 3) {
    return `${DAY_LABEL[DAY_ORDER[idxs[0]!]!]} a ${DAY_LABEL[DAY_ORDER[idxs[idxs.length - 1]!]!]}`
  }
  return idxs.map(i => DAY_LABEL[DAY_ORDER[i]!]).join(', ')
}

// Normaliza el CSV al orden canónico y descarta claves desconocidas.
function parseDays(csv?: string): string[] {
  if (!csv) return []
  const raw = new Set(csv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  return DAY_ORDER.filter(k => raw.has(k))
}

function timeLabel(p: TechnicalProvider): string {
  if (p.workStart && p.workEnd) return `${p.workStart}–${p.workEnd}`
  if (p.workStart) return `desde ${p.workStart}`
  if (p.workEnd) return `hasta ${p.workEnd}`
  return ''
}

function scheduleLabel(p: TechnicalProvider): string {
  const days = daysLabel(p.workDays)
  const time = timeLabel(p)
  if (days && time) return `${days} · ${time}`
  return days || time || 'Horario sin definir'
}

function toggleDay(key: string) {
  const next = new Set(selectedDays.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedDays.value = next
}

function openNew() {
  editing.value = null
  nameError.value = ''
  scheduleError.value = ''
  form.value = emptyForm()
  selectedDays.value = new Set()
  showModal.value = true
}

function openEdit(p: TechnicalProvider) {
  editing.value = p
  nameError.value = ''
  scheduleError.value = ''
  form.value = {
    name: p.name ?? '',
    specialty: p.specialty ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    address: p.address ?? '',
    rate: p.rate ?? '',
    notes: p.notes ?? '',
    workStart: p.workStart ?? '',
    workEnd: p.workEnd ?? '',
    active: p.active !== false,
  }
  selectedDays.value = new Set(parseDays(p.workDays))
  showModal.value = true
}

function closeModal() {
  showModal.value = false
}

function serializeDays(): string {
  return DAY_ORDER.filter(k => selectedDays.value.has(k)).join(',')
}

async function save() {
  nameError.value = ''
  scheduleError.value = ''
  const name = form.value.name.trim()
  if (!name) {
    nameError.value = 'El nombre es obligatorio.'
    return
  }
  // Mismo mínimo que el backend (MIN_TEXT_LENGTH): sin esto, 1-2 letras pasaban acá y
  // morían en un 400 con toast genérico que no decía por qué.
  if (name.length < 3) {
    nameError.value = 'El nombre necesita al menos 3 caracteres.'
    return
  }
  // Horario invertido: en disponibilidad "desde las 18 hasta las 8" no significa nada.
  if (form.value.workStart && form.value.workEnd && form.value.workStart > form.value.workEnd) {
    scheduleError.value = 'La hora "Hasta" debe ser posterior a "Desde".'
    return
  }
  saving.value = true
  const payload: CreateTechnicalProviderInput = {
    hotelId: hotelId.value,
    name,
    specialty: form.value.specialty.trim() || undefined,
    phone: form.value.phone.trim() || undefined,
    email: form.value.email.trim() || undefined,
    address: form.value.address.trim() || undefined,
    rate: form.value.rate.trim() || undefined,
    notes: form.value.notes.trim() || undefined,
    workDays: serializeDays() || undefined,
    workStart: form.value.workStart || undefined,
    workEnd: form.value.workEnd || undefined,
    active: form.value.active,
  }
  try {
    if (editing.value) {
      await TechnicalProvidersService.update(editing.value.id, payload)
      toast.success('Proveedor de servicios actualizado')
    } else {
      await TechnicalProvidersService.create(payload)
      toast.success('Proveedor de servicios creado')
    }
    showModal.value = false
    editing.value = null
    await load()
  } catch (e) {
    // ApiError ya viene enriquecido con el detalle de validación del backend
    // (withFieldDetail en http.ts) — mostrarlo en vez de un genérico que oculta la causa.
    const detail = e instanceof Error && e.message ? e.message : ''
    toast.error(detail || (editing.value ? 'Error al actualizar el proveedor' : 'Error al crear el proveedor'))
  } finally {
    saving.value = false
  }
}

function askDelete(p: TechnicalProvider) {
  deleteTarget.value = p
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await TechnicalProvidersService.remove(deleteTarget.value.id)
    toast.success('Proveedor dado de baja (reactivalo desde Inactivos si lo necesitás)')
    deleteTarget.value = null
    await load()
  } catch {
    toast.error('Error al eliminar el proveedor')
  } finally {
    deleting.value = false
  }
}
</script>
