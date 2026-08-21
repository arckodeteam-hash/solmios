<template>
  <div>
    <div class="flex items-center gap-2.5 mb-6">
      <h2 class="text-xl font-black text-navy">Mantenimiento</h2>
      <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
        <span class="relative flex h-1.5 w-1.5">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
          <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
        </span>
        En vivo
      </span>
    </div>

    <!-- Toolbar: vista + acción primaria -->
    <div class="flex items-center justify-between gap-3 mb-6 flex-wrap">
      <div class="flex gap-2">
        <button
          v-for="view in views"
          :key="view.value"
          @click="activeView = view.value"
          class="px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
          :class="activeView === view.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'"
        >
          {{ view.label }}
        </button>
      </div>
      <button @click="openNewOrder" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nueva Orden
      </button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Abiertas" :value="openCount" icon="bookings" accent="amber"
        :unit="unassignedCount ? `${unassignedCount} sin asignar` : 'Todas asignadas'" />
      <KpiHeroCard label="En Progreso" :value="inProgressCount" icon="building" accent="blue"
        unit="Técnicos trabajando" />
      <KpiHeroCard label="Completadas" :value="closedCount" icon="checkin" accent="teal"
        :unit="avgHoursLabel" :progress="closedShare" />
    </div>

    <!-- Costo acumulado: dato de gestión, no de operación diaria -->
    <div class="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-border bg-white px-5 py-3.5">
      <div class="flex items-center gap-2.5">
        <span class="grid h-8 w-8 place-items-center rounded-lg bg-gold/10 text-gold">
          <span class="h-4 w-4" v-html="ICON_WALLET"></span>
        </span>
        <div>
          <div class="text-base font-black tabular-nums text-navy">${{ Math.round(totalCostCount).toLocaleString() }}</div>
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Costo total</div>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <span class="grid h-8 w-8 place-items-center rounded-lg bg-navy/10 text-navy">
          <span class="h-4 w-4" v-html="ICON_CLOCK"></span>
        </span>
        <div>
          <div class="text-base font-black tabular-nums text-navy">{{ avgHoursLabel }}</div>
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Tiempo promedio</div>
        </div>
      </div>
    </div>

    <!-- Board View -->
    <div v-if="activeView === 'board'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div v-for="column in kanbanColumns" :key="column.id"
        class="bg-surface rounded-xl p-4 min-h-[300px] transition-all"
        :class="dragOverCol === column.id ? 'ring-2 ring-navy bg-navy/5' : ''"
        @dragover.prevent="dragOverCol = column.id"
        @dragleave="dragOverCol = null"
        @drop.prevent="onDrop($event, column.id)">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full" :class="column.dotColor"></span>
            <h3 class="text-sm font-black text-navy">{{ column.title }}</h3>
          </div>
          <span class="bg-white px-2 py-0.5 rounded-full text-[10px] font-bold text-text-muted border border-border">
            {{ getColumnOrders(column.id).length }}
          </span>
        </div>
        <div class="space-y-3">
          <!-- Empty state: columna sin órdenes -->
          <div v-if="getColumnOrders(column.id).length === 0" class="flex flex-col items-center justify-center py-10 text-center border border-dashed border-border/60 rounded-xl">
            <span class="w-7 h-7 mb-2 text-text-muted opacity-50" v-html="column.icon"></span>
            <p class="text-xs font-bold text-text-muted">Sin órdenes</p>
            <p class="text-[10px] text-text-muted/70 mt-1 px-2 leading-tight">{{ column.emptyHint }}</p>
          </div>
          <div
            v-for="order in getColumnOrders(column.id)"
            :key="order.id"
            draggable="true"
            @dragstart="onDragStart($event, order)"
            @dragend="dragOverCol = null; draggedOrder = null"
            @click="openViewOrder(order)"
            class="bg-white rounded-xl p-4 border border-border border-l-4 hover:shadow-lg transition-all cursor-grab active:cursor-grabbing"
            :class="[draggedOrder?.id === order.id ? 'opacity-50' : '', catBorder(order.category)]">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" :class="priorityClass(order.priority)">
                {{ PRI_LABELS[order.priority] || order.priority }}
              </span>
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" :class="categoryClass(order.category)">
                {{ CAT_LABELS[order.category] || order.category }}
              </span>
            </div>
            <div class="text-sm font-black text-navy mb-1">{{ order.title }}</div>
            <div class="text-[11px] text-text-secondary mb-3">{{ order.location }}</div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white" :class="staffColor(order.assignedTo)">
                  <span>{{ getInitials(order.assignedTo) }}</span>
                </div>
                <span class="text-[10px] font-medium text-navy">{{ order.assignedToName }}</span>
              </div>
              <span class="text-[10px] text-text-muted">{{ order.date }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- List View -->
    <SectionCard v-else title="Órdenes de trabajo"
      :subtitle="`${filteredOrders.length} orden(es)${activeFilter !== 'all' ? ' · filtrado' : ''}`" body-class="p-0">
      <template #actions>
        <select id="maintenance-filter" name="activeFilter" aria-label="Filtrar órdenes por estado" v-model="activeFilter"
          class="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:border-cyan focus:outline-none cursor-pointer">
          <option v-for="filter in statusFilters" :key="filter.value" class="text-navy" :value="filter.value">{{ filter.label }}</option>
        </select>
      </template>

      <div v-if="loading" class="space-y-3 p-4">
        <div v-for="i in 5" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
      </div>

      <EmptyState v-else-if="filteredOrders.length === 0"
        :icon="ICON_WRENCH_EMPTY"
        :title="activeFilter !== 'all' ? 'Sin órdenes con este filtro' : 'Sin órdenes de mantenimiento'"
        :message="activeFilter !== 'all' ? 'Probá con otro estado o mirá todas las órdenes.' : 'Creá la primera orden para llevar registro de las reparaciones.'">
        <template #action>
          <button v-if="activeFilter !== 'all'" @click="activeFilter = 'all'"
            class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Ver todas</button>
          <button v-else @click="openNewOrder"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Nueva orden</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[980px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Orden</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Ubicación</th>
              <th class="text-left px-4 py-3 text-[10px]">Categoría</th>
              <th class="text-left px-4 py-3 text-[10px]">Prioridad</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-right px-4 py-3 text-[10px] hidden xl:table-cell">Duración</th>
              <th class="text-left px-4 py-3 text-[10px]">Asignado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in filteredOrders" :key="order.id"
              data-testid="mt-list-row" :data-order-id="order.id"
              @click="openViewOrder(order)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer">
              <td class="px-4 py-3">
                <div class="text-sm font-bold text-navy">{{ order.title }}</div>
                <div class="text-[11px] text-text-muted">
                  <span class="font-mono">#{{ shortId(order.id) }}</span>
                  <span class="lg:hidden"> · {{ order.location }}</span>
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">{{ order.location }}</td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="categoryClass(order.category)">
                  {{ CAT_LABELS[order.category] || order.category }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="priorityClass(order.priority)">
                  {{ PRI_LABELS[order.priority] || order.priority }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="statusClass(order.status)">
                  {{ statusLabel(order.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-right hidden xl:table-cell">
                <!-- Sin arrancar no hay duración: la celda queda vacía en vez de mostrar un guión. -->
                <span v-if="order.endTime && order.startTime" class="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-teal">
                  <span class="h-3 w-3 shrink-0" v-html="ICON_CLOCK"></span>
                  {{ formatDuration(order.startTime, order.endTime) }}
                </span>
                <span v-else-if="order.startTime" class="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-gold">
                  <span class="h-3 w-3 shrink-0" v-html="ICON_CLOCK"></span>
                  {{ formatElapsed(order.startTime) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div v-if="order.assignedTo || order.providerId" class="flex items-center gap-2">
                  <div class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy/10 text-[9px] font-black text-navy">
                    {{ getInitials(order.assignedToName) }}
                  </div>
                  <span class="text-sm text-text-secondary truncate max-w-[140px]" data-testid="mt-list-assigned">{{ order.assignedToName }}</span>
                </div>
                <span v-else class="text-sm text-text-muted">Sin asignar</span>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="openViewOrder(order)" title="Ver orden"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EYE"></span>
                  </button>
                  <button @click.stop="openEditOrder(order)" title="Editar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                  </button>
                  <button @click.stop="openStatusModal(order)" title="Cambiar estado"
                    class="grid h-8 w-8 place-items-center rounded-lg text-cyan hover:bg-cyan/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_SWITCH"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal: Ver Orden -->
    <AppModal v-if="showViewModal" size="lg" @close="showViewModal = false">
      <template #header>
        <div class="min-w-0">
          <h3 class="truncate text-lg font-black text-white">{{ selectedOrder.title }}</h3>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span class="font-mono text-[11px] text-white/60">#{{ shortId(selectedOrder.id) }}</span>
            <span class="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase" :class="statusClass(selectedOrder.status)">{{ statusLabel(selectedOrder.status) }}</span>
            <span class="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase" :class="priorityClass(selectedOrder.priority)">{{ PRI_LABELS[selectedOrder.priority] || selectedOrder.priority }}</span>
            <span v-if="selectedOrder.startTime && !selectedOrder.endTime" class="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tabular-nums text-gold">
              {{ formatElapsed(selectedOrder.startTime) }}
            </span>
          </div>
        </div>
      </template>

      <div>
          <!-- Info grid tipográfico -->
          <div class="grid grid-cols-3 gap-x-3 gap-y-3 pb-5 border-b border-border">
            <div>
              <div class="text-[10px] text-text-muted uppercase tracking-wide">Ubicación</div>
              <div class="text-xs font-bold text-navy mt-0.5">{{ selectedOrder.location || '—' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted uppercase tracking-wide">Categoría</div>
              <div class="text-xs font-bold text-navy mt-0.5">{{ CAT_LABELS[selectedOrder.category] || selectedOrder.category }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted uppercase tracking-wide">Asignado</div>
              <div class="text-xs font-bold text-navy mt-0.5">{{ selectedOrder.assignedToName }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted uppercase tracking-wide">Fecha</div>
              <div class="text-xs font-bold text-navy mt-0.5">{{ selectedOrder.date || '—' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted uppercase tracking-wide">Costo</div>
              <div class="text-xs font-bold text-navy mt-0.5">${{ selectedOrder.estimatedCost }}</div>
            </div>
            <div v-if="selectedOrder.endTime">
              <div class="text-[10px] text-text-muted uppercase tracking-wide">Duración</div>
              <div class="text-xs font-bold text-navy mt-0.5">{{ formatDuration(selectedOrder.startTime, selectedOrder.endTime) }}</div>
            </div>
          </div>
          <!-- Contacto del proveedor asignado. El encargado de facilidades no
               arregla: llama a quien tiene la habilidad, y lo hace desde acá en
               vez de irse a buscar el teléfono a la vista de Proveedores. -->
          <div v-if="assignedProvider" class="py-4 border-b border-border">
            <div class="rounded-xl border border-cyan/30 bg-cyan/5 p-3">
              <div class="flex items-start justify-between gap-2 mb-2">
                <div class="min-w-0">
                  <div class="text-sm font-black text-navy truncate">{{ assignedProvider.name }}</div>
                  <div class="text-[11px] text-text-secondary truncate">
                    <span v-if="assignedProvider.specialty">{{ assignedProvider.specialty }}</span>
                    <span v-if="assignedProvider.specialty && assignedProvider.rate"> · </span>
                    <span v-if="assignedProvider.rate">{{ assignedProvider.rate }}</span>
                  </div>
                </div>
                <span class="text-[9px] font-bold text-cyan bg-cyan/15 px-1.5 py-0.5 rounded-full shrink-0">Externo</span>
              </div>
              <div v-if="assignedProvider.phone || assignedProvider.email" class="flex flex-wrap gap-1.5">
                <a
                  v-if="assignedProvider.phone"
                  :href="`tel:${assignedProvider.phone}`"
                  class="px-3 py-1.5 rounded-lg bg-navy text-white text-[11px] font-bold hover:opacity-90 transition-opacity"
                >Llamar {{ assignedProvider.phone }}</a>
                <a
                  v-if="assignedProvider.phone"
                  :href="whatsappLink(assignedProvider.phone)"
                  target="_blank" rel="noopener"
                  class="px-3 py-1.5 rounded-lg bg-teal text-white text-[11px] font-bold hover:opacity-90 transition-opacity"
                >WhatsApp</a>
                <a
                  v-if="assignedProvider.email"
                  :href="`mailto:${assignedProvider.email}`"
                  class="px-3 py-1.5 rounded-lg border border-border text-[11px] font-bold text-text-secondary hover:border-navy/30 transition-colors"
                >Email</a>
              </div>
              <div v-else class="text-[11px] text-text-muted">
                Este proveedor no tiene teléfono cargado.
              </div>
            </div>
          </div>
          <!-- Descripción -->
          <div v-if="selectedOrder.description" class="py-4 border-b border-border text-xs text-text-secondary">{{ selectedOrder.description }}</div>
          <!-- Notas -->
          <div class="py-4 border-b border-border">
            <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Notas</div>
            <textarea id="maintenance-editing-notes" name="editingNotes" aria-label="Notas del técnico" v-if="selectedOrder.status !== 'closed'" v-model="editingNotes" rows="2" class="w-full px-3 py-2 bg-surface border border-border rounded-lg text-xs focus:outline-none focus:border-navy resize-none" placeholder="Notas del técnico..."></textarea>
            <div v-else class="text-xs text-text-secondary">{{ selectedOrder.notes || '—' }}</div>
            <button v-if="selectedOrder.status !== 'closed' && editingNotes !== (selectedOrder.notes || '')" @click="saveNotes()" class="mt-1.5 text-[10px] font-bold text-cyan hover:underline cursor-pointer">Guardar notas</button>
          </div>
          <!-- Fotos -->
          <div class="py-4 border-b border-border">
            <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Fotos</div>
            <div v-if="!selectedOrder.photos || selectedOrder.photos.length === 0" class="text-xs text-text-muted">Sin fotos</div>
            <div v-else class="flex gap-1.5 flex-wrap">
              <div v-for="(photo, i) in selectedOrder.photos" :key="i" class="relative">
                <img :src="photo.url" class="w-12 h-12 object-cover rounded-lg border border-border">
                <span class="absolute -top-1 -right-1 text-[7px] px-1 py-0.5 rounded-full font-bold text-white" :class="photo.type === 'before' ? 'bg-gold' : photo.type === 'after' ? 'bg-teal' : 'bg-navy'">{{ photo.type }}</span>
              </div>
            </div>
            <div v-if="selectedOrder.status !== 'closed'" class="mt-2 flex gap-1.5 items-center flex-wrap">
              <label class="px-2.5 py-1 border border-border rounded-lg text-[10px] font-bold text-text-secondary cursor-pointer hover:border-navy/30 transition-colors">
                + Elegir foto
                <input id="maintenance-elegir-foto" type="file" accept="image/*" class="hidden" @change="onPhotoSelected($event)">
              </label>
              <select id="maintenance-photo-type" name="newPhotoType" aria-label="Momento de la foto" v-model="newPhotoType" class="px-2 py-1 border border-border rounded-lg text-[10px] cursor-pointer">
                <option value="before">Antes</option>
                <option value="during">Durante</option>
                <option value="after">Después</option>
              </select>
              <button v-if="newPhotoFile" @click="uploadPhoto()" class="text-[10px] font-bold text-cyan hover:underline cursor-pointer">Subir</button>
            </div>
          </div>
          <!-- Historial -->
          <div class="pt-4">
            <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1.5 cursor-pointer hover:text-navy transition-colors" @click="loadAuditHistory()">Historial <span class="font-normal normal-case">(clic para ver)</span></div>
            <div v-if="auditHistory.length === 0" class="text-xs text-text-muted">Sin movimientos registrados</div>
            <div v-else class="space-y-1.5">
              <div v-for="entry in auditHistory" :key="entry.id" class="flex items-center gap-1.5 text-[11px]">
                <div class="w-1 h-1 rounded-full bg-navy/30 flex-shrink-0"></div>
                <span class="font-bold text-navy">{{ auditActionLabel(entry.action) }}</span>
                <span v-if="entry.newValue" class="text-text-muted">→ {{ entry.newValue }}</span>
                <span class="text-text-muted ml-auto">{{ formatDateTime(entry.timestamp) }}</span>
              </div>
            </div>
          </div>
      </div>

      <template #footer>
        <button @click="showViewModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cerrar</button>
        <button v-if="selectedOrder.status === 'open'" @click="startOrder(selectedOrder)"
          class="rounded-full bg-teal px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-light transition-colors cursor-pointer">Iniciar</button>
        <button v-if="selectedOrder.status === 'in_progress' || selectedOrder.status === 'waiting'" @click="completeOrder(selectedOrder)"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer">Completar</button>
      </template>
    </AppModal>

    <!-- Modal: Nueva Orden -->
    <AppModal v-if="showNewModal" size="lg"
      :title="editingOrder ? 'Editar orden' : 'Nueva orden'"
      subtitle="Reparación o tarea de mantenimiento" @close="showNewModal = false">
      <div>
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2">
              <label for="maintenance-titulo" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Título *</label>
              <input id="maintenance-titulo" name="title" required aria-required="true" v-model="newOrder.title" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" :class="formErrors.title ? 'border-coral' : ''" placeholder="Ej: Aire acondicionado no funciona">
              <p v-if="formErrors.title" class="text-[10px] text-coral mt-1">{{ formErrors.title }}</p>
            </div>
            <div class="relative">
              <label for="maintenance-habitacion" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Habitación *</label>
              <div class="relative">
                <input id="maintenance-habitacion" name="roomSearch"
                  v-model="roomSearch"
                  @focus="roomDropdownOpen = true"
                  @input="roomDropdownOpen = true"
                  @blur="closeDropdown(() => roomDropdownOpen = false)"
                  class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy pr-8"
                  :class="formErrors.roomNumber ? 'border-coral' : ''"
                  placeholder="Buscar habitación..."
                >
                <button v-if="newOrder.roomNumber" @mousedown.prevent="clearRoom()" class="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-navy text-xs cursor-pointer">✕</button>
              </div>
              <div v-if="roomDropdownOpen && filteredRooms.length" class="absolute z-10 mt-1 w-full bg-white border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                <div
                  v-for="room in filteredRooms"
                  :key="room.id"
                  @mousedown.prevent="selectRoom(room)"
                  class="px-4 py-2.5 text-sm cursor-pointer hover:bg-surface transition-colors"
                  :class="newOrder.roomId === room.id ? 'bg-navy/5 font-bold' : ''"
                >
                  <span class="font-bold text-navy">{{ room.number }}</span>
                  <span class="text-text-muted ml-2">{{ room.name || room.type }}</span>
                </div>
              </div>
              <p v-if="formErrors.roomNumber" class="text-[10px] text-coral mt-1">{{ formErrors.roomNumber }}</p>
            </div>
            <div>
              <label for="maintenance-categoria" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Categoría *</label>
              <select id="maintenance-categoria" name="category" v-model="newOrder.category" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer" :class="formErrors.category ? 'border-coral' : ''">
                <option value="">Seleccionar...</option>
                <option value="electrical">Eléctrico</option>
                <option value="plumbing">Plomería</option>
                <option value="hvac">Aire Acondicionado</option>
                <option value="carpentry">Carpintería</option>
                <option value="painting">Pintura</option>
                <option value="electronics">Electrónica</option>
                <option value="furniture">Muebles</option>
                <option value="appliance">Electrodomésticos</option>
                <option value="pest_control">Control de Plagas</option>
                <option value="general">Limpieza</option>
                <option value="structural">Otro</option>
              </select>
              <p v-if="formErrors.category" class="text-[10px] text-coral mt-1">{{ formErrors.category }}</p>
            </div>
            <div>
              <label for="maintenance-prioridad" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Prioridad *</label>
              <select id="maintenance-prioridad" name="priority" v-model="newOrder.priority" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="low">Baja</option>
                <option value="medium">Normal</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div class="relative">
              <label for="maintenance-asignar-a" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Asignar a</label>
              <div class="relative">
                <input id="maintenance-asignar-a" name="staffSearch"
                  v-model="staffSearch"
                  @focus="staffDropdownOpen = true"
                  @input="staffDropdownOpen = true"
                  @blur="closeDropdown(() => staffDropdownOpen = false)"
                  class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy pr-8"
                  placeholder="Técnico interno o proveedor de servicios..."
                >
                <button v-if="newOrder.assignedTo || newOrder.providerId" @mousedown.prevent="clearStaff()" class="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-navy text-xs cursor-pointer">✕</button>
              </div>
              <div v-if="staffDropdownOpen && filteredStaff.length" class="absolute z-10 mt-1 w-full bg-white border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                <div
                  v-for="opt in filteredStaff"
                  :key="opt.kind + opt.id"
                  @mousedown.prevent="selectStaff(opt)"
                  class="px-4 py-2.5 text-sm cursor-pointer hover:bg-surface transition-colors flex items-center gap-2"
                  :class="(newOrder.assignedTo === opt.id || newOrder.providerId === opt.id) ? 'bg-navy/5 font-bold' : ''"
                >
                  <div class="w-6 h-6 rounded-full flex items-center justify-center shrink-0" :class="opt.kind === 'provider' ? 'bg-cyan/15' : 'bg-navy/10'">
                    <span class="text-[9px] font-bold" :class="opt.kind === 'provider' ? 'text-cyan' : 'text-navy'">{{ opt.name.split(' ').map((n: string) => n[0]).join('') }}</span>
                  </div>
                  <span class="flex-1 min-w-0">
                    <span class="text-navy block truncate">{{ opt.name }}</span>
                    <!-- La habilidad es el criterio con el que se elige a quién llamar. -->
                    <span v-if="opt.specialty" class="block text-[10px] text-text-muted truncate">{{ opt.specialty }}</span>
                  </span>
                  <span v-if="opt.kind === 'provider'" class="text-[9px] font-bold text-cyan bg-cyan/10 px-1.5 py-0.5 rounded-full shrink-0">Externo</span>
                </div>
              </div>
            </div>
            <div class="col-span-2">
              <label for="maintenance-descripcion" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Descripción *</label>
              <textarea id="maintenance-descripcion" name="description" v-model="newOrder.description" rows="3" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy resize-none" placeholder="Describa el problema detalladamente..."></textarea>
            </div>
            <div>
              <label for="maintenance-costo-estimado" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Costo Estimado</label>
              <input id="maintenance-costo-estimado" name="estimatedCost" v-model="newOrder.estimatedCost" type="number" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="0.00">
            </div>
          </div>
      </div>

      <template #footer>
        <button @click="showNewModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <button @click="createOrder" :disabled="saving"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando…' : (editingOrder ? 'Guardar cambios' : 'Crear orden') }}
        </button>
      </template>
    </AppModal>

    <!-- Modal: Cambiar Estado -->
    <AppModal v-if="showStatusModal" size="md" title="Cambiar estado"
      :subtitle="selectedOrder.title" @close="showStatusModal = false">
      <div class="mb-4 font-mono text-xs text-text-muted">#{{ shortId(selectedOrder.id) }}</div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="status in availableStatuses"
          :key="status.value"
          @click="changeStatus(status.value)"
          :disabled="!canTransitionTo(status.value)"
          :title="canTransitionTo(status.value) ? '' : `No se puede pasar de ${statusLabel(selectedOrder.status)} a ${status.label}`"
          class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          :class="[
            canTransitionTo(status.value) ? 'cursor-pointer' : '',
            selectedOrder.status === status.value ? [statusClass(status.value), statusBorderFromDot(status.dotColor)] : 'border-border text-text-secondary hover:border-navy/30',
          ]"
        >
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="status.dotColor"></span>
          {{ status.label }}
        </button>
      </div>

      <template #footer>
        <button @click="showStatusModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { OperationsService } from '@/services/Operations.service'
import { RoomService } from '@/services/Room.service'
import { TeamService } from '@/services/Team.service'
import { TechnicalProvidersService } from '@/services/TechnicalProviders.service'
import { http } from '@/services/http'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'

const auth = useAuthStore()
const toast = useToast()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const MS_PER_HOUR = 3_600_000
const MS_PER_MINUTE = 60_000

const activeView = ref('list')
const activeFilter = ref('all')
const showViewModal = ref(false)
const showNewModal = ref(false)
const editingOrder = ref<any>(null)
const showStatusModal = ref(false)
const selectedOrder = ref<any>({})

const ICON_WRENCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>'
const ICON_EYE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.04 12.32a1 1 0 0 1 0-.64C3.42 7.51 7.36 4.5 12 4.5c4.64 0 8.57 3.01 9.96 7.18a1 1 0 0 1 0 .64C20.58 16.49 16.64 19.5 12 19.5c-4.64 0-8.57-3.01-9.96-7.18Z"/><circle cx="12" cy="12" r="3"/></svg>'
const ICON_PENCIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path stroke-linecap="round" d="m15 5 4 4"/></svg>'
const ICON_SWITCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg>'
// Variante a 32px para EmptyState (su caja mide 64px; con w-full el SVG queda gigante).
const ICON_WRENCH_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>'
const ICON_COG = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.991a7.66 7.66 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_CLOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_CHECK_PLAIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>'
const ICON_USER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>'
const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 12h.01M3 10h18"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'

const views = [
  { label: 'Lista', value: 'list' },
  { label: 'Tablero', value: 'board' }
]

const statusFilters = [
  { label: 'Todas', value: 'all' },
  { label: 'Abiertas', value: 'open' },
  { label: 'En Progreso', value: 'in_progress' },
  { label: 'Esperando', value: 'waiting' },
  { label: 'Completadas', value: 'closed' }
]

const kanbanColumns = [
  { id: 'open', title: 'Abierta', dotColor: 'bg-gold', icon: ICON_WRENCH, emptyHint: 'Las órdenes nuevas aparecen acá' },
  { id: 'in_progress', title: 'En Progreso', dotColor: 'bg-cyan', icon: ICON_COG, emptyHint: 'Arrastrá acá las órdenes en trabajo' },
  { id: 'waiting', title: 'Esperando', dotColor: 'bg-purple', icon: ICON_CLOCK, emptyHint: 'Órdenes pausadas o esperando repuestos' },
  { id: 'closed', title: 'Completada', dotColor: 'bg-teal', icon: ICON_CHECK_PLAIN, emptyHint: 'Órdenes resueltas' }
]

const availableStatuses = [
  { value: 'open', label: 'Abierta', description: 'Problema reportado, esperando asignación', dotColor: 'bg-gold' },
  { value: 'in_progress', label: 'En Progreso', description: 'Técnico trabajando en la solución', dotColor: 'bg-cyan' },
  { value: 'waiting', label: 'Esperando', description: 'Esperando repuestos o aprobación', dotColor: 'bg-purple' },
  { value: 'closed', label: 'Completada', description: 'Problema resuelto verificado', dotColor: 'bg-teal' }
]

// Espejo de STATUS_TRANSITIONS del backend (mantenimiento/usecases/timings.ts).
// Sin esto el modal ofrece los 4 estados siempre y la transición prohibida se
// descubre recién con el error del servidor (feedback #420).
const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['open', 'waiting', 'resolved', 'closed'],
  waiting: ['in_progress', 'resolved', 'closed', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
}

function isAllowedTransition(from: string, to: string): boolean {
  if (from === to) return true
  return (STATUS_TRANSITIONS[from] || []).includes(to)
}

function canTransitionTo(target: string): boolean {
  return isAllowedTransition(selectedOrder.value?.status || 'open', target)
}

// Solo el personal de mantenimiento (rol `maintenance`) se ofrece para asignar un
// ticket interno. Los tickets guardan assignedTo = users.id.
const maintenanceStaff = computed(() =>
  hotelStaff.value
    .filter(e => e.role === 'maintenance')
    .map(e => ({ id: e.id, name: e.name || 'Técnico' }))
)

// Opciones del selector "Asignar a": técnicos internos + proveedores de servicios
// externos (plomero, electricista…). Cada opción sabe si es staff o proveedor.
const assignOptions = computed(() => [
  ...maintenanceStaff.value.map(s => ({ kind: 'staff' as const, id: s.id, name: s.name, specialty: 'Personal interno' })),
  ...providers.value.map(p => ({ kind: 'provider' as const, id: p.id, name: p.name, specialty: p.specialty })),
])

const orders = ref<any[]>([])

// Conteos por estado que alimentan los KPI de la cabecera
// (el composable lee `.value` de inmediato al llamarse, así que debe ir DESPUÉS
// de que `orders` esté declarado — a diferencia de un computed normal, que es perezoso).
const openCount = computed(() => orders.value.filter((x: any) => x.status === 'open').length)
const inProgressCount = computed(() => orders.value.filter((x: any) => x.status === 'in_progress').length)
const unassignedCount = computed(() => orders.value.filter((x: any) => !x.assignedTo && !x.providerId && x.status !== 'closed').length)
const closedCount = computed(() => orders.value.filter((x: any) => x.status === 'closed').length)
const totalCostValue = computed(() => orders.value.reduce((s: number, x: any) => s + (x.estimatedCost ?? 0), 0))
const avgHoursValue = computed(() => {
  const closed = orders.value.filter((x: any) => (x.status === 'closed' || x.status === 'resolved') && x.startTime && x.endTime)
  if (closed.length === 0) return 0
  return closed.reduce((sum: number, x: any) => sum + (new Date(x.endTime).getTime() - new Date(x.startTime).getTime()), 0) / closed.length / MS_PER_HOUR
})

// Los KPI los anima KpiHeroCard internamente (useCountUp propio).
const totalCostCount = computed(() => totalCostValue.value)

// Promedio de resolución. Solo se puede calcular sobre órdenes que tienen inicio
// Y fin fichados: puede haber cerradas sin esos tiempos, así que el texto habla de
// tiempos fichados y no de cierres (decía "Sin cierres aún" con órdenes cerradas).
const avgHoursLabel = computed(() => avgHoursValue.value > 0.05
  ? `${Math.round(avgHoursValue.value * 10) / 10}h promedio`
  : 'Sin tiempos fichados')

// % de órdenes ya cerradas sobre el total — anillo del KPI "Completadas".
const closedShare = computed(() => orders.value.length
  ? Math.round((closedCount.value / orders.value.length) * 100)
  : 0)

const loading = ref(false)
const saving = ref(false)
const formErrors = ref<Record<string, string>>({})
const hotelRooms = ref<any[]>([])
const hotelStaff = ref<any[]>([])
const staffMap = ref<Record<string, string>>({})
interface ServiceProvider {
  id: string
  name: string
  /** Habilidad por la que se lo llama: plomería, electricidad, refrigeración… */
  specialty: string
  phone: string
  email: string
  /** Tarifa tal como la cargó el hotel (texto libre: "RD$800/hora"). */
  rate: string
}

const providers = ref<ServiceProvider[]>([])
const providerMap = ref<Record<string, string>>({})
const draggedOrder = ref<any>(null)
const dragOverCol = ref<string | null>(null)

// Autocomplete state — Habitación
const roomSearch = ref('')
const roomDropdownOpen = ref(false)
const filteredRooms = computed(() => {
  const q = roomSearch.value.toLowerCase()
  if (!q) return hotelRooms.value.slice(0, 20)
  return hotelRooms.value.filter(r => r.number.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q) || (r.type || '').toLowerCase().includes(q)).slice(0, 20)
})
function selectRoom(room: any) {
  newOrder.value.roomId = room.id
  newOrder.value.roomNumber = room.number
  roomSearch.value = `${room.number} — ${room.name || room.type}`
  roomDropdownOpen.value = false
}
function clearRoom() {
  newOrder.value.roomId = ''
  newOrder.value.roomNumber = ''
  roomSearch.value = ''
}

// Autocomplete state — Asignar a
const staffSearch = ref('')
const staffDropdownOpen = ref(false)
/** Proveedor externo a cargo de la orden abierta, con su contacto. */
const assignedProvider = computed<ServiceProvider | null>(() => {
  const id = selectedOrder.value?.providerId
  return id ? (providers.value.find(p => p.id === id) ?? null) : null
})

/**
 * WhatsApp abre con el número en formato internacional y sin separadores; los
 * teléfonos se cargan a mano ("809-555-0000", "+1 809 555 0000"), así que se
 * normaliza acá en vez de exigir un formato al que los cargó.
 */
function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}`
}

const filteredStaff = computed(() => {
  const q = staffSearch.value.toLowerCase()
  if (!q) return assignOptions.value.slice(0, 30)
  // Se busca también por especialidad: el encargado piensa "necesito un
  // plomero", no el nombre de la empresa.
  return assignOptions.value
    .filter(s => s.name.toLowerCase().includes(q) || s.specialty.toLowerCase().includes(q))
    .slice(0, 30)
})
function selectStaff(opt: { kind: 'staff' | 'provider'; id: string; name: string }) {
  // Un ticket tiene UN dueño: si se elige un proveedor externo, se libera el
  // técnico interno y viceversa (igual que en la app móvil).
  if (opt.kind === 'provider') {
    newOrder.value.providerId = opt.id
    newOrder.value.assignedTo = ''
  } else {
    newOrder.value.assignedTo = opt.id
    newOrder.value.providerId = ''
  }
  staffSearch.value = opt.name
  staffDropdownOpen.value = false
}
function clearStaff() {
  newOrder.value.assignedTo = ''
  newOrder.value.providerId = ''
  staffSearch.value = ''
}

function closeDropdown(fn: () => void) {
  setTimeout(fn, 200)
}

const PRI_LABELS: Record<string, string> = { high: 'Alta', medium: 'Normal', low: 'Baja', urgent: 'Urgente' }
// `locks` existe en datos (tickets de cerraduras) aunque el formulario no la ofrezca:
// sin la clave, la categoría se mostraba cruda en inglés.
const CAT_LABELS: Record<string, string> = { hvac: 'Aire Acond.', plumbing: 'Plomería', electrical: 'Eléctrico', electronics: 'Electrónica', general: 'General', carpentry: 'Carpintería', painting: 'Pintura', structural: 'Estructural', pest_control: 'Plagas', furniture: 'Muebles', appliance: 'Electrodom.', locks: 'Cerraduras' }

onMounted(async () => {
  // El staff y los proveedores se cargan primero para que los nombres se
  // resuelvan al mapear los tickets (assignedTo/providerId → nombre).
  await Promise.all([loadStaff(), loadProviders(), loadRooms()])
  await loadData()
})

async function loadData() {
  loading.value = true
  try {
    const res = await OperationsService.mantenimiento.list(hotelId.value) as any
    const items = res.data || res
    orders.value = (Array.isArray(items) ? items : []).map((o: any) => ({
      id: o.id,
      title: o.title || 'Sin título',
      location: o.roomNumber ? `Hab ${o.roomNumber}` : '',
      category: o.category || 'general',
      priority: o.priority || 'medium',
      status: o.status || 'open',
      assignedTo: o.assignedTo || '',
      providerId: o.providerId || '',
      // Nombre a mostrar: el proveedor de servicios si el ticket es externo, si no
      // el técnico interno. Ambos se resuelven contra /usuarios y el catálogo.
      assignedToName: o.providerId
        ? (providerMap.value[o.providerId] || 'Proveedor de servicios')
        : (staffMap.value[o.assignedTo] || (o.assignedTo ? o.assignedTo : 'Sin asignar')),
      isExternal: !!o.providerId,
      date: o.reportedDate ? String(o.reportedDate).slice(0, 10) : '',
      description: o.description || '',
      estimatedCost: o.estimatedCost || 0,
      roomId: o.roomId || null,
      startTime: o.startTime || null,
      endTime: o.endTime || null,
      notes: o.notes || '',
      photos: o.photos || [],
    }))
  } catch {
    toast.error('Error al cargar órdenes de mantenimiento')
  } finally {
    loading.value = false
  }
}

async function loadRooms() {
  if (!hotelId.value) return
  try {
    const { rooms } = await RoomService.list({ hotelId: hotelId.value, limit: 200 })
    hotelRooms.value = rooms
  } catch { /* silent — rooms are optional for the form */ }
}

async function loadStaff() {
  try {
    // Los técnicos son USUARIOS del hotel (tabla users), no perfiles de RRHH:
    // los tickets guardan assignedTo = users.id. employee-profiles trae otros ids.
    const res = await TeamService.list() as any
    const items = Array.isArray(res) ? res : (res?.data ?? [])
    hotelStaff.value = Array.isArray(items) ? items : []
    const map: Record<string, string> = {}
    for (const u of hotelStaff.value) {
      if (u.id && u.name) map[u.id] = u.name
    }
    staffMap.value = map
  } catch { /* silent — staff is optional */ }
}

async function loadProviders() {
  try {
    const res = await TechnicalProvidersService.list() as any
    const items = Array.isArray(res) ? res : (res?.data ?? [])
    // Se conservan especialidad y contacto: el encargado de facilidades no
    // ejecuta el arreglo, elige a QUIÉN llamar según la habilidad y lo llama.
    // Antes se guardaba solo `{id, name}` y esos datos se perdían acá, así que
    // había que salir a la vista de Proveedores a buscar el teléfono a mano.
    providers.value = (Array.isArray(items) ? items : [])
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        specialty: p.specialty || '',
        phone: p.phone || '',
        email: p.email || '',
        rate: p.rate || '',
      }))
      .filter((p: any) => p.id && p.name)
    const map: Record<string, string> = {}
    for (const p of providers.value) map[p.id] = p.name
    providerMap.value = map
  } catch { /* silent — proveedores son opcionales */ }
}

const newOrder = ref({
  title: '',
  roomId: '',
  roomNumber: '',
  category: '',
  priority: 'medium',
  assignedTo: '',
  providerId: '',
  description: '',
  estimatedCost: '',
})

const filteredOrders = computed(() => {
  if (activeFilter.value === 'all') return orders.value
  return orders.value.filter(o => o.status === activeFilter.value)
})

const getColumnOrders = (columnId: string) => {
  return orders.value.filter(o => o.status === columnId)
}

const getInitials = (name: string) => {
  return name.split(' ').map(n => n[0]).join('')
}

function shortId(id: string): string {
  return id ? id.slice(0, 8).toUpperCase() : ''
}

const statusClass = (status: string) => {
  const classes: Record<string, string> = {
    open: 'bg-gold/10 text-gold',
    in_progress: 'bg-cyan/10 text-cyan',
    waiting: 'bg-purple/10 text-purple',
    closed: 'bg-teal/10 text-teal',
    resolved: 'bg-teal/10 text-teal',
  }
  return classes[status] || 'bg-surface text-text-muted'
}

const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    open: 'Abierta',
    in_progress: 'En Progreso',
    waiting: 'Esperando',
    closed: 'Completada',
    resolved: 'Resuelta',
  }
  return labels[status] || status
}

const priorityClass = (priority: string) => {
  const classes: Record<string, string> = {
    low: 'bg-surface text-text-muted',
    medium: 'bg-blue/10 text-blue',
    high: 'bg-gold/10 text-gold',
    urgent: 'bg-coral/10 text-coral'
  }
  return classes[priority] || 'bg-surface text-text-muted'
}

const categoryClass = (category: string) => {
  const classes: Record<string, string> = {
    electrical: 'bg-gold/10 text-gold',
    plumbing: 'bg-blue/10 text-blue',
    hvac: 'bg-cyan/10 text-cyan',
    carpentry: 'bg-gold/10 text-gold',
    painting: 'bg-purple/10 text-purple',
    electronics: 'bg-navy/10 text-navy',
    general: 'bg-teal/10 text-teal',
    structural: 'bg-surface text-text-muted',
    pest_control: 'bg-coral/10 text-coral',
    locks: 'bg-purple/10 text-purple',
  }
  return classes[category] || 'bg-surface text-text-muted'
}

const openViewOrder = (order: any) => {
  selectedOrder.value = order
  editingNotes.value = order.notes || ''
  showViewModal.value = true
}

const openNewOrder = () => {
  editingOrder.value = null
  formErrors.value = {}
  newOrder.value = { title: '', roomId: '', roomNumber: '', category: '', priority: 'medium', assignedTo: '', providerId: '', description: '', estimatedCost: '' }
  roomSearch.value = ''
  staffSearch.value = ''
  showNewModal.value = true
}

const openEditOrder = (order: any) => {
  editingOrder.value = order
  formErrors.value = {}
  newOrder.value = {
    title: order.title || '',
    roomId: order.roomId || '',
    roomNumber: order.location?.replace('Hab ', '') || '',
    category: order.category || '',
    priority: order.priority || 'medium',
    assignedTo: order.assignedTo || '',
    providerId: order.providerId || '',
    description: order.description || '',
    estimatedCost: order.estimatedCost ? String(order.estimatedCost) : '',
  }
  // Set search displays for autocomplete
  const room = hotelRooms.value.find(r => r.number === newOrder.value.roomNumber)
  roomSearch.value = room ? `${room.number} — ${room.name || room.type}` : newOrder.value.roomNumber
  // El texto del autocomplete: el proveedor si el ticket es externo, si no el técnico.
  staffSearch.value = newOrder.value.providerId
    ? (providerMap.value[newOrder.value.providerId] || '')
    : (staffMap.value[newOrder.value.assignedTo] || '')
  showNewModal.value = true
}

const openStatusModal = (order: any) => {
  selectedOrder.value = order
  showStatusModal.value = true
}

const createOrder = async () => {
  formErrors.value = {}
  if (!newOrder.value.title || newOrder.value.title.length < 2) formErrors.value.title = 'Título requerido (mín. 2 caracteres)'
  if (!newOrder.value.roomNumber) formErrors.value.roomNumber = 'Ubicación requerida'
  if (!newOrder.value.category) formErrors.value.category = 'Categoría requerida'
  if (Object.keys(formErrors.value).length > 0) return
  saving.value = true
  // Resolve roomId from selected roomNumber
  const selectedRoom = hotelRooms.value.find(r => r.number === newOrder.value.roomNumber)
  const resolvedRoomId = selectedRoom?.id || newOrder.value.roomId || undefined
  try {
    if (editingOrder.value) {
      await OperationsService.mantenimiento.update(editingOrder.value.id, {
        title: newOrder.value.title,
        category: newOrder.value.category || 'general',
        priority: newOrder.value.priority || 'medium',
        description: newOrder.value.description || '',
        roomId: resolvedRoomId,
        roomNumber: newOrder.value.roomNumber || '',
        assignedTo: newOrder.value.assignedTo || '',
        providerId: newOrder.value.providerId || '',
        estimatedCost: newOrder.value.estimatedCost ? parseInt(newOrder.value.estimatedCost) : 0,
      })
      toast.success('Orden actualizada')
    } else {
      await OperationsService.mantenimiento.create({
        title: newOrder.value.title,
        hotelId: hotelId.value,
        category: newOrder.value.category || 'general',
        priority: newOrder.value.priority || 'medium',
        status: 'open',
        description: newOrder.value.description || '',
        roomId: resolvedRoomId,
        roomNumber: newOrder.value.roomNumber || '',
        assignedTo: newOrder.value.assignedTo || '',
        providerId: newOrder.value.providerId || '',
        estimatedCost: newOrder.value.estimatedCost ? parseInt(newOrder.value.estimatedCost) : 0,
        reportedDate: new Date().toISOString(),
      })
      toast.success('Orden de mantenimiento creada')
    }
    showNewModal.value = false
    editingOrder.value = null
    await loadData()
  } catch { toast.error(editingOrder.value ? 'Error al actualizar orden' : 'Error al crear orden') }
  finally { saving.value = false }
}

const completeOrder = async (order: any) => {
  try {
    await OperationsService.mantenimiento.post(`${order.id}/complete`, { notes: editingNotes.value || undefined })
    toast.success('Orden completada')
    showViewModal.value = false
    await loadData()
  } catch { toast.error('Error al completar orden') }
}

const startOrder = async (order: any) => {
  try {
    await OperationsService.mantenimiento.post(`${order.id}/start`, {})
    toast.success('Orden iniciada — cronómetro activo')
    showViewModal.value = false
    await loadData()
  } catch { toast.error('Error al iniciar orden') }
}

const editingNotes = ref('')
const auditHistory = ref<any[]>([])
const newPhotoFile = ref<File | null>(null)
const newPhotoType = ref('before')

const onPhotoSelected = (e: Event) => {
  const input = e.target as HTMLInputElement
  newPhotoFile.value = input.files?.[0] || null
}

/** Lee el archivo como data URL: los bytes viajan dentro del JSON. */
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

/**
 * La foto va como data URL en el cuerpo JSON, NO como multipart: el router del
 * framework no propaga los archivos al handler, así que el `FormData` que se
 * mandaba antes terminaba siempre en 400 "Archivo requerido" — nunca se pudo
 * adjuntar una foto a una orden desde el panel.
 */
const uploadPhoto = async () => {
  if (!selectedOrder.value?.id || !newPhotoFile.value) return
  try {
    const photo = await fileToDataUrl(newPhotoFile.value)
    await OperationsService.mantenimiento.post(`${selectedOrder.value.id}/photos`, {
      photo,
      fileName: newPhotoFile.value.name,
      type: newPhotoType.value,
    })
    newPhotoFile.value = null
    toast.success('Foto subida')
    await loadData()
    const updated = orders.value.find(o => o.id === selectedOrder.value.id)
    if (updated) selectedOrder.value = updated
  } catch (e: any) { toast.error('Error al subir foto', e?.message) }
}

const loadAuditHistory = async () => {
  if (!selectedOrder.value?.id) return
  try {
    const res = await OperationsService.mantenimiento.get(`${selectedOrder.value.id}/audit`) as any
    auditHistory.value = Array.isArray(res) ? res : (res.data || [])
  } catch { /* silent */ }
}

const auditActionLabel = (action: string): string => {
  const labels: Record<string, string> = {
    created: 'Creada',
    status_change: 'Estado cambiado',
    assignment: 'Asignación',
    notes_added: 'Notas actualizadas',
    photo_added: 'Foto agregada',
    priority_change: 'Prioridad cambiada',
    cost_updated: 'Costo actualizado',
  }
  return labels[action] || action
}

const saveNotes = async () => {
  if (!selectedOrder.value?.id) return
  try {
    await OperationsService.mantenimiento.put(`${selectedOrder.value.id}/notes`, { notes: editingNotes.value })
    const order = orders.value.find(o => o.id === selectedOrder.value.id)
    if (order) order.notes = editingNotes.value
    toast.success('Notas guardadas')
  } catch { toast.error('Error al guardar notas') }
}

// ─── Timer formatting ───────────────────────────────────
function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const hours = Math.floor(ms / MS_PER_HOUR)
  const mins = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE)
  if (hours > 0) return `${hours}h ${mins}min`
  return `${mins}min`
}

function formatElapsed(start: string): string {
  const ms = Date.now() - new Date(start).getTime()
  const hours = Math.floor(ms / MS_PER_HOUR)
  const mins = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE)
  if (hours > 0) return `${hours}h ${mins}min (en curso)`
  return `${mins}min (en curso)`
}

function formatDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const changeStatus = async (status: string) => {
  if (!selectedOrder.value?.id) return
  if (selectedOrder.value.status === status) { showStatusModal.value = false; return }
  try {
    await OperationsService.mantenimiento.update(selectedOrder.value.id, { status })
    const order = orders.value.find(o => o.id === selectedOrder.value.id)
    if (order) order.status = status
    toast.success(`Estado actualizado a "${statusLabel(status)}"`)
    showStatusModal.value = false
  } catch { toast.error('Error al cambiar estado') }
}

// ─── Drag & Drop Kanban ─────────────────────────────────────────────
function catBorder(cat: string) {
  const map: Record<string, string> = { hvac: 'border-l-cyan-500', plumbing: 'border-l-blue-500', electronics: 'border-l-amber-500', electrical: 'border-l-yellow-500', general: 'border-l-gray-400', carpentry: 'border-l-yellow-600', painting: 'border-l-purple-500', structural: 'border-l-red-500', pest_control: 'border-l-red-500' }
  return map[cat] || 'border-l-gray-300'
}

// Deriva el color de borde a partir del dot de estado (ej. 'bg-gold' → 'border-gold')
// para que el pill seleccionado en "Cambiar Estado" use el acento propio de cada estado.
function statusBorderFromDot(dotColor: string) {
  return dotColor.replace('bg-', 'border-')
}

function staffColor(name: string) {
  const colors = ['bg-cyan', 'bg-teal', 'bg-navy', 'bg-purple', 'bg-coral', 'bg-gold']
  const idx = (name || '').split('').reduce((s: number, c: string) => s + c.charCodeAt(0), 0) % colors.length
  return colors[idx]
}

function onDragStart(e: DragEvent, order: any) {
  draggedOrder.value = order
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', order.id)
}

async function onDrop(e: DragEvent, newStatus: string) {
  dragOverCol.value = null
  if (!draggedOrder.value || draggedOrder.value.status === newStatus) { draggedOrder.value = null; return }
  const order = draggedOrder.value
  // El backend rechaza las transiciones no permitidas; avisamos acá con el motivo
  // en vez de dejar que falle el request con un error genérico.
  if (!isAllowedTransition(order.status, newStatus)) {
    toast.error(`No se puede pasar de "${statusLabel(order.status)}" a "${statusLabel(newStatus)}"`)
    draggedOrder.value = null
    return
  }
  try {
    await OperationsService.mantenimiento.update(order.id, { status: newStatus })
    const o = orders.value.find(o => o.id === order.id)
    if (o) o.status = newStatus
    toast.success(`Orden movida a "${statusLabel(newStatus)}"`)
  } catch { toast.error('Error al mover orden') }
  draggedOrder.value = null
}
</script>

<style scoped>
/* Las transiciones de entrada/salida ahora las aporta AppModal. */
</style>
