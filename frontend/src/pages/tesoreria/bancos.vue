<script setup lang="ts">
// Cuentas bancarias + conciliación (TES-6). Import por pegado de CSV (fecha,monto,descripción,ref).
import { ref, onMounted } from 'vue'
import { TreasuryService, type BankAccount, type Reconciliation } from '@/services/Treasury.service'
import { useToast } from '@/composables/useToast'
import { useCurrency } from '@/composables/useCurrency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const toast = useToast()
const { format } = useCurrency()
const accounts = ref<BankAccount[]>([])
const loading = ref(false)
const showNew = ref(false)
const showImport = ref(false)
const saving = ref(false)
const importing = ref(false)
const reconciling = ref('')   // id de la cuenta en conciliación (evita doble-click)
const importTarget = ref<BankAccount | null>(null)
const csv = ref('')
const lastRecon = ref<Reconciliation | null>(null)

const form = ref<{ name: string; bank: string; accountNumber: string; openingBalance: number | null; type: string }>({ name: '', bank: '', accountNumber: '', openingBalance: null, type: 'checking' })

async function load() {
  loading.value = true
  try { accounts.value = (await TreasuryService.listBankAccounts()).data || [] }
  catch (e: any) { toast.error(e.message || 'Error al cargar cuentas bancarias') }
  finally { loading.value = false }
}

function openNew() { form.value = { name: '', bank: '', accountNumber: '', openingBalance: null, type: 'checking' }; showNew.value = true }
async function save() {
  if (!form.value.name) { toast.error('El nombre es obligatorio'); return }
  saving.value = true
  try {
    await TreasuryService.createBankAccount({ name: form.value.name, bank: form.value.bank, accountNumber: form.value.accountNumber, openingBalance: Number(form.value.openingBalance || 0), type: form.value.type })
    toast.success('Cuenta bancaria creada'); showNew.value = false; await load()
  } catch (e: any) { toast.error(e.message || 'Error al crear') }
  finally { saving.value = false }
}

function openImport(a: BankAccount) { importTarget.value = a; csv.value = ''; showImport.value = true }
// Parsea líneas "fecha,monto,descripción,referencia" (una por renglón).
function parseCsv(text: string) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [date, amount, description, reference] = l.split(',').map(s => (s ?? '').trim())
    return { date, amount: Number(amount || 0), description, reference }
  }).filter(r => r.date && !Number.isNaN(r.amount))
}
async function doImport() {
  if (!importTarget.value) return
  const rows = parseCsv(csv.value)
  if (!rows.length) { toast.error('No hay movimientos válidos (formato: fecha,monto,descripción,ref)'); return }
  importing.value = true
  try {
    const r = await TreasuryService.importMovements(importTarget.value.id, rows)
    toast.success(`${r.created} de ${r.total} movimientos importados`); showImport.value = false
  } catch (e: any) { toast.error(e.message || 'Error al importar') }
  finally { importing.value = false }
}

async function reconcile(a: BankAccount) {
  if (reconciling.value) return
  reconciling.value = a.id
  try {
    lastRecon.value = await TreasuryService.reconcile(a.id)
    toast.success(`${lastRecon.value.matched} movimiento(s) conciliado(s), ${lastRecon.value.unmatchedCount} sin match`)
  } catch (e: any) { toast.error(e.message || 'Error al conciliar') }
  finally { reconciling.value = '' }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Bancos</h2>
        <p class="text-sm text-text-muted mt-0.5">Cuentas bancarias, import de movimientos y conciliación contra los cobros.</p>
      </div>
      <button @click="openNew" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg cursor-pointer">Nueva cuenta</button>
    </div>

    <div v-if="loading" class="p-8 text-center text-sm text-text-muted">Cargando…</div>
    <EmptyState v-else-if="!accounts.length" title="Sin cuentas bancarias" message="Registrá una cuenta para importar movimientos y conciliar.">
      <template #action><button @click="openNew" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold cursor-pointer">Nueva cuenta</button></template>
    </EmptyState>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="a in accounts" :key="a.id" class="rounded-2xl border border-border bg-white p-4 card-shadow">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="text-sm font-black text-navy">{{ a.name }}</div>
            <div class="text-[11px] text-text-muted">{{ a.bank || '—' }} · {{ a.accountNumber || 's/n' }}</div>
          </div>
          <span class="rounded-full bg-navy/5 px-2 py-0.5 text-[9px] font-bold uppercase text-navy">{{ a.type }}</span>
        </div>
        <div class="mt-3 text-lg font-black text-navy tabular-nums">{{ format(a.currentBalance ?? a.openingBalance ?? 0) }}</div>
        <div class="mt-3 flex gap-2">
          <button @click="openImport(a)" class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-navy bg-navy/5 hover:bg-navy/10 cursor-pointer">Importar movimientos</button>
          <button @click="reconcile(a)" :disabled="reconciling === a.id" class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-teal hover:bg-teal/10 cursor-pointer disabled:opacity-50">{{ reconciling === a.id ? 'Conciliando…' : 'Conciliar' }}</button>
        </div>
      </div>
    </div>

    <div v-if="lastRecon" class="mt-4 rounded-xl border border-teal/20 bg-teal/5 p-3.5 text-sm text-navy">
      Última conciliación: <b>{{ lastRecon.matched }}</b> conciliados · <b>{{ lastRecon.unmatchedCount }}</b> sin match.
    </div>

    <!-- Nueva cuenta -->
    <AppModal v-if="showNew" size="md" title="Nueva cuenta bancaria" @close="showNew = false">
      <div class="space-y-4">
        <div><label for="tesoreria-bancos-nombre" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Nombre</label>
          <input id="tesoreria-bancos-nombre" name="name" required aria-required="true" v-model="form.name" placeholder="Cuenta operativa" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label for="tesoreria-bancos-banco" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Banco</label>
            <input id="tesoreria-bancos-banco" name="bank" v-model="form.bank" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
          <div><label for="tesoreria-bancos-n-de-cuenta" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Nº de cuenta</label>
            <input id="tesoreria-bancos-n-de-cuenta" name="accountNumber" v-model="form.accountNumber" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label for="tesoreria-bancos-tipo" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Tipo</label>
            <select id="tesoreria-bancos-tipo" name="type" v-model="form.type" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer focus:outline-none focus:border-navy">
              <option value="checking">Corriente</option><option value="savings">Ahorro</option><option value="cash">Efectivo</option>
            </select></div>
          <div><label for="tesoreria-bancos-saldo-inicial" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Saldo inicial</label>
            <input id="tesoreria-bancos-saldo-inicial" name="openingBalance" v-model.number="form.openingBalance" type="number" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm text-right focus:outline-none focus:border-navy" /></div>
        </div>
      </div>
      <template #footer>
        <button @click="showNew = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando…' : 'Crear' }}</button>
      </template>
    </AppModal>

    <!-- Import -->
    <AppModal v-if="showImport" size="md" title="Importar movimientos" :subtitle="importTarget?.name" @close="showImport = false">
      <p class="text-[12px] text-text-muted mb-2">Pegá los movimientos, uno por línea: <code class="text-navy">fecha,monto,descripción,referencia</code>. Monto positivo = entrada, negativo = salida.</p>
      <textarea id="tesoreria-bancos-csv" name="csv" aria-label="Movimientos en CSV: fecha, monto, descripción, referencia" v-model="csv" rows="8" placeholder="2026-07-10,200,Cobro reserva,REF123&#10;2026-07-12,-80,Comisión,REF124"
        class="w-full border border-border rounded-xl p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-cyan"></textarea>
      <template #footer>
        <button @click="showImport = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="doImport" :disabled="importing" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light cursor-pointer disabled:opacity-50">{{ importing ? 'Importando…' : 'Importar' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped></style>
