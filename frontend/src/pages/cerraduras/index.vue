<template>
  <div>
    <!-- Hero de mando global: estado y acciones que aplican a TODAS las cerraduras del hotel -->
    <div class="rounded-[20px] border-2 border-navy bg-navy shadow-(--shadow-card) px-5 sm:px-6 py-5 mb-6">
      <div class="flex flex-wrap items-center gap-x-5 gap-y-4">
        <!-- Candado grande: identidad de la página (feedback del dueño) -->
        <svg class="h-[46px] w-[46px] shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 14.5v2.5"/></svg>
        <div class="min-w-0">
          <h2 class="text-2xl font-black text-white leading-none">Cerraduras TTLock</h2>
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            <p class="text-[11px] text-white/60">Gestión de cerraduras electrónicas y códigos de acceso</p>
            <span class="text-[10px] font-bold px-2.5 py-1 rounded-full" :class="ttlockConfig.connected ? 'bg-teal-light/15 text-teal-light' : ttlockConfig.configured ? 'bg-gold-light/15 text-gold-light' : 'bg-coral-light/15 text-coral-light'">{{ ttlockConfig.connected ? '● Conectado' : ttlockConfig.configured ? 'Falta conectar' : 'Pendiente' }}</span>
          </div>
        </div>

        <!-- KPIs globales, calculados de lo ya cargado (sin requests nuevos) -->
        <div class="flex flex-wrap items-center gap-2 ml-auto">
          <span class="inline-flex items-center gap-1.5 bg-white/10 text-white text-xs font-bold px-3 py-1.5 rounded-full">
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="onlineLocks ? 'bg-teal-light' : 'bg-white/40'"></span>
            {{ locks.length }} {{ locks.length === 1 ? 'cerradura' : 'cerraduras' }}
            <span class="text-white/50 font-semibold">· {{ onlineLocks }} en línea</span>
          </span>
          <span v-if="minBattery != null" class="inline-flex items-center gap-1.5 bg-white/10 text-white text-xs font-bold px-3 py-1.5 rounded-full tabular-nums" :title="`Batería más baja del hotel`">
            <svg class="h-3.5 w-3.5 shrink-0" :class="minBatteryClass" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10.5v3"/></svg>
            {{ minBattery }}% mínima
          </span>
          <span class="inline-flex items-center gap-1.5 bg-white/10 text-white text-xs font-bold px-3 py-1.5 rounded-full tabular-nums">
            {{ vigenteCodesCount }} {{ vigenteCodesCount === 1 ? 'código activo' : 'códigos activos' }}
          </span>
          <span class="inline-flex items-center gap-1.5 bg-white/10 text-white text-xs font-bold px-3 py-1.5 rounded-full tabular-nums" title="Revocados y vencidos: no abren ninguna puerta, se pueden borrar">
            {{ historicCodesCount }} {{ historicCodesCount === 1 ? 'histórico' : 'históricos' }}
          </span>
        </div>
      </div>

      <!-- Toolbar de acciones globales -->
      <div class="flex flex-wrap items-center gap-2.5 mt-4 pt-4 border-t border-white/10">
        <button @click="syncLocks" :disabled="syncing"
          class="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-navy text-sm font-bold hover:bg-white/90 transition-colors cursor-pointer disabled:opacity-50">
          <svg class="h-[18px] w-[18px]" :class="syncing ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
          {{ syncing ? 'Sincronizando…' : 'Sincronizar' }}
        </button>
        <button @click="purgeAllHistoricos" :disabled="!historicCodesCount || purgingAll"
          class="flex items-center gap-2 px-4 py-2 rounded-full border border-coral/50 text-coral-light text-sm font-bold hover:bg-coral hover:border-coral hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-coral-light">
          <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          {{ purgingAll ? 'Borrando…' : `Borrar ${historicCodesCount} ${historicCodesCount === 1 ? 'histórico' : 'históricos'}` }}
        </button>
        <span v-if="historicCodesCount" class="text-[11px] text-white/45">Borra revocados y vencidos de todas las cerraduras — no afecta vigentes</span>
      </div>
    </div>

    <!-- KPIs — sólo tienen sentido cuando ya hay cerraduras sincronizadas -->
    <div v-if="locks.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Cerraduras" :value="locks.length" icon="building" accent="blue"
        :unit="`${onlineLocks} en línea · ${locks.length - onlineLocks} sin conexión`" :progress="onlineShare" />
      <KpiHeroCard label="Asignadas a habitación" :value="mappedLocks" icon="bed" accent="purple"
        unit="Listas para generar códigos" :progress="mappedShare" />
      <KpiHeroCard label="Códigos activos" :value="activeCodesCount" icon="bookings" accent="teal"
        :unit="`${lockCodes.length} códigos registrados`" />
      <KpiHeroCard label="Batería baja" :value="lowBatteryLocks" icon="checkout" accent="amber"
        :unit="`Menos de ${LOW_BATTERY_THRESHOLD}% de carga`" />
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 mb-6 border-b border-border overflow-x-auto">
      <button v-for="t in tabs" :key="t.key" @click="selectTab(t.key)"
        class="px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
        :class="tab === t.key ? 'border-navy text-navy' : 'border-transparent text-text-muted hover:text-navy'">
        {{ t.label }}
        <span v-if="t.badge != null" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums" :class="tab === t.key ? 'bg-navy/10 text-navy' : 'bg-surface text-text-muted'">{{ t.badge }}</span>
      </button>
    </div>

    <!-- ── TAB: Configuración ── -->
    <div v-show="tab === 'config'">
      <SectionCard title="Configuración TTLock" subtitle="Credenciales de la cuenta del hotel en open.ttlock.com">
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label for="cerraduras-client-id" class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Client ID</label>
            <input id="cerraduras-client-id" name="clientId" v-model="ttlockConfig.clientId" type="text" placeholder="De open.ttlock.com" class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
          </div>
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Client Secret</label>
            <!-- autocomplete="new-password": credencial de la integración, NO la del usuario. Sin
                 esto Chrome pegaba acá la contraseña guardada de SolmiOS (GH-32). -->
            <input v-model="ttlockConfig.clientSecret" type="password" :placeholder="ttlockConfig.hasSecret ? '•••••••• (guardado)' : 'Pegá el Client Secret'"
              autocomplete="new-password" name="ttlock-client-secret"
              class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
            <p v-if="ttlockConfig.hasSecret" class="text-[10px] text-text-muted mt-1 ml-4">Guardado. Dejalo vacío para conservarlo.</p>
          </div>
          <div>
            <label for="cerraduras-usuario-ttlock" class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Usuario TTLock</label>
            <input id="cerraduras-usuario-ttlock" name="username" v-model="ttlockConfig.username" type="text" placeholder="Usuario de la cuenta TTLock del hotel" class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
          </div>
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Contraseña TTLock</label>
            <!-- Contraseña de la cuenta TTLock del hotel, no la del usuario logueado: new-password
                 para que el gestor no la pise (GH-32). -->
            <input v-model="ttlockConfig.password" type="password" :placeholder="ttlockConfig.hasPassword ? '•••••••• (guardada)' : 'Contraseña de la cuenta TTLock'"
              autocomplete="new-password" name="ttlock-password"
              class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
            <p v-if="ttlockConfig.hasPassword" class="text-[10px] text-text-muted mt-1 ml-4">Guardada. Dejala vacía para conservarla.</p>
          </div>
          <div>
            <label for="cerraduras-region" class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Región</label>
            <select id="cerraduras-region" name="region" v-model="ttlockConfig.region" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
              <option value="eu">Europa (eu)</option>
              <option value="us">EE.UU. (us)</option>
              <option value="cn">China (cn)</option>
            </select>
          </div>
          <div>
            <label for="cerraduras-account-id-email" class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Account ID / Email</label>
            <input id="cerraduras-account-id-email" name="accountId" v-model="ttlockConfig.accountId" type="text" placeholder="email@ejemplo.com" class="w-full px-4 py-2.5 rounded-full border border-border text-sm" />
          </div>
          <div class="md:col-span-2">
            <label for="cerraduras-entrega-del-codigo" class="block text-[10px] font-bold text-text-muted uppercase tracking-wide mb-1">Entrega del código</label>
            <select id="cerraduras-entrega-del-codigo" name="addType" v-model.number="ttlockConfig.addType" class="w-full px-4 py-2.5 rounded-full border border-border text-sm cursor-pointer">
              <option :value="2">Gateway (remoto)</option>
              <option :value="1">Bluetooth (app en la puerta)</option>
              <option :value="3">NB-IoT</option>
            </select>
            <p class="text-[10px] text-text-muted mt-1 ml-4">Sin gateway, el PIN solo llega con un teléfono al lado de la cerradura.</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 mt-6 pt-5 border-t border-border">
          <button @click="saveTtlockConfig" :disabled="saving || connecting" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50">{{ saving ? 'Guardando...' : 'Guardar Config' }}</button>
          <button @click="connectTtlock" :disabled="saving || connecting" class="px-5 py-2.5 bg-teal text-white rounded-full text-sm font-bold hover:bg-teal-light transition-all cursor-pointer disabled:opacity-50">{{ connecting ? 'Conectando...' : 'Conectar' }}</button>
          <p class="text-[10px] text-text-muted ml-auto">Registrate en <a href="https://open.ttlock.com" target="_blank" class="text-cyan underline">open.ttlock.com</a> → Crea una App OAuth → Copia Client ID y Secret aquí</p>
        </div>
      </SectionCard>
    </div>

    <!-- ── TAB: Cerraduras ── -->
    <div v-show="tab === 'locks'" class="space-y-6">
      <SectionCard title="Dispositivos" :subtitle="`${locks.length} cerradura(s) sincronizada(s)`" body-class="p-0">
        <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 sm:p-5">
          <div v-for="i in 4" :key="i" class="h-48 animate-pulse rounded-2xl bg-surface"></div>
        </div>

        <EmptyState
          v-else-if="!locks.length"
          :icon="ICON_LOCK_EMPTY"
          :title="ttlockConfig.connected ? 'Todavía no hay cerraduras' : 'TTLock no está conectado'"
          :message="ttlockConfig.connected ? 'La cuenta está conectada pero no se trajo ningún dispositivo. Tocá Sincronizar para volver a leer la cuenta TTLock.' : 'Cargá las credenciales en la pestaña Configuración y conectá la cuenta para traer las cerraduras del hotel.'"
        >
          <template #action>
            <button v-if="ttlockConfig.connected" @click="syncLocks" :disabled="syncing" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
              {{ syncing ? 'Sincronizando...' : 'Sincronizar' }}
            </button>
            <button v-else @click="selectTab('config')" class="px-5 py-2.5 bg-navy text-white rounded-full text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer">
              Ir a Configuración
            </button>
          </template>
        </EmptyState>

        <!-- Grid de cards por habitación: la habitación es la identidad de la card
             y el candado el ícono grande (feedback del dueño). El nombre técnico de
             la cerradura queda como detalle chico; la MAC vive en el tooltip. -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 sm:p-5">
          <div v-for="lock in locks" :key="lock.id"
            class="rounded-2xl border border-border/70 bg-white p-4 transition-colors hover:border-navy/30">

            <!-- Identidad: candado grande + habitación protagonista -->
            <div class="flex items-center gap-3.5">
              <svg
                class="h-[38px] w-[38px] shrink-0 transition-colors"
                :class="lock.roomId && lock.status === 'online' ? 'text-teal' : 'text-text-muted'"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 14.5v2.5"/>
              </svg>
              <div class="min-w-0">
                <div class="font-black leading-none tracking-tight truncate"
                  :class="lock.roomId ? 'text-3xl text-navy' : 'text-2xl text-text-muted'"
                  :title="lock.roomId ? `Habitación ${lock.roomNumber}` : 'Cerradura sin habitación asignada'">
                  {{ lock.roomId ? (lock.roomNumber && lock.roomNumber !== '—' ? `HAB ${lock.roomNumber}` : 'HAB ?') : 'Sin habitación' }}
                </div>
                <div class="mt-1.5 truncate font-mono text-[11px] text-text-muted" :title="lock.mac || lock.name">{{ lock.name || 'Sin nombre' }}</div>
              </div>
            </div>

            <!-- Estado del hardware: conexión + batería -->
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                :class="lock.status === 'online' ? 'bg-teal/10 text-teal' : 'bg-navy/5 text-text-muted'">
                <span class="h-1.5 w-1.5 rounded-full" :class="lock.status === 'online' ? 'bg-teal' : 'bg-text-muted/40'"></span>
                {{ lock.status === 'online' ? 'En línea' : 'Sin conexión' }}
              </span>
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold tabular-nums" :class="batteryClass(lock.batteryLevel)">
                <svg class="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10.5v3"/></svg>
                {{ lock.batteryLevel || 0 }}%
              </span>
            </div>

            <!-- Asignada: operar. Cambiar/desasignar la habitación vive en Gestionar (RoomLockModal). -->
            <div v-if="lock.roomId" class="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              <button @click="manageLock(lock)" title="Gestionar cerradura"
                class="inline-flex items-center gap-1.5 rounded-lg bg-navy/5 px-2.5 py-1.5 text-[11px] font-bold text-navy transition-colors hover:bg-navy/10 cursor-pointer">
                <span class="h-4 w-4" v-html="ICON_SETTINGS"></span>
                Gestionar
              </button>
              <button @click="viewCodes(lock)" title="Ver códigos guardados"
                class="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-navy/30 hover:text-navy cursor-pointer">
                <span class="h-4 w-4" v-html="ICON_KEY"></span>
                Códigos
              </button>
              <button @click="inspectLock(lock)" title="Verificar hardware"
                class="grid h-7 w-7 place-items-center rounded-lg border border-border text-text-muted transition-colors hover:border-navy/30 hover:text-navy cursor-pointer">
                <span class="h-4 w-4" v-html="ICON_SEARCH"></span>
              </button>
            </div>

            <!-- Sin habitación: no se puede operar (igual que antes, solo el aviso),
                 pero acá mismo se le asigna una. Verificar hardware no requiere habitación. -->
            <div v-else>
              <p class="mt-4 text-[11px] font-semibold text-text-muted">Asignale una habitación para operarla</p>
              <div class="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <select :id="`cerradura-${lock.id}-habitacion`" :aria-label="`Asignar habitación a la cerradura ${lock.name || lock.id}`" @change="mapLock(lock, ($event.target as HTMLSelectElement).value)"
                  class="min-w-0 flex-1 cursor-pointer rounded-lg border border-border px-3 py-2 text-xs">
                  <option value="">Elegir habitación…</option>
                  <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.number }} - {{ r.type }}</option>
                </select>
                <button @click="inspectLock(lock)" title="Verificar hardware"
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-text-muted transition-colors hover:border-navy/30 hover:text-navy cursor-pointer">
                  <span class="h-4 w-4" v-html="ICON_SEARCH"></span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Códigos de acceso" :subtitle="`${lockCodes.length} código(s) en la base de datos · ${activeCodesCount} activo(s)`" body-class="p-0">
        <div v-if="loading" class="p-4 space-y-2">
          <div v-for="i in 3" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
        </div>

        <EmptyState
          v-else-if="!lockCodes.length"
          :icon="ICON_KEY_EMPTY"
          title="Todavía no se generó ningún código"
          message="Los PIN se crean solos al pagarse la seña de una reserva cuya habitación tiene cerradura asignada, o a mano desde la reserva."
        />

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[880px] tbl-head">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Cerradura</th>
                <th class="text-left px-4 py-3 text-[10px]">Código</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Reserva</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Válido</th>
                <th class="text-center px-4 py-3 text-[10px]">Estado</th>
                <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="code in lockCodes" :key="code.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3 text-xs text-text-secondary">{{ getLockName(code.lockId) }}</td>
                <td class="px-4 py-3">
                  <div class="text-sm font-black font-mono text-navy tabular-nums">{{ code.code }}</div>
                  <div v-if="code.startDate || code.endDate" class="text-[11px] text-text-muted lg:hidden">{{ code.startDate }} → {{ code.endDate }}</div>
                </td>
                <td class="px-4 py-3 hidden lg:table-cell">
                  <span v-if="code.reservationId" class="text-xs font-mono text-text-secondary">{{ code.reservationId.slice(0, 8) }}…</span>
                  <span v-else class="text-xs text-text-muted">Sin reserva</span>
                </td>
                <td class="px-4 py-3 hidden lg:table-cell">
                  <span v-if="code.startDate || code.endDate" class="text-xs text-text-secondary">{{ code.startDate }} → {{ code.endDate }}</span>
                  <span v-else class="text-xs text-text-muted">Sin límite</span>
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="code.status==='active' ? 'bg-teal/10 text-teal' : 'bg-navy/5 text-text-muted'">{{ code.status === 'active' ? 'Activo' : 'Revocado' }}</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <button v-if="code.status==='active'" @click="revokeCode(code)" title="Revocar código"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-coral/10 hover:text-coral transition-colors cursor-pointer ml-auto">
                    <span class="h-4 w-4" v-html="ICON_BAN"></span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- ── TAB: Gateways ── -->
    <div v-show="tab === 'gateways'">
      <SectionCard title="Gateways" subtitle="Puentes que permiten enviar el PIN a la cerradura de forma remota">
        <template #actions>
          <button @click="loadGateways" :disabled="gatewaysLoading"
            class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-bold text-white hover:bg-white/15 transition-colors cursor-pointer disabled:opacity-50">
            {{ gatewaysLoading ? 'Cargando...' : 'Actualizar' }}
          </button>
        </template>

        <div v-if="gatewaysLoading" class="grid sm:grid-cols-2 gap-3">
          <div v-for="i in 2" :key="i" class="h-32 animate-pulse rounded-2xl bg-surface"></div>
        </div>

        <EmptyState
          v-else-if="!gateways.length"
          :icon="ICON_GATEWAY_EMPTY"
          title="Sin gateways detectados"
          message="La cuenta TTLock no reporta ningún gateway. Sin uno, el PIN solo se puede cargar por Bluetooth con un teléfono al lado de la cerradura."
        />

        <div v-else class="grid sm:grid-cols-2 gap-3">
          <div v-for="g in gateways" :key="g.gatewayId" class="rounded-2xl border border-border p-4">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="font-bold text-navy text-sm truncate">{{ g.gatewayName || ('Gateway ' + g.gatewayId) }}</span>
              <span class="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full" :class="g.isOnline ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">{{ g.isOnline ? 'En línea' : 'Sin conexión' }}</span>
            </div>
            <div class="space-y-1 text-xs">
              <div v-if="g.networkName" class="flex justify-between gap-3"><span class="text-text-muted">Red WiFi</span><span class="text-text-secondary truncate">{{ g.networkName }}</span></div>
              <div v-if="g.gatewayMac" class="flex justify-between gap-3"><span class="text-text-muted">MAC</span><span class="font-mono text-text-secondary truncate">{{ g.gatewayMac }}</span></div>
              <div class="flex justify-between gap-3"><span class="text-text-muted">Cerraduras</span><span class="font-bold text-navy tabular-nums">{{ g.lockNum ?? 0 }}</span></div>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>

    <!-- ── TAB: Códigos activos (hardware) ── -->
    <div v-show="tab === 'active'">
      <SectionCard title="Comprobar códigos activos" subtitle="Lee los PIN que realmente tiene la cerradura en el hardware" body-class="p-0">
        <template #actions>
          <select id="cerraduras-active-lock" name="activeLockId" aria-label="Cerradura para códigos activos" v-model="activeLockId" class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
            <option class="text-navy" value="">Elegí una cerradura</option>
            <option class="text-navy" v-for="l in locks" :key="l.id" :value="l.id">{{ l.name || l.id }}{{ l.roomNumber && l.roomNumber !== '—' ? ` · Hab ${l.roomNumber}` : '' }}</option>
          </select>
          <button @click="checkActiveCodes" :disabled="!activeLockId || activeLoading"
            class="px-4 py-2 rounded-lg bg-cyan text-sm font-bold text-white hover:bg-cyan/85 transition-colors cursor-pointer disabled:opacity-50">
            {{ activeLoading ? 'Comprobando...' : 'Comprobar' }}
          </button>
        </template>

        <div v-if="activeLoading" class="p-4 space-y-2">
          <div v-for="i in 3" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
        </div>

        <EmptyState
          v-else-if="!activeChecked"
          :icon="ICON_SEARCH_EMPTY"
          title="Elegí una cerradura"
          message="Seleccioná el dispositivo y tocá Comprobar para leer los códigos que hoy están cargados en el hardware. Esto puede diferir de la tabla de la base de datos."
        />

        <EmptyState
          v-else-if="!activeCodes.length"
          :icon="ICON_KEY_EMPTY"
          title="Sin códigos activos"
          message="La cerradura no tiene ningún PIN vigente en este momento."
        />

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[760px] tbl-head">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Código</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Nombre</th>
                <th class="text-left px-4 py-3 text-[10px]">Tipo</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Válido</th>
                <th class="text-center px-4 py-3 text-[10px]">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in activeCodes" :key="c.keyboardPwdId" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3">
                  <div class="text-sm font-black font-mono text-navy tabular-nums">{{ c.keyboardPwd || '••••' }}</div>
                  <div v-if="c.keyboardPwdName" class="text-[11px] text-text-muted lg:hidden">{{ c.keyboardPwdName }}</div>
                </td>
                <td class="px-4 py-3 hidden lg:table-cell">
                  <span v-if="c.keyboardPwdName" class="text-xs text-text-secondary">{{ c.keyboardPwdName }}</span>
                  <span v-else class="text-xs text-text-muted">Sin nombre</span>
                </td>
                <td class="px-4 py-3 text-xs text-text-secondary">{{ pwdTypeLabel(c.keyboardPwdType) }}</td>
                <td class="px-4 py-3 hidden lg:table-cell">
                  <span v-if="c.startDate || c.endDate" class="text-xs text-text-secondary tabular-nums">{{ fmtMs(c.startDate) }} → {{ fmtMs(c.endDate) }}</span>
                  <span v-else class="text-xs text-text-muted">Sin límite</span>
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="c.status === 1 ? 'bg-teal/10 text-teal' : 'bg-navy/5 text-text-muted'">{{ c.status === 1 ? 'Válido' : 'Inactivo' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- ── TAB: Registros (actividad del hardware) ── -->
    <div v-show="tab === 'records'">
      <SectionCard title="Registros de la cerradura" subtitle="Aperturas e intentos de los últimos 30 días, leídos del hardware" body-class="p-0">
        <template #actions>
          <select id="cerraduras-records-lock" name="recordsLockId" aria-label="Cerradura para historial de aperturas" v-model="recordsLockId" class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
            <option class="text-navy" value="">Elegí una cerradura</option>
            <option class="text-navy" v-for="l in locks" :key="l.id" :value="l.id">{{ l.name || l.id }}{{ l.roomNumber && l.roomNumber !== '—' ? ` · Hab ${l.roomNumber}` : '' }}</option>
          </select>
          <button @click="checkRecords" :disabled="!recordsLockId || recordsLoading"
            class="px-4 py-2 rounded-lg bg-cyan text-sm font-bold text-white hover:bg-cyan/85 transition-colors cursor-pointer disabled:opacity-50">
            {{ recordsLoading ? 'Cargando...' : 'Ver historial' }}
          </button>
        </template>

        <div v-if="recordsLoading" class="p-4 space-y-2">
          <div v-for="i in 5" :key="i" class="h-12 animate-pulse rounded-lg bg-surface"></div>
        </div>

        <EmptyState
          v-else-if="!recordsChecked"
          :icon="ICON_SEARCH_EMPTY"
          title="Elegí una cerradura"
          message="Seleccioná el dispositivo y tocá Ver historial para traer las aperturas registradas por el hardware."
        />

        <EmptyState
          v-else-if="!records.length"
          :icon="ICON_CLOCK_EMPTY"
          title="Sin actividad"
          message="La cerradura no registró aperturas ni intentos en los últimos 30 días."
        />

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[720px] tbl-head">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Fecha</th>
                <th class="text-left px-4 py-3 text-[10px]">Evento</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Quién entró</th>
                <th class="text-center px-4 py-3 text-[10px]">Resultado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in records" :key="r.recordId" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3 text-xs text-text-secondary tabular-nums whitespace-nowrap">{{ fmtMs(r.lockDate) }}</td>
                <td class="px-4 py-3">
                  <div class="text-xs font-bold text-navy">{{ recordTypeLabel(r.recordType) }}</div>
                  <div v-if="r.holder || actorOf(r)" class="text-[11px] text-text-muted lg:hidden">{{ r.holder || actorOf(r) }}</div>
                </td>
                <!-- El hardware solo dice el número; el backend lo cruza con los
                     códigos del hotel para poder mostrar de quién era. -->
                <td class="px-4 py-3 hidden lg:table-cell">
                  <div v-if="r.holder" class="flex items-center gap-1.5">
                    <span class="text-xs font-bold text-navy">{{ r.holder }}</span>
                    <span
                      v-if="r.holderType"
                      class="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                      :class="r.holderType === 'master' ? 'bg-purple-light/15 text-purple' : 'bg-cyan/10 text-cyan'"
                    >{{ r.holderType === 'master' ? 'Maestra' : 'Huésped' }}</span>
                  </div>
                  <span v-else-if="actorOf(r)" class="text-xs text-text-secondary" :class="r.keyboardPwd ? 'font-mono' : ''">{{ actorOf(r) }}</span>
                  <span v-else class="text-xs text-text-muted">Sin identificar</span>
                  <div v-if="r.holder && r.keyboardPwd" class="text-[10px] text-text-muted font-mono tabular-nums">PIN {{ r.keyboardPwd }}</div>
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="r.success === 1 ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">{{ r.success === 1 ? 'OK' : 'Falló' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- Llaves maestras: un PIN por persona que abre TODAS las puertas -->
    <div v-show="tab === 'master'">
      <SectionCard
        title="Llaves maestras"
        :subtitle="`${masterKeys.length} llave(s) · abren las ${locks.length} cerradura(s) del hotel`"
        body-class="p-0"
      >
        <template #actions>
          <button
            @click="openNewMasterKey()"
            class="px-4 py-2 rounded-full bg-white/10 border border-white/15 text-white text-xs font-bold hover:bg-white/20 transition-colors cursor-pointer"
          >+ Nueva llave</button>
        </template>

        <EmptyState
          v-if="!masterKeys.length"
          title="Sin llaves maestras"
          message="Una llave maestra le da a una persona un PIN que abre todas las puertas del hotel, y deja registrado por dónde entró."
        />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[820px] tbl-head">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Persona</th>
                <th class="text-left px-4 py-3 text-[10px]">PIN</th>
                <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Puertas</th>
                <th class="text-center px-4 py-3 text-[10px]">Estado</th>
                <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in masterKeys" :key="k.masterKeyId" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3">
                  <div class="text-sm font-bold text-navy">{{ personName(k.userId) }}</div>
                  <div class="text-[11px] text-text-muted">{{ k.label }}</div>
                </td>
                <td class="px-4 py-3">
                  <code class="text-sm font-black font-mono text-navy tabular-nums">{{ k.code }}</code>
                </td>
                <td class="px-4 py-3 hidden lg:table-cell text-xs text-text-secondary tabular-nums">
                  {{ k.locksApplied }} de {{ k.locksTotal }}
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="text-[10px] font-bold px-2 py-1 rounded-full" :class="masterStatusClass(k.status)">
                    {{ masterStatusLabel(k.status) }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center justify-end gap-1.5">
                    <button
                      @click="openKeyLocks(k)"
                      class="px-3 py-1.5 rounded-lg border border-border text-[11px] font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer"
                    >Puertas</button>
                    <button
                      @click="openAccessLog(k)"
                      class="px-3 py-1.5 rounded-lg border border-border text-[11px] font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer"
                    >¿Dónde entró?</button>
                    <button
                      v-if="k.status !== 'revoked'"
                      @click="revokeMasterKey(k)"
                      class="px-3 py-1.5 rounded-lg bg-coral/10 text-coral text-[11px] font-bold hover:bg-coral/20 transition-colors cursor-pointer"
                    >Revocar</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- Alta de llave maestra -->
    <AppModal
      v-if="newMasterKeyOpen" size="md" title="Nueva llave maestra"
      subtitle="El mismo PIN se graba en todas las cerraduras del hotel"
      @close="newMasterKeyOpen = false"
    >
      <div class="space-y-4">
        <div>
          <label for="cerraduras-persona" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">Persona *</label>
          <select id="cerraduras-persona" name="userId" required aria-required="true" v-model="newMasterKey.userId" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
            <option value="">Seleccionar...</option>
            <option v-for="p in staff" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div>
          <label for="cerraduras-pin-opcional" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">PIN (opcional)</label>
          <input id="cerraduras-pin-opcional" name="code"
            v-model="newMasterKey.code" inputmode="numeric" maxlength="9"
            class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm font-mono tabular-nums focus:outline-none focus:border-navy"
            placeholder="Se genera solo si lo dejás vacío"
          >
          <p class="text-[11px] text-text-muted mt-1">Entre 4 y 9 dígitos.</p>
        </div>
        <p class="text-[11px] text-text-secondary bg-surface rounded-xl p-3">
          Esta llave abre <strong>todas</strong> las puertas y no vence: se corta revocándola.
        </p>
      </div>
      <template #footer>
        <button @click="newMasterKeyOpen = false" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <button
          @click="createMasterKey()" :disabled="!newMasterKey.userId || creatingMasterKey"
          class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >{{ creatingMasterKey ? 'Grabando en las cerraduras…' : 'Crear llave' }}</button>
      </template>
    </AppModal>

    <!-- Qué puertas abre esta llave: se suman y se quitan de a una -->
    <AppModal
      v-if="keyLocksModal" size="md"
      :title="`Puertas de ${personName(keyLocksModal.key.userId)}`"
      :subtitle="`PIN ${keyLocksModal.key.code} · el mismo en todas`"
      @close="keyLocksModal = null"
    >
      <div v-if="keyLocksLoading" class="flex items-center gap-2 text-xs text-text-muted py-6 justify-center">
        <span class="w-4 h-4 rounded-full border-2 border-border border-t-cyan animate-spin"></span>
        Cargando…
      </div>
      <div v-else class="space-y-1.5">
        <div
          v-for="l in keyLocksModal.locks" :key="l.lockId"
          class="flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors"
          :class="l.applied ? 'border-teal/30 bg-teal/5' : 'border-border'"
        >
          <span class="w-2 h-2 rounded-full shrink-0" :class="l.applied ? 'bg-teal' : 'bg-border'"></span>
          <span class="text-sm font-bold text-navy flex-1 truncate">{{ l.lockName }}</span>
          <span class="text-[11px] shrink-0" :class="l.applied ? 'text-teal font-bold' : 'text-text-muted'">
            {{ l.applied ? 'Abre' : 'No abre' }}
          </span>
          <button
            @click="toggleKeyLock(l)"
            :disabled="togglingLock === l.lockId"
            class="px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 transition-colors cursor-pointer disabled:opacity-50"
            :class="l.applied ? 'bg-coral/10 text-coral hover:bg-coral/20' : 'bg-navy text-white hover:bg-navy-light'"
          >{{ togglingLock === l.lockId ? '…' : l.applied ? 'Quitar' : 'Agregar' }}</button>
        </div>
      </div>
      <template #footer>
        <button @click="keyLocksModal = null" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>

    <!-- Dónde entró esa persona -->
    <AppModal
      v-if="accessLogModal" size="lg"
      :title="`Accesos de ${personName(accessLogModal.key.userId)}`"
      :subtitle="`PIN ${accessLogModal.key.code} · últimos 30 días`"
      @close="accessLogModal = null"
    >
      <div v-if="accessLogLoading" class="flex items-center gap-2 text-xs text-text-muted py-6 justify-center">
        <span class="w-4 h-4 rounded-full border-2 border-border border-t-cyan animate-spin"></span>
        Consultando las cerraduras…
      </div>
      <div v-else-if="!accessLogModal.entries.length" class="text-center py-8">
        <p class="text-sm font-bold text-navy">Sin aperturas registradas</p>
        <p class="text-xs text-text-muted mt-1">Esta persona todavía no usó su llave en ninguna puerta.</p>
      </div>
      <div v-else class="space-y-1.5">
        <div
          v-for="(e, i) in accessLogModal.entries" :key="i"
          class="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
        >
          <span class="w-2 h-2 rounded-full shrink-0" :class="e.success ? 'bg-teal' : 'bg-coral'"></span>
          <span class="text-sm font-bold text-navy flex-1 truncate">{{ e.lockName }}</span>
          <span v-if="!e.success" class="text-[10px] font-bold text-coral uppercase">No abrió</span>
          <span class="text-[11px] text-text-muted tabular-nums shrink-0">{{ formatAccessDate(e.at) }}</span>
        </div>
      </div>
      <template #footer>
        <button @click="accessLogModal = null" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>

    <!-- Modal códigos BD por cerradura -->
    <AppModal v-if="codesModal" size="md" :title="`Códigos de ${codesModal.lockName}`"
      :subtitle="`${codesModal.codes.length} código(s) en la base de datos`" @close="codesModal = null">
      <div class="space-y-2">
        <div v-for="(c, i) in codesModal.codes" :key="i" class="flex items-center gap-2 bg-surface rounded-full px-3 py-2">
          <code class="flex-1 text-sm font-mono font-bold text-navy tabular-nums">{{ c.code }}</code>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" :class="c.status === 'active' ? 'bg-teal/10 text-teal' : 'bg-navy/5 text-text-muted'">{{ c.status === 'active' ? 'Activo' : 'Revocado' }}</span>
          <span v-if="c.startDate || c.endDate" class="text-[10px] text-text-muted shrink-0 tabular-nums">{{ c.startDate || '?' }} → {{ c.endDate || '?' }}</span>
        </div>
      </div>
      <template #footer>
        <button @click="codesModal = null" class="px-5 py-2.5 rounded-full bg-navy text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>

    <!-- Gestión completa de la cerradura (abrir remoto, códigos fijos, PINs del hardware,
         auto-códigos, gateways). Es el mismo modal que usa el planning: sin esto la página
         de cerraduras solo leía y había que ir al calendario para operar (feedback #398). -->
    <RoomLockModal
      v-if="lockRoom"
      :room-id="lockRoom.id"
      :room-number="lockRoom.number"
      :reservation-id="lockRoom.reservationId"
      @close="lockRoom = null"
      @changed="load()"
    />

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import { TTLockService, type TTLockConfig, type LockGateway, type LockActiveCode, type LockRecord, type MasterKey, type MasterKeyAccess, type MasterKeyLock } from '@/services/TTLock.service'
import { TeamService } from '@/services/Team.service'
import { OperationsService } from '@/services/Operations.service'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import RoomLockModal from '@/components/features/RoomLockModal.vue'

const auth = useAuthStore()
const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onError: (e) => toast.error('No se pudo revocar', (e as any)?.message),
})
const hid = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

type Tab = 'config' | 'locks' | 'gateways' | 'active' | 'records' | 'master'
const tab = ref<Tab>('locks')

const syncing = ref(false)
const saving = ref(false)
const loading = ref(true)
const locks = ref<any[]>([])
const rooms = ref<any[]>([])
const lockCodes = ref<any[]>([])
const ttlockConfig = ref({ clientId: '', clientSecret: '', username: '', password: '', region: 'eu', accountId: '', addType: 2, configured: false, connected: false, hasSecret: false, hasPassword: false })
const connecting = ref(false)

const codesModal = ref<{ lockName: string; codes: { code: string; status: string; startDate: string; endDate: string }[] } | null>(null)

// Gestión completa de una cerradura, reusando el modal del planning (feedback #398).
const lockRoom = ref<{ id: string; number: string; reservationId: string | null } | null>(null)

/**
 * El modal necesita la reserva en curso para poder generar el código del huésped.
 * Acá no tenemos el calendario cargado, así que se resuelve on-demand: la reserva
 * activa es la que cubre el día de hoy en esa habitación. Si no hay (o falla la
 * consulta) el modal igual abre — solo queda sin la acción de generar código.
 */
async function activeReservationId(roomId: string): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const d = await OperationsService.planning(hid.value)
    const res = (d?.reservas ?? []).find((b: any) =>
      String(b.roomId) === String(roomId) &&
      b.status !== 'cancelled' &&
      today >= String(b.checkIn || '').slice(0, 10) &&
      today < String(b.checkOut || '').slice(0, 10),
    )
    return res?.id ? String(res.id) : null
  } catch { return null }
}

async function manageLock(lock: any) {
  const room = rooms.value.find((r: any) => String(r.id) === String(lock.roomId))
  if (!room) { toast.error('La habitación asignada a esta cerradura ya no existe'); return }
  lockRoom.value = {
    id: String(room.id),
    number: String(room.number ?? ''),
    reservationId: await activeReservationId(String(room.id)),
  }
}

// Gateways
const gateways = ref<LockGateway[]>([])
const gatewaysLoading = ref(false)
const gatewaysLoaded = ref(false)

// Códigos activos (hardware)
const activeLockId = ref('')
const activeCodes = ref<LockActiveCode[]>([])
const activeLoading = ref(false)
const activeChecked = ref(false)

// Registros de actividad (hardware)
const recordsLockId = ref('')
const records = ref<LockRecord[]>([])
const recordsLoading = ref(false)
const recordsChecked = ref(false)

// KPIs derivados de los datos ya cargados (no hay endpoint de stats)
const LOW_BATTERY_THRESHOLD = 20
const onlineLocks = computed(() => locks.value.filter(l => l.status === 'online').length)
const mappedLocks = computed(() => locks.value.filter(l => !!l.roomId).length)
const activeCodesCount = computed(() => lockCodes.value.filter((c: any) => c.status === 'active').length)
const lowBatteryLocks = computed(() => locks.value.filter(l => (l.batteryLevel || 0) <= LOW_BATTERY_THRESHOLD).length)
const onlineShare = computed(() => (locks.value.length ? Math.round((onlineLocks.value / locks.value.length) * 100) : 0))
const mappedShare = computed(() => (locks.value.length ? Math.round((mappedLocks.value / locks.value.length) * 100) : 0))

// KPIs del hero (mando global de la página principal) — de lo ya cargado, sin requests nuevos.
const vigenteCodesCount = computed(() => lockCodes.value.filter((c: any) => c.status === 'active' || c.status === 'pending').length)
const historicCodesCount = computed(() => lockCodes.value.filter((c: any) => c.status === 'revoked' || c.status === 'expired').length)
/** Batería más baja del hotel (null sin cerraduras → el chip no se muestra). */
const minBattery = computed(() => (locks.value.length ? Math.min(...locks.value.map((l: any) => l.batteryLevel ?? 0)) : null))
const minBatteryClass = computed(() => {
  const v = minBattery.value
  if (v == null) return ''
  if (v > 50) return 'text-teal-light'
  if (v > LOW_BATTERY_THRESHOLD) return 'text-gold-light'
  return 'text-coral-light'
})

function batteryClass(level?: number) {
  const v = level || 0
  if (v > 50) return 'bg-teal/10 text-teal'
  if (v > LOW_BATTERY_THRESHOLD) return 'bg-gold/10 text-gold'
  return 'bg-coral/10 text-coral'
}

/** Quién abrió: el PIN usado, o el nombre de la llave/usuario. Vacío si no hay dato. */
function actorOf(r: LockRecord) {
  return r.keyboardPwd || r.keyName || r.username || ''
}

const tabs = computed(() => [
  { key: 'config' as Tab, label: 'Configuración', badge: null as number | null },
  { key: 'locks' as Tab, label: 'Cerraduras', badge: locks.value.length },
  { key: 'gateways' as Tab, label: 'Gateways', badge: gatewaysLoaded.value ? gateways.value.length : null },
  { key: 'active' as Tab, label: 'Códigos activos', badge: null as number | null },
  { key: 'records' as Tab, label: 'Registros', badge: null as number | null },
  { key: 'master' as Tab, label: 'Llaves maestras', badge: masterKeysLoaded.value ? masterKeys.value.length : null },
])

function selectTab(k: Tab) {
  tab.value = k
  if (k === 'gateways' && !gatewaysLoaded.value) loadGateways()
  if (k === 'master' && !masterKeysLoaded.value) loadMasterKeys()
}

// ─── Llaves maestras ────────────────────────────────────────────────────────
// Un PIN por PERSONA, grabado en todas las cerraduras. Los nombres se resuelven
// contra /usuarios: las llaves guardan `users.id`, no perfiles de RRHH.
const masterKeys = ref<MasterKey[]>([])
const masterKeysLoaded = ref(false)
const staff = ref<{ id: string; name: string }[]>([])
const newMasterKeyOpen = ref(false)
const newMasterKey = ref<{ userId: string; code: string }>({ userId: '', code: '' })
const creatingMasterKey = ref(false)
const accessLogModal = ref<{ key: MasterKey; entries: MasterKeyAccess[] } | null>(null)
const accessLogLoading = ref(false)

async function loadMasterKeys() {
  try {
    const r = await TTLockService.listMasterKeys()
    masterKeys.value = r.data ?? []
    masterKeysLoaded.value = true
  } catch { /* el tab queda vacío; el resto de la pantalla sigue viva */ }
  if (!staff.value.length) {
    try {
      const res = await TeamService.list() as any
      const items = Array.isArray(res) ? res : (res?.data ?? [])
      staff.value = items.map((u: any) => ({ id: u.id, name: u.name || u.email || u.id }))
    } catch { /* sin lista de personal, el alta queda deshabilitada */ }
  }
}

function personName(userId: string): string {
  return staff.value.find(s => s.id === userId)?.name || 'Usuario'
}

function openNewMasterKey() {
  newMasterKey.value = { userId: '', code: '' }
  newMasterKeyOpen.value = true
}

/**
 * Al crear, el PIN se graba puerta por puerta. Si alguna falla, se avisa cuáles:
 * el gerente tiene que saber que esa persona NO puede entrar ahí.
 */
async function createMasterKey() {
  if (!newMasterKey.value.userId) return
  creatingMasterKey.value = true
  try {
    const person = personName(newMasterKey.value.userId)
    const res = await TTLockService.createMasterKey({
      userId: newMasterKey.value.userId,
      code: newMasterKey.value.code || undefined,
      label: `Maestra · ${person}`,
    })
    newMasterKeyOpen.value = false
    if (res.failed?.length) {
      toast.error(
        `Llave ${res.code} creada en ${res.applied.length} de ${res.applied.length + res.failed.length} puertas`,
        `No entró en: ${res.failed.map(f => f.lockName).join(', ')}`,
      )
    } else {
      toast.success(`Llave ${res.code} activa en ${res.applied.length} puerta(s)`)
    }
    masterKeysLoaded.value = false
    await loadMasterKeys()
  } catch (e: any) {
    toast.error('No se pudo crear la llave', e?.message)
  } finally {
    creatingMasterKey.value = false
  }
}

function revokeMasterKey(k: MasterKey) {
  askConfirm({
    title: 'Revocar llave',
    message: `¿Revocar la llave de ${personName(k.userId)}? Dejará de abrir todas las puertas. No se puede deshacer.`,
    confirmLabel: 'Revocar', danger: true,
    run: async () => {
      const res = await TTLockService.revokeMasterKey(k.masterKeyId)
      if (res.failed?.length) {
        // Una puerta que no se pudo borrar sigue abriéndose con ese PIN: no se
        // puede reportar como revocada sin más.
        toast.error(
          `Revocada en ${res.revoked} puerta(s), pero quedó activa en otras`,
          `Revisar: ${res.failed.map(f => f.lockName).join(', ')}`,
        )
      } else {
        toast.success(`Llave revocada en ${res.revoked} puerta(s)`)
      }
      masterKeysLoaded.value = false
      await loadMasterKeys()
    },
  })
}

const keyLocksModal = ref<{ key: MasterKey; locks: MasterKeyLock[] } | null>(null)
const keyLocksLoading = ref(false)
const togglingLock = ref('')

async function openKeyLocks(k: MasterKey) {
  keyLocksModal.value = { key: k, locks: [] }
  keyLocksLoading.value = true
  try {
    const r = await TTLockService.masterKeyLocks(k.masterKeyId)
    if (keyLocksModal.value) keyLocksModal.value.locks = r.data ?? []
  } catch (e: any) {
    toast.error('No se pudieron cargar las puertas', e?.message)
  } finally {
    keyLocksLoading.value = false
  }
}

/**
 * Suma o quita UNA puerta. Se recarga el listado después: quitar una deja la
 * llave en "Parcial", y eso tiene que verse.
 */
async function toggleKeyLock(l: MasterKeyLock) {
  const modal = keyLocksModal.value
  if (!modal) return
  togglingLock.value = l.lockId
  try {
    if (l.applied) {
      await TTLockService.removeMasterKeyLock(modal.key.masterKeyId, l.lockId)
      toast.success(`${l.lockName}: la llave ya no abre`)
    } else {
      await TTLockService.addMasterKeyLock(modal.key.masterKeyId, l.lockId)
      toast.success(`${l.lockName}: la llave ya abre`)
    }
    const r = await TTLockService.masterKeyLocks(modal.key.masterKeyId)
    modal.locks = r.data ?? []
    masterKeysLoaded.value = false
    await loadMasterKeys()
    const fresh = masterKeys.value.find(k => k.masterKeyId === modal.key.masterKeyId)
    if (fresh) modal.key = fresh
  } catch (e: any) {
    toast.error('No se pudo cambiar el acceso', e?.message)
  } finally {
    togglingLock.value = ''
  }
}

async function openAccessLog(k: MasterKey) {
  accessLogModal.value = { key: k, entries: [] }
  accessLogLoading.value = true
  try {
    const r = await TTLockService.masterKeyAccessLog(k.masterKeyId)
    if (accessLogModal.value) accessLogModal.value.entries = r.data ?? []
  } catch (e: any) {
    toast.error('No se pudo leer el historial', e?.message)
  } finally {
    accessLogLoading.value = false
  }
}

function masterStatusLabel(s: MasterKey['status']): string {
  return s === 'active' ? 'Activa' : s === 'partial' ? 'Parcial' : 'Revocada'
}
function masterStatusClass(s: MasterKey['status']): string {
  return s === 'active' ? 'bg-teal/10 text-teal'
    : s === 'partial' ? 'bg-warning/10 text-warning'
    : 'bg-navy/5 text-text-muted'
}
function formatAccessDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function load() {
  loading.value = true
  try { const cfg = await TTLockService.getConfig(); ttlockConfig.value = { ...ttlockConfig.value, ...cfg, clientSecret: '', password: '' } } catch {}
  try { const r = await TTLockService.listLocks(); locks.value = r.data||[] } catch {}
  try { const r = await TTLockService.listCodes(); lockCodes.value = r.data||[] } catch {}
  try { const { RoomService } = await import('@/services/Room.service'); const res = await RoomService.list({ hotelId: hid.value }).catch(()=>({rooms:[],total:0})); rooms.value = res.rooms||[] } catch {}
  loading.value = false
}

/** El secret/password vacíos significan "no lo toques": el backend conserva el guardado. */
function configPayload(): Partial<TTLockConfig> {
  const c = ttlockConfig.value
  const payload: Partial<TTLockConfig> = {
    clientId: c.clientId, username: c.username, region: c.region,
    accountId: c.accountId, addType: c.addType,
  }
  if (c.clientSecret) payload.clientSecret = c.clientSecret
  if (c.password) payload.password = c.password
  return payload
}

async function saveTtlockConfig(): Promise<boolean> {
  saving.value = true
  try {
    await TTLockService.saveConfig(configPayload())
    await load()
    toast.success('Configuración guardada')
    return true
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar la configuración')
    return false
  } finally {
    saving.value = false
  }
}

async function connectTtlock() {
  if (!(await saveTtlockConfig())) return
  connecting.value = true
  try {
    await TTLockService.connect(configPayload())
    toast.success('TTLock conectado — sincronizando cerraduras…')
    await syncLocks()
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo conectar con TTLock')
  } finally {
    connecting.value = false
    await load()
  }
}

/** Purga GLOBAL de históricos (revoked/expired) de TODAS las cerraduras del hotel. */
const purgingAll = ref(false)
async function purgeAllHistoricos() {
  const n = historicCodesCount.value
  if (!n || purgingAll.value) return
  if (!confirm(`¿Borrar ${n} códigos históricos (revocados/vencidos) de TODAS las cerraduras? No se tocan los vigentes.`)) return
  purgingAll.value = true
  try {
    const r = await TTLockService.purgeRevokedCodesAll()
    toast.success(`${r.deleted} ${r.deleted === 1 ? 'código histórico eliminado' : 'códigos históricos eliminados'}`)
    await load()
  } catch (e) {
    toast.error((e as Error).message || 'No se pudieron borrar los códigos históricos')
  } finally {
    purgingAll.value = false
  }
}

async function syncLocks() {
  syncing.value = true
  try {
    const r = await TTLockService.sync()
    toast.success(r.message || 'Cerraduras sincronizadas')
    await load()
  } catch (e) {
    toast.error((e as Error).message || 'No se pudieron sincronizar las cerraduras')
  } finally {
    syncing.value = false
  }
}

async function mapLock(lock: any, roomId: string) {
  try {
    await TTLockService.updateLock(lock.id, { roomId })
    lock.roomId = roomId
    // La card muestra "HAB n": se actualiza el número mapeado para que el
    // cambio se vea al instante, sin recargar todo el listado.
    const room = rooms.value.find((r: any) => String(r.id) === String(roomId))
    lock.roomNumber = room?.number != null ? String(room.number) : '—'
    toast.success(roomId ? 'Cerradura asignada' : 'Cerradura desasignada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo asignar la cerradura')
  }
}

async function revokeCode(code: any) {
  try {
    await TTLockService.revokeCode(code.id)
    code.status = 'revoked'
    toast.success('Código revocado y borrado de la cerradura')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo borrar el código de la cerradura')
  }
}

function getLockName(lockId: string) {
  const lock = locks.value.find(l => l.id === lockId)
  return lock?.name || lock?.ttlockLockId || lockId.slice(0, 8)
}

/** Muestra los códigos (de la BD) asociados a una cerradura */
function viewCodes(lock: any) {
  const codes = lockCodes.value.filter((c: any) => c.lockId === lock.id)
  if (codes.length === 0) {
    toast.info(`Sin códigos para ${lock.name || lock.id}`)
    return
  }
  codesModal.value = {
    lockName: lock.name || lock.id,
    codes: codes.map((c: any) => ({ code: String(c.code), status: c.status || 'active', startDate: c.startDate || '', endDate: c.endDate || '' })),
  }
}

async function loadGateways() {
  gatewaysLoading.value = true
  try {
    const r = await TTLockService.listGateways()
    gateways.value = r.data || []
    gatewaysLoaded.value = true
  } catch (e) {
    toast.error((e as Error).message || 'No se pudieron cargar los gateways')
  } finally {
    gatewaysLoading.value = false
  }
}

const PWD_TYPE: Record<number, string> = { 1: 'Permanente', 2: 'Temporal', 3: 'Período', 4: 'Borrado' }
function pwdTypeLabel(t?: number) { return t != null ? (PWD_TYPE[t] || `Tipo ${t}`) : 'Sin tipo' }
function fmtMs(ms?: number) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function checkActiveCodes() {
  if (!activeLockId.value) return
  activeLoading.value = true
  activeChecked.value = false
  try {
    const r = await TTLockService.listActiveCodes(activeLockId.value)
    activeCodes.value = r.data || []
    activeChecked.value = true
  } catch (e) {
    toast.error((e as Error).message || 'No se pudieron leer los códigos de la cerradura')
  } finally {
    activeLoading.value = false
  }
}

/** Atajo desde la tabla de dispositivos: ir al tab de códigos activos con la cerradura elegida. */
function inspectLock(lock: any) {
  activeLockId.value = lock.id
  tab.value = 'active'
  checkActiveCodes()
}

const RECORD_TYPE: Record<number, string> = {
  1: 'Apertura app', 4: 'Apertura código', 7: 'Tarjeta', 8: 'Huella',
  11: 'Bloqueo', 12: 'Operación gateway', 46: 'Apertura remota', 47: 'Apertura remota',
}
function recordTypeLabel(t?: number) { return t != null ? (RECORD_TYPE[t] || `Evento ${t}`) : 'Evento desconocido' }

async function checkRecords() {
  if (!recordsLockId.value) return
  recordsLoading.value = true
  recordsChecked.value = false
  try {
    const r = await TTLockService.listLockRecords(recordsLockId.value)
    records.value = (r.data || []).sort((a, b) => (b.lockDate || 0) - (a.lockDate || 0))
    recordsChecked.value = true
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo leer el historial de la cerradura')
  } finally {
    recordsLoading.value = false
  }
}

// Iconos inline (SVG como string + v-html sobre un span con tamaño)
const ICON_KEY = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7a4 4 0 1 1-3.87 5H8v2H6v2H2v-3l6.13-6.13A4 4 0 0 1 15 7Z"/><path d="M16.5 7.5h.01"/></svg>'
const ICON_SETTINGS = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
const ICON_BAN = '<svg viewBox="0 0 24 24" class="h-full w-full" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>'
const ICON_LOCK_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/></svg>'
const ICON_KEY_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7a4 4 0 1 1-3.87 5H8v2H6v2H2v-3l6.13-6.13A4 4 0 0 1 15 7Z"/><path d="M16.5 7.5h.01"/></svg>'
const ICON_GATEWAY_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5a9 9 0 0 1 14 0"/><path d="M8.5 15.5a4.5 4.5 0 0 1 7 0"/><path d="M2 9.5a13 13 0 0 1 20 0"/><circle cx="12" cy="19" r="1.5"/></svg>'
const ICON_SEARCH_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
const ICON_CLOCK_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'

onMounted(load)
</script>

<style scoped></style>
