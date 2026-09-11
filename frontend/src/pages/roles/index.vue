<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Roles y Permisos</h2>
        <p class="text-sm text-text-muted mt-0.5">Creá roles a medida y definí qué puede hacer cada uno</p>
      </div>
      <button @click="openCreate"
        class="flex items-center gap-1.5 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
        <span class="text-lg leading-none">+</span>Nuevo Rol
      </button>
    </div>

    <!-- KPIs -->
    <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <div v-for="i in 3" :key="i" class="h-[104px] animate-pulse rounded-[16px] bg-surface"></div>
    </div>
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Roles del Hotel" :value="roles.length" icon="building" accent="blue"
        :unit="`${customRolesCount} personalizado(s)`" />
      <KpiHeroCard label="Usuarios Asignados" :value="assignedUsers" icon="users" accent="teal"
        :unit="rolesWithUsers ? `${rolesWithUsers} rol(es) en uso` : 'Ningún rol asignado todavía'" />
      <KpiHeroCard label="Módulos Disponibles" :value="visibleModules.length" icon="bookings" accent="purple"
        :unit="`${totalAssignablePermissions} permisos configurables`" />
    </div>

    <div class="mb-5 p-3 rounded-xl bg-navy/5 border border-navy/10 text-xs text-text-secondary">
      Los roles del sistema (Admin, Recepcionista, Limpieza, Mantenimiento) ya vienen configurados. Acá creás
      <b>roles personalizados</b> para tu hotel (ej: Cajero, Gerente de piso) y los asignás al registrar un empleado.
    </div>

    <!-- Listado de roles -->
    <SectionCard title="Roles" :subtitle="loading ? 'Cargando…' : `${roles.length} rol(es) configurado(s)`"
      body-class="p-0" class="mb-6">
      <template #actions>
        <button @click="openCreate"
          class="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
          + Nuevo Rol
        </button>
      </template>

      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-xl bg-surface"></div>
      </div>

      <EmptyState v-else-if="!roles.length" :icon="ICON_SHIELD"
        title="Todavía no hay roles"
        message="Creá un rol personalizado para repartir permisos entre tu equipo.">
        <template #action>
          <button @click="openCreate"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Crear rol
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[640px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Rol</th>
              <th class="text-right px-4 py-3 text-[10px]">Usuarios</th>
              <th class="text-right px-4 py-3 text-[10px]">Permisos</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="role in roles" :key="role.id" @click="select(role)"
              class="border-b border-border/50 transition-colors cursor-pointer hover:bg-surface/60"
              :class="selected?.id === role.id ? 'bg-navy/5' : ''">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/5 text-lg">{{ role.icon }}</div>
                  <div class="min-w-0">
                    <div class="text-sm font-black text-navy truncate">{{ roleLabel(role) }}</div>
                    <span class="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                      :class="role.system ? 'bg-navy/10 text-navy' : 'bg-cyan/10 text-cyan'">
                      {{ role.system ? 'Sistema' : 'Personalizado' }}
                    </span>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-right text-sm font-bold text-navy tabular-nums">{{ role.users ?? 0 }}</td>
              <td class="px-4 py-3 text-right text-sm font-bold text-navy tabular-nums">{{ role.permissions.length }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="select(role)" title="Editar permisos"
                    class="grid h-8 w-8 place-items-center rounded-lg text-navy hover:bg-navy/10 transition-colors cursor-pointer">
                    <span class="block h-4 w-4" v-html="ICON_SLIDERS"></span>
                  </button>
                  <button @click.stop="confirmDelete(role)" title="Eliminar rol"
                    class="grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
                    <span class="block h-4 w-4" v-html="ICON_TRASH"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Matriz de permisos -->
    <SectionCard v-if="!loading && roles.length"
      :title="selected ? `Permisos — ${roleLabel(selected)}` : 'Permisos'"
      :subtitle="selected ? 'Marcá lo que puede hacer este rol' : 'Elegí un rol del listado para editar sus permisos'"
      body-class="p-0">
      <template v-if="selected" #actions>
        <button v-if="selected.system" @click="confirmRestore"
          title="Volver a la configuración original de fábrica"
          class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
          ↺ Restaurar original
        </button>
        <button @click="selectAll"
          class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
          Marcar todo
        </button>
        <button @click="clearAll"
          class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
          Quitar todo
        </button>
      </template>

      <EmptyState v-if="!selected" :icon="ICON_SHIELD"
        title="Ningún rol seleccionado"
        message="Tocá un rol en el listado de arriba para ver y editar su matriz de permisos." />

      <EmptyState v-else-if="!visibleModules.length" :icon="ICON_SHIELD"
        title="Sin módulos habilitados"
        message="Tu plan todavía no libera módulos con permisos configurables." />

      <template v-else>
        <div class="max-h-[540px] overflow-auto">
          <table class="w-full min-w-[720px] tbl-head">
            <thead>
              <tr>
                <th class="sticky top-0 z-10 bg-surface text-left px-4 py-3 text-[10px]">Módulo</th>
                <th v-for="a in allActions" :key="a"
                  class="sticky top-0 z-10 bg-surface text-center px-3 py-3 text-[10px] whitespace-nowrap">{{ actionLabel(a) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in visibleModules" :key="m.key"
                class="border-b border-border/50 transition-colors hover:bg-surface/60">
                <td class="px-4 py-2.5">
                  <div class="text-xs font-bold text-navy">{{ m.label }}</div>
                  <div class="text-[10px] text-text-muted tabular-nums">{{ modulePermCount(m.key) }} de {{ moduleActionTotal(m.key) }}</div>
                </td>
                <td v-for="a in allActions" :key="a" class="px-3 py-2.5 text-center">
                  <input v-if="hasAction(m, a)" type="checkbox" :value="`${m.key}:${a}`" v-model="selected.permissions"
                    :aria-label="`${m.label} — ${actionLabel(a)}`"
                    class="mx-auto block h-4 w-4 accent-navy rounded cursor-pointer" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between gap-3 flex-wrap border-t border-border px-4 py-4">
          <span class="text-xs text-text-muted tabular-nums">
            {{ selected.permissions.length }} de {{ totalAssignablePermissions }} permiso(s) asignado(s)
          </span>
          <button @click="save" :disabled="saving"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
            {{ saving ? 'Guardando…' : 'Guardar permisos' }}
          </button>
        </div>
      </template>
    </SectionCard>

    <FormModal
      v-if="createModal"
      title="Nuevo Rol"
      :fields="createFields"
      :loading="creating"
      submit-label="Crear Rol"
      @close="createModal = false"
      @submit="create"
    />

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RolesService, type Role, type PermissionCatalog } from '@/services/Roles.service'
import { ROLE_META } from '@/services/Team.service'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useModulesStore } from '@/stores/modules.store'
import { permissionModuleEnabled } from '@/config/module-map'
import { orderActionColumns } from '@/config/permissions'

const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 7.5h12M9.75 7.5v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5m-8.25 0 .75 11.25a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.25 7.5"/></svg>'
const ICON_SLIDERS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h10m4 0h2M4 12h4m4 0h8M4 18h10m4 0h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>'
const ICON_SHIELD = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 3v6c0 4.4-3 8.1-7 9-4-.9-7-4.6-7-9V6l7-3z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9.5 12.2l1.8 1.8 3.4-3.6"/></svg>'

const toast = useToast()
// onDone queda libre: cada acción (eliminar / restaurar) emite su propio toast desde su `run`, así
// restaurar no dispara "Rol eliminado" por error.
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e) => toast.error(e instanceof Error ? e.message : 'Ocurrió un error'),
})
const auth = useAuthStore()
const modules = useModulesStore()
const loading = ref(true)
const saving = ref(false)
const roles = ref<Role[]>([])
const catalog = ref<PermissionCatalog>({ modules: [] })
const selected = ref<Role | null>(null)

// El dueño solo reparte permisos de los módulos que la plataforma le liberó (plan ∩ global).
const visibleModules = computed(() =>
  catalog.value.modules.filter((m) => permissionModuleEnabled(m.key, modules.state)))

// Columnas de la matriz = superconjunto de las acciones de los módulos visibles, en orden estable.
// checkin/checkout/pay aparecen como columnas, pero solo el módulo que las admite les pone casilla
// (hasAction) — no ensuciamos con billing:checkin. Así un rol custom puede tener check-in/out o
// cobrar en el POS (`restaurant:pay`, #205) y "Marcar todo" los respeta.
// `orderActionColumns` (config/permissions.ts) solo ORDENA: cualquier acción que el catálogo traiga y
// no conozca se agrega al final igual. Antes era una lista blanca y `pay` no se dibujaba nunca: el
// hotel no tenía forma de dar ni quitar el cobro a un rol desde el panel.
const allActions = computed<string[]>(() =>
  orderActionColumns(visibleModules.value.flatMap((m) => m.actions.map((a) => a.key))))
const ACTION_LABELS: Record<string, string> = {}
function actionLabel(key: string): string { return ACTION_LABELS[key] ?? key }
function hasAction(m: { actions: { key: string }[] }, key: string): boolean {
  return m.actions.some((a) => a.key === key)
}
function moduleActionTotal(moduleKey: string): number {
  return catalog.value.modules.find((x) => x.key === moduleKey)?.actions.length ?? 0
}

const customRolesCount = computed(() => roles.value.filter((r) => !r.system).length)
const assignedUsers = computed(() => roles.value.reduce((sum, r) => sum + (r.users ?? 0), 0))
const rolesWithUsers = computed(() => roles.value.filter((r) => (r.users ?? 0) > 0).length)
const totalAssignablePermissions = computed(() =>
  visibleModules.value.reduce((sum, m) => sum + m.actions.length, 0))

/**
 * Nombre visible del rol. Los roles de sistema se guardan por slug en inglés (`housekeeper`,
 * `maintenance`…) porque es la clave que evalúan los permisos del backend; acá se traduce para
 * la UI. Los roles personalizados ya se crean con nombre en español, así que se muestran tal cual.
 */
function roleLabel(role: Role): string {
  return ROLE_META[role.name]?.label ?? role.name
}

/** Cuántas acciones del módulo tiene marcadas el rol seleccionado (solo lectura, no altera el payload). */
function modulePermCount(moduleKey: string): number {
  if (!selected.value) return 0
  const m = catalog.value.modules.find((x) => x.key === moduleKey)
  return m ? m.actions.filter((a) => selected.value!.permissions.includes(`${moduleKey}:${a.key}`)).length : 0
}

async function load() {
  loading.value = true
  try {
    const [r, c] = await Promise.all([RolesService.list(), RolesService.catalog()])
    roles.value = r
    catalog.value = c
    for (const m of c.modules) for (const a of m.actions) ACTION_LABELS[a.key] = a.label
    if (selected.value) selected.value = roles.value.find((x) => x.id === selected.value!.id) ?? null
  } catch { toast.error('No se pudieron cargar los roles') }
  finally { loading.value = false }
}
onMounted(() => { modules.ensure(auth.user?.hotelId); load() })

function select(role: Role) {
  // Copia editable: no mutar la card del listado hasta guardar.
  selected.value = { ...role, permissions: [...role.permissions] }
}

function selectAll() {
  if (!selected.value) return
  // Solo módulos visibles (liberados al hotel) y las acciones que cada módulo admite. "Todo" no otorga
  // permisos de módulos que no tiene ni casillas sin sentido (billing:checkin), e incluye checkin/checkout
  // de reservas (antes quedaban fuera y se perdían al guardar).
  selected.value.permissions = visibleModules.value.flatMap((m) =>
    m.actions.map((a) => `${m.key}:${a.key}`))
}
function clearAll() {
  if (selected.value) selected.value.permissions = []
}

async function save() {
  if (!selected.value) return
  saving.value = true
  try {
    await RolesService.update(selected.value.id, { permissions: selected.value.permissions })
    toast.success('Permisos guardados')
    await load()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al guardar')
  } finally { saving.value = false }
}

function confirmDelete(role: Role) {
  askConfirm({
    title: 'Eliminar rol',
    message: `¿Eliminar el rol "${roleLabel(role)}"? Los empleados con este rol quedarán sin permisos hasta reasignarlos.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      await RolesService.remove(role.id)
      if (selected.value?.id === role.id) selected.value = null
      await load()
      toast.success('Rol eliminado')
    },
  })
}

function confirmRestore() {
  const role = selected.value
  if (!role) return
  askConfirm({
    title: 'Restaurar configuración original',
    message: `¿Volver "${roleLabel(role)}" a los permisos de fábrica? Se pierden los cambios que le hayas hecho a este rol del sistema.`,
    confirmLabel: 'Restaurar', danger: true,
    run: async () => {
      const updated = await RolesService.restore(role.id)
      await load()
      const fresh = roles.value.find((r) => r.id === updated.id)
      if (fresh) select(fresh)
      toast.success('Rol restaurado a la configuración original')
    },
  })
}

const createModal = ref(false)
const creating = ref(false)
const createFields: FormField[] = [
  { key: 'name', label: 'Nombre del rol', required: true, minLength: 2, maxLength: 40, placeholder: 'Cajero, Gerente de piso…' },
  { key: 'icon', label: 'Ícono (emoji)', maxLength: 4, default: '👤', placeholder: '👤' },
]
function openCreate() { createModal.value = true }

async function create(values: Record<string, string | number>) {
  creating.value = true
  try {
    const role = await RolesService.create({
      name: String(values.name).trim(),
      icon: String(values.icon || '👤'),
      permissions: [],
    })
    toast.success('Rol creado — ahora asignale permisos')
    createModal.value = false
    await load()
    const fresh = roles.value.find((r) => r.id === role.id)
    if (fresh) select(fresh)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al crear el rol')
  } finally { creating.value = false }
}
</script>
