<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-black text-navy">Gestión de Hoteles</h1>
        <p class="text-sm text-text-muted">{{ filteredHotels.length }} hoteles encontrados</p>
      </div>
      <div class="flex gap-2">
        <button @click="viewMode = 'table'" class="w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer" :class="viewMode === 'table' ? 'bg-navy text-white' : 'bg-white border border-border text-text-muted hover:border-navy/30'">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
        </button>
        <button @click="viewMode = 'grid'" class="w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer" :class="viewMode === 'grid' ? 'bg-navy text-white' : 'bg-white border border-border text-text-muted hover:border-navy/30'">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/></svg>
        </button>
        <button @click="openNewHotel" class="bg-coral text-white font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer">+ Nuevo Hotel</button>
      </div>
    </div>

    <!-- Métricas -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
      <div v-for="stat in stats" :key="stat.label" class="bg-white rounded-xl p-4 border border-border text-center card-shadow">
        <div class="text-xl font-black" :class="stat.color">{{ stat.value }}</div>
        <div class="text-[10px] text-text-muted font-bold uppercase">{{ stat.label }}</div>
      </div>
    </div>

    <!-- Filtros Avanzados -->
    <div class="bg-white rounded-2xl border border-border card-shadow p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold text-text-muted uppercase">Filtros</span>
          <span v-if="activeFiltersCount > 0" class="bg-cyan/20 text-cyan text-[10px] font-bold px-2 py-0.5 rounded-full">{{ activeFiltersCount }} activos</span>
        </div>
        <button v-if="activeFiltersCount > 0" @click="clearAllFilters" class="text-[10px] font-bold text-danger hover:text-danger/80 transition-colors cursor-pointer">Limpiar filtros</button>
      </div>

      <!-- Fila 1: Búsqueda + Estado + Plan -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <div class="relative">
          <input v-model="searchQuery" type="text" placeholder="Buscar por nombre, email, ubicación..." class="w-full h-10 pl-9 pr-4 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
        <select v-model="activeFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los estados</option>
          <option value="Activo">Activo</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Suspendido">Suspendido</option>
        </select>
        <select v-model="planFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todos los planes</option>
          <option value="Enterprise">Enterprise</option>
          <option value="Professional">Professional</option>
          <option value="Starter">Starter</option>
        </select>
        <select v-model="locationFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Todas las ubicaciones</option>
          <option v-for="loc in locations" :key="loc" :value="loc">{{ loc }}</option>
        </select>
      </div>

      <!-- Fila 2: Ocupación + MRR + Ordenamiento -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <select v-model="occupancyFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Cualquier ocupación</option>
          <option value="high">Alta (>80%)</option>
          <option value="medium">Media (50-80%)</option>
          <option value="low">Baja (<50%)</option>
        </select>
        <select v-model="mrrFilter" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="all">Cualquier MRR</option>
          <option value="high">$100+</option>
          <option value="medium">$50-$99</option>
          <option value="low">$49</option>
        </select>
        <select v-model="sortBy" class="h-10 px-4 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
          <option value="name-asc">Nombre (A-Z)</option>
          <option value="name-desc">Nombre (Z-A)</option>
          <option value="mrr-desc">MRR (Mayor)</option>
          <option value="mrr-asc">MRR (Menor)</option>
          <option value="rooms-desc">Habitaciones (Mayor)</option>
          <option value="occupancy-desc">Ocupación (Mayor)</option>
          <option value="registered-desc">Más recientes</option>
        </select>
        <div class="flex gap-2">
          <button @click="exportHotels" class="flex-1 h-10 px-4 bg-surface border border-border rounded-xl text-sm font-bold text-text-secondary hover:bg-surface-dark transition-colors cursor-pointer flex items-center justify-center gap-2">
            <span>📥</span> Exportar
          </button>
        </div>
      </div>
    </div>

    <!-- Skeleton de carga -->
    <SkeletonLoader v-if="loading" variant="table" :rows="6" />

    <!-- Vista Tabla -->
    <SectionCard v-else-if="viewMode === 'table'" title="Hoteles" body-class="p-0">
      <div class="overflow-x-auto">
      <table class="w-full tbl-head">
        <thead>
          <tr class="border-b border-border">
            <th @click="toggleSort('name')" class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy">
              <div class="flex items-center gap-1">Hotel <span v-if="sortBy.startsWith('name')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th @click="toggleSort('location')" class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy">
              <div class="flex items-center gap-1">Ubicación <span v-if="sortBy.startsWith('location')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th @click="toggleSort('plan')" class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy">Plan</th>
            <th @click="toggleSort('rooms')" class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy">
              <div class="flex items-center gap-1">Hab. <span v-if="sortBy.startsWith('rooms')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th @click="toggleSort('occupancy')" class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy">
              <div class="flex items-center gap-1">Ocupación <span v-if="sortBy.startsWith('occupancy')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th @click="toggleSort('mrr')" class="text-left p-4 text-[10px] font-bold text-text-muted uppercase cursor-pointer hover:text-navy">
              <div class="flex items-center gap-1">MRR <span v-if="sortBy.startsWith('mrr')" class="text-cyan">{{ sortBy.endsWith('asc') ? '↑' : '↓' }}</span></div>
            </th>
            <th class="text-left p-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
            <th class="text-right p-4 text-[10px] font-bold text-text-muted uppercase">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="hotel in paginatedHotels" :key="hotel.id" class="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
            <td class="p-4">
              <div class="flex items-center gap-3 cursor-pointer" @click="openViewHotel(hotel)">
                <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-navy to-cyan flex items-center justify-center text-white text-sm font-bold">{{ hotel.name[0] }}</div>
                <div>
                  <div class="text-sm font-bold text-navy">{{ hotel.name }}</div>
                  <div class="text-[10px] text-text-muted">{{ hotel.email }}</div>
                </div>
              </div>
            </td>
            <td class="p-4 text-sm">{{ hotel.location }}</td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="planClass(hotel.plan)">{{ hotel.plan }}</span></td>
            <td class="p-4 text-sm font-bold">{{ hotel.rooms }}</td>
            <td class="p-4">
              <div class="flex items-center gap-2">
                <div class="w-16 h-2 bg-surface rounded-full"><div class="h-2 rounded-full" :class="hotel.occupancy > 80 ? 'bg-teal' : hotel.occupancy > 50 ? 'bg-orange' : 'bg-red'" :style="{ width: `${hotel.occupancy}%` }"></div></div>
                <span class="text-[10px] font-bold">{{ hotel.occupancy }}%</span>
              </div>
            </td>
            <td class="p-4 text-sm font-black text-navy">${{ hotel.mrr }}</td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="statusClass(hotel.status)">{{ hotel.status }}</span></td>
            <td class="p-4 text-right">
              <div class="flex gap-1 justify-end">
                <button
                  @click="loginAsHotel(hotel)"
                  :disabled="!hotel.ownerUserId || enteringId === hotel.id"
                  :title="hotel.ownerUserId ? `Entrar como ${hotel.ownerName} (${roleLabel(hotel.ownerRole)})` : 'Este hotel no tiene ningún usuario activo al que entrar'"
                  class="px-2 py-1 bg-blue text-white rounded-lg text-[10px] font-bold hover:bg-blue/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >{{ enteringId === hotel.id ? 'Entrando…' : 'Entrar' }}</button>
                <button @click="openViewHotel(hotel)" class="px-2 py-1 bg-cyan/10 text-cyan rounded-lg text-[10px] font-bold hover:bg-cyan/20 transition-colors cursor-pointer">Ver</button>
                <button @click="openEditHotel(hotel)" class="px-2 py-1 bg-navy/10 text-navy rounded-lg text-[10px] font-bold hover:bg-navy/20 transition-colors cursor-pointer">Editar</button>
                <button @click="openModulesModal(hotel)" class="px-2 py-1 bg-teal/10 text-teal rounded-lg text-[10px] font-bold hover:bg-teal/20 transition-colors cursor-pointer">Módulos</button>
                <button @click="openSuspendModal(hotel)" class="px-2 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer" :class="hotel.status === 'Suspendido' ? 'bg-teal/10 text-teal hover:bg-teal/20' : 'bg-red/10 text-red hover:bg-red/20'">{{ hotel.status === 'Suspendido' ? 'Reactivar' : 'Suspender' }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <!-- Paginación del listado (client-side, mismo patrón que /panel/guests) -->
      <div v-if="totalFiltered > PAGE_SIZE" class="flex items-center justify-between px-4 py-3 border-t border-border">
        <span class="text-[11px] text-text-muted font-bold">
          {{ (currentPage - 1) * PAGE_SIZE + 1 }}–{{ Math.min(currentPage * PAGE_SIZE, totalFiltered) }} de {{ totalFiltered }}
        </span>
        <div class="flex items-center gap-1">
          <button @click="goToPage(1)" :disabled="currentPage <= 1" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">«</button>
          <button @click="goToPage(currentPage - 1)" :disabled="currentPage <= 1" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
          <span class="px-2 text-xs font-bold text-navy">{{ currentPage }} / {{ totalPages }}</span>
          <button @click="goToPage(currentPage + 1)" :disabled="currentPage >= totalPages" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
          <button @click="goToPage(totalPages)" :disabled="currentPage >= totalPages" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">»</button>
        </div>
      </div>
      <div v-if="filteredHotels.length === 0" class="p-12 text-center">
        <div class="text-4xl mb-3">🏨</div>
        <div class="text-sm font-bold text-text-muted">No se encontraron hoteles</div>
        <div class="text-[10px] text-text-muted">Intenta ajustar los filtros</div>
      </div>
    </SectionCard>

    <!-- Vista Grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="hotel in paginatedHotels" :key="hotel.id" class="bg-white rounded-2xl border border-border card-shadow p-5 hover:shadow-lg transition-all">
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-navy to-cyan flex items-center justify-center text-white text-lg font-black">{{ hotel.name[0] }}</div>
            <div>
              <div class="text-sm font-bold text-navy">{{ hotel.name }}</div>
              <div class="text-[10px] text-text-muted">{{ hotel.location }}</div>
            </div>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="statusClass(hotel.status)">{{ hotel.status }}</span>
        </div>
        <div class="grid grid-cols-3 gap-3 mb-4">
          <div class="text-center"><div class="text-lg font-black text-navy">{{ hotel.rooms }}</div><div class="text-[9px] text-text-muted uppercase">Hab.</div></div>
          <div class="text-center"><div class="text-lg font-black" :class="hotel.occupancy > 80 ? 'text-teal' : hotel.occupancy > 50 ? 'text-orange' : 'text-red'">{{ hotel.occupancy }}%</div><div class="text-[9px] text-text-muted uppercase">Ocup.</div></div>
          <div class="text-center"><div class="text-lg font-black text-navy">${{ hotel.mrr }}</div><div class="text-[9px] text-text-muted uppercase">MRR</div></div>
        </div>
        <div class="flex items-center justify-between mb-4">
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="planClass(hotel.plan)">{{ hotel.plan }}</span>
          <span class="text-[10px] text-text-muted">{{ hotel.users }} usuarios</span>
        </div>
        <button
          @click="loginAsHotel(hotel)"
          :disabled="!hotel.ownerUserId || enteringId === hotel.id"
          :title="hotel.ownerUserId ? `Entrar como ${hotel.ownerName} (${roleLabel(hotel.ownerRole)})` : 'Este hotel no tiene ningún usuario activo al que entrar'"
          class="w-full py-2 mb-2 bg-blue text-white rounded-lg text-[10px] font-bold hover:bg-blue/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >{{ enteringId === hotel.id ? 'Entrando…' : `Entrar${hotel.ownerName ? ` como ${hotel.ownerName}` : ''}` }}</button>
        <div class="flex gap-2">
          <button @click="openViewHotel(hotel)" class="flex-1 py-2 bg-surface rounded-lg text-[10px] font-bold text-text-secondary hover:bg-surface-dark transition-colors cursor-pointer">Ver</button>
          <button @click="openEditHotel(hotel)" class="flex-1 py-2 bg-navy/10 rounded-lg text-[10px] font-bold text-navy hover:bg-navy/20 transition-colors cursor-pointer">Editar</button>
          <button @click="openModulesModal(hotel)" class="flex-1 py-2 bg-teal/10 rounded-lg text-[10px] font-bold text-teal hover:bg-teal/20 transition-colors cursor-pointer">Módulos</button>
          <button @click="openSuspendModal(hotel)" class="py-2 px-3 rounded-lg text-[10px] font-bold transition-colors cursor-pointer" :class="hotel.status === 'Suspendido' ? 'bg-teal/10 text-teal hover:bg-teal/20' : 'bg-red/10 text-red hover:bg-red/20'">
            {{ hotel.status === 'Suspendido' ? '↑' : '↓' }}
          </button>
        </div>
      </div>
      <div v-if="filteredHotels.length === 0" class="col-span-3 p-12 text-center">
        <div class="text-4xl mb-3">🏨</div>
        <div class="text-sm font-bold text-text-muted">No se encontraron hoteles</div>
        <div class="text-[10px] text-text-muted">Intenta ajustar los filtros</div>
      </div>
      <!-- Misma paginación que la tabla: las dos vistas recorren el mismo listado. -->
      <div v-if="totalFiltered > PAGE_SIZE" class="col-span-full flex items-center justify-between bg-white rounded-2xl border border-border card-shadow px-4 py-3">
        <span class="text-[11px] text-text-muted font-bold">
          {{ (currentPage - 1) * PAGE_SIZE + 1 }}–{{ Math.min(currentPage * PAGE_SIZE, totalFiltered) }} de {{ totalFiltered }}
        </span>
        <div class="flex items-center gap-1">
          <button @click="goToPage(1)" :disabled="currentPage <= 1" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">«</button>
          <button @click="goToPage(currentPage - 1)" :disabled="currentPage <= 1" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
          <span class="px-2 text-xs font-bold text-navy">{{ currentPage }} / {{ totalPages }}</span>
          <button @click="goToPage(currentPage + 1)" :disabled="currentPage >= totalPages" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
          <button @click="goToPage(totalPages)" :disabled="currentPage >= totalPages" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">»</button>
        </div>
      </div>
    </div>

    <!-- Modal: Ver Hotel -->
    <AppModal v-if="showViewModal" size="lg" title="Detalle del Hotel" @close="showViewModal = false">
      <div class="flex items-center gap-4 mb-6">
            <div class="w-16 h-16 rounded-xl bg-gradient-to-br from-navy to-cyan flex items-center justify-center text-white text-2xl font-black">{{ selectedHotel.name[0] }}</div>
            <div>
              <div class="flex items-center gap-3">
                <h2 class="text-xl font-black text-navy">{{ selectedHotel.name }}</h2>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="statusClass(selectedHotel.status)">{{ selectedHotel.status }}</span>
              </div>
              <div class="text-sm text-text-muted">{{ selectedHotel.location }} — {{ selectedHotel.email }}</div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-4 mb-6">
            <div class="bg-surface rounded-xl p-4 text-center"><div class="text-2xl font-black text-navy">{{ selectedHotel.rooms }}</div><div class="text-[10px] text-text-muted uppercase">Habitaciones</div></div>
            <div class="bg-surface rounded-xl p-4 text-center"><div class="text-2xl font-black text-teal">{{ selectedHotel.occupancy }}%</div><div class="text-[10px] text-text-muted uppercase">Ocupación</div></div>
            <div class="bg-surface rounded-xl p-4 text-center"><div class="text-2xl font-black text-navy">${{ selectedHotel.mrr }}</div><div class="text-[10px] text-text-muted uppercase">MRR</div></div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Plan Actual</div><span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="planClass(selectedHotel.plan)">{{ selectedHotel.plan }}</span></div>
            <div><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Usuarios</div><div class="text-sm font-bold">{{ selectedHotel.users }}</div></div>
            <div><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Teléfono</div><div class="text-sm">{{ selectedHotel.phone }}</div></div>
            <div><div class="text-[10px] font-bold text-text-muted uppercase mb-1">Registro</div><div class="text-sm">{{ selectedHotel.registered }}</div></div>
          </div>
      <template #footer>
        <button @click="showViewModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cerrar</button>
        <button @click="showViewModal = false; openEditHotel(selectedHotel)" class="px-4 py-2.5 bg-navy text-white rounded-xl text-sm font-extrabold hover:shadow-lg transition-colors cursor-pointer">Editar Hotel</button>
      </template>
    </AppModal>

    <!-- Modal: Nuevo/Editar Hotel -->
    <AppModal v-if="showEditModal" size="md"
      :title="editingHotel.id ? 'Editar Hotel' : 'Registrar Nuevo Hotel'"
      @close="showEditModal = false">
      <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2"><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Nombre del Hotel *</label><input v-model="editingHotel.name" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Email *</label><input v-model="editingHotel.email" type="email" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Teléfono</label><input v-model="editingHotel.phone" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Ubicación *</label><input v-model="editingHotel.location" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Habitaciones</label><input v-model.number="editingHotel.rooms" type="number" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Plan *</label>
              <select v-model="editingHotel.plan" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option v-for="p in plansList" :key="p.id" :value="cap(p.slug)">{{ p.name }} — ${{ p.price }}/mes</option>
              </select>
            </div>
            <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Estado</label>
              <select v-model="editingHotel.status" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
                <option value="Activo">Activo</option>
                <option value="Pendiente">Pendiente</option>
                <option value="Suspendido">Suspendido</option>
              </select>
            </div>
          </div>
      <template #footer>
        <button @click="showEditModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveHotel" class="px-4 py-2.5 bg-navy text-white rounded-xl text-sm font-extrabold hover:shadow-lg transition-colors cursor-pointer">{{ editingHotel.id ? 'Guardar Cambios' : 'Registrar Hotel' }}</button>
      </template>
    </AppModal>

    <!-- Modal: Suspender -->
    <AppModal v-if="showSuspendModal" size="md"
      :title="`${selectedHotel.status === 'Suspendido' ? 'Reactivar' : 'Suspender'} Hotel`"
      @close="showSuspendModal = false">
      <div class="text-sm font-bold text-navy mb-2">{{ selectedHotel.name }}</div>
      <div class="text-[10px] text-text-muted mb-4">{{ selectedHotel.location }}</div>
      <div v-if="selectedHotel.status !== 'Suspendido'">
        <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Motivo de Suspensión *</label>
        <textarea v-model="suspendReason" rows="3" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy resize-none" placeholder="Ej: Pago no recibido..."></textarea>
      </div>
      <template #footer>
        <button @click="showSuspendModal = false" class="px-4 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cancelar</button>
        <button @click="toggleSuspend" class="px-4 py-2.5 rounded-xl text-sm font-extrabold hover:shadow-lg transition-colors cursor-pointer" :class="selectedHotel.status === 'Suspendido' ? 'bg-teal text-white' : 'bg-red text-white'">
          {{ selectedHotel.status === 'Suspendido' ? 'Reactivar' : 'Suspender' }}
        </button>
      </template>
    </AppModal>

    <!-- Modal: Módulos del hotel (excepciones/bonos) #568 -->
    <AppModal v-if="showModulesModal" size="lg"
      :title="`Módulos: ${modulesHotel.name}`"
      subtitle="Bonos, trials y revocaciones que pisan el plan del hotel"
      @close="closeModulesModal">
      <SkeletonLoader v-if="modulesLoading" variant="card" :rows="5" />
      <div v-else class="space-y-3">
        <!-- Leyenda -->
        <div class="flex items-center gap-3 flex-wrap text-[10px] font-bold bg-surface rounded-xl p-2.5">
          <span class="flex items-center gap-1 text-teal"><span class="w-2 h-2 rounded-full bg-teal"></span>Plan</span>
          <span class="flex items-center gap-1 text-warning"><span class="w-2 h-2 rounded-full bg-warning"></span>Bono</span>
          <span class="flex items-center gap-1 text-danger"><span class="w-2 h-2 rounded-full bg-danger"></span>Revocado</span>
          <span class="flex items-center gap-1 text-text-muted"><span class="w-2 h-2 rounded-full bg-text-muted"></span>No incl.</span>
        </div>

        <!-- Árbol de módulos -->
        <div class="space-y-1.5">
          <div v-for="m in moduleCatalog" :key="m.key">
            <!-- Fila del módulo -->
            <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border" :class="overrideFor(m.key) ? 'bg-warning/5 border-warning/20' : 'bg-surface border-border'">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-sm font-bold text-navy truncate">{{ m.label }}</span>
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0" :class="STATE_BADGE[effectiveState(m.key)]">{{ STATE_LABEL[effectiveState(m.key)] }}</span>
              </div>
              <div v-if="editingOverrideKey !== m.key" class="flex gap-1 shrink-0">
                <template v-if="!overrideFor(m.key)">
                  <button @click="startCreateOverride(m.key, 'enabled')" class="px-2 py-0.5 bg-warning/10 text-warning rounded-md text-[10px] font-bold hover:bg-warning/20 transition-colors cursor-pointer">Bono</button>
                  <button @click="startCreateOverride(m.key, 'disabled')" class="px-2 py-0.5 bg-danger/10 text-danger rounded-md text-[10px] font-bold hover:bg-danger/20 transition-colors cursor-pointer">Revocar</button>
                </template>
                <template v-else>
                  <button @click="startEditOverride(overrideFor(m.key)!)" class="px-2 py-0.5 bg-navy/10 text-navy rounded-md text-[10px] font-bold hover:bg-navy/20 transition-colors cursor-pointer">Editar</button>
                  <button @click="removeOverride(overrideFor(m.key)!)" class="px-2 py-0.5 bg-surface border border-border text-text-secondary rounded-md text-[10px] font-bold hover:bg-surface-dark transition-colors cursor-pointer">Quitar</button>
                </template>
              </div>
            </div>

            <!-- Form inline del módulo -->
            <div v-if="editingOverrideKey === m.key" class="mx-1 mb-1 p-3 bg-white border border-border rounded-xl space-y-2">
              <div class="flex items-center gap-3 flex-wrap">
                <select v-model="editOverrideStatus" class="px-2 py-1 bg-surface border border-border rounded-lg text-[11px] font-bold cursor-pointer">
                  <option value="enabled">Bono/Extra (forzar ON)</option>
                  <option value="disabled">Revocado (forzar OFF)</option>
                </select>
                <div class="flex items-center gap-1.5">
                  <input v-model="editOverrideEndsAt" type="date" class="px-2 py-1 bg-surface border border-border rounded-lg text-[11px]" />
                  <span class="text-[9px] text-text-muted">Vence (vacío = permanente)</span>
                </div>
              </div>
              <input v-model="editOverrideReason" type="text" placeholder="Motivo del bono/revocación (opcional)..." class="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-[11px]" />
              <div class="flex gap-2">
                <button @click="saveOverride(m.key)" :disabled="savingOverride" class="px-3 py-1.5 bg-navy text-white rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50">{{ savingOverride ? 'Guardando...' : 'Guardar' }}</button>
                <button @click="cancelEditOverride" class="px-3 py-1.5 bg-surface border border-border rounded-lg text-[11px] font-bold text-text-secondary cursor-pointer">Cancelar</button>
              </div>
            </div>

            <!-- Submódulos -->
            <div v-if="m.submodules?.length" class="ml-3 mt-1 space-y-1">
              <div v-for="s in m.submodules" :key="s.key">
                <div class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border" :class="overrideFor(s.key) ? 'bg-warning/5 border-warning/20' : 'bg-surface/50 border-border/50'">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-text-muted">└</span>
                    <span class="text-[12px] font-semibold text-text-secondary truncate">{{ s.label }}</span>
                    <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0" :class="STATE_BADGE[effectiveState(s.key)]">{{ STATE_LABEL[effectiveState(s.key)] }}</span>
                  </div>
                  <div v-if="editingOverrideKey !== s.key" class="flex gap-1 shrink-0">
                    <template v-if="!overrideFor(s.key)">
                      <button @click="startCreateOverride(s.key, 'enabled')" class="px-1.5 py-0.5 bg-warning/10 text-warning rounded-md text-[9px] font-bold hover:bg-warning/20 transition-colors cursor-pointer">Bono</button>
                      <button @click="startCreateOverride(s.key, 'disabled')" class="px-1.5 py-0.5 bg-danger/10 text-danger rounded-md text-[9px] font-bold hover:bg-danger/20 transition-colors cursor-pointer">Revocar</button>
                    </template>
                    <template v-else>
                      <button @click="startEditOverride(overrideFor(s.key)!)" class="px-1.5 py-0.5 bg-navy/10 text-navy rounded-md text-[9px] font-bold hover:bg-navy/20 transition-colors cursor-pointer">Editar</button>
                      <button @click="removeOverride(overrideFor(s.key)!)" class="px-1.5 py-0.5 bg-surface border border-border text-text-secondary rounded-md text-[9px] font-bold hover:bg-surface-dark transition-colors cursor-pointer">Quitar</button>
                    </template>
                  </div>
                </div>
                <!-- Form inline del submódulo -->
                <div v-if="editingOverrideKey === s.key" class="ml-5 mr-1 mb-1 p-2.5 bg-white border border-border rounded-xl space-y-2">
                  <div class="flex items-center gap-3 flex-wrap">
                    <select v-model="editOverrideStatus" class="px-2 py-1 bg-surface border border-border rounded-lg text-[11px] font-bold cursor-pointer">
                      <option value="enabled">Bono/Extra (forzar ON)</option>
                      <option value="disabled">Revocado (forzar OFF)</option>
                    </select>
                    <div class="flex items-center gap-1.5">
                      <input v-model="editOverrideEndsAt" type="date" class="px-2 py-1 bg-surface border border-border rounded-lg text-[11px]" />
                      <span class="text-[9px] text-text-muted">Vence</span>
                    </div>
                  </div>
                  <input v-model="editOverrideReason" type="text" placeholder="Motivo (opcional)..." class="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-[11px]" />
                  <div class="flex gap-2">
                    <button @click="saveOverride(s.key)" :disabled="savingOverride" class="px-3 py-1.5 bg-navy text-white rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50">{{ savingOverride ? 'Guardando...' : 'Guardar' }}</button>
                    <button @click="cancelEditOverride" class="px-3 py-1.5 bg-surface border border-border rounded-lg text-[11px] font-bold text-text-secondary cursor-pointer">Cancelar</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="closeModulesModal" class="px-5 py-2.5 bg-surface text-text-secondary rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import AppModal from '@/components/ui/AppModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { SuperAdminService } from '@/services/SuperAdmin.service'
import { HotelAdminService, HotelModuleOverridesService, ModulesService, type ModuleMeta, type ModuleOverrideDTO } from '@/services/Platform.service'
import { PlansService } from '@/services/Plans.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const router = useRouter()
const auth = useAuthStore()
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

// Paginación de la vista (client-side): el endpoint devuelve todos los hoteles de la plataforma
// en una sola respuesta, así que no hay nada que pedirle al backend al cambiar de página.
const PAGE_SIZE = 10
const currentPage = ref(1)

// Impersonación por hotel. Se guarda el id del HOTEL, no el del usuario: es lo que identifica la
// fila clickeada, y así el botón se deshabilita solo en esa fila y no en toda la tabla.
const enteringId = ref<string | null>(null)
const plansList = ref<any[]>([])

const activeFilter = ref('all')
const planFilter = ref('all')
const locationFilter = ref('all')
const occupancyFilter = ref('all')
const mrrFilter = ref('all')
const searchQuery = ref('')
const sortBy = ref('name-asc')
const viewMode = ref<'table' | 'grid'>('table')
const showViewModal = ref(false)
const showEditModal = ref(false)
const showSuspendModal = ref(false)
const selectedHotel = ref<any>({})
const editingHotel = ref<any>({})
const suspendReason = ref('')

const PLAN_MRR: Record<string, number> = { enterprise: 199, professional: 99, starter: 49, essential: 49, ultra: 0 }

const stats = computed(() => {
  const list = hotels.value
  const mrr = list.reduce((s, h) => s + (PLAN_MRR[String(h.plan).toLowerCase()] ?? 0), 0)
  return [
    { label: 'Total Hoteles', value: list.length, color: 'text-navy' },
    { label: 'Activos', value: list.filter((h: any) => h.status === 'Activo').length, color: 'text-teal' },
    { label: 'Pendientes', value: list.filter((h: any) => h.status === 'Pendiente').length, color: 'text-orange' },
    { label: 'Suspendidos', value: list.filter((h: any) => h.status === 'Suspendido').length, color: 'text-red' },
    { label: 'MRR Total', value: `$${mrr.toLocaleString()}`, color: 'text-navy' },
  ]
})

const hotels = ref<any[]>([])
const loading = ref(true)

onMounted(async () => {
  loading.value = true
  try { plansList.value = (await PlansService.list()).data || [] } catch { /* opcional */ }
  try {
    const { hotels: data } = await SuperAdminService.hotels()
    hotels.value = data.map((h: any) => ({
      id: h.id,
      name: h.name,
      location: h.address ?? h.location ?? '',
      email: h.email ?? '',
      phone: h.phone ?? '',
      plan: h.plan ? (h.plan.charAt(0).toUpperCase() + h.plan.slice(1)) : 'Starter',
      rooms: h.roomCount ?? 0,
      occupancy: 0,
      mrr: PLAN_MRR[String(h.plan).toLowerCase()] ?? 0,
      users: 0,
      status: h.status === 'pendiente' ? 'Pendiente' : h.status === 'suspendido' ? 'Suspendido' : 'Activo',
      registered: h.createdAt ? String(h.createdAt).slice(0, 10) : '',
      // Usuario al que entra el botón "Entrar". Este map arma un objeto NUEVO campo por campo,
      // así que lo que no se copie acá se pierde: sin estas tres líneas el botón sale siempre
      // deshabilitado aunque el backend mande el owner.
      ownerUserId: h.ownerUserId ?? null,
      ownerName: h.ownerName ?? '',
      ownerRole: h.ownerRole ?? '',
    }))
  } catch { toast.error('No se pudieron cargar los hoteles') } finally { loading.value = false }
})

const locations = computed(() => [...new Set(hotels.value.map(h => h.location))].sort())

const activeFiltersCount = computed(() => {
  let count = 0
  if (activeFilter.value !== 'all') count++
  if (planFilter.value !== 'all') count++
  if (locationFilter.value !== 'all') count++
  if (occupancyFilter.value !== 'all') count++
  if (mrrFilter.value !== 'all') count++
  if (searchQuery.value) count++
  return count
})

const filteredHotels = computed(() => {
  let result = [...hotels.value]

  if (activeFilter.value !== 'all') result = result.filter(h => h.status === activeFilter.value)
  if (planFilter.value !== 'all') result = result.filter(h => h.plan === planFilter.value)
  if (locationFilter.value !== 'all') result = result.filter(h => h.location === locationFilter.value)
  if (occupancyFilter.value !== 'all') {
    if (occupancyFilter.value === 'high') result = result.filter(h => h.occupancy > 80)
    else if (occupancyFilter.value === 'medium') result = result.filter(h => h.occupancy >= 50 && h.occupancy <= 80)
    else result = result.filter(h => h.occupancy < 50)
  }
  if (mrrFilter.value !== 'all') {
    if (mrrFilter.value === 'high') result = result.filter(h => h.mrr >= 100)
    else if (mrrFilter.value === 'medium') result = result.filter(h => h.mrr >= 50 && h.mrr < 100)
    else result = result.filter(h => h.mrr < 50)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(h => h.name.toLowerCase().includes(q) || h.location.toLowerCase().includes(q) || h.email.toLowerCase().includes(q) || h.phone.includes(q))
  }

  const [field, dir] = sortBy.value.split('-')
  result.sort((a: any, b: any) => {
    const aVal = a[field]
    const bVal = b[field]
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal
    return dir === 'desc' ? -cmp : cmp
  })

  return result
})

// ── Paginación ────────────────────────────────────────────────────────────────────────────
const totalFiltered = computed(() => filteredHotels.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalFiltered.value / PAGE_SIZE)))
const paginatedHotels = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredHotels.value.slice(start, start + PAGE_SIZE)
})

// Al filtrar, volver a la primera página: quedarse en la 4 con un filtro que deja 3 hoteles
// muestra una tabla vacía sin explicación. Y clampear si el universo se achica (baja de un hotel).
watch([searchQuery, activeFilter, planFilter, locationFilter, occupancyFilter, mrrFilter], () => { currentPage.value = 1 })
watch(totalPages, (tp) => { if (currentPage.value > tp) currentPage.value = tp })

function goToPage(n: number) {
  currentPage.value = Math.min(Math.max(1, n), totalPages.value)
}

// ── Entrar a la cuenta del hotel (impersonación) ──────────────────────────────────────────
// Mismo flujo que el botón de `/admin/users`: el hotel no se impersona, se impersona a una
// PERSONA. El backend ya resolvió cuál en `ownerUserId` (ver dashboard-queries.listHotels).
const ROLE_LABELS: Record<string, string> = {
  hotel_admin: 'administrador',
  receptionist: 'recepción',
  housekeeper: 'limpieza',
  maintenance: 'mantenimiento',
}
const roleLabel = (role: string) => ROLE_LABELS[role] || role || 'usuario'

const loginAsHotel = async (hotel: any) => {
  if (!hotel.ownerUserId) return
  enteringId.value = hotel.id
  try {
    // Solo se navega si el store DE VERDAD impersonó: con dos clicks en filas distintas la segunda
    // llamada se descarta (hay una impersonación en curso) y devuelve false — navegar igual dejaba
    // al admin en el panel del PRIMER hotel creyendo que entró al segundo.
    const entro = await auth.loginAs(hotel.ownerUserId)
    if (entro) router.push('/panel')
    else toast.info('Ya se está entrando a otra cuenta')
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo entrar a la cuenta de este hotel')
  } finally {
    enteringId.value = null
  }
}

const planClass = (plan: string) => ({ 'Enterprise': 'bg-navy/10 text-navy', 'Professional': 'bg-cyan/10 text-cyan', 'Starter': 'bg-teal/10 text-teal' }[plan] || 'bg-surface text-text-muted')
const statusClass = (status: string) => ({ 'Activo': 'bg-teal/10 text-teal', 'Pendiente': 'bg-orange/10 text-orange', 'Suspendido': 'bg-red/10 text-red' }[status] || 'bg-surface text-text-muted')

const toggleSort = (field: string) => {
  if (sortBy.value.startsWith(field)) {
    sortBy.value = sortBy.value.endsWith('asc') ? `${field}-desc` : `${field}-asc`
  } else {
    sortBy.value = `${field}-asc`
  }
}

const clearAllFilters = () => {
  activeFilter.value = 'all'
  planFilter.value = 'all'
  locationFilter.value = 'all'
  occupancyFilter.value = 'all'
  mrrFilter.value = 'all'
  searchQuery.value = ''
}

const exportHotels = () => {
  const headers = ['Nombre', 'Ubicación', 'Plan', 'Habitaciones', 'Ocupación', 'MRR', 'Estado']
  const rows = filteredHotels.value.map(h => [h.name, h.location, h.plan, h.rooms, `${h.occupancy}%`, `$${h.mrr}`, h.status])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hoteles-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const openViewHotel = (hotel: any) => { selectedHotel.value = { ...hotel }; showViewModal.value = true }
const openEditHotel = (hotel: any) => { editingHotel.value = { ...hotel }; showEditModal.value = true }
const openNewHotel = () => { editingHotel.value = { id: null, name: '', email: '', phone: '', location: '', plan: 'Professional', rooms: 0, occupancy: 0, mrr: 0, users: 1, status: 'Pendiente', registered: new Date().toLocaleDateString('es-ES') }; showEditModal.value = true }
const openSuspendModal = (hotel: any) => { selectedHotel.value = { ...hotel }; suspendReason.value = ''; showSuspendModal.value = true }

const saveHotel = async () => {
  if (!editingHotel.value.name || !editingHotel.value.email || !editingHotel.value.location) return
  editingHotel.value.mrr = PLAN_MRR[String(editingHotel.value.plan).toLowerCase()] ?? 0
  if (editingHotel.value.id) {
    // Editar hotel existente: persistir plan/estado/datos en el backend (super_admin).
    try {
      await HotelAdminService.update(String(editingHotel.value.id), {
        plan: editingHotel.value.plan, status: editingHotel.value.status,
        name: editingHotel.value.name, email: editingHotel.value.email,
        phone: editingHotel.value.phone, location: editingHotel.value.location,
      })
      const idx = hotels.value.findIndex(h => h.id === editingHotel.value.id)
      if (idx !== -1) hotels.value[idx] = { ...editingHotel.value }
      toast.success('Hotel actualizado')
      showEditModal.value = false
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar el hotel')
    }
  } else {
    // Alta de hotel: el onboarding completo (crear cuenta dueño, etc.) es un flujo aparte, aún no cableado acá.
    toast.error('El alta de hoteles nuevos se hace desde el onboarding, no desde esta pantalla')
  }
}

const toggleSuspend = async () => {
  const next = selectedHotel.value.status === 'Suspendido' ? 'Activo' : 'Suspendido'
  try {
    await HotelAdminService.update(String(selectedHotel.value.id), { status: next })
    selectedHotel.value.status = next
    const idx = hotels.value.findIndex(h => h.id === selectedHotel.value.id)
    if (idx !== -1) hotels.value[idx].status = next
    toast.success(next === 'Suspendido' ? 'Hotel suspendido' : 'Hotel reactivado')
    showSuspendModal.value = false
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo cambiar el estado')
  }
}

// ─── Módulos del hotel: excepciones/bonos (#568) ───
// El super_admin puede forzar ON (bono/trial) o OFF (revocar) módulos individuales
// que pisan lo que el plan del hotel incluye. El backend aplica la 3ra capa solo.
const showModulesModal = ref(false)
const modulesHotel = ref<any>({})
const modulesLoading = ref(false)
const moduleCatalog = ref<ModuleMeta[]>([])
const moduleOverrides = ref<ModuleOverrideDTO[]>([])
const editingOverrideKey = ref<string | null>(null)
const editOverrideStatus = ref<'enabled' | 'disabled'>('enabled')
const editOverrideReason = ref('')
const editOverrideEndsAt = ref('')
const savingOverride = ref(false)

// Módulos incluidos en el plan del hotel (normalizados: parent sin submódulos listados = todos).
const hotelPlanModules = computed<string[]>(() => {
  const planSlug = String(modulesHotel.value.plan || '').toLowerCase()
  const plan = plansList.value.find((p: any) => String(p.slug || '').toLowerCase() === planSlug)
  if (!plan || !plan.modules) return []
  const mods: string[] = plan.modules
  if (mods.length === 0) return []  // array vacío = todos incluidos
  // Normalizar: módulo top-level listado sin submódulos → todos sus submódulos incluidos
  const set = new Set(mods)
  for (const m of moduleCatalog.value) {
    const subs = m.submodules ?? []
    if (set.has(m.key) && subs.length && !subs.some(s => set.has(s.key))) {
      subs.forEach(s => set.add(s.key))
    }
  }
  return [...set]
})

function planIncludes(key: string): boolean {
  const mods = hotelPlanModules.value
  return mods.length === 0 || mods.includes(key)
}

function overrideFor(moduleKey: string): ModuleOverrideDTO | undefined {
  return moduleOverrides.value.find(o => o.moduleKey === moduleKey)
}

// Estado efectivo: lo que el hotel ve para este módulo (plan ∩ override).
function effectiveState(moduleKey: string): 'plan' | 'bono' | 'revocado' | 'off' {
  const ov = overrideFor(moduleKey)
  if (ov?.status === 'enabled') return 'bono'
  if (ov?.status === 'disabled') return 'revocado'
  return planIncludes(moduleKey) ? 'plan' : 'off'
}

const STATE_BADGE: Record<string, string> = {
  plan: 'bg-teal/10 text-teal',
  bono: 'bg-warning/10 text-warning',
  revocado: 'bg-danger/10 text-danger',
  off: 'bg-surface text-text-muted',
}
const STATE_LABEL: Record<string, string> = {
  plan: 'Plan',
  bono: 'Bono',
  revocado: 'Revocado',
  off: 'No incl.',
}

async function openModulesModal(hotel: any) {
  modulesHotel.value = { ...hotel }
  showModulesModal.value = true
  modulesLoading.value = true
  editingOverrideKey.value = null
  try {
    const [overrides, catalog] = await Promise.all([
      HotelModuleOverridesService.list(String(hotel.id)),
      ModulesService.adminGet(),
    ])
    moduleOverrides.value = overrides || []
    moduleCatalog.value = catalog.catalog || []
  } catch (e: any) {
    toast.error(e?.message || 'No se pudieron cargar los módulos')
  } finally {
    modulesLoading.value = false
  }
}

function closeModulesModal() {
  showModulesModal.value = false
  editingOverrideKey.value = null
}

function startCreateOverride(moduleKey: string, status: 'enabled' | 'disabled') {
  editingOverrideKey.value = moduleKey
  editOverrideStatus.value = status
  editOverrideReason.value = ''
  editOverrideEndsAt.value = ''
}

function startEditOverride(o: ModuleOverrideDTO) {
  editingOverrideKey.value = o.moduleKey
  editOverrideStatus.value = o.status
  editOverrideReason.value = o.reason || ''
  editOverrideEndsAt.value = o.endsAt ? String(o.endsAt).slice(0, 10) : ''
}

function cancelEditOverride() {
  editingOverrideKey.value = null
}

async function saveOverride(moduleKey: string) {
  savingOverride.value = true
  try {
    const body: { moduleKey: string; status: 'enabled' | 'disabled'; reason?: string; endsAt?: string } = {
      moduleKey,
      status: editOverrideStatus.value,
    }
    if (editOverrideReason.value.trim()) body.reason = editOverrideReason.value.trim()
    if (editOverrideEndsAt.value) body.endsAt = new Date(editOverrideEndsAt.value + 'T23:59:59').toISOString()
    const saved = await HotelModuleOverridesService.upsert(String(modulesHotel.value.id), body)
    const idx = moduleOverrides.value.findIndex(o => o.moduleKey === moduleKey)
    if (idx !== -1) moduleOverrides.value[idx] = saved
    else moduleOverrides.value.push(saved)
    editingOverrideKey.value = null
    toast.success(editOverrideStatus.value === 'enabled' ? 'Bono otorgado' : 'Módulo revocado')
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo guardar')
  } finally {
    savingOverride.value = false
  }
}

async function removeOverride(o: ModuleOverrideDTO) {
  try {
    await HotelModuleOverridesService.remove(String(modulesHotel.value.id), o.id)
    moduleOverrides.value = moduleOverrides.value.filter(x => x.id !== o.id)
    editingOverrideKey.value = null
    toast.success('Excepción removida')
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo remover')
  }
}
</script>
