<script setup lang="ts">
// Libro diario (CTB-7) — asientos por período + alta de asiento manual + postear/revertir.
import { ref, computed, onMounted } from 'vue'
import { AccountingService, type JournalEntry, type Account } from '@/services/Accounting.service'
import { useToast } from '@/composables/useToast'
import { useCurrency } from '@/composables/useCurrency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const toast = useToast()
const { format } = useCurrency()
const entries = ref<JournalEntry[]>([])
const accounts = ref<Account[]>([])
const loading = ref(false)
const period = ref('')
const showModal = ref(false)
const saving = ref(false)

const postable = computed(() => accounts.value.filter(a => a.isPostable))
const statusLabel: Record<string, string> = { draft: 'Borrador', posted: 'Posteado', reversed: 'Revertido' }
const statusClass: Record<string, string> = { draft: 'bg-gold/10 text-gold', posted: 'bg-teal/10 text-teal', reversed: 'bg-surface text-text-muted' }

// Formulario de asiento manual
type LineForm = { accountId: string; debit: number | null; credit: number | null }
const form = ref<{ entryDate: string; description: string; lines: LineForm[] }>({ entryDate: '', description: '', lines: [] })
const totalDebit = computed(() => form.value.lines.reduce((s, l) => s + Number(l.debit || 0), 0))
const totalCredit = computed(() => form.value.lines.reduce((s, l) => s + Number(l.credit || 0), 0))
const balanced = computed(() => Math.abs(totalDebit.value - totalCredit.value) < 0.005 && totalDebit.value > 0)

async function load() {
  loading.value = true
  try {
    const [e, a] = await Promise.all([AccountingService.listJournal(period.value || undefined), AccountingService.listAccounts()])
    entries.value = e.data || []; accounts.value = a.data || []
  } catch (err: any) { toast.error(err.message || 'Error al cargar el diario') }
  finally { loading.value = false }
}

function openNew() {
  const today = new Date().toISOString().slice(0, 10)
  form.value = { entryDate: today, description: '', lines: [{ accountId: '', debit: null, credit: null }, { accountId: '', debit: null, credit: null }] }
  showModal.value = true
}
function addLine() { form.value.lines.push({ accountId: '', debit: null, credit: null }) }
function removeLine(i: number) { if (form.value.lines.length > 2) form.value.lines.splice(i, 1) }

async function save() {
  if (!balanced.value) { toast.error('El asiento no cuadra (debe = haber, > 0)'); return }
  // Descartar líneas de relleno vacías (sin cuenta y sin importe) antes de enviar.
  const lines = form.value.lines.filter(l => l.accountId || Number(l.debit) || Number(l.credit))
  if (lines.length < 2) { toast.error('El asiento necesita al menos 2 líneas'); return }
  if (lines.some(l => !l.accountId)) { toast.error('Todas las líneas necesitan una cuenta'); return }
  if (lines.some(l => Number(l.debit || 0) > 0 && Number(l.credit || 0) > 0)) { toast.error('Cada línea es debe O haber, no ambos'); return }
  saving.value = true
  try {
    await AccountingService.createEntry({
      entryDate: form.value.entryDate, description: form.value.description,
      lines: lines.map(l => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
    })
    toast.success('Asiento creado (borrador)'); showModal.value = false; await load()
  } catch (e: any) { toast.error(e.message || 'Error al crear el asiento') }
  finally { saving.value = false }
}

async function post(e: JournalEntry) {
  try { await AccountingService.postEntry(e.id); toast.success('Asiento posteado'); await load() }
  catch (err: any) { toast.error(err.message || 'Error al postear') }
}
async function reverse(e: JournalEntry) {
  try { await AccountingService.reverseEntry(e.id); toast.success('Asiento revertido'); await load() }
  catch (err: any) { toast.error(err.message || 'Error al revertir') }
}

const accName = (id: string) => accounts.value.find(a => a.id === id)?.code ?? id

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Libro Diario</h2>
        <p class="text-sm text-text-muted mt-0.5">Los asientos contables. El operativo del hotel los genera solo; acá cargás ajustes.</p>
      </div>
      <div class="flex gap-2 items-center">
        <input id="contabilidad-libro-diario-periodo" name="period" aria-label="Período del libro diario" v-model="period" type="month" @change="load" class="px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-navy" />
        <button @click="openNew" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg cursor-pointer">Nuevo asiento</button>
      </div>
    </div>

    <SectionCard title="Asientos" :subtitle="`${entries.length} asiento(s)`" body-class="p-0">
      <div v-if="loading" class="p-8 text-center text-sm text-text-muted">Cargando…</div>
      <EmptyState v-else-if="!entries.length" title="Sin asientos" message="No hay asientos en este período. Cargá uno manual o generá movimientos operativos." />
      <div v-else class="divide-y divide-border">
        <div v-for="e in entries" :key="e.id" class="px-4 py-3">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-navy">{{ e.entryDate }}</span>
                <span class="rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase" :class="statusClass[e.status]">{{ statusLabel[e.status] }}</span>
                <span v-if="e.source === 'connector'" class="rounded-full bg-navy/5 px-2 py-0.5 text-[9px] font-bold text-text-muted">Auto</span>
              </div>
              <div class="text-[12px] text-text-muted truncate">{{ e.description || '—' }} <span v-if="e.referenceType" class="opacity-60">· {{ e.referenceType }}</span></div>
            </div>
            <div class="flex gap-1.5">
              <button v-if="e.status === 'draft'" @click="post(e)" class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-teal hover:bg-teal/10 cursor-pointer">Postear</button>
              <button v-if="e.status === 'posted'" @click="reverse(e)" class="px-3 py-1.5 rounded-lg text-[11px] font-bold text-danger hover:bg-danger/10 cursor-pointer">Revertir</button>
            </div>
          </div>
          <div v-if="e.lines?.length" class="mt-2 rounded-lg bg-surface/50 px-3 py-2 text-[12px] font-mono">
            <div v-for="l in e.lines" :key="l.id" class="flex justify-between gap-4">
              <span class="text-text-secondary">{{ accName(l.accountId) }}</span>
              <span class="tabular-nums">{{ Number(l.debit) ? format(Number(l.debit)) : '' }}<span class="text-text-muted"> / </span>{{ Number(l.credit) ? format(Number(l.credit)) : '' }}</span>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>

    <AppModal v-if="showModal" size="lg" title="Nuevo asiento manual" @close="showModal = false">
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="contabilidad-libro-diario-fecha" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Fecha</label>
            <input id="contabilidad-libro-diario-fecha" name="entryDate" v-model="form.entryDate" type="date" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label for="contabilidad-libro-diario-descripcion" class="block text-[11px] font-bold text-text-muted uppercase mb-1.5">Descripción</label>
            <input id="contabilidad-libro-diario-descripcion" name="description" v-model="form.description" placeholder="Ajuste…" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
        </div>
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-[11px] font-bold text-text-muted uppercase">Líneas (debe / haber)</label>
            <button @click="addLine" class="text-[11px] font-bold text-navy hover:underline cursor-pointer">+ Agregar línea</button>
          </div>
          <div class="space-y-2">
            <div v-for="(l, i) in form.lines" :key="i" class="flex gap-2 items-center">
              <select :id="`asiento-linea-${i}-cuenta`" :aria-label="`Cuenta de la línea ${i + 1}`" v-model="l.accountId" class="flex-1 px-3 py-2 rounded-lg border border-border text-sm cursor-pointer focus:outline-none focus:border-navy">
                <option value="">Cuenta…</option>
                <option v-for="a in postable" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
              </select>
              <input :id="`asiento-linea-${i}-debe`" :aria-label="`Debe de la línea ${i + 1}`" v-model.number="l.debit" type="number" min="0" placeholder="Debe" class="w-24 px-2 py-2 rounded-lg border border-border text-sm text-right focus:outline-none focus:border-navy" />
              <input :id="`asiento-linea-${i}-haber`" :aria-label="`Haber de la línea ${i + 1}`" v-model.number="l.credit" type="number" min="0" placeholder="Haber" class="w-24 px-2 py-2 rounded-lg border border-border text-sm text-right focus:outline-none focus:border-navy" />
              <button @click="removeLine(i)" class="text-text-muted hover:text-danger cursor-pointer px-1">×</button>
            </div>
          </div>
          <div class="mt-2 flex justify-end gap-4 text-sm font-bold" :class="balanced ? 'text-teal' : 'text-danger'">
            <span>Debe: {{ format(totalDebit) }}</span><span>Haber: {{ format(totalCredit) }}</span>
            <span>{{ balanced ? '✓ cuadra' : 'no cuadra' }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="showModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer">Cancelar</button>
        <button @click="save" :disabled="saving || !balanced" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando…' : 'Crear asiento' }}</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped></style>
