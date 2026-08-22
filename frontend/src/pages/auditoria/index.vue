<template>
  <div>
    <div class="mb-4">
      <h2 class="text-xl font-black text-navy">Auditoría</h2>
      <p class="text-xs text-text-muted mt-0.5">Bitácora de acciones sensibles de tu hotel (borrados, cambios de configuración, etc.)</p>
    </div>

    <SectionCard
      title="Registro de actividad"
      :subtitle="total ? `${total} evento(s)` : undefined"
      body-class="p-0"
    >
      <!-- M3 (qa-ui config-2026-08-22): filtro por rango de fechas, usuario y acción + export CSV. -->
      <div class="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <label class="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Desde
          <input
            id="auditoria-from"
            v-model="filters.from"
            type="date"
            aria-label="Filtrar eventos desde esta fecha"
            class="rounded-lg border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy"
            @change="applyFilters"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Hasta
          <input
            id="auditoria-to"
            v-model="filters.to"
            type="date"
            aria-label="Filtrar eventos hasta esta fecha"
            class="rounded-lg border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy"
            @change="applyFilters"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Usuario
          <select
            id="auditoria-user"
            v-model="filters.userId"
            aria-label="Filtrar eventos por usuario"
            class="cursor-pointer rounded-lg border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy"
            @change="applyFilters"
          >
            <option value="">Todos</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-bold text-text-secondary">
          Acción
          <select
            id="auditoria-action"
            v-model="filters.action"
            aria-label="Filtrar eventos por acción"
            class="cursor-pointer rounded-lg border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy"
            @change="applyFilters"
          >
            <option value="">Todas</option>
            <option v-for="a in actions" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
        <button
          v-if="hasFilters"
          class="cursor-pointer rounded-full border border-border px-4 py-1.5 text-xs font-bold text-text-secondary hover:bg-surface transition"
          @click="clearFilters"
        >
          Limpiar filtros
        </button>
        <button
          class="ml-auto flex items-center gap-1.5 rounded-full bg-navy px-4 py-1.5 text-xs font-bold text-white hover:shadow-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="exporting || loading || total === 0"
          title="Exportar los eventos filtrados a CSV"
          @click="exportCsv"
        >
          {{ exporting ? 'Exportando…' : 'Exportar CSV' }}
        </button>
      </div>

      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="n in 6" :key="n" class="h-12 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <EmptyState
        v-else-if="loadError"
        title="No se pudo cargar la auditoría"
        message="Hubo un problema consultando el registro. Probá de nuevo."
      >
        <template #action>
          <button class="rounded-full bg-navy px-5 py-2 text-sm font-bold text-white hover:shadow-lg cursor-pointer" @click="reload">
            Reintentar
          </button>
        </template>
      </EmptyState>

      <EmptyState
        v-else-if="rows.length === 0"
        :title="hasFilters ? 'Sin eventos para estos filtros' : 'Sin eventos registrados'"
        :message="hasFilters ? 'Probá ampliar el rango de fechas o quitar el filtro de usuario/acción.' : 'Todavía no hay acciones sensibles registradas en tu hotel.'"
      />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] tbl-head">
          <thead>
            <tr>
              <th class="px-4 py-3 text-left">Fecha</th>
              <th class="px-4 py-3 text-left">Usuario</th>
              <th class="px-4 py-3 text-left">Acción</th>
              <th class="px-4 py-3 text-left">Entidad</th>
              <th class="px-4 py-3 text-left">Detalle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" class="border-t border-border hover:bg-surface/50">
              <td class="px-4 py-3 whitespace-nowrap text-xs text-text-muted">{{ formatDate(row.createdAt) }}</td>
              <td class="px-4 py-3 text-sm font-bold text-navy">{{ row.userName || 'Sistema' }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full bg-navy/5 px-2.5 py-1 text-[11px] font-bold text-navy">{{ row.action }}</span>
              </td>
              <td class="px-4 py-3 text-xs text-text-secondary">{{ row.entity || '—' }}</td>
              <td class="px-4 py-3 text-xs text-text-secondary max-w-[320px] truncate">{{ row.detail || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!loading && !loadError && rows.length > 0" class="flex items-center justify-between border-t border-border p-4">
        <span class="text-xs text-text-muted">
          {{ (page - 1) * LIMIT + 1 }}–{{ (page - 1) * LIMIT + rows.length }} de {{ total }}
        </span>
        <div class="flex gap-2">
          <button
            class="rounded-full border border-border px-4 py-1.5 text-xs font-bold text-text-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            :disabled="page <= 1"
            @click="page--"
          >Anterior</button>
          <button
            class="rounded-full border border-border px-4 py-1.5 text-xs font-bold text-text-secondary disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            :disabled="page * LIMIT >= total"
            @click="page++"
          >Siguiente</button>
        </div>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { AuditLogService } from '@/services/AuditLog.service'
import { TeamService, type TeamMember } from '@/services/Team.service'
import { useToast } from '@/composables/useToast'
import type { AuditLogRecord } from '@/types'

const LIMIT = 20
/** Máximo que acepta el backend por página (MAX_LIMIT del service): lo usa el export. */
const EXPORT_PAGE = 100

const toast = useToast()

const rows = ref<AuditLogRecord[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(true)
const loadError = ref(false)
const exporting = ref(false)

const filters = ref({ from: '', to: '', userId: '', action: '' })
const users = ref<TeamMember[]>([])
/** Vocabulario de acciones: acumulado de las filas cargadas (el backend no expone un distinct). */
const actions = ref<string[]>([])

const hasFilters = computed(() =>
  !!(filters.value.from || filters.value.to || filters.value.userId || filters.value.action))

function queryFor(p: number, limit = LIMIT) {
  return {
    page: p,
    limit,
    ...(filters.value.from && { from: filters.value.from }),
    ...(filters.value.to && { to: filters.value.to }),
    ...(filters.value.userId && { userId: filters.value.userId }),
    ...(filters.value.action && { action: filters.value.action }),
  }
}

async function reload() {
  loading.value = true
  loadError.value = false
  try {
    // Sin hotelId: el backend lo resuelve del token (resolveTenant) — un hotel_admin SOLO
    // puede ver el suyo, sin importar qué se mande acá (mismo criterio que el resto del panel).
    // Sin `search`: el backend NO filtra por texto (AuditlogQuery.search existe en el tipo pero
    // el service nunca lo usa — RepositoryAdapter no soporta LIKE, mismo límite que DT-07).
    const res = await AuditLogService.list(queryFor(page.value))
    rows.value = res.data
    total.value = res.total
    const seen = new Set(actions.value)
    for (const r of res.data) if (r.action) seen.add(r.action)
    actions.value = [...seen].sort()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/** Aplica los filtros desde la página 1 (si ya estaba ahí, recarga directo). */
function applyFilters() {
  if (page.value === 1) reload()
  else page.value = 1 // el watch(page) dispara la recarga
}

function clearFilters() {
  filters.value = { from: '', to: '', userId: '', action: '' }
  applyFilters()
}

/** Export CSV de TODOS los eventos filtrados (mismo patrón que el export de habitaciones). */
async function exportCsv() {
  if (exporting.value || loading.value) return
  exporting.value = true
  try {
    const all: AuditLogRecord[] = []
    let p = 1
    // El backend pagina a lo sumo de a 100 (MAX_LIMIT): recorre hasta cubrir el total filtrado.
    while (all.length < total.value) {
      const res = await AuditLogService.list(queryFor(p, EXPORT_PAGE))
      if (!res.data.length) break
      all.push(...res.data)
      p++
    }
    if (!all.length) return

    const esc = (v: string) => /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const lines = [['Fecha', 'Usuario', 'Acción', 'Entidad', 'Detalle'].join(',')]
    for (const r of all) {
      lines.push([r.createdAt, r.userName || 'Sistema', r.action, r.entity || '', r.detail || ''].map(esc).join(','))
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success(`CSV exportado (${all.length} eventos)`)
  } catch {
    toast.error('No se pudo exportar el CSV')
  } finally {
    exporting.value = false
  }
}

async function loadUsers() {
  try {
    // Nombres del equipo por /usuarios (regla del repo: resolver usuarios SIEMPRE contra la
    // tabla users, no contra employee-profiles).
    const res = await TeamService.list()
    users.value = res.data || []
  } catch {
    users.value = [] // el filtro de usuario queda vacío, el resto de la página funciona igual
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

watch(page, reload)
onMounted(() => {
  reload()
  loadUsers()
})
</script>

<style scoped>
</style>
