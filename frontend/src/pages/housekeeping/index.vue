<template>
  <div>
    <div class="flex items-center gap-2.5 mb-6">
      <h2 class="text-xl font-black text-navy">Limpieza</h2>
      <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
        <span class="relative flex h-1.5 w-1.5">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
          <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
        </span>
        En vivo
      </span>
    </div>

    <!-- Toolbar: fila 1 = navegación + acciones primarias, fila 2 = filtros -->
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div class="flex items-center gap-2">
        <button
          v-for="view in views"
          :key="view.value"
          @click="switchView(view.value)"
          class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
          :class="activeView === view.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'"
        >
          <span class="w-4 h-4 shrink-0" v-html="view.icon"></span>
          {{ view.label }}
        </button>
      </div>
      <div class="flex gap-2">
        <button @click="openAssignModal" class="flex items-center gap-1.5 bg-navy text-white font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
          Asignar Tarea
        </button>
        <button @click="openNewTask" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
          Nueva Tarea
        </button>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 mb-6">
      <button
        v-for="filter in statusFilters"
        :key="filter.value"
        @click="activeFilter = filter.value"
        class="px-3 py-1.5 rounded-full text-[11px] font-bold transition-all cursor-pointer"
        :class="activeFilter === filter.value ? 'bg-navy/10 text-navy' : 'text-text-secondary hover:bg-surface'"
      >
        {{ filter.label }}
      </button>
      <label class="flex items-center gap-1.5 text-[11px] font-bold text-text-secondary cursor-pointer ml-auto select-none">
        <input id="housekeeping-ocultar-terminadas" name="hideCompleted" type="checkbox" v-model="hideCompleted" class="accent-navy w-3.5 h-3.5 cursor-pointer" />
        Ocultar terminadas
      </label>
    </div>

    <!-- Stats cards — tarjetas hero del dashboard (gradiente + glow + ícono grande) -->
    <div class="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <KpiHeroCard v-for="stat in stats" :key="stat.label"
        :label="stat.label" :value="stat.value" :icon="stat.icon" :accent="stat.accent" />
    </div>

    <!-- Dashboard de Estadísticas -->
    <SectionCard v-if="activeView === 'stats'" title="Estadísticas de limpieza" subtitle="Rendimiento por empleado">
      <template #actions>
        <button
          v-for="r in statsRanges"
          :key="r"
          @click="changeStatsRange(r)"
          class="px-3 py-1.5 rounded-full text-[11px] font-bold transition-all cursor-pointer"
          :class="statsRangeDays === r ? 'bg-cyan text-navy' : 'bg-white/10 text-white hover:bg-white/20'"
        >
          Últimos {{ r }} días
        </button>
      </template>
      <div v-if="store.stats.length === 0" class="text-center py-12 text-text-muted text-sm">
        No hay tareas completadas en el período seleccionado.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-border">
              <th class="text-left p-3 text-[10px] font-bold text-text-muted uppercase">Empleado</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">Tareas completadas</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">Tiempo promedio</th>
              <th class="text-right p-3 text-[10px] font-bold text-text-muted uppercase">Tiempo total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in store.stats" :key="row.staffId" class="border-b border-border last:border-0">
              <td class="p-3 text-sm font-bold text-navy">{{ staffName(row.staffId) }}</td>
              <td class="p-3 text-sm text-right">{{ row.completed }}</td>
              <td class="p-3 text-sm text-right text-cyan font-bold">{{ humanizeMs(row.avgDurationMs) }}</td>
              <td class="p-3 text-sm text-right text-text-muted">{{ humanizeMs(row.totalDurationMs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Board View (Kanban) -->
    <SkeletonLoader v-else-if="activeView === 'board' && store.loading" variant="list" :rows="6" />
    <div v-else-if="activeView === 'board'" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <div v-for="column in kanbanColumns" :key="column.id"
        class="bg-surface rounded-xl p-4 min-h-[300px] transition-all"
        :class="dragOverColumn === column.id ? 'ring-2 ring-navy bg-navy/5' : ''"
        @dragover.prevent="dragOverColumn = column.id"
        @dragleave="dragOverColumn = null"
        @drop.prevent="onDrop($event, column.id)">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full" :class="column.dotColor"></span>
            <h3 class="text-sm font-black text-navy">{{ column.title }}</h3>
          </div>
          <!-- El total es el del hotel; si la columna muestra solo las últimas,
               se dice cuántas se están viendo en vez de fingir que son todas. -->
          <span class="bg-white px-2 py-0.5 rounded-full text-[10px] font-bold text-text-muted border border-border">
            <template v-if="columnTotal(column.id) > getColumnTasks(column.id).length">
              {{ getColumnTasks(column.id).length }} de {{ columnTotal(column.id) }}
            </template>
            <template v-else>{{ columnTotal(column.id) }}</template>
          </span>
        </div>
        <div class="space-y-3">
          <!-- Empty state: columna sin tareas -->
          <div v-if="getColumnTasks(column.id).length === 0" class="flex flex-col items-center justify-center py-10 text-center border border-dashed border-border/60 rounded-xl">
            <span class="w-7 h-7 mb-2 text-text-muted opacity-50" v-html="column.icon"></span>
            <p class="text-xs font-bold text-text-muted">Sin tareas</p>
            <p class="text-[10px] text-text-muted/70 mt-1 px-2 leading-tight">{{ column.emptyHint }}</p>
          </div>
          <div
            v-for="task in getColumnTasks(column.id)"
            :key="task.id"
            draggable="true"
            @dragstart="onDragStart($event, task)"
            @dragend="dragOverColumn = null; draggedTask = null"
            @click="openViewTask(task)"
            class="bg-white rounded-xl p-4 border border-border border-l-4 hover:shadow-lg transition-all cursor-grab active:cursor-grabbing"
            :class="[draggedTask?.id === task.id ? 'opacity-50' : '', TYPE_COLORS[task.rawType ?? ''] || 'border-l-gray-300']">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <span class="w-3.5 h-3.5 text-navy shrink-0" v-html="TYPE_ICONS[task.rawType ?? ''] || ICON_SPARKLE"></span>
                <span class="text-sm font-black text-navy">{{ task.roomNumber }}</span>
              </div>
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" :class="priorityBadgeClass(task.priority)">
                {{ task.priority }}
              </span>
            </div>
            <div class="text-[11px] text-text-secondary mb-3">{{ task.type }}</div>
            <div v-if="taskTime(task)" class="flex items-center gap-1 text-[10px] text-cyan font-bold mb-2">
              <span class="w-3 h-3 shrink-0" v-html="ICON_CLOCK"></span>
              {{ taskTime(task) }}
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white" :class="staffColor(task.assignedTo)">
                  {{ getInitials(task.assignedTo) }}
                </div>
                <span class="text-[10px] font-medium text-navy">{{ task.assignedTo }}</span>
              </div>
              <span v-if="task.photos.length" class="flex items-center gap-1 text-[10px] text-text-muted">
                <span class="w-3 h-3 shrink-0" v-html="ICON_CAMERA"></span>
                {{ task.photos.length }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- List View -->
    <SectionCard v-else title="Tareas de limpieza" body-class="p-0">
      <template #actions>
        <div class="relative">
          <input id="housekeeping-list-search" name="listSearch" aria-label="Buscar habitación, tipo, empleado" v-model="listSearch" type="text" placeholder="Buscar habitación, tipo, empleado..." class="pl-9 pr-4 py-2 rounded-full border border-border text-sm w-64 bg-white focus:outline-none focus:border-navy" />
          <span class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" v-html="ICON_SEARCH"></span>
        </div>
        <select id="housekeeping-page-size" name="listPageSize" aria-label="Tareas por página" v-model="listPageSize" class="px-3 py-2 rounded-full border border-border text-sm bg-white focus:outline-none focus:border-navy cursor-pointer">
          <option :value="10">10 por página</option>
          <option :value="20">20 por página</option>
          <option :value="50">50 por página</option>
        </select>
        <button @click="exportCsv" class="flex items-center gap-1.5 px-4 py-2 bg-white/10 rounded-full text-sm font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_DOWNLOAD"></span>
          Exportar CSV
        </button>
        <span class="text-xs text-white/70">
          <template v-if="listSearch">{{ paginatedTasks.length }} en esta página</template>
          <template v-else>{{ store.pageTotal }} tarea(s)</template>
        </span>
      </template>
      <SkeletonLoader v-if="store.loading" variant="table" :rows="6" class="p-4" />
      <div v-else class="overflow-x-auto">
        <table class="w-full">
        <thead>
          <tr class="border-b border-border">
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Hab</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Tipo</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Piso</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Prioridad</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Asignado</th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Tiempo</th>
            <th class="text-right p-4 text-[10px] font-bold text-text-muted uppercase">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="paginatedTasks.length === 0">
            <td colspan="8" class="p-0 py-6">
              <EmptyState :icon="ICON_SPARKLE" title="Sin tareas de limpieza"
                message="No hay tareas para los filtros actuales. Creá una nueva tarea o ajustá los filtros.">
                <template #action>
                  <button @click="openNewTask" class="bg-navy text-white font-bold text-sm px-5 py-2.5 rounded-full hover:bg-navy-light transition-colors cursor-pointer">
                    Nueva tarea
                  </button>
                </template>
              </EmptyState>
            </td>
          </tr>
          <tr v-for="task in paginatedTasks" :key="task.id" data-testid="hk-list-row" :data-task-id="task.id" class="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
            <td class="p-4 text-sm font-black text-navy cursor-pointer" @click="openViewTask(task)">{{ task.roomNumber }}</td>
            <td class="p-4 text-sm cursor-pointer" @click="openViewTask(task)">{{ task.type }}</td>
            <td class="p-4 text-sm">{{ task.floor }}</td>
            <td class="p-4">
              <span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="statusClass(task.status)">
                {{ statusLabel(task.status) }}
              </span>
            </td>
            <td class="p-4">
              <span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="priorityClass(task.priority)">
                {{ task.priority }}
              </span>
            </td>
            <td class="p-4">
              <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-full bg-navy/10 flex items-center justify-center">
                  <span class="text-[9px] font-bold text-navy">{{ getInitials(task.assignedTo) }}</span>
                </div>
                <span class="text-sm" data-testid="hk-list-assigned">{{ task.assignedTo }}</span>
              </div>
            </td>
            <td class="p-4 text-sm">
              <span v-if="taskTime(task)" class="text-cyan font-bold">{{ taskTime(task) }}</span>
              <span v-else class="text-text-muted">—</span>
            </td>
            <td class="p-4 text-right">
              <div class="flex items-center gap-4 justify-end flex-wrap">
                <button @click="openViewTask(task)" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Ver</button>
                <button @click="openEditTask(task)" class="text-[11px] font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Editar</button>
                <button
                  v-if="primaryAction(task)"
                  @click="runPrimary(task)"
                  class="rounded-full bg-teal/10 text-teal px-3 py-1 text-[11px] font-bold hover:bg-teal/20 transition-colors cursor-pointer"
                >{{ primaryAction(task)?.label }}</button>
              </div>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
      <!-- Pagination -->
      <div v-if="totalListPages > 1" class="p-4 border-t border-border flex items-center justify-between">
        <span class="text-xs text-text-muted">{{ listRange }}</span>
        <div class="flex items-center gap-1">
          <button @click="listPage = 1" :disabled="listPage <= 1" class="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-xs font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface">«</button>
          <button @click="listPage--" :disabled="listPage <= 1" class="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-xs font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface">‹</button>
          <span class="px-2 text-xs font-bold text-navy">{{ listPage }} / {{ totalListPages }}</span>
          <button @click="listPage++" :disabled="listPage >= totalListPages" class="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-xs font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface">›</button>
          <button @click="listPage = totalListPages" :disabled="listPage >= totalListPages" class="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-xs font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface">»</button>
        </div>
      </div>
    </SectionCard>

    <!-- Modal: Ver Tarea -->
    <AppModal v-if="showViewModal" size="lg" @close="showViewModal = false">
      <template #header>
        <div class="min-w-0">
          <div class="flex items-center gap-2.5 flex-wrap">
            <h3 class="text-base sm:text-lg font-black text-white truncate">Habitación {{ selectedTask.roomNumber }}</h3>
            <span class="text-[10px] font-bold px-2.5 py-1 rounded-full" :class="statusClassOnDark(selectedTask.status)">
              {{ statusLabel(selectedTask.status) }}
            </span>
          </div>
          <p class="text-[11px] text-white/60 mt-0.5 truncate">
            {{ selectedTask.type }}<span v-if="selectedTask.floor"> · Piso {{ selectedTask.floor }}</span>
          </p>
        </div>
      </template>
        <div class="space-y-4">
          <!-- Asignación y tiempos -->
          <div class="rounded-2xl border border-border p-4">
            <div class="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide font-bold">Asignada a</div>
                <div class="text-sm font-bold text-navy mt-0.5">{{ selectedTask.assignedTo }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide font-bold">Duración</div>
                <div class="text-sm font-bold text-cyan mt-0.5">{{ taskTime(selectedTask) || '—' }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide font-bold">Inicio</div>
                <div class="text-sm text-navy mt-0.5">{{ selectedTask.startTime ? formatTime(selectedTask.startTime) : '—' }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide font-bold">Fin</div>
                <div class="text-sm text-navy mt-0.5">{{ selectedTask.endTime ? formatTime(selectedTask.endTime) : '—' }}</div>
              </div>
            </div>
          </div>

          <!-- Calificar y aprobar (solo si está completada y sin calificar) -->
          <div v-if="selectedTask.status === 'completed'" class="rounded-2xl border-2 border-cyan/40 bg-cyan/5 p-4">
            <div class="text-[10px] font-bold text-cyan uppercase tracking-wide mb-1.5">Calificar limpieza</div>
            <p class="text-xs text-text-secondary mb-3">Poné la calificación del 1 al 10 y aprobá la habitación.</p>
            <div class="flex items-center gap-0.5 mb-3">
              <button
                v-for="n in 10" :key="n" type="button" @click="ratingInput = n"
                class="text-2xl leading-none transition-transform hover:scale-110 cursor-pointer"
                :class="ratingInput != null && n <= ratingInput ? 'text-cyan' : 'text-border'"
              >★</button>
              <span v-if="ratingInput != null" class="ml-2 text-sm font-black text-navy tabular-nums">{{ ratingInput }} / 10</span>
            </div>
            <textarea id="housekeeping-rating-note" name="ratingNote" aria-label="Nota para la camarera (opcional)"
              v-model="ratingNote" rows="2" maxlength="500"
              placeholder="Nota para la camarera (opcional)…"
              class="w-full px-3 py-2 bg-white border border-border rounded-lg text-sm focus:outline-none focus:border-cyan resize-none mb-3"
            ></textarea>
            <button
              @click="approveSelected"
              :disabled="ratingInput == null || approving"
              class="w-full py-2.5 bg-cyan text-navy rounded-xl text-sm font-extrabold hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >{{ approving ? 'Aprobando…' : 'Aprobar y calificar' }}</button>
          </div>

          <!-- Revisión del supervisor: puntos + quién aprobó + nota, todo junto -->
          <div v-if="selectedTask.rating != null || selectedTask.supervisorName || selectedTask.supervisorNote" class="rounded-2xl border border-border p-4">
            <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-3">Revisión del supervisor</div>
            <div v-if="selectedTask.rating != null" class="flex items-center flex-wrap gap-3 mb-3">
              <div class="text-2xl font-black text-navy leading-none tabular-nums">
                {{ selectedTask.rating }}<span class="text-sm font-bold text-text-muted"> / 10</span>
              </div>
              <div class="flex items-center gap-0.5 text-lg leading-none">
                <span v-for="n in 10" :key="n" :class="n <= (selectedTask.rating || 0) ? 'text-cyan' : 'text-border'">★</span>
              </div>
              <span class="text-[11px] font-bold px-2.5 py-1 rounded-full" :class="ratingClass(selectedTask.rating)">
                {{ ratingLabel(selectedTask.rating) }}
              </span>
            </div>
            <div v-if="selectedTask.supervisorName" class="flex items-center flex-wrap gap-2 text-sm">
              <svg class="w-4 h-4 text-teal shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span class="font-bold text-navy">Aprobada por {{ selectedTask.supervisorName }}</span>
              <span v-if="selectedTask.supOnSiteTime" class="text-[11px] text-text-muted">· en la habitación {{ formatTime(selectedTask.supOnSiteTime) }}</span>
            </div>
            <div v-if="selectedTask.supervisorNote" class="text-sm text-text-secondary bg-surface rounded-lg px-3 py-2 italic mt-2">"{{ selectedTask.supervisorNote }}"</div>
          </div>

          <!-- Evidencia: fotos + video juntos -->
          <div class="rounded-2xl border border-border p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide">Evidencia</div>
              <label class="text-[11px] font-bold text-cyan cursor-pointer hover:underline">
                + Subir foto
                <input id="housekeeping-subir-foto" type="file" accept="image/*" class="hidden" @change="onPhotoSelect" />
              </label>
            </div>
            <!-- Cada foto se muestra con el área que se le pidió a la camarera:
                 sin eso la evidencia es un mosaico anónimo. -->
            <div v-if="selectedTask.photos.length" class="grid grid-cols-3 gap-2">
              <div v-for="(photo, i) in selectedTask.photos" :key="photo.url" class="relative group">
                <img
                  :src="photo.url"
                  :alt="areaLabel(photo.areaId)"
                  loading="lazy"
                  @click="openLightbox(i)"
                  class="w-full h-20 object-cover rounded-lg border border-border cursor-zoom-in bg-surface"
                />
                <div class="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-navy/75 rounded-b-lg pointer-events-none">
                  <div class="text-[9px] font-bold text-white leading-tight truncate">{{ areaLabel(photo.areaId) }}</div>
                </div>
                <button
                  @click.stop="onRemovePhoto(photo.url)"
                  class="absolute top-1 right-1 w-5 h-5 bg-danger text-white rounded-full text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >✕</button>
              </div>
            </div>
            <div v-else class="text-xs text-text-muted">Sin fotos.</div>

            <div v-if="selectedTask.video" class="mt-4 pt-4 border-t border-border">
              <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-2">Video</div>
              <div v-if="videoLoading" class="flex items-center gap-2 text-xs text-text-muted py-3">
                <span class="w-3.5 h-3.5 rounded-full border-2 border-border border-t-cyan animate-spin"></span>
                Cargando video…
              </div>
              <div v-else-if="videoError" class="text-xs text-danger py-3">{{ videoError }}</div>
              <!-- El servidor lo está pasando a un formato que el navegador lea. -->
              <div
                v-else-if="selectedTask.video.transcoding"
                class="flex items-center gap-2 text-xs text-text-muted py-3"
              >
                <span class="w-3.5 h-3.5 rounded-full border-2 border-border border-t-cyan animate-spin"></span>
                Preparando el video para verlo acá… recargá en un minuto.
              </div>
              <!-- El teléfono grabó en un codec que el navegador no decodifica y la
                   conversión no llegó a hacerse. Descargarlo es mejor que un cuadro negro. -->
              <div
                v-else-if="videoUrl && !canPlayVideo"
                class="rounded-xl border border-border bg-surface p-4 text-center"
              >
                <div class="text-xs text-text-muted mb-3">
                  Este navegador no puede reproducir el video
                  <span v-if="selectedTask.video?.codec">({{ selectedTask.video.codec }})</span>.
                  Descargalo para verlo.
                </div>
                <a
                  :href="videoUrl"
                  download
                  class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan text-white text-xs font-bold"
                >
                  Descargar video
                </a>
              </div>
              <video
                v-else-if="videoUrl"
                :src="videoUrl"
                controls
                playsinline
                preload="metadata"
                class="w-full rounded-xl border border-border bg-black max-h-80"
                @error="videoDecodeFailed = true"
                @loadeddata="checkDecoded"
              ></video>
            </div>
          </div>

          <!-- Checklist de la limpieza: qué se hizo y qué quedó pendiente. Un item
               sin marcar es lo que el supervisor tiene que ir a mirar, así que se
               distingue del hecho en vez de listarlos todos igual. -->
          <div v-if="selectedTask.items.length" class="rounded-2xl border border-border p-4">
            <div class="flex items-center justify-between mb-2.5">
              <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide">Checklist de limpieza</div>
              <div class="text-[11px] font-bold tabular-nums" :class="checklistDone === selectedTask.items.length ? 'text-teal' : 'text-warning'">
                {{ checklistDone }} de {{ selectedTask.items.length }}
              </div>
            </div>
            <div class="space-y-1.5">
              <div v-for="item in selectedTask.items" :key="item.name" class="flex items-center gap-2.5">
                <span
                  class="w-4 h-4 shrink-0 rounded-full grid place-items-center"
                  :class="item.done ? 'bg-teal text-white' : 'border-2 border-border'"
                >
                  <svg v-if="item.done" class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                </span>
                <span class="text-sm" :class="item.done ? 'text-text-secondary' : 'text-navy font-bold'">{{ item.name }}</span>
                <span v-if="!item.done" class="text-[10px] font-bold text-warning uppercase tracking-wide">Sin hacer</span>
              </div>
            </div>
          </div>

          <!-- Notas -->
          <div v-if="selectedTask.notes" class="rounded-2xl border border-border p-4">
            <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-2">Notas / comentarios</div>
            <div class="text-sm text-text-secondary">{{ selectedTask.notes }}</div>
          </div>
        </div>
      <template #footer>
        <button @click="showViewModal = false" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cerrar</button>
        <button
          v-if="primaryAction(selectedTask)"
          @click="runPrimary(selectedTask)"
          class="px-5 py-2.5 bg-cyan text-navy rounded-full text-sm font-extrabold hover:shadow-lg transition-all cursor-pointer"
        >{{ primaryAction(selectedTask)?.label }}</button>
      </template>
    </AppModal>

    <!-- Modal: Nueva / Editar Tarea -->
    <AppModal
      v-if="showNewModal" size="lg"
      :title="editingId ? 'Editar tarea' : 'Nueva tarea'"
      @close="showNewModal = false"
    >
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Habitación *</label>
              <SearchSelect v-model="newTask.roomNumber" :options="roomOptions" placeholder="Buscar habitación..." />
            </div>
            <div>
              <label for="housekeeping-tipo-de-tarea" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Tipo de tarea *</label>
              <select id="housekeeping-tipo-de-tarea" name="type" v-model="newTask.type" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="">Seleccionar...</option>
                <option value="full_cleaning">Limpieza completa</option>
                <option value="quick_cleaning">Limpieza rápida</option>
                <option value="deep_cleaning">Limpieza profunda</option>
                <option value="inspection">Inspección</option>
                <option value="maintenance">Mantenimiento</option>
              </select>
            </div>
            <div>
              <label for="housekeeping-prioridad" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Prioridad</label>
              <select id="housekeeping-prioridad" name="priority" v-model="newTask.priority" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="medium">Normal</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div>
              <label for="housekeeping-asignar-a" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Asignar a</label>
              <select id="housekeeping-asignar-a" name="staffId" v-model="newTask.staffId" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="">Seleccionar...</option>
                <option v-for="emp in assignableStaff" :key="emp.id" :value="emp.id">{{ emp.name }}</option>
              </select>
            </div>
            <div class="col-span-2">
              <label for="housekeeping-notas" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Notas</label>
              <textarea id="housekeeping-notas" name="notes" v-model="newTask.notes" rows="3" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy resize-none" placeholder="Instrucciones especiales..."></textarea>
            </div>
          </div>
      <template #footer>
        <button @click="showNewModal = false" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <button @click="saveTask" :disabled="saving" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-extrabold cursor-pointer transition-colors disabled:opacity-50">
          {{ saving ? 'Guardando...' : (editingId ? 'Guardar Cambios' : 'Crear Tarea') }}
        </button>
      </template>
    </AppModal>

    <!-- Modal: Asignar Tareas Rápidas -->
    <AppModal v-if="showAssignModal" size="lg" title="Asignar tareas rápidas" @close="showAssignModal = false">
          <div class="mb-5">
            <label for="housekeeping-seleccionar-personal" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Seleccionar personal</label>
            <select id="housekeeping-seleccionar-personal" name="assignStaff" v-model="assignStaff" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
              <option value="">Seleccionar camarera...</option>
              <option v-for="emp in assignableStaff" :key="emp.id" :value="emp.id">{{ emp.name }}</option>
            </select>
            <p v-if="assignableStaff.length === 0" class="text-[11px] text-text-muted mt-1.5">No hay personal de limpieza (rol camarera) cargado en el hotel.</p>
          </div>
          <div v-if="assignStaff">
            <div class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-3">Tareas pendientes sin asignar</div>
            <div v-if="assignableTasks.length === 0" class="text-xs text-text-muted py-2">No hay tareas pendientes para asignar.</div>
            <div v-else class="space-y-2">
              <label v-for="task in assignableTasks" :key="task.id" class="flex items-center gap-3 rounded-xl p-3 border border-border cursor-pointer transition-colors hover:border-navy/30">
                <input :id="`housekeeping-asignar-${task.id}`" :aria-label="`Seleccionar la tarea de la habitación ${task.roomNumber}`" type="checkbox" :value="task.id" v-model="assignSelection" class="w-4 h-4 accent-navy" />
                <span class="text-sm font-black text-navy">{{ task.roomNumber }}</span>
                <span class="text-xs text-text-muted">{{ task.type }}</span>
              </label>
            </div>
          </div>
      <template #footer>
        <button @click="showAssignModal = false" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cerrar</button>
        <button
          @click="assignSelected"
          :disabled="assignSelection.length === 0 || !assignStaff"
          class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-extrabold cursor-pointer transition-colors disabled:opacity-50"
        >Asignar {{ assignSelection.length || '' }}</button>
      </template>
    </AppModal>

    <!-- Lightbox: la evidencia se recorre entera sin volver al listado. Antes había
         que cerrar y volver a abrir para pasar de una foto a la siguiente. -->
    <Teleport to="body">
      <div
        v-if="lightboxPhoto"
        @click="closeLightbox"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out"
      >
        <img
          :key="lightboxPhoto.url"
          :src="lightboxPhoto.url"
          :alt="lightboxPhoto.name || 'Evidencia'"
          @click.stop
          class="max-w-full max-h-full rounded-xl shadow-2xl object-contain select-none"
        />

        <!-- Flechas: solo si hay más de una foto que recorrer -->
        <template v-if="lightboxCount > 1">
          <button
            @click.stop="stepLightbox(-1)"
            class="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-white/90 text-navy rounded-full cursor-pointer hover:bg-white transition-colors shadow-lg"
            aria-label="Foto anterior"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button
            @click.stop="stepLightbox(1)"
            class="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-white/90 text-navy rounded-full cursor-pointer hover:bg-white transition-colors shadow-lg"
            aria-label="Foto siguiente"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </template>

        <!-- Área + posición. El área va también con una sola foto: es el dato que
             dice qué se está mirando. -->
        <div class="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-navy/85">
          <span class="text-xs font-bold text-white">{{ areaLabel(lightboxPhoto.areaId) }}</span>
          <span v-if="lightboxCount > 1" class="text-xs font-bold text-white/60 tabular-nums">
            {{ (lightboxIndex ?? 0) + 1 }} / {{ lightboxCount }}
          </span>
        </div>

        <button
          @click.stop="closeLightbox"
          class="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-white/90 text-navy rounded-full text-lg font-bold cursor-pointer hover:bg-white transition-colors"
          aria-label="Cerrar"
        >✕</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useCountUp } from '@/composables/useCountUp'
import { useHousekeepingStore, humanizeMs, type HousekeepingViewTask } from '@/stores/housekeeping.store'
import { HousekeepingService, type PhotoRequirement } from '@/services/Housekeeping.service'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useNow } from '@/composables/useNow'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import AppModal from '@/components/ui/AppModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'

const store = useHousekeepingStore()
const auth = useAuthStore()
const toast = useToast()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const activeView = ref('board')
const activeFilter = ref('all')
const showViewModal = ref(false)
const showNewModal = ref(false)
const showAssignModal = ref(false)
const selectedTask = ref<HousekeepingViewTask>(blankTask())
// ─── Áreas de la evidencia ───────────────────────────────────────────────────
// Cada foto guarda el `areaId` de lo que se le pidió fotografiar a la camarera.
// Sin resolverlo, la evidencia es un mosaico de fotos anónimas y el supervisor no
// sabe si está mirando el baño o el balcón.
//
// El nombre visible sale del catálogo que configura el hotel
// (`/housekeeping/photo-requirements`). Estas cuatro NO están ahí: las genera el
// flujo de la app, no el admin, así que su nombre vive acá.
const FLOW_AREA_LABELS: Record<string, string> = {
  start: 'Antes de limpiar',
  after: 'Después de limpiar',
  evidence: 'Evidencia adicional',
  supervisor_presence: 'Presencia del supervisor',
}

const areaNames = ref<Record<string, string>>({})

/** Cuántos items del checklist quedaron efectivamente hechos. */
const checklistDone = computed(() => selectedTask.value.items.filter((i) => i.done).length)

async function loadAreaNames() {
  try {
    // El endpoint responde `{data:[…]}` SIN el `success` que `http` usa para
    // desenvolver, así que acá llega el objeto entero y no el array que declara
    // el tipo. Se acepta cualquiera de las dos formas en vez de confiar en una:
    // el envoltorio difiere entre local y producción.
    const res = (await HousekeepingService.photoRequirements()) as unknown
    const list = Array.isArray(res)
      ? res
      : Array.isArray((res as { data?: unknown })?.data)
        ? ((res as { data: PhotoRequirement[] }).data)
        : []
    const map: Record<string, string> = {}
    for (const r of list) if (r?.areaId && r?.areaName) map[r.areaId] = r.areaName
    areaNames.value = map
  } catch {
    // El catálogo es decorativo: si no carga, las fotos caen al nombre del área.
  }
}

/** Nombre visible del área. Cae al propio id antes que a un vacío: un `x-patio`
 *  sin configurar dice algo, y "Sin área" solo cuando la foto no trae ninguna. */
function areaLabel(areaId?: string): string {
  if (!areaId) return 'Sin área'
  return areaNames.value[areaId] || FLOW_AREA_LABELS[areaId] || areaId
}

// Foto de evidencia ampliada (lightbox). Los thumbnails de 80px no dejan ver el
// detalle de la limpieza; al hacer click se abre a tamaño completo.
//
// Se guarda la POSICIÓN, no la url: así se pasa a la foto siguiente sin cerrar,
// que es como se revisa una limpieza (mirar las 6 fotos de la habitación de
// corrido, no abrir y cerrar una por una).
const lightboxIndex = ref<number | null>(null)
const lightboxCount = computed(() => selectedTask.value.photos.length)
const lightboxPhoto = computed(() =>
  lightboxIndex.value === null ? null : selectedTask.value.photos[lightboxIndex.value] ?? null,
)

function openLightbox(index: number) { lightboxIndex.value = index }
function closeLightbox() { lightboxIndex.value = null }

/** Avanza o retrocede dando la vuelta: de la última pasa a la primera. */
function stepLightbox(delta: number) {
  if (lightboxIndex.value === null || lightboxCount.value === 0) return
  lightboxIndex.value = (lightboxIndex.value + delta + lightboxCount.value) % lightboxCount.value
}

// Las flechas del teclado son el gesto natural para recorrer fotos. ESC cierra.
function onLightboxKey(e: KeyboardEvent) {
  if (lightboxIndex.value === null) return
  if (e.key === 'ArrowRight') stepLightbox(1)
  else if (e.key === 'ArrowLeft') stepLightbox(-1)
  else if (e.key === 'Escape') closeLightbox()
}
onMounted(() => document.addEventListener('keydown', onLightboxKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onLightboxKey))
// Video de evidencia: la URL se pide firmada al abrir el detalle (el bucket es
// privado, no se puede linkear directo). Se resetea entre tareas.
const videoUrl = ref<string | null>(null)
const videoLoading = ref(false)
const videoError = ref<string | null>(null)
// El backend marca `playableInBrowser: false` para HEVC (grabaciones de iPhone).
// `videoDecodeFailed` cubre el resto: cualquier codec que este navegador rechace
// en tiempo real, sin depender de que el backend lo haya clasificado.
const videoDecodeFailed = ref(false)

/**
 * Con un codec que no soporta, el navegador NO dispara `error`: abre el
 * contenedor, informa la duración y hasta `readyState: 4`, pero devuelve un
 * cuadro de 0×0 — pantalla negra sin ningún aviso. Medido en Chrome con un HEVC
 * de producción. Por eso la detección mira las dimensiones y no solo el evento.
 */
function checkDecoded(e: Event) {
  const el = e.target as HTMLVideoElement
  if (el.videoWidth === 0 || el.videoHeight === 0) videoDecodeFailed.value = true
}
const canPlayVideo = computed(
  () => selectedTask.value.video?.playableInBrowser !== false && !videoDecodeFailed.value,
)
// Calificación de la limpieza desde el panel (1–10) + nota del supervisor.
const ratingInput = ref<number | null>(null)
const ratingNote = ref('')
const approving = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const assignStaff = ref('')
const assignSelection = ref<string[]>([])
const statsRangeDays = ref(30)
const draggedTask = ref<HousekeepingViewTask | null>(null)
const dragOverColumn = ref<string | null>(null)

// List view pagination & search
const listPage = ref(1)
const listPageSize = ref(20)
const listSearch = ref('')

// D1/D3 — Ocultar tareas terminadas en la LISTA (no en el Kanban). Default OFF: se ven
// todas por defecto; el toggle es opt-in para reducir ruido cuando hay muchas. Persiste.
const hideCompleted = ref(localStorage.getItem('hk:hideCompleted') === 'true')
watch(hideCompleted, (v) => localStorage.setItem('hk:hideCompleted', String(v)))
// C1 — Reloj reactivo (cada 60s) para mostrar el tiempo transcurrido en vivo en in_progress.
const LIVE_TICK_MS = 60_000
const { now } = useNow(LIVE_TICK_MS)
const COMPLETED_STATUSES = ['completed', 'inspected']

const ICON_BOARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"/></svg>'
const ICON_LIST = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M4.5 6.75h.008v.008H4.5V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM4.5 12h.008v.008H4.5V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.008v.008H4.5v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>'
const ICON_CHART = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg>'

const views = [
  { label: 'Tablero', value: 'board', icon: ICON_BOARD },
  { label: 'Lista', value: 'list', icon: ICON_LIST },
  { label: 'Estadísticas', value: 'stats', icon: ICON_CHART },
]

const statusFilters = [
  { label: 'Todas', value: 'all' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'En Progreso', value: 'in_progress' },
  { label: 'Completadas', value: 'completed' },
  { label: 'Inspeccionadas', value: 'inspected' },
]

const statsRanges = [7, 30, 90]

const ICON_INBOX = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>'
const ICON_SPARKLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.035-.259a3.375 3.375 0 0 0 2.456-2.455L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"/></svg>'
const ICON_CHECK_PLAIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>'
const ICON_BOLT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 3v7.5H18L10.5 21v-7.5H6L13.5 3Z"/></svg>'
const ICON_DROPLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3.25S6.5 9.5 6.5 14a5.5 5.5 0 0 0 11 0c0-4.5-5.5-10.75-5.5-10.75Z"/></svg>'
const ICON_WRENCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"/></svg>'
const ICON_CLOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_CAMERA = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"/></svg>'
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 12m0 0l4.5-4.5M12 12V3"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'

// El Kanban es un flujo de proceso: las 4 columnas representan el pipeline completo
// (Pendiente → En Progreso → Completada → Inspeccionada). Ocultar etapas rompe la
// representación del proceso, así que el tablero SIEMPRE muestra las 4 columnas.
const kanbanColumns = [
  { id: 'pending', title: 'Pendiente', dotColor: 'bg-warning', icon: ICON_INBOX, emptyHint: 'Las tareas nuevas aparecen acá' },
  { id: 'in_progress', title: 'En Progreso', dotColor: 'bg-cyan', icon: ICON_SPARKLE, emptyHint: 'Arrastrá acá las tareas en limpieza' },
  { id: 'completed', title: 'Completada', dotColor: 'bg-teal', icon: ICON_CHECK_PLAIN, emptyHint: 'Tareas terminadas' },
  { id: 'inspected', title: 'Inspeccionada', dotColor: 'bg-purple', icon: ICON_SEARCH, emptyHint: 'Tareas verificadas por supervisión' },
]

const TYPE_ICONS: Record<string, string> = { full_cleaning: ICON_SPARKLE, quick_cleaning: ICON_BOLT, deep_cleaning: ICON_DROPLET, inspection: ICON_SEARCH, maintenance: ICON_WRENCH }
const TYPE_COLORS: Record<string, string> = { full_cleaning: 'border-l-4 border-l-cyan-500', quick_cleaning: 'border-l-4 border-l-teal-500', deep_cleaning: 'border-l-4 border-l-blue-600', inspection: 'border-l-4 border-l-purple-500', maintenance: 'border-l-4 border-l-amber-500' }

function blankTask(): HousekeepingViewTask {
  return { id: '', roomNumber: '', type: '', floor: '', status: 'pending', priority: 'Normal', priorityRaw: 'medium', assignedTo: 'Sin asignar', staffId: '', time: '', notes: '', items: [], photos: [], rating: null, video: null, supervisorName: '', supervisorNote: '', supOnSiteTime: '' }
}

// Fuentes numéricas separadas de `stats` para poder animarlas con useCountUp
// (el composable debe llamarse en el cuerpo de setup, no dentro del computed que arma las cards).
//
// Los totales salen del backend (`store.totals`), NO de contar lo cargado: el
// tablero trae solo las últimas de cada columna terminada, así que
// `tasks.filter(...).length` mostraría 10 donde hay 47 y nadie lo notaría.
const pendingCount = computed(() => store.totals.pending ?? 0)
const inProgressCount = computed(() => store.totals.in_progress ?? 0)
const completedCount = computed(() => store.totals.completed ?? 0)
const inspectedCount = computed(() => store.totals.inspected ?? 0)
const totalCount = computed(() =>
  Object.values(store.totals).reduce((sum, n) => sum + n, 0),
)

const pendingAnim = useCountUp(pendingCount)
const inProgressAnim = useCountUp(inProgressCount)
const completedAnim = useCountUp(completedCount)
const inspectedAnim = useCountUp(inspectedCount)
const totalAnim = useCountUp(totalCount)

const stats = computed(() => [
  { label: 'Pendientes', value: pendingAnim.value, icon: 'bookings' as const, accent: 'amber' as const },
  { label: 'En Progreso', value: inProgressAnim.value, icon: 'bed' as const, accent: 'blue' as const },
  { label: 'Completadas', value: completedAnim.value, icon: 'checkin' as const, accent: 'teal' as const },
  { label: 'Inspeccionadas', value: inspectedAnim.value, icon: 'users' as const, accent: 'purple' as const },
  { label: 'Total', value: totalAnim.value, icon: 'building' as const, accent: 'green' as const },
])

const availableRooms = computed(() =>
  store.rooms.map(r => ({ id: r.id, number: r.number, type: r.type || 'Estándar' })),
)

// Opciones para el SearchSelect de habitación (buscador dinámico en Nueva Tarea).
const roomOptions = computed(() =>
  availableRooms.value.map(r => ({ value: r.number, label: `${r.number} · ${r.type}` })),
)

// La tabla se pagina contra el SERVIDOR. Antes cortaba en el cliente la única
// página que había recibido, así que siempre decía "1 de 1" y las tareas de la
// página 2 en adelante no existían para el panel.
//
// La búsqueda por texto sigue siendo local porque mira campos que no están en la
// tabla (número de habitación y nombre de la camarera viven en otras tablas): por
// eso el contador aclara que filtra sobre la página que se está viendo.
const paginatedTasks = computed(() => {
  let tasks = store.pageTasks
  if (hideCompleted.value) tasks = tasks.filter(t => !COMPLETED_STATUSES.includes(t.status))
  if (listSearch.value) {
    const q = listSearch.value.toLowerCase()
    tasks = tasks.filter(t =>
      t.roomNumber.toLowerCase().includes(q) ||
      t.type.toLowerCase().includes(q) ||
      t.assignedTo.toLowerCase().includes(q) ||
      t.notes?.toLowerCase().includes(q)
    )
  }
  return tasks
})

const totalListPages = computed(() => Math.max(1, Math.ceil(store.pageTotal / listPageSize.value)))
/** Rango que se está viendo: "21–40 de 126". */
const listRange = computed(() => {
  if (!store.pageTotal) return '0 de 0'
  const from = (listPage.value - 1) * listPageSize.value + 1
  const to = Math.min(from + store.pageTasks.length - 1, store.pageTotal)
  return `${from}–${to} de ${store.pageTotal}`
})

/** Cada cambio de página, tamaño o filtro de estado va al servidor. */
function reloadListPage() {
  return store.loadPage({
    page: listPage.value,
    limit: listPageSize.value,
    status: activeFilter.value === 'all' ? undefined : activeFilter.value,
  })
}
watch([listPage, listPageSize], reloadListPage)
watch(activeFilter, () => { listPage.value = 1; reloadListPage() })
watch(activeView, (v) => { if (v === 'list' && !store.pageTasks.length) reloadListPage() })

// BUG FIX (#416): las tareas urgentes no aparecían arriba. Ahora cada columna ordena por prioridad
// (urgent → high → medium → low) para que las críticas se vean primero dentro de su columna.
const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const getColumnTasks = (columnId: string) => store.tasks
  .filter(t => t.status === columnId)
  .sort((a, b) => (PRIORITY_WEIGHT[a.priorityRaw] ?? 9) - (PRIORITY_WEIGHT[b.priorityRaw] ?? 9))
/** Cuántas hay en el hotel en ese estado (el tablero puede estar mostrando menos). */
const columnTotal = (columnId: string) => store.totals[columnId] ?? getColumnTasks(columnId).length

// Tareas pendientes sin staff asignado → candidatas a asignación rápida.
const assignableTasks = computed(() =>
  store.tasks.filter(t => t.status === 'pending' && !t.staffId),
)

// Solo el personal de LIMPIEZA (rol camarera/housekeeper) se puede asignar a una
// tarea de housekeeping: no tiene sentido asignarle una habitación a un recepcionista
// o a mantenimiento. El backend guarda staffId = users.id.
const assignableStaff = computed(() => store.staff.filter(e => e.role === 'housekeeper'))

const newTask = ref({ roomNumber: '', type: '', priority: 'medium', staffId: '', notes: '' })

function getInitials(name: string) {
  return (name || '').split(' ').map(n => n[0]).join('').slice(0, 2)
}

function statusClass(status: string) {
  const classes: Record<string, string> = {
    pending: 'bg-warning/10 text-warning',
    in_progress: 'bg-cyan/10 text-cyan',
    completed: 'bg-teal/10 text-teal',
    inspected: 'bg-purple/10 text-purple',
  }
  return classes[status] || 'bg-surface text-text-muted'
}

/**
 * Mismo badge, pero sobre el header navy del modal. Los tonos al 10% de opacidad
 * que se usan sobre fondo blanco ahí quedan ilegibles: sobre oscuro el color va
 * sólido y el texto en navy, como el resto de los chips del sistema.
 */
function statusClassOnDark(status: string) {
  const classes: Record<string, string> = {
    pending: 'bg-warning text-navy',
    in_progress: 'bg-cyan text-navy',
    completed: 'bg-teal-light text-navy',
    inspected: 'bg-purple-light text-white',
  }
  return classes[status] || 'bg-white/20 text-white'
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    in_progress: 'En Progreso',
    completed: 'Completada',
    inspected: 'Inspeccionada',
  }
  return labels[status] || status
}

// Las tarjetas renderizan el label ya traducido (task.priority), pero alguna vista puede pasar el
// valor crudo del backend. Ambos vocabularios se mapean al mismo color para que no diverjan.
function priorityClass(priority: string) {
  const classes: Record<string, string> = {
    Baja: 'bg-surface text-text-muted', Normal: 'bg-surface text-text-muted', Alta: 'bg-coral/10 text-coral', Urgente: 'bg-danger/10 text-danger',
    low: 'bg-surface text-text-muted', medium: 'bg-surface text-text-muted', high: 'bg-coral/10 text-coral', urgent: 'bg-danger/10 text-danger',
  }
  return classes[priority] || 'bg-surface text-text-muted'
}

function priorityBadgeClass(priority: string) {
  const classes: Record<string, string> = {
    Baja: 'bg-surface text-text-muted', Normal: 'bg-surface text-text-muted', Alta: 'bg-coral/10 text-coral', Urgente: 'bg-danger text-white',
    low: 'bg-surface text-text-muted', medium: 'bg-surface text-text-muted', high: 'bg-coral/10 text-coral', urgent: 'bg-danger text-white',
  }
  return classes[priority] || 'bg-surface text-text-muted'
}

function staffColor(name: string) {
  const colors = ['bg-cyan', 'bg-teal', 'bg-navy', 'bg-purple', 'bg-coral', 'bg-gold']
  const idx = (name || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length
  return colors[idx]
}

function formatTime(iso: string) {
  try { return new Date(iso).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) } catch { return iso }
}

// C1 — Tiempo a mostrar: duración fija si ya terminó, o transcurrido en vivo si está in_progress.
// Lee `now` (ref del composable useNow) → el render se re-evalúa cada 60s sin recargar.
function taskTime(task: HousekeepingViewTask): string {
  if (task.time) return task.time
  if (task.status === 'in_progress' && task.startTime) {
    return humanizeMs(now.value - new Date(task.startTime).getTime())
  }
  return ''
}

function staffName(staffId: string) {
  if (staffId === 'unassigned') return 'Sin asignar'
  return store.staff.find(s => s.id === staffId)?.name || staffId
}

// Acción primaria según el estado (respeta la máquina de estados del backend).
function primaryAction(task: HousekeepingViewTask): { label: string; fn: () => Promise<void>; silent?: boolean } | null {
  switch (task.status) {
    // Sin asignar → guiar a asignar (abre el modal de edición, sin toast). Con asignar → iniciar (arranca el cronómetro).
    case 'pending': return task.staffId
      ? { label: '▶ Iniciar', fn: () => store.startTask(task.id) }
      : { label: 'Asignar', fn: async () => { openEditTask(task) }, silent: true }
    case 'in_progress': return { label: 'Finalizar', fn: () => store.completeTask(task.id) }
    // 'completed' → la aprobación va por la tarjeta "Calificar limpieza" (exige puntaje),
    // no por un botón genérico que dejaría la calificación en null.
    case 'completed': return null
    case 'inspected': return { label: 'Reabrir', fn: () => store.updateTask(task.id, { status: 'pending' }) }
    default: return null
  }
}

async function runPrimary(task: HousekeepingViewTask) {
  const action = primaryAction(task)
  if (!action) return
  try {
    await action.fn()
    // silent = true para acciones que solo abren un modal (ej. "Asignar") → no son persistentes, no se festejan.
    if (!action.silent) {
      toast.success('Acción realizada', action.label)
      syncSelectedTask(task.id)
    }
  } catch (e: any) { toast.error('No se pudo realizar la acción', e?.message) }
}

function syncSelectedTask(id: string) {
  const updated = store.tasks.find(t => t.id === id)
  if (updated && showViewModal.value) selectedTask.value = updated
}

function openViewTask(task: HousekeepingViewTask) {
  selectedTask.value = task
  showViewModal.value = true
  // Reset del formulario de calificación entre tareas.
  ratingInput.value = null
  ratingNote.value = ''
  loadVideo(task)
}

// Califica (1–10) y aprueba la limpieza desde el panel. El store marca la presencia
// y aprueba; la tarea pasa a 'inspected' con el puntaje y la nota.
async function approveSelected() {
  const task = selectedTask.value
  if (!task.id || ratingInput.value == null || approving.value) return
  approving.value = true
  try {
    await store.approveTask(task.id, ratingInput.value, ratingNote.value.trim() || undefined)
    toast.success('Limpieza calificada y aprobada')
    showViewModal.value = false
  } catch (e: any) {
    toast.error('No se pudo aprobar la limpieza', e?.message)
  } finally {
    approving.value = false
  }
}

// Pide la URL firmada para reproducir el video, solo si la tarea tiene uno.
async function loadVideo(task: HousekeepingViewTask) {
  videoUrl.value = null
  videoError.value = null
  videoDecodeFailed.value = false
  if (!task.video || !task.id) return
  videoLoading.value = true
  try {
    const res = await HousekeepingService.videoViewUrl(task.id)
    // Si mientras cargaba se abrió otra tarea, descartamos esta respuesta.
    if (selectedTask.value.id !== task.id) return
    videoUrl.value = res?.url ?? null
    if (!videoUrl.value) videoError.value = 'No se pudo obtener el video.'
  } catch {
    if (selectedTask.value.id === task.id) videoError.value = 'No se pudo cargar el video.'
  } finally {
    if (selectedTask.value.id === task.id) videoLoading.value = false
  }
}

// Etiqueta y color del puntaje 1–10 del supervisor.
function ratingLabel(r: number | null): string {
  if (r == null) return ''
  if (r >= 9) return '¡Excelente!'
  if (r >= 7) return 'Muy bien'
  if (r >= 5) return 'Buen trabajo'
  return 'A mejorar'
}

function ratingClass(r: number | null): string {
  if (r == null) return 'bg-surface text-text-muted'
  if (r >= 7) return 'bg-teal/10 text-teal'
  if (r >= 5) return 'bg-cyan/10 text-cyan'
  return 'bg-warning/10 text-warning'
}

function openNewTask() {
  editingId.value = null
  newTask.value = { roomNumber: '', type: '', priority: 'medium', staffId: '', notes: '' }
  showNewModal.value = true
}

function openEditTask(task: HousekeepingViewTask) {
  editingId.value = task.id
  newTask.value = {
    roomNumber: task.roomNumber === '—' ? '' : task.roomNumber,
    type: task.rawType || '',
    priority: task.priorityRaw || 'medium',
    staffId: task.staffId || '',
    notes: task.notes || '',
  }
  showNewModal.value = true
}

function openAssignModal() {
  assignStaff.value = ''
  assignSelection.value = []
  showAssignModal.value = true
}

async function saveTask() {
  if (!newTask.value.roomNumber || !newTask.value.type) {
    toast.error('Faltan datos', 'Habitación y tipo son obligatorios')
    return
  }
  const room = store.rooms.find(r => r.number === newTask.value.roomNumber)
  const roomId = room?.id || newTask.value.roomNumber
  const payload: Record<string, unknown> = {
    roomId,
    roomNumber: newTask.value.roomNumber,
    type: newTask.value.type,
    priority: newTask.value.priority || 'medium',
    notes: newTask.value.notes || '',
    staffId: newTask.value.staffId || '',
  }
  saving.value = true
  try {
    if (editingId.value) {
      await store.updateTask(editingId.value, payload)
      toast.success('Tarea actualizada', `Hab ${newTask.value.roomNumber}`)
    } else {
      payload.hotelId = hotelId.value
      payload.status = 'pending'
      await store.createTask(payload as any)
      toast.success('Tarea creada', `Hab ${newTask.value.roomNumber}`)
    }
    showNewModal.value = false
  } catch (e: any) {
    toast.error('No se pudo guardar la tarea', e?.message)
  } finally {
    saving.value = false
  }
}

async function assignSelected() {
  if (!assignStaff.value || assignSelection.value.length === 0) return
  try {
    await Promise.all(assignSelection.value.map(id => store.updateTask(id, { staffId: assignStaff.value })))
    toast.success('Tareas asignadas', `${assignSelection.value.length} tarea(s)`)
    showAssignModal.value = false
  } catch (e: any) { toast.error('No se pudieron asignar', e?.message) }
}

async function onPhotoSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    await store.uploadPhoto(selectedTask.value.id, file)
    syncSelectedTask(selectedTask.value.id)
    toast.success('Foto subida')
  } catch (err: any) { toast.error('No se pudo subir la foto', err?.message) }
  input.value = ''
}

async function onRemovePhoto(url: string) {
  try {
    await store.removePhoto(selectedTask.value.id, url)
    syncSelectedTask(selectedTask.value.id)
  } catch (e: any) { toast.error('No se pudo eliminar la foto', e?.message) }
}

/**
 * Exporta TODAS las tareas, no la página que se está viendo: un CSV que trae 20
 * de 126 filas sin decirlo es peor que no exportar. Recorre las páginas del
 * servidor y arma el archivo con el conjunto completo.
 */
async function exportCsv() {
  const all = await store.fetchAllForExport(
    activeFilter.value === 'all' ? undefined : activeFilter.value,
  )
  const headers = ['Habitación', 'Tipo', 'Piso', 'Estado', 'Prioridad', 'Asignado', 'Inicio', 'Fin', 'Duración', 'Notas', 'Fotos']
  const rows = all.map(t => [
    t.roomNumber,
    t.type,
    t.floor,
    statusLabel(t.status),
    t.priority,
    t.assignedTo,
    t.startTime || '',
    t.endTime || '',
    t.time || '',
    (t.notes || '').replace(/,/g, ';'),
    t.photos?.length || 0,
  ])
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `housekeeping-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success('CSV exportado')
}

function switchView(view: string) {
  activeView.value = view
  if (view === 'stats') refreshStats()
}

function changeStatsRange(days: number) {
  statsRangeDays.value = days
  refreshStats()
}

async function refreshStats() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - statsRangeDays.value)
  try { await store.loadStats(from.toISOString(), to.toISOString()) }
  catch (e: any) { toast.error('Error al cargar estadísticas', e?.message) }
}

// ─── Drag & Drop ──────────────────────────────────────────────────────────
function onDragStart(e: DragEvent, task: HousekeepingViewTask) {
  draggedTask.value = task
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
  }
}

async function onDrop(_e: DragEvent, newStatus: string) {
  dragOverColumn.value = null
  const task = draggedTask.value
  draggedTask.value = null
  if (!task || task.status === newStatus) return
  try {
    // La transición a in_progress ARRANCA EL CRONÓMETRO: debe ir por start (setea startTime
    // + valida staffId asignado), no por update. Las demás transiciones van por update.
    if (newStatus === 'in_progress') {
      await store.startTask(task.id)
    } else {
      await store.updateTask(task.id, { status: newStatus })
    }
  } catch (err: any) {
    toast.error('No se pudo mover la tarea', err?.message)
  }
}

onMounted(() => {
  store.load(hotelId.value)
  loadAreaNames()
})
</script>

<style scoped>
/* La animación de los modales vive en AppModal. */
</style>
