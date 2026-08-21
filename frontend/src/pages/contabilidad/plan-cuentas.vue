<script setup lang="ts">
// Plan de cuentas (CTB-7) — árbol/lista del chart of accounts + alta + seed base.
import { ref, computed, onMounted } from 'vue'
import { AccountingService, type Account, type AccountType } from '@/services/Accounting.service'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const toast = useToast()
const accounts = ref<Account[]>([])
const loading = ref(false)
const showModal = ref(false)
const saving = ref(false)
const seeding = ref(false)

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'asset', label: 'Activo' }, { value: 'liability', label: 'Pasivo' },
  { value: 'equity', label: 'Patrimonio' }, { value: 'income', label: 'Ingreso' }, { value: 'expense', label: 'Gasto' },
]
const typeLabel = (t: AccountType) => TYPES.find(x => x.value === t)?.label ?? t

const form = ref<{ code: string; name: string; type: AccountType; isPostable: boolean }>({ code: '', name: '', type: 'asset', isPostable: true })
const sorted = computed(() => [...accounts.value].sort((a, b) => a.code.localeCompare(b.code)))

async function load() {
  loading.value = true
  try { accounts.value = (await AccountingService.listAccounts()).data || [] }
  catch (e: any) { toast.error(e.message || 'Error al cargar cuentas') }
  finally { loading.value = false }
}

async function seed() {
  seeding.value = true
  try {
    const r = await AccountingService.seedChart()
    toast.success(`Plan de cuentas base: ${r.created} cuentas creadas`)
    await load()
  } catch (e: any) { toast.error(e.message || 'Error al sembrar el plan') }
  finally { seeding.value = false }
}

function openNew() { form.value = { code: '', name: '', type: 'asset', isPostable: true }; showModal.value = true }

async function save() {
  if (!form.value.code || !form.value.name) { toast.error('Código y nombre son obligatorios'); return }
  saving.value = true
  try {
    await AccountingService.createAccount({ code: form.value.code, name: form.value.name, type: form.value.type, isPostable: form.value.isPostable ? 1 : 0 })
    toast.success('Cuenta creada'); showModal.value = false; await load()
  } catch (e: any) { toast.error(e.message || 'Error al crear la cuenta') }
  finally { saving.value = false }
}

// Sangría por nivel de código (1.1.01 → 2 puntos → nivel 2).
const indent = (code: string) => (code.split('.').length - 1)

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Plan de Cuentas</h2>
        <p class="text-sm text-text-muted mt-0.5">El catálogo de cuentas contables de tu hotel.</p>
      </div>
      <div class="flex gap-2">
        <button v-if="!loading && accounts.length === 0" @click="seed" :disabled="seeding"
          class="px-4 py-2.5 bg-navy/5 hover:bg-navy/10 text-navy rounded-full text-sm font-bold cursor-pointer disabled:opacity-50">
          {{ seeding ? 'Sembrando…' : 'Sembrar plan base' }}
        </button>
        <button @click="openNew" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">Nueva cuenta</button>
      </div>
    </div>

    <SectionCard title="Cuentas" :subtitle="`${accounts.length} cuenta(s)`" body-class="p-0">
      <div v-if="loading" class="p-8 text-center text-sm text-text-muted">Cargando…</div>
      <EmptyState v-else-if="!accounts.length" title="Sin plan de cuentas"
        message="Sembrá el plan de cuentas base (36 cuentas estándar) o creá las tuyas." >
        <template #action>
          <button @click="seed" :disabled="seeding" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold cursor-pointer disabled:opacity-50">Sembrar plan base</button>
        </template>
      </EmptyState>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[560px] tbl-head">
          <thead><tr>
            <th class="text-left px-4 py-3 text-[10px]">Código</th>
            <th class="text-left px-4 py-3 text-[10px]">Nombre</th>
            <th class="text-left px-4 py-3 text-[10px]">Tipo</th>
            <th class="text-left px-4 py-3 text-[10px]">Postea</th>
          </tr></thead>
          <tbody>
            <tr v-for="a in sorted" :key="a.id" class="border-b border-border last:border-0 hover:bg-surface/60">
              <td class="px-4 py-2.5 text-sm font-mono text-navy">{{ a.code }}</td>
              <td class="px-4 py-2.5 text-sm" :style="{ paddingLeft: `${16 + indent(a.code) * 16}px` }"
                :class="a.isPostable ? 'text-text-secondary' : 'font-bold text-navy'">{{ a.name }}</td>
              <td class="px-4 py-2.5 text-[11px]"><span class="rounded-full bg-navy/5 px-2 py-0.5 font-bold text-navy">{{ typeLabel(a.type) }}</span></td>
              <td class="px-4 py-2.5 text-sm">{{ a.isPostable ? '✓' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <AppModal v-if="showModal" size="md" title="Nueva cuenta" @close="showModal = false">
      <div class="space-y-4">
        <div>
          <label for="contabilidad-plan-cuentas-codigo" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Código</label>
          <input id="contabilidad-plan-cuentas-codigo" name="code" required aria-required="true" v-model="form.code" placeholder="1.1.01" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-mono focus:outline-none focus:border-navy" />
        </div>
        <div>
          <label for="contabilidad-plan-cuentas-nombre" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Nombre</label>
          <input id="contabilidad-plan-cuentas-nombre" name="name" required aria-required="true" v-model="form.name" placeholder="Caja" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <div>
          <label for="contabilidad-plan-cuentas-tipo" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Tipo</label>
          <select id="contabilidad-plan-cuentas-tipo" name="type" required aria-required="true" v-model="form.type" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer focus:outline-none focus:border-navy">
            <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>
        <label class="flex items-center gap-2 text-sm text-navy cursor-pointer">
          <input id="contabilidad-plan-cuentas-acepta-asientos-cuenta-imputable" name="isPostable" type="checkbox" v-model="form.isPostable" /> Acepta asientos (cuenta imputable)
        </label>
      </div>
      <template #footer>
        <button @click="showModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando…' : 'Crear' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped></style>
