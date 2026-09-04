<template>
  <div>
    <!-- Header — A8: título+badge alineados al centro óptico de la fila de acciones -->
    <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
      <div class="flex items-center gap-2.5">
        <h2 class="text-xl font-black leading-none text-navy">Habitaciones</h2>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
          <span class="relative flex h-1.5 w-1.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
          </span>
          En vivo
        </span>
      </div>
      <div class="flex gap-2 items-center flex-wrap">
        <button @click="openNew" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Nueva
        </button>
        <button @click="openBatch" class="flex items-center gap-1.5 bg-surface border border-border text-navy font-bold text-sm px-5 py-2.5 rounded-full hover:shadow transition cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
          Crear en Lote
        </button>
      </div>
    </div>

    <!-- Stats — KpiHeroCard (mismo lenguaje visual que dashboard/guests) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <KpiHeroCard label="Total" :value="totalCount" icon="bed" accent="blue"
        unit="Habitaciones registradas" />
      <KpiHeroCard label="Disponibles" :value="availableCount" icon="checkin" accent="green"
        unit="Listas para vender" :progress="sharePct(availableCount)" />
      <KpiHeroCard label="Ocupadas" :value="occupiedCount" icon="users" accent="rose"
        unit="Con huésped en casa" :progress="sharePct(occupiedCount)" />
      <KpiHeroCard label="En limpieza" :value="cleaningCount" icon="checkout" accent="teal"
        unit="Housekeeping trabajando" />
      <KpiHeroCard label="Sucias" :value="dirtyCount" icon="bookings" accent="amber"
        unit="Esperan limpieza" />
      <KpiHeroCard label="Fuera de servicio" :value="outOfServiceCount" icon="building" accent="purple"
        unit="No vendibles" />
    </div>

    <!-- Listado de habitaciones -->
    <SectionCard title="Habitaciones" :subtitle="listSubtitle" body-class="p-0">
      <template #actions>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" v-html="ICON_SEARCH"></span>
          <input id="rooms-search" name="search" v-model="searchQuery" type="text" aria-label="Buscar habitaciones por número, tipo o piso" placeholder="Buscar habitación, tipo, piso..."
            class="w-full sm:w-64 pl-9 pr-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-cyan focus:bg-white/15 transition-colors" />
        </div>
        <select id="rooms-filter" name="activeFilter" aria-label="Filtrar habitaciones por estado" v-model="activeFilter"
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="all">Todas</option>
          <option class="text-navy" value="available">Disponibles</option>
          <option class="text-navy" value="occupied">Ocupadas</option>
          <option class="text-navy" value="cleaning">Limpieza</option>
          <option class="text-navy" value="dirty">Sucias</option>
          <option class="text-navy" value="out_of_service">Fuera de servicio</option>
        </select>
        <!-- A1: export del listado (misma promesa que reports; los datos ya están en memoria) -->
        <button @click="exportCsv" :disabled="!filteredRooms.length" title="Exportar listado a CSV"
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-bold text-white hover:border-cyan transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          Exportar CSV
        </button>
      </template>

      <!-- Carga inicial -->
      <div v-if="loading && !rooms.length" class="p-4 sm:p-5">
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
          <div v-for="i in 8" :key="i" class="rounded-2xl border border-border p-4">
            <div class="h-6 w-16 animate-pulse rounded bg-surface"></div>
            <div class="mt-3 h-4 w-24 animate-pulse rounded bg-surface"></div>
            <div class="mt-3 h-3 w-full animate-pulse rounded bg-surface"></div>
          </div>
        </div>
      </div>

      <!-- Sin resultados / sin datos -->
      <EmptyState
        v-else-if="!filteredRooms.length"
        :icon="ICON_BUILDING_EMPTY"
        :title="hasFilters ? 'Sin resultados' : 'Todavía no hay habitaciones'"
        :message="hasFilters
          ? 'Probá con otro término de búsqueda o quitá el filtro de estado.'
          : 'Creá la primera habitación, o cargá un piso entero con «Crear en Lote».'"
      >
        <template #action>
          <button v-if="hasFilters" @click="clearFilters"
            class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Limpiar filtros
          </button>
          <button v-else @click="openNew"
            class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy/90 transition-colors cursor-pointer">
            Nueva habitación
          </button>
        </template>
      </EmptyState>

      <div v-else class="p-4 sm:p-5">
        <!-- Leyenda de estados -->
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5">
          <div v-for="s in ROOM_STATUS_LEGEND" :key="s.status" class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="s.dot"></span>
            <span class="text-[12px] text-text-secondary">{{ s.label }}</span>
          </div>
        </div>

        <!-- Habitaciones agrupadas por tipo -->
        <div v-for="rt in paginatedRoomTypes" :key="rt.type" class="mb-6 last:mb-0">
          <div class="flex items-baseline gap-2 mb-2.5 flex-wrap">
            <h3 class="text-sm font-black text-navy">{{ rt.type }}</h3>
            <span class="text-xs text-text-muted">
              {{ rt.rooms.length }} habitaciones · {{ rt.available }} disponibles<template v-if="rt.occupied"> · {{ rt.occupied }} ocupadas</template><template v-if="rt.cleaning"> · {{ rt.cleaning }} limpieza</template>
            </span>
          </div>
          <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
            <div v-for="room in rt.rooms" :key="room.id" @click="openDetail(room)"
              class="rounded-2xl border border-border bg-white p-4 cursor-pointer transition-colors hover:border-navy/25 hover:bg-surface/40">
              <!-- El número es el ancla visual de la card -->
              <div class="flex items-start justify-between gap-2 mb-3">
                <span class="text-2xl font-black leading-none tabular-nums text-navy"
                  :class="{ 'line-through opacity-40': room.status === 'out_of_service' }">
                  {{ room.number }}
                </span>
                <span class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide"
                  :class="statusBadge(room.status)">
                  {{ statusLabel(room.status) }}
                </span>
              </div>
              <div class="flex items-baseline justify-between gap-2 mb-3">
                <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Por noche</span>
                <span class="text-sm font-black tabular-nums text-navy">${{ room.basePrice.toLocaleString() }}</span>
              </div>
              <div class="flex items-center gap-3 text-[11px] text-text-muted">
                <span class="flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>
                  <span class="tabular-nums">{{ room.maxGuests }}p</span>
                </span>
                <span class="flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>
                  <span class="tabular-nums">Piso {{ room.floor }}</span>
                </span>
                <span v-if="room.surfaceArea" class="tabular-nums">{{ room.surfaceArea }}m²</span>
              </div>
              <div v-if="(room.amenities||[]).length" class="mt-3 pt-3 border-t border-border text-[11px] text-text-muted truncate">
                {{ (room.amenities||[]).slice(0, 3).map(amenityLabel).join(' · ') }}<template v-if="room.amenities.length > 3"> +{{ room.amenities.length - 3 }}</template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Paginación -->
      <div v-if="totalPages > 1" class="flex items-center justify-between px-4 py-3 border-t border-border">
        <span class="text-[11px] font-bold text-text-muted tabular-nums">
          {{ (page - 1) * perPage + 1 }}–{{ Math.min(page * perPage, filteredRooms.length) }} de {{ filteredRooms.length }}
        </span>
        <div class="flex items-center gap-1">
          <button @click="page = 1" :disabled="page <= 1" title="Primera página"
            class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">«</button>
          <button @click="page--" :disabled="page <= 1" title="Página anterior"
            class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
          <span class="px-2 text-xs font-bold text-navy tabular-nums">{{ page }} / {{ totalPages }}</span>
          <button @click="page++" :disabled="page >= totalPages" title="Página siguiente"
            class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
          <button @click="page = totalPages" :disabled="page >= totalPages" title="Última página"
            class="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">»</button>
        </div>
      </div>
    </SectionCard>

    <!-- ====================== DETAIL MODAL ====================== -->
    <AppModal v-if="detailModal.show" size="lg" @close="detailModal.show=false">
      <template #header>
        <div class="flex items-baseline gap-3 min-w-0">
          <span class="text-2xl font-black leading-none tracking-tight text-white">{{ detailRoom?.number }}</span>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
            <span class="h-1.5 w-1.5 rounded-full" :class="statusDot(detailRoom?.status||'')"></span>
            {{ statusLabel(detailRoom?.status||'') }}
          </span>
        </div>
      </template>

      <div class="space-y-6">
            <!-- Room info: lista tipográfica, sin cajas -->
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5 pb-6 border-b border-border">
              <div>
                <div class="text-[11px] text-text-muted uppercase tracking-wide">Tipo</div>
                <div class="text-sm font-bold text-navy mt-1">{{ typeLabel(detailRoom?.type||'') }}</div>
              </div>
              <div>
                <div class="text-[11px] text-text-muted uppercase tracking-wide">Precio</div>
                <div class="text-sm font-bold text-navy mt-1">${{ detailRoom?.basePrice }} <span class="text-xs font-normal text-text-muted">/noche</span></div>
              </div>
              <div>
                <div class="text-[11px] text-text-muted uppercase tracking-wide">Piso</div>
                <div class="text-sm font-bold text-navy mt-1">{{ detailRoom?.floor }}</div>
              </div>
              <div>
                <div class="text-[11px] text-text-muted uppercase tracking-wide">Capacidad</div>
                <div class="text-sm font-bold text-navy mt-1">{{ detailRoom?.maxGuests }} pers.</div>
              </div>
              <div>
                <div class="text-[11px] text-text-muted uppercase tracking-wide">Baños</div>
                <div class="text-sm font-bold text-navy mt-1">{{ detailRoom?.bathrooms }}</div>
              </div>
              <div>
                <div class="text-[11px] text-text-muted uppercase tracking-wide">Superficie</div>
                <!-- Sin superficie cargada no se pinta un guión suelto. -->
                <div class="text-sm font-bold mt-1" :class="detailRoom?.surfaceArea ? 'text-navy' : 'text-text-muted'">
                  {{ detailRoom?.surfaceArea ? `${detailRoom.surfaceArea} m²` : 'Sin dato' }}
                </div>
              </div>
            </div>

            <!-- Guest info if occupied: acento de borde, sin caja rellena -->
            <div v-if="detailRoom?.status === 'occupied' && detailRoom?.guestName" class="border-l-2 border-coral pl-4">
              <div class="text-[11px] text-coral uppercase font-bold tracking-wide mb-1">Huésped en casa</div>
              <div class="text-sm font-bold text-navy">{{ detailRoom.guestName }}</div>
              <div v-if="detailRoom.guestEmail" class="text-xs text-text-muted mt-0.5">{{ detailRoom.guestEmail }}</div>
            </div>

            <!-- Amenities: pills en contorno -->
            <div>
              <div class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2.5">Incluye</div>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="a in (detailRoom?.amenities||[])" :key="a"
                  class="px-3 py-1 rounded-full border border-border text-xs text-text-secondary font-medium">
                  {{ amenityLabel(a) }}
                </span>
                <span v-if="!detailRoom?.amenities?.length" class="text-xs text-text-muted">Sin amenities configurados</span>
              </div>
            </div>

            <!-- Quick Status Change: fila de pills, sin descripciones -->
            <div>
              <div class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2.5">Cambiar estado</div>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in statusOptions" :key="opt.value"
                  @click="changeStatus(opt.value)"
                  :disabled="detailRoom?.status === opt.value || statusChanging"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  :class="detailRoom?.status === opt.value ? [statusHeaderBg(opt.value), statusBorder(opt.value), statusText(opt.value)] : 'border-border text-text-secondary hover:border-navy/30'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="statusDot(opt.value)"></span>
                  {{ opt.label }}
                </button>
              </div>
            </div>
      </div>

      <template #footer>
        <button @click="deleteRoomFromDetail"
          class="mr-auto px-4 py-2.5 text-sm font-bold text-coral hover:opacity-70 cursor-pointer transition-opacity">
          Eliminar
        </button>
        <button @click="detailModal.show=false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cerrar</button>
        <button @click="openEditFromDetail" class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
          Editar
        </button>
      </template>
    </AppModal>

    <!-- ====================== BATCH MODAL ====================== -->
    <AppModal v-if="batchModal.show" size="lg" title="Crear en lote"
      subtitle="Genera varias habitaciones del mismo tipo de una vez" @close="batchModal.show=false">
      <div class="space-y-6">
            <div>
              <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-3">Tipo de habitación</label>
              <div class="grid grid-cols-2 gap-2">
                <button v-for="opt in typeOptions" :key="opt.value"
                  @click="batchForm.type = opt.value"
                  class="p-3 rounded-xl border text-left transition-colors cursor-pointer"
                  :class="batchForm.type === opt.value
                    ? 'border-navy bg-navy/5'
                    : 'border-border hover:border-navy/30'">
                  <div class="flex items-center gap-2.5">
                    <span class="w-5 h-5 shrink-0" :class="batchForm.type === opt.value ? 'text-navy' : 'text-text-muted'" v-html="opt.icon"></span>
                    <div>
                      <div class="text-sm font-bold text-navy">{{ opt.label }}</div>
                      <div class="text-[11px] text-text-muted">{{ opt.desc }}</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div>
              <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-3">Rango de números</label>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="batch-from" class="block text-[11px] text-text-muted font-bold mb-1">Desde N° <span class="text-coral">*</span></label>
                  <input id="batch-from" name="batchFrom" required aria-required="true" v-model.number="batchForm.from" type="number" min="1" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-bold" placeholder="101" />
                </div>
                <div>
                  <label for="batch-to" class="block text-[11px] text-text-muted font-bold mb-1">Hasta N° <span class="text-coral">*</span></label>
                  <input id="batch-to" name="batchTo" required aria-required="true" v-model.number="batchForm.to" type="number" min="1" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm font-bold" placeholder="110" />
                </div>
              </div>
              <div v-if="batchCount > 0 && batchCount <= 100" class="mt-2.5 flex items-center gap-1.5 text-xs">
                <svg class="w-3.5 h-3.5 text-teal shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
                <span class="font-bold text-teal">{{ batchCount }} habitaciones</span>
                <span class="text-text-muted">{{ batchPreview }}</span>
              </div>
              <div v-else-if="batchCount > 100" class="mt-2.5 text-xs font-bold text-coral">Máximo 100 por lote</div>
            </div>

            <div>
              <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-3">Configuración</label>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div><label for="batch-base-price" class="block text-[11px] text-text-muted font-bold mb-1">Precio Base $ <span class="text-coral">*</span></label><input id="batch-base-price" name="batchBasePrice" required aria-required="true" v-model.number="batchForm.basePrice" type="number" min="0" class="w-full px-3 py-2 rounded-xl border border-border text-sm font-bold text-navy" /></div>
                <div><label for="batch-capacity" class="block text-[11px] text-text-muted font-bold mb-1">Capacidad</label><input id="batch-capacity" name="batchCapacity" v-model.number="batchForm.capacity" type="number" min="1" max="20" class="w-full px-3 py-2 rounded-xl border border-border text-sm" /></div>
                <div><label for="batch-floor" class="block text-[11px] text-text-muted font-bold mb-1">Piso</label><input id="batch-floor" name="batchFloor" v-model.number="batchForm.floor" type="number" min="0" class="w-full px-3 py-2 rounded-xl border border-border text-sm" /></div>
                <div><label for="batch-bathrooms" class="block text-[11px] text-text-muted font-bold mb-1">Baños</label><input id="batch-bathrooms" name="batchBathrooms" v-model.number="batchForm.bathrooms" type="number" min="0" class="w-full px-3 py-2 rounded-xl border border-border text-sm" /></div>
                <div><label for="batch-surface-area" class="block text-[11px] text-text-muted font-bold mb-1">Superficie m²</label><input id="batch-surface-area" name="batchSurfaceArea" v-model.number="batchForm.surfaceArea" type="number" min="0" placeholder="opcional" class="w-full px-3 py-2 rounded-xl border border-border text-sm" /></div>
                <label class="flex items-center gap-2 cursor-pointer self-end pb-2"><input id="batch-online-booking" name="batchOnlineBooking" v-model="batchForm.onlineBooking" type="checkbox" class="w-4 h-4 rounded text-cyan" /><span class="text-[11px] font-bold text-navy">Venta Online</span></label>
              </div>
            </div>

            <div>
              <div class="flex items-baseline justify-between mb-3">
                <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide">¿Qué incluye?</label>
                <span class="text-[11px] font-bold text-text-muted tabular-nums">{{ amenityCountLabel(batchForm.amenities.length) }}</span>
              </div>
              <div v-for="g in amenityGroups" :key="g.label" class="mb-3 last:mb-0">
                <div class="text-[10px] font-extrabold uppercase tracking-wide text-navy/60 mb-1.5">{{ g.label }}</div>
                <div class="flex flex-wrap gap-2">
                  <button v-for="a in g.items" :key="a.key" type="button"
                    @click="toggleAmenity(batchForm.amenities, a.key)"
                    class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors cursor-pointer"
                    :class="batchForm.amenities.includes(a.key) ? 'bg-navy border-navy text-white' : 'border-border text-text-secondary hover:border-navy/30'">
                    {{ a.label }}
                  </button>
                </div>
              </div>
            </div>
      </div>

      <template #footer>
        <button @click="batchModal.show=false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <button @click="executeBatch" :disabled="batchSaving || batchCount <= 0 || batchCount > 100"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          {{ batchSaving ? 'Creando…' : `Crear ${batchCount} habitaciones` }}
        </button>
      </template>
    </AppModal>

    <!-- ====================== EDIT MODAL ====================== -->
    <AppModal v-if="modal.show" size="lg" :title="`${modal.edit ? 'Editar' : 'Nueva'} habitación`" @close="modal.show=false">
      <div class="space-y-5">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label for="room-number" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Número <span class="text-coral">*</span></label>
                <input id="room-number" name="number" required aria-required="true" v-model="form.number" @blur="touched.number = true" type="text" placeholder="101"
                  :aria-invalid="showNumberError" class="w-full px-4 py-2.5 rounded-xl border text-sm" :class="showNumberError ? 'border-coral' : 'border-border'" />
                <p v-if="showNumberError" class="mt-1 text-[11px] font-bold text-coral">{{ numberError }}</p>
              </div>
              <div><label for="room-type" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Tipo</label>
                <select id="room-type" name="type" v-model="form.type" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer">
                  <option value="single">Individual</option><option value="double">Doble</option><option value="twin">Twin</option><option value="triple">Triple</option><option value="quad">Cuádruple</option><option value="suite">Suite</option><option value="deluxe">Deluxe</option><option value="presidential">Presidencial</option><option value="family">Familiar</option>
                </select>
              </div>
              <div><label for="room-status" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Estado</label>
                <select id="room-status" name="status" v-model="form.status" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer">
                  <option value="available">Disponible</option><option value="occupied">Ocupada</option><option value="cleaning">Limpieza</option><option value="dirty">Sucia</option><option value="out_of_service">F/S</option>
                </select>
              </div>
              <div><label for="room-floor" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Piso</label><input id="room-floor" name="floor" v-model.number="form.floor" type="number" min="0" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
              <div><label for="room-capacity" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Capacidad</label><input id="room-capacity" name="capacity" v-model.number="form.maxGuests" type="number" min="1" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
              <!-- Feature adultos+niños+edades (2026-09-02): opcional — vacío = sin configurar,
                   el motor de reservas cae a la Capacidad total de arriba. -->
              <div><label for="room-max-adults" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Máx. adultos <span class="normal-case font-normal text-text-muted">(opcional)</span></label><input id="room-max-adults" name="maxAdults" v-model.number="form.maxAdults" type="number" min="1" placeholder="sin configurar" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
              <div><label for="room-max-children" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Máx. niños <span class="normal-case font-normal text-text-muted">(opcional)</span></label><input id="room-max-children" name="maxChildren" v-model.number="form.maxChildren" type="number" min="0" placeholder="sin configurar" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
              <div>
                <label for="room-base-price" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Precio Base $ <span class="text-coral">*</span></label>
                <input id="room-base-price" name="basePrice" required aria-required="true" v-model.number="form.basePrice" @blur="touched.basePrice = true" type="number" min="0"
                  :aria-invalid="showPriceError" class="w-full px-4 py-2.5 rounded-xl border text-sm font-bold text-navy" :class="showPriceError ? 'border-coral' : 'border-border'" />
                <p v-if="showPriceError" class="mt-1 text-[11px] font-bold text-coral">{{ priceError }}</p>
              </div>
              <div><label for="room-surface-area" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Superficie m²</label><input id="room-surface-area" name="surfaceArea" v-model.number="form.surfaceArea" type="number" min="0" placeholder="opcional" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
              <div><label for="room-bathrooms" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Baños</label><input id="room-bathrooms" name="bathrooms" v-model.number="form.bathrooms" type="number" min="0" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
              <label class="flex items-center gap-2 cursor-pointer self-end pb-2"><input id="room-online-booking" name="onlineBooking" v-model="form.onlineBooking" type="checkbox" class="w-4 h-4 rounded text-cyan" /><span class="text-[11px] font-bold text-navy">Venta Online</span></label>
            </div>
            <div>
              <div class="flex items-baseline justify-between mb-2.5">
                <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide">Amenities</label>
                <span class="text-[11px] font-bold text-text-muted tabular-nums">{{ amenityCountLabel(form.amenities.length) }}</span>
              </div>
              <div v-for="g in amenityGroups" :key="g.label" class="mb-3 last:mb-0">
                <div class="text-[10px] font-extrabold uppercase tracking-wide text-navy/60 mb-1.5">{{ g.label }}</div>
                <div class="flex flex-wrap gap-2">
                  <button v-for="a in g.items" :key="a.key" type="button"
                    @click="toggleAmenity(form.amenities, a.key)"
                    class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors cursor-pointer"
                    :class="form.amenities.includes(a.key) ? 'bg-navy border-navy text-white' : 'border-border text-text-secondary hover:border-navy/30'">
                    {{ a.label }}
                  </button>
                </div>
              </div>
            </div>
      </div>

      <template #footer>
        <button @click="modal.show=false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <!-- Deshabilitado si el form es inválido; el click "atravesado" (pointer-events-none del
             disabled) revela los errores en rojo, para que el gris no sea un misterio. -->
        <span @click="!formValid && (touched = { number: true, basePrice: true })">
          <button @click="save" :disabled="saving || !formValid"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none">
            {{ saving ? 'Guardando…' : 'Guardar' }}
          </button>
        </span>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { useCountUp } from '@/composables/useCountUp'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { ApiError } from '@/services/http'
import type { Room } from '@/types'

interface MappedRoom {
  id: string
  number: string
  type: string
  floor: number
  status: string
  maxGuests: number
  maxAdults: number | null
  maxChildren: number | null
  basePrice: number
  amenities: string[]
  surfaceArea: number
  bathrooms: number
  onlineBooking: boolean
  guestName: string | null
  guestEmail: string | null
}

interface BatchForm {
  type: string
  from: number | null
  to: number | null
  basePrice: number
  capacity: number
  floor: number
  bathrooms: number
  /** A4: null = sin dato (antes default 0, que se leía como superficie cargada). */
  surfaceArea: number | null
  onlineBooking: boolean
  amenities: string[]
}

interface EditForm {
  number: string
  type: string
  floor: number
  maxGuests: number
  // Adultos/niños que planea el tipo (feature adultos+niños+edades, 2026-09-02). null = sin
  // configurar → cae a `maxGuests` completo en el motor de reservas.
  maxAdults: number | null
  maxChildren: number | null
  basePrice: number
  status: string
  amenities: string[]
  /** A4: null = sin dato (antes default 0, que se leía como superficie cargada). */
  surfaceArea: number | null
  bathrooms: number
  onlineBooking: boolean
}

const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: () => toast.error('Error al eliminar'),
})
const hid = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const activeFilter = ref('all')
const searchQuery = ref('')
const rooms = ref<MappedRoom[]>([])
const loading = ref(false)
const saving = ref(false)
const batchSaving = ref(false)
const statusChanging = ref(false)
const editId = ref('')
const page = ref(1)
const perPage = 60

const modal = ref({ show: false, edit: false })
const detailModal = ref({ show: false })
const batchModal = ref({ show: false })
const detailRoom = ref<MappedRoom | null>(null)

const form = ref<EditForm>({ number:'', type:'double', floor:1, maxGuests:2, maxAdults:null, maxChildren:null, basePrice:80, status:'available', amenities:[], surfaceArea:null, bathrooms:1, onlineBooking:true })
/** Campos "tocados" (blur o intento de submit): el error inline se muestra recién al tocar,
 *  para no pintar de rojo un form recién abierto (A4). */
const touched = ref({ number: false, basePrice: false })

const batchForm = ref<BatchForm>({
  type: 'double',
  from: null,
  to: null,
  basePrice: 80,
  capacity: 2,
  floor: 1,
  bathrooms: 1,
  surfaceArea: null,
  onlineBooking: true,
  amenities: [],
})

// ── Validación inline del modal (A4): error bajo el campo ANTES del submit ────────────
const numberError = computed<string | null>(() => {
  const n = (form.value.number || '').trim()
  if (!n) return 'El número es obligatorio'
  const dup = rooms.value.find(r => r.id !== editId.value && r.number.trim().toLowerCase() === n.toLowerCase())
  return dup ? `Ya existe la habitación ${dup.number}` : null
})

const priceError = computed<string | null>(() => {
  const raw: unknown = form.value.basePrice
  if (raw === '' || raw === null || typeof raw !== 'number' || Number.isNaN(raw)) return 'Ingresá un precio válido'
  if (raw < 0) return 'El precio no puede ser negativo'
  return null
})

const formValid = computed(() => !numberError.value && !priceError.value)
const showNumberError = computed(() => touched.value.number && !!numberError.value)
const showPriceError = computed(() => touched.value.basePrice && !!priceError.value)

const ICON_CROWN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m3 8 4 3 5-6 5 6 4-3-2 10H5L3 8Z"/></svg>'
const ICON_BED = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M5 13V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>'
const ICON_USERS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72M18 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M18 18.72v-.235a3 3 0 0 0-3-3M6 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M6 18.72v-.235a3 3 0 0 1 3-3m3.75-6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>'
const ICON_DOOR = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M5 21h10M5 21H3m14 0h2M13 12h.01"/></svg>'

const typeOptions = [
  { value: 'single', label: 'Individual', desc: '1 cama · 1 persona', icon: ICON_DOOR },
  { value: 'double', label: 'Doble', desc: '1 cama grande · 2 personas', icon: ICON_BED },
  { value: 'twin', label: 'Twin', desc: '2 camas · 2 personas', icon: ICON_BED },
  { value: 'triple', label: 'Triple', desc: '3 personas', icon: ICON_BED },
  { value: 'quad', label: 'Cuádruple', desc: '4 personas', icon: ICON_BED },
  { value: 'suite', label: 'Suite', desc: 'Sala + hab · 2-4 personas', icon: ICON_CROWN },
  { value: 'deluxe', label: 'Deluxe', desc: 'Vista premium · 2 personas', icon: ICON_CROWN },
  { value: 'presidential', label: 'Presidencial', desc: 'Máximo lujo · 4 personas', icon: ICON_CROWN },
  { value: 'family', label: 'Familiar', desc: '4+ personas · niños', icon: ICON_USERS },
]

const amenityOptions = [
  { key:'wifi', label:'WiFi' },{ key:'tv', label:'TV' },{ key:'ac', label:'Aire Acond.' },
  { key:'heating', label:'Calefacción' },{ key:'safe', label:'Caja Fuerte' },{ key:'minibar', label:'Minibar' },
  { key:'kitchen', label:'Cocina' },{ key:'fridge', label:'Nevera' },{ key:'microwave', label:'Microondas' },
  { key:'coffee_maker', label:'Cafetera' },{ key:'washer', label:'Lavadora' },{ key:'dishwasher', label:'Lavavajillas' },
  { key:'hair_dryer', label:'Secador' },{ key:'iron', label:'Plancha' },{ key:'balcony', label:'Balcón' },
  { key:'bathtub', label:'Bañera' },{ key:'work_desk', label:'Escritorio' },
]

// Amenities agrupadas por tipo (17 actuales): menos abrumador que una lista plana de 17 pills.
const AMENITY_GROUP_DEFS: { label: string; keys: string[] }[] = [
  { label: 'Confort', keys: ['wifi','tv','ac','heating','safe','minibar','hair_dryer','iron','balcony','bathtub'] },
  { label: 'Cocina', keys: ['kitchen','fridge','microwave','coffee_maker','washer','dishwasher'] },
  { label: 'Trabajo', keys: ['work_desk'] },
]
const amenityGroups = AMENITY_GROUP_DEFS.map(g => ({
  label: g.label,
  items: g.keys.map(k => amenityOptions.find(a => a.key === k)).filter((a): a is { key: string; label: string } => !!a),
}))
if (amenityGroups.reduce((n, g) => n + g.items.length, 0) !== amenityOptions.length) {
  throw new Error('rooms: AMENITY_GROUP_DEFS no cubre exactamente amenityOptions — clave nueva sin grupo')
}

function amenityCountLabel(n: number): string { return `${n} seleccionada${n === 1 ? '' : 's'}` }

const statusOptions = [
  { value: 'available', label: 'Disponible', desc: 'Lista para recibir huésped' },
  { value: 'occupied', label: 'Ocupada', desc: 'Huésped en check-in' },
  { value: 'cleaning', label: 'Limpieza', desc: 'Housekeeping limpiando' },
  { value: 'dirty', label: 'Sucia', desc: 'Post check-out, espera limpieza' },
  { value: 'out_of_service', label: 'F/S', desc: 'Fuera de servicio, no vendible' },
]

const TYPE_LABEL: Record<string,string> = {
  single:'Individual', double:'Doble', twin:'Twin', triple:'Triple', quad:'Cuádruple', suite:'Suite', deluxe:'Deluxe', presidential:'Presidencial', family:'Familiar',
}

function typeLabel(t: string): string { return TYPE_LABEL[t] || t.charAt(0).toUpperCase() + t.slice(1) }

function amenityLabel(key: string): string {
  const found = amenityOptions.find(a => a.key === key)
  return found ? found.label : key.replace(/_/g, ' ')
}

const batchCount = computed(() => {
  const f = batchForm.value.from
  const t = batchForm.value.to
  if (f == null || t == null || f <= 0 || t <= 0) return 0
  return t - f + 1
})

const batchPreview = computed(() => {
  const f = batchForm.value.from
  const t = batchForm.value.to
  if (f == null || t == null || f <= 0 || t <= 0) return ''
  const count = t - f + 1
  if (count <= 0) return ''
  if (count <= 5) return Array.from({ length: count }, (_, i) => String(f + i)).join(', ')
  return `${f}, ${f+1}, ${f+2} ... ${t-1}, ${t}`
})

const KPI_ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const KPI_ICON_USER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>'
const KPI_ICON_SPARKLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.035-.259a3.375 3.375 0 0 0 2.456-2.455L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"/></svg>'
const KPI_ICON_ALERT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z"/></svg>'
const KPI_ICON_XCIRCLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'

// Fuentes numéricas — separadas de `stats` para poder animarlas con useCountUp
// (el composable debe llamarse en el cuerpo de setup, no dentro del computed que arma las cards).
const totalCount = computed(() => rooms.value.length)
const availableCount = computed(() => rooms.value.filter(r => r.status === 'available').length)
const occupiedCount = computed(() => rooms.value.filter(r => r.status === 'occupied').length)
const cleaningCount = computed(() => rooms.value.filter(r => r.status === 'cleaning').length)
const dirtyCount = computed(() => rooms.value.filter(r => r.status === 'dirty').length)
const outOfServiceCount = computed(() => rooms.value.filter(r => r.status === 'out_of_service').length)

const totalAnim = useCountUp(totalCount)
const availableAnim = useCountUp(availableCount)
const occupiedAnim = useCountUp(occupiedCount)
const cleaningAnim = useCountUp(cleaningCount)
const dirtyAnim = useCountUp(dirtyCount)
const outOfServiceAnim = useCountUp(outOfServiceCount)

const stats = computed(() => [
  { label:'Total', value:totalAnim.value, color:'text-navy', bg:'bg-navy/10', icon: ICON_BED },
  { label:'Disp.', value:availableAnim.value, color:'text-teal', bg:'bg-teal/10', icon: KPI_ICON_CHECK },
  { label:'Ocup.', value:occupiedAnim.value, color:'text-coral', bg:'bg-coral/10', icon: KPI_ICON_USER },
  { label:'Limpieza', value:cleaningAnim.value, color:'text-cyan', bg:'bg-cyan/10', icon: KPI_ICON_SPARKLE },
  { label:'Sucias', value:dirtyAnim.value, color:'text-gold', bg:'bg-gold/10', icon: KPI_ICON_ALERT },
  { label:'F/S', value:outOfServiceAnim.value, color:'text-gray-400', bg:'bg-gray-100', icon: KPI_ICON_XCIRCLE },
])

const ROOM_STATUS_LEGEND = [
  { status: 'available', label: 'Disponible', dot: 'bg-teal' },
  { status: 'occupied', label: 'Ocupada', dot: 'bg-coral' },
  { status: 'cleaning', label: 'Limpieza', dot: 'bg-cyan' },
  { status: 'dirty', label: 'Sucia', dot: 'bg-gold' },
  { status: 'out_of_service', label: 'Fuera de servicio', dot: 'bg-gray-400' },
]

const totalRooms = ref(0)

// % que representa un subconjunto sobre el total — alimenta los anillos de los KPI.
function sharePct(n: number): number {
  return totalCount.value ? Math.round((n / totalCount.value) * 100) : 0
}

// Subtítulo del listado: aclara si lo mostrado está filtrado.
const listSubtitle = computed(() => hasFilters.value
  ? `${filteredRooms.value.length} de ${totalCount.value} habitación(es)`
  : `${totalCount.value} habitación(es)`)

const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"/></svg>'
const ICON_BUILDING_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>'

// ¿Hay algún filtro puesto? Distingue "no hay habitaciones" de "el filtro no encontró nada".
const hasFilters = computed(() => activeFilter.value !== 'all' || searchQuery.value.trim() !== '')

function clearFilters() {
  activeFilter.value = 'all'
  searchQuery.value = ''
}

const filteredRooms = computed(() => {
  let list = rooms.value
  if (activeFilter.value !== 'all') list = list.filter(r => r.status === activeFilter.value)
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(r =>
      [r.number, r.type, r.floor, r.status, ...(r.amenities || [])]
        .join(' ').toLowerCase().includes(q),
    )
  }
  return list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRooms.value.length / perPage)))

const paginatedRoomTypes = computed(() => {
  const start = (page.value - 1) * perPage
  const list = filteredRooms.value.slice(start, start + perPage)
  const g: Record<string, MappedRoom[]> = {}
  for (const r of list) { const t = r.type || 'double'; if (!g[t]) g[t] = []; g[t].push(r) }
  return Object.entries(g).map(([t, rs]) => ({
    type: (t.charAt(0).toUpperCase() + t.slice(1)).replace('Presidential', 'Presidencial'),
    available: rs.filter(r => r.status === 'available').length,
    occupied: rs.filter(r => r.status === 'occupied').length,
    cleaning: rs.filter(r => r.status === 'cleaning').length,
    rooms: rs,
  }))
})

watch([activeFilter, searchQuery], () => { page.value = 1 })

function statusDot(s: string) { const m: Record<string,string> = { available:'bg-teal', occupied:'bg-coral', cleaning:'bg-cyan', dirty:'bg-gold', out_of_service:'bg-gray-400' }; return m[s]||'bg-gray-300' }
function statusLabel(s: string) { const m: Record<string,string> = { available:'Disponible', occupied:'Ocupada', cleaning:'En Limpieza', dirty:'Sucia', out_of_service:'F/S' }; return m[s]||s }
function statusText(s: string) { const m: Record<string,string> = { available:'text-teal', occupied:'text-coral', cleaning:'text-cyan', dirty:'text-gold', out_of_service:'text-gray-400' }; return m[s]||'text-gray-400' }
function statusHeaderBg(s: string) { const m: Record<string,string> = { available:'bg-teal/5', occupied:'bg-coral/5', cleaning:'bg-cyan/5', dirty:'bg-gold/5', out_of_service:'bg-gray-50' }; return m[s]||'bg-surface' }
function statusBorder(s: string) { const m: Record<string,string> = { available:'border-teal/40', occupied:'border-coral/40', cleaning:'border-cyan/40', dirty:'border-gold/40', out_of_service:'border-gray-300' }; return m[s]||'border-border' }
// Badge de estado de la fila: fondo tonal + texto del mismo color (patrón del design system).
function statusBadge(s: string) { const m: Record<string,string> = { available:'bg-teal/10 text-teal', occupied:'bg-coral/10 text-coral', cleaning:'bg-cyan/10 text-cyan', dirty:'bg-gold/10 text-gold', out_of_service:'bg-surface text-text-muted' }; return m[s]||'bg-surface text-text-muted' }

// Toggle de amenities como "chips" (Batch y Edit comparten la misma lógica sobre arrays distintos)
function toggleAmenity(list: string[], key: string) {
  const i = list.indexOf(key)
  if (i >= 0) list.splice(i, 1)
  else list.push(key)
}

async function load() {
  loading.value = true
  try {
    const { RoomService } = await import('@/services/Room.service')
    const { AmenitiesService } = await import('@/services/Amenities.service')
    const { ReservationService } = await import('@/services/Reservation.service')
    const { GuestService } = await import('@/services/Guest.service')

    const [res, reservationsData, guestsData] = await Promise.all([
      RoomService.list({ hotelId: hid.value, limit: 100 }),
      ReservationService.list({ hotelId: hid.value, status: 'checked_in' }).catch(() => ({ reservations: [] })),
      GuestService.list({ hotelId: hid.value }).catch(() => ({ guests: [] })),
    ])

    const guestsMap = new Map<string, string>()
    for (const g of (guestsData as any).guests || []) {
      if (g.id) guestsMap.set(g.id, g.name || '')
    }

    const reservations = (reservationsData as any).reservations || []
    const roomGuestMap = new Map<string, { guestName: string; guestEmail: string }>()
    for (const r of reservations) {
      if (r.roomId && r.status === 'checked_in') {
        const guestName = r.guestName || (r.guestId ? guestsMap.get(r.guestId) : '') || ''
        const guestEmail = r.guestEmail || ''
        roomGuestMap.set(r.roomId, { guestName, guestEmail })
      }
    }

    const mapped: MappedRoom[] = (res.rooms || []).map((r: Room) => ({
      id: r.id, number: r.number, type: r.type, floor: r.floor || 1, status: r.status || 'available',
      maxGuests: r.maxGuests || 2, maxAdults: r.maxAdults ?? null, maxChildren: r.maxChildren ?? null, basePrice: r.basePrice || 0,
      amenities: [] as string[], surfaceArea: r.surfaceArea || 0, bathrooms: r.bathrooms || 1,
      onlineBooking: r.onlineBookingEnabled !== false,
      guestName: roomGuestMap.get(r.id)?.guestName || null,
      guestEmail: roomGuestMap.get(r.id)?.guestEmail || null,
    }))
    await Promise.all(mapped.map(async (r: MappedRoom) => {
      try { const am = await AmenitiesService.listRoom(r.id); r.amenities = (am.data || []).map((a: { amenityKey: string }) => a.amenityKey) } catch {}
    }))
    rooms.value = mapped
    totalRooms.value = res.total
  } catch {
    toast.error('Error al cargar habitaciones')
  }
  loading.value = false
}

function openDetail(room: MappedRoom) {
  detailRoom.value = room
  detailModal.value.show = true
}

function openEditFromDetail() {
  const room = detailRoom.value
  if (!room) return
  detailModal.value.show = false
  editId.value = room.id; modal.value = { show: true, edit: true }
  const amenities = [...(room.amenities || [])]
  form.value = { number: room.number, type: room.type, floor: room.floor || 1, maxGuests: room.maxGuests || 2, maxAdults: room.maxAdults ?? null, maxChildren: room.maxChildren ?? null, basePrice: room.basePrice || 0, status: room.status || 'available', amenities, surfaceArea: room.surfaceArea || null, bathrooms: room.bathrooms || 1, onlineBooking: room.onlineBooking !== false }
  touched.value = { number: false, basePrice: false }
}

function openNew() {
  editId.value = ''; modal.value = { show: true, edit: false }
  form.value = { number: '', type: 'double', floor: 1, maxGuests: 2, maxAdults: null, maxChildren: null, basePrice: 80, status: 'available', amenities: [], surfaceArea: null, bathrooms: 1, onlineBooking: true }
  touched.value = { number: false, basePrice: false }
}

async function changeStatus(newStatus: string) {
  const room = detailRoom.value
  if (!room || room.status === newStatus) return
  statusChanging.value = true
  try {
    const { RoomService } = await import('@/services/Room.service')
    await RoomService.update(room.id, { status: newStatus } as Record<string, unknown>)
    room.status = newStatus
    const idx = rooms.value.findIndex(r => r.id === room.id)
    if (idx >= 0) rooms.value[idx].status = newStatus
    toast.success(`Hab ${room.number} → ${statusLabel(newStatus)}`)
  } catch (e) {
    const msg = e instanceof ApiError ? `Error (${e.status})` : 'Sin conexión'
    toast.error(msg)
  }
  statusChanging.value = false
}

async function save() {
  // El botón ya está deshabilitado si el form es inválido; esto es defensa si se llama por otra vía.
  if (!formValid.value) { touched.value = { number: true, basePrice: true }; return }
  saving.value = true
  try {
    const { RoomService } = await import('@/services/Room.service')
    const { AmenitiesService } = await import('@/services/Amenities.service')
    // Superficie vacía → 0 en la API ("sin dato"; el modelo no acepta null).
    const patch: Record<string, unknown> = { number: form.value.number, type: form.value.type, floor: form.value.floor, maxGuests: form.value.maxGuests, maxAdults: form.value.maxAdults, maxChildren: form.value.maxChildren, basePrice: form.value.basePrice, status: form.value.status, surfaceArea: Number(form.value.surfaceArea || 0), bathrooms: form.value.bathrooms, onlineBookingEnabled: form.value.onlineBooking }
    let roomId = editId.value
    if (roomId) { await RoomService.update(roomId, patch) }
    else { const created = await RoomService.create({ ...patch, hotelId: hid.value! }); roomId = created.id }
    await AmenitiesService.saveRoom(roomId, form.value.amenities)
    toast.success(editId.value ? `Habitación ${form.value.number} actualizada` : `Habitación ${form.value.number} creada`)
  } catch (e) {
    const msg = e instanceof ApiError ? `Error (${e.status})` : 'Sin conexión'
    toast.error(msg)
  }
  saving.value = false; modal.value.show = false; await load()
}

// A1: export del listado visible (respeta búsqueda y filtro activos). CSV con BOM para que
// Excel respete los acentos; separador de amenities ';' para no pelear con la coma decimal.
function exportCsv() {
  const rows = filteredRooms.value
  if (!rows.length) return
  const esc = (v: string) => /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const lines = [['Número','Tipo','Estado','Piso','Capacidad','Precio','Amenities'].join(',')]
  for (const r of rows) {
    const cells = [r.number, typeLabel(r.type), statusLabel(r.status), String(r.floor), String(r.maxGuests), String(r.basePrice), (r.amenities || []).map(amenityLabel).join('; ')]
    lines.push(cells.map(esc).join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `habitaciones-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  toast.success(`CSV exportado (${rows.length} habitaciones)`)
}

function deleteRoomFromDetail() {
  const room = detailRoom.value
  if (!room) return
  askConfirm({
    title: 'Eliminar habitación',
    message: `¿Eliminar habitación ${room.number}? No se puede deshacer.`,
    confirmLabel: 'Eliminar', danger: true,
    run: async () => {
      const { RoomService } = await import('@/services/Room.service')
      await RoomService.delete(room.id)
      detailModal.value.show = false
      await load()
      // A10: el éxito dice QUÉ habitación se borró (el listado ya se recargó sin ella).
      toast.success(`Habitación ${room.number} eliminada`)
    },
  })
}

function openBatch() {
  batchForm.value = { type: 'double', from: null, to: null, basePrice: 80, capacity: 2, floor: 1, bathrooms: 1, surfaceArea: null, onlineBooking: true, amenities: [] }
  batchModal.value.show = true
}

async function executeBatch() {
  const f = batchForm.value.from
  const t = batchForm.value.to
  if (f == null || t == null || f <= 0 || t <= 0) { toast.error('Ingresá rango válido'); return }
  if (f > t) { toast.error('Desde debe ser menor o igual a Hasta'); return }
  if (t - f + 1 > 100) { toast.error('Máximo 100 por lote'); return }
  if (!hid.value) { toast.error('Sin hotel asignado'); return }

  batchSaving.value = true
  try {
    const { RoomService } = await import('@/services/Room.service')
    const { AmenitiesService } = await import('@/services/Amenities.service')
    const result = await RoomService.batchCreate({
      hotelId: hid.value,
      type: batchForm.value.type,
      basePrice: batchForm.value.basePrice,
      from: f,
      to: t,
      floor: batchForm.value.floor,
      capacity: batchForm.value.capacity,
      bathrooms: batchForm.value.bathrooms,
      surfaceArea: Number(batchForm.value.surfaceArea || 0),
      onlineBookingEnabled: batchForm.value.onlineBooking,
    })

    const created = result.data
    if (batchForm.value.amenities.length > 0 && created.length > 0) {
      await Promise.all(created.map((r: { id: string }) => AmenitiesService.saveRoom(r.id, batchForm.value.amenities)))
    }

    toast.success(`Creadas ${created.length} habitaciones`, `${batchForm.value.type}`)
    batchModal.value.show = false
    await load()
  } catch (e) {
    const msg = e instanceof ApiError ? e.message || `Error (${e.status})` : 'Sin conexión'
    toast.error('Error al crear lote', msg)
  }
  batchSaving.value = false
}

// Auto-refresh cada 30 segundos
const AUTO_REFRESH_MS = 30_000
let refreshInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  load()
  refreshInterval = setInterval(() => {
    if (!loading.value) load()
  }, AUTO_REFRESH_MS)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})
</script>

<style scoped>
/* Las transiciones de entrada/salida ahora las aporta AppModal. */
</style>
