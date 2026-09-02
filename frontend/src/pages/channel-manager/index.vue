<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-2.5">
          <h1 class="text-xl font-black text-navy">Channel Manager</h1>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            Sincronización automática activa
          </span>
        </div>
        <p class="text-xs text-text-muted mt-0.5">Canales conectados · Disponibilidad en tiempo real</p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="syncNow" :disabled="syncing" class="flex items-center gap-1.5 bg-navy text-white text-sm font-extrabold px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
          <span class="w-4 h-4 shrink-0" v-html="ICON_REFRESH"></span>
          {{ syncing ? 'Sincronizando...' : 'Forzar Sync Ahora' }}
        </button>
        <button @click="ingestBookings" :disabled="ingesting" class="flex items-center gap-1.5 bg-teal text-white text-sm font-extrabold px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
          <span class="w-4 h-4 shrink-0" v-html="ICON_DOWNLOAD"></span>
          {{ ingesting ? 'Ingestando...' : 'Recibir Reservas' }}
        </button>
      </div>
    </div>

    <!-- Connection Dialog -->
    <AppModal v-if="connectDialog" size="md" :title="`Conectar ${connectDialog.channelName}`" @close="cancelConnect">
      <div class="space-y-4">
        <div>
          <label for="channel-manager-codigo-ota" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Código OTA</label>
          <input id="channel-manager-codigo-ota" :value="connectDialog.channelCode" readonly class="w-full px-4 py-2.5 bg-surface rounded-xl text-sm text-navy font-mono" />
        </div>
        <div>
          <label for="channel-manager-titulo-del-canal" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Título del canal</label>
          <input id="channel-manager-titulo-del-canal" name="title" v-model="connectDialog.title" class="w-full px-4 py-2.5 border border-border rounded-xl text-sm text-navy focus:border-cyan focus:ring-1 focus:ring-cyan outline-none" />
        </div>

        <div v-if="connectError" class="text-xs font-bold text-coral">{{ connectError }}</div>
        <div v-if="connectResult" class="text-xs font-bold text-teal">{{ connectResult }}</div>
      </div>
      <template #footer>
        <button @click="cancelConnect" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmConnect" :disabled="connecting" class="rounded-full bg-cyan text-navy text-sm font-extrabold px-5 py-2.5 hover:shadow-lg transition-all cursor-pointer disabled:opacity-60">
          {{ connecting ? 'Conectando...' : 'Conectar' }}
        </button>
      </template>
    </AppModal>

    <!-- Config Dialog -->
    <AppModal v-if="configDialog" size="sm" @close="closeConfig">
      <template #header>
        <div class="min-w-0 flex items-center gap-2">
          <h3 class="text-base sm:text-lg font-black text-white truncate">{{ configDialog.name }}</h3>
          <span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full" :class="configDialog.active ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">{{ configDialog.active ? 'Activo' : 'Inactivo' }}</span>
        </div>
      </template>
      <div class="space-y-3 pb-4 border-b border-border">
        <div>
          <span class="text-[10px] text-text-muted uppercase tracking-wide">ID de propiedad</span>
          <p class="text-xs font-mono text-navy mt-0.5 truncate">{{ configDialog.id }}</p>
        </div>
        <div>
          <span class="text-[10px] text-text-muted uppercase tracking-wide">Código OTA</span>
          <p class="text-xs font-bold text-navy mt-0.5">{{ configDialog.otaCode }}</p>
        </div>
        <div class="flex gap-6">
          <div>
            <span class="text-[10px] text-text-muted uppercase tracking-wide">Reservas</span>
            <p class="text-sm font-black text-navy mt-0.5">{{ configDialog.bookings }}</p>
          </div>
          <div>
            <span class="text-[10px] text-text-muted uppercase tracking-wide">Última Sync</span>
            <p class="text-xs text-teal mt-0.5">{{ configDialog.lastSync }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="closeConfig" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>

    <!-- Conectar canales (iFrame) -->
    <AppModal v-if="showIframe" size="xl" title="Configuración de canales" body-class="p-0 h-[88vh] !flex-none" @close="showIframe = false; loadStatus()">
      <iframe v-if="iframeUrl" :src="iframeUrl" class="w-full h-full block" frameborder="0" />
      <div v-else class="w-full h-full flex items-center justify-center text-text-muted text-sm">Cargando...</div>
    </AppModal>

    <!-- Desconectar: es reversible y no borra nada en Channex, pero deja de publicar. Se dice. -->
    <AppModal v-if="confirmDisconnect" title="¿Desconectar del channel manager?" @close="confirmDisconnect = false">
      <div class="space-y-3 text-sm text-text-secondary">
        <p>Dejamos de enviar <strong class="text-navy">precios y disponibilidad</strong> a Channex. Tu propiedad, tus tipos de habitación y los canales que tengas conectados <strong class="text-navy">no se borran</strong>.</p>
        <p class="text-coral font-bold">Ojo: las OTAs siguen vendiendo con los últimos datos publicados. Si cambian tus precios o se te ocupa una habitación, el canal no se entera hasta que reconectes.</p>
      </div>
      <template #footer>
        <button @click="confirmDisconnect = false" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cancelar</button>
        <button @click="disconnectChannelManager" :disabled="togglingSync"
          class="ml-3 px-4 py-2 rounded-xl bg-coral text-white text-sm font-black hover:opacity-90 cursor-pointer disabled:opacity-50">
          {{ togglingSync ? 'Desconectando…' : 'Sí, desconectar' }}
        </button>
      </template>
    </AppModal>

    <!-- Estado de la conexión con el channel manager.
         Antes esta vista solo hablaba de OTAs: un hotel ya publicado en Channex, con sus tipos y
         tarifas arriba, veía "Sin canales conectados" y nada más. No había forma de saber si el
         channel manager estaba conectado, contra qué cuenta, ni qué se había publicado. -->
    <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6 mb-8">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-start gap-3 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full mt-2 shrink-0"
            :class="loadingStatus ? 'bg-gray-300 animate-pulse' : !cmConnected ? 'bg-coral' : syncPaused ? 'bg-gold' : 'bg-teal animate-pulse'"></span>
          <div class="min-w-0">
            <h2 class="text-lg font-black text-navy">
              {{ loadingStatus ? 'Verificando la conexión…' : !cmConnected ? 'Sin conectar al channel manager' : syncPaused ? 'Sincronización pausada' : 'Conectado a Channex' }}
            </h2>
            <p class="text-xs text-text-secondary mt-0.5 max-w-2xl">
              <template v-if="loadingStatus">Un momento, estamos leyendo el estado de tu propiedad.</template>
              <template v-else-if="!cmConnected">Tu hotel todavía no está publicado. Apretá «Forzar Sync Ahora» para crearlo en el channel manager.</template>
              <template v-else-if="syncPaused">Tu propiedad sigue creada en Channex, pero dejamos de enviarle precios y disponibilidad. Lo que ya está publicado queda como estaba: las OTAs siguen vendiendo con esos datos hasta que reconectes.</template>
              <template v-else>Tu hotel está publicado en el channel manager. Desde acá salen los precios y la disponibilidad hacia las OTAs que conectes; en «Abrir configuración» se mapean habitaciones y tarifas y se dan de alta los canales.</template>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span v-if="!loadingStatus && cmConnected && isTestEnv"
            class="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-gold/10 text-gold border border-gold/30"
            title="Los precios y la disponibilidad viajan a la cuenta de prueba de Channex, no a las OTAs reales">
            Entorno de prueba
          </span>
          <!-- El asistente de Channex (mapeo de habitaciones y tarifas, alta de OTAs) ya existía,
               pero su ÚNICO acceso era el botón "Solicitar Conexión" de una tarjeta de OTA: no
               había forma de entrar a configurar el channel manager en sí. -->
          <button v-if="!loadingStatus && cmConnected" @click="openConnectFlow()" :disabled="openingConfig"
            class="px-4 py-2 rounded-xl bg-navy text-white text-xs font-black hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {{ openingConfig ? 'Abriendo…' : 'Abrir configuración' }}
          </button>
          <button v-if="!loadingStatus && cmConnected" @click="syncPaused ? reconnectChannelManager() : (confirmDisconnect = true)" :disabled="togglingSync"
            class="px-4 py-2 rounded-xl border-2 text-xs font-black transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            :class="syncPaused ? 'border-teal text-teal hover:bg-teal hover:text-white' : 'border-coral text-coral hover:bg-coral hover:text-white'">
            {{ togglingSync ? 'Un momento…' : syncPaused ? 'Reconectar' : 'Desconectar' }}
          </button>
        </div>
      </div>

      <dl v-if="!loadingStatus && cmConnected" class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
        <div class="rounded-2xl border border-border p-4">
          <dt class="text-[10px] font-bold text-text-muted uppercase">Propiedad en Channex</dt>
          <dd class="mt-1 flex items-center gap-2">
            <code class="text-xs font-mono text-navy truncate">{{ propertyShort }}</code>
            <button @click="copyProperty" class="text-text-muted hover:text-navy cursor-pointer transition-colors" title="Copiar el id completo">
              <Icon :name="copiedProperty ? 'check' : 'clipboard'" class="w-3.5 h-3.5" />
            </button>
          </dd>
        </div>
        <div class="rounded-2xl border border-border p-4">
          <dt class="text-[10px] font-bold text-text-muted uppercase">Última sincronización</dt>
          <dd class="mt-1 text-sm font-bold text-navy">{{ formatSync(status?.lastSync) }}</dd>
        </div>
        <div class="rounded-2xl border border-border p-4">
          <dt class="text-[10px] font-bold text-text-muted uppercase">Tipos publicados</dt>
          <dd class="mt-1 text-sm font-bold text-navy">{{ status?.publishedRoomTypes ?? 0 }}</dd>
        </div>
        <div class="rounded-2xl border border-border p-4">
          <dt class="text-[10px] font-bold text-text-muted uppercase">Tarifas publicadas</dt>
          <dd class="mt-1 text-sm font-bold text-navy">{{ status?.publishedRatePlans ?? 0 }}</dd>
        </div>
      </dl>
    </div>

    <!-- Connected Channels -->
    <SectionCard title="Canales Conectados" class="mb-8">
      <template #actions>
        <span class="px-3 py-1 rounded-lg bg-white/10 text-xs font-black text-white">{{ connectedChannels.filter(c => c.connected).length }} de {{ connectedChannels.length }}</span>
      </template>
      <!-- El vacío solo después de responder: mostrarlo mientras carga hacía creer que no había nada. -->
      <p v-if="loadingStatus" class="text-sm text-text-muted py-10 text-center">Cargando canales…</p>
      <EmptyState v-else-if="connectedChannels.length === 0"
        title="Sin canales conectados"
        message="Todavía no conectaste ninguna OTA. Podés empezar conectando SolmiOS como canal —prueba el circuito completo sin credenciales de nadie— o pedir la conexión de una OTA de la lista de abajo.">
        <template #action>
          <button v-if="cmConnected" @click="connectOpenChannel" :disabled="connectingOpen"
            class="px-5 py-2.5 rounded-xl bg-navy text-white text-sm font-black hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {{ connectingOpen ? 'Conectando…' : 'Conectar SolmiOS como canal' }}
          </button>
        </template>
      </EmptyState>
      <div v-else class="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div v-for="channel in connectedChannels" :key="channel.id"
          class="rounded-2xl border-2 border-navy bg-white overflow-hidden flex flex-col transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg">
          <!-- Header con logo + estado -->
          <div class="flex items-center gap-3 p-4 border-b-2 border-navy">
            <div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" :class="channel.bgColor">
              <span v-if="channel.hasLogo" class="w-6 h-6" :class="channel.iconColor || 'text-navy'" v-html="channel.icon"></span>
              <span v-else class="text-lg font-black" :class="channel.iconColor || 'text-navy'">{{ channel.initial }}</span>
            </div>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-navy truncate">{{ channel.name }}</h3>
              <span class="inline-flex items-center gap-1 text-[10px] font-black" :class="channel.connected ? 'text-teal' : 'text-text-muted'">
                <span class="w-2 h-2 rounded-full" :class="channel.connected ? 'bg-teal animate-pulse' : 'bg-gray-300'"></span>
                {{ channel.connected ? 'Conectado' : 'Disponible' }}
              </span>
            </div>
          </div>

          <template v-if="channel.connected">
            <div class="p-4 space-y-2 flex-1">
              <div class="flex justify-between text-xs">
                <span class="text-text-muted">Reservas (mes)</span>
                <span class="font-black text-navy">{{ channel.bookings }}</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-text-muted">Última sync</span>
                <span class="font-bold text-teal">{{ formatSync(channel.lastSync) }}</span>
              </div>
            </div>
            <!-- Acciones imponentes -->
            <div class="p-4 pt-0 flex flex-col gap-2">
              <button @click="configChannel(channel)"
                class="w-full py-2.5 bg-navy text-white text-sm font-extrabold rounded-xl border-2 border-navy hover:bg-navy-light transition-all cursor-pointer flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.28c.063.375.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.992a7.03 7.03 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
                Configurar tarifas
              </button>
              <button @click="disconnectChannel(channel.id)"
                class="w-full py-2 text-xs font-bold text-coral border-2 border-coral/30 rounded-xl hover:bg-coral hover:text-white transition-colors cursor-pointer">
                Desconectar
              </button>
            </div>
          </template>
          <template v-else>
            <div class="p-4">
              <button @click="connectChannel(channel.id)" class="w-full py-2.5 bg-cyan text-navy text-sm font-extrabold rounded-xl border-2 border-cyan hover:bg-cyan-light transition-all cursor-pointer">
                Conectar
              </button>
            </div>
          </template>
        </div>
      </div>
    </SectionCard>

    <!-- Available Channels -->
    <SectionCard title="Canales Disponibles para Conectar" subtitle="Pedí la conexión y te guiamos con el mapeo" class="mb-8">
      <template #actions>
        <button @click="openOpenChannelCreds" class="text-[11px] font-bold text-text-secondary hover:text-navy underline decoration-dotted cursor-pointer">
          ¿Tenés tu propio sistema? Conectalo como canal
        </button>
      </template>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div v-for="channel in availableChannels" :key="channel.id"
          class="rounded-2xl border-2 border-navy bg-white p-4 flex flex-col gap-3 transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" :class="channel.bgColor">
              <span v-if="channel.hasLogo" class="w-5 h-5" :class="channel.iconColor || 'text-navy'" v-html="channel.icon"></span>
              <span v-else class="text-sm font-black" :class="channel.iconColor || 'text-navy'">{{ channel.initial }}</span>
            </div>
            <div class="min-w-0">
              <div class="text-sm font-black text-navy truncate">{{ channel.name }}</div>
              <div class="text-[10px] font-bold text-text-muted uppercase">{{ channel.category || channel.type || 'OTA' }}</div>
            </div>
          </div>
          <button @click="openConnectFlow()"
            class="mt-auto w-full py-2.5 text-sm font-extrabold rounded-xl border-2 border-navy text-navy hover:bg-navy hover:text-white transition-colors cursor-pointer">
            Solicitar Conexión
          </button>
        </div>
      </div>
    </SectionCard>

    <!-- Credenciales para conectar un sistema propio (Open Channel) -->
    <AppModal v-if="openChannelModal" size="md" title="Conectar tu propio sistema" subtitle="Pegá estos 3 datos en el asistente de conexión" @close="openChannelModal = false">
      <div v-if="openChannelLoading" class="text-center py-6 text-sm text-text-muted">Generando credenciales…</div>
      <div v-else-if="openChannelCreds" class="space-y-4">
        <div v-for="field in openChannelFields" :key="field.key">
          <label :for="`open-channel-${field.key}`" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5">{{ field.label }}</label>
          <div class="flex items-center gap-2">
            <input :id="`open-channel-${field.key}`" :value="field.value" readonly class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm font-mono text-navy" />
            <button @click="copyField(field.key, field.value)"
              class="shrink-0 px-3 py-2.5 rounded-xl border border-border text-xs font-bold text-text-secondary hover:border-navy/30 hover:text-navy transition-colors cursor-pointer">
              {{ copiedField === field.key ? '✓' : 'Copiar' }}
            </button>
          </div>
        </div>
        <p class="text-[11px] text-text-muted">
          En el asistente de conexión, elegí "Solicitar Conexión" en cualquier canal, después "Crear Canal" y pegá estos 3 valores en "Configuración general".
        </p>
      </div>
      <template #footer>
        <button @click="openChannelModal = false" class="text-sm font-bold text-text-secondary hover:text-navy cursor-pointer transition-colors">Cerrar</button>
        <button @click="connectOpenChannel" :disabled="connectingOpen"
          class="ml-3 px-4 py-2 rounded-xl bg-navy text-white text-sm font-black hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ connectingOpen ? 'Conectando…' : 'Conectar automáticamente' }}
        </button>
      </template>
    </AppModal>

    <!-- Sync Log -->
    <div class="rounded-[20px] border border-border bg-white shadow-(--shadow-card) p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-black text-navy">Historial de Sincronización</h2>
        <span class="text-[10px] text-text-muted">{{ syncLog.length }} registros</span>
      </div>
      <p v-if="loadingStatus" class="text-sm text-text-muted py-10 text-center">Cargando historial…</p>
      <EmptyState v-else-if="syncLog.length === 0" title="Sin sincronizaciones"
        message="Todavía no hubo sincronizaciones con los canales. Aparecerán acá a medida que se envíen precios o lleguen reservas." />
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-border">
              <th class="text-left py-3 text-[10px] font-bold text-text-muted uppercase">Acción</th>
              <th class="text-left py-3 text-[10px] font-bold text-text-muted uppercase">Canal</th>
              <th class="text-left py-3 text-[10px] font-bold text-text-muted uppercase">Fecha</th>
              <th class="text-left py-3 text-[10px] font-bold text-text-muted uppercase">Estado</th>
              <th class="text-left py-3 text-[10px] font-bold text-text-muted uppercase">Tarea Channex</th>
              <th class="text-left py-3 text-[10px] font-bold text-text-muted uppercase">Detalle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in syncLog" :key="log.id" class="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
              <td class="py-3 text-sm font-bold text-navy">{{ log.action }}</td>
              <td class="py-3 text-xs text-text-muted">{{ log.channel || '—' }}</td>
              <td class="py-3 text-xs text-text-muted">{{ log.createdAt?.slice(0, 16)?.replace('T', ' ') }}</td>
              <td class="py-3">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="log.status === 'success' ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">{{ log.status === 'success' ? 'Exitoso' : 'Error' }}</span>
              </td>
              <td class="py-3">
                <button v-if="log.taskIds?.length" @click="copyTaskIds(log.taskIds)"
                  class="inline-flex items-center gap-1 text-[10px] font-mono text-text-secondary hover:text-navy cursor-pointer transition-colors"
                  :title="`Copiar ${log.taskIds.length} id(s) de tarea de Channex`">
                  <span>{{ log.taskIds[0].slice(0, 8) }}…</span>
                  <span v-if="log.taskIds.length > 1" class="font-sans text-text-muted">+{{ log.taskIds.length - 1 }}</span>
                  <Icon :name="copiedTaskIds === log.id ? 'check' : 'clipboard'" class="w-3 h-3" />
                </button>
                <span v-else class="text-xs text-text-muted">—</span>
              </td>
              <td class="py-3 text-xs text-text-muted max-w-xs truncate">{{ log.details }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChannelService } from '@/services/Channel.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { http } from '@/services/http'
import { resolveChannelLogo } from '@/utils/channelLogos'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import type { OpenChannelCredentials } from '@/services/Channel.service'

const ICON_REFRESH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>'
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>'
// Logos oficiales (paquete simple-icons) — monocromo, se tiñen via fill="currentColor" + clase de color del contenedor.
const ICON_AIRBNB = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z"/></svg>'
const ICON_BOOKING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M24 0H0v24h24ZM8.575 6.563h2.658c2.108 0 3.473 1.15 3.473 2.898 0 1.15-.575 1.82-.91 2.108l-.287.263.335.192c.815.479 1.318 1.389 1.318 2.395 0 1.988-1.51 3.257-3.857 3.257H7.449V7.713c0-.623.503-1.126 1.126-1.15zm1.7 1.868c-.479.024-.694.264-.694.79v1.893h1.676c.958 0 1.294-.743 1.294-1.365 0-.815-.503-1.318-1.318-1.318zm-.096 4.36c-.407.071-.598.31-.598.79v2.251h1.868c.934 0 1.509-.55 1.509-1.533 0-.934-.599-1.509-1.51-1.509zm7.737 2.394c.743 0 1.341.599 1.341 1.342a1.34 1.34 0 0 1-1.341 1.341 1.355 1.355 0 0 1-1.341-1.341c0-.743.598-1.342 1.34-1.342z"/></svg>'
const ICON_EXPEDIA = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M19.067 0H4.933A4.94 4.94 0 0 0 0 4.933v14.134A4.932 4.932 0 0 0 4.933 24h14.134A4.932 4.932 0 0 0 24 19.067V4.933C24.01 2.213 21.797 0 19.067 0ZM7.336 19.341c0 .19-.148.337-.337.337h-2.33a.333.333 0 0 1-.337-.337v-2.33c0-.189.148-.336.337-.336H7c.19 0 .337.147.337.337zm12.121-1.486-2.308 2.298c-.169.168-.422.053-.422-.2V9.57l-6.44 6.44a.533.533 0 0 1-.421.17H8.169a.32.32 0 0 1-.338-.338v-1.697c0-.2.053-.316.169-.422l6.44-6.44H4.058c-.253 0-.369-.253-.2-.421l2.297-2.309c.137-.137.285-.232.517-.232H18.15c.854 0 1.539.686 1.539 1.54v11.478c-.01.231-.095.368-.232.516z"/></svg>'
const ICON_GOOGLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>'
const ICON_TRIP = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M17.834 9.002c-.68 0-1.29.31-1.707.799v-.514h-1.708v8.348h1.897v-2.923c.416.344.943.551 1.518.551 1.677 0 3.036-1.401 3.036-3.13s-1.36-3.13-3.036-3.13zm-.19 4.516c-.733 0-1.328-.62-1.328-1.385s.595-1.385 1.328-1.385c.734 0 1.328.62 1.328 1.385s-.594 1.385-1.328 1.385zm6.356.607a1.138 1.138 0 1 1-2.277 0 1.138 1.138 0 0 1 2.277 0zM13.205 7.428a1.062 1.062 0 1 1-2.125 0 1.062 1.062 0 0 1 2.125 0zm-2.011 1.859h1.897v5.692h-1.897V9.287zM6.83 8.225H4.364v6.754H2.466V8.225H0V6.63h6.83v1.594zm3.035 1.033c.13 0 .255.012.38.03v1.74a1.55 1.55 0 0 0-.297-.031c-.88 0-1.594.612-1.594 1.593v2.389H6.451V9.287h1.707v.9c.363-.558.991-.93 1.707-.93z"/></svg>'
// Sin logo oficial disponible en simple-icons — íconos genéricos de respaldo.
const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>'
const ICON_PALM = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21V10m0 0c-2-3-6-4-9-2 2 1 4 1 6 0-1 2-4 3-6 5 3 0 6-1 9-3Zm0 0c2-3 6-4 9-2-2 1-4 1-6 0 1 2 4 3 6 5-3 0-6-1-9-3Z"/></svg>'
const ICON_PLANE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="m21.5 15-6-2-1-6.5c-.1-.6-.6-1-1.2-1s-1.1.4-1.2 1L11 13l-6 2v2l6-1 1 5-2 1v1.5l3-1 3 1V21l-2-1 1-5 6 1v-2Z"/></svg>'

const auth = useAuthStore()
const toast = useToast()

/**
 * Copia los ids de tarea que Channex devolvió por ese push. Son el ÚNICO identificador con el
 * que soporte de Channex puede rastrear un envío de precios o disponibilidad — y lo que pide
 * el formulario de certificación PMS por cada test.
 */
async function copyTaskIds(ids: string[]) {
  try {
    await navigator.clipboard.writeText(ids.join('\n'))
    const row = syncLog.value.find((l) => l.taskIds === ids)
    copiedTaskIds.value = row?.id || ''
    setTimeout(() => { if (copiedTaskIds.value === row?.id) copiedTaskIds.value = '' }, 1500)
    toast.success(ids.length > 1 ? `${ids.length} ids copiados` : 'Id de tarea copiado')
  } catch { toast.error('No se pudo copiar') }
}
const router = useRouter()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

const DEFAULT_OTA_CATALOG = [
  { id: 'airbnb', name: 'Airbnb', channexCode: 'AirBNB', icon: ICON_AIRBNB, bgColor: 'bg-coral/10', iconColor: 'text-coral', type: 'ota', connected: false },
  { id: 'booking', name: 'Booking.com', channexCode: 'BookingCom', icon: ICON_BOOKING, bgColor: 'bg-cyan/10', iconColor: 'text-cyan', type: 'ota', connected: false },
  { id: 'expedia', name: 'Expedia', channexCode: 'A-Expedia', icon: ICON_EXPEDIA, bgColor: 'bg-gold/10', iconColor: 'text-gold', type: 'ota', connected: false },
  { id: 'google', name: 'Google Hotels', channexCode: 'GHA', icon: ICON_GOOGLE, bgColor: 'bg-blue/10', iconColor: 'text-blue', type: 'metasearch', connected: false },
  { id: 'hostelworld', name: 'Hostelworld', channexCode: 'HW', icon: ICON_BUILDING, bgColor: 'bg-gold/10', iconColor: 'text-gold', type: 'ota', connected: false },
  { id: 'agoda', name: 'Agoda', channexCode: 'Agoda', icon: ICON_PALM, bgColor: 'bg-coral/10', iconColor: 'text-coral', type: 'ota', connected: false },
  { id: 'despegar', name: 'Despegar', channexCode: 'Despegar', icon: ICON_PLANE, bgColor: 'bg-purple/10', iconColor: 'text-purple', type: 'ota', connected: false },
  { id: 'trip', name: 'Trip.com', channexCode: 'TripCom', icon: ICON_TRIP, bgColor: 'bg-teal/10', iconColor: 'text-teal', type: 'ota', connected: false },
]

const status = ref<Awaited<ReturnType<typeof ChannelService.status>> | null>(null)
const syncing = ref(false)
/** La vista arranca cargando: sin esto los estados vacíos se muestran como si fueran la respuesta. */
const loadingStatus = ref(true)
const copiedProperty = ref(false)

/** Conectado al channel manager = el hotel tiene propiedad publicada, aunque no haya OTAs todavía. */
const cmConnected = computed(() => !!status.value?.channexPropertyId)
/** Publicada pero muda: el hotel apagó la sincronización desde acá. */
const syncPaused = computed(() => cmConnected.value && status.value?.syncEnabled === false)
const confirmDisconnect = ref(false)
const togglingSync = ref(false)
const connectingOpen = ref(false)
/** Hasta la certificación, todo corre contra la cuenta de prueba de Channex. Hay que decirlo. */
const isTestEnv = computed(() => status.value?.environment === 'staging')
const propertyShort = computed(() => {
  const id = status.value?.channexPropertyId || ''
  return id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '—'
})

async function copyProperty() {
  const id = status.value?.channexPropertyId
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    copiedProperty.value = true
    setTimeout(() => { copiedProperty.value = false }, 1500)
    toast.success('Id de la propiedad copiado')
  } catch { toast.error('No se pudo copiar') }
}

const connectedChannels = ref<any[]>([])
const availableChannels = ref<any[]>([])
const syncLog = ref<any[]>([])
/** Fila cuyo id de tarea se acaba de copiar — el ✓ vuelve a ser clip a los 1.5s. */
const copiedTaskIds = ref('')

const connectDialog = ref<{ channelId: string; channelName: string; channelCode: string; title: string; connected: boolean } | null>(null)
const configDialog = ref<{ id: string; name: string; otaCode: string; active: boolean; bookings: number; lastSync: string; connected: boolean } | null>(null)
const connecting = ref(false)
const ingesting = ref(false)
const connectError = ref('')
const connectResult = ref('')
const showIframe = ref(false)
const iframeUrl = ref('')
/** El token del iframe es un round-trip al servidor: sin aviso, el botón parece no hacer nada. */
const openingConfig = ref(false)

// ── Conectar un sistema propio (Open Channel) ──────────────────────────────
const openChannelModal = ref(false)
const openChannelLoading = ref(false)
const openChannelCreds = ref<OpenChannelCredentials | null>(null)
const copiedField = ref('')

const openChannelFields = computed(() => {
  if (!openChannelCreds.value) return []
  const c = openChannelCreds.value
  return [
    { key: 'endpoint', label: 'Endpoint', value: c.endpoint },
    { key: 'apiKey', label: 'API Key', value: c.apiKey },
    { key: 'hotelCode', label: 'Hotel Code', value: c.hotelCode },
  ]
})

async function openOpenChannelCreds() {
  openChannelModal.value = true
  if (openChannelCreds.value) return
  openChannelLoading.value = true
  try {
    openChannelCreds.value = await ChannelService.openChannelCredentials()
  } catch {
    toast.error('No se pudieron generar las credenciales')
    openChannelModal.value = false
  } finally {
    openChannelLoading.value = false
  }
}

function copyField(key: string, value: string) {
  navigator.clipboard.writeText(value)
  copiedField.value = key
  setTimeout(() => { if (copiedField.value === key) copiedField.value = '' }, 2000)
}

// Ensures every catalog entry (from platform config or the default list) carries a
// brand logo + color, falling back to an initial badge when the channel is unknown.
function normalizeCatalog(list: any[]): any[] {
  return list.map((c: any) => {
    const name = c.name || c.title || 'OTA'
    const logo = resolveChannelLogo(name, c.channexCode || c.otaCode || c.id)
    return {
      ...c,
      name,
      icon: c.icon || logo.icon,
      bgColor: c.bgColor || c.color || logo.bgColor,
      iconColor: c.iconColor || logo.iconColor,
      initial: logo.initial,
      hasLogo: !!c.icon || logo.matched,
    }
  })
}

async function loadStatus() {
  loadingStatus.value = true
  try {
    status.value = await ChannelService.status(hotelId.value)
    connectedChannels.value = status.value.data.map((c: any) => {
      const name = c.name || 'OTA'
      const logo = resolveChannelLogo(name, c.otaCode || c.channexCode)
      return {
        id: c.id ?? c.name,
        name,
        icon: c.icon || logo.icon,
        initial: logo.initial,
        hasLogo: !!c.icon || logo.matched,
        bgColor: c.color || logo.bgColor,
        iconColor: c.iconColor || logo.iconColor,
        description: c.description || c.descripcion || '',
        connected: !!(c.connected ?? c.conectado),
        active: c.active,
        bookings: c.bookings ?? 0,
        lastSync: c.lastSync || c.ultimaSync || status.value?.lastSync || '—',
        otaCode: c.otaCode || c.channexCode,
      }
    })
  } catch { toast.error("Error al cargar datos") }
  try {
    const { ConfigService } = await import('@/services/Platform.service')
    const otas = await ConfigService.get('ota_catalog', 'platform')
      || await ConfigService.get('catalogo_otas', 'platform')
    const source = (Array.isArray(otas) && otas.length > 0) ? otas : DEFAULT_OTA_CATALOG
    availableChannels.value = normalizeCatalog(source)
  } catch { availableChannels.value = normalizeCatalog(DEFAULT_OTA_CATALOG) }
  // Load sync history from DB
  try {
    const logData = await ChannelService.syncLog(hotelId.value)
    // `http.get` ya devuelve el contenido del envelope: el historial llega como ARRAY. Leer
    // `logData.data` daba siempre `undefined` y la tabla mostraba "Sin sincronizaciones" aunque
    // el backend tuviera las filas (verificado en producción el 2026-09-01). Se aceptan las dos
    // formas por si alguna respuesta viniera sin envolver (ver la deuda de compresión en CLAUDE.md).
    const rows = Array.isArray(logData) ? logData : (logData?.data ?? [])
    syncLog.value = rows.slice(0, 20)
  } catch {}
  loadingStatus.value = false
}

// Fecha de última sincronización legible (evita mostrar el timestamp ISO crudo).
const MS_PER_MIN = 60_000
function formatSync(raw: string | null | undefined): string {
  if (!raw || raw === '—') return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  const mins = Math.floor((Date.now() - d.getTime()) / MS_PER_MIN)
  if (mins < 1) return 'recién'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs} h`
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Solicitar conexión de un canal: abre el flujo de mapeo/conexión de Channex embebido (iframe).
async function openConnectFlow() {
  openingConfig.value = true
  try {
    const r = await ChannelService.iframeToken(hotelId.value, auth.user?.name)
    iframeUrl.value = r.iframeUrl
    showIframe.value = true
  } catch {
    toast.error('No se pudo abrir el asistente de conexión')
  } finally {
    openingConfig.value = false
  }
}

/**
 * Conecta SolmiOS como canal en un click. Antes había que copiar tres credenciales del modal y
 * pegarlas en el asistente de Channex: ese paso manual es la razón por la que un hotel nuevo se
 * quedaba sin ningún canal conectado.
 */
async function connectOpenChannel() {
  connectingOpen.value = true
  try {
    const r = await ChannelService.connectOpenChannel()
    openChannelModal.value = false
    await loadStatus()
    toast.success(r.message || 'Canal conectado')
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo conectar el canal')
  } finally {
    connectingOpen.value = false
  }
}

/** Pausa el envío de ARI. No borra nada del lado de Channex — ver el modal de confirmación. */
async function disconnectChannelManager() {
  togglingSync.value = true
  try {
    await ChannelService.setSyncEnabled(hotelId.value, false)
    confirmDisconnect.value = false
    await loadStatus()
    toast.success('Desconectado: dejamos de enviar precios y disponibilidad')
  } catch {
    toast.error('No se pudo desconectar')
  } finally {
    togglingSync.value = false
  }
}

async function reconnectChannelManager() {
  togglingSync.value = true
  try {
    await ChannelService.setSyncEnabled(hotelId.value, true)
    await loadStatus()
    toast.success('Reconectado. Sincronizá para publicar los cambios de este período')
  } catch {
    toast.error('No se pudo reconectar')
  } finally {
    togglingSync.value = false
  }
}

async function syncNow() {
  syncing.value = true
  try {
    await ChannelService.sync(hotelId.value)
    await loadStatus()
  } catch (e) {
    toast.error('Error al sincronizar')
  } finally { syncing.value = false }
}

onMounted(loadStatus)

function connectChannel(id: string) {
  const ch = connectedChannels.value.find(c => c.id === id)
  if (!ch) return
  const code = ch.otaCode || ch.name
  connectDialog.value = { channelId: id, channelName: ch.name, channelCode: String(code), title: ch.name, connected: ch.connected }
  connectError.value = ''
  connectResult.value = ''
}

async function confirmConnect() {
  const dlg = connectDialog.value
  if (!dlg || !hotelId.value) return
  connecting.value = true
  connectError.value = ''
  connectResult.value = ''
  try {
    const groups = await ChannelService.groups(hotelId.value)
    const groupId = groups[0]?.id
    if (!groupId) { connectError.value = 'No hay grupos de canales configurados'; return }

    const st = status.value || await ChannelService.status(hotelId.value)
    const propertyId = st.channexPropertyId
    if (!propertyId) { connectError.value = 'No hay propiedad de canales configurada'; return }

    const result = await ChannelService.connect({
      hotelId: hotelId.value,
      channel: dlg.channelCode,
      title: dlg.title,
      groupId,
      propertyId,
      ratePlans: [],
    })

    if (result.success) {
      connectResult.value = result.message
      setTimeout(async () => { connectDialog.value = null; await loadStatus() }, 1200)
    } else {
      connectError.value = result.message
    }
  } catch (e: any) {
    connectError.value = e?.message || 'Error al conectar'
  } finally { connecting.value = false }
}

function cancelConnect() {
  connectDialog.value = null
  connectError.value = ''
  connectResult.value = ''
}

function configChannel(channel: any) {
  if (channel.id && channel.connected) {
    router.push(`/panel/channel/${channel.id}`)
    return
  }
  configDialog.value = {
    id: channel.id,
    name: channel.name,
    otaCode: channel.otaCode || channel.name,
    active: channel.active === undefined ? channel.connected : channel.active,
    bookings: channel.bookings || 0,
    lastSync: channel.lastSync || '—',
    connected: channel.connected,
  }
}

function closeConfig() {
  configDialog.value = null
}

async function ingestBookings() {
  ingesting.value = true
  try {
    const result = await ChannelService.ingestBookings(hotelId.value)
    toast.success(result.message || 'Ingesta completada')
    await loadStatus()
  } catch (e: any) {
    toast.error('Error al ingestar reservas')
  } finally { ingesting.value = false }
}

async function disconnectChannel(id: string) {
  const ch = connectedChannels.value.find(c => c.id === id)
  if (!ch || !hotelId.value) return
  if (!ch.connected) return
  if (!ch.otaCode) { ch.connected = false; return }
  try {
    const result = await ChannelService.deactivate(hotelId.value, ch.id)
    if (result.success) await loadStatus()
    else toast.warning(result.message)
  } catch (e: any) {
    toast.error('Error al desconectar')
  }
}
</script>
