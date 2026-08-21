<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">Ofertas</h2>
          <span class="inline-flex items-center rounded-full bg-gold/10 px-2.5 py-1 text-[10px] font-extrabold uppercase text-gold">
            {{ activeOffers.length }} {{ activeOffers.length === 1 ? 'oferta activa' : 'ofertas activas' }}
          </span>
        </div>
        <p class="text-sm text-text-muted mt-0.5">Paquetes y servicios adicionales para ofrecer a tus huéspedes</p>
      </div>
      <button @click="openCreate()" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nueva Oferta
      </button>
    </div>

    <!-- KPIs — todos derivados del catálogo real -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Paquetes" :value="combos.length" icon="bookings" accent="blue"
        unit="Combos armados del catálogo" />
      <KpiHeroCard label="Servicios Adicionales" :value="servicios.length" icon="building" accent="purple"
        unit="Extras sueltos para vender aparte" />
      <KpiHeroCard label="Precio Promedio" :value="avgPrice" icon="money" accent="teal"
        prefix="$" unit="Promedio de todas las ofertas" />
      <KpiHeroCard label="Valor del Catálogo" :value="catalogValue" icon="money" accent="amber"
        prefix="$" :unit="`${activeOffers.length} de ${offers.length} ofertas activas`" />
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6 flex-wrap">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        class="px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.id ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Skeletons -->
    <div v-if="loading" class="grid gap-4 md:grid-cols-3">
      <div v-for="i in 6" :key="i" class="overflow-hidden rounded-2xl border border-border bg-white">
        <div class="h-32 animate-pulse bg-surface"></div>
        <div class="space-y-3 p-5">
          <div class="h-4 w-2/3 animate-pulse rounded bg-surface"></div>
          <div class="h-3 w-full animate-pulse rounded bg-surface"></div>
          <div class="h-6 w-24 animate-pulse rounded bg-surface"></div>
        </div>
      </div>
    </div>

    <!-- Paquetes -->
    <SectionCard v-else-if="activeTab === 'combo'"
      title="Paquetes" :subtitle="`${combos.length} paquete(s) en el catálogo`">
      <template #actions>
        <button @click="openCreate('combo')"
          class="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
          <span class="w-3.5 h-3.5 shrink-0" v-html="ICON_PLUS"></span>
          Nuevo Paquete
        </button>
      </template>

      <EmptyState v-if="combos.length === 0"
        :icon="ICON_BOX"
        title="Todavía no hay paquetes"
        message="Armá tu primer combo para ofrecerlo junto con la reserva.">
        <template #action>
          <button @click="openCreate('combo')"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Crear paquete</button>
        </template>
      </EmptyState>

      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="(offer, idx) in combos" :key="offer.id" class="overflow-hidden rounded-2xl border border-border bg-white hover:shadow-md transition-shadow">
          <div class="h-32 bg-gradient-to-br" :class="gradientFor(idx)"></div>
          <div class="p-5">
            <div class="flex items-center justify-between mb-2 gap-2">
              <h3 class="text-sm font-black text-navy truncate">{{ offer.name }}</h3>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" :class="offer.active ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
                {{ offer.active ? 'Activa' : 'Inactiva' }}
              </span>
            </div>
            <p v-if="offer.description" class="text-[11px] text-text-muted mb-3 whitespace-pre-line">{{ offer.description }}</p>
            <div v-if="offer.contents?.length" class="flex flex-wrap gap-1 mb-3">
              <span v-for="item in offer.contents" :key="item" class="text-[10px] px-2 py-0.5 rounded-full bg-navy/5 text-navy">{{ item }}</span>
            </div>
            <div class="mb-4 text-right">
              <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Precio</div>
              <span class="text-xl font-black tabular-nums text-navy">${{ offer.price.toLocaleString() }}</span>
            </div>
            <div class="flex items-center justify-end gap-1 border-t border-border pt-3">
              <button @click="openEdit(offer)" title="Editar"
                class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
              </button>
              <button @click="toggleActive(offer)" :title="offer.active ? 'Desactivar' : 'Activar'"
                class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                <span class="h-4 w-4" v-html="ICON_TOGGLE"></span>
              </button>
              <button @click="confirmTarget = offer" title="Eliminar"
                class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                <span class="h-4 w-4" v-html="ICON_TRASH"></span>
              </button>
            </div>
          </div>
        </div>

        <button @click="openCreate('combo')" class="rounded-2xl border-2 border-dashed border-border bg-white p-6 flex flex-col items-center justify-center min-h-[280px] hover:border-cyan transition-colors cursor-pointer">
          <div class="w-12 h-12 rounded-full bg-surface flex items-center justify-center text-text-muted mb-3">
            <span class="w-6 h-6 shrink-0" v-html="ICON_PLUS"></span>
          </div>
          <div class="text-sm font-bold text-text-muted">Crear Paquete</div>
        </button>
      </div>
    </SectionCard>

    <!-- Servicios adicionales -->
    <SectionCard v-else-if="activeTab === 'servicio'"
      title="Servicios Adicionales" :subtitle="`${servicios.length} servicio(s) en el catálogo`" body-class="p-0">
      <template #actions>
        <button @click="openCreate('servicio')"
          class="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
          <span class="w-3.5 h-3.5 shrink-0" v-html="ICON_PLUS"></span>
          Nuevo Servicio
        </button>
      </template>

      <EmptyState v-if="servicios.length === 0"
        :icon="ICON_TAG"
        title="Sin servicios adicionales"
        message="Agregá extras sueltos para ofrecer a los huéspedes.">
        <template #action>
          <button @click="openCreate('servicio')"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Crear servicio</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Servicio</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Incluye</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Precio</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="offer in servicios" :key="offer.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="text-sm font-bold text-navy">{{ offer.name }}</div>
                <div v-if="offer.description" class="text-[11px] text-text-muted">{{ offer.description }}</div>
                <div v-if="offer.contents?.length" class="mt-1 flex flex-wrap gap-1 lg:hidden">
                  <span v-for="item in offer.contents" :key="item" class="text-[10px] px-2 py-0.5 rounded-full bg-navy/5 text-navy">{{ item }}</span>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <div v-if="offer.contents?.length" class="flex flex-wrap gap-1">
                  <span v-for="item in offer.contents" :key="item" class="text-[10px] px-2 py-0.5 rounded-full bg-navy/5 text-navy">{{ item }}</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="offer.active ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
                  {{ offer.active ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right text-sm font-black tabular-nums text-navy">${{ offer.price.toLocaleString() }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                  <button @click="openEdit(offer)" title="Editar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                  </button>
                  <button @click="toggleActive(offer)" :title="offer.active ? 'Desactivar' : 'Activar'"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_TOGGLE"></span>
                  </button>
                  <button @click="confirmTarget = offer" title="Eliminar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal crear / editar -->
    <AppModal v-if="showDialog" size="md"
      :title="editingId ? 'Editar Oferta' : 'Nueva Oferta'"
      :subtitle="form.type === 'combo' ? 'Paquete' : 'Servicio adicional'"
      @close="showDialog = false">
      <div class="space-y-4">
        <div>
          <label for="packages-nombre" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Nombre</label>
          <input id="packages-nombre" name="name" required aria-required="true" v-model="form.name" type="text" placeholder="Ej: Fin de semana romántico" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan" />
        </div>
        <div>
          <label for="packages-descripcion" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Descripción</label>
          <textarea id="packages-descripcion" name="description" v-model="form.description" rows="2" class="w-full px-4 py-3 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan resize-none"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="packages-precio" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Precio</label>
            <input id="packages-precio" name="price" required aria-required="true" v-model.number="form.price" type="number" min="0" step="0.01" placeholder="0.00" class="w-full h-10 px-4 rounded-xl border border-border text-sm text-right font-bold focus:outline-none focus:border-cyan" />
          </div>
          <div>
            <label for="packages-tipo" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Tipo</label>
            <select id="packages-tipo" name="type" v-model="form.type" class="w-full h-10 px-4 rounded-xl border border-border text-sm cursor-pointer focus:outline-none focus:border-cyan">
              <option value="combo">Paquete</option>
              <option value="servicio">Servicio adicional</option>
            </select>
          </div>
        </div>

        <div>
          <label for="packages-incluye" class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Incluye</label>
          <div class="flex gap-2 mb-2">
            <input id="packages-incluye" name="newItem"
              v-model="newItem"
              @keyup.enter="addItem"
              type="text"
              placeholder="Ej: Desayuno para dos"
              class="flex-1 h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan"
            />
            <button @click="addItem" class="px-4 rounded-xl bg-surface text-navy text-sm font-bold hover:bg-navy hover:text-white transition-all cursor-pointer">Agregar</button>
          </div>
          <div v-if="form.contents.length === 0" class="text-[11px] text-text-muted">Todavía no agregaste nada.</div>
          <div v-else class="flex flex-wrap gap-2">
            <span v-for="(item, idx) in form.contents" :key="idx" class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-navy/5 text-navy">
              {{ item }}
              <button @click="form.contents.splice(idx, 1)" class="text-text-muted hover:text-coral cursor-pointer">
                <span class="w-3 h-3 block" v-html="ICON_X"></span>
              </button>
            </span>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input id="packages-activa" name="active" v-model.number="form.active" type="checkbox" :true-value="1" :false-value="0" class="w-4 h-4 accent-navy cursor-pointer" />
          <span class="text-sm font-bold text-navy">Activa</span>
        </label>
      </div>

      <template #footer>
        <button @click="showDialog = false" class="rounded-full px-5 py-2.5 text-sm font-bold text-text-secondary hover:bg-white transition-colors cursor-pointer">
          Cancelar
        </button>
        <button @click="save" :disabled="submitting" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ submitting ? 'Guardando...' : (editingId ? 'Actualizar' : 'Crear') }}
        </button>
      </template>
    </AppModal>

    <!-- Confirmar borrado -->
    <AppModal v-if="confirmTarget" size="sm" title="Eliminar oferta" @close="confirmTarget = null">
      <p class="text-sm text-text-secondary">
        ¿Seguro que querés eliminar <strong>{{ confirmTarget.name }}</strong>? No se puede deshacer.
      </p>
      <template #footer>
        <button @click="confirmTarget = null" class="rounded-full px-5 py-2.5 text-sm font-bold text-text-secondary hover:bg-white transition-colors cursor-pointer">Cancelar</button>
        <button @click="remove" :disabled="deleting" class="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50">
          {{ deleting ? 'Eliminando...' : 'Eliminar' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { PackagesService, offerType, type Offer, type OfferType } from '@/services/Packages.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_X = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>'
const ICON_PENCIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/></svg>'
const ICON_TOGGLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 7.5h12M9.75 7.5v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5m-8.25 0 .75 11.25a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.25 7.5"/></svg>'
// ICON_BOX / ICON_TAG se usan sólo en EmptyState (caja de 64px) → tamaño fijo h-8 w-8.
const ICON_BOX = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5 12 12m0 0L3.75 7.5M12 12v9m8.25-4.5V7.279a1.5 1.5 0 0 0-.75-1.299l-7.5-4.333a1.5 1.5 0 0 0-1.5 0L3 5.98a1.5 1.5 0 0 0-.75 1.3v8.442a1.5 1.5 0 0 0 .75 1.3l7.5 4.332a1.5 1.5 0 0 0 1.5 0l7.5-4.333a1.5 1.5 0 0 0 .75-1.299Z"/></svg>'
const ICON_TAG = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.169.659 1.591l9.5 9.5a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182l-9.5-9.5A2.25 2.25 0 0 0 9.568 3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.008v.008H6.75V6.75Z"/></svg>'

const GRADIENTS = ['from-pink-400 to-rose-500', 'from-cyan to-teal', 'from-navy to-navy-light', 'from-blue to-cyan', 'from-purple to-indigo']
const gradientFor = (idx: number) => GRADIENTS[idx % GRADIENTS.length]

const auth = useAuthStore()
const toast = useToast()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const tabs: Array<{ id: OfferType; label: string }> = [
  { id: 'combo', label: 'Paquetes' },
  { id: 'servicio', label: 'Servicios adicionales' },
]

const offers = ref<Offer[]>([])
const loading = ref(false)
const submitting = ref(false)
const deleting = ref(false)
const activeTab = ref<'combo' | 'servicio'>('combo')
const showDialog = ref(false)
const editingId = ref<string | null>(null)
const confirmTarget = ref<Offer | null>(null)
const newItem = ref('')

const emptyForm = () => ({
  name: '',
  description: '',
  price: 0,
  type: 'combo' as OfferType,
  contents: [] as string[],
  active: 1,
})
const form = reactive(emptyForm())

const combos = computed(() => offers.value.filter((o) => offerType(o.type) === 'combo'))
const servicios = computed(() => offers.value.filter((o) => offerType(o.type) === 'servicio'))
const activeOffers = computed(() => offers.value.filter((o) => o.active))
const catalogValue = computed(() => offers.value.reduce((sum, o) => sum + (o.price || 0), 0))
const avgPrice = computed(() => (offers.value.length ? Math.round(catalogValue.value / offers.value.length) : 0))

onMounted(loadData)

async function loadData() {
  loading.value = true
  try {
    const r = await PackagesService.list(hotelId.value)
    offers.value = (r.data || []).map((o) => ({ ...o, contents: normalizeContents(o.contents) }))
  } catch (e: unknown) {
    toast.error('No se pudieron cargar las ofertas', e instanceof Error ? e.message : undefined)
  } finally {
    loading.value = false
  }
}

/** Las filas viejas guardaron `contents` como lista de objetos `{ label }`. */
function normalizeContents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (typeof item === 'string' ? item : (item as { label?: string })?.label ?? ''))
    .filter(Boolean)
}

function openCreate(type: OfferType = 'combo') {
  Object.assign(form, emptyForm(), { type })
  editingId.value = null
  newItem.value = ''
  showDialog.value = true
}

function openEdit(offer: Offer) {
  Object.assign(form, {
    name: offer.name,
    description: offer.description ?? '',
    price: offer.price ?? 0,
    type: offerType(offer.type),
    contents: [...(offer.contents ?? [])],
    active: offer.active ? 1 : 0,
  })
  editingId.value = offer.id ?? null
  newItem.value = ''
  showDialog.value = true
}

function addItem() {
  const value = newItem.value.trim()
  if (!value || form.contents.includes(value)) return
  form.contents.push(value)
  newItem.value = ''
}

async function save() {
  if (!form.name.trim()) {
    toast.error('El nombre es obligatorio')
    return
  }
  if (form.price < 0) {
    toast.error('El precio no puede ser negativo')
    return
  }
  submitting.value = true
  try {
    const payload = { ...form, name: form.name.trim(), hotelId: hotelId.value }
    if (editingId.value) {
      await PackagesService.update(editingId.value, payload)
      toast.success('Oferta actualizada')
    } else {
      await PackagesService.create(payload as Omit<Offer, 'id'>)
      toast.success('Oferta creada')
    }
    showDialog.value = false
    await loadData()
  } catch (e: unknown) {
    toast.error('No se pudo guardar la oferta', e instanceof Error ? e.message : undefined)
  } finally {
    submitting.value = false
  }
}

async function toggleActive(offer: Offer) {
  if (!offer.id) return
  try {
    await PackagesService.update(offer.id, { active: offer.active ? 0 : 1 })
    await loadData()
  } catch (e: unknown) {
    toast.error('No se pudo cambiar el estado', e instanceof Error ? e.message : undefined)
  }
}

async function remove() {
  const target = confirmTarget.value
  if (!target?.id) return
  deleting.value = true
  try {
    await PackagesService.remove(target.id, hotelId.value)
    toast.success('Oferta eliminada')
    confirmTarget.value = null
    await loadData()
  } catch (e: unknown) {
    toast.error('No se pudo eliminar la oferta', e instanceof Error ? e.message : undefined)
  } finally {
    deleting.value = false
  }
}
</script>
