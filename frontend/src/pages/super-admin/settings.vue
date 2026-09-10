<template>
  <div>
    <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
      <div class="flex gap-2 flex-wrap">
        <button v-for="tab in tabs" :key="tab.value" @click="activeTab = tab.value" class="px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer" :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">{{ tab.label }}</button>
      </div>
      <button @click="saveSettings" class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer">Guardar Cambios</button>
    </div>

    <!-- Tab: Plataforma -->
    <div v-if="activeTab === 'platform'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Información de la Plataforma">
        <div class="space-y-4">
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Nombre de la Plataforma</label><input v-model="settings.platformName" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Email de Soporte</label><input v-model="settings.supportEmail" type="email" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Teléfono de Soporte</label><input v-model="settings.supportPhone" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Moneda por Defecto</label>
            <select v-model="settings.currency" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
              <option value="USD">USD — Dólar Americano</option>
              <option value="DOP">DOP — Peso Dominicano</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Zona Horaria</label>
            <select v-model="settings.timezone" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
              <option value="America/Santo_Domingo">Santo Domingo (GMT-4)</option>
              <option value="America/Bogota">Bogotá (GMT-5)</option>
              <option value="America/Mexico_City">Ciudad de México (GMT-6)</option>
            </select>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Logo y Apariencia">
        <div class="space-y-4">
          <div class="flex items-center gap-4 p-4 bg-surface rounded-xl">
            <img :src="logoIconColor" alt="SolmiOS" class="w-20 h-20 rounded-xl bg-white border border-border object-contain p-2">
            <div>
              <div class="text-sm font-bold text-navy mb-2">Logo Actual</div>
              <!-- "Cambiar Logo" estaba acá sin handler: no existe endpoint para subir el logo
                   de la plataforma (los uploads que hay son de housekeeping y mensajes). El logo
                   se cambia reemplazando el asset del repo. -->
              <div class="text-[10px] text-text-muted">Se cambia en el repositorio del frontend</div>
            </div>
          </div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Color Primario</label>
            <div class="flex gap-2">
              <div v-for="color in brandColors" :key="color.value" @click="settings.brandColor = color.value" class="w-10 h-10 rounded-lg cursor-pointer border-2 transition-all" :class="settings.brandColor === color.value ? 'border-navy scale-110' : 'border-transparent'" :style="{ background: color.value }"></div>
            </div>
          </div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Dominio Personalizado</label><input v-model="settings.customDomain" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="app.solmios.com"></div>
        </div>
      </SectionCard>
    </div>

    <!-- Tab: Email -->
    <div v-if="activeTab === 'email'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Configuración SMTP">
        <div class="space-y-4">
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">SMTP Server</label><input v-model="settings.smtpServer" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Puerto</label><input v-model="settings.smtpPort" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Usuario</label><input v-model="settings.smtpUser" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <!-- autocomplete="new-password": credencial del servidor SMTP de la plataforma, no la del
               admin. Sin esto Chrome la autorrellenaba con la contraseña guardada (GH-32). -->
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Contraseña</label><input v-model="settings.smtpPassword" type="password" autocomplete="new-password" name="smtp-password" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Email Remitente</label><input v-model="settings.fromEmail" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Nombre Remitente</label>
            <input v-model="settings.fromName" :placeholder="settings.platformName || 'SolmiOS'" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
            <p class="mt-1.5 text-[11px] text-text-muted">Vacío → se usa el nombre de la plataforma (<strong class="text-navy">{{ settings.platformName || 'SolmiOS' }}</strong>, pestaña Plataforma).</p>
          </div>
          <!-- Cómo va a verse el remitente en la bandeja del hotel: es la misma regla que aplica el
               backend (formatFromAddress), para que el admin no descubra el resultado recién en prod. -->
          <div class="flex items-center gap-3 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-navy font-black text-xs">{{ senderInitials }}</span>
            <div class="min-w-0">
              <div class="text-[10px] font-bold text-text-muted uppercase">Los correos salen como</div>
              <div class="truncate text-sm font-bold text-navy">{{ senderPreview }}</div>
            </div>
          </div>
          <button @click="testEmail" :disabled="testingEmail" class="w-full py-2.5 bg-surface text-navy rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait">{{ testingEmail ? 'Enviando…' : 'Enviar Email de Prueba' }}</button>
        </div>
      </SectionCard>
      <SectionCard title="Plantillas de Email" :subtitle="templatesSubtitle" body-class="p-0">
        <template #actions>
          <router-link to="/admin/email-templates" class="text-[11px] font-bold text-cyan hover:underline whitespace-nowrap">Administrar →</router-link>
        </template>

        <!-- Cargando -->
        <div v-if="templatesLoading" class="space-y-2 p-5">
          <div v-for="i in 6" :key="i" class="h-12 animate-pulse rounded-xl bg-surface"></div>
        </div>

        <!-- Sin datos: el backend no respondió o la tabla está sin sembrar -->
        <div v-else-if="!emailTemplates.length" class="p-8 text-center">
          <div class="text-3xl mb-2">📭</div>
          <div class="text-sm font-bold text-navy">{{ templatesError || 'No hay plantillas cargadas' }}</div>
          <p class="mt-1 text-[11px] text-text-muted">Las 10 plantillas se crean con <code class="font-mono">bun run scripts/seed-platform-email-templates.ts</code> en el backend.</p>
          <button @click="loadTemplates" class="mt-4 rounded-full bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Reintentar</button>
        </div>

        <template v-else>
          <div class="divide-y divide-border">
            <div v-for="tpl in emailTemplates" :key="tpl.event"
              class="flex items-center gap-3 px-5 py-3 hover:bg-surface/60 transition-colors">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-lg">{{ eventIcon(tpl.event) }}</span>
              <button @click="editTemplate(tpl.event)" class="min-w-0 flex-1 text-left cursor-pointer" :title="`Editar «${platformEmailEventLabel(tpl.event)}»`">
                <div class="text-sm font-bold text-navy truncate">{{ platformEmailEventLabel(tpl.event) }}</div>
                <div class="text-[11px] text-text-muted truncate">{{ previewSubject(tpl.subject) || 'Sin asunto' }}</div>
              </button>
              <span class="hidden sm:inline text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" :class="tpl.isActive ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">{{ tpl.isActive ? 'Activa' : 'Inactiva' }}</span>
              <button @click="toggleTemplate(tpl)" :disabled="togglingEvent === tpl.event"
                :aria-label="tpl.isActive ? 'Desactivar plantilla' : 'Activar plantilla'"
                class="w-10 h-5 rounded-full relative transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait shrink-0" :class="tpl.isActive ? 'bg-teal' : 'bg-gray-300'">
                <div class="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="tpl.isActive ? 'right-0.5' : 'left-0.5'"></div>
              </button>
            </div>
          </div>
          <!-- Variables globales: todas las plantillas las tienen; salen de la pestaña Plataforma. -->
          <div class="border-t border-border bg-surface/40 px-5 py-3">
            <div class="text-[10px] font-bold text-text-muted uppercase mb-1.5">En todas las plantillas podés usar</div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
              <span v-for="g in PLATFORM_EMAIL_GLOBAL_VARIABLES" :key="g.name">
                <code class="font-mono font-bold text-navy">{{ '{' + g.name + '}' }}</code>
                → {{ globalVariableValue(g.name) || 'sin configurar' }}
              </span>
            </div>
            <p class="mt-1.5 text-[10px] text-text-muted">Se toman de la pestaña <button @click="activeTab = 'platform'" class="font-bold text-cyan hover:underline cursor-pointer">Plataforma</button>. El interruptor guarda al instante; el texto se edita desde <router-link to="/admin/email-templates" class="font-bold text-cyan hover:underline">Plantillas de Email</router-link>.</p>
          </div>
        </template>
      </SectionCard>
    </div>

    <!-- Tab: Seguridad -->
    <div v-if="activeTab === 'security'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Autenticación">
        <div class="space-y-3">
          <div v-for="option in securityOptions" :key="option.name" class="flex items-center justify-between p-3 bg-surface rounded-xl">
            <div><div class="text-sm font-bold">{{ option.name }}</div><div class="text-[10px] text-text-muted">{{ option.description }}</div></div>
            <button @click="option.enabled = !option.enabled" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="option.enabled ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="option.enabled ? 'right-0.5' : 'left-0.5'"></div></button>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Políticas de Contraseña">
        <div class="space-y-4">
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Longitud Mínima</label><input v-model.number="settings.minPasswordLength" type="number" min="6" max="32" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Requerir mayúsculas</div><button @click="settings.requireUppercase = !settings.requireUppercase" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="settings.requireUppercase ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="settings.requireUppercase ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Requerir números</div><button @click="settings.requireNumbers = !settings.requireNumbers" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="settings.requireNumbers ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="settings.requireNumbers ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Requerir caracteres especiales</div><button @click="settings.requireSpecial = !settings.requireSpecial" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="settings.requireSpecial ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="settings.requireSpecial ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Expiración de Contraseña (días)</label><input v-model.number="settings.passwordExpiry" type="number" min="0" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" placeholder="0 = nunca expira"></div>
        </div>
      </SectionCard>
    </div>

    <!-- Tab: Integraciones -->
    <div v-if="activeTab === 'integrations'" class="space-y-6">
      <ChannexPlatformConfig />

      <!-- Google Maps: se configura una sola vez para toda la plataforma. Cada hotel la hereda
           por el fallback a hotelId:'platform' de getConfig. -->
      <SectionCard title="🗺️ Google Maps" subtitle="Habilita el mapa interactivo en la ubicación del hotel (clic y arrastre del pin)">
        <template #actions>
          <span class="text-[10px] font-bold px-3 py-1 rounded-full"
            :class="mapsKey ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">
            {{ mapsKey ? 'Configurado' : 'Sin configurar' }}
          </span>
        </template>
        <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Maps JavaScript API Key</label>
        <input v-model="mapsKey" type="text" placeholder="AIza…"
          class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
        <p class="mt-2 text-[11px] text-text-muted">
          Sin key, la ubicación se muestra igual con el mapa de Google, pero no se puede mover el pin
          con el mouse: hay que pegar las coordenadas.
          <strong class="text-navy">Restringí la key por dominio</strong>
          (HTTP referrers → <code>hotel.zx89.site/*</code>) en Google Cloud: al vivir en el navegador,
          una key sin restringir la puede usar cualquiera y el consumo te lo facturan a vos.
        </p>
        <!-- GH-33: los campos Provincia/Municipio/Localidad/CP se autocompletan al mover el pin,
             pero eso lo resuelve la Geocoding API, que en Google Cloud es un producto SEPARADO de
             la Maps JavaScript API. Con la key habilitada solo para Maps, el mapa se ve bien y el
             autocompletado devuelve REQUEST_DENIED. Se avisa acá porque es donde se pega la key. -->
        <p class="mt-2 text-[11px] text-text-muted">
          <strong class="text-navy">Habilitá también "Geocoding API"</strong> en el mismo proyecto de
          Google Cloud: es un producto aparte de Maps JavaScript API y es la que completa sola
          Provincia, Municipio, Localidad y Código Postal al mover el pin. Si además restringís la
          key por API, incluí las dos o el autocompletado va a fallar con el mapa funcionando.
        </p>
      </SectionCard>

      <!-- WhatsApp: acá va SOLO el secreto de la APP, que firma los webhooks de todos los hoteles.
           El número y el token de cada hotel NO se cargan a mano: los obtiene el propio hotel desde
           su panel con el botón "Conectar WhatsApp". -->
      <SectionCard title="💬 WhatsApp Business (Meta)"
        subtitle="Clave secreta de la app. Cada hotel conecta su propio número desde su panel.">
        <template #actions>
          <span class="text-[10px] font-bold px-3 py-1 rounded-full"
            :class="meta?.configurado ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">
            {{ meta?.configurado ? (meta.origen === 'entorno' ? 'En el servidor' : 'Configurado') : 'Sin configurar' }}
          </span>
        </template>

        <div v-if="metaCargando" class="h-10 animate-pulse rounded-xl bg-surface"></div>

        <div v-else class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">App ID</label>
              <input v-model="metaAppId" type="text" placeholder="1727869705161184"
                class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
            </div>
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Versión de la API</label>
              <input :value="meta?.graphVersion" type="text" disabled
                class="w-full px-4 py-2.5 bg-surface/60 border border-border rounded-xl text-sm text-text-muted">
            </div>
          </div>

          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">
              Clave secreta de la app
            </label>
            <input v-model="metaAppSecret" type="password" autocomplete="new-password" name="meta-app-secret"
              :placeholder="meta?.pista ? `Guardada (${meta.pista}) — escribí para reemplazar` : 'Pegala acá'"
              class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
          </div>

          <!-- El entorno gana: decirlo evita que alguien cambie el valor acá y no entienda por qué
               el sistema sigue usando otro. -->
          <p v-if="meta?.origen === 'entorno'" class="rounded-xl bg-gold/10 px-4 py-3 text-[11px] leading-relaxed text-navy">
            Hay una clave cargada en el <strong>servidor</strong> (variable <code>META_APP_SECRET</code>),
            y esa es la que se usa. Lo que guardes acá queda de respaldo, pero no toma efecto mientras
            exista la del servidor.
          </p>
          <p v-else-if="!meta?.puedeGuardar" class="rounded-xl bg-coral/10 px-4 py-3 text-[11px] leading-relaxed text-navy">
            Falta <code>PAYMENTS_ENCRYPTION_KEY</code> en el servidor. Sin eso no se puede guardar la
            clave cifrada, y no se guarda en claro a propósito: firma los webhooks de todos los hoteles.
          </p>

          <div class="flex flex-wrap items-center gap-3">
            <button @click="guardarMeta" :disabled="metaGuardando || !metaAppSecret || !meta?.puedeGuardar"
              class="rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
              {{ metaGuardando ? 'Guardando…' : 'Guardar clave' }}
            </button>
            <a href="https://developers.facebook.com/apps/1727869705161184/settings/basic/" target="_blank" rel="noopener noreferrer"
              class="text-[11px] font-bold text-navy underline">Sacarla del panel de Meta →</a>
          </div>

          <p class="text-[11px] leading-relaxed text-text-muted">
            Sin esta clave el botón "Conectar WhatsApp" del panel del hotel no funciona, y el buzón
            que recibe los mensajes de los huéspedes rechaza todo.
          </p>
        </div>
      </SectionCard>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard v-for="integration in integrations" :key="integration.name" :title="`${integration.icon} ${integration.name}`" :subtitle="integration.description">
        <template #actions>
          <button @click="integration.connected = !integration.connected" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="integration.connected ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="integration.connected ? 'right-0.5' : 'left-0.5'"></div></button>
        </template>
        <div v-if="integration.connected" class="space-y-3">
          <div v-for="field in integration.fields" :key="field.name"><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">{{ field.name }}</label><input :value="field.value" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" :type="field.type || 'text'"></div>
          <!-- "Probar Conexión" no tenía handler y no hay endpoint que valide credenciales de
               Stripe. El de correo sí existe y está conectado en la pestaña de Email
               (`testEmail`, prueba real de envío). -->
        </div>
        <div v-else class="bg-surface rounded-xl p-4 text-center">
          <div class="text-sm text-text-muted">No conectado</div>
          <button @click="integration.connected = true" class="mt-2 px-4 py-1.5 bg-navy text-white rounded-lg text-[10px] font-bold hover:shadow-lg transition-colors cursor-pointer">Conectar</button>
        </div>
      </SectionCard>
      </div>
    </div>

    <!-- Tab: Facturación -->
    <div v-if="activeTab === 'billing'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Configuración de Facturación">
        <div class="space-y-4">
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Método de Cobro</label>
            <select v-model="settings.billingMethod" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
              <option value="transfer">Transferencia Bancaria</option>
            </select>
          </div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Ciclo de Facturación</label>
            <select v-model="settings.billingCycle" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy cursor-pointer">
              <option value="monthly">Mensual</option>
              <option value="quarterly">Trimestral</option>
              <option value="annual">Anual (con descuento)</option>
            </select>
          </div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Días de Gracia</label><input v-model.number="settings.graceDays" type="number" min="0" max="30" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Día de Cobro</label><input v-model.number="settings.billingDay" type="number" min="1" max="28" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
        </div>
      </SectionCard>
      <SectionCard title="Notas de Crédito y Descuentos">
        <div class="space-y-4">
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Permitir notas de crédito</div><button @click="settings.allowCreditNotes = !settings.allowCreditNotes" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="settings.allowCreditNotes ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="settings.allowCreditNotes ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Permitir descuentos por volumen</div><button @click="settings.allowVolumeDiscounts = !settings.allowVolumeDiscounts" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="settings.allowVolumeDiscounts ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="settings.allowVolumeDiscounts ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Descuento por Pago Anual (%)</label><input v-model.number="settings.annualDiscount" type="number" min="0" max="50" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Impuesto (%)</label><input v-model.number="settings.taxRate" type="number" min="0" max="30" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
        </div>
      </SectionCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import logoIconColor from '@/assets/logo/logo-icon-color.png'
import { ConfigService, PlatformService } from '@/services/Platform.service'
import type { MetaAppEstado } from '@/services/Platform.service'
import {
  PlatformEmailsService,
  platformEmailEventLabel,
  sortPlatformEmailTemplates,
  PLATFORM_EMAIL_EVENTS,
  PLATFORM_EMAIL_GLOBAL_VARIABLES,
  type PlatformEmailEvent,
  type PlatformEmailTemplate,
} from '@/services/PlatformEmails.service'
import { useToast } from '@/composables/useToast'
import ChannexPlatformConfig from '@/components/features/ChannexPlatformConfig.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { CurrencyCode } from '@/types/currency'

const toast = useToast()
const router = useRouter()

const activeTab = ref('platform')

// Key de Google Maps — se guarda en configuration(hotelId:'platform', key:'google_maps').
// Cada hotel la hereda por el fallback a 'platform' de getConfig.
const mapsKey = ref('')

/** Credenciales de la APP de Meta. El secreto nunca vuelve del servidor: solo su estado. */
const meta = ref<MetaAppEstado | null>(null)
const metaCargando = ref(true)
const metaGuardando = ref(false)
const metaAppId = ref('')
const metaAppSecret = ref('')

async function cargarMeta() {
  metaCargando.value = true
  try {
    meta.value = await PlatformService.getMetaWhatsapp()
    metaAppId.value = meta.value?.appId || ''
  } catch {
    meta.value = null
  } finally {
    metaCargando.value = false
  }
}

async function guardarMeta() {
  if (!metaAppSecret.value) return
  metaGuardando.value = true
  try {
    meta.value = await PlatformService.saveMetaWhatsapp({
      appId: metaAppId.value.trim() || undefined,
      appSecret: metaAppSecret.value.trim(),
    })
    // No se conserva en el formulario: el secreto no tiene por qué quedar en memoria del navegador.
    metaAppSecret.value = ''
    toast.success('Clave guardada', 'Los hoteles ya pueden conectar su WhatsApp')
  } catch (e: any) {
    toast.error('No se pudo guardar', e?.message || 'Revisá la clave e intentá de nuevo')
  } finally {
    metaGuardando.value = false
  }
}

const tabs = [
  { label: 'Plataforma', value: 'platform' },
  { label: 'Email', value: 'email' },
  { label: 'Seguridad', value: 'security' },
  { label: 'Integraciones', value: 'integrations' },
  { label: 'Facturación', value: 'billing' }
]

const brandColors = [
  { value: '#0D2B4E' }, { value: '#00B4D8' }, { value: '#117A65' }, { value: '#6C3483' }, { value: '#E74C3C' }, { value: '#B7950B' }
]

const settings = ref<any>({
  platformName: '', supportEmail: '', supportPhone: '', currency: CurrencyCode.USD,
  timezone: 'America/Santo_Domingo', brandColor: '#0D2B4E', customDomain: '',
  smtpServer: '', smtpPort: '587', smtpUser: '', smtpPassword: '', fromEmail: '', fromName: '',
  minPasswordLength: 8, requireUppercase: true, requireNumbers: true, requireSpecial: false, passwordExpiry: 90,
  billingMethod: 'stripe', billingCycle: 'monthly', graceDays: 7, billingDay: 1,
  allowCreditNotes: true, allowVolumeDiscounts: false, annualDiscount: 15, taxRate: 18,
})

// ── Plantillas de email de la plataforma ──
// Son las mismas 10 filas que administra /admin/email-templates (`platform_email_templates`), no
// una config aparte: antes esta tarjeta leía `configuration('email_templates')`, una clave que
// nadie escribía, y quedaba vacía para siempre. El interruptor persiste al toque (PUT isActive);
// el texto se edita en la página de plantillas.
const emailTemplates = ref<PlatformEmailTemplate[]>([])
const templatesLoading = ref(true)
const templatesError = ref('')
const togglingEvent = ref<string | null>(null)

const templatesSubtitle = computed(() => {
  if (templatesLoading.value) return 'Cargando…'
  const activas = emailTemplates.value.filter(t => t.isActive).length
  return `${activas} activa(s) de ${emailTemplates.value.length || PLATFORM_EMAIL_EVENTS.length}`
})

const EVENT_ICONS: Record<PlatformEmailEvent, string> = {
  welcome: '👋',
  trial_ending: '⏳',
  trial_expired: '⌛',
  subscription_renewal_auto: '🔁',
  subscription_renewal_manual: '🗓️',
  payment_succeeded: '✅',
  payment_failed: '⚠️',
  subscription_suspended: '⛔',
  subscription_reactivated: '🔓',
  subscription_canceled: '🚫',
}
function eventIcon(event: string): string {
  return EVENT_ICONS[event as PlatformEmailEvent] || '✉️'
}

async function loadTemplates() {
  templatesLoading.value = true
  templatesError.value = ''
  try {
    const r = await PlatformEmailsService.list()
    const rows = Array.isArray(r) ? r : ((r as { data?: PlatformEmailTemplate[] })?.data ?? [])
    emailTemplates.value = sortPlatformEmailTemplates(rows)
  } catch (e) {
    emailTemplates.value = []
    templatesError.value = e instanceof Error ? e.message : 'No se pudieron cargar las plantillas'
  } finally {
    templatesLoading.value = false
  }
}

async function toggleTemplate(tpl: PlatformEmailTemplate) {
  const next = !tpl.isActive
  togglingEvent.value = tpl.event
  try {
    const updated = await PlatformEmailsService.update(tpl.event, { isActive: next })
    tpl.isActive = updated?.isActive ?? next
    toast.success(`«${platformEmailEventLabel(tpl.event)}» ${tpl.isActive ? 'activada' : 'desactivada'}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado de la plantilla')
  } finally {
    togglingEvent.value = null
  }
}

function editTemplate(event: PlatformEmailEvent) {
  router.push({ path: '/admin/email-templates', query: { event } })
}

/** Asunto con las variables globales ya resueltas (las del evento quedan como `{hotel_name}`). */
function previewSubject(subject: string): string {
  return (subject || '').replace(/\{(platform_name|support_email|support_phone)\}/g, (m, k: string) => globalVariableValue(k) || m)
}

/** Valor actual (sin guardar todavía) que va a tomar cada variable global. */
function globalVariableValue(name: string): string {
  if (name === 'platform_name') return settings.value.platformName || 'SolmiOS'
  if (name === 'support_email') return settings.value.supportEmail || ''
  if (name === 'support_phone') return settings.value.supportPhone || ''
  return ''
}

// Vista previa del remitente — espejo de `formatFromAddress` del backend.
const senderPreview = computed(() => {
  const email = (settings.value.fromEmail || '').trim() || 'noreply@solmios.com'
  const name = (settings.value.fromName || '').trim() || (settings.value.platformName || '').trim() || 'SolmiOS'
  return `${name} <${email}>`
})
const senderInitials = computed(() => {
  const name: string = String(settings.value.fromName || settings.value.platformName || 'SolmiOS').trim()
  return name.split(/\s+/).map((w: string) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 2).map((w: string) => w[0]!.toUpperCase()).join('') || 'S'
})

const securityOptions = ref<any[]>([])
// WhatsApp SALIÓ de acá (2026-09-07). Estaba en el lugar equivocado del sistema: no existe un
// WhatsApp "de la plataforma" que sirva a todos los hoteles — cada hotel conecta su propio número y
// su propia cuenta de Meta. Ahora se conecta desde el panel del hotel (Configuración →
// Integraciones), con el flujo oficial de Meta, y el estado vive en `ai_whatsapp_config`.
//
// Además la tarjeta nunca guardó nada: los inputs de abajo usan `:value` sin `v-model`, así que lo
// que se escribe no vuelve al modelo, y nadie lee la clave `configuration('integraciones')` que se
// persiste. Eso sigue siendo cierto para Stripe, que se configura de verdad en
// /panel/config/pasarelas — esta tarjeta queda como resto a limpiar aparte.
const integrations = ref<any[]>([
  { name: 'Stripe', icon: '💳', description: 'Pasarela de pagos con tarjeta', connected: false,
    fields: [{ name: 'Publishable Key', value: '', type: 'text' }, { name: 'Secret Key', value: '', type: 'password' }] },
])

onMounted(async () => {
  cargarMeta()
  try {
    // SMTP-UI (2026-08-19): se lee el CANÓNICO ('email_config', host/pass) con fallback al
    // legacy ('smtp', server/password) que guardaba esta misma página — antes el load ni
    // siquiera matcheaba los nombres (server ≠ smtpServer), así el form arrancaba vacío.
    const [plataforma, emailCfg, seg, integ, maps] = await Promise.all([
      ConfigService.get('plataforma', 'platform'),
      ConfigService.get('email_config', 'platform').catch(() => null),
      ConfigService.get('seguridad', 'platform'),
      ConfigService.get('integraciones', 'platform'),
      ConfigService.get('google_maps', 'platform'),
    ])
    if (plataforma) Object.assign(settings.value, plataforma)
    const smtp = emailCfg?.host || emailCfg?.user
      ? emailCfg
      : await ConfigService.get('smtp', 'platform').catch(() => null)
    if (smtp) {
      // from puede venir compuesto ("Nombre <a@b>") — se separa para los dos inputs.
      const fromMatch = /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(String(smtp.from ?? ''))
      settings.value.smtpServer = String(smtp.host ?? smtp.server ?? '')
      settings.value.smtpPort = String(smtp.port ?? 587)
      settings.value.smtpUser = String(smtp.user ?? '')
      settings.value.smtpPassword = String(smtp.pass ?? smtp.password ?? '')
      settings.value.fromEmail = String(smtp.fromEmail ?? fromMatch?.[2] ?? (typeof smtp.from === 'string' && !smtp.from.includes('<') ? smtp.from : ''))
      settings.value.fromName = String(smtp.fromName ?? fromMatch?.[1] ?? '')
    }
    if (Array.isArray(seg)) securityOptions.value = seg
    if (Array.isArray(integ)) integrations.value = integ
    if (maps?.apiKey) mapsKey.value = String(maps.apiKey)
  } catch { toast.error('No se pudo cargar la configuración de la plataforma') }
  // Aparte del Promise.all: si falla no tiene por qué tirar abajo el resto del formulario.
  loadTemplates()
})

const saveSettings = async () => {
  try {
    const toSave = settings.value
    await Promise.all([
      ConfigService.set('plataforma', { platformName: toSave.platformName, supportEmail: toSave.supportEmail, supportPhone: toSave.supportPhone, currency: toSave.currency, timezone: toSave.timezone, customDomain: toSave.customDomain }, 'platform'),
      // SMTP-UI (2026-08-19): key y shape CANÓNICOS que lee el motor de envío — antes
      // guardaba 'smtp'/{server,password} y el EmailService nunca la encontraba.
      ConfigService.set('email_config', {
        host: toSave.smtpServer, port: Number(toSave.smtpPort) || 587,
        user: toSave.smtpUser, pass: toSave.smtpPassword,
        fromEmail: toSave.fromEmail, fromName: toSave.fromName,
      }, 'platform'),
      ConfigService.set('integraciones', integrations.value, 'platform'),
      ConfigService.set('google_maps', { apiKey: mapsKey.value.trim() }, 'platform'),
    ])
    toast.success('Configuración guardada')
  } catch { toast.error('Error al guardar') }
}

// SMTP-UI (2026-08-19): test REAL — antes era un toast falso que "confirmaba" envíos que
// nunca salieron (por eso la desconexión de config pasó inadvertida). Prueba contra el
// destino que se quiera verificar; por default el usuario SMTP cargado si es un email.
const testingEmail = ref(false)
const testEmail = async () => {
  const to = (settings.value.fromEmail || settings.value.supportEmail || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    toast.error('Cargá un "Email Remitente" válido para probar (o el email de soporte)')
    return
  }
  testingEmail.value = true
  try {
    const r = await PlatformService.testEmail(to)
    toast.success(r.message || `Enviado vía ${r.provider} a ${to}`)
  } catch (e: any) {
    toast.error(`Falló el envío: ${e?.message || 'error de SMTP/Resend — revisá la config'}`)
  } finally {
    testingEmail.value = false
  }
}
</script>
