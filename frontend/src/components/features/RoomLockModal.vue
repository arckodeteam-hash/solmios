<template>
  <AppModal :open="!!roomId" size="xl" body-class="p-0" @close="$emit('close')">
    <template #header>
      <div class="flex items-start gap-3 min-w-0 w-full">
        <div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 text-white">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <rect x="5" y="10" width="14" height="11" rx="2"/><path stroke-linecap="round" d="M8 10V7a4 4 0 0 1 8 0v3"/>
            <circle cx="9" cy="14.5" r="0.7" fill="currentColor"/><circle cx="12" cy="14.5" r="0.7" fill="currentColor"/><circle cx="15" cy="14.5" r="0.7" fill="currentColor"/>
            <circle cx="9" cy="17.5" r="0.7" fill="currentColor"/><circle cx="12" cy="17.5" r="0.7" fill="currentColor"/><circle cx="15" cy="17.5" r="0.7" fill="currentColor"/>
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="text-lg sm:text-xl font-black text-white truncate">Cerradura · Hab {{ roomNumber }}</h3>
          <p class="text-sm text-white/60 mt-0.5 truncate">{{ lock ? (lock.name || 'Cerradura TTLock') : 'Acceso de la habitación' }}</p>
          <!-- Resumen general: estado, batería, códigos y gateway en un vistazo -->
          <div v-if="lock && !loading" class="flex flex-wrap items-center gap-1.5 mt-2">
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5"
              :class="lock.status === 'online' ? 'bg-teal/20 text-teal-light' : 'bg-white/10 text-white/60'">
              <span class="w-1.5 h-1.5 rounded-full" :class="lock.status === 'online' ? 'bg-teal-light' : 'bg-white/40'"></span>
              {{ lock.status === 'online' ? 'online' : 'offline' }}
            </span>
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5 bg-white/10"
              :class="(lock.batteryLevel || 0) > 50 ? 'text-teal-light' : (lock.batteryLevel || 0) > 20 ? 'text-gold' : 'text-coral'">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="7" width="17" height="10" rx="2.5"/><path stroke-linecap="round" d="M21.5 10.5v3"/>
                <rect x="4" y="9" :width="Math.max(2, Math.round((lock.batteryLevel || 0) / 100 * 13))" height="6" rx="1" fill="currentColor" stroke="none"/>
              </svg>
              {{ lock.batteryLevel || 0 }}%
            </span>
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal/20 text-teal-light flex items-center gap-1">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7.5" cy="15.5" r="4.5"/><path stroke-linecap="round" d="M11 12 20 3"/><path stroke-linecap="round" d="M17 6.5l2.5 2.5"/></svg>
              {{ vigentes.length }} {{ vigentes.length === 1 ? 'código vigente' : 'códigos vigentes' }}
            </span>
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/60">{{ purgeableCount }} {{ purgeableCount === 1 ? 'histórico' : 'históricos' }}</span>
            <span v-if="gateways.length" class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/10 flex items-center gap-1.5">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path stroke-linecap="round" d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="1.6"/><path stroke-linecap="round" d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path stroke-linecap="round" d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>
              <span class="text-white/60">gateway</span>
              <span :class="signalClass(gateways[0].rssi)">{{ signalLabel(gateways[0].rssi) }}</span>
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- Tabs con icono + label -->
    <div v-if="lock" class="shrink-0 px-5 pt-4 flex gap-1 border-b border-border overflow-x-auto">
      <button v-for="t in tabs" :key="t.key" @click="selectTab(t.key)"
        class="px-3 py-2 text-sm font-bold border-b-2 -mb-px transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
        :class="tab === t.key ? 'border-navy text-navy' : 'border-transparent text-text-muted hover:text-navy'">
        <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <template v-if="t.key === 'device'"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></template>
          <template v-else-if="t.key === 'codes'"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12 20 3"/><path d="M17 6.5l2.5 2.5"/></template>
          <template v-else-if="t.key === 'fijos'"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></template>
          <template v-else-if="t.key === 'active'"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="1.6"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></template>
          <template v-else><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none"/></template>
        </svg>
        {{ t.label }}
        <span v-if="t.key === 'errors' && errorCount > 0" class="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-coral/10 text-coral">{{ errorCount }}</span>
      </button>
    </div>

    <!-- Body -->
    <div class="p-6">
      <div v-if="loading" class="flex items-center justify-center gap-2 text-sm text-text-muted py-8">
        <span class="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin"></span>
        Cargando…
      </div>

      <template v-else>
              <!-- Sin cerradura asignada: asignar una desde acá mismo -->
              <div v-if="!lock" class="py-6">
                <div class="text-center mb-4">
                  <svg class="w-10 h-10 mx-auto mb-2 text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                  <p class="text-sm font-bold text-navy">Sin cerradura asignada</p>
                  <p class="text-sm text-text-muted mt-1">Asigná una cerradura sincronizada a esta habitación.</p>
                </div>
                <div v-if="availableLocks.length" class="space-y-2">
                  <select v-model="assignLockId" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
                    <option value="">Elegí una cerradura…</option>
                    <option v-for="l in availableLocks" :key="l.id" :value="l.id">{{ l.name || l.id }}</option>
                  </select>
                  <button @click="assignLock" :disabled="!assignLockId || assigning" class="w-full py-2.5 bg-navy text-white text-sm font-bold rounded-full hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/><path d="M12 14.5v3"/></svg>
                    {{ assigning ? 'Asignando…' : 'Asignar cerradura' }}
                  </button>
                </div>
                <p v-else class="text-sm text-text-muted text-center">No hay cerraduras sincronizadas sin asignar. Sincronizá tus cerraduras TTLock primero.</p>
              </div>

              <!-- Tab Cerradura -->
              <div v-else-if="tab === 'device'" class="space-y-3">
                <!-- 2 columnas en desktop: con el modal xl (max-w-5xl) la info deja de apilarse
                     en una columna angosta (queja real de recepción: "se ve super pequeño"). -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-3">
                  <div class="flex justify-between text-sm"><span class="text-text-muted">Nombre</span><span class="font-bold text-navy">{{ lock.name || '—' }}</span></div>
                  <div class="flex justify-between text-sm"><span class="text-text-muted">Batería</span>
                    <span class="font-bold" :class="(lock.batteryLevel||0) > 50 ? 'text-teal' : (lock.batteryLevel||0) > 20 ? 'text-gold' : 'text-coral'">{{ lock.batteryLevel || 0 }}%</span>
                  </div>
                  <div class="flex justify-between text-sm"><span class="text-text-muted">MAC</span><span class="font-mono text-text-secondary">{{ lock.mac || '—' }}</span></div>
                  <div class="flex justify-between text-sm items-center"><span class="text-text-muted">Estado</span>
                    <span class="text-[11px] font-bold px-2 py-1 rounded-full" :class="lock.status === 'online' ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-500'">{{ lock.status || 'offline' }}</span>
                  </div>
                </div>

                <!-- Toggle: auto-generar el código al pagarse la seña, por cerradura -->
                <div class="flex justify-between items-center text-sm pt-1">
                  <span class="text-text-muted">Códigos automáticos <span class="text-[11px]">(al pagar la seña)</span></span>
                  <button @click="toggleAutoCodes" :disabled="togglingAuto" class="relative w-9 h-5 rounded-full transition-colors cursor-pointer disabled:opacity-50 shrink-0" :class="autoOn ? 'bg-teal' : 'bg-gray-300'" :title="autoOn ? 'Activado' : 'Desactivado'">
                    <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" :class="autoOn ? 'left-4' : 'left-0.5'"></span>
                  </button>
                </div>

                <!-- Gateway (dónde está conectada) -->
                <div class="pt-2 border-t border-border">
                  <div class="text-[11px] font-bold text-text-muted uppercase mb-1.5">Gateway</div>
                  <div v-if="gatewayLoading" class="text-sm text-text-muted">Buscando gateway…</div>
                  <div v-else-if="!gateways.length" class="text-sm text-coral">Sin gateway en rango. La cerradura no puede operarse en remoto.</div>
                  <div v-else v-for="g in gateways" :key="g.gatewayId" class="flex items-center justify-between text-sm">
                    <span class="font-bold text-navy">{{ g.gatewayName || ('Gateway ' + g.gatewayId) }}</span>
                    <span class="font-bold" :class="signalClass(g.rssi)">{{ signalLabel(g.rssi) }}<span class="text-text-muted font-normal"> ({{ g.rssi }} dBm)</span></span>
                  </div>
                </div>

                <button @click="unlockDoor" :disabled="unlocking || lock.status !== 'online'"
                  class="w-full mt-2 py-2.5 bg-navy text-white text-sm font-bold rounded-full hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                  <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/><path d="M12 14.5v3"/></svg>
                  {{ unlocking ? 'Abriendo…' : 'Abrir puerta' }}
                </button>
                <p v-if="lock.status !== 'online'" class="text-[11px] text-text-muted text-center">La cerradura debe estar online para abrir en remoto.</p>

                <!-- Cambiar / desasignar la cerradura de esta habitación -->
                <div class="pt-2 border-t border-border">
                  <button v-if="!showReassign" @click="showReassign = true" class="text-xs font-bold text-text-muted hover:text-navy transition-colors cursor-pointer">Cambiar / desasignar cerradura</button>
                  <div v-else class="space-y-2">
                    <div class="flex gap-2">
                      <select v-model="assignLockId" class="flex-1 px-3 py-2 rounded-lg border border-border text-sm cursor-pointer">
                        <option value="">Cambiar a…</option>
                        <option v-for="l in availableLocks" :key="l.id" :value="l.id">{{ l.name || l.id }}</option>
                      </select>
                      <button @click="assignLock" :disabled="!assignLockId || assigning" class="px-3 py-2 bg-navy text-white text-sm font-bold rounded-lg hover:bg-navy-light disabled:opacity-50 cursor-pointer">Cambiar</button>
                    </div>
                    <div class="flex items-center gap-2">
                      <button @click="unassignLock" :disabled="assigning" class="text-xs font-bold text-coral hover:text-navy transition-colors cursor-pointer disabled:opacity-50">Desasignar de esta habitación</button>
                      <button @click="showReassign = false" class="text-xs font-bold text-text-muted hover:text-navy transition-colors cursor-pointer ml-auto">Cancelar</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab Códigos (BD / reservas): vigentes arriba, históricos abajo con borrado masivo -->
              <div v-else-if="tab === 'codes'" class="space-y-4">
                <button v-if="reservationId" @click="generate" :disabled="generating"
                  class="w-full py-2.5 bg-teal text-white text-sm font-bold rounded-full hover:bg-teal-light transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                  <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12 20 3"/><path d="M17 6.5l2.5 2.5"/><path d="M15 3h6v6"/></svg>
                  {{ generating ? 'Generando…' : 'Generar código para la reserva de hoy' }}
                </button>
                <p v-else class="text-xs text-text-muted text-center">Sin reserva activa hoy. Los códigos se generan desde la reserva o al pagarse la seña.</p>

                <!-- Vigentes: activos y pendientes -->
                <section>
                  <div class="flex items-center gap-2 mb-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-teal"></span>
                    <span class="text-[11px] font-bold text-text-muted uppercase tracking-wide">Vigentes</span>
                    <span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-teal/10 text-teal">{{ vigentes.length }}</span>
                  </div>
                  <div v-for="c in vigentes" :key="c.id" class="flex items-center gap-2 bg-surface rounded-xl px-3 py-2.5 mb-2">
                    <code class="text-2xl font-black tracking-[0.25em] font-mono text-navy">{{ c.code }}</code>
                    <span class="text-xs text-text-muted shrink-0">{{ c.startDate || '?' }} → {{ c.endDate || '?' }}</span>
                    <span class="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-auto" :class="statusClass(c.status)">{{ statusLabel(c.status) }}</span>
                    <button v-if="c.status === 'active'" @click="revoke(c)" class="text-xs font-bold text-coral hover:text-navy transition-colors cursor-pointer shrink-0 flex items-center gap-1">
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m5.5 5.5 13 13"/></svg>
                      Revocar
                    </button>
                  </div>
                  <p v-if="!vigentes.length" class="text-sm text-text-muted text-center py-2">Sin códigos vigentes para esta cerradura.</p>
                </section>

                <!-- Históricos: revocados y vencidos, tenues, sin acciones individuales -->
                <section v-if="historicos.length" class="border-t border-border pt-3">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                    <span class="text-[11px] font-bold text-text-muted uppercase tracking-wide">Históricos</span>
                    <span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{{ purgeableCount }}</span>
                    <span class="text-[11px] text-text-muted ml-auto">No abre la puerta · solo registro</span>
                  </div>
                  <div v-for="c in historicos" :key="c.id" class="flex items-center gap-2 bg-surface rounded-xl px-3 py-2 mb-2 opacity-60">
                    <code class="text-lg font-black tracking-[0.2em] font-mono text-text-secondary">{{ c.code }}</code>
                    <span class="text-xs text-text-muted shrink-0">{{ c.startDate || '?' }} → {{ c.endDate || '?' }}</span>
                    <span class="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-auto" :class="statusClass(c.status)">{{ statusLabel(c.status) }}</span>
                  </div>
                  <button v-if="purgeableCount" @click="purgeHistoricos" :disabled="purging"
                    class="w-full py-2.5 rounded-full border border-coral/40 text-coral text-sm font-bold hover:bg-coral hover:text-white hover:border-coral transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                    <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                    {{ purging ? 'Borrando…' : `Borrar ${purgeableCount} ${purgeableCount === 1 ? 'histórico' : 'históricos'}` }}
                  </button>
                </section>
              </div>

              <!-- Tab Fijos (permanentes de staff) -->
              <div v-else-if="tab === 'fijos'">
                <div v-if="activeLoading" class="text-center text-sm text-text-muted py-6">Cargando…</div>
                <template v-else>
                  <div class="bg-surface rounded-xl p-3 mb-3 space-y-2">
                    <div class="text-[11px] font-bold text-text-muted uppercase">Nuevo código fijo</div>
                    <input v-model="fijoName" type="text" placeholder="Nombre (ej: Camarera, Mantenimiento)" class="w-full px-3 py-2 rounded-lg border border-border text-sm" />
                    <div class="flex gap-2">
                      <input v-model="fijoCode" type="text" inputmode="numeric" placeholder="Código (4-9 dígitos, opcional)" class="flex-1 px-3 py-2 rounded-lg border border-border text-sm" />
                      <button @click="createFijo" :disabled="creatingFijo" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-lg hover:bg-navy-light disabled:opacity-50 cursor-pointer">{{ creatingFijo ? '…' : 'Crear' }}</button>
                    </div>
                  </div>
                  <div v-for="c in fijos" :key="c.keyboardPwdId" class="flex items-center gap-2 bg-surface rounded-xl px-3 py-2.5 mb-2">
                    <code class="text-sm font-mono font-bold text-navy">{{ c.keyboardPwd || '••••' }}</code>
                    <span class="text-xs text-text-secondary truncate">{{ c.keyboardPwdName || 'Fijo' }}</span>
                    <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan/10 text-cyan shrink-0 ml-auto">permanente</span>
                    <button @click="deleteActive(c)" :disabled="deletingId === c.keyboardPwdId" class="text-xs font-bold text-coral hover:text-navy cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1">
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                      {{ deletingId === c.keyboardPwdId ? '…' : 'Borrar' }}
                    </button>
                  </div>
                  <p v-if="!fijos.length" class="text-sm text-text-muted text-center py-3">Sin códigos fijos. Creá uno para el staff.</p>
                </template>
              </div>

              <!-- Tab Activos (hardware) -->
              <div v-else-if="tab === 'active'">
                <div v-if="activeLoading" class="text-center text-sm text-text-muted py-6">Leyendo la cerradura…</div>
                <template v-else>
                  <p class="text-xs text-text-muted mb-3">PIN reales vivos en la cerradura (leídos del hardware).</p>
                  <div v-for="c in activeCodes" :key="c.keyboardPwdId" class="flex items-center gap-2 bg-surface rounded-xl px-3 py-2.5 mb-2">
                    <code class="text-sm font-mono font-bold text-navy">{{ c.keyboardPwd || '••••' }}</code>
                    <span class="text-xs text-text-secondary truncate">{{ c.keyboardPwdName || '—' }}</span>
                    <span class="text-xs text-text-muted shrink-0 ml-auto">{{ fmtMs(c.startDate) }} → {{ c.endDate ? fmtMs(c.endDate) : 'perm.' }}</span>
                    <button @click="deleteActive(c)" :disabled="deletingId === c.keyboardPwdId" class="text-xs font-bold text-coral hover:text-navy transition-colors cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1">
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                      {{ deletingId === c.keyboardPwdId ? '…' : 'Borrar' }}
                    </button>
                  </div>
                  <p v-if="!activeCodes.length" class="text-sm text-text-muted text-center py-4">La cerradura no tiene códigos activos ahora.</p>
                </template>
              </div>

              <!-- Tab Errores (fallos del hardware) -->
              <div v-else-if="tab === 'errors'">
                <div v-if="recordsLoading" class="text-center text-sm text-text-muted py-6">Revisando la cerradura…</div>
                <template v-else>
                  <p class="text-xs text-text-muted mb-3">Intentos fallidos y problemas de los últimos 30 días.</p>
                  <div v-for="r in errors" :key="r.recordId" class="flex items-center gap-2 border-b border-border py-2.5 last:border-0">
                    <span class="w-1.5 h-1.5 rounded-full bg-coral shrink-0"></span>
                    <span class="text-sm font-bold text-navy">{{ recordTypeLabel(r.recordType) }}</span>
                    <span v-if="r.keyboardPwd" class="text-sm font-mono text-text-secondary">{{ r.keyboardPwd }}</span>
                    <span class="text-[11px] font-bold text-coral shrink-0 ml-auto">Falló</span>
                    <span class="text-xs text-text-muted shrink-0">{{ fmtMs(r.lockDate) }}</span>
                  </div>
                  <div v-if="!errors.length" class="text-center py-6">
                    <svg class="w-9 h-9 mx-auto mb-1 text-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>
                    <p class="text-sm text-text-muted">Sin errores en los últimos 30 días.</p>
                  </div>
                </template>
              </div>
            </template>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import { TTLockService, type LockDevice, type LockCode, type LockActiveCode, type LockRecord, type LockGatewayLink } from '@/services/TTLock.service'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  roomId: string | null
  roomNumber: string
  reservationId: string | null
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed'): void }>()

const toast = useToast()
type LockTab = 'device' | 'codes' | 'fijos' | 'active' | 'errors'
const tabs: { key: LockTab; label: string }[] = [
  { key: 'device', label: 'Cerradura' },
  { key: 'codes', label: 'Códigos' },
  { key: 'fijos', label: 'Fijos' },
  { key: 'active', label: 'Activos' },
  { key: 'errors', label: 'Errores' },
]
const tab = ref<LockTab>('device')
const loading = ref(false)
const generating = ref(false)
const unlocking = ref(false)
const togglingAuto = ref(false)
const deletingId = ref<number | null>(null)
const purging = ref(false)
const lock = ref<LockDevice | null>(null)
const codes = ref<LockCode[]>([])

// Asignación de cerradura desde el propio modal (autosuficiente, sin ir a la página avanzada).
const allLocks = ref<LockDevice[]>([])
const assignLockId = ref('')
const assigning = ref(false)
const showReassign = ref(false)
// Cerraduras candidatas: las sincronizadas que no están asignadas a ninguna habitación.
const availableLocks = computed(() => allLocks.value.filter(l => !l.roomId))

const gateways = ref<LockGatewayLink[]>([])
const gatewayLoading = ref(false)

const activeCodes = ref<LockActiveCode[]>([])
const activeLoading = ref(false)
const activeLoaded = ref(false)
const records = ref<LockRecord[]>([])
const recordsLoading = ref(false)
const recordsLoaded = ref(false)

const fijoCode = ref('')
const fijoName = ref('')
const creatingFijo = ref(false)

// Auto-códigos: habilitado salvo que sea explícitamente false (filas viejas sin el campo = ON).
const autoOn = computed(() => lock.value?.autoCodesEnabled !== false)
const fijos = computed(() => activeCodes.value.filter(c => c.keyboardPwdType === 1))
const errors = computed(() => records.value.filter(r => r.success !== 1))
const errorCount = computed(() => errors.value.length)
// Códigos de la cerradura partidos por vigencia: activos/pendientes destacados arriba,
// revocados/vencidos tenues abajo (borrables en masa).
const vigentes = computed(() => codes.value.filter(c => c.status === 'active' || c.status === 'pending'))
const historicos = computed(() => codes.value.filter(c => c.status === 'revoked' || c.status === 'expired' || c.status === 'expire_failed'))
// Solo revoked/expired se purgan: 'expire_failed' queda (el PIN físico pudo quedar vivo).
const purgeableCount = computed(() => codes.value.filter(c => c.status === 'revoked' || c.status === 'expired').length)

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo', pending: 'Pendiente', revoked: 'Revocado', expired: 'Vencido', expire_failed: 'Fallo expiración',
}
function statusLabel(s: string) { return STATUS_LABEL[s] || s }
function statusClass(s: string) {
  if (s === 'active') return 'bg-teal/10 text-teal'
  if (s === 'pending') return 'bg-gold/10 text-gold'
  if (s === 'expire_failed') return 'bg-coral/10 text-coral'
  return 'bg-gray-100 text-gray-500'
}

function fmtMs(ms?: number) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const RECORD_TYPE: Record<number, string> = {
  1: 'Apertura app', 4: 'Apertura código', 7: 'Tarjeta', 8: 'Huella',
  11: 'Bloqueo', 12: 'Operación gateway', 46: 'Apertura remota', 47: 'Apertura remota',
}
function recordTypeLabel(t?: number) { return t != null ? (RECORD_TYPE[t] || `Evento ${t}`) : '—' }
function signalLabel(rssi?: number) {
  if (rssi == null) return '—'
  if (rssi >= -70) return 'Buena'
  if (rssi >= -85) return 'Media'
  return 'Débil'
}
function signalClass(rssi?: number) {
  if (rssi == null) return 'text-text-muted'
  if (rssi >= -70) return 'text-teal'
  if (rssi >= -85) return 'text-gold'
  return 'text-coral'
}

function selectTab(k: LockTab) {
  tab.value = k
  if ((k === 'active' || k === 'fijos') && !activeLoaded.value) loadActive()
  if (k === 'errors' && !recordsLoaded.value) loadRecords()
}

async function load() {
  if (!props.roomId) return
  loading.value = true
  activeLoaded.value = false; recordsLoaded.value = false
  activeCodes.value = []; records.value = []; gateways.value = []
  try {
    const [locksRes, codesRes] = await Promise.all([TTLockService.listLocks(), TTLockService.listCodes()])
    allLocks.value = locksRes.data || []
    lock.value = allLocks.value.find(l => l.roomId === props.roomId) || null
    codes.value = lock.value ? (codesRes.data || []).filter(c => c.lockId === lock.value!.id) : []
  } catch {
    toast.error('No se pudo cargar la cerradura')
  } finally {
    loading.value = false
  }
  if (lock.value?.id) loadGateways()
}

async function loadGateways() {
  if (!lock.value?.id) return
  gatewayLoading.value = true
  try {
    const r = await TTLockService.listLockGateways(lock.value.id)
    gateways.value = r.data || []
  } catch { /* el device sigue mostrándose sin gateway */ } finally {
    gatewayLoading.value = false
  }
}

async function loadActive() {
  if (!lock.value?.id) return
  activeLoading.value = true
  try {
    const r = await TTLockService.listActiveCodes(lock.value.id)
    activeCodes.value = r.data || []
    activeLoaded.value = true
  } catch (e) {
    toast.error((e as Error).message || 'No se pudieron leer los códigos del hardware')
  } finally {
    activeLoading.value = false
  }
}

async function loadRecords() {
  if (!lock.value?.id) return
  recordsLoading.value = true
  try {
    const r = await TTLockService.listLockRecords(lock.value.id)
    records.value = (r.data || []).sort((a, b) => (b.lockDate || 0) - (a.lockDate || 0))
    recordsLoaded.value = true
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo leer el historial')
  } finally {
    recordsLoading.value = false
  }
}

async function toggleAutoCodes() {
  if (!lock.value?.id || togglingAuto.value) return
  const next = !autoOn.value
  togglingAuto.value = true
  try {
    await TTLockService.updateLock(lock.value.id, { autoCodesEnabled: next })
    lock.value.autoCodesEnabled = next
    emit('changed')
    toast.success(next ? 'Auto-códigos activados' : 'Auto-códigos desactivados')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo cambiar el auto-código')
  } finally {
    togglingAuto.value = false
  }
}

async function unlockDoor() {
  if (!lock.value?.id || unlocking.value) return
  unlocking.value = true
  try {
    await TTLockService.unlockLock(lock.value.id)
    toast.success('Puerta abierta')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo abrir la puerta')
  } finally {
    unlocking.value = false
  }
}

async function deleteActive(c: LockActiveCode) {
  if (!lock.value?.id || deletingId.value != null) return
  deletingId.value = c.keyboardPwdId
  try {
    await TTLockService.deletePasscode(lock.value.id, c.keyboardPwdId)
    await loadActive()
    emit('changed')
    toast.success('Código borrado de la cerradura')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo borrar el código')
  } finally {
    deletingId.value = null
  }
}

async function createFijo() {
  if (!lock.value?.id || creatingFijo.value) return
  const name = fijoName.value.trim()
  const code = fijoCode.value.trim()
  if (!name) { toast.error('Poné un nombre para el código fijo'); return }
  if (code && !/^\d{4,9}$/.test(code)) { toast.error('El código debe tener entre 4 y 9 dígitos'); return }
  creatingFijo.value = true
  try {
    const r = await TTLockService.createPermanentCode(lock.value.id, { code: code || undefined, name })
    await loadActive()
    emit('changed')
    fijoCode.value = ''; fijoName.value = ''
    toast.success(`Código fijo creado: ${r.code}`)
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo crear el código fijo')
  } finally {
    creatingFijo.value = false
  }
}

async function generate() {
  if (!props.reservationId || generating.value) return
  generating.value = true
  try {
    await TTLockService.generateCode(props.reservationId)
    await load()
    activeLoaded.value = false
    emit('changed')
    toast.success('Código generado en la cerradura')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo generar el código')
  } finally {
    generating.value = false
  }
}

async function revoke(code: LockCode) {
  if (!code.id) return
  try {
    await TTLockService.revokeCode(code.id)
    await load()
    activeLoaded.value = false
    emit('changed')
    toast.success('Código revocado y borrado de la cerradura')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo revocar el código')
  }
}

/** Borrado masivo de la sección Históricos: elimina de la BD los revoked/expired de la cerradura. */
async function purgeHistoricos() {
  if (!lock.value?.id || purging.value || !purgeableCount.value) return
  if (!confirm(`¿Borrar ${purgeableCount.value} código(s) histórico(s) de esta cerradura? Es solo limpieza de registro: esos PIN ya no abren la puerta.`)) return
  purging.value = true
  try {
    const r = await TTLockService.purgeRevokedCodes(lock.value.id)
    await load()
    emit('changed')
    toast.success(`${r.deleted} código(s) histórico(s) eliminados`)
  } catch (e) {
    toast.error((e as Error).message || 'No se pudieron borrar los códigos históricos')
  } finally {
    purging.value = false
  }
}

async function assignLock() {
  if (!assignLockId.value || !props.roomId || assigning.value) return
  assigning.value = true
  try {
    await TTLockService.updateLock(assignLockId.value, { roomId: props.roomId })
    assignLockId.value = ''
    showReassign.value = false
    await load()
    emit('changed')
    toast.success('Cerradura asignada a la habitación')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo asignar la cerradura')
  } finally {
    assigning.value = false
  }
}

async function unassignLock() {
  if (!lock.value?.id || assigning.value) return
  assigning.value = true
  try {
    await TTLockService.updateLock(lock.value.id, { roomId: '' })
    showReassign.value = false
    await load()
    emit('changed')
    toast.success('Cerradura desasignada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo desasignar la cerradura')
  } finally {
    assigning.value = false
  }
}

// immediate: el modal también se MONTA con el roomId ya seteado (v-if desde el gestor de la
// página de cerraduras y el ⚙️ del detalle de reserva) — sin immediate el watch no dispara y
// el modal abría mostrando "Sin cerradura asignada" aunque la tuviera.
watch(() => props.roomId, (id) => {
  if (id) { tab.value = 'device'; fijoCode.value = ''; fijoName.value = ''; assignLockId.value = ''; showReassign.value = false; load() }
}, { immediate: true })
</script>
