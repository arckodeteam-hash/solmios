<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-black text-navy">Planes de Suscripción</h1>
        <p class="text-sm text-text-muted">Gestiona los planes SaaS de la plataforma</p>
      </div>
      <button @click="openNew" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer">+ Nuevo Plan</button>
    </div>

    <SkeletonLoader v-if="loading" variant="card" :rows="3" class="mb-8" />
    <SectionCard v-else title="Planes" :subtitle="`${plans.length} plan(es) configurado(s)`" class="mb-8">
      <div class="grid grid-cols-3 gap-6">
        <div v-for="plan in plans" :key="plan.id" class="bg-white rounded-2xl border border-border card-shadow p-6 relative">
          <button @click="openEdit(plan)" class="absolute top-4 right-4 px-2 py-1 bg-surface rounded-lg text-[10px] font-bold hover:bg-surface-dark transition-colors cursor-pointer">Editar</button>
          <button @click="deletePlan(plan)" class="absolute top-4 right-20 px-2 py-1 bg-red-50 text-red-500 rounded-lg text-[10px] font-bold hover:bg-red-100 transition-colors cursor-pointer">Eliminar</button>
          <h3 class="text-lg font-black text-navy mb-2">{{ plan.name }}</h3>
          <div class="text-3xl font-black text-teal mb-2">${{ plan.price }}<span class="text-sm text-text-muted">/mes</span></div>
          <div class="text-sm text-text-secondary mb-4">{{ plan.description }}</div>
          <div class="space-y-2 mb-6">
            <div v-for="(feature, i) in (plan.features || [])" :key="i" class="flex items-center gap-2 text-sm">
              <span class="text-teal">✓</span><span>{{ feature }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between pt-4 border-t border-border">
            <div class="text-center">
              <div class="text-lg font-black text-navy">{{ plan.limits?.rooms || 0 }}</div>
              <div class="text-[9px] text-text-muted">Hab.</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-black text-navy">{{ plan.limits?.users || 0 }}</div>
              <div class="text-[9px] text-text-muted">Usuarios</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-black text-navy">{{ plan.limits?.properties || 0 }}</div>
              <div class="text-[9px] text-text-muted">Propiedades</div>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- Modal -->
    <AppModal v-if="showModal" size="lg" :title="`${editing ? 'Editar' : 'Nuevo'} Plan`" @close="showModal=false">
      <div class="space-y-4">
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Nombre *</label>
              <input v-model="form.name" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Precio $ *</label>
                <input v-model.number="form.price" type="number" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
              </div>
              <div>
                <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Moneda</label>
                <input v-model="form.currency" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
              </div>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Descripción</label>
              <textarea v-model="form.description" rows="2" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm resize-none"></textarea>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Features (una por línea)</label>
              <textarea v-model="featuresText" rows="4" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm resize-none" placeholder="Hasta 30 habitaciones&#10;2 usuarios&#10;Reportes básicos"></textarea>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div>
                <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Máx. Hab.</label>
                <input v-model.number="form.limits.rooms" type="number" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
              </div>
              <div>
                <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Máx. Usuarios</label>
                <input v-model.number="form.limits.users" type="number" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
              </div>
              <div>
                <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Máx. Propiedades</label>
                <input v-model.number="form.limits.properties" type="number" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-[10px] font-bold text-text-muted uppercase">Módulos incluidos</label>
                <span v-if="totalKeys" class="text-[11px] font-bold text-teal">{{ effectiveIncluded }} de {{ totalKeys }} claves</span>
              </div>
              <p class="text-[11px] text-text-muted mb-2">
                Módulo tildado = módulo <strong>completo</strong> (incluye todos sus submódulos). Destildalo para elegir submódulos sueltos.
                Sin nada marcado = <strong>todos</strong> (compatibilidad).
              </p>
              <div class="flex items-center gap-2 mb-2">
                <input v-model="search" placeholder="Buscar módulo o submódulo..." class="flex-1 px-3 py-1.5 bg-surface border border-border rounded-xl text-xs" />
                <button type="button" @click="selectAll" class="px-3 py-1.5 bg-surface border border-border rounded-xl text-[11px] font-bold cursor-pointer hover:bg-surface-dark transition-colors">Todo</button>
                <button type="button" @click="selectNone" class="px-3 py-1.5 bg-surface border border-border rounded-xl text-[11px] font-bold cursor-pointer hover:bg-surface-dark transition-colors">Ninguno</button>
              </div>
              <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                <div v-for="m in visibleCatalog" :key="m.key" class="rounded-xl border" :class="isFullModule(form.modules, m) ? 'border-teal bg-teal/5' : 'border-border bg-surface'">
                  <!-- Módulo: tildado = COMPLETO. Destildar el completo deja los hijos sueltos (parcial). -->
                  <button type="button" @click="toggleFull(m)"
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-left cursor-pointer"
                    :class="isFullModule(form.modules, m) ? 'text-teal' : 'text-text-secondary'">
                    <span class="w-4 h-4 rounded flex items-center justify-center shrink-0 border" :class="isFullModule(form.modules, m) ? 'bg-teal border-teal text-white' : 'border-border'">
                      <span v-if="isFullModule(form.modules, m)" class="text-[10px] leading-none">✓</span>
                    </span>
                    {{ m.label }}
                    <span v-if="m.children.length" class="ml-auto text-[10px] font-semibold" :class="isFullModule(form.modules, m) ? 'text-teal' : 'text-text-muted'">{{ moduleBadge(m) }}</span>
                  </button>
                  <!-- Submódulos: con el padre tildado van "por el módulo" (bloqueados); sueltos = parcial -->
                  <div v-if="m.children.length" class="px-3 pb-2 pl-9 grid grid-cols-2 gap-1.5">
                    <button v-for="c in m.children" :key="c.key" type="button" @click="toggleSub(m, c.key)"
                      :disabled="isFullModule(form.modules, m)"
                      class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] font-semibold text-left transition-colors"
                      :class="[childIncluded(m, c) ? 'text-navy' : 'text-text-muted', isFullModule(form.modules, m) ? 'cursor-not-allowed opacity-70' : 'cursor-pointer']"
                      :title="isFullModule(form.modules, m) ? 'Incluido por el módulo completo — destildá el módulo para elegir partes' : c.key">
                      <span class="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border" :class="childIncluded(m, c) ? 'bg-teal border-teal text-white' : 'border-border'">
                        <span v-if="childIncluded(m, c)" class="text-[9px] leading-none">✓</span>
                      </span>
                      {{ c.label }}
                      <span v-if="isFullModule(form.modules, m)" class="ml-auto text-[9px] italic text-text-muted">por el módulo</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
      </div>
      <template #footer>
        <button @click="showModal=false" class="px-5 py-2.5 border border-border rounded-xl text-sm font-bold text-text-secondary cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando...' : 'Guardar' }}</button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { PlansService } from '@/services/Plans.service'
import { ModulesService, type CatalogModuleDTO, type CatalogChildDTO } from '@/services/Platform.service'
import {
  isFullModule, looseChildren, toggleModule, toggleChild,
  selectAllModules, selectNoModules, totalCatalogKeys, effectiveCount,
} from './plan-modules'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { CurrencyCode } from '@/types/currency'
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => toast.success('Plan eliminado'),
  onError: (e) => toast.error((e as any)?.message || 'Error al eliminar'),
})

const plans = ref<any[]>([])
const loading = ref(true)
const showModal = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
// Árbol módulo→submódulos del endpoint (/admin/modules/catalog): la MISMA fuente que lee el
// gate en el backend. La lista no se duplica en el frontend.
const moduleCatalog = ref<CatalogModuleDTO[]>([])
const search = ref('')

const emptyForm = () => ({ name: '', price: 0, currency: CurrencyCode.USD, description: '', features: [] as string[], modules: [] as string[], limits: { rooms: 30, users: 2, properties: 1 } })
const form = ref(emptyForm())
const featuresText = ref('')

const features = computed(() => featuresText.value.split('\n').filter(f => f.trim()))

// Catálogo filtrado por búsqueda (matchea módulo O cualquiera de sus submódulos).
const visibleCatalog = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return moduleCatalog.value
  return moduleCatalog.value.filter(m =>
    m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)
    || m.children.some(c => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)))
})
const effectiveIncluded = computed(() => effectiveCount(form.value.modules, moduleCatalog.value))
const totalKeys = computed(() => totalCatalogKeys(moduleCatalog.value))

// Semántica del editor (espeja el gate): padre tildado = módulo COMPLETO (los hijos van por el
// padre y se muestran bloqueados); destildar el padre deja los hijos sueltos = selección parcial.
// El builder (./plan-modules) arma el array: solo claves padre para completo, sub-claves sueltas
// para parcial — nunca ambas.
function toggleFull(m: CatalogModuleDTO) {
  form.value.modules = toggleModule(form.value.modules, m)
}
function toggleSub(m: CatalogModuleDTO, childKey: string) {
  form.value.modules = toggleChild(form.value.modules, m, childKey)
}
function childIncluded(m: CatalogModuleDTO, c: CatalogChildDTO): boolean {
  return isFullModule(form.value.modules, m) || looseChildren(form.value.modules, m).has(c.key)
}
function moduleBadge(m: CatalogModuleDTO): string {
  if (isFullModule(form.value.modules, m)) return 'Completo'
  return `${looseChildren(form.value.modules, m).size}/${m.children.length}`
}
function selectAll() {
  form.value.modules = selectAllModules(moduleCatalog.value)
}
function selectNone() {
  form.value.modules = selectNoModules()
}

function openNew() {
  editing.value = null
  form.value = emptyForm()
  featuresText.value = ''
  search.value = ''
  showModal.value = true
}

function openEdit(plan: any) {
  editing.value = plan
  // La matriz se carga TAL CUAL está persistida: un plan con el padre listado se muestra como
  // módulo completo (los hijos van por el padre) — no se expande ni se re-escribe al abrir.
  form.value = { name: plan.name, price: plan.price, currency: plan.currency || 'USD', description: plan.description || '', features: plan.features || [], modules: [...(plan.modules || [])], limits: plan.limits || { rooms: 30, users: 2, properties: 1 } }
  featuresText.value = (plan.features || []).join('\n')
  search.value = ''
  showModal.value = true
}

async function loadPlans() {
  loading.value = true
  try {
    const { data } = await PlansService.list()
    plans.value = data || []
  } finally { loading.value = false }
}
async function loadModuleCatalog() {
  try { moduleCatalog.value = await ModulesService.catalog() } catch { /* opcional: el editor queda vacío, no bloquea el alta */ }
}

async function save() {
  saving.value = true
  try {
    const payload = { ...form.value, features: features.value }
    if (editing.value) {
      await PlansService.update(editing.value.id, payload)
      toast.success('Plan actualizado')
    } else {
      await PlansService.create(payload)
      toast.success('Plan creado')
    }
    showModal.value = false
    await loadPlans()
  } catch (e: any) {
    toast.error(e.message || 'Error al guardar')
  } finally { saving.value = false }
}

function deletePlan(plan: any) {
  askConfirm({
    title: 'Eliminar plan',
    message: `¿Eliminar plan "${plan.name}"? No se puede deshacer.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await PlansService.remove(plan.id)
      await loadPlans()
    },
  })
}

onMounted(() => { loadPlans(); loadModuleCatalog() })
</script>
