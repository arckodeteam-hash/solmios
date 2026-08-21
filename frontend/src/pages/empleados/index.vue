<template>
  <div>
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Gestión de Empleados</h2>
        <p class="text-sm text-text-muted mt-0.5">Expedientes, contratos, vacaciones, evaluaciones y organigrama</p>
      </div>
      <div class="flex gap-2">
        <button @click="openOrgChart" class="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_BUILDING"></span>Organigrama
        </button>
        <button v-if="canManageStaff" @click="() => openNewEmployee()" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>Nuevo Empleado
        </button>
      </div>
    </div>

    <!-- KPIs — cifras reales de lo ya cargado (KpiHeroCard anima solo) -->
    <div v-if="!loading" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Empleados activos" :value="activeProfilesCount" icon="users" accent="blue"
        :unit="`Nómina mensual $${monthlyPayroll.toLocaleString()}`" />
      <KpiHeroCard label="Contratos activos" :value="activeContractsCount" icon="bookings" accent="teal"
        :unit="`${contracts.length} contrato(s) registrado(s)`" />
      <KpiHeroCard label="Solicitudes pendientes" :value="pendingLeavesCount" icon="checkout" accent="amber"
        unit="Vacaciones y permisos por aprobar" />
      <KpiHeroCard label="Documentos por vencer" :value="documentAlerts.length" icon="building" accent="rose"
        unit="Requieren renovación" />
    </div>

    <div class="flex gap-2 mb-6 flex-wrap">
      <button v-for="tab in tabs" :key="tab.value" @click="activeTab = tab.value"
        class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
        <span class="w-4 h-4 shrink-0" v-html="tab.icon"></span>
        {{ tab.label }}
      </button>
    </div>

    <!-- Skeleton de carga (no spinner: la grilla ya insinúa la forma final) -->
    <div v-if="loading" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="h-28 animate-pulse rounded-[16px] bg-surface"></div>
      </div>
      <div class="rounded-2xl border border-border bg-white overflow-hidden">
        <div class="h-16 animate-pulse bg-surface"></div>
        <div class="p-4 space-y-3">
          <div v-for="i in 6" :key="i" class="h-10 animate-pulse rounded-lg bg-surface"></div>
        </div>
      </div>
    </div>

    <template v-else>
    <!-- Expedientes -->
    <SectionCard v-if="activeTab === 'profiles'"
      title="Expedientes del personal"
      :subtitle="`${profiles.length} ${showInactive ? 'legajos (incluye inactivos)' : 'legajos con expediente activo'} — no incluye cuentas sin legajo creado (ver Equipo)`"
      body-class="p-0">
      <template #actions>
        <label class="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[11px] font-bold text-white select-none">
          <input id="empleados-ver-inactivos" name="showInactive" type="checkbox" v-model="showInactive" @change="loadData" class="accent-cyan cursor-pointer" />
          Ver inactivos
        </label>
      </template>

      <EmptyState v-if="!profiles.length" :icon="ICON_USERS_EMPTY"
        title="Todavía no hay empleados"
        message="Registrá al primer miembro del equipo para armar su expediente, contrato y evaluaciones.">
        <template #action>
          <button v-if="canManageStaff" @click="() => openNewEmployee()" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo Empleado
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px] tbl-head text-sm">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Empleado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Departamento</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Contrato</th>
              <th class="text-right px-4 py-3 text-[10px]">Salario</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="emp in profiles" :key="emp.id" @click="canManageStaff ? openProfile(emp) : openExpediente(emp)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer"
              :class="{ 'opacity-60': !emp.active }">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy/10 text-xs font-black text-navy">
                    {{ initialsOf(employeeDisplayName(emp)) }}
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-sm font-bold text-navy truncate">{{ employeeDisplayName(emp) }}</span>
                      <span v-if="emp.userRole" class="shrink-0 rounded-full bg-cyan/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-cyan">
                        {{ roleLabel(emp.userRole) }}
                      </span>
                    </div>
                    <!-- En pantallas chicas el dato de las columnas ocultas sube como sublínea -->
                    <div v-if="emp.departmentId" class="text-[11px] text-text-muted truncate lg:hidden">{{ getDeptName(emp.departmentId) }}</div>
                    <div v-if="emp.contractType" class="text-[11px] text-text-muted truncate xl:hidden">{{ contractTypeName(emp.contractType) }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary">
                <span v-if="emp.departmentId">{{ getDeptName(emp.departmentId) }}</span>
                <span v-else class="text-text-muted">Sin departamento</span>
              </td>
              <td class="px-4 py-3 hidden xl:table-cell text-sm text-text-secondary">
                <span v-if="emp.contractType">{{ contractTypeName(emp.contractType) }}</span>
                <span v-else class="text-text-muted">Sin contrato</span>
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <span v-if="emp.salary" class="text-sm font-extrabold text-navy tabular-nums">${{ emp.salary.toLocaleString() }}</span>
                <span v-else class="text-sm text-text-muted">Sin definir</span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="emp.active ? 'bg-teal/10 text-teal' : 'bg-text-muted/15 text-text-muted'">
                  {{ emp.active ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="openExpediente(emp)" title="Ver expediente"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_FOLDER"></span>
                  </button>
                  <button v-if="canManageStaff" @click.stop="openProfile(emp)" title="Editar datos"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                  </button>
                  <button v-if="canManageStaff && emp.active" @click.stop="deactivateEmployee(emp)" title="Desactivar empleado"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_POWER"></span>
                  </button>
                  <button v-else @click.stop="reactivateEmployee(emp)" title="Reactivar empleado"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-teal/10 hover:text-teal transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_POWER"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Contratos -->
    <SectionCard v-if="activeTab === 'contracts'"
      title="Contratos laborales"
      :subtitle="`${activeContractsCount} activo(s) de ${contracts.length}`"
      body-class="p-0">
      <template #actions>
        <button @click="openNewContract" class="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-xs font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
          <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_PLUS"></span>Nuevo Contrato
        </button>
      </template>

      <EmptyState v-if="!contracts.length" :icon="ICON_DOCUMENT_EMPTY"
        title="Sin contratos registrados"
        message="Creá el primer contrato para dejar asentadas las condiciones laborales del equipo.">
        <template #action>
          <button @click="openNewContract" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo Contrato
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[820px] tbl-head text-sm">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Empleado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Inicio</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Fin</th>
              <th class="text-right px-4 py-3 text-[10px]">Salario</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in contracts" :key="c.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-[10px] font-black text-navy">
                    {{ initialsOf(getEmployeeName(c.employeeId)) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-navy truncate">{{ getEmployeeName(c.employeeId) }}</div>
                    <div class="text-[11px] text-text-muted truncate">{{ contractTypeName(c.type) }}</div>
                    <div class="text-[11px] text-text-muted truncate lg:hidden">{{ c.startDate }} → {{ c.endDate || 'Indefinido' }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary whitespace-nowrap">{{ c.startDate }}</td>
              <td class="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary whitespace-nowrap">{{ c.endDate || 'Indefinido' }}</td>
              <td class="px-4 py-3 text-right text-sm font-extrabold text-navy tabular-nums whitespace-nowrap">${{ c.salary.toLocaleString() }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="c.status === 'active' ? 'bg-teal/10 text-teal' : 'bg-text-muted/15 text-text-muted'">
                  {{ c.status === 'active' ? 'Activo' : 'Terminado' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button v-if="c.status === 'active'" @click="terminateContract(c)" title="Terminar contrato"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_XCIRCLE"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Documentos -->
    <div v-if="activeTab === 'documents'" class="space-y-4">
      <div v-if="documentAlerts.length" class="rounded-2xl border border-coral/20 bg-coral/5 p-4">
        <h3 class="flex items-center gap-2 font-extrabold text-coral text-sm mb-3">
          <span class="h-4 w-4 shrink-0" v-html="ICON_ALERT"></span>Documentos por vencer ({{ documentAlerts.length }})
        </h3>
        <div v-for="alert in documentAlerts" :key="alert.documentId" class="flex items-center justify-between gap-3 py-2 border-b border-coral/10 last:border-0">
          <div class="flex items-center gap-3 min-w-0">
            <span class="h-5 w-5 text-coral shrink-0" v-html="ICON_DOCUMENT"></span>
            <div class="min-w-0">
              <div class="text-sm font-bold text-navy truncate">{{ alert.documentName }}</div>
              <div class="text-[11px] text-text-muted">Vence en {{ alert.daysUntilExpiry }} días · {{ alert.expiryDate }}</div>
            </div>
          </div>
          <span class="shrink-0 rounded-full bg-coral/10 px-2 py-1 text-[10px] font-bold text-coral">Urgente</span>
        </div>
      </div>

      <SectionCard title="Documentos del expediente" :subtitle="`${documents.length} documento(s)`" body-class="p-0">
        <template #actions>
          <button @click="openNewDocument" class="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-xs font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
            <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_PLUS"></span>Nuevo Documento
          </button>
        </template>

        <EmptyState v-if="!documents.length" :icon="ICON_DOCUMENT_EMPTY"
          title="Sin documentos cargados"
          message="Subí cédulas, títulos o certificados para tenerlos a mano y controlar sus vencimientos.">
          <template #action>
            <button @click="openNewDocument" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
              Nuevo Documento
            </button>
          </template>
        </EmptyState>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[720px] tbl-head text-sm">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Documento</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Empleado</th>
                <th class="text-left px-4 py-3 text-[10px]">Vencimiento</th>
                <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doc in documents" :key="doc.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3">
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-navy truncate">{{ doc.name }}</div>
                    <div v-if="doc.type" class="text-[11px] text-text-muted truncate">{{ doc.type }}</div>
                    <div class="text-[11px] text-text-muted truncate lg:hidden">{{ getEmployeeName(doc.employeeId) }}</div>
                  </div>
                </td>
                <td class="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary whitespace-nowrap">{{ getEmployeeName(doc.employeeId) }}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm">
                  <span v-if="doc.expiryDate" :class="isExpiringSoon(doc) ? 'font-bold text-coral' : 'text-text-secondary'">{{ doc.expiryDate }}</span>
                  <span v-else class="text-text-muted">Sin vencimiento</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-1.5">
                    <a v-if="doc.fileUrl" :href="doc.fileUrl" target="_blank" rel="noopener" title="Ver documento"
                      class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                      <span class="h-4 w-4" v-html="ICON_EYE"></span>
                    </a>
                    <button @click="deleteDocument(doc)" title="Eliminar documento"
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
    </div>

    <!-- Vacaciones y Permisos -->
    <SectionCard v-if="activeTab === 'leaves'"
      title="Vacaciones y permisos"
      :subtitle="`${pendingLeavesCount} pendiente(s) de ${leaveRequests.length} solicitud(es)`"
      body-class="p-0">
      <template #actions>
        <button @click="openNewLeave" class="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-xs font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
          <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_PLUS"></span>Nueva Solicitud
        </button>
      </template>

      <EmptyState v-if="!leaveRequests.length" :icon="ICON_BEACH_EMPTY"
        title="Sin solicitudes"
        message="Cuando el equipo pida vacaciones o permisos, las solicitudes aparecen acá para aprobar o rechazar.">
        <template #action>
          <button @click="openNewLeave" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nueva Solicitud
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[820px] tbl-head text-sm">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Empleado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Desde</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Hasta</th>
              <th class="text-right px-4 py-3 text-[10px]">Días</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in leaveRequests" :key="l.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-[10px] font-black text-navy">
                    {{ initialsOf(getEmployeeName(l.employeeId)) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-navy truncate">{{ getEmployeeName(l.employeeId) }}</div>
                    <div class="text-[11px] text-text-muted truncate">{{ leaveTypeLabel(l.type) }}</div>
                    <div class="text-[11px] text-text-muted truncate lg:hidden">{{ l.startDate }} → {{ l.endDate }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary whitespace-nowrap">{{ l.startDate }}</td>
              <td class="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary whitespace-nowrap">{{ l.endDate }}</td>
              <td class="px-4 py-3 text-right text-sm font-bold text-navy tabular-nums">{{ l.days }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="leaveStatusClass(l.status)">{{ leaveStatusLabel(l.status) }}</span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5" v-if="l.status === 'pending'">
                  <button @click="approveLeave(l)" title="Aprobar solicitud"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-teal/10 hover:text-teal transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CHECK"></span>
                  </button>
                  <button @click="rejectLeave(l)" title="Rechazar solicitud"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_XCIRCLE"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Evaluaciones -->
    <SectionCard v-if="activeTab === 'reviews'"
      title="Evaluaciones de desempeño"
      :subtitle="`${reviews.length} evaluación(es)`"
      body-class="p-0">
      <template #actions>
        <button @click="openNewReview" class="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-xs font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
          <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_PLUS"></span>Nueva Evaluación
        </button>
      </template>

      <EmptyState v-if="!reviews.length" :icon="ICON_STAR_EMPTY"
        title="Sin evaluaciones"
        message="Evaluá el desempeño del equipo para llevar registro de fortalezas, mejoras y objetivos.">
        <template #action>
          <button @click="openNewReview" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nueva Evaluación
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] tbl-head text-sm">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Empleado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Fecha</th>
              <th class="text-right px-4 py-3 text-[10px]">Puntaje</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in reviews" :key="r.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-[10px] font-black text-navy">
                    {{ initialsOf(getEmployeeName(r.employeeId)) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-navy truncate">{{ getEmployeeName(r.employeeId) }}</div>
                    <div v-if="r.period" class="text-[11px] text-text-muted truncate">{{ r.period }}</div>
                    <div class="text-[11px] text-text-muted truncate lg:hidden">{{ r.reviewDate }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell text-sm text-text-secondary whitespace-nowrap">{{ r.reviewDate }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <span v-if="r.score" class="text-sm tabular-nums" :class="scoreClass(r.score)">{{ r.score }}/10</span>
                <span v-else class="text-sm text-text-muted">Sin puntaje</span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="r.status === 'completed' ? 'bg-teal/10 text-teal' : 'bg-gold/10 text-gold'">
                  {{ r.status === 'completed' ? 'Completada' : 'Borrador' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <template v-if="r.status === 'draft'">
                    <button @click="openEditReview(r)" title="Editar borrador"
                      class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                      <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                    </button>
                    <button @click="completeReview(r)" title="Completar evaluación"
                      class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-teal/10 hover:text-teal transition-colors cursor-pointer">
                      <span class="h-4 w-4" v-html="ICON_CHECK"></span>
                    </button>
                  </template>
                  <button v-else @click="openViewReview(r)" title="Ver evaluación"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EYE"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
    </template>

    <FormModal
      v-if="formModal"
      :title="formModal.title"
      :fields="formModal.fields"
      :submit-label="formModal.submitLabel"
      :loading="savingForm"
      :read-only="formModal.readOnly"
      @close="formModal = null"
      @submit="submitForm"
    />

    <ConfirmModal
      v-if="confirmModal"
      :title="confirmModal.title"
      :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel"
      :danger="confirmModal.danger"
      :loading="confirmBusy"
      @confirm="runConfirm"
      @close="confirmModal = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { EmpleadosService, type EmployeeProfile, type Contract, type EmployeeDocument, type LeaveRequest, type PerformanceReview, type Department, type DocumentExpiryAlert, type LeaveType, type ContractType } from '@/services/Empleados.service'
import { TeamService } from '@/services/Team.service'
import { RolesService, type Role } from '@/services/Roles.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import FormModal, { type FormField } from '@/components/features/FormModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
// Refactor cross-cutting: monedas desde el enum global (types/currency.ts, source of truth único).
import { CURRENCIES as CURRENCY_OPTIONS, type CurrencyCode } from '@/data/intl-catalogs'

const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_USERS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'
const ICON_DOCUMENT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_BEACH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v3m-7.5 6a7.5 7.5 0 0 1 15 0h-15Zm7.5 0v9m-9 0h18"/></svg>'
const ICON_STAR = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.563.563 0 0 0-.586 0L6.982 21.44a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>'
const ICON_EYE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_POWER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9"/></svg>'
const ICON_XCIRCLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 7.5h12M9.75 7.5v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5m-8.25 0 .75 11.25a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.25 7.5"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
const ICON_ALERT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"/></svg>'
const ICON_FOLDER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"/></svg>'
const ICON_PENCIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"/></svg>'

// Variantes para EmptyState: el contenedor mide 64px, el ícono va a 32px (no al 100%).
const ICON_USERS_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'
const ICON_DOCUMENT_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_BEACH_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v3m-7.5 6a7.5 7.5 0 0 1 15 0h-15Zm7.5 0v9m-9 0h18"/></svg>'
const ICON_STAR_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.563.563 0 0 0-.586 0L6.982 21.44a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

/**
 * Alta/edición/baja de personal es de admin. El backend ya lo impone (`users:create` → 403) y
 * además le oculta los salarios a recepción, pero la UI seguía mostrando los botones: recepción
 * podía abrirlos y solo se enteraba del rechazo al guardar. Acá se espeja esa regla del servidor.
 * La lectura del listado sigue habilitada — es deliberado que recepción vea a sus compañeros.
 */
const canManageStaff = computed(() => auth.isHotelAdmin || auth.isSuperAdmin)
const toast = useToast()
const activeTab = ref('profiles')
const loading = ref(true)

const tabs = [
  { value: 'profiles', label: 'Expedientes', icon: ICON_USERS },
  { value: 'contracts', label: 'Contratos', icon: ICON_DOCUMENT },
  { value: 'documents', label: 'Documentos', icon: ICON_DOCUMENT },
  { value: 'leaves', label: 'Vacaciones y permisos', icon: ICON_BEACH },
  { value: 'reviews', label: 'Evaluaciones', icon: ICON_STAR },
]

const profiles = ref<EmployeeProfile[]>([])
const contracts = ref<Contract[]>([])
const documents = ref<EmployeeDocument[]>([])
const leaveRequests = ref<LeaveRequest[]>([])
const showInactive = ref(false)
const leaveTypes = ref<LeaveType[]>([])
const contractTypes = ref<ContractType[]>([])
const reviews = ref<PerformanceReview[]>([])
const departments = ref<Department[]>([])
const documentAlerts = ref<DocumentExpiryAlert[]>([])
const customRoles = ref<Role[]>([])

// Roles del sistema (nombre-máquina) + los personalizados del hotel. El valor es el `name` que se
// guarda en users.role: para los del sistema es la máquina (receptionist…), para los custom es su nombre.
const SYSTEM_ROLE_OPTIONS = [
  { value: 'receptionist', label: 'Recepcionista' },
  { value: 'housekeeper', label: 'Limpieza' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'waiter', label: 'Mesero' },
  { value: 'kitchen', label: 'Cocina' },
]
/**
 * `customRoles` viene de `/roles`, que devuelve TODOS los roles del hotel — incluidos los de
 * sistema, cuyo `name` es el slug en inglés. Sin deduplicar, el desplegable listaba cada rol de
 * sistema dos veces ("Recepcionista" y "🔑 receptionist") y el admin no sabía cuál elegir.
 * Se filtran los ya cubiertos por SYSTEM_ROLE_OPTIONS y se traduce la etiqueta de los que quedan.
 */
const roleOptions = () => {
  const systemValues = new Set(SYSTEM_ROLE_OPTIONS.map((o) => o.value))
  return [
    ...SYSTEM_ROLE_OPTIONS,
    ...customRoles.value
      .filter((r) => !systemValues.has(r.name))
      .map((r) => ({ value: r.name, label: `${r.icon ?? '👤'} ${ROLE_LABELS[r.name] ?? r.name}` })),
  ]
}

/**
 * #585: roleOptions() a propósito NO incluye hotel_admin/super_admin (un hotel_admin no puede
 * reasignar esos roles — mismo canAssignRole del backend). Pero si el rol ACTUAL del empleado
 * es uno de esos (ej. editando a otro admin del hotel), el <select> queda sin ninguna opción
 * seleccionada — se ve vacío/roto y el admin podría "cambiarlo" sin querer a otra cosa. Esto
 * garantiza que el valor actual siempre esté representado; si igual se intenta reasignar a algo
 * fuera de lo permitido, el backend lo rechaza (canAssignRole ya lo cubre, no hace falta
 * duplicar la jerarquía acá).
 */
const roleOptionsFor = (currentRole?: string) => {
  const opts = roleOptions()
  if (currentRole && !opts.some((o) => o.value === currentRole)) {
    opts.unshift({ value: currentRole, label: ROLE_LABELS[currentRole] ?? currentRole })
  }
  return opts
}

// #172: mostrar el ROL (no el cargo) en el listado. hotel_admin/super_admin incluidos.
const ROLE_LABELS: Record<string, string> = {
  hotel_admin: 'Admin Hotel', super_admin: 'Super Admin', receptionist: 'Recepcionista',
  housekeeper: 'Limpieza', maintenance: 'Mantenimiento', supervisor: 'Supervisor',
  waiter: 'Mesero', kitchen: 'Cocina',
}
function roleLabel(role?: string): string {
  if (!role) return '—'
  return ROLE_LABELS[role] ?? customRoles.value.find((r) => r.name === role)?.name ?? role
}

function getDeptName(id: string | null): string {
  if (!id) return '—'
  return departments.value.find(d => d.id === id)?.name || id
}

function getEmployeeName(userId: string): string {
  if (!userId) return '—'
  const profile = profiles.value.find(p => p.userId === userId || p.id === userId)
  return profile?.userName || profile?.position || userId.slice(0, 8)
}

/** Nombre visible del empleado en el listado (cuenta → cargo → id). */
function employeeDisplayName(emp: EmployeeProfile): string {
  return emp.userName || emp.position || emp.userId
}

/** Iniciales para el avatar de la fila (máximo 2 letras). */
function initialsOf(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '??'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

// ─── Cifras de cabecera (derivadas de lo ya cargado) ─────
const activeProfilesCount = computed(() => profiles.value.filter((p) => p.active).length)
const monthlyPayroll = computed(() => profiles.value.filter((p) => p.active).reduce((sum, p) => sum + (p.salary || 0), 0))
const activeContractsCount = computed(() => contracts.value.filter((c) => c.status === 'active').length)
const pendingLeavesCount = computed(() => leaveRequests.value.filter((l) => l.status === 'pending').length)

function leaveTypeLabel(type: string) {
  const configured = leaveTypes.value.find((t) => t.code === type)
  if (configured) return configured.name
  return { vacation: 'Vacaciones', permission: 'Permiso', sick_leave: 'Licencia médica', maternity: 'Maternidad', other: 'Otro' }[type] ?? type
}

function leaveStatusLabel(status: string) {
  return { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' }[status] ?? status
}

function leaveStatusClass(status: string) {
  return { pending: 'bg-gold/10 text-gold', approved: 'bg-teal/10 text-teal', rejected: 'bg-coral/10 text-coral' }[status] ?? ''
}

function scoreClass(score: number | null) {
  if (!score) return 'font-bold'
  if (score >= 8) return 'text-teal font-bold'
  if (score >= 6) return 'text-gold font-bold'
  return 'text-coral font-bold'
}

function isExpiringSoon(doc: EmployeeDocument): boolean {
  return documentAlerts.value.some(a => a.documentId === doc.id)
}

async function loadData() {
  loading.value = true
  const hid = hotelId.value
  const qs = hid ? { hotelId: hid } : undefined
  const profileQs = { ...(qs ?? {}), ...(showInactive.value ? { includeInactive: 'true' } : {}) }
  try {
    const [profilesRes, contractsRes, documentsRes, leavesRes, reviewsRes, alertsRes] = await Promise.all([
      EmpleadosService.listProfiles(profileQs),
      EmpleadosService.listContracts(undefined, hid),
      EmpleadosService.listDocuments(undefined, hid),
      EmpleadosService.listLeaveRequests(qs),
      EmpleadosService.listReviews(undefined, hid),
      EmpleadosService.getExpiringDocuments(),
    ])
    profiles.value = profilesRes.data ?? []
    contracts.value = contractsRes
    documents.value = documentsRes
    leaveRequests.value = leavesRes
    reviews.value = reviewsRes
    documentAlerts.value = alertsRes

    try { departments.value = await EmpleadosService.listDepartments() } catch { /* optional */ }
    try { customRoles.value = await RolesService.list() } catch { /* optional */ }
    try { leaveTypes.value = await EmpleadosService.listLeaveTypes() } catch { /* optional */ }
    try { contractTypes.value = await EmpleadosService.listContractTypes() } catch { /* optional */ }
  } catch { toast.error('Error al cargar datos') }
  finally { loading.value = false }
}

onMounted(async () => {
  await loadData()
  // Handoff desde Reclutamiento: al contratar un postulante se llega acá con sus datos para
  // crear el expediente (la conexión candidato→empleado).
  const q = route.query
  if (q.newName || q.newEmail) {
    openNewEmployee({ name: q.newName as string, email: q.newEmail as string })
    router.replace({ query: {} })   // limpiar el query para que no reabra al recargar
  }
})

// ─── Actions ────────────────────────────────────────────

function openOrgChart() { router.push('/panel/rrhh/organigrama') }

/** Abre el expediente integral consolidado del empleado (#323). */
function openExpediente(emp: EmployeeProfile) { router.push(`/panel/rrhh/empleados/${emp.id}/expediente`) }

const departmentOptions = () => departments.value.map((d) => ({ value: d.id, label: d.name }))

/**
 * Registra un empleado de cero: crea la CUENTA (usuario) y su EXPEDIENTE en un paso.
 * Si el expediente falla tras crear la cuenta, se borra la cuenta para no dejarla huérfana
 * (así el admin puede reintentar sin chocar con "email ya existe").
 */
function openNewEmployee(prefill?: { name?: string; email?: string }) {
  formModal.value = {
    title: 'Nuevo Empleado', submitLabel: 'Registrar Empleado',
    fields: [
      { key: 'name', label: 'Nombre', required: true, maxLength: 80, placeholder: 'María Pérez', default: prefill?.name },
      { key: 'email', label: 'Email', type: 'email', required: true, maxLength: 120, placeholder: 'maria@hotel.com', default: prefill?.email },
      { key: 'phone', label: 'Teléfono', type: 'tel', maxLength: 20, placeholder: '809-555-0000' },
      { key: 'password', label: 'Contraseña temporal', type: 'password', required: true, minLength: 6, maxLength: 72, placeholder: 'Mínimo 6 caracteres' },
      // El puesto lo define el Rol (feedback #169): un solo lugar para la función del empleado.
      { key: 'role', label: 'Rol', type: 'select', required: true, default: 'receptionist', options: roleOptions() },
      // #656: sin estos 3, el legajo queda inservible para nómina/reportes de costos y nadie
      // se entera hasta que un cálculo de payroll falla o da 0 — obligatorios de negocio.
      { key: 'departmentId', label: 'Departamento', type: 'select', required: true, options: departmentOptions() },
      { key: 'salary', label: 'Salario', type: 'number', required: true, min: 0.01, max: MAX_SALARY },
      { key: 'hireDate', label: 'Fecha de ingreso', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
    ],
    onSubmit: async (v) => {
      const newUser = await TeamService.create({
        name: String(v.name).trim(), email: String(v.email).trim(),
        phone: String(v.phone || '').trim() || undefined,
        password: String(v.password), role: String(v.role), hotelId: hotelId.value ?? '',
      })
      try {
        await EmpleadosService.createProfile({
          userId: newUser.id,
          departmentId: (v.departmentId as string) || undefined,
          salary: Number(v.salary) || 0, hireDate: String(v.hireDate || ''),
        })
      } catch (e) {
        await TeamService.remove(newUser.id).catch(() => {})   // rollback de la cuenta huérfana
        throw e
      }
    },
  }
}

/** Ver/editar el expediente: abre el mismo modal precargado con los datos del empleado. */
function openProfile(emp: EmployeeProfile) {
  formModal.value = {
    title: `Editar: ${emp.userName || emp.position || 'empleado'}`, submitLabel: 'Guardar',
    fields: [
      // #170: el nombre vive en la cuenta (users), no en el legajo — editable acá y se guarda ahí.
      { key: 'name', label: 'Nombre', maxLength: 80, default: emp.userName || '' },
      // #585: el rol también vive en la cuenta (users), igual que el nombre — antes solo se
      // podía elegir al crear, no había forma de cambiarlo después sin editar la DB a mano.
      { key: 'role', label: 'Rol', type: 'select', required: true, default: emp.userRole || 'receptionist', options: roleOptionsFor(emp.userRole) },
      { key: 'departmentId', label: 'Departamento', type: 'select', default: emp.departmentId || '', options: departmentOptions() },
      // #169/#584/#587: "Puesto" (jobPositionId) es el mismo lugar que ya cubre el Rol — se
      // sacó de Alta; sacarlo también de Editar para no reabrir la duplicación por otra puerta.
      { key: 'salary', label: 'Salario', type: 'number', min: 0, max: MAX_SALARY, default: emp.salary || 0 },
      { key: 'hireDate', label: 'Fecha de ingreso', type: 'date', default: (emp.hireDate || '').slice(0, 10) },
      { key: 'birthDate', label: 'Fecha de nacimiento', type: 'date', default: (emp.birthDate || '').slice(0, 10) },
      { key: 'nationality', label: 'Nacionalidad', maxLength: 60, default: emp.nationality || '' },
      { key: 'maritalStatus', label: 'Estado civil', type: 'select', default: emp.maritalStatus || '', options: MARITAL_OPTIONS },
      { key: 'gender', label: 'Género', type: 'select', default: emp.gender || '', options: GENDER_OPTIONS },
      { key: 'education', label: 'Educación', maxLength: 100, default: emp.education || '' },
    ],
    onSubmit: async (v) => {
      // Nombre y rol van a la cuenta (Team/Users); el resto al legajo. Solo pega al backend
      // lo que de verdad cambió (evita un PATCH vacío o pisar el rol con el mismo valor).
      const name = String(v.name ?? '').trim()
      const role = String(v.role ?? '')
      const accountPatch: { name?: string; role?: string } = {}
      if (emp.userId && name && name !== (emp.userName || '')) accountPatch.name = name
      if (emp.userId && role && role !== (emp.userRole || '')) accountPatch.role = role
      if (emp.userId && Object.keys(accountPatch).length) {
        await TeamService.update(emp.userId, accountPatch)
      }
      const { name: _drop, role: _dropRole, ...profileData } = v as Record<string, unknown>
      await EmpleadosService.updateProfile(emp.id, profileData)
    },
  }
}

const MAX_SALARY = 99_999_999   // tope sensato de salario → evita overflow en la DB (#173/#176)

const MARITAL_OPTIONS = [
  { value: 'single', label: 'Soltero/a' }, { value: 'married', label: 'Casado/a' },
  { value: 'divorced', label: 'Divorciado/a' }, { value: 'widowed', label: 'Viudo/a' },
]
const GENDER_OPTIONS = [
  { value: 'female', label: 'Femenino' }, { value: 'male', label: 'Masculino' }, { value: 'other', label: 'Otro' },
]

// #174: modal estilado (no confirm() nativo). Desactivar es reversible → aclara que NO borra la cuenta.
function deactivateEmployee(emp: EmployeeProfile) {
  askConfirm({
    title: 'Desactivar empleado',
    message: `${emp.userName || emp.position} pasará a inactivo. No se borra: la cuenta y el legajo se conservan y podés reactivarlo cuando quieras.`,
    confirmLabel: 'Desactivar', danger: true,
    run: async () => { await EmpleadosService.deactivateProfile(emp.id); toast.success('Empleado desactivado') },
  })
}

async function reactivateEmployee(emp: EmployeeProfile) {
  try { await EmpleadosService.reactivateProfile(emp.id); toast.success('Empleado reactivado'); loadData() }
  catch { toast.error('Error al reactivar') }
}

function terminateContract(c: Contract) {
  askConfirm({
    title: 'Terminar contrato',
    message: `¿Terminar el contrato de ${getEmployeeName(c.employeeId)}?`,
    confirmLabel: 'Terminar', danger: true,
    run: async () => { await EmpleadosService.terminateContract(c.id); toast.success('Contrato terminado') },
  })
}

function deleteDocument(doc: EmployeeDocument) {
  askConfirm({
    title: 'Eliminar documento',
    message: `¿Eliminar el documento "${doc.name}"? Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => { await EmpleadosService.deleteDocument(doc.id); toast.success('Documento eliminado') },
  })
}

async function approveLeave(l: LeaveRequest) {
  try { await EmpleadosService.approveLeaveRequest(l.id); toast.success('Solicitud aprobada'); loadData() }
  catch { toast.error('Error al aprobar') }
}

function rejectLeave(l: LeaveRequest) {
  // Modal con motivo OBLIGATORIO (#190/#191): no se rechaza sin justificar.
  formModal.value = {
    title: 'Rechazar solicitud', submitLabel: 'Rechazar',
    fields: [{ key: 'reason', label: 'Motivo del rechazo', type: 'textarea', required: true, minLength: 3, maxLength: 500, placeholder: 'Explicá por qué se rechaza…' }],
    onSubmit: (v) => EmpleadosService.rejectLeaveRequest(l.id, String(v.reason ?? '')),
  }
}

async function completeReview(r: PerformanceReview) {
  try { await EmpleadosService.completeReview(r.id); toast.success('Evaluación completada'); loadData() }
  catch { toast.error('Error al completar') }
}

// ─── Formularios (modal genérico dirigido por estado) ───
type FormValues = Record<string, string | number>
const formModal = ref<{ title: string; submitLabel: string; fields: FormField[]; onSubmit?: (v: FormValues) => Promise<unknown>; readOnly?: boolean } | null>(null)
const savingForm = ref(false)

// Confirmación estilada (reemplaza confirm() nativo, #174).
const confirmModal = ref<{ title: string; message: string; confirmLabel?: string; danger?: boolean; run: () => Promise<unknown> } | null>(null)
const confirmBusy = ref(false)
function askConfirm(cfg: { title: string; message: string; confirmLabel?: string; danger?: boolean; run: () => Promise<unknown> }) { confirmModal.value = cfg }
async function runConfirm() {
  if (!confirmModal.value) return
  confirmBusy.value = true
  try { await confirmModal.value.run(); confirmModal.value = null; loadData() }
  catch (e) { toast.error(e instanceof Error ? e.message : 'La acción falló') }
  finally { confirmBusy.value = false }
}

const employeeOptions = () => profiles.value.map((p) => ({ value: p.id, label: p.userName || p.position || p.id }))
const contractTypeOptions = () => contractTypes.value.length
  ? contractTypes.value.map((t) => ({ value: t.code, label: t.name }))
  : [{ value: 'full_time', label: 'Tiempo completo' }, { value: 'part_time', label: 'Medio tiempo' }]

// #182: mostrar el tipo en español, nunca el código crudo ("Contract"/"full_time").
const CONTRACT_TYPE_ES: Record<string, string> = {
  full_time: 'Tiempo completo', part_time: 'Medio tiempo', temporary: 'Temporal',
  seasonal: 'Por temporada', internship: 'Pasantía', contractor: 'Por servicios', contract: 'Contrato',
}
function contractTypeName(code?: string): string {
  if (!code) return '—'
  return contractTypes.value.find((t) => t.code === code)?.name ?? CONTRACT_TYPE_ES[code.toLowerCase()] ?? code
}
/**
 * Monedas para elegir en un contrato. Reordenamos el enum global: DOP primero (salario local
 * del proyecto, mercado principal DR), luego el resto en el orden canónico. El shape {value,label}
 * es el que espera FormModal para los selects.
 */
const CURRENCIES: { value: CurrencyCode; label: string }[] = [
  CURRENCY_OPTIONS.find((c) => c.value === 'DOP')!,
  ...CURRENCY_OPTIONS.filter((c) => c.value !== 'DOP'),
].map((c) => ({ value: c.value as CurrencyCode, label: c.label }))

function openNewContract() {
  formModal.value = {
    title: 'Nuevo Contrato', submitLabel: 'Crear Contrato',
    fields: [
      { key: 'employeeId', label: 'Empleado', type: 'select', required: true, options: employeeOptions() },
      { key: 'type', label: 'Tipo', type: 'select', required: true, default: contractTypes.value[0]?.code ?? 'full_time', options: contractTypeOptions() },
      { key: 'startDate', label: 'Fecha inicio', type: 'date', required: true },
      { key: 'endDate', label: 'Fecha fin (opcional)', type: 'date' },
      // Mismo tope que el resto de campos de salario (#173/#176/#581): backend CreateContractSchema
      // limita a 99_999_999, el front lo espeja para no depender solo del 400 del servidor.
      { key: 'salary', label: 'Salario', type: 'number', required: true, min: 0, max: MAX_SALARY },
      { key: 'currency', label: 'Moneda', type: 'select', default: 'DOP', options: CURRENCIES },
      // #581: faltaba maxLength (backend CreateContractSchema.position tope 100).
      { key: 'position', label: 'Puesto', maxLength: 100 },
    ],
    onSubmit: (v) => EmpleadosService.createContract(v),
  }
}

function openNewDocument() {
  formModal.value = {
    title: 'Nuevo Documento', submitLabel: 'Guardar Documento',
    fields: [
      { key: 'employeeId', label: 'Empleado', type: 'select', required: true, options: employeeOptions() },
      { key: 'type', label: 'Tipo', type: 'select', required: true, default: 'id', options: [
        { value: 'id', label: 'Identificación' }, { value: 'contract', label: 'Contrato' },
        { value: 'certificate', label: 'Certificado' }, { value: 'other', label: 'Otro' },
      ] },
      { key: 'name', label: 'Nombre', required: true, maxLength: 120, placeholder: 'Cédula, Título…' },
      { key: 'fileData', label: 'Archivo', type: 'file', required: true, accept: '.pdf,image/*' },
      { key: 'expiryDate', label: 'Vence (opcional)', type: 'date' },
    ],
    onSubmit: (v) => EmpleadosService.createDocument({
      employeeId: String(v.employeeId ?? ''), type: String(v.type ?? ''), name: String(v.name ?? ''),
      expiryDate: v.expiryDate ? String(v.expiryDate) : undefined,
      fileData: v.fileData ? String(v.fileData) : undefined, fileName: v.fileDataName ? String(v.fileDataName) : undefined,
    }),
  }
}

function leaveTypeOptions() {
  const opts = leaveTypes.value.map((t) => ({ value: t.code, label: t.name }))
  return opts.length ? opts : [
    { value: 'vacation', label: 'Vacaciones' }, { value: 'permission', label: 'Permiso' },
    { value: 'sick_leave', label: 'Licencia médica' }, { value: 'maternity', label: 'Maternidad' }, { value: 'other', label: 'Otro' },
  ]
}

function openNewLeave() {
  formModal.value = {
    title: 'Nueva Solicitud de Ausencia', submitLabel: 'Crear Solicitud',
    // Sin campo "Días": el servidor lo calcula desde el rango, descontando festivos (#188).
    fields: [
      { key: 'employeeId', label: 'Empleado', type: 'select', required: true, options: employeeOptions() },
      { key: 'type', label: 'Tipo', type: 'select', required: true, default: 'vacation', options: leaveTypeOptions() },
      { key: 'startDate', label: 'Desde', type: 'date', required: true },
      { key: 'endDate', label: 'Hasta', type: 'date', required: true },
      { key: 'reason', label: 'Motivo', type: 'textarea', maxLength: 500 },
    ],
    onSubmit: (v) => {
      const leaveTypeId = leaveTypes.value.find((t) => t.code === v.type)?.id
      return EmpleadosService.createLeaveRequest({ ...v, leaveTypeId })
    },
  }
}

function reviewFields(r?: PerformanceReview): FormField[] {
  return [
    { key: 'employeeId', label: 'Empleado', type: 'select', required: true, options: employeeOptions(), default: r?.employeeId },
    { key: 'reviewDate', label: 'Fecha', type: 'date', required: true, default: r?.reviewDate ?? new Date().toISOString().slice(0, 10) },
    // #581: faltaba maxLength en todos los campos de texto de la evaluación (backend CreateReviewSchema/UpdateReviewSchema).
    { key: 'period', label: 'Período', placeholder: '2026-Q3', maxLength: 20, default: r?.period },
    // Puntaje 1-10 con tope validado en el modal y en el backend (#192).
    { key: 'score', label: 'Puntaje del evaluador (1-10)', type: 'number', min: 1, max: 10, default: r?.score ?? undefined },
    { key: 'strengths', label: 'Fortalezas', type: 'textarea', maxLength: 2000, default: r?.strengths },
    { key: 'improvements', label: 'A mejorar', type: 'textarea', maxLength: 2000, default: r?.improvements },
    { key: 'goals', label: 'Objetivos del próximo período', type: 'textarea', maxLength: 2000, default: r?.goals },
    { key: 'selfScore', label: 'Auto-evaluación del empleado (1-10)', type: 'number', min: 1, max: 10, default: r?.selfScore ?? undefined },
    { key: 'selfComments', label: 'Comentarios del empleado', type: 'textarea', maxLength: 2000, default: r?.selfComments },
  ]
}

function openNewReview() {
  formModal.value = {
    title: 'Nueva Evaluación', submitLabel: 'Crear Evaluación',
    fields: reviewFields(),
    onSubmit: (v) => EmpleadosService.createReview({ ...v, reviewerId: auth.user?.id ?? '' } as FormValues),
  }
}

// #193 Borrador editable
function openEditReview(r: PerformanceReview) {
  formModal.value = {
    title: 'Editar Evaluación (borrador)', submitLabel: 'Guardar cambios',
    fields: reviewFields(r),
    onSubmit: (v) => EmpleadosService.updateReview(r.id, v),
  }
}

// #194 Completada = solo lectura
function openViewReview(r: PerformanceReview) {
  formModal.value = {
    title: 'Evaluación (solo lectura)', submitLabel: '',
    fields: reviewFields(r),
    readOnly: true,
  }
}

async function submitForm(values: FormValues) {
  if (!formModal.value || !formModal.value.onSubmit) return
  savingForm.value = true
  try {
    await formModal.value.onSubmit(values)
    toast.success('Guardado')
    formModal.value = null
    loadData()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al guardar')
  } finally {
    savingForm.value = false
  }
}
</script>
