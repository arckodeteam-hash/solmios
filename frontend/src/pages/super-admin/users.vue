<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-black text-navy">Clientes / Propietarios de Hoteles</h1>
        <p class="text-sm text-text-muted">{{ filteredUsers.length }} usuarios registrados</p>
      </div>
      <div class="flex gap-2">
        <button @click="exportUsers" class="h-10 px-4 bg-white border border-border rounded-xl text-sm font-bold text-text-secondary hover:bg-surface transition-colors cursor-pointer flex items-center gap-2">📥 Exportar</button>
        <button @click="openInviteUser" class="h-10 px-5 bg-cyan text-navy font-extrabold text-sm rounded-xl hover:shadow-lg transition-all cursor-pointer">+ Invitar Cliente</button>
      </div>
    </div>

    <!-- Métricas -->
    <div class="grid grid-cols-5 gap-3 mb-6">
      <div v-for="stat in stats" :key="stat.label" class="bg-white rounded-xl p-4 border border-border text-center card-shadow">
        <div class="text-xl font-black" :class="stat.color">{{ stat.value }}</div>
        <div class="text-[10px] text-text-muted font-bold uppercase">{{ stat.label }}</div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="bg-white rounded-2xl border border-border card-shadow p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold text-text-muted uppercase">Filtros</span>
          <span v-if="activeFiltersCount > 0" class="bg-cyan/20 text-cyan text-[10px] font-bold px-2 py-0.5 rounded-full">{{ activeFiltersCount }} activos</span>
        </div>
        <button v-if="activeFiltersCount > 0" @click="clearAllFilters" class="text-[10px] font-bold text-red hover:text-red/80 transition-colors cursor-pointer">Limpiar todo</button>
      </div>
      <div class="grid grid-cols-5 gap-3">
        <div class="relative">
          <input v-model="searchQuery" type="text" placeholder="Buscar nombre, email, hotel..." class="w-full h-10 pl-9 pr-4 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
        <select v-model="roleFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los roles</option>
          <option value="Super Admin">Super Admin</option>
          <option value="Hotel Admin">Hotel Admin</option>
          <option value="Recepcionista">Recepcionista</option>
        </select>
        <select v-model="hotelFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los hoteles</option>
          <option v-for="h in hotels" :key="h" :value="h">{{ h }}</option>
        </select>
        <select v-model="statusFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los estados</option>
          <option value="Activo">Activo</option>
          <option value="Inactivo">Inactivo</option>
          <option value="Pendiente">Pendiente</option>
        </select>
        <select v-model="sortBy" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="name-asc">Nombre (A-Z)</option>
          <option value="name-desc">Nombre (Z-A)</option>
          <option value="hotel-asc">Hotel (A-Z)</option>
          <option value="lastActivity-desc">Más recientes</option>
          <option value="registered-desc">Más antiguos</option>
        </select>
      </div>
    </div>

    <!-- Tabla -->
    <SkeletonLoader v-if="loading" variant="table" :rows="6" />
    <SectionCard v-else title="Usuarios" :subtitle="`${filteredUsers.length} usuario(s)`" body-class="p-0">
      <div class="overflow-x-auto">
      <table class="w-full tbl-head">
        <thead>
          <tr class="border-b border-border">
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Usuario</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Hotel / Propiedad</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Rol</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Plan</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Última Actividad</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Registro</th>
            <th class="text-right p-4 text-[10px] font-bold text-text-muted uppercase">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in filteredUsers" :key="user.id" class="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
            <td class="p-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" :class="user.avatarClass">{{ user.initials }}</div>
                <div>
                  <div class="text-sm font-bold text-navy cursor-pointer hover:text-cyan" @click="openViewUser(user)">{{ user.name }}</div>
                  <div class="text-[10px] text-text-muted">{{ user.email }}</div>
                  <div class="text-[9px] text-text-muted">{{ user.phone }}</div>
                </div>
              </div>
            </td>
            <td class="p-4">
              <div class="text-sm font-bold text-navy">{{ user.hotel }}</div>
              <div class="text-[10px] text-text-muted">{{ user.rooms }} habitaciones</div>
            </td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="roleClass(user.role)">{{ user.role }}</span></td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="planClass(user.plan)">{{ user.plan }}</span></td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="statusClass(user.status)">{{ user.status }}</span></td>
            <td class="p-4">
              <div class="text-sm" :class="isRecent(user.lastActivity) ? 'text-teal font-bold' : 'text-text-muted'">{{ user.lastActivity }}</div>
            </td>
            <td class="p-4 text-sm text-text-muted">{{ user.registered }}</td>
            <td class="p-4 text-right">
              <div class="flex gap-1 justify-end">
                <button @click="openViewUser(user)" class="px-2 py-1 bg-cyan/10 text-cyan rounded-lg text-[10px] font-bold hover:bg-cyan/20 transition-colors cursor-pointer">Ver</button>
                <button @click="openEditUser(user)" class="px-2 py-1 bg-navy/10 text-navy rounded-lg text-[10px] font-bold hover:bg-navy/20 transition-colors cursor-pointer">Editar</button>
                <button v-if="user.status === 'Activo' && user.role !== 'Super Admin'" @click="loginAsUser(user)" :disabled="enteringId === user.id" class="px-2 py-1 bg-blue text-white rounded-lg text-[10px] font-bold hover:bg-blue/90 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait">{{ enteringId === user.id ? 'Entrando…' : 'Entrar' }}</button>
                <button @click="openActivityLog(user)" class="px-2 py-1 bg-purple/10 text-purple rounded-lg text-[10px] font-bold hover:bg-purple/20 transition-colors cursor-pointer">Log</button>
                <button @click="toggleUserStatus(user)" class="px-2 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer" :class="user.status === 'Activo' ? 'bg-red/10 text-red hover:bg-red/20' : 'bg-teal/10 text-teal hover:bg-teal/20'">{{ user.status === 'Activo' ? 'Desactivar' : 'Activar' }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div v-if="filteredUsers.length === 0" class="p-12 text-center">
        <div class="text-4xl mb-3">👤</div>
        <div class="text-sm font-bold text-text-muted">No se encontraron usuarios</div>
      </div>
    </SectionCard>

    <!-- Modal: Ver Usuario -->
    <AppModal v-if="showViewModal" size="md" title="Detalle del Cliente" @close="showViewModal = false">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold" :class="selectedUser.avatarClass">{{ selectedUser.initials }}</div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-xl font-black text-navy">{{ selectedUser.name }}</h2>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="statusClass(selectedUser.status)">{{ selectedUser.status }}</span>
              </div>
              <div class="text-sm text-text-muted">{{ selectedUser.email }}</div>
              <div class="text-sm text-text-muted">{{ selectedUser.phone }}</div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Rol</div><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="roleClass(selectedUser.role)">{{ selectedUser.role }}</span></div>
            <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Plan</div><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="planClass(selectedUser.plan)">{{ selectedUser.plan }}</span></div>
            <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Hotel</div><div class="text-sm font-bold">{{ selectedUser.hotel }}</div></div>
            <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Habitaciones</div><div class="text-sm font-bold">{{ selectedUser.rooms }}</div></div>
            <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Última Actividad</div><div class="text-sm">{{ selectedUser.lastActivity }}</div></div>
            <div class="bg-surface rounded-xl p-4"><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Registro</div><div class="text-sm">{{ selectedUser.registered }}</div></div>
          </div>
          <div class="bg-surface rounded-xl p-4">
            <div class="text-[10px] font-bold text-text-muted uppercase mb-2">Permisos</div>
            <div class="flex flex-wrap gap-2">
              <span v-for="perm in selectedUser.permissionsList" :key="perm" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-navy/10 text-navy">{{ perm }}</span>
            </div>
          </div>
      <template #footer>
        <button @click="showViewModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cerrar</button>
        <button @click="showViewModal = false; openEditUser(selectedUser)" class="px-4 py-2.5 bg-navy text-white rounded-xl text-sm font-extrabold hover:shadow-lg transition-colors cursor-pointer">Editar</button>
      </template>
    </AppModal>

    <!-- Modal: Invitar/Editar -->
    <AppModal v-if="showEditModal" size="md" :title="editingUser.id ? 'Editar Cliente' : 'Invitar Nuevo Cliente'" @close="showEditModal = false">
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2"><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Nombre Completo *</label><input v-model="editingUser.name" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div class="col-span-2"><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Email *</label><input v-model="editingUser.email" type="email" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Teléfono</label><input v-model="editingUser.phone" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Rol *</label>
              <select v-model="editingUser.role" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="Hotel Admin">Hotel Admin (Propietario)</option>
                <option value="Recepcionista">Recepcionista</option>
                <option value="Super Admin">Super Admin</option>
              </select>
            </div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Hotel *</label>
              <select v-model="editingUser.hotel" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="Plataforma">Plataforma (Super Admin)</option>
                <option v-for="h in hotels" :key="h" :value="h">{{ h }}</option>
              </select>
            </div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Plan</label>
              <select v-model="editingUser.plan" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="Enterprise">Enterprise</option>
                <option value="Professional">Professional</option>
                <option value="Starter">Starter</option>
              </select>
            </div>
          </div>
      <template #footer>
        <button @click="showEditModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveUser" class="px-4 py-2.5 bg-navy text-white rounded-xl text-sm font-extrabold hover:shadow-lg transition-colors cursor-pointer">{{ editingUser.id ? 'Guardar Cambios' : 'Enviar Invitación' }}</button>
      </template>
    </AppModal>

    <!-- Modal: Activity Log -->
    <AppModal v-if="showActivityModal" size="md" title="Actividad Reciente" :subtitle="activityUser.name" @close="showActivityModal = false">
          <div class="space-y-4">
            <div v-for="(log, i) in activityLogs" :key="i" class="flex gap-3">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] flex-shrink-0" :class="log.iconClass">{{ log.icon }}</div>
              <div class="flex-1">
                <div class="text-sm font-bold text-navy">{{ log.action }}</div>
                <div class="text-[10px] text-text-muted">{{ log.detail }}</div>
                <div class="text-[9px] text-text-muted mt-0.5">{{ log.time }}</div>
              </div>
            </div>
          </div>
      <template #footer>
        <button @click="showActivityModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth.store'
import { SuperAdminService } from '@/services/SuperAdmin.service'
import AppModal from '@/components/ui/AppModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

const loading = ref(true)
const searchQuery = ref('')
const roleFilter = ref('all')
const hotelFilter = ref('all')
const statusFilter = ref('all')
const sortBy = ref('name-asc')
const showViewModal = ref(false)
const showEditModal = ref(false)
const showActivityModal = ref(false)
const selectedUser = ref<any>({})
const editingUser = ref<any>({})
const activityUser = ref<any>({})

const ROLE_LABEL: Record<string, { label: string; avatar: string }> = {
  super_admin: { label: 'Super Admin', avatar: 'bg-red/20 text-red' },
  hotel_admin: { label: 'Hotel Admin', avatar: 'bg-cyan/20 text-cyan' },
  receptionist: { label: 'Recepcionista', avatar: 'bg-teal/20 text-teal' },
}

function initialsOf(name?: string): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

const users = ref<any[]>([])

const hotels = computed(() => [...new Set(users.value.map((u: any) => u.hotel).filter(Boolean))])

const stats = computed(() => {
  const list = users.value
  return [
    { label: 'Total Clientes', value: list.length, color: 'text-navy' },
    { label: 'Activos', value: list.filter((u: any) => u.status === 'Activo').length, color: 'text-teal' },
    { label: 'Inactivos', value: list.filter((u: any) => u.status === 'Inactivo').length, color: 'text-text-muted' },
    { label: 'Pendientes', value: list.filter((u: any) => u.status === 'Pendiente').length, color: 'text-orange' },
    { label: 'Activos Hoy', value: list.filter((u: any) => u.status === 'Activo').length, color: 'text-cyan' },
  ]
})

onMounted(async () => {
  loading.value = true
  try {
    const { users: data } = await SuperAdminService.users()
    users.value = data.map((u: any) => {
      const role = ROLE_LABEL[u.role] ?? { label: u.role, avatar: 'bg-surface text-text-muted' }
      return {
        id: u.id,
        name: u.name ?? u.email,
        email: u.email,
        phone: u.phone ?? '',
        hotel: u.hotelName ?? 'Plataforma',
        rooms: 0,
        role: role.label,
        plan: '',
        status: u.active === 0 ? 'Inactivo' : 'Activo',
        lastActivity: u.updatedAt ? String(u.updatedAt).slice(0, 10) : '',
        registered: u.createdAt ? String(u.createdAt).slice(0, 10) : '',
        initials: initialsOf(u.name),
        avatarClass: role.avatar,
        permissionsList: [],
      }
    })
  } catch { toast.error('No se pudieron cargar los usuarios') } finally { loading.value = false }
})

const activeFiltersCount = computed(() => {
  let count = 0
  if (roleFilter.value !== 'all') count++
  if (hotelFilter.value !== 'all') count++
  if (statusFilter.value !== 'all') count++
  if (searchQuery.value) count++
  return count
})

const filteredUsers = computed(() => {
  let result = [...users.value]
  if (roleFilter.value !== 'all') result = result.filter(u => u.role === roleFilter.value)
  if (hotelFilter.value !== 'all') result = result.filter(u => u.hotel === hotelFilter.value)
  if (statusFilter.value !== 'all') result = result.filter(u => u.status === statusFilter.value)
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.hotel.toLowerCase().includes(q) || u.phone.includes(q))
  }
  const [field, dir] = sortBy.value.split('-')
  result.sort((a: any, b: any) => {
    const aVal = a[field]
    const bVal = b[field]
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : (aVal || 0) - (bVal || 0)
    return dir === 'desc' ? -cmp : cmp
  })
  return result
})

const activityLogs = [
  { icon: '🔑', iconClass: 'bg-teal/20 text-teal', action: 'Inicio de sesión', detail: 'Desde IP 192.168.1.45', time: 'Hace 5 minutos' },
  { icon: '📅', iconClass: 'bg-cyan/20 text-cyan', action: 'Creó reserva #1234', detail: 'Suite Presidential, 3 noches', time: 'Hace 20 minutos' },
  { icon: '💰', iconClass: 'bg-navy/20 text-navy', action: 'Procesó pago', detail: '$1,200 — Transferencia bancaria', time: 'Hace 1 hora' },
  { icon: '🏨', iconClass: 'bg-purple/20 text-purple', action: 'Check-in realizado', detail: 'Huésped: María González, Hab. 301', time: 'Hace 2 horas' },
  { icon: '📊', iconClass: 'bg-gold/20 text-gold', action: 'Exportó reporte', detail: 'Reporte de ocupación mensual', time: 'Hace 3 horas' },
  { icon: '⚙️', iconClass: 'bg-surface text-text-muted', action: 'Actualizó configuración', detail: 'Cambió tarifa temporada alta', time: 'Ayer 15:30' }
]

const isRecent = (activity: string) => activity.includes('min') || activity.includes('Ahora')

const clearAllFilters = () => { searchQuery.value = ''; roleFilter.value = 'all'; hotelFilter.value = 'all'; statusFilter.value = 'all' }

const roleClass = (r: string) => ({ 'Super Admin': 'bg-red/10 text-red', 'Hotel Admin': 'bg-cyan/10 text-cyan', 'Recepcionista': 'bg-teal/10 text-teal' }[r] || '')
const planClass = (p: string) => ({ 'Enterprise': 'bg-navy/10 text-navy', 'Professional': 'bg-cyan/10 text-cyan', 'Starter': 'bg-teal/10 text-teal' }[p] || '')
const statusClass = (s: string) => ({ 'Activo': 'bg-teal/10 text-teal', 'Inactivo': 'bg-surface text-text-muted', 'Pendiente': 'bg-orange/10 text-orange' }[s] || '')

const enteringId = ref<string | null>(null)

// Solo mandamos el id: la identidad del usuario impersonado (incluido el hotelId real)
// la resuelve el backend y viaja en el token que emite. El hotelId que se armaba aca
// era un slug del nombre del hotel y no existia en la base.
const loginAsUser = async (user: any) => {
  enteringId.value = user.id
  try {
    await auth.loginAs(user.id)
    router.push('/panel')
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo entrar a la cuenta de este usuario')
  } finally {
    enteringId.value = null
  }
}

const openViewUser = (user: any) => { selectedUser.value = { ...user }; showViewModal.value = true }
const openEditUser = (user: any) => { editingUser.value = { ...user }; showEditModal.value = true }
const openInviteUser = () => { editingUser.value = { id: null, name: '', email: '', phone: '', hotel: 'Hotel Caribe Paradise', role: 'Recepcionista', plan: 'Starter', status: 'Pendiente', lastActivity: 'Nunca', registered: new Date().toLocaleDateString('es-ES'), initials: '', avatarClass: '', permissionsList: [] }; showEditModal.value = true }
const openActivityLog = (user: any) => { activityUser.value = { ...user }; showActivityModal.value = true }

const saveUser = () => {
  if (!editingUser.value.name || !editingUser.value.email) return
  editingUser.value.initials = editingUser.value.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  editingUser.value.avatarClass = editingUser.value.role === 'Super Admin' ? 'bg-red/20 text-red' : editingUser.value.role === 'Hotel Admin' ? 'bg-cyan/20 text-cyan' : 'bg-teal/20 text-teal'
  editingUser.value.permissionsList = editingUser.value.role === 'Super Admin' ? ['Total', 'Configuración', 'Usuarios'] : editingUser.value.role === 'Hotel Admin' ? ['Dashboard', 'Reservas', 'Habitaciones', 'Huéspedes', 'Facturación', 'Reportes', 'Configuración'] : ['Reservas', 'Check-in/out', 'Huéspedes']
  if (editingUser.value.id) {
    const idx = users.value.findIndex(u => u.id === editingUser.value.id)
    if (idx !== -1) users.value[idx] = { ...editingUser.value }
  } else {
    editingUser.value.id = Date.now()
    users.value.unshift({ ...editingUser.value })
  }
  showEditModal.value = false
}

const toggleUserStatus = (user: any) => { user.status = user.status === 'Activo' ? 'Inactivo' : 'Activo' }

const exportUsers = () => {
  const headers = ['Nombre', 'Email', 'Teléfono', 'Hotel', 'Rol', 'Plan', 'Estado', 'Registro']
  const rows = filteredUsers.value.map(u => [u.name, u.email, u.phone, u.hotel, u.role, u.plan, u.status, u.registered])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `usuarios-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>
