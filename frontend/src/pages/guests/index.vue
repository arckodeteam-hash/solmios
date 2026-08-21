<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">Huéspedes</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-sm text-text-muted mt-0.5">CRM y fidelización de clientes</p>
      </div>
      <button @click="openNewGuest" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer">
        <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
        Nuevo Huésped
      </button>
    </div>

    <!-- Stats — KpiHeroCard (mismo lenguaje visual que dashboard/housekeeping) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Total Huéspedes" :value="totalGuestsCount" icon="users" accent="blue"
        :unit="`${newGuestsCount} nuevos · ${vipGuestsCount} VIP`" />
      <KpiHeroCard label="Activos Hoy" :value="activeToday" icon="checkin" accent="teal"
        unit="Hospedados en este momento" />
      <KpiHeroCard label="Frecuentes" :value="frequentGuests" icon="bookings" accent="purple"
        :unit="`${FREQUENT_STAYS_THRESHOLD}+ estadías`" :progress="frequentShare" />
      <KpiHeroCard label="Puntos Otorgados" :value="totalPoints" icon="money" accent="amber"
        unit="Programa de fidelización" />
    </div>

    <!-- Guest List -->
    <SectionCard title="Listado de huéspedes" :subtitle="`${totalFiltered} de ${totalGuestsCount} huésped(es)`" body-class="p-0">
      <template #actions>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" v-html="ICON_SEARCH"></span>
          <input
            id="guests-search"
            name="search"
            v-model="searchQuery"
            type="text"
            aria-label="Buscar huéspedes por nombre, email o teléfono"
            placeholder="Buscar nombre, email o teléfono..."
            class="w-full sm:w-72 pl-9 pr-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-cyan focus:bg-white/15 transition-colors"
          />
        </div>
        <select id="guests-filter-type" name="filterType" aria-label="Filtrar huéspedes" v-model="filterType" class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="all">Todos</option>
          <option class="text-navy" value="frequent">Frecuentes ({{ FREQUENT_STAYS_THRESHOLD }}+ estadías)</option>
          <option class="text-navy" value="new">Nuevos (1 estadía)</option>
          <option class="text-navy" value="vip">VIP (${{ VIP_SPEND_THRESHOLD.toLocaleString() }}+ gastados)</option>
        </select>
      </template>

      <SkeletonLoader v-if="loading" variant="table" :rows="6" />

      <EmptyState
        v-else-if="!totalFiltered"
        :icon="ICON_USERS_EMPTY"
        :title="searchQuery || filterType !== 'all' ? 'Sin resultados' : 'Todavía no hay huéspedes'"
        :message="searchQuery || filterType !== 'all' ? 'Probá con otro término de búsqueda o quitá el filtro.' : 'Registrá el primer huésped para empezar a construir tu CRM.'"
      >
        <template #action>
          <button v-if="searchQuery || filterType !== 'all'" @click="clearFilters" class="px-5 py-2.5 rounded-full border border-border text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Limpiar filtros
          </button>
          <button v-else @click="openNewGuest" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo Huésped
          </button>
        </template>
      </EmptyState>

      <div v-else>
        <!-- Segmento activo desde el CRM (spec crm-segments) -->
        <div v-if="activeSegment" class="mb-3 flex items-center gap-2">
          <span class="inline-flex items-center gap-2 rounded-full bg-navy/10 px-3 py-1.5 text-xs font-bold text-navy">
            Segmento: {{ activeSegment.name }}
            <button @click.stop="clearSegmentFilter" title="Quitar filtro"
              class="text-coral hover:text-coral/70 cursor-pointer font-black">✕</button>
          </span>
          <span class="text-[11px] text-text-muted">{{ segmentedGuests.length }} huésped(es)</span>
        </div>
        <div class="overflow-x-auto">
        <table class="w-full min-w-[840px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Huésped</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Contacto</th>
              <th class="text-right px-4 py-3 text-[10px]">Estadías</th>
              <th class="text-right px-4 py-3 text-[10px]">Total Gastado</th>
              <th class="text-right px-4 py-3 text-[10px]">Puntos</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Última Visita</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="guest in paginatedGuests"
              :key="guest.id"
              @click="openViewGuest(guest)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer"
            >
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="relative shrink-0">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black" :class="guestAvatarClass(guest)">
                      {{ guest.initials }}
                    </div>
                    <!-- Punto verde: hospedado en este momento -->
                    <span v-if="guest.isActiveToday" class="absolute -bottom-0.5 -right-0.5 flex h-3 w-3" title="Hospedado hoy">
                      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
                      <span class="relative inline-flex h-3 w-3 rounded-full bg-[#22C55E] ring-2 ring-white"></span>
                    </span>
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="text-sm font-bold text-navy truncate">{{ guest.name }}</span>
                      <span class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide" :class="segmentOf(guest).class">
                        {{ segmentOf(guest).label }}
                      </span>
                    </div>
                    <!-- Líneas secundarias: cada una se omite si está vacía (evita filas
                         llenas de guiones sueltos). El contacto sólo aparece en <lg, donde
                         la columna Contacto está oculta — en desktop sería duplicado. -->
                    <div v-if="guest.nationality" class="text-[11px] text-text-muted truncate">{{ guest.nationality }}</div>
                    <div v-if="contactOf(guest)" class="text-[11px] text-text-muted truncate lg:hidden">{{ contactOf(guest) }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <div v-if="guest.email" class="text-sm text-text-secondary truncate max-w-[220px]">{{ guest.email }}</div>
                <div v-if="guest.phone" class="text-[11px] text-text-muted">{{ guest.phone }}</div>
                <span v-if="!guest.email && !guest.phone" class="text-sm text-text-muted">Sin contacto</span>
              </td>
              <td class="px-4 py-3 text-right text-sm font-bold text-navy tabular-nums">{{ guest.stays }}</td>
              <td class="px-4 py-3 text-right text-sm font-extrabold text-navy tabular-nums">${{ guest.totalSpent.toLocaleString() }}</td>
              <td class="px-4 py-3 text-right">
                <span class="inline-flex items-center rounded-full bg-gold/10 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-gold">
                  {{ guest.points.toLocaleString() }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden xl:table-cell">{{ guest.lastVisit || '—' }}</td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="openViewGuest(guest)" title="Ver perfil"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EYE"></span>
                  </button>
                  <button @click.stop="openEditGuest(guest)" title="Editar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_PENCIL"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <!-- Paginación del listado -->
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
    </SectionCard>

    <!-- View Guest Profile Modal -->
    <AppModal v-if="showViewModal && viewGuest" size="xl" body-class="p-0" @close="closeViewModal">
      <!-- Header: identidad + tier, sobre el navy del sistema -->
      <template #header>
        <div class="flex items-center gap-4 min-w-0">
          <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-lg font-black text-white ring-1 ring-white/20">
            {{ viewGuest.initials }}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-lg font-black text-white truncate">{{ viewGuest.name }}</h3>
              <span class="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                {{ viewGuestTier.label }}
              </span>
              <span v-if="viewGuest.isActiveToday" class="inline-flex items-center gap-1.5 rounded-full bg-[#22C55E]/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-[#4ADE80]">
                <span class="h-1.5 w-1.5 rounded-full bg-[#4ADE80]"></span> Hospedado
              </span>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-white/60">
              {{ [viewGuest.nationality, viewGuest.email].filter(Boolean).join(' · ') || 'Sin datos de contacto' }}
            </p>
          </div>
        </div>
      </template>

      <!-- Franja de métricas -->
      <div class="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <div v-for="m in viewGuestMetrics" :key="m.label" class="flex items-center gap-3 bg-white px-4 py-3.5">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl" :class="m.iconClass">
            <span class="h-4.5 w-4.5" v-html="UI_ICON[m.icon]"></span>
          </span>
          <div class="min-w-0">
            <div class="text-lg font-black leading-none tabular-nums" :class="m.valueClass">{{ m.value }}</div>
            <div class="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ m.label }}</div>
          </div>
        </div>
      </div>

      <!-- Dos columnas: ficha a la izquierda, actividad a la derecha -->
      <div class="grid gap-5 p-5 lg:grid-cols-[1.05fr_1fr]">
        <!-- ── Columna izquierda: ficha del cliente ── -->
        <div class="space-y-4">
          <section v-for="sec in viewGuestSections" :key="sec.title" class="overflow-hidden rounded-2xl border border-border">
            <header class="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
              <span class="grid h-6 w-6 place-items-center rounded-lg bg-navy/10 text-navy">
                <span class="h-3.5 w-3.5" v-html="UI_ICON[sec.icon]"></span>
              </span>
              <h4 class="text-[11px] font-black uppercase tracking-wide text-navy">{{ sec.title }}</h4>
            </header>
            <p v-if="!sec.fields.length" class="px-4 py-3 text-xs text-text-muted">Sin datos registrados</p>
            <dl v-else class="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
              <div v-for="f in sec.fields" :key="f.label" :class="f.wide ? 'col-span-2' : ''">
                <dt class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{{ f.label }}</dt>
                <dd class="mt-0.5 truncate text-sm font-bold" :class="f.tone || 'text-navy'">{{ f.value }}</dd>
              </div>
            </dl>
          </section>

          <!-- Preferencias -->
          <section v-if="viewGuest.preferences?.length" class="overflow-hidden rounded-2xl border border-border">
            <header class="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
              <span class="grid h-6 w-6 place-items-center rounded-lg bg-cyan/10 text-cyan">
                <span class="h-3.5 w-3.5" v-html="UI_ICON.sparkles"></span>
              </span>
              <h4 class="text-[11px] font-black uppercase tracking-wide text-navy">Preferencias</h4>
            </header>
            <div class="flex flex-wrap gap-1.5 p-4">
              <span v-for="pref in viewGuest.preferences" :key="pref"
                class="rounded-full bg-cyan/10 px-3 py-1 text-[11px] font-bold text-cyan">{{ pref }}</span>
            </div>
          </section>

          <!-- Notas: se lee como una nota, no como un campo más -->
          <section v-if="viewGuest.notes" class="overflow-hidden rounded-2xl border border-gold/30 bg-gold/5">
            <header class="flex items-center gap-2 border-b border-gold/20 px-4 py-2.5">
              <span class="grid h-6 w-6 place-items-center rounded-lg bg-gold/15 text-gold">
                <span class="h-3.5 w-3.5" v-html="UI_ICON.note"></span>
              </span>
              <h4 class="text-[11px] font-black uppercase tracking-wide text-gold">Notas internas</h4>
            </header>
            <p class="whitespace-pre-wrap px-4 py-3 text-sm text-text-secondary">{{ viewGuest.notes }}</p>
          </section>
        </div>

        <!-- ── Columna derecha: actividad ── -->
        <div class="space-y-4">
          <!-- Historial de estadías como línea de tiempo -->
          <section class="overflow-hidden rounded-2xl border border-border">
            <header class="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5">
              <div class="flex items-center gap-2">
                <span class="grid h-6 w-6 place-items-center rounded-lg bg-teal/10 text-teal">
                  <span class="h-3.5 w-3.5" v-html="UI_ICON.calendar"></span>
                </span>
                <h4 class="text-[11px] font-black uppercase tracking-wide text-navy">Historial de estadías</h4>
              </div>
              <span v-if="viewGuest.history?.length" class="text-[10px] font-bold text-text-muted">{{ viewGuest.history.length }}</span>
            </header>

            <div v-if="viewGuest.loadingDetail" class="space-y-3 p-4">
              <div v-for="i in 3" :key="i" class="h-10 animate-pulse rounded-lg bg-surface"></div>
            </div>
            <p v-else-if="!viewGuest.history?.length" class="px-4 py-6 text-center text-xs text-text-muted">Sin estadías registradas</p>
            <ol v-else class="relative p-4">
              <!-- riel de la línea de tiempo -->
              <span class="absolute bottom-6 left-[22px] top-6 w-px bg-border"></span>
              <li v-for="stay in viewGuest.history" :key="stay.id" class="relative flex gap-3 pb-4 last:pb-0">
                <span class="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white" :class="stayDotClass(stay.status)"></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <span class="text-sm font-bold text-navy">{{ stay.dates }}</span>
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase" :class="stayBadgeClass(stay.status)">
                      {{ stayLabel(stay.status) }}
                    </span>
                  </div>
                  <div class="mt-0.5 text-[11px] text-text-muted">
                    {{ stay.nights }} noches · ${{ stay.total }}<template v-if="stay.channel"> · {{ stay.channel }}</template>
                  </div>
                </div>
              </li>
            </ol>
          </section>

          <!-- Movimientos de puntos -->
          <section class="overflow-hidden rounded-2xl border border-border">
            <header class="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5">
              <div class="flex items-center gap-2">
                <span class="grid h-6 w-6 place-items-center rounded-lg bg-gold/10 text-gold">
                  <span class="h-3.5 w-3.5" v-html="UI_ICON.coins"></span>
                </span>
                <h4 class="text-[11px] font-black uppercase tracking-wide text-navy">Movimientos de puntos</h4>
              </div>
              <div class="flex items-center gap-3">
                <button @click="openAwardModal"
                  class="text-[11px] font-bold text-cyan hover:text-navy transition-colors cursor-pointer">
                  Otorgar →
                </button>
                <button v-if="(viewGuest.points ?? 0) > 0" @click="openRedeemModal"
                  class="text-[11px] font-bold text-cyan hover:text-navy transition-colors cursor-pointer">
                  Canjear →
                </button>
              </div>
            </header>

            <div v-if="viewGuest.loadingDetail" class="space-y-3 p-4">
              <div v-for="i in 2" :key="i" class="h-8 animate-pulse rounded-lg bg-surface"></div>
            </div>
            <p v-else-if="!viewGuest.pointsHistory?.length" class="px-4 py-6 text-center text-xs text-text-muted">Sin movimientos de puntos</p>
            <ul v-else class="divide-y divide-border">
              <li v-for="tx in viewGuest.pointsHistory" :key="tx.id" class="flex items-center justify-between gap-3 px-4 py-2.5">
                <div class="min-w-0">
                  <div class="truncate text-xs font-bold text-navy">{{ tx.description || tx.type }}</div>
                  <div class="text-[10px] text-text-muted">{{ fmtDate(tx.createdAt) }}</div>
                </div>
                <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-black tabular-nums"
                  :class="tx.points >= 0 ? 'bg-teal/10 text-teal' : 'bg-gold/10 text-gold'">
                  {{ tx.points >= 0 ? '+' : '' }}{{ tx.points }}
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <template #footer>
        <button @click="closeViewModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">
          Cerrar
        </button>
        <button @click="closeViewModal(); openEditGuest(viewGuest)"
          class="inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
          <span class="h-4 w-4" v-html="UI_ICON.pencil"></span>
          Editar perfil
        </button>
      </template>
    </AppModal>

    <!-- Canjear puntos -->
    <AppModal v-if="showRedeemModal" size="sm" title="Canjear puntos"
      :subtitle="`Saldo disponible: ${(viewGuest?.points ?? 0).toLocaleString()} puntos`" @close="showRedeemModal = false">
      <div class="space-y-4">
        <div>
          <label for="redeem-points" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Puntos a canjear</label>
          <input id="redeem-points" name="redeemPoints" v-model.number="redeemForm.points" type="number" min="1" :max="viewGuest?.points ?? 0"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy tabular-nums focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="redeem-description" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Motivo</label>
          <input id="redeem-description" name="redeemDescription" v-model="redeemForm.description" type="text" placeholder="Ej: Descuento en factura #1024"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:outline-none focus:border-navy">
        </div>
      </div>
      <!-- El canje genera un promo code REAL (spec crm-loyalty): queda a la vista para copiarlo. -->
      <div v-if="redeemResult" class="rounded-2xl border-2 border-teal/40 bg-teal/5 p-4 space-y-2">
        <div class="text-xs font-bold text-text-secondary">¡Listo! Dale este código al huésped — descuenta en la próxima reserva:</div>
        <div class="flex items-center gap-2">
          <code class="flex-1 rounded-lg bg-white px-3 py-2 text-center text-lg font-black tracking-wider text-navy border border-border">{{ redeemResult.promoCode }}</code>
          <button @click="copyRedeemCode" class="rounded-full bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Copiar</button>
        </div>
        <div class="text-xs text-text-secondary">Valor: <b class="text-navy">${{ redeemResult.discountValue }}</b></div>
      </div>

      <template #footer>
        <button @click="closeRedeemModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">{{ redeemResult ? 'Cerrar' : 'Cancelar' }}</button>
        <button v-if="!redeemResult" @click="redeemPoints" :disabled="redeeming"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ redeeming ? 'Canjeando…' : 'Canjear' }}
        </button>
      </template>
    </AppModal>

    <!-- Otorgar puntos (T5, spec crm-loyalty) -->
    <AppModal v-if="showAwardModal" size="sm" title="Otorgar puntos"
      :subtitle="`Saldo actual: ${(viewGuest?.points ?? 0).toLocaleString()} puntos`" @close="showAwardModal = false">
      <div class="space-y-4">
        <div>
          <label for="award-points" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Puntos a otorgar</label>
          <input id="award-points" name="awardPoints" v-model.number="awardForm.points" type="number" min="1"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy tabular-nums focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="award-description" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Motivo</label>
          <input id="award-description" name="awardDescription" v-model="awardForm.description" type="text" placeholder="Ej: compensación por demora"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
        </div>
      </div>
      <template #footer>
        <button @click="showAwardModal = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="awardPoints" :disabled="awarding"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ awarding ? 'Otorgando…' : 'Otorgar' }}
        </button>
      </template>
    </AppModal>

    <!-- New/Edit Guest Modal -->
    <AppModal v-if="showFormModal" size="lg" body-class="p-0"
      :title="editingGuest ? 'Editar huésped' : 'Nuevo huésped'"
      :subtitle="`Paso ${formStep} de ${FORM_STEPS.length} · ${FORM_STEPS[formStep - 1].label}`"
      @close="closeFormModal">

      <!-- Stepper: dónde estoy y qué falta -->
      <ol class="flex items-center gap-1 border-b border-border bg-surface px-5 py-3">
        <li v-for="s in FORM_STEPS" :key="s.n" class="flex flex-1 items-center gap-1.5 last:flex-none">
          <button
            @click="goToStep(s.n)"
            :disabled="s.n > formStep"
            class="flex items-center gap-2 rounded-full transition-colors"
            :class="s.n <= formStep ? 'cursor-pointer' : 'cursor-not-allowed'"
            :title="s.label"
          >
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-black transition-colors"
              :class="s.n < formStep ? 'bg-teal text-white' : s.n === formStep ? 'bg-navy text-white' : 'bg-white text-text-muted ring-1 ring-border'">
              <span v-if="s.n < formStep" class="h-3.5 w-3.5" v-html="UI_ICON.check"></span>
              <template v-else>{{ s.n }}</template>
            </span>
            <span class="hidden whitespace-nowrap text-[11px] font-bold sm:inline"
              :class="s.n === formStep ? 'text-navy' : 'text-text-muted'">{{ s.short }}</span>
          </button>
          <span v-if="s.n < FORM_STEPS.length" class="h-px flex-1 transition-colors" :class="s.n < formStep ? 'bg-teal' : 'bg-border'"></span>
        </li>
      </ol>

      <div class="space-y-4 p-5">
            <p v-if="formStep === 1" class="text-[11px] text-text-muted">Los campos marcados con <span class="text-red-500 font-bold">*</span> son obligatorios.</p>

            <!-- Paso 1: Datos Personales -->
            <template v-if="formStep === 1">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="guest-name" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Nombre Completo <span class="text-red-500">*</span></label>
                  <input id="guest-name" v-model="form.name" type="text" name="name" placeholder="Nombre y apellido" class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('name')" data-field="name" required aria-required="true" :aria-invalid="!!errorOf('name')" @blur="touchField('name')" />
                  <p v-if="errorOf('name')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('name') }}</p>
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Nacionalidad</label>
                  <SearchSelect v-model="form.nationality" :options="NATIONALITIES" placeholder="Buscar nacionalidad..." />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="guest-email" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Email <span class="text-red-500">*</span></label>
                  <input id="guest-email" v-model="form.email" type="email" name="email" placeholder="email@ejemplo.com" class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('email')" data-field="email" required aria-required="true" :aria-invalid="!!errorOf('email')" @blur="touchField('email')" />
                  <p v-if="errorOf('email')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('email') }}</p>
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Teléfono</label>
                  <PhoneInput v-model="form.phone" :country="form.country" />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="guest-document" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Documento</label>
                  <input id="guest-document" v-model="form.document" type="text" name="document" placeholder="Pasaporte o ID" class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('document')" data-field="document" :aria-invalid="!!errorOf('document')" @blur="touchField('document')" />
                  <p v-if="errorOf('document')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('document') }}</p>
                </div>
                <div>
                  <label for="guest-document-type" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Tipo Documento</label>
                  <select id="guest-document-type" v-model="form.documentType" name="documentType" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
                    <option value="">—</option>
                    <option v-for="d in DOC_TYPES" :key="d.v" :value="d.v">{{ d.l }}</option>
                  </select>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="guest-document-issue-date" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Exp. Documento</label>
                  <input id="guest-document-issue-date" v-model="form.documentIssueDate" type="date" name="documentIssueDate" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
                </div>
                <div>
                  <label for="guest-birthdate" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Fecha de Nacimiento</label>
                  <input id="guest-birthdate" v-model="form.birthDate" type="date" name="birthDate" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
                </div>
              </div>
              <div>
                <label for="guest-sex" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Sexo</label>
                <select id="guest-sex" v-model="form.sex" name="sex" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
                  <option value="">—</option>
                  <option value="male">Masculino</option>
                  <option value="female">Femenino</option>
                  <option value="other">Otro</option>
                </select>
              </div>
            </template>

            <!-- Paso 2: Dirección y Profesión -->
            <template v-if="formStep === 2">
              <div>
                <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">País</label>
                <SearchSelect v-model="form.country" :options="COUNTRIES" placeholder="Buscar país..." />
              </div>
              <div class="grid grid-cols-3 gap-4">
                <div class="col-span-2">
                  <label for="guest-address" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Dirección</label>
                  <input id="guest-address" v-model="form.address" type="text" name="address" placeholder="Calle, número..." class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('address')" data-field="address" :aria-invalid="!!errorOf('address')" @blur="touchField('address')" />
                  <p v-if="errorOf('address')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('address') }}</p>
                </div>
                <div>
                  <label for="guest-city" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Ciudad</label>
                  <input id="guest-city" v-model="form.city" type="text" name="city" class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('city')" data-field="city" :aria-invalid="!!errorOf('city')" @blur="touchField('city')" />
                  <p v-if="errorOf('city')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('city') }}</p>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="guest-province" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Provincia</label>
                  <input id="guest-province" v-model="form.province" type="text" name="province" class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('province')" data-field="province" :aria-invalid="!!errorOf('province')" @blur="touchField('province')" />
                  <p v-if="errorOf('province')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('province') }}</p>
                </div>
                <div>
                  <label for="guest-profession" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Profesión</label>
                  <input id="guest-profession" v-model="form.profession" type="text" name="profession" placeholder="Médico, ingeniero..." class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('profession')" data-field="profession" :aria-invalid="!!errorOf('profession')" @blur="touchField('profession')" />
                  <p v-if="errorOf('profession')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('profession') }}</p>
                </div>
              </div>
              <div>
                <label for="guest-language" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Idioma</label>
                <select id="guest-language" v-model="form.language" name="language" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
                  <option value="">Sin preferencia</option>
                  <option v-for="l in LANGUAGES" :key="l.v" :value="l.v">{{ l.l }}</option>
                </select>
              </div>
            </template>

            <!-- Paso 3: Fidelización y Emergencia -->
            <template v-if="formStep === 3">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="guest-tier" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Tier (fidelización)</label>
                  <select id="guest-tier" v-model="form.tier" name="tier" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
                    <option value="">Sin tier</option>
                    <option value="bronze">Bronce</option>
                    <option value="silver">Plata</option>
                    <option value="gold">Oro</option>
                    <option value="platinum">Platino</option>
                  </select>
                </div>
                <div>
                  <label for="guest-loyalty-points" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Puntos de Fidelización</label>
                  <input id="guest-loyalty-points" v-model.number="form.loyaltyPoints" type="number" name="loyaltyPoints" min="0" class="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-navy" :class="fieldClass('loyaltyPoints')" data-field="loyaltyPoints" :aria-invalid="!!errorOf('loyaltyPoints')" @blur="touchField('loyaltyPoints')" />
                  <p v-if="errorOf('loyaltyPoints')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('loyaltyPoints') }}</p>
                </div>
              </div>
              <div>
                <label id="guest-emergency-label" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Contacto de Emergencia</label>
                <div class="grid grid-cols-2 gap-3" role="group" aria-labelledby="guest-emergency-label">
                  <input id="guest-emergency-name" v-model="form.emergencyContact.name" type="text" name="emergencyContactName" placeholder="Nombre" aria-label="Nombre del contacto de emergencia" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
                  <PhoneInput v-model="form.emergencyContact.phone" :country="form.country" placeholder="Teléfono" />
                  <input id="guest-emergency-relation" v-model="form.emergencyContact.relation" type="text" name="emergencyContactRelation" placeholder="Relación (esposa, hijo...)" aria-label="Relación con el contacto de emergencia" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
                  <input id="guest-emergency-email" v-model="form.emergencyContact.email" type="email" name="emergencyContactEmail" placeholder="Email" aria-label="Email del contacto de emergencia" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
                </div>
              </div>
            </template>

            <!-- Paso 4: Preferencias y Notas -->
            <template v-if="formStep === 4">
              <div>
                <label class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Preferencias</label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="pref in allPreferences"
                    :key="pref"
                    @click="togglePreference(pref)"
                    class="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors cursor-pointer"
                    :class="form.preferences.includes(pref) ? 'bg-navy border-navy text-white' : 'border-border text-text-secondary hover:border-navy/30'"
                  >
                    {{ pref }}
                  </button>
                </div>
              </div>
              <div>
                <label for="guest-notes" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Notas</label>
                <textarea id="guest-notes" v-model="form.notes" name="notes" rows="3" placeholder="Alergias, solicitudes especiales, etc." class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy resize-none"></textarea>
              </div>
            </template>
          </div>

      <template #footer>
        <button v-if="formStep === 1" @click="closeFormModal" class="mr-auto px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">
          Cancelar
        </button>
        <button v-else @click="prevFormStep" class="mr-auto inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">
          <span class="h-4 w-4" v-html="UI_ICON.arrowLeft"></span> Atrás
        </button>
        <button v-if="formStep < FORM_STEPS.length" @click="nextFormStep"
          class="inline-flex items-center gap-1.5 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
          Siguiente <span class="h-4 w-4" v-html="UI_ICON.arrowRight"></span>
        </button>
        <button v-else @click="saveGuest"
          class="inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
          <span class="h-4 w-4" v-html="UI_ICON.check"></span>
          {{ editingGuest ? 'Guardar cambios' : 'Crear huésped' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { validateField, validateAll, type FieldRule } from '@/composables/useFieldValidation'
import { GuestService } from '@/services/Guest.service'
import { ReservationService } from '@/services/Reservation.service'
import { CrmService } from '@/services/Crm.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useApiError } from '@/composables/useApiError'
import SearchSelect from '@/components/ui/SearchSelect.vue'
import PhoneInput from '@/components/ui/PhoneInput.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import AppModal from '@/components/ui/AppModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { COUNTRIES, NATIONALITIES, LANGUAGES, DOC_TYPES, nationalityToCountryName, countryNameToNationality } from '@/data/locales'

const auth = useAuthStore()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { handle } = useApiError()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"/></svg>'
const ICON_EYE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_PENCIL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v4.75A2 2 0 0 1 17.5 21h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h4.75"/></svg>'
// Iconografía del modal de perfil (stroke, hereda color y tamaño del contenedor).
const UI_ICON: Record<string, string> = {
  bed: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M6 9V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/></svg>',
  money: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  coins: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M15.5 4.2a6 6 0 0 1 0 15.6M9 6v6l3 2"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6Z"/><path d="M13 5v14"/></svg>',
  user: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  mail: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  id: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M15 10h4M15 14h3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
  note: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16.9 4.5 1.7-1.7a1.9 1.9 0 0 1 2.6 2.6L19.5 7.1M16.9 4.5 6.6 14.8a4.5 4.5 0 0 0-1.1 1.9L4.7 19.3l2.6-.8a4.5 4.5 0 0 0 1.9-1.1L19.5 7.1M16.9 4.5 19.5 7.1"/></svg>',
  award: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="m8.2 13.9-1.4 7 5.2-3 5.2 3-1.4-7"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
  arrowLeft: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
}

const ICON_USERS_EMPTY ='<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'

// Umbrales de segmentación de clientes (VIP por gasto, Frecuente por estadías)
const VIP_SPEND_THRESHOLD = 5000
const FREQUENT_STAYS_THRESHOLD = 5
// Cliente "reciente" si volvió en los últimos N días (color del detalle)
const RECENT_VISIT_DAYS = 90
// Límites de fetch/display (no son de negocio: paginación + top-N en el modal)
const RESV_FETCH_LIMIT = 100
const DETAIL_HISTORY_LIMIT = 10
const PAGE_SIZE = 10

const searchQuery = ref('')
const filterType = ref('all')
const currentPage = ref(1)
const showViewModal = ref(false)
const showFormModal = ref(false)
const viewGuest = ref<any>(null)
const editingGuest = ref<any>(null)

const formStep = ref(1)
// `label` describe el paso en el encabezado; `short` es el del stepper, donde un
// texto largo se parte en dos líneas y descuadra la fila de pasos.
const FORM_STEPS = [
  { n: 1, label: 'Datos Personales', short: 'Datos' },
  { n: 2, label: 'Dirección y Profesión', short: 'Dirección' },
  { n: 3, label: 'Fidelización y Emergencia', short: 'Fidelización' },
  { n: 4, label: 'Preferencias y Notas', short: 'Preferencias' },
]

function nextFormStep() {
  const bad = validateStep(formStep.value)
  if (bad.length) {
    toast.warning(bad.length === 1 ? fieldErrors.value[bad[0]!]! : 'Revisá los campos marcados en rojo')
    return
  }
  formStep.value = Math.min(formStep.value + 1, FORM_STEPS.length)
}

function prevFormStep() {
  formStep.value = Math.max(formStep.value - 1, 1)
}

// El stepper permite volver a un paso ya visitado, nunca saltear hacia adelante
// (el paso 1 valida nombre/email antes de dejar avanzar).
function goToStep(n: number) {
  if (n <= formStep.value) formStep.value = n
}

const form = ref({
  name: '',
  email: '',
  phone: '',
  nationality: '',
  document: '',
  documentType: '',
  documentIssueDate: '',
  birthDate: '',
  sex: '',
  language: '',
  country: '',
  address: '',
  city: '',
  province: '',
  loyaltyPoints: 0,
  tier: '',
  profession: '',
  emergencyContact: { name: '', phone: '', relation: '', email: '' },
  preferences: [] as string[],
  notes: '',
})

const allPreferences = ['Habitación silenciosa', 'Piso alto', 'Vista al mar', 'Cama king', 'Almohadas extras', 'Sin gluten', 'Vegetariano', 'Business center', 'Gimnasio', 'Piscina']

// País y nacionalidad se sincronizan entre sí mientras ninguno de los dos haya sido
// elegido a mano: el primero que el usuario complete propone el otro (mismo dato en
// COUNTRY_DATA), pero apenas toca el campo restante, ese campo queda "suyo" y deja de
// seguir al otro — evita que un huésped con nacionalidad ≠ país de residencia (caso
// común) se vea forzado a coincidir. `formReady` evita que la carga programática
// (nuevo/editar) dispare el sync como si fuera el usuario.
let syncingPaisNacionalidad = false
const formReady = ref(false)
const countryTouched = ref(false)
const nationalityTouched = ref(false)
watch(() => form.value.country, (val) => {
  if (!formReady.value) return
  if (syncingPaisNacionalidad) { syncingPaisNacionalidad = false; return }
  countryTouched.value = true
  if (nationalityTouched.value || !val) return
  const mapped = countryNameToNationality(val)
  if (mapped && mapped !== form.value.nationality) {
    syncingPaisNacionalidad = true
    form.value.nationality = mapped
  }
})
watch(() => form.value.nationality, (val) => {
  if (!formReady.value) return
  if (syncingPaisNacionalidad) { syncingPaisNacionalidad = false; return }
  nationalityTouched.value = true
  if (countryTouched.value || !val) return
  const mapped = nationalityToCountryName(val)
  if (mapped && mapped !== form.value.country) {
    syncingPaisNacionalidad = true
    form.value.country = mapped
  }
})

// Validación del form de huésped (mismo composable que settings). Espeja
// `huespedes/validators/schema.ts`: name required min 2 / max 200; el resto opcional.
// El backend no exige formato de email, pero acá se valida por UX antes del submit.
const GUEST_RULES: Record<string, FieldRule> = {
  name: { label: 'Nombre completo', required: true, min: 2, max: 200 },
  email: { label: 'Email', required: true, type: 'email', max: 200 },
  phone: { label: 'Teléfono', max: 30 },
  document: { label: 'Documento', max: 50 },
  address: { label: 'Dirección', max: 200 },
  city: { label: 'Ciudad', max: 100 },
  province: { label: 'Provincia', max: 100 },
  profession: { label: 'Profesión', max: 100 },
  loyaltyPoints: { label: 'Puntos de fidelización', type: 'number', minValue: 0 },
}

// En qué paso del wizard vive cada campo — para llevar al usuario hasta el error.
const STEP_FIELDS: Record<number, string[]> = {
  1: ['name', 'email', 'phone', 'document'],
  2: ['address', 'city', 'province', 'profession'],
  3: ['loyaltyPoints'],
  4: [],
}
const FIELD_STEP: Record<string, number> = {
  name: 1, email: 1, phone: 1, document: 1,
  address: 2, city: 2, province: 2, profession: 2,
  loyaltyPoints: 3,
}

// Un campo sólo muestra su error después de que el usuario pasó por él (o al intentar guardar).
const fieldErrors = ref<Record<string, string>>({})
const touchedFields = ref<Set<string>>(new Set())

/** Valida un campo al salir de él. Se llama desde @blur. */
function touchField(field: string) {
  touchedFields.value = new Set(touchedFields.value).add(field)
  const rule = GUEST_RULES[field]
  if (!rule) return
  const msg = validateField((form.value as Record<string, unknown>)[field], rule)
  const next = { ...fieldErrors.value }
  if (msg) next[field] = msg
  else delete next[field]
  fieldErrors.value = next
}

/** Mensaje a mostrar bajo el campo: sólo si ya fue tocado. */
function errorOf(field: string): string {
  return touchedFields.value.has(field) ? (fieldErrors.value[field] ?? '') : ''
}

/** Clase del input: borde rojo cuando el campo tiene error visible. */
function fieldClass(field: string): string {
  return errorOf(field) ? 'border-danger' : 'border-border'
}

/** Revalida los campos de un paso; devuelve los que fallan y los marca tocados. */
function validateStep(step: number): string[] {
  const fields = STEP_FIELDS[step] ?? []
  const next = { ...fieldErrors.value }
  const bad: string[] = []
  for (const f of fields) {
    const rule = GUEST_RULES[f]
    if (!rule) continue
    const msg = validateField((form.value as Record<string, unknown>)[f], rule)
    if (msg) { next[f] = msg; bad.push(f) }
    else delete next[f]
  }
  fieldErrors.value = next
  touchedFields.value = new Set([...touchedFields.value, ...fields])
  return bad
}

function resetValidation() {
  fieldErrors.value = {}
  touchedFields.value = new Set()
}

function initialsOf(name?: string): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

const guests = ref<any[]>([])
const reservationsCache = ref<any[]>([])

const MS_PER_DAY = 86_400_000

function fmtDate(iso?: string | Date): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso).slice(0, 10) // fallback: truncar ISO a YYYY-MM-DD
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

function nightsBetween(checkIn?: string | Date, checkOut?: string | Date): number {
  if (!checkIn || !checkOut) return 0
  const n = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / MS_PER_DAY)
  return n > 0 ? n : 0
}

function daysSince(iso?: string | Date): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / MS_PER_DAY))
}

// ¿Reserva con huésped hospedado hoy (checkIn ≤ hoy ≤ checkOut, status checked_in)?
function isActiveNow(r: any): boolean {
  if (r.status !== 'checked_in') return false
  const now = Date.now()
  const ci = new Date(r.checkIn).getTime()
  const co = new Date(r.checkOut).getTime()
  return now >= ci && now <= co
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente', confirmed: 'Confirmada', checked_in: 'En curso',
  checked_out: 'Completada', cancelled: 'Cancelada', no_show: 'No-show',
}
const STATUS_BADGES: Record<string, string> = {
  checked_out: 'bg-teal/10 text-teal',
  checked_in: 'bg-cyan/10 text-cyan',
  confirmed: 'bg-navy/10 text-navy',
  pending: 'bg-gold/10 text-gold',
  cancelled: 'bg-gold/10 text-gold',
  no_show: 'bg-gold/10 text-gold',
}
const stayLabel = (s: string): string => STATUS_LABELS[s] ?? s
const stayBadgeClass = (s: string): string => STATUS_BADGES[s] ?? 'bg-surface text-text-secondary'

// Labels de opciones de datos personales (mismos valores que el form y que reservations/index.vue).
const SEX_LABELS: Record<string, string> = { male: 'Masculino', female: 'Femenino', other: 'Otro' }
const sexLabel = (v?: string): string => (v && SEX_LABELS[v]) || '—'
const docTypeLabel = (v?: string): string => DOC_TYPES.find(d => d.v === v)?.l ?? (v || '—')

// Mapea un guest del backend a la fila de tabla, enriquecida con su última visita
// y si está hospedado hoy (cruzando contra las reservas del hotel ya cargadas).
function mapGuestRow(g: any) {
  const gResv = reservationsCache.value.filter((r: any) => r.guestId === g.id && r.status !== 'cancelled')
  const counted = gResv.filter((r: any) => r.status === 'checked_out' || r.status === 'checked_in')
  const lastVisitIso = counted.length ? counted.map((r: any) => r.checkOut).filter(Boolean).sort().reverse()[0] : ''
  return {
    id: g.id,
    name: g.name ?? '',
    initials: initialsOf(g.name),
    email: g.email ?? '',
    phone: g.phone ?? '',
    nationality: g.nationality ?? '',
    document: g.document ?? '',
    birthDate: g.birthDate ?? '',
    stays: g.totalStays,
    totalSpent: g.totalSpent,
    points: g.loyaltyPoints,
    lastVisit: lastVisitIso ? fmtDate(lastVisitIso) : '',
    preferences: g.preferences ?? [],
    notes: g.notes ?? '',
    language: g.language ?? '',
    loyaltyPoints: g.loyaltyPoints ?? 0,
    tier: g.tier ?? '',
    sex: g.sex ?? '',
    country: g.country ?? '',
    address: g.address ?? '',
    city: g.city ?? '',
    province: g.province ?? '',
    documentType: g.documentType ?? '',
    documentIssueDate: g.documentIssueDate ?? '',
    profession: g.profession ?? '',
    emergencyContact: g.emergencyContact ?? { name: '', phone: '', relation: '', email: '' },
    isActiveToday: gResv.some(isActiveNow),
    history: [],
  }
}

// Carga guests + reservas del hotel (limit 100) en paralelo; 1 sola llamada de reservas
// sirve para derivar lastVisit y activeToday por fila (sin N+1).
const loading = ref(true)

async function loadGuests() {
  loading.value = true
  try {
    const [{ guests: data }, resResult] = await Promise.all([
      GuestService.list({ hotelId: hotelId.value }),
      ReservationService.list({ hotelId: hotelId.value, limit: RESV_FETCH_LIMIT }).catch(() => ({ reservations: [], total: 0 })),
    ])
    reservationsCache.value = resResult.reservations
    guests.value = data.map(mapGuestRow)
  } catch { toast.error("Error al cargar datos") }
  finally { loading.value = false }
}

// Filtro por segmento desde el CRM (`/panel/guests?segment=<id>`, spec crm-segments).
const activeSegment = ref<{ id: string; name: string } | null>(null)
const segmentGuestIds = ref<Set<string> | null>(null)

onMounted(async () => {
  const segId = route.query.segment
  if (typeof segId === 'string' && segId) {
    try {
      const members = await CrmService.getGuestsInSegment(segId)
      segmentGuestIds.value = new Set(members.map((m) => m.id))
      const segs = await CrmService.listSegments().catch(() => [])
      activeSegment.value = { id: segId, name: segs.find((x) => x.id === segId)?.name ?? 'Segmento' }
    } catch { /* sin datos del segmento: la lista queda sin filtro */ }
  }
  await loadGuests()
})

function clearSegmentFilter() {
  activeSegment.value = null
  segmentGuestIds.value = null
  router.replace({ query: { ...route.query, segment: undefined } })
}

const activeToday = computed(() => guests.value.filter((g: any) => g.isActiveToday).length)
const frequentGuests = computed(() => guests.value.filter((g: any) => g.stays >= FREQUENT_STAYS_THRESHOLD).length)
const totalPoints = computed(() => guests.value.reduce((sum: number, g: any) => sum + (g.points ?? 0), 0))
const totalGuestsCount = computed(() => guests.value.length)
const newGuestsCount = computed(() => guests.value.filter((g: any) => g.stays <= 1).length)
const vipGuestsCount = computed(() => guests.value.filter((g: any) => g.totalSpent >= VIP_SPEND_THRESHOLD).length)
// % de la cartera que ya es cliente frecuente — alimenta el anillo del KPI.
const frequentShare = computed(() => totalGuestsCount.value ? Math.round((frequentGuests.value / totalGuestsCount.value) * 100) : 0)

// La animación de los números la hace KpiHeroCard internamente (useCountUp propio).

const filteredGuests = computed(() => {
  let result = guests.value

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.email.toLowerCase().includes(q) ||
      g.phone.includes(q)
    )
  }

  if (filterType.value === 'frequent') result = result.filter(g => g.stays >= FREQUENT_STAYS_THRESHOLD)
  else if (filterType.value === 'new') result = result.filter(g => g.stays <= 1)
  else if (filterType.value === 'vip') result = result.filter(g => g.totalSpent >= VIP_SPEND_THRESHOLD)

  return result
})

// Paginación de la vista (client-side) sobre el resultado filtrado.
const totalFiltered = computed(() => segmentedGuests.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalFiltered.value / PAGE_SIZE)))
const segmentedGuests = computed(() => {
  if (!segmentGuestIds.value) return filteredGuests.value
  return filteredGuests.value.filter((g: any) => segmentGuestIds.value!.has(g.id))
})

const paginatedGuests = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return segmentedGuests.value.slice(start, start + PAGE_SIZE)
})

// Al buscar o cambiar de filtro, volver a la primera página; clampear si el universo se reduce (p.ej. tras borrar).
watch([searchQuery, filterType], () => { currentPage.value = 1 })
watch(totalPages, (tp) => { if (currentPage.value > tp) currentPage.value = tp })

function goToPage(n: number) {
  currentPage.value = Math.min(Math.max(1, n), totalPages.value)
}

function guestAvatarClass(guest: any) {
  if (guest.totalSpent >= VIP_SPEND_THRESHOLD) return 'bg-gold/10 text-gold'
  if (guest.stays >= FREQUENT_STAYS_THRESHOLD) return 'bg-teal/10 text-teal'
  return 'bg-navy/10 text-navy'
}

// Segmento visible en la fila: mismos umbrales que los filtros del listado,
// para que el badge y el desplegable nunca digan cosas distintas.
function segmentOf(guest: any): { label: string; class: string } {
  if (guest.totalSpent >= VIP_SPEND_THRESHOLD) return { label: 'VIP', class: 'bg-gold/10 text-gold' }
  if (guest.stays >= FREQUENT_STAYS_THRESHOLD) return { label: 'Frecuente', class: 'bg-teal/10 text-teal' }
  if (guest.stays <= 1) return { label: 'Nuevo', class: 'bg-cyan/10 text-cyan' }
  return { label: 'Regular', class: 'bg-surface text-text-muted' }
}

// Contacto compacto para pantallas chicas, donde la columna Contacto está oculta.
// Devuelve '' si el huésped no tiene ninguno — así la línea no se renderiza.
function contactOf(guest: any): string {
  return guest.email || guest.phone || ''
}

function clearFilters() {
  searchQuery.value = ''
  filterType.value = 'all'
}

const TIER_META: Record<string, { label: string; color: string }> = {
  bronze: { label: 'Bronce', color: 'text-text-secondary' },
  silver: { label: 'Plata', color: 'text-text-muted' },
  gold: { label: 'Oro', color: 'text-gold' },
  platinum: { label: 'Platino', color: 'text-cyan' },
}

const viewGuestTier = computed(() => {
  if (!viewGuest.value) return { label: '', color: '' }
  // tier real persistido en el guest; si no hay, se infiere por gasto/estadías
  const t = viewGuest.value.tier
  if (t && TIER_META[t]) return TIER_META[t]
  if (viewGuest.value.totalSpent >= VIP_SPEND_THRESHOLD) return { label: 'VIP', color: 'text-gold' }
  if (viewGuest.value.stays >= FREQUENT_STAYS_THRESHOLD) return { label: 'Frecuente', color: 'text-teal' }
  return { label: 'Regular', color: 'text-navy' }
})

// Franja superior del modal: las 4 cifras que resumen al cliente.
const viewGuestMetrics = computed(() => {
  const g = viewGuest.value
  if (!g) return []
  return [
    { label: 'Estadías', value: String(g.stays ?? 0), icon: 'bed', iconClass: 'bg-navy/10 text-navy', valueClass: 'text-navy' },
    { label: 'Total gastado', value: `$${(g.totalSpent ?? 0).toLocaleString()}`, icon: 'money', iconClass: 'bg-teal/10 text-teal', valueClass: 'text-teal' },
    { label: 'Puntos', value: (g.points ?? 0).toLocaleString(), icon: 'coins', iconClass: 'bg-gold/10 text-gold', valueClass: 'text-gold' },
    { label: 'Ticket promedio', value: g.sales ? `$${g.sales.avgPerStay.toLocaleString()}` : '—', icon: 'ticket', iconClass: 'bg-cyan/10 text-cyan', valueClass: 'text-cyan' },
  ]
})

// Ficha del cliente declarada como datos: el template sólo itera. Cada sección
// se omite si no aporta nada (emergencia sin cargar no dibuja una tarjeta vacía).
const viewGuestSections = computed(() => {
  const g = viewGuest.value
  if (!g) return []
  const dash = (v: any) => (v === 0 || v ? String(v) : '—')
  const address = [g.address, g.city, g.province].filter(Boolean).join(', ')
  const ec = g.emergencyContact ?? {}

  const sections: { title: string; icon: string; fields: { label: string; value: string; wide?: boolean; tone?: string }[] }[] = [
    {
      title: 'Contacto', icon: 'mail', fields: [
        { label: 'Email', value: dash(g.email) },
        { label: 'Teléfono', value: dash(g.phone) },
        { label: 'Idioma', value: dash(g.language) },
        { label: 'Nacionalidad', value: dash(g.nationality) },
      ],
    },
    {
      title: 'Documentación', icon: 'id', fields: [
        { label: 'Documento', value: dash(g.document) },
        { label: 'Tipo', value: docTypeLabel(g.documentType) },
        { label: 'Expedición', value: g.documentIssueDate ? fmtDate(g.documentIssueDate) : '—' },
        { label: 'Nacimiento', value: g.birthDate ? fmtDate(g.birthDate) : '—' },
        { label: 'Sexo', value: sexLabel(g.sex) },
        { label: 'Profesión', value: dash(g.profession) },
      ],
    },
    {
      title: 'Dirección', icon: 'pin', fields: [
        { label: 'Domicilio', value: address || '—', wide: true },
        { label: 'País', value: dash(g.country) },
      ],
    },
    {
      title: 'Valor del cliente', icon: 'chart', fields: [
        { label: 'Reservas', value: g.sales ? String(g.sales.reservationsCount) : '—' },
        { label: 'Facturado', value: g.sales ? `$${g.sales.totalResvSpent.toLocaleString()}` : '—' },
        { label: 'Primera visita', value: g.sales ? fmtDate(g.sales.firstVisit) : '—' },
        { label: 'Última visita', value: g.sales ? fmtDate(g.sales.lastVisit) : '—' },
        // Verde si volvió dentro de la ventana de "cliente reciente".
        {
          label: 'Días desde la última',
          value: g.sales?.daysSinceLastVisit != null ? String(g.sales.daysSinceLastVisit) : '—',
          tone: g.sales?.daysSinceLastVisit != null && g.sales.daysSinceLastVisit <= RECENT_VISIT_DAYS ? 'text-teal' : '',
        },
      ],
    },
  ]

  if (ec.name || ec.phone || ec.email) {
    sections.push({
      title: 'Contacto de emergencia', icon: 'shield', fields: [
        { label: 'Nombre', value: dash(ec.name) },
        { label: 'Teléfono', value: dash(ec.phone) },
        { label: 'Relación', value: dash(ec.relation) },
        { label: 'Email', value: dash(ec.email) },
      ],
    })
  }

  // Los campos sin dato no se pintan: un perfil incompleto mostraba secciones
  // enteras de guiones que estiraban la ficha y no decían nada. La sección
  // sobrevive vacía a propósito (avisa que el dato falta) pero ocupa una línea.
  return sections.map(s => ({ ...s, fields: s.fields.filter(f => f.value !== '—') }))
})

// Punto de la línea de tiempo: mismo código de color que el badge de estado.
const STAY_DOTS: Record<string, string> = {
  checked_out: 'bg-teal', checked_in: 'bg-cyan', confirmed: 'bg-navy',
  pending: 'bg-gold', cancelled: 'bg-gold', no_show: 'bg-gold',
}
const stayDotClass = (s: string): string => STAY_DOTS[s] ?? 'bg-border'

async function openViewGuest(guest: any) {
  // Abre el modal con placeholders y carga reservas + historial de puntos en paralelo.
  viewGuest.value = { ...guest, history: [], pointsHistory: [], sales: null, loadingDetail: true }
  showViewModal.value = true
  try {
    const [{ reservations }, pointsHistory] = await Promise.all([
      ReservationService.list({ guestId: guest.id, hotelId: hotelId.value, limit: RESV_FETCH_LIMIT }),
      CrmService.getPointsHistory(guest.id).catch(() => []),
    ])
    const stays = reservations
      .filter(r => r.status !== 'cancelled')
      .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())
    const counted = stays.filter(r => r.status === 'checked_out' || r.status === 'checked_in')
    const firstVisit = stays.length ? stays[stays.length - 1].checkIn : ''
    const lastVisit = counted.length ? counted[0].checkOut : (stays[0]?.checkOut ?? '')
    const totalResvSpent = stays.reduce((s, r) => s + (r.totalAmount ?? 0), 0)
    viewGuest.value = {
      ...viewGuest.value,
      history: stays.slice(0, DETAIL_HISTORY_LIMIT).map(r => ({
        id: r.id,
        dates: `${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}`,
        nights: nightsBetween(r.checkIn, r.checkOut),
        total: (r.totalAmount ?? 0).toLocaleString(),
        status: r.status,
        channel: r.source ?? '',
      })),
      pointsHistory: [...pointsHistory].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, DETAIL_HISTORY_LIMIT),
      sales: {
        reservationsCount: reservations.length,
        avgPerStay: counted.length > 0 ? Math.round(totalResvSpent / counted.length) : 0,
        firstVisit,
        lastVisit,
        daysSinceLastVisit: daysSince(lastVisit),
        totalResvSpent,
      },
      loadingDetail: false,
    }
  } catch {
    viewGuest.value = { ...viewGuest.value, loadingDetail: false }
    toast.error('No se pudieron cargar los detalles del huésped')
  }
}

function closeViewModal() {
  showViewModal.value = false
  viewGuest.value = null
}

const showRedeemModal = ref(false)
const redeemForm = ref({ points: 0, description: '' })
const redeeming = ref(false)
const redeemResult = ref<{ promoCode?: string; discountValue?: number } | null>(null)
const showAwardModal = ref(false)
const awarding = ref(false)
const awardForm = ref({ points: 0, description: '' })

function openAwardModal() {
  awardForm.value = { points: 0, description: '' }
  showAwardModal.value = true
}

function closeRedeemModal() {
  showRedeemModal.value = false
  redeemResult.value = null
}

function copyRedeemCode() {
  if (!redeemResult.value?.promoCode) return
  navigator.clipboard?.writeText(redeemResult.value.promoCode)
  toast.success('Código copiado')
}

/** Otorgamiento manual (T5): compensaciones y ajustes del recepcionista. */
async function awardPoints() {
  if (!viewGuest.value) return
  const points = Number(awardForm.value.points) || 0
  if (points <= 0) { toast.warning('Ingresá una cantidad de puntos válida'); return }
  awarding.value = true
  try {
    await CrmService.awardPoints(viewGuest.value.id, points, awardForm.value.description || 'Ajuste manual')
    toast.success('Puntos otorgados')
    showAwardModal.value = false
    const balance = await CrmService.getPointsBalance(viewGuest.value.id).catch(() => null)
    viewGuest.value = { ...viewGuest.value, points: balance ? balance.balance : (viewGuest.value.points ?? 0) + points }
    await loadGuests()
  } catch (e) {
    handle(e, 'No se pudieron otorgar los puntos')
  } finally {
    awarding.value = false
  }
}

function openRedeemModal() {
  redeemForm.value = { points: 0, description: '' }
  showRedeemModal.value = true
}

async function redeemPoints() {
  if (!viewGuest.value) return
  const points = Number(redeemForm.value.points) || 0
  if (points <= 0) { toast.warning('Ingresá una cantidad de puntos válida'); return }
  redeeming.value = true
  try {
    const res = await CrmService.redeemPoints(viewGuest.value.id, points, redeemForm.value.description || 'Canje manual')
    toast.success('Puntos canjeados')
    if (res?.promoCode) redeemResult.value = { promoCode: res.promoCode, discountValue: res.discountValue }
    else showRedeemModal.value = false
    const [pointsHistory, balance] = await Promise.all([
      CrmService.getPointsHistory(viewGuest.value.id).catch(() => viewGuest.value!.pointsHistory ?? []),
      CrmService.getPointsBalance(viewGuest.value.id).catch(() => null),
    ])
    viewGuest.value = {
      ...viewGuest.value,
      pointsHistory: [...pointsHistory].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, DETAIL_HISTORY_LIMIT),
      points: balance ? balance.balance : viewGuest.value.points,
    }
    await loadGuests()
  } catch (e) {
    handle(e, 'No se pudieron canjear los puntos')
  } finally {
    redeeming.value = false
  }
}

async function openNewGuest() {
  formReady.value = false
  editingGuest.value = null
  form.value = { name: '', email: '', phone: '', nationality: '', document: '', documentType: '', documentIssueDate: '', birthDate: '', sex: '', language: '', country: '', address: '', city: '', province: '', loyaltyPoints: 0, tier: '', profession: '', emergencyContact: { name: '', phone: '', relation: '', email: '' }, preferences: [], notes: '' }
  resetValidation()
  formStep.value = 1
  showFormModal.value = true
  await nextTick()
  countryTouched.value = false
  nationalityTouched.value = false
  formReady.value = true
}

async function openEditGuest(guest: any) {
  formReady.value = false
  editingGuest.value = { id: guest.id }
  form.value = {
    name: guest.name,
    email: guest.email,
    phone: guest.phone,
    nationality: guest.nationality,
    document: guest.document,
    documentType: guest.documentType ?? '',
    documentIssueDate: guest.documentIssueDate ?? '',
    birthDate: guest.birthDate ?? '',
    sex: guest.sex ?? '',
    language: guest.language ?? '',
    country: guest.country ?? '',
    address: guest.address ?? '',
    city: guest.city ?? '',
    province: guest.province ?? '',
    loyaltyPoints: guest.loyaltyPoints ?? 0,
    tier: guest.tier ?? '',
    profession: guest.profession ?? '',
    emergencyContact: { name: guest.emergencyContact?.name ?? '', phone: guest.emergencyContact?.phone ?? '', relation: guest.emergencyContact?.relation ?? '', email: guest.emergencyContact?.email ?? '' },
    preferences: [...(guest.preferences ?? [])],
    notes: guest.notes ?? '',
  }
  resetValidation()
  formStep.value = 1
  showFormModal.value = true
  await nextTick()
  countryTouched.value = false
  nationalityTouched.value = false
  formReady.value = true
}

function closeFormModal() {
  showFormModal.value = false
  editingGuest.value = null
  resetValidation()
}

function togglePreference(pref: string) {
  const idx = form.value.preferences.indexOf(pref)
  if (idx >= 0) form.value.preferences.splice(idx, 1)
  else form.value.preferences.push(pref)
}

async function saveGuest() {
  // Se revalida todo y se marcan los campos: antes sólo se comprobaba nombre/email y cualquier
  // otro problema (email mal escrito, campo demasiado largo) aparecía recién como un 400 genérico.
  touchedFields.value = new Set(Object.keys(GUEST_RULES))
  fieldErrors.value = validateAll(form.value as Record<string, unknown>, GUEST_RULES)
  const bad = Object.keys(fieldErrors.value)
  if (bad.length) {
    const first = bad[0]!
    // Llevar al usuario hasta el problema: el paso del wizard que lo contiene y el foco en el campo.
    const step = FIELD_STEP[first]
    if (step && formStep.value !== step) formStep.value = step
    await nextTick()
    document.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus()
    toast.warning(bad.length === 1
      ? fieldErrors.value[first]!
      : `Hay ${bad.length} campos con errores. Revisá los marcados en rojo.`)
    return
  }

  try {
    if (editingGuest.value) {
      await GuestService.update(editingGuest.value.id, {
        name: form.value.name,
        email: form.value.email,
        phone: form.value.phone,
        nationality: form.value.nationality,
        document: form.value.document,
        documentType: form.value.documentType,
        documentIssueDate: form.value.documentIssueDate,
        birthDate: form.value.birthDate,
        sex: form.value.sex,
        country: form.value.country,
        address: form.value.address,
        city: form.value.city,
        province: form.value.province,
        language: form.value.language,
        loyaltyPoints: Number(form.value.loyaltyPoints) || 0,
        tier: form.value.tier,
        profession: form.value.profession,
        emergencyContact: form.value.emergencyContact,
        preferences: form.value.preferences,
        notes: form.value.notes,
        hotelId: hotelId.value,
      })
      toast.success('Huésped actualizado')
    } else {
      await GuestService.create({
        name: form.value.name,
        email: form.value.email,
        phone: form.value.phone,
        nationality: form.value.nationality,
        document: form.value.document,
        documentType: form.value.documentType,
        documentIssueDate: form.value.documentIssueDate,
        birthDate: form.value.birthDate,
        sex: form.value.sex,
        country: form.value.country,
        address: form.value.address,
        city: form.value.city,
        province: form.value.province,
        language: form.value.language,
        loyaltyPoints: Number(form.value.loyaltyPoints) || 0,
        tier: form.value.tier,
        profession: form.value.profession,
        emergencyContact: form.value.emergencyContact,
        preferences: form.value.preferences,
        notes: form.value.notes,
        hotelId: hotelId.value,
      })
      toast.success('Huésped creado')
    }
    await loadGuests()
    closeFormModal()
  } catch {
    toast.error('Error al guardar huésped')
  }
}
</script>

<style scoped>
/* Las transiciones de entrada/salida ahora las aporta AppModal. */
</style>
