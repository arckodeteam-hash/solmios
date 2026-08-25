<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div class="flex items-center gap-2.5">
        <h2 class="text-xl font-black text-navy">Grupos &amp; Blocks</h2>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
          <span class="relative flex h-1.5 w-1.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
          </span>
          En vivo
        </span>
      </div>
      <button v-if="canCreate" @click="openNewGroup" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo Grupo
      </button>
    </div>

    <!-- Stats — KpiHeroCard (mismo lenguaje visual que dashboard/huéspedes) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Grupos Activos" :value="groupsCount" icon="users" accent="blue"
        unit="Grupos y blocks registrados" />
      <KpiHeroCard label="Habitaciones Bloqueadas" :value="blockedRooms" icon="bed" accent="teal"
        unit="Inventario comprometido" />
      <KpiHeroCard label="Ingresos Potenciales" :value="potentialRevenue" icon="money" accent="amber"
        prefix="$" unit="Valor total de los grupos" />
      <KpiHeroCard label="Pendiente Confirmar" :value="pendingCount" icon="bookings" accent="rose"
        unit="Grupos sin confirmación" :progress="pendingShare" />
    </div>

    <!-- Lista de Grupos -->
    <SectionCard
      v-if="activeView === 'list'"
      title="Listado de grupos"
      :subtitle="`${groupsCount} grupo(s) · ${blockedRooms} habitación(es)`"
      body-class="p-0"
    >
      <template #actions>
        <div class="flex gap-1.5">
          <button
            v-for="view in views"
            :key="view.value"
            @click="activeView = view.value"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer"
            :class="activeView === view.value ? 'bg-white text-navy' : 'border border-white/15 bg-white/10 text-white/80 hover:bg-white/20'"
          >
            {{ view.label }}
          </button>
        </div>
      </template>

      <!-- Skeleton de carga -->
      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
      </div>

      <EmptyState
        v-else-if="!groups.length"
        :icon="ICON_USERS_GROUP"
        title="Todavía no hay grupos"
        message="Un grupo agrupa varias habitaciones bajo un mismo contacto y una misma cuenta: bodas, contingentes y eventos corporativos. Creá el primero con las fechas y la cantidad de habitaciones a bloquear."
      >
        <template v-if="canCreate" #action>
          <button @click="openNewGroup" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo Grupo
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[920px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Grupo</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Fechas</th>
              <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Noches</th>
              <th class="text-right px-4 py-3 text-[10px]">Habitaciones</th>
              <th class="text-right px-4 py-3 text-[10px] hidden xl:table-cell">Huéspedes</th>
              <th class="text-right px-4 py-3 text-[10px]">Total</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in groups"
              :key="group.id"
              @click="openViewGroup(group)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer"
            >
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-[11px] font-black text-navy">
                    {{ initialsOf(group.name) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-sm font-bold text-navy truncate">{{ group.name }}</div>
                    <!-- Líneas secundarias: sólo si el dato existe (nada de guiones sueltos) -->
                    <div v-if="contactLine(group)" class="text-[11px] text-text-muted truncate">{{ contactLine(group) }}</div>
                    <div v-if="group.checkIn && group.checkOut" class="text-[11px] text-text-muted lg:hidden">
                      {{ group.checkIn }} — {{ group.checkOut }} · {{ group.nights }} noche(s)
                    </div>
                    <div v-if="group.tags?.length" class="mt-1 flex flex-wrap gap-1">
                      <span v-for="tag in group.tags" :key="tag" class="rounded-full bg-surface px-2 py-0.5 text-[9px] font-bold text-text-muted">
                        {{ tag }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <span v-if="group.checkIn && group.checkOut" class="text-sm text-text-secondary">{{ group.checkIn }} — {{ group.checkOut }}</span>
                <span v-else class="text-sm text-text-muted">Sin fechas</span>
              </td>
              <td class="px-4 py-3 text-right text-sm font-bold text-navy tabular-nums hidden lg:table-cell">{{ group.nights }}</td>
              <td class="px-4 py-3 text-right text-sm font-bold text-navy tabular-nums">{{ group.rooms }}</td>
              <td class="px-4 py-3 text-right text-sm text-text-secondary tabular-nums hidden xl:table-cell">{{ group.guests }}</td>
              <td class="px-4 py-3 text-right">
                <div class="text-sm font-extrabold text-navy tabular-nums">${{ (group.total ?? 0).toLocaleString() }}</div>
                <div v-if="group.deposit" class="text-[11px] text-text-muted tabular-nums">
                  Depósito ${{ group.deposit.toLocaleString() }}
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide" :class="statusClass(group.status)">
                  {{ statusLabel(group.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="openViewGroup(group)" title="Ver detalles"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EYE"></span>
                  </button>
                  <button @click.stop="openEditGroup(group)" title="Editar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Vista Calendario -->
    <SectionCard v-else title="Calendario de blocks" :subtitle="currentWeekLabel" body-class="p-0">
      <template #actions>
        <div class="flex gap-1.5">
          <button
            v-for="view in views"
            :key="view.value"
            @click="activeView = view.value"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer"
            :class="activeView === view.value ? 'bg-white text-navy' : 'border border-white/15 bg-white/10 text-white/80 hover:bg-white/20'"
          >
            {{ view.label }}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <button @click="prevWeek" title="Semana anterior"
            class="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer">
            <span class="h-4 w-4" v-html="ICON_CHEVRON_LEFT"></span>
          </button>
          <button @click="nextWeek" title="Semana siguiente"
            class="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer">
            <span class="h-4 w-4" v-html="ICON_CHEVRON_RIGHT"></span>
          </button>
        </div>
      </template>

      <div v-if="loading" class="space-y-2 p-4">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
      </div>

      <EmptyState
        v-else-if="!groups.length"
        :icon="ICON_USERS_GROUP"
        title="Sin blocks en el calendario"
        message="Cuando registres un grupo vas a ver acá las noches que ocupa."
      >
        <template v-if="canCreate" #action>
          <button @click="openNewGroup" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo Grupo
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[800px] tbl-head">
          <thead>
            <tr>
              <th class="px-3 py-3 text-[10px] text-left w-40">Grupo</th>
              <th v-for="day in weekDays" :key="day.date" class="px-3 py-3 text-[10px] text-center">
                {{ day.label }}
                <div class="text-text-secondary font-normal normal-case tracking-normal">{{ day.date }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in groups" :key="group.id" class="border-b border-border last:border-0">
              <td class="px-3 py-3">
                <div class="text-sm font-bold text-navy truncate">{{ group.name }}</div>
                <div class="text-[10px] text-text-muted tabular-nums">{{ group.rooms }} hab.</div>
              </td>
              <td v-for="day in weekDays" :key="day.date" class="p-1">
                <div
                  v-if="isGroupActive(group, day.date)"
                  class="h-10 rounded-lg flex items-center justify-center text-[10px] font-bold tabular-nums cursor-pointer"
                  :class="getGroupDayClass(group, day.date)"
                >
                  {{ group.rooms }} Hab
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal: Ver Grupo -->
    <AppModal v-if="showViewModal" size="lg" @close="showViewModal = false">
      <template #header>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-lg font-black text-white truncate">{{ selectedGroup.name }}</h3>
            <span class="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
              {{ statusLabel(selectedGroup.status) }}
            </span>
          </div>
          <p v-if="selectedGroup.checkIn && selectedGroup.checkOut" class="mt-0.5 truncate text-[11px] text-white/60">
            {{ selectedGroup.checkIn }} — {{ selectedGroup.checkOut }} · {{ selectedGroup.nights }} noche(s) · {{ selectedGroup.rooms }} hab.
          </p>
        </div>
      </template>

      <!-- Ficha: sólo los campos con dato real -->
      <div v-if="detailFields.length" class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pb-5 border-b border-border">
        <div v-for="field in detailFields" :key="field.label">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ field.label }}</div>
          <div class="mt-0.5 text-sm font-bold text-navy break-words">{{ field.value }}</div>
        </div>
      </div>
      <p v-else class="pb-5 border-b border-border text-xs text-text-muted">Sin datos de contacto registrados</p>

      <div class="py-5 border-b border-border space-y-2">
        <div class="flex justify-between gap-4 text-sm">
          <span class="text-text-secondary">{{ selectedGroup.rooms }} hab. × {{ selectedGroup.nights }} noches × ${{ selectedGroup.rate }}</span>
          <span class="font-bold text-navy tabular-nums">${{ (selectedGroup.rooms * selectedGroup.nights * selectedGroup.rate).toLocaleString() }}</span>
        </div>
        <div class="flex justify-between gap-4 text-sm">
          <span class="text-text-secondary">Impuestos (18%)</span>
          <span class="font-bold text-navy tabular-nums">${{ Math.round(selectedGroup.total * 0.18).toLocaleString() }}</span>
        </div>
        <div class="flex justify-between gap-4 text-sm pt-2 border-t border-border">
          <span class="font-extrabold text-navy">Total</span>
          <span class="font-extrabold text-navy tabular-nums">${{ selectedGroup.total.toLocaleString() }}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 py-5" :class="{ 'border-b border-border': selectedGroup.notes }">
        <div class="rounded-2xl border border-border bg-surface/60 p-4">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Depósito Recibido</div>
          <div class="mt-1 text-lg font-black text-teal tabular-nums">${{ selectedGroup.deposit.toLocaleString() }}</div>
        </div>
        <div class="rounded-2xl border border-border bg-surface/60 p-4">
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Pendiente de Pago</div>
          <div class="mt-1 text-lg font-black text-gold tabular-nums">${{ (selectedGroup.total - selectedGroup.deposit).toLocaleString() }}</div>
        </div>
      </div>

      <div v-if="selectedGroup.notes" class="pt-5">
        <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1">Notas</div>
        <div class="text-sm text-text-secondary whitespace-pre-line">{{ selectedGroup.notes }}</div>
      </div>

      <template #footer>
        <button @click="showViewModal = false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cerrar</button>
        <button class="flex items-center gap-1.5 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_DOCUMENT"></span>
          Exportar PDF
        </button>
      </template>
    </AppModal>

    <!-- Modal: Nuevo Grupo -->
    <AppModal v-if="showNewModal" size="lg" title="Nuevo Grupo / Block" subtitle="Reservas colectivas, bodas y eventos corporativos" @close="showNewModal = false">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="sm:col-span-2">
          <label for="groups-nombre-del-grupo" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Nombre del Grupo *</label>
          <input id="groups-nombre-del-grupo" name="name" required aria-required="true" v-model="newGroup.name" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" placeholder="Ej: Conferencia Tech Summit 2026">
        </div>
        <div>
          <label for="groups-contacto" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Contacto *</label>
          <input id="groups-contacto" name="contact" v-model="newGroup.contact" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" placeholder="Nombre del contacto">
        </div>
        <div>
          <label for="groups-empresa" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Empresa</label>
          <input id="groups-empresa" name="company" v-model="newGroup.company" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" placeholder="Nombre de la empresa">
        </div>
        <div>
          <label for="groups-telefono" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Teléfono</label>
          <input id="groups-telefono" name="phone" v-model="newGroup.phone" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" placeholder="+1 234 567 890">
        </div>
        <div>
          <label for="groups-email" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Email</label>
          <input id="groups-email" name="email" v-model="newGroup.email" type="email" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" placeholder="email@empresa.com">
        </div>
        <div>
          <label for="groups-fecha-check-in" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Fecha Check-in *</label>
          <input id="groups-fecha-check-in" name="checkIn" v-model="newGroup.checkIn" type="date" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
        </div>
        <div>
          <label for="groups-fecha-check-out" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Fecha Check-out *</label>
          <input id="groups-fecha-check-out" name="checkOut" v-model="newGroup.checkOut" type="date" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
        </div>
        <div>
          <label for="groups-habitaciones" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Habitaciones *</label>
          <input id="groups-habitaciones" name="rooms" v-model.number="newGroup.rooms" type="number" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm tabular-nums focus:outline-none focus:border-navy" placeholder="10">
        </div>
        <div>
          <label for="groups-tarifa-por-noche" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Tarifa por Noche *</label>
          <input id="groups-tarifa-por-noche" name="rate" v-model.number="newGroup.rate" type="number" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm tabular-nums focus:outline-none focus:border-navy" placeholder="150">
        </div>
        <div>
          <label for="groups-deposito" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Depósito</label>
          <input id="groups-deposito" name="deposit" v-model.number="newGroup.deposit" type="number" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm tabular-nums focus:outline-none focus:border-navy" placeholder="0">
        </div>
        <div>
          <label for="groups-tipo-de-evento" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Tipo de Evento</label>
          <select id="groups-tipo-de-evento" name="eventType" v-model="newGroup.eventType" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
            <option value="">Seleccionar...</option>
            <option value="Conferencia">Conferencia</option>
            <option value="Boda">Boda</option>
            <option value="Corporativo">Corporativo</option>
            <option value="Turismo Grupal">Turismo Grupal</option>
            <option value="Otro">Otro</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label for="groups-notas" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Notas</label>
          <textarea id="groups-notas" name="notes" v-model="newGroup.notes" rows="3" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy resize-none" placeholder="Instrucciones especiales, requerimientos..."></textarea>
        </div>
      </div>

      <template #footer>
        <button @click="showNewModal = false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="createGroup" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Crear Grupo</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { OperationsService } from '@/services/Operations.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { usePermissions } from '@/composables/usePermissions'

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_DOCUMENT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_USERS_GROUP = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'
const ICON_EYE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_PENCIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z"/></svg>'
const ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>'
const ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>'

const auth = useAuthStore()
const toast = useToast()
// /panel/reservas/* → módulo de permiso `reservations` (config/module-map.ts). Sin
// `reservations:create` el alta del grupo termina en 403: el botón no se muestra.
const { can } = usePermissions()
const canCreate = computed(() => can('reservations', 'create'))
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const activeView = ref('list')
const showViewModal = ref(false)
const showNewModal = ref(false)
const selectedGroup = ref<any>({})
const loading = ref(true)

const views = [
  { label: 'Lista', value: 'list' },
  { label: 'Calendario', value: 'calendar' }
]

const groups = ref<any[]>([])

const groupsCount = computed(() => groups.value.length)
const blockedRooms = computed(() => groups.value.reduce((s: number, x: any) => s + (x.rooms ?? 0), 0))
const potentialRevenue = computed(() => groups.value.reduce((s: number, x: any) => s + (x.total ?? 0), 0))
const pendingCount = computed(() => groups.value.filter((x: any) => x.status === 'Pendiente').length)
// % de grupos pendientes — alimenta el anillo del KPI, no es un dato nuevo.
const pendingShare = computed(() => (groupsCount.value ? Math.round((pendingCount.value / groupsCount.value) * 100) : 0))

// Ficha del detalle declarada como datos: los campos vacíos no se pintan.
const detailFields = computed(() => {
  const g = selectedGroup.value || {}
  return [
    { label: 'Contacto', value: g.contact },
    { label: 'Empresa', value: g.company },
    { label: 'Teléfono', value: g.phone },
    { label: 'Email', value: g.email },
  ].filter((f) => f.value)
})

const initialsOf = (name: string) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

const contactLine = (group: any) => [group.contact, group.company].filter(Boolean).join(' — ')

async function loadData() {
  try {
    const { data } = await OperationsService.grupos.list(hotelId.value)
    groups.value = data.map((g: any) => {
      const ci = String(g.checkIn || '').slice(5, 10)
      const co = String(g.checkOut || '').slice(5, 10)
      const nights = ci && co ? Math.ceil((new Date(g.checkOut).getTime() - new Date(g.checkIn).getTime()) / 86400000) : 0
      const rate = g.totalRooms ? Math.round(g.totalAmount / Math.max(g.totalRooms, 1) / Math.max(nights, 1)) : 0
      return {
        id: g.id, name: g.name, contact: '', company: '', phone: '', email: '',
        checkIn: ci, checkOut: co, nights, rooms: g.totalRooms, guests: (g.totalRooms ?? 0) * 2,
        rate, total: g.totalAmount, deposit: 0, status: g.status || 'pending',
        tags: [], notes: g.notes || '',
      }
    })
  } catch { toast.error('No se pudieron cargar los grupos') } finally { loading.value = false }
}
onMounted(loadData)

const newGroup = ref({
  name: '',
  contact: '',
  company: '',
  phone: '',
  email: '',
  checkIn: '',
  checkOut: '',
  rooms: 1,
  rate: 150,
  deposit: 0,
  eventType: '',
  notes: ''
})

const currentWeek = ref(new Date())
const currentWeekLabel = computed(() => {
  const start = new Date(currentWeek.value)
  start.setDate(start.getDate() - start.getDay() + 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${start.getDate()} ${start.toLocaleString('es', { month: 'short' })} — ${end.getDate()} ${end.toLocaleString('es', { month: 'short' })}`
})

const weekDays = computed(() => {
  const start = new Date(currentWeek.value)
  start.setDate(start.getDate() - start.getDay() + 1)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start)
    date.setDate(date.getDate() + i)
    return {
      label: date.toLocaleString('es', { weekday: 'short' }),
      date: `${date.getDate()}/${date.getMonth() + 1}`
    }
  })
})

const prevWeek = () => {
  const d = new Date(currentWeek.value)
  d.setDate(d.getDate() - 7)
  currentWeek.value = d
}

const nextWeek = () => {
  const d = new Date(currentWeek.value)
  d.setDate(d.getDate() + 7)
  currentWeek.value = d
}

const isGroupActive = (group: any, day: string) => {
  if (!group.checkIn || !group.checkOut || !day) return false
  const d = new Date(day).getTime()
  const ci = new Date(group.checkIn).getTime()
  const co = new Date(group.checkOut).getTime()
  return d >= ci && d <= co
}

const getGroupDayClass = (group: any, day: string) => {
  const s = String(group.status).toLowerCase()
  if (s === 'confirmado' || s === 'confirmed') return 'bg-teal/20 text-teal'
  if (s === 'pendiente' || s === 'pending') return 'bg-gold/20 text-gold'
  return 'bg-gray-100 text-gray-500'
}

const statusClass = (status: string) => {
  const classes: Record<string, string> = {
    'confirmado': 'bg-teal/10 text-teal',
    'confirmed': 'bg-teal/10 text-teal',
    'pendiente': 'bg-gold/10 text-gold',
    'pending': 'bg-gold/10 text-gold',
    'cancelado': 'bg-coral/10 text-coral',
    'cancelled': 'bg-coral/10 text-coral',
  }
  return classes[String(status || '').toLowerCase()] || 'bg-surface text-text-muted'
}

// Sólo etiqueta visible (UI en español); el valor de `status` no se toca.
const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    'confirmed': 'Confirmado',
    'pending': 'Pendiente',
    'cancelled': 'Cancelado',
  }
  const raw = String(status || '')
  return labels[raw.toLowerCase()] || raw || 'Sin estado'
}

const openViewGroup = (group: any) => {
  selectedGroup.value = group
  showViewModal.value = true
}

const openNewGroup = () => {
  newGroup.value = { name: '', contact: '', company: '', phone: '', email: '', checkIn: '', checkOut: '', rooms: 1, rate: 150, deposit: 0, eventType: '', notes: '' }
  showNewModal.value = true
}

const openEditGroup = (group: any) => {
  selectedGroup.value = group
  showNewModal.value = true
}

const createGroup = async () => {
  if (!newGroup.value.name) return
  try {
    const nights = Math.ceil((new Date(newGroup.value.checkOut || Date.now()).getTime() - new Date(newGroup.value.checkIn || Date.now()).getTime()) / (1000 * 60 * 60 * 24))
    await OperationsService.grupos.create({
      name: newGroup.value.name,
      hotelId: hotelId.value,
      totalRooms: newGroup.value.rooms || 1,
      checkIn: newGroup.value.checkIn,
      checkOut: newGroup.value.checkOut,
      status: 'pending',
      totalAmount: (newGroup.value.rooms || 1) * (nights > 0 ? nights : 1) * (newGroup.value.rate || 0),
      notes: newGroup.value.email ? `Contacto: ${newGroup.value.contact} / ${newGroup.value.email}` : '',
    })
    showNewModal.value = false
    await loadData()
  } catch { toast.error('Error al crear grupo') }
}
</script>

<style scoped></style>
