<template>
  <div class="space-y-5">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-black text-navy">Recepción Digital</h1>
        <div class="mt-0.5 flex items-center gap-2.5">
          <p class="text-sm text-text-muted">{{ todayFormatted }}</p>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
      </div>
    </div>

    <!-- KPIs — tarjetas hero del dashboard (gradiente + glow + ícono grande) -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
      <KpiHeroCard v-for="kpi in kpis" :key="kpi.key"
        :label="kpi.label" :value="kpi.value" :icon="kpi.icon" :accent="kpi.accent" />
    </div>

    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div v-for="i in 3" :key="i" class="rounded-[20px] border border-border bg-white p-6 shadow-(--shadow-card) animate-pulse">
          <div class="flex items-start gap-3.5">
            <div class="w-14 h-14 rounded-full bg-surface-dark shrink-0"></div>
            <div class="flex-1 space-y-2 pt-1">
              <div class="h-3 w-20 bg-surface-dark rounded"></div>
              <div class="h-6 w-12 bg-surface-dark rounded"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6 animate-pulse">
        <div class="h-4 w-48 bg-surface-dark rounded mb-3"></div>
        <div class="space-y-2">
          <div v-for="i in 4" :key="i" class="h-10 bg-surface-dark rounded-lg"></div>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6 animate-pulse">
          <div class="h-4 w-32 bg-surface-dark rounded mb-4"></div>
          <div v-for="j in 3" :key="j" class="h-14 bg-surface-dark rounded-xl mb-2"></div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Room Summary -->
      <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-extrabold text-navy">Habitaciones · {{ todayFormatted }}</h2>
          <button @click="showRoomGrid = !showRoomGrid"
            class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-full transition-colors cursor-pointer"
            :class="showRoomGrid ? 'bg-navy text-white' : 'bg-surface text-navy hover:bg-border/30'">
            {{ showRoomGrid ? 'Ocultar' : 'Ver todas' }}
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" :d="showRoomGrid ? 'M4.5 15.75l7.5-7.5 7.5 7.5' : 'M19.5 8.25l-7.5 7.5-7.5-7.5'"/>
            </svg>
          </button>
        </div>

        <!-- Compact summary bars -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div v-for="group in roomGroups" :key="group.key"
            @click="showRoomGrid = true"
            class="flex items-center gap-3 p-3 rounded-xl hover:bg-surface cursor-pointer transition-colors border border-transparent hover:border-border">
            <span class="w-6 h-6 flex items-center justify-center shrink-0 text-navy" v-html="ROOM_ICONS[group.key] || ROOM_ICONS.standard"></span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-bold text-navy">{{ group.label }}</span>
                <span class="text-[11px] font-bold" :class="group.occupiedCount > 0 ? 'text-coral' : 'text-teal'">
                  {{ group.availableCount }} libre{{ group.availableCount !== 1 ? 's' : '' }}
                </span>
              </div>
              <div class="w-full h-1.5 bg-surface-dark rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all" :style="{ width: group.percent + '%' }"
                  :class="group.occupiedCount > 0 ? 'bg-coral' : 'bg-teal'"></div>
              </div>
              <div class="flex justify-between mt-1">
                <span class="text-[11px] text-text-muted">{{ group.rooms.length }} habs</span>
                <span class="text-[11px] text-text-muted">{{ group.occupiedCount }} ocupadas</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Expanding room grid -->
        <div v-if="showRoomGrid" class="mt-5 pt-5 border-t border-border">
          <!-- Legend -->
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mb-6">
            <div v-for="s in ROOM_STATUS_LEGEND" :key="s.status" class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="s.dot"></span>
              <span class="text-[12px] text-text-secondary">{{ s.label }}</span>
            </div>
          </div>

          <div v-for="group in roomGroups" :key="'grid-' + group.key" class="mb-6 last:mb-0">
            <div class="flex items-center gap-2 mb-3">
              <span class="w-4 h-4 flex items-center justify-center text-text-muted" v-html="ROOM_ICONS[group.key] || ROOM_ICONS.standard"></span>
              <span class="text-xs font-black text-text-muted uppercase tracking-wider">{{ group.label }}</span>
              <span class="text-xs text-text-muted">({{ group.rooms.length }})</span>
            </div>
            <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(128px, 1fr))">
              <div v-for="room in group.rooms" :key="room.id"
                @click.stop="selectRoom(room)"
                class="p-3.5 rounded-xl border bg-white cursor-pointer transition-all hover:shadow-md"
                :class="[roomCardClass(room), selectedRoom?.id === room.id ? 'ring-2 ring-navy/25' : '']">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-black text-navy">{{ room.number }}</span>
                  <span class="w-2 h-2 rounded-full shrink-0" :class="roomDotClass(room)"></span>
                </div>
                <div class="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">{{ roomTypeLabel(room.type) }}</div>
                <div v-if="room.guestName" class="text-xs font-bold text-navy truncate">{{ room.guestName.split(' ')[0] }}</div>
                <div v-else class="text-[11px] font-semibold" :class="roomNumberClass(room)">{{ roomStatusLabel(room) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3 Columns -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Arrivals Today -->
        <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-gold/10 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H4.5"/>
                </svg>
              </div>
              <h2 class="text-base font-extrabold text-navy">Llegadas Hoy</h2>
            </div>
            <span class="text-xs font-bold text-gold bg-gold/10 px-2.5 py-1 rounded-full">{{ arrivals.length }}</span>
          </div>
          <div v-if="arrivals.length === 0" class="flex flex-col items-center gap-1.5 py-8 text-text-muted">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5"/>
            </svg>
            <span class="text-xs">Sin llegadas hoy</span>
          </div>
          <div v-for="a in arrivals" :key="a.id" data-testid="arrival-row"
            class="flex items-center gap-3 p-3 rounded-xl mb-2 transition-colors border"
            :class="a.checkedIn ? 'bg-teal/5 border-teal/15' : 'bg-surface hover:bg-gold/5 cursor-pointer border-transparent hover:border-border'"
            @click="!a.checkedIn && openCheckinModal(a)">
            <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shrink-0" :class="a.channelColor">{{ a.initials }}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm font-bold text-navy truncate">{{ a.guestName }}</span>
                <span v-if="a.notes" data-testid="arrival-notes-flag" :title="a.notes"
                  class="shrink-0 w-4 h-4 rounded-full bg-gold/15 text-gold flex items-center justify-center">
                  <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>
                </span>
              </div>
              <div class="text-[10px] text-text-muted">Hab {{ a.roomNumber }} · {{ a.channelLabel }}</div>
              <div class="text-[10px] text-text-muted">{{ a.checkIn }} → {{ a.checkOut }} · {{ a.nights }}n · ${{ a.totalAmount }}</div>
            </div>
            <button v-if="!a.checkedIn" data-testid="checkin-arrival-button" @click.stop="openCheckinModal(a)" :disabled="processing"
              class="shrink-0 px-3 py-1.5 bg-teal text-white text-[10px] font-bold rounded-full hover:bg-teal/80 transition-colors cursor-pointer disabled:opacity-50">
              Check-in
            </button>
            <span v-else class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-teal">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
              Hecho
            </span>
          </div>
        </div>

        <!-- In House -->
        <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-teal/10 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 text-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>
                </svg>
              </div>
              <h2 class="text-base font-extrabold text-navy">En Casa</h2>
            </div>
            <span class="text-xs font-bold text-teal bg-teal/10 px-2.5 py-1 rounded-full">{{ inHouseList.length }}</span>
          </div>
          <div v-if="inHouseList.length === 0" class="flex flex-col items-center gap-1.5 py-8 text-text-muted">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/>
            </svg>
            <span class="text-xs">Sin huéspedes en casa</span>
          </div>
          <div v-for="g in inHouseList" :key="g.id" data-testid="inhouse-row"
            class="flex items-center gap-3 p-3 rounded-xl mb-2 bg-surface hover:bg-teal/5 cursor-pointer transition-colors border border-transparent hover:border-border"
            @click="openCheckoutModal(g)">
            <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shrink-0" :class="g.channelColor">{{ g.initials }}</div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold text-navy truncate">{{ g.guestName }}</div>
              <div class="text-[10px] text-text-muted">Hab {{ g.roomNumber }} · {{ g.channelLabel }}</div>
              <div class="text-[10px] text-text-muted">Sale: {{ g.checkOut }} · {{ daysUntil(g.checkOut) }}d restantes</div>
            </div>
            <button @click.stop="openCheckoutModal(g)" :disabled="processing" data-testid="checkout-button"
              class="shrink-0 px-3 py-1.5 bg-navy text-white text-[10px] font-bold rounded-full hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
              Check-out
            </button>
          </div>
        </div>

        <!-- Departures Today -->
        <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-coral/10 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 text-coral" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M9 12h12m0 0l-3-3m3 3l-3 3"/>
                </svg>
              </div>
              <h2 class="text-base font-extrabold text-navy">Salidas Hoy</h2>
            </div>
            <span class="text-xs font-bold text-coral bg-coral/10 px-2.5 py-1 rounded-full">{{ departures.length }}</span>
          </div>
          <div v-if="departures.length === 0" class="flex flex-col items-center gap-1.5 py-8 text-text-muted">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M9 12h12"/>
            </svg>
            <span class="text-xs">Sin salidas hoy</span>
          </div>
          <div v-for="d in departures" :key="d.id" data-testid="departure-row"
            class="flex items-center gap-3 p-3 rounded-xl mb-2 transition-colors border"
            :class="d.checkedOut ? 'bg-surface border-border/40' : 'bg-surface hover:bg-coral/5 cursor-pointer border-transparent hover:border-border'"
            @click="!d.checkedOut && openCheckoutModal(d)">
            <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shrink-0"
              :class="d.checkedOut ? 'bg-surface-dark text-text-muted' : 'bg-coral/10 text-coral'">{{ d.initials }}</div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold truncate" :class="d.checkedOut ? 'text-text-secondary' : 'text-navy'">{{ d.guestName }}</div>
              <div class="text-[10px] text-text-muted">Hab {{ d.roomNumber }} · {{ d.channelLabel }}</div>
            </div>
            <button v-if="!d.checkedOut" @click.stop="openCheckoutModal(d)" :disabled="processing" data-testid="checkout-button"
              class="shrink-0 px-3 py-1.5 bg-coral text-white text-[10px] font-bold rounded-full hover:bg-coral/80 transition-colors cursor-pointer disabled:opacity-50">
              Check-out
            </button>
            <span v-else class="shrink-0 flex items-center gap-1 text-[10px] font-bold text-text-muted">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
              Hecho
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- Room Detail Popover -->
    <Teleport to="body">
      <div v-if="showRoomDetail && selectedRoom" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-navy/30 backdrop-blur-sm"></div>
        <div class="relative bg-white rounded-[20px] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
          <!-- Header -->
          <div class="sticky top-0 bg-white border-b border-border p-6 z-10 rounded-t-[20px]">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl bg-surface flex items-center justify-center text-navy shrink-0">
                  <span class="w-6 h-6" v-html="roomTypeIcon(selectedRoom.type)"></span>
                </div>
                <div>
                  <div class="text-lg font-black text-navy">Hab {{ selectedRoom.number }}</div>
                  <div class="text-xs font-bold text-text-muted uppercase">{{ roomTypeLabel(selectedRoom.type) }}</div>
                </div>
              </div>
              <button @click="closeRoomDetail" class="w-8 h-8 rounded-lg bg-surface flex items-center justify-center hover:bg-border/50 cursor-pointer text-sm shrink-0">✕</button>
            </div>
            <div class="flex items-center gap-2 mt-3">
              <span class="w-2 h-2 rounded-full" :class="roomDotClass(selectedRoom)"></span>
              <span class="text-xs font-bold" :class="roomNumberClass(selectedRoom)">{{ roomStatusLabel(selectedRoom) }}</span>
              <span v-if="selectedRoom.guestName" class="text-[11px] text-text-muted ml-auto">{{ selectedRoom.checkDates }}</span>
            </div>
          </div>

          <!-- Body: layout horizontal — huésped/disponibilidad a la izquierda, specs+amenities a la derecha -->
          <div class="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <!-- ═══ IZQUIERDA: Huésped (ocupada) o estado disponible ═══ -->
            <div class="p-6 bg-surface/30 flex flex-col">
              <!-- Guest info — garantizado si está ocupada -->
              <div v-if="selectedRoom.status === 'occupied'" class="flex-1 flex flex-col">
                <div class="text-[11px] font-bold text-text-muted uppercase mb-3">Huésped</div>
                <div class="flex items-center gap-3">
                  <div class="w-11 h-11 rounded-full bg-navy/10 flex items-center justify-center text-sm font-bold text-navy shrink-0">
                    {{ guestInitials(String(selectedRoomGuest?.guestName || selectedRoom.guestName || '?')) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-base font-bold text-navy truncate">{{ selectedRoomGuest?.guestName || selectedRoom.guestName || 'Sin nombre' }}</div>
                    <div v-if="selectedRoomGuest?.guestEmail || selectedRoom.guestEmail" class="text-xs text-text-muted truncate">{{ selectedRoomGuest?.guestEmail || selectedRoom.guestEmail }}</div>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3 mt-4">
                  <div class="bg-white rounded-xl p-3 text-center">
                    <div class="text-[11px] text-text-muted mb-0.5">Check-in</div>
                    <div class="text-sm font-bold tabular-nums text-navy">{{ String(selectedRoomGuest?.checkIn || selectedRoom.checkIn || '').slice(0, 10) || '—' }}</div>
                  </div>
                  <div class="bg-white rounded-xl p-3 text-center">
                    <div class="text-[11px] text-text-muted mb-0.5">Check-out</div>
                    <div class="text-sm font-bold tabular-nums text-navy">{{ String(selectedRoomGuest?.checkOut || selectedRoom.checkOut || '').slice(0, 10) || '—' }}</div>
                  </div>
                </div>
                <div v-if="selectedRoomNotes" data-testid="room-detail-notes" class="mt-3 bg-gold/8 rounded-xl p-3 border border-gold/20">
                  <div class="text-[11px] font-bold text-gold uppercase tracking-wide mb-1">Notas</div>
                  <div class="text-xs text-navy whitespace-pre-wrap">{{ selectedRoomNotes }}</div>
                </div>
                <div class="flex gap-2 mt-auto pt-4 border-t border-border/60">
                  <button @click="checkoutFromRoom(selectedRoom)" :disabled="processing" class="flex-1 py-2.5 bg-coral text-white text-xs font-bold rounded-xl hover:bg-coral/80 disabled:opacity-50 cursor-pointer">
                    Check-out
                  </button>
                  <button v-if="selectedRoom.resId || selectedRoomGuest?.id" @click="viewReservation((selectedRoom.resId || selectedRoomGuest?.id) as string)" class="flex-1 py-2.5 bg-navy text-white text-xs font-bold rounded-xl hover:bg-navy-light cursor-pointer">
                    Ver Reserva
                  </button>
                </div>
              </div>

              <!-- Empty state for non-occupied -->
              <div v-else class="flex-1 flex flex-col items-center justify-center text-center py-4">
                <div class="w-14 h-14 mx-auto mb-2 rounded-2xl bg-teal/10 grid place-items-center text-teal">
                  <span class="w-7 h-7" v-html="ROOM_ICONS.standard"></span>
                </div>
                <div class="text-sm font-bold text-teal">Disponible</div>
                <div class="text-xs text-text-muted mt-0.5">Sin huésped asignado</div>
              </div>
            </div>

            <!-- ═══ DERECHA: Specs + Amenities ═══ -->
            <div class="p-6 space-y-6">
              <!-- Room specs -->
              <div>
                <div class="text-[11px] font-bold text-text-muted uppercase mb-3">Detalles</div>
                <div class="grid grid-cols-2 gap-3">
                  <div class="bg-surface rounded-xl p-3">
                    <div class="text-[11px] text-text-muted mb-0.5">Piso</div>
                    <div class="text-sm font-bold tabular-nums text-navy">{{ selectedRoom.floor || '—' }}</div>
                  </div>
                  <div class="bg-surface rounded-xl p-3">
                    <div class="text-[11px] text-text-muted mb-0.5">Capacidad</div>
                    <div class="text-sm font-bold tabular-nums text-navy">{{ selectedRoom.capacity || 2 }} pers</div>
                  </div>
                  <div class="bg-surface rounded-xl p-3">
                    <div class="text-[11px] text-text-muted mb-0.5">Baños</div>
                    <div class="text-sm font-bold tabular-nums text-navy">{{ selectedRoom.bathrooms || 1 }}</div>
                  </div>
                  <div class="bg-surface rounded-xl p-3">
                    <div class="text-[11px] text-text-muted mb-0.5">Superficie</div>
                    <div class="text-sm font-bold tabular-nums text-navy">{{ selectedRoom.surfaceArea ? selectedRoom.surfaceArea + ' m²' : '—' }}</div>
                  </div>
                </div>
                <div class="mt-3 bg-surface rounded-xl p-3 flex justify-between items-center">
                  <span class="text-[11px] text-text-muted">Precio base / noche</span>
                  <span class="text-sm font-bold tabular-nums text-teal">${{ selectedRoom.basePrice || 0 }}</span>
                </div>
              </div>

              <!-- Amenities -->
              <div>
                <div class="flex items-center justify-between mb-3">
                  <span class="text-[11px] font-bold text-text-muted uppercase">Amenities</span>
                  <span v-if="loadingAmenities" class="text-xs text-text-muted">cargando...</span>
                </div>
                <div v-if="activeAmenities.length === 0 && !loadingAmenities" class="text-xs text-text-muted text-center py-3">Sin amenities registrados</div>
                <!-- Scroll propio y acotado: con muchos amenities (catálogo tiene ~35) no debe estirar
                     la columna derecha más allá de la izquierda ni empujar los botones de acción fuera de vista. -->
                <div v-else class="flex flex-wrap content-start gap-2 max-h-42 overflow-y-auto pr-1">
                  <span v-for="a in activeAmenities" :key="a.key"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-teal/10 text-teal shrink-0">
                    {{ a.label }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Checkin Modal -->
    <Teleport to="body">
      <div v-if="showCheckinModal && checkinGuest" data-testid="checkin-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-navy/40 backdrop-blur-sm"></div>
        <div class="relative bg-white rounded-[20px] shadow-2xl w-full max-w-md overflow-hidden">
          <div class="p-5 border-b border-border flex items-center justify-between">
            <h3 class="text-lg font-black text-navy">Check-in</h3>
            <button @click="closeCheckinModal" :disabled="processing" class="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-navy hover:bg-surface transition-colors cursor-pointer disabled:opacity-50">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="p-5">
            <div class="flex items-center gap-3 pb-5 border-b border-border">
              <div class="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shrink-0" :class="checkinGuest.channelColor">{{ checkinGuest.initials }}</div>
              <div>
                <div class="text-sm font-bold text-navy">{{ checkinGuest.guestName }}</div>
                <div class="text-[10px] text-text-muted">{{ checkinGuest.guestEmail }}</div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-3 py-5 border-b border-border">
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide">Habitación</div>
                <div class="text-sm font-bold tabular-nums text-navy mt-0.5">{{ checkinGuest.roomNumber }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide">Canal</div>
                <div class="text-sm font-bold text-navy mt-0.5">{{ checkinGuest.channelLabel }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide">Check-in</div>
                <div class="text-sm font-bold tabular-nums text-navy mt-0.5">{{ checkinGuest.checkIn }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide">Check-out</div>
                <div class="text-sm font-bold tabular-nums text-navy mt-0.5">{{ checkinGuest.checkOut }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide">Adultos / Niños</div>
                <div class="text-sm font-bold tabular-nums text-navy mt-0.5">{{ checkinGuest.adults }} / {{ checkinGuest.children }}</div>
              </div>
              <div>
                <div class="text-[10px] text-text-muted uppercase tracking-wide">Total</div>
                <div class="text-sm font-bold tabular-nums text-teal mt-0.5">${{ checkinGuest.totalAmount }}</div>
              </div>
            </div>
            <div v-if="checkinGuest.notes" data-testid="checkin-modal-notes" class="py-4 border-b border-border">
              <div class="flex items-center gap-1.5 text-[10px] font-bold text-gold uppercase tracking-wide mb-1.5">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z"/></svg>
                Notas de la reserva
              </div>
              <div class="text-xs bg-gold/8 rounded-lg p-2.5 border border-gold/20 whitespace-pre-wrap text-navy">{{ checkinGuest.notes }}</div>
            </div>
            <div v-if="processing" class="flex items-center justify-center gap-2 text-xs text-teal font-bold pt-4">
              <span class="inline-block w-3 h-3 border-2 border-teal border-t-transparent rounded-full animate-spin"></span>
              Procesando...
            </div>
          </div>
          <div class="p-5 border-t border-border flex items-center justify-end gap-4">
            <button @click="closeCheckinModal" :disabled="processing" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer disabled:opacity-50">Cancelar</button>
            <button @click="confirmCheckin" data-testid="checkin-confirm-button" :disabled="processing || !isOnline" :title="!isOnline ? 'Sin conexión: no se puede confirmar el check-in' : ''" class="rounded-full bg-teal text-white text-sm font-extrabold px-5 py-2.5 hover:bg-teal-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {{ processing ? 'Procesando...' : 'Confirmar Check-in' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Checkout Modal -->
    <Teleport to="body">
      <div v-if="showCheckoutModal && checkoutGuest" data-testid="checkout-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-navy/40 backdrop-blur-sm"></div>
        <div class="relative bg-white rounded-[20px] shadow-2xl w-full max-w-md overflow-hidden">
          <div class="p-5 border-b border-border flex items-center justify-between">
            <h3 class="text-lg font-black text-navy">Check-out · Hab {{ checkoutGuest.roomNumber }}</h3>
            <button @click="closeCheckoutModal" :disabled="processing" class="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-navy hover:bg-surface transition-colors cursor-pointer disabled:opacity-50">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="p-5">
            <div class="flex items-center gap-3 pb-5 border-b border-border">
              <div class="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shrink-0" :class="checkoutGuest.channelColor">{{ checkoutGuest.initials }}</div>
              <div>
                <div class="text-sm font-bold text-navy">{{ checkoutGuest.guestName }}</div>
                <div class="text-[10px] text-text-muted">{{ checkoutGuest.checkIn }} → {{ checkoutGuest.checkOut }} · {{ checkoutGuest.nights }} noche(s)</div>
              </div>
            </div>

            <!-- Loading folio -->
            <div v-if="folioLoading" class="flex items-center justify-center gap-2 text-xs text-text-muted py-5 border-b border-border">
              <span class="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin"></span>
              Cargando cuenta...
            </div>

            <!-- Folio balance -->
            <div v-else-if="checkoutFolio" class="py-5 border-b border-border">
              <div class="flex justify-between items-center mb-3">
                <span class="text-[10px] text-text-muted uppercase tracking-wide">Cuenta · Folio</span>
                <span class="text-[10px] font-mono text-text-muted">{{ checkoutFolio.id.slice(0, 8) }}</span>
              </div>
              <div class="space-y-2">
                <div class="flex justify-between text-xs">
                  <span class="text-text-muted">Cargos</span>
                  <span class="font-bold tabular-nums text-navy">${{ (checkoutFolio.chargesTotal || 0).toFixed(2) }}</span>
                </div>
                <div class="flex justify-between text-xs">
                  <span class="text-text-muted">Pagos</span>
                  <span class="font-bold tabular-nums text-teal">-${{ (checkoutFolio.paymentsTotal || 0).toFixed(2) }}</span>
                </div>
                <div class="flex justify-between text-sm pt-2 border-t border-border">
                  <span class="font-bold text-navy">Saldo pendiente</span>
                  <span data-testid="checkout-balance" class="font-bold tabular-nums" :class="(checkoutFolio.balance || 0) > 0 ? 'text-coral' : 'text-teal'">
                    ${{ (checkoutFolio.balance || 0).toFixed(2) }}
                  </span>
                </div>
              </div>
              <div v-if="(checkoutFolio.balance || 0) <= 0" class="text-[10px] text-teal font-bold mt-2">✓ Cuenta saldada</div>
            </div>

            <!-- #4 Alta de consumo sobre el folio, sin salir del check-in -->
            <div v-if="checkoutFolio" class="py-4 border-b border-border">
              <button v-if="!showChargeForm" @click="showChargeForm = true" class="text-[11px] font-bold text-teal hover:underline cursor-pointer">+ Agregar consumo</button>
              <div v-else class="space-y-2">
                <label for="checkin-charge-description" class="block text-[10px] text-text-muted uppercase tracking-wide">Nuevo consumo — descripción <span class="text-coral">*</span></label>
                <input id="checkin-charge-description" name="chargeDescription" v-model="chargeForm.description" type="text" required aria-required="true" placeholder="Descripción (ej: Minibar)" class="w-full px-3 py-2 rounded-xl border border-border text-xs" />
                <div class="flex gap-2">
                  <label for="checkin-charge-category" class="sr-only">Categoría del consumo</label>
                  <select id="checkin-charge-category" name="chargeCategory" v-model="chargeForm.category" class="px-3 py-2 rounded-xl border border-border text-xs cursor-pointer">
                    <option value="minibar">Minibar</option>
                    <option value="restaurant">Restaurante</option>
                    <option value="laundry">Lavandería</option>
                    <option value="spa">Spa</option>
                    <option value="service">Servicio</option>
                    <option value="other">Otro</option>
                  </select>
                  <label for="checkin-charge-amount" class="sr-only">Monto del consumo</label>
                  <input id="checkin-charge-amount" name="chargeAmount" v-model.number="chargeForm.amount" type="number" min="0" step="0.01" required aria-required="true" placeholder="Monto" class="flex-1 px-3 py-2 rounded-xl border border-border text-xs" />
                </div>
                <div class="flex gap-2">
                  <button @click="addCharge" :disabled="addingCharge" class="flex-1 py-2 bg-navy text-white text-xs font-bold rounded-xl hover:bg-navy-light disabled:opacity-50 cursor-pointer">{{ addingCharge ? 'Agregando...' : 'Agregar' }}</button>
                  <button @click="resetChargeForm" :disabled="addingCharge" class="py-2 px-3 text-xs font-bold text-text-secondary hover:text-navy cursor-pointer disabled:opacity-50">Cancelar</button>
                </div>
              </div>
            </div>

            <!-- Payment method selection (only if balance > 0) -->
            <div v-if="checkoutFolio && (checkoutFolio.balance || 0) > 0" class="py-5 border-b border-border">
              <div class="text-[10px] text-text-muted uppercase tracking-wide mb-2.5">Método de pago</div>
              <div class="flex flex-wrap gap-2">
                <button v-for="pm in paymentMethods" :key="pm.value"
                  @click="settleMethod = pm.value"
                  :data-testid="'settle-method-' + pm.value"
                  class="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold border transition-all cursor-pointer"
                  :class="settleMethod === pm.value ? 'border-teal bg-teal text-white' : 'border-border text-text-secondary hover:border-teal/30'">
                  <span class="w-3.5 h-3.5 shrink-0" v-html="PAYMENT_ICONS[pm.value]"></span>
                  <span>{{ pm.label }}</span>
                </button>
              </div>
            </div>

            <!-- #5 Guarda de deuda: confirmación explícita si se va con saldo pendiente sin pago -->
            <div v-if="checkoutFolio && (checkoutFolio.balance || 0) > 0 && !settleMethod" class="py-4 border-b border-border">
              <label class="flex items-start gap-2 cursor-pointer">
                <input id="checkout-debt-ack" name="debtAck" type="checkbox" v-model="debtAck" data-testid="checkout-debt-ack" class="mt-0.5 accent-coral" />
                <span class="text-[11px] font-bold text-coral">El huésped se irá con saldo pendiente de ${{ (checkoutFolio.balance || 0).toFixed(2) }}. Confirmo el check-out con deuda.</span>
              </label>
            </div>

            <div class="flex items-start gap-2 pt-5">
              <svg class="w-4 h-4 text-gold shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z"/>
              </svg>
              <div class="text-[10px] font-bold text-gold">La habitación pasará a estado "Sucia" y se creará tarea de limpieza</div>
            </div>

            <div v-if="processing" class="flex items-center justify-center gap-2 text-xs text-coral font-bold pt-4">
              <span class="inline-block w-3 h-3 border-2 border-coral border-t-transparent rounded-full animate-spin"></span>
              Procesando...
            </div>
          </div>
          <div class="p-5 border-t border-border flex items-center justify-end gap-4">
            <button @click="closeCheckoutModal" :disabled="processing" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer disabled:opacity-50">Cancelar</button>
            <button @click="confirmCheckout" data-testid="checkout-confirm-button" :disabled="processing || folioLoading || !isOnline" :title="!isOnline ? 'Sin conexión: no se puede confirmar el check-out' : ''" class="rounded-full bg-coral text-white text-sm font-extrabold px-5 py-2.5 hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {{ processing ? 'Procesando...' : checkoutSettleLabel }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { useRouter } from 'vue-router'
import { useCountUp } from '@/composables/useCountUp'
import { OperationsService } from '@/services/Operations.service'
import { RoomService } from '@/services/Room.service'
import { ReservationService } from '@/services/Reservation.service'
import { FoliosService, type Folio } from '@/services/Folios.service'
import { AmenitiesService } from '@/services/Amenities.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useOnline } from '@/composables/useOnline'
const { isOnline } = useOnline()
import { ApiError } from '@/services/http'
import type { CheckinRoom, CheckinGuest } from '@/types'

const auth = useAuthStore()
const router = useRouter()
const toast = useToast()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const showCheckinModal = ref(false)
const showCheckoutModal = ref(false)
const showRoomDetail = ref(false)
const showRoomGrid = ref(false)
const checkinGuest = ref<CheckinGuest | null>(null)
const checkoutGuest = ref<CheckinGuest | null>(null)
const checkoutFolio = ref<Folio | null>(null)
const folioLoading = ref(false)
const settleMethod = ref<string | null>(null)
const selectedRoom = ref<CheckinRoom | null>(null)
// #5 guarda de deuda: confirmación explícita para cerrar el check-out con saldo pendiente sin pago.
const debtAck = ref(false)
// #4 alta de consumo sobre el folio desde el propio check-out (sin ir a /folios).
const showChargeForm = ref(false)
const addingCharge = ref(false)
const chargeForm = ref<{ description: string; amount: number | null; category: string }>({ description: '', amount: null, category: 'minibar' })

const PAYMENT_ICONS: Record<string, string> = {
  cash: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path stroke-linecap="round" d="M6 9v.01M18 15v.01"/></svg>',
  card: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path stroke-linecap="round" d="M2 10h20"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10 12 3l9 7M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M9 20v-6h6v6"/></svg>',
  deposit: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 3h5.5L18 7.5V21H8V3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M13 3v4.5H18M10.5 12h5M10.5 15.5h5"/></svg>',
}

const paymentMethods = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'deposit', label: 'Depósito' },
]

// Búsqueda directa en reservas para garantizar datos del huésped
const selectedRoomGuest = computed(() => {
  if (!selectedRoom.value?.resId) return null
  return allReservations.value.find(r => r.id === selectedRoom.value!.resId) || null
})
const selectedRoomNotes = computed(() => (selectedRoomGuest.value?.notes as string) || null)
const checkedIn = ref(new Set<string>())
const checkedOut = ref(new Set<string>())
const processing = ref(false)

const rooms = ref<CheckinRoom[]>([])
const allReservations = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const roomAmenities = ref<{ key: string; label: string; active: boolean }[]>([])
const activeAmenities = computed(() => roomAmenities.value.filter(a => a.active))
const loadingAmenities = ref(false)

const today = new Date()
const todayStr = today.toISOString().split('T')[0]
const todayFormatted = today.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

const channelLabels: Record<string, string> = { direct: 'Direct', booking: 'Booking.com', expedia: 'Expedia', airbnb: 'Airbnb', google: 'Google' }
const channelColors: Record<string, string> = { direct: 'bg-teal/10 text-teal', booking: 'bg-cyan/10 text-cyan', expedia: 'bg-gold/10 text-gold', airbnb: 'bg-coral/10 text-coral', google: 'bg-blue/10 text-blue' }

const ROOM_ICONS: Record<string, string> = {
  premium: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m3 8 4 3 5-6 5 6 4-3-2 10H5L3 8Z"/></svg>',
  standard: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M5 13V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>',
  multiple: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72M18 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M18 18.72v-.235a3 3 0 0 0-3-3M6 18.72a9.094 9.094 0 0 1-3.741-.479 3 3 0 0 1 4.682-2.72M6 18.72v-.235a3 3 0 0 1 3-3m3.75-6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>',
  individual: '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M5 21h10M5 21H3m14 0h2M13 12h.01"/></svg>',
}

const roomTypeCategories: Record<string, { key: string; label: string; order: number }> = {
  presidential: { key: 'premium', label: 'Premium', order: 1 },
  deluxe:      { key: 'premium', label: 'Premium', order: 1 },
  suite:       { key: 'premium', label: 'Premium', order: 1 },
  villa:       { key: 'premium', label: 'Premium', order: 1 },
  double:      { key: 'standard', label: 'Dobles / Twin', order: 2 },
  twin:        { key: 'standard', label: 'Dobles / Twin', order: 2 },
  triple:      { key: 'multiple', label: 'Múltiples', order: 3 },
  quad:        { key: 'multiple', label: 'Múltiples', order: 3 },
  family:      { key: 'multiple', label: 'Múltiples', order: 3 },
  single:      { key: 'individual', label: 'Individuales', order: 4 },
  dorm:        { key: 'individual', label: 'Individuales', order: 4 },
}

const roomTypeLabels: Record<string, string> = {
  presidential: 'Presidential', deluxe: 'Deluxe', suite: 'Suite', villa: 'Villa',
  double: 'Doble', twin: 'Twin',
  triple: 'Triple', quad: 'Cuádruple', family: 'Familiar',
  single: 'Single', dorm: 'Dormitorio',
}

function roomTypeIcon(type: string) { return ROOM_ICONS[roomTypeCategories[type]?.key || 'standard'] }
function roomTypeLabel(type: string) { return roomTypeLabels[type] || type }

const roomGroups = computed(() => {
  const inHouseRoomIds = new Set(inHouseList.value.map(g => g.roomId))
  const groups = new Map<string, { key: string; label: string; order: number; rooms: CheckinRoom[]; occupiedCount: number; availableCount: number; percent: number }>()
  for (const room of rooms.value) {
    const cat = roomTypeCategories[room.type] || { key: 'other', label: 'Otras', order: 99 }
    if (!groups.has(cat.key)) {
      groups.set(cat.key, { key: cat.key, label: cat.label, order: cat.order, rooms: [], occupiedCount: 0, availableCount: 0, percent: 0 })
    }
    groups.get(cat.key)!.rooms.push(room)
  }
  for (const group of groups.values()) {
    // Coherente con "En Casa": ocupada = tiene huésped con check-in hecho
    group.occupiedCount = group.rooms.filter(r => inHouseRoomIds.has(r.id)).length
    group.availableCount = group.rooms.filter(r => r.status === 'available').length
    group.percent = group.rooms.length > 0 ? Math.round((group.occupiedCount / group.rooms.length) * 100) : 0
  }
  return [...groups.values()].sort((a, b) => a.order - b.order)
})

async function loadData() {
  loading.value = true
  try {
    const [roomsResult, planningResult] = await Promise.all([
      RoomService.list({ hotelId: hotelId.value }),
      OperationsService.planning(hotelId.value),
    ])

    const roomsData: any[] = roomsResult.rooms || []
    const resData = planningResult.reservas || []
    allReservations.value = resData

    const todayRes = resData.filter((r: Record<string, unknown>) => {
      const ci = String(r.checkIn || '').slice(0, 10)
      const co = String(r.checkOut || '').slice(0, 10)
      return ci <= todayStr && co >= todayStr
    })

    const roomGuestMap = new Map<string, Record<string, unknown>>()
    for (const r of todayRes) {
      const rid = r.roomId as string
      if (!roomGuestMap.has(rid) || String(r.checkIn).slice(0, 10) <= todayStr) {
        roomGuestMap.set(rid, r)
      }
    }

    rooms.value = roomsData.map((r: Record<string, unknown>) => {
      const res = roomGuestMap.get(r.id as string)
      const actualStatus = (r.status as string) || 'available'
      const isCheckedIn = res && (res.status === 'checked_in')
      // Coherencia: solo 'occupied' si hay reserva checked_in real.
      // Si DB dice 'occupied' pero no hay reserva → fantasma → available.
      const roomStatus = isCheckedIn ? 'occupied'
        : (actualStatus === 'occupied' ? 'available' : actualStatus)
      return {
        id: r.id as string,
        number: r.number as string,
        type: r.type as string,
        status: roomStatus as CheckinRoom['status'],
        basePrice: (r.basePrice as number) || 0,
        floor: (r.floor as number) || 0,
        capacity: (r.capacity as number) || 2,
        bathrooms: (r.bathrooms as number) || 1,
        surfaceArea: (r.surfaceArea as number) || 0,
        guestName: (res?.guestName as string) || null,
        channel: (res?.channel as string) || null,
        checkIn: res ? String(res.checkIn).slice(0, 10) : null,
        checkOut: res ? String(res.checkOut).slice(0, 10) : null,
        checkDates: res ? `${String(res.checkIn).slice(0, 10)} → ${String(res.checkOut).slice(0, 10)}` : '',
        guestEmail: (res?.guestEmail as string) || null,
        resId: (res?.id as string) || null,
      }
    })

    if (selectedRoom.value) {
      const updated = rooms.value.find(r => r.id === selectedRoom.value!.id)
      if (updated) selectedRoom.value = updated
    }
  } catch (e) {
    const msg = e instanceof ApiError
      ? `Error del servidor (${e.status})`
      : 'Sin conexión con el servidor'
    toast.error('Error al cargar datos', msg)
  }
  loading.value = false
}

onMounted(loadData)

const amenityLabels: Record<string, string> = {
  // interior
  ac: 'A/C', heating: 'Calefacción', kitchen: 'Cocina', microwave: 'Microondas', fridge: 'Refrigerador',
  coffee_maker: 'Cafetera', washer: 'Lavadora', dishwasher: 'Lavavajillas', tv: 'TV', wifi: 'WiFi',
  safe: 'Caja fuerte', minibar: 'Minibar', hair_dryer: 'Secador', iron: 'Plancha', balcony: 'Balcón',
  bathtub: 'Bañera', work_desk: 'Escritorio',
  // exterior
  pool: 'Piscina', pool_heated: 'Piscina climatizada', parking_free: 'Estacionamiento gratis',
  parking_paid: 'Estacionamiento pago', gym: 'Gimnasio', spa: 'Spa', restaurant: 'Restaurante',
  bar: 'Bar', garden: 'Jardín', terrace: 'Terraza', bbq: 'Parrilla', elevator: 'Ascensor',
  lounge: 'Lounge', kids_playground: 'Juegos infantiles',
  // services
  room_service: 'Room service', laundry: 'Lavandería', concierge: 'Conserjería',
  luggage_storage: 'Guardaequipaje', pets_allowed: 'Admite mascotas', wheelchair_access: 'Acceso silla de ruedas',
}

async function loadRoomAmenities(roomId: string) {
  loadingAmenities.value = true
  try {
    const [catalogResult, roomResult] = await Promise.all([
      AmenitiesService.catalog().catch(() => ({ interior: [], exterior: [], services: [] })),
      AmenitiesService.listRoom(roomId).catch(() => ({ data: [] })),
    ])
    const roomKeys = new Set((roomResult.data || []).map((a: { amenityKey: string }) => a.amenityKey))
    const allAmenities = [
      ...(catalogResult.interior || []),
      ...(catalogResult.exterior || []),
      ...(catalogResult.services || []),
    ]
    roomAmenities.value = allAmenities.map(key => ({
      key, label: amenityLabels[key] || key, active: roomKeys.has(key),
    }))
  } catch (e) {
    roomAmenities.value = []
  }
  loadingAmenities.value = false
}

const arrivals = computed(() =>
  allReservations.value
    .filter((r: Record<string, unknown>) => String(r.checkIn).slice(0, 10) === todayStr && !['checked_in', 'checked_out'].includes(r.status as string))
    .map(mapGuest)
)

const inHouseList = computed(() =>
  allReservations.value
    .filter((r: Record<string, unknown>) => {
      const ci = String(r.checkIn).slice(0, 10)
      const co = String(r.checkOut).slice(0, 10)
      return ci <= todayStr && co >= todayStr && r.status === 'checked_in'
    })
    .map(mapGuest)
)

const departures = computed(() =>
  allReservations.value
    .filter((r: Record<string, unknown>) => String(r.checkOut).slice(0, 10) === todayStr && r.status === 'checked_in')
    .map(mapGuest)
)

function mapGuest(r: Record<string, unknown>): CheckinGuest {
  const ch = ((r.channel as string) || 'direct').toLowerCase()
  const nights = Math.ceil((new Date(r.checkOut as string).getTime() - new Date(r.checkIn as string).getTime()) / 86400000)
  return {
    id: r.id as string,
    guestName: (r.guestName as string) || 'Guest',
    guestEmail: (r.guestEmail as string) || '',
    initials: ((r.guestName as string) || 'G').split(' ').map((p: string) => p[0]).slice(0, 2).join(''),
    roomNumber: (r.roomNumber as string) || '—',
    roomId: r.roomId as string,
    checkIn: String(r.checkIn).slice(0, 10),
    checkOut: String(r.checkOut).slice(0, 10),
    nights,
    status: r.status as string,
    channel: ch,
    channelLabel: channelLabels[ch] || ch,
    channelColor: channelColors[ch] || 'bg-surface text-navy',
    totalAmount: (r.totalAmount as number) || 0,
    adults: (r.adults as number) || 2,
    children: (r.children as number) || 0,
    checkedIn: r.status === 'checked_in',
    checkedOut: r.status === 'checked_out',
    notes: (r.notes as string) || null,
  }
}

const checkoutSettleLabel = computed(() => {
  if (!checkoutFolio.value || !checkoutFolio.value.balance || checkoutFolio.value.balance <= 0) return 'Confirmar Check-out'
  if (!settleMethod.value) return 'Seleccionar pago + Check-out'
  return `Check-out + $${checkoutFolio.value.balance.toFixed(2)} (${settleMethod.value})`
})

const arrivalsToday = computed(() => arrivals.value.length)
const departuresToday = computed(() => departures.value.length)
const inHouse = computed(() => inHouseList.value.length)

const KPI_ICON_BED = '<svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 18v2M3 18h18M21 18v2M5 13V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4"/></svg>'
const KPI_ICON_ARRIVAL = '<svg viewBox="0 0 24 24" class="w-6 h-6" fill="none"><rect x="3" y="3" width="12" height="18" rx="1.5" fill="currentColor" opacity="0.55"/><circle cx="11" cy="12" r="1.2" fill="white"/><path d="M14 12h7m0 0-3-3m3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
const KPI_ICON_DEPARTURE = '<svg viewBox="0 0 24 24" class="w-6 h-6" fill="none"><rect x="9" y="3" width="12" height="18" rx="1.5" fill="currentColor" opacity="0.55"/><circle cx="17" cy="12" r="1.2" fill="white"/><path d="M10 12H3m0 0 3-3m-3 3 3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'

// Números animados (mismo patrón que reservations/index.vue) — useCountUp debe llamarse
// en el cuerpo de setup, no dentro del computed que arma las cards.
const inHouseAnim = useCountUp(inHouse)
const arrivalsAnim = useCountUp(arrivalsToday)
const departuresAnim = useCountUp(departuresToday)

const kpis = computed(() => [
  { key: 'inhouse', label: 'En Casa', value: Math.round(inHouseAnim.value), icon: 'users' as const, accent: 'teal' as const },
  { key: 'arrivals', label: 'Por Llegar Hoy', value: Math.round(arrivalsAnim.value), icon: 'checkin' as const, accent: 'amber' as const },
  { key: 'departures', label: 'Por Salir Hoy', value: Math.round(departuresAnim.value), icon: 'checkout' as const, accent: 'rose' as const },
])

function daysUntil(dateStr: string) {
  const d = Math.ceil((new Date(dateStr + 'T12:00:00').getTime() - today.getTime()) / 86400000)
  return d > 0 ? d : 0
}

function resolveError(e: unknown, messages: Record<number, string>, fallback: string): string {
  if (e instanceof ApiError) return messages[e.status] || `${fallback} (${e.status})`
  if (e instanceof TypeError && e.message.includes('fetch')) return 'Sin conexión con el servidor'
  return fallback
}

function guestInitials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

function roomCardClass(room: CheckinRoom) {
  const map: Record<string, string> = {
    available: 'border-teal/20 bg-white hover:border-teal',
    occupied: 'border-coral/20 bg-coral/5 hover:border-coral',
    cleaning: 'border-cyan/20 bg-cyan/5',
    dirty: 'border-gold/20 bg-gold/5',
    out_of_service: 'border-gray-300 bg-gray-50',
  }
  return map[room.status] || ''
}

function roomNumberClass(room: CheckinRoom) {
  const map: Record<string, string> = { available: 'text-teal', occupied: 'text-coral', cleaning: 'text-cyan', dirty: 'text-gold', out_of_service: 'text-gray-400' }
  return map[room.status] || 'text-navy'
}

function roomDotClass(room: CheckinRoom) {
  const map: Record<string, string> = { available: 'bg-teal', occupied: 'bg-coral', cleaning: 'bg-cyan', dirty: 'bg-gold', out_of_service: 'bg-gray-400' }
  return map[room.status] || 'bg-gray-300'
}

function roomStatusLabel(room: CheckinRoom) {
  const map: Record<string, string> = { available: 'Disponible', occupied: 'Ocupada', cleaning: 'Limpieza', dirty: 'Sucia', out_of_service: 'F/S' }
  return map[room.status] || room.status
}

const ROOM_STATUS_LEGEND = [
  { status: 'available', label: 'Disponible', dot: 'bg-teal' },
  { status: 'occupied', label: 'Ocupada', dot: 'bg-coral' },
  { status: 'cleaning', label: 'Limpieza', dot: 'bg-cyan' },
  { status: 'dirty', label: 'Sucia', dot: 'bg-gold' },
  { status: 'out_of_service', label: 'Fuera de servicio', dot: 'bg-gray-400' },
]

async function selectRoom(room: CheckinRoom) {
  selectedRoom.value = room
  showRoomDetail.value = true
  loadRoomAmenities(room.id)
}

function closeRoomDetail() {
  showRoomDetail.value = false
  selectedRoom.value = null
  roomAmenities.value = []
}

function viewReservation(resId: string) {
  router.push(`/panel/reservas?id=${resId}`)
}

async function checkoutFromRoom(room: CheckinRoom) {
  if (!room.resId || processing.value) return
  const reservation = allReservations.value.find(r => r.id === room.resId)
  if (!reservation) return
  openCheckoutModal(mapGuest(reservation))
}

function openCheckinModal(guest: CheckinGuest) {
  checkinGuest.value = guest
  showCheckinModal.value = true
}

function closeCheckinModal() {
  if (processing.value) return
  showCheckinModal.value = false
  checkinGuest.value = null
}

async function doCheckin(guest: CheckinGuest) {
  processing.value = true
  try {
    await ReservationService.checkin(guest.id)
    checkedIn.value.add(guest.id)
    // Cierre directo en el path de éxito: closeCheckinModal() tiene un guard `if (processing) return`
    // y acá processing sigue true hasta el finally, así que el modal no se cerraría (bug destapado
    // por e2e/reservations/checkout.spec.ts — el overlay interceptaba el click del botón check-out).
    showCheckinModal.value = false
    checkinGuest.value = null
    await loadData()
    toast.success('Check-in confirmado', `Hab ${guest.roomNumber}`)
  } catch (e) {
    const msg = resolveError(e, {
      409: 'Esta reserva ya tiene check-in hecho',
      403: 'No tienes permiso para hacer check-in',
      404: 'Reserva no encontrada',
    }, 'No se pudo hacer el check-in')
    toast.error(msg, 'Reintentá en unos segundos')
  } finally {
    processing.value = false
  }
}

async function confirmCheckin() {
  if (!checkinGuest.value || processing.value) return
  await doCheckin(checkinGuest.value)
}

function resetChargeForm() {
  showChargeForm.value = false
  addingCharge.value = false
  chargeForm.value = { description: '', amount: null, category: 'minibar' }
}

async function openCheckoutModal(guest: CheckinGuest) {
  checkoutGuest.value = guest
  checkoutFolio.value = null
  settleMethod.value = null
  debtAck.value = false
  resetChargeForm()
  showCheckoutModal.value = true

  if (guest.id) {
    folioLoading.value = true
    try {
      const folios = await FoliosService.list(hotelId.value, 'open')
      const match = folios.find(f => f.reservationId === guest.id)
      if (match) {
        const detail = await FoliosService.get(match.id)
        checkoutFolio.value = detail
        if (detail.balance && detail.balance > 0 && detail.balance <= (guest.totalAmount || 0)) {
          settleMethod.value = 'cash'
        }
      }
    } catch {
      // folio not available — proceed without
    } finally {
      folioLoading.value = false
    }
  }
}

function closeCheckoutModal() {
  if (processing.value) return
  showCheckoutModal.value = false
  checkoutGuest.value = null
  checkoutFolio.value = null
  settleMethod.value = null
  debtAck.value = false
  resetChargeForm()
}

/** #4 — Agrega un consumo al folio del huésped desde el check-out y recarga el saldo. */
async function addCharge() {
  if (!checkoutFolio.value || addingCharge.value) return
  const description = chargeForm.value.description.trim()
  const amount = Number(chargeForm.value.amount)
  if (!description || !(amount > 0)) {
    toast.error('Consumo inválido', 'Poné una descripción y un monto mayor a 0')
    return
  }
  addingCharge.value = true
  try {
    await FoliosService.charge(checkoutFolio.value.id, { description, amount, category: chargeForm.value.category, quantity: 1 })
    // Recargar el folio para reflejar el nuevo saldo; el pago sugerido deja de ser válido.
    checkoutFolio.value = await FoliosService.get(checkoutFolio.value.id)
    settleMethod.value = null
    debtAck.value = false
    resetChargeForm()
    toast.success('Consumo agregado')
  } catch {
    toast.error('No se pudo agregar el consumo', 'Reintentá en unos segundos')
    addingCharge.value = false
  }
}

async function doCheckout(guest: CheckinGuest) {
  processing.value = true
  try {
    const balance = checkoutFolio.value?.balance || 0
    const settle = balance > 0 && settleMethod.value
      ? { method: settleMethod.value, amount: balance }
      : null
    const result = await ReservationService.checkout(guest.id, settle)
    checkedOut.value.add(guest.id)
    // Cierre directo en el path de éxito (mismo motivo que doCheckin: closeCheckoutModal() hace
    // guard por processing y no cerraría hasta el finally).
    showCheckoutModal.value = false
    checkoutGuest.value = null
    await loadData()
    const settleMsg = result.settlement?.invoiceNumber
      ? ` · Factura ${result.settlement.invoiceNumber}`
      : ''
    toast.success('Check-out listo', `${guest.guestName} · Hab ${guest.roomNumber}${settleMsg}`)
  } catch (e) {
    const msg = resolveError(e, {
      409: 'Esta reserva no tiene check-in activo',
      403: 'No tienes permiso para hacer check-out',
      404: 'Reserva no encontrada',
    }, 'No se pudo hacer el check-out')
    toast.error(msg, 'Reintentá en unos segundos')
  } finally {
    processing.value = false
  }
}

async function confirmCheckout() {
  if (!checkoutGuest.value || processing.value) return
  // #5 — Guarda de deuda: si el huésped se va con saldo pendiente y no se registró un pago,
  // exigir confirmación explícita (checkbox) antes de cerrar el check-out con deuda.
  const balance = checkoutFolio.value?.balance || 0
  if (balance > 0 && !settleMethod.value && !debtAck.value) {
    toast.error('Saldo pendiente', `Registrá el pago o confirmá el check-out con deuda de $${balance.toFixed(2)}`)
    return
  }
  await doCheckout(checkoutGuest.value)
}
</script>
