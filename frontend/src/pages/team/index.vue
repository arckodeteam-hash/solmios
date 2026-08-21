<template>
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Equipo</h2>
        <p class="text-sm text-text-muted mt-0.5">Las cuentas del personal de tu hotel (usuarios y roles). Para los bienes físicos que les prestás, ver <b>Activos</b>.</p>
      </div>
      <div class="flex gap-2">
        <button @click="load" :disabled="loading" class="inline-flex items-center gap-1.5 px-4 py-2.5 bg-navy/5 hover:bg-navy/10 text-navy rounded-full text-sm font-bold cursor-pointer disabled:opacity-50 transition-colors">
          <span class="h-4 w-4 shrink-0" v-html="ICON_REFRESH"></span>{{ loading ? 'Cargando...' : 'Refrescar' }}
        </button>
        <button @click="openInvite" class="inline-flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
          <span class="h-4 w-4 shrink-0" v-html="ICON_PLUS"></span>Invitar miembro
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Miembros" :value="members.length" icon="users" accent="blue"
        unit="Cuentas del personal del hotel" />
      <KpiHeroCard label="Admins" :value="adminCount" icon="building" accent="purple"
        unit="Acceso completo al hotel" />
      <KpiHeroCard label="Recepcionistas" :value="receptionistCount" icon="checkin" accent="teal"
        unit="Reservas, check-in y check-out" />
    </div>

    <!-- Estado de ocupación del personal (#614) -->
    <SectionCard title="Estado de ocupación del personal" :subtitle="`${members.length} colaboradores en total`" class="mb-6">
      <div class="h-3 rounded-full bg-surface overflow-hidden flex mb-4">
        <div class="h-full bg-teal" :style="{ width: occPct(occupancy.available) }" title="Disponibles"></div>
        <div class="h-full bg-cyan" :style="{ width: occPct(occupancy.vacation) }" title="Vacaciones"></div>
        <div class="h-full bg-gold" :style="{ width: occPct(occupancy.leave) }" title="Licencia"></div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-xl bg-teal/5 p-3">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-teal shrink-0"></span>
            <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted truncate">Disponible</span>
          </div>
          <div class="mt-1.5 text-lg font-black leading-none tabular-nums text-navy">{{ occupancy.available }}</div>
        </div>
        <div class="rounded-xl bg-cyan/5 p-3">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-cyan shrink-0"></span>
            <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted truncate">Vacaciones</span>
          </div>
          <div class="mt-1.5 text-lg font-black leading-none tabular-nums text-navy">{{ occupancy.vacation }}</div>
        </div>
        <div class="rounded-xl bg-gold/5 p-3">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-gold shrink-0"></span>
            <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted truncate">Licencia</span>
          </div>
          <div class="mt-1.5 text-lg font-black leading-none tabular-nums text-navy">{{ occupancy.leave }}</div>
        </div>
      </div>
    </SectionCard>

    <!-- Aviso de seguridad -->
    <div class="flex items-start gap-2.5 rounded-2xl border border-cyan/20 bg-cyan/5 p-3.5 mb-6">
      <span class="h-4 w-4 shrink-0 mt-0.5 text-cyan" v-html="ICON_LOCK"></span>
      <p class="text-xs text-navy">
        Los miembros solo ven datos de <strong>tu hotel</strong>. Solo tú (admin) puedes gestionar roles.
        No puedes degradarte a ti mismo.
      </p>
    </div>

    <!-- Lista -->
    <SectionCard title="Miembros del equipo" :subtitle="`${filteredMembers.length} de ${members.length} miembro(s)`" body-class="p-0">
      <template #actions>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" v-html="ICON_SEARCH"></span>
          <input id="team-search-query" name="searchQuery" aria-label="Buscar nombre o email"
            v-model="searchQuery"
            type="text"
            placeholder="Buscar nombre o email..."
            class="w-full sm:w-64 pl-9 pr-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-cyan focus:bg-white/15 transition-colors"
          />
        </div>
        <select id="team-filter-role" name="filterRole" aria-label="Filtrar equipo por rol" v-model="filterRole" class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="all">Todos los roles</option>
          <option class="text-navy" v-for="r in presentRoles" :key="r" :value="r">{{ roleMeta(r).label }}</option>
        </select>
      </template>

      <!-- Carga inicial -->
      <div v-if="loading && members.length === 0" class="divide-y divide-border">
        <div v-for="i in 5" :key="i" class="flex items-center gap-3 px-4 py-4">
          <div class="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface"></div>
          <div class="flex-1 space-y-2">
            <div class="h-3 w-40 animate-pulse rounded bg-surface"></div>
            <div class="h-2.5 w-56 animate-pulse rounded bg-surface"></div>
          </div>
          <div class="h-6 w-24 animate-pulse rounded-full bg-surface"></div>
        </div>
      </div>

      <EmptyState
        v-else-if="!filteredMembers.length"
        :icon="ICON_USERS_EMPTY"
        :title="hasFilters ? 'Sin resultados' : 'Sin miembros'"
        :message="hasFilters ? 'Probá con otro término de búsqueda o quitá el filtro de rol.' : 'Invitá al primer miembro de tu equipo para que pueda operar el hotel.'"
      >
        <template #action>
          <button v-if="hasFilters" @click="clearFilters" class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Limpiar filtros
          </button>
          <button v-else @click="openInvite" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Invitar miembro
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Miembro</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Email</th>
              <th class="text-left px-4 py-3 text-[10px]">Rol</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Creado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in filteredMembers" :key="m.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black" :class="roleMeta(m.role).class">
                    {{ initialsOf(m.name) }}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="text-sm font-bold text-navy truncate">{{ m.name }}</span>
                      <span v-if="m.id === currentUser" class="shrink-0 rounded-full bg-cyan/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-cyan">Tú</span>
                    </div>
                    <!-- En <lg la columna Email está oculta: el dato sube como línea secundaria -->
                    <div v-if="m.email" class="text-[11px] text-text-muted truncate lg:hidden">{{ m.email }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <span v-if="m.email" class="text-sm text-text-secondary truncate">{{ m.email }}</span>
                <span v-else class="text-sm text-text-muted">Sin email</span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide" :class="roleMeta(m.role).class">
                  <span class="h-3 w-3" v-html="roleMeta(m.role).icon"></span>
                  {{ roleMeta(m.role).label }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide"
                  :class="isActive(m) ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
                  {{ isActive(m) ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden xl:table-cell">
                <span v-if="formatDate(m.createdAt)">{{ formatDate(m.createdAt) }}</span>
                <span v-else class="text-text-muted">Sin fecha</span>
              </td>
              <td class="px-4 py-3 text-right" @click.stop>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    v-if="m.id !== currentUser"
                    @click="openChangeRole(m)"
                    title="Cambiar rol"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_SHIELD"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal cambiar rol -->
    <AppModal v-if="roleModal.show" size="md" title="Cambiar rol"
      :subtitle="roleModal.member ? `${roleModal.member.name} · ${roleModal.member.email}` : ''"
      @close="roleModal.show = false">
      <div class="space-y-2">
        <button
          v-for="role in availableRoles"
          :key="role.key"
          @click="selectedRole = role.key"
          class="w-full text-left p-3 rounded-xl border-2 transition-all cursor-pointer flex items-center gap-3"
          :class="selectedRole === role.key ? 'border-navy bg-navy/5' : 'border-border hover:border-navy/30'"
        >
          <span class="h-6 w-6 shrink-0 text-navy" v-html="role.icon"></span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold text-navy">{{ role.label }}</div>
            <div class="text-[10px] text-text-muted">{{ role.description }}</div>
          </div>
          <span v-if="selectedRole === role.key" class="h-4 w-4 shrink-0 text-navy" v-html="ICON_CHECK"></span>
        </button>
      </div>

      <template #footer>
        <button @click="roleModal.show = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">
          Cancelar
        </button>
        <button @click="changeRole" :disabled="changing"
          class="inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ changing ? 'Guardando...' : 'Confirmar' }}
        </button>
      </template>
    </AppModal>

    <!-- Modal invitar -->
    <AppModal v-if="inviteModal" size="md" title="Invitar miembro" subtitle="Crea un nuevo usuario para tu hotel"
      @close="inviteModal = false">
      <div class="space-y-4">
        <div>
          <label for="team-nombre" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Nombre <span class="text-red-500">*</span></label>
          <input id="team-nombre" name="name" required aria-required="true" v-model="inviteForm.name" type="text" placeholder="Nombre y apellido" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <div>
          <label for="team-email" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Email <span class="text-red-500">*</span></label>
          <input id="team-email" name="email" required aria-required="true" v-model="inviteForm.email" type="email" placeholder="email@ejemplo.com" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
        </div>
        <div>
          <label for="team-rol-inicial" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Rol inicial</label>
          <!-- Mismo availableRoles que "Cambiar rol" más abajo: este select tenía
               solo 2 opciones hardcodeadas y era el único punto donde se podía
               asignar housekeeper/maintenance/supervisor AL INVITAR (quedaba el
               rodeo de invitar como recepcionista y cambiar el rol después). -->
          <select id="team-rol-inicial" name="role" v-model="inviteForm.role" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
            <option v-for="role in availableRoles" :key="role.key" :value="role.key">{{ role.label }}</option>
          </select>
        </div>
        <div>
          <label for="team-contrasena-temporal" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Contraseña temporal</label>
          <input id="team-contrasena-temporal" name="password" v-model="inviteForm.password" type="text" placeholder="auto-generada si vacío" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-mono focus:outline-none focus:border-navy" />
        </div>
      </div>

      <template #footer>
        <button @click="inviteModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">
          Cancelar
        </button>
        <button @click="sendInvite" :disabled="inviting"
          class="inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ inviting ? 'Creando...' : 'Crear y enviar' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { TeamService, roleMeta, ROLE_META, ICON_USER } from '@/services/Team.service'
import type { TeamMember, Role } from '@/services/Team.service'
import { EmpleadosService } from '@/services/Empleados.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'

const ICON_REFRESH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"/></svg>'
const ICON_SHIELD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s8-4 8-10V5l-8-3-8 3v6c0 6 8 10 8 10Z"/><path stroke-linecap="round" stroke-linejoin="round" d="m9.5 11.5 1.8 1.8 3.4-3.6"/></svg>'
const ICON_LOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
const ICON_USERS_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'

const auth = useAuthStore()
const toast = useToast()

const currentUser = computed(() => auth.user?.id || '')
const members = ref<TeamMember[]>([])
const loading = ref(false)

const adminCount = computed(() => members.value.filter(m => m.role === 'hotel_admin').length)
const receptionistCount = computed(() => members.value.filter(m => m.role === 'receptionist').length)

// Filtros de la vista (client-side sobre el listado ya cargado)
const searchQuery = ref('')
const filterRole = ref('all')
const hasFilters = computed(() => !!searchQuery.value || filterRole.value !== 'all')

// Solo se ofrecen en el desplegable los roles que realmente existen en el equipo.
// Se descartan los vacíos: hay usuarios legacy sin rol y generaban una <option> en blanco.
const presentRoles = computed(() => [...new Set(members.value.map(m => m.role).filter(Boolean))])

const filteredMembers = computed(() => {
  let result = members.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q)
    )
  }
  if (filterRole.value !== 'all') result = result.filter(m => m.role === filterRole.value)
  return result
})

function clearFilters() {
  searchQuery.value = ''
  filterRole.value = 'all'
}

function initialsOf(name?: string): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

// `active` puede venir 1/true del backend, o undefined si el campo no viaja (se asume activo).
function isActive(m: TeamMember): boolean {
  return m.active === 1 || m.active === true || m.active === undefined
}

// Catálogo de roles del hotel (sistema + PERSONALIZADOS) traído del backend GET /roles.
// Antes se derivaba solo de ROLE_META (los 6 de sistema): un rol custom se creaba pero era
// IMPOSIBLE asignarlo a un empleado desde acá. Ahora los custom aparecen en los desplegables.
const rolesCatalog = ref<Role[]>([])

// `super_admin` se excluye: es rol de plataforma, no se asigna desde el panel del hotel.
// Roles de sistema usan su meta (label/icono/descripción); los custom, su propio nombre e icono.
const availableRoles = computed(() => {
  const fromBackend = rolesCatalog.value
    .filter(r => r.name && r.name !== 'super_admin')
    .map(r => {
      const meta = ROLE_META[r.name]
      return meta
        ? { key: r.name, label: meta.label, icon: meta.icon, description: meta.description }
        : { key: r.name, label: r.name, icon: r.icon || ICON_USER, description: 'Rol personalizado del hotel' }
    })
  // Fallback si el fetch falló/vino vacío: los de sistema (comportamiento previo, nunca lista vacía).
  if (fromBackend.length === 0) {
    return (Object.keys(ROLE_META) as string[])
      .filter(key => key !== 'super_admin')
      .map(key => ({ key, label: roleMeta(key).label, icon: roleMeta(key).icon, description: roleMeta(key).description }))
  }
  return fromBackend
})

// ── Estado de ocupación del personal (#614): Disponible / Vacaciones / Licencia ──
// Los `members` acá son cuentas de usuario (users), no perfiles de RRHH. El estado se resuelve
// cruzando employee-profiles (userId → employeeId) con las ausencias APROBADAS que cubren hoy
// (leave-calendar). Un miembro sin perfil de RRHH o sin ausencia activa se cuenta "Disponible".
const employeeStatusByUserId = ref<Map<string, 'vacation' | 'leave'>>(new Map())

const occupancy = computed(() => {
  let available = 0, vacation = 0, leave = 0
  for (const m of members.value) {
    const status = employeeStatusByUserId.value.get(m.id)
    if (status === 'vacation') vacation++
    else if (status === 'leave') leave++
    else available++
  }
  return { total: members.value.length, available, vacation, leave }
})

function occPct(n: number): string {
  const total = members.value.length || 1
  return `${(n / total) * 100}%`
}

async function loadOccupancy() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const [profilesRes, leaves] = await Promise.all([
      EmpleadosService.listProfiles(),
      EmpleadosService.getLeaveCalendar(today, today),
    ])
    const userIdByEmployeeId = new Map(profilesRes.data.map((p) => [p.id, p.userId]))
    const map = new Map<string, 'vacation' | 'leave'>()
    for (const l of leaves) {
      if (l.status !== 'approved') continue
      const userId = userIdByEmployeeId.get(l.employeeId)
      if (!userId) continue
      map.set(userId, l.type === 'vacation' ? 'vacation' : 'leave')
    }
    employeeStatusByUserId.value = map
  } catch {
    // No bloquea la vista: sin datos de RRHH, todos quedan "Disponible" por default.
    employeeStatusByUserId.value = new Map()
  }
}

async function load() {
  loading.value = true
  try {
    // Miembros y catálogo de roles en paralelo. Si /roles falla, se cae al fallback de sistema.
    const [membersRes, rolesRes] = await Promise.all([
      TeamService.list(),
      TeamService.listRoles().catch(() => ({ data: [] as Role[], total: 0 })),
    ])
    members.value = (membersRes.data || []).map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      hotelId: u.hotelId,
      active: u.active,
      createdAt: u.createdAt,
    }))
    rolesCatalog.value = rolesRes.data || []
  } catch (e: any) {
    toast.error(e.message || 'Error al cargar equipo')
    members.value = []
  } finally {
    loading.value = false
  }
}

// Modal cambio de rol
const roleModal = ref<{ show: boolean; member: TeamMember | null }>({ show: false, member: null })
const selectedRole = ref('')
const changing = ref(false)

function openChangeRole(m: TeamMember) {
  if (m.id === currentUser.value) {
    toast.info('No puedes cambiar tu propio rol')
    return
  }
  roleModal.value = { show: true, member: m }
  selectedRole.value = m.role
}

async function changeRole() {
  if (!roleModal.value.member) return
  if (selectedRole.value === roleModal.value.member.role) {
    roleModal.value.show = false
    return
  }
  changing.value = true
  try {
    await TeamService.changeRole(roleModal.value.member.id, selectedRole.value)
    roleModal.value.member.role = selectedRole.value
    toast.success(`Rol cambiado a ${roleMeta(selectedRole.value).label}`)
    roleModal.value.show = false
  } catch (e: any) {
    toast.error(e.message || 'Error al cambiar rol')
  } finally {
    changing.value = false
  }
}

// Modal invitar
const inviteModal = ref(false)
const inviteForm = ref<{ name: string; email: string; role: string; password: string }>({
  name: '', email: '', role: 'receptionist', password: '',
})
const inviting = ref(false)

function openInvite() {
  inviteForm.value = { name: '', email: '', role: 'receptionist', password: Math.random().toString(36).slice(2, 10) }
  inviteModal.value = true
}

async function sendInvite() {
  if (!inviteForm.value.name || !inviteForm.value.email) {
    toast.error('Nombre y email son obligatorios')
    return
  }
  inviting.value = true
  try {
    const hotelId = auth.user?.hotelId
    if (!hotelId || hotelId === 'platform') {
      toast.error('Sin hotel asignado')
      return
    }
    await TeamService.create({
      name: inviteForm.value.name,
      email: inviteForm.value.email,
      role: inviteForm.value.role,
      hotelId,
      password: inviteForm.value.password || undefined,
    })
    toast.success('Miembro creado')
    inviteModal.value = false
    await load()
  } catch (e: any) {
    toast.error(e.message || 'Error al crear miembro')
  } finally {
    inviting.value = false
  }
}

// Devuelve '' cuando no hay fecha: el template omite la celda en vez de pintar un guión suelto.
// `createdAt` es TEXT en la DB y convive en dos formatos: ISO (lo que escribe el ORM) y el
// 'YYYY-MM-DD HH:MM:SS+00' de un NOW() de Postgres, que `new Date()` no parsea y devolvía
// "Invalid Date" en pantalla. Se normaliza el separador y se valida antes de formatear.
function formatDate(d?: string): string {
  if (!d) return ''
  const normalized = d.includes('T') ? d : d.includes(' ') ? d.replace(' ', 'T') : `${d}T12:00:00`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

onMounted(() => { load(); loadOccupancy() })
</script>
