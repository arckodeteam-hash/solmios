<script setup lang="ts">
// Proveedores (TES-6) — catálogo para cuentas por pagar (AP) y órdenes de compra.
import { ref, onMounted } from 'vue'
import { TreasuryService, type Supplier } from '@/services/Treasury.service'
import { useToast } from '@/composables/useToast'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const toast = useToast()
const suppliers = ref<Supplier[]>([])
const loading = ref(false)
const showModal = ref(false)
const saving = ref(false)
const deleting = ref('')   // id en curso de borrado (evita doble-click)
const editingId = ref<string | null>(null)

const form = ref<{ name: string; taxId: string; contact: string; email: string; phone: string; active: number }>({ name: '', taxId: '', contact: '', email: '', phone: '', active: 1 })

async function load() {
  loading.value = true
  try { suppliers.value = (await TreasuryService.listSuppliers()).data || [] }
  catch (e: any) { toast.error(e.message || 'Error al cargar proveedores') }
  finally { loading.value = false }
}

function openNew() {
  editingId.value = null
  form.value = { name: '', taxId: '', contact: '', email: '', phone: '', active: 1 }
  showModal.value = true
}
function openEdit(s: Supplier) {
  editingId.value = s.id
  form.value = { name: s.name || '', taxId: s.taxId || '', contact: s.contact || '', email: s.email || '', phone: s.phone || '', active: s.active ?? 1 }
  showModal.value = true
}
async function save() {
  if (!form.value.name) { toast.error('El nombre es obligatorio'); return }
  saving.value = true
  try {
    const dto = { name: form.value.name, taxId: form.value.taxId, contact: form.value.contact, email: form.value.email, phone: form.value.phone, active: form.value.active }
    if (editingId.value) { await TreasuryService.updateSupplier(editingId.value, dto); toast.success('Proveedor actualizado') }
    else { await TreasuryService.createSupplier(dto); toast.success('Proveedor creado') }
    showModal.value = false; await load()
  } catch (e: any) { toast.error(e.message || 'Error al guardar') }
  finally { saving.value = false }
}
async function remove(s: Supplier) {
  if (deleting.value) return
  if (!confirm(`¿Eliminar a "${s.name}"? Solo si no tiene cuentas por pagar asociadas.`)) return
  deleting.value = s.id
  try { await TreasuryService.deleteSupplier(s.id); toast.success('Proveedor eliminado'); await load() }
  catch (e: any) { toast.error(e.message || 'Error al eliminar') }
  finally { deleting.value = '' }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Proveedores</h2>
        <p class="text-sm text-text-muted mt-0.5">Catálogo de proveedores para cuentas por pagar (AP) y órdenes de compra.</p>
      </div>
      <button @click="openNew" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg cursor-pointer">Nuevo proveedor</button>
    </div>

    <div v-if="loading" class="p-8 text-center text-sm text-text-muted">Cargando…</div>
    <EmptyState v-else-if="!suppliers.length" title="Sin proveedores" message="Cargá tus proveedores para gestionar las cuentas por pagar.">
      <template #action><button @click="openNew" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold cursor-pointer">Nuevo proveedor</button></template>
    </EmptyState>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="s in suppliers" :key="s.id" class="rounded-2xl border border-border bg-white p-4 card-shadow">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm font-black text-navy truncate">{{ s.name }}</div>
            <div class="text-[11px] text-text-muted">TAX/ID: {{ s.taxId || '—' }}</div>
          </div>
          <span :class="['rounded-full px-2 py-0.5 text-[9px] font-bold uppercase shrink-0', s.active === 0 ? 'bg-danger/10 text-danger' : 'bg-teal/10 text-teal']">{{ s.active === 0 ? 'Inactivo' : 'Activo' }}</span>
        </div>
        <div class="mt-2 text-xs text-text-muted space-y-0.5">
          <div v-if="s.contact">{{ s.contact }}</div>
          <div v-if="s.email">{{ s.email }}</div>
          <div v-if="s.phone">{{ s.phone }}</div>
          <div v-if="!s.contact && !s.email && !s.phone" class="italic">Sin datos de contacto</div>
        </div>
        <div class="mt-3 flex gap-2">
          <button @click="openEdit(s)" class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-navy bg-navy/5 hover:bg-navy/10 cursor-pointer">Editar</button>
          <button @click="remove(s)" :disabled="deleting === s.id" class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-danger hover:bg-danger/10 cursor-pointer disabled:opacity-50">{{ deleting === s.id ? 'Eliminando…' : 'Eliminar' }}</button>
        </div>
      </div>
    </div>

    <!-- Alta / Edición -->
    <AppModal v-if="showModal" size="md" :title="editingId ? 'Editar proveedor' : 'Nuevo proveedor'" @close="showModal = false">
      <div class="space-y-4">
        <div><label for="tesoreria-proveedores-nombre" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Nombre *</label>
          <input id="tesoreria-proveedores-nombre" name="name" required aria-required="true" v-model="form.name" placeholder="Proveedor SA" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label for="tesoreria-proveedores-tax-id" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">TAX / ID</label>
            <input id="tesoreria-proveedores-tax-id" name="taxId" v-model="form.taxId" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
          <div><label for="tesoreria-proveedores-telefono" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Teléfono</label>
            <input id="tesoreria-proveedores-telefono" name="phone" v-model="form.phone" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label for="tesoreria-proveedores-contacto" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Contacto</label>
            <input id="tesoreria-proveedores-contacto" name="contact" v-model="form.contact" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
          <div><label for="tesoreria-proveedores-email" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Email</label>
            <input id="tesoreria-proveedores-email" name="email" v-model="form.email" type="email" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
        </div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input id="tesoreria-proveedores-activo" type="checkbox" :checked="form.active === 1" @change="form.active = form.active === 1 ? 0 : 1" class="accent-navy" />
          <span class="text-sm text-navy font-bold">Activo</span>
        </label>
      </div>
      <template #footer>
        <button @click="showModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando…' : (editingId ? 'Guardar' : 'Crear') }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped></style>
