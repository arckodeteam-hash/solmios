<template>
  <div>
    <!-- CFG-2 (#99): sin botón global de guardado. Cada pestaña guarda lo suyo con UN POST,
         así el toast dice qué se guardó (y qué falló) en lugar de disparar cuatro claves de una. -->
    <div class="flex gap-2 flex-wrap mb-6">
      <button v-for="tab in tabs" :key="tab.value" @click="activeTab = tab.value" class="px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer" :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">{{ tab.label }}</button>
    </div>

    <!-- Tab: Plataforma -->
    <div v-if="activeTab === 'platform'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Información de la Plataforma">
        <div class="space-y-4">
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Nombre de la Plataforma</label>
            <input v-model="settings.platformName" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
            <!-- CFG-2 (#99): texto honesto — hoy nada del sistema lee este valor. -->
            <p class="mt-1 text-[11px] text-text-muted">Se guarda en la configuración de la plataforma; hoy no hay lectores.</p>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Email de Soporte</label>
            <input v-model="settings.supportEmail" type="email" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
            <p class="mt-1 text-[11px] text-text-muted">Destino por defecto del correo de prueba de la pestaña Email.</p>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Teléfono de Soporte</label>
            <input v-model="settings.supportPhone" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
            <p class="mt-1 text-[11px] text-text-muted">Se guarda en la configuración de la plataforma; hoy no hay lectores.</p>
          </div>
          <button @click="guardarPlataforma" :disabled="guardandoPlataforma"
            class="rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {{ guardandoPlataforma ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </SectionCard>
    </div>

    <!-- Tab: Email -->
    <div v-if="activeTab === 'email'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Configuración SMTP">
        <div class="space-y-4">
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">SMTP Server</label><input v-model="settings.smtpServer" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Puerto</label><input v-model="settings.smtpPort" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <!-- #100: TLS implícito (465) vs STARTTLS (587). Se persiste como `secure` en email_config. -->
          <div>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input v-model="settings.smtpSecure" type="checkbox" class="w-4 h-4 accent-cyan rounded">
              <span class="font-bold">Conexión segura (465/TLS)</span>
            </label>
            <p class="mt-1 text-[11px] text-text-muted">Activalo para puerto 465; con 587 se usa STARTTLS</p>
          </div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Usuario</label><input v-model="settings.smtpUser" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <!-- autocomplete="new-password": credencial del servidor SMTP de la plataforma, no la del
               admin. Sin esto Chrome la autorrellenaba con la contraseña guardada (GH-32). -->
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Contraseña</label><input v-model="settings.smtpPassword" type="password" autocomplete="new-password" name="smtp-password" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Email Remitente</label><input v-model="settings.fromEmail" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Nombre Remitente</label><input v-model="settings.fromName" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <!-- CFG-2 (#99): el Guardar de la pestaña persiste SOLO email_config, en la key y shape
               que lee el motor de envío (antes esto viajaba en un POST global de cuatro claves). -->
          <button @click="guardarEmail" :disabled="guardandoEmail"
            class="w-full py-2.5 bg-navy text-white rounded-xl text-sm font-bold hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {{ guardandoEmail ? 'Guardando…' : 'Guardar' }}
          </button>
          <!-- #100: destino explícito de la prueba, con validación y resultado inline (no solo toast). -->
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Destino de la prueba</label>
            <input v-model="testEmailTo" type="email" placeholder="soporte@tuhotel.com" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" :class="testEmailError ? 'border-coral' : ''" @input="testEmailError = ''">
          </div>
          <button @click="testEmail" :disabled="testingEmail" class="w-full py-2.5 bg-surface text-navy rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait">{{ testingEmail ? 'Enviando…' : 'Enviar Email de Prueba' }}</button>
          <p v-if="testEmailError" class="text-[11px] font-bold text-coral">{{ testEmailError }}</p>
          <p v-else-if="testEmailResult" class="text-[11px] font-bold text-teal">{{ testEmailResult }}</p>
        </div>
      </SectionCard>
      <!-- #100: Resend como respaldo cuando no hay SMTP. La key se guarda por su propio endpoint
           (no viaja en email_config) y nunca vuelve completa del servidor. -->
      <SectionCard title="Resend (respaldo sin SMTP)">
        <template #actions>
          <span class="text-[10px] font-bold px-3 py-1 rounded-full"
            :class="resend?.configured ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">
            {{ resend?.configured ? 'Configurada · termina en ' + resend.last4 : 'No configurada' }}
          </span>
        </template>
        <div class="space-y-4">
          <p class="text-[11px] leading-relaxed text-text-muted">
            Se usa cuando no hay servidor SMTP cargado. La key nunca se muestra completa.
          </p>
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">{{ resend?.configured ? 'Reemplazar API key' : 'Nueva API key' }}</label>
            <input v-model="resendApiKey" type="password" autocomplete="new-password" name="resend-api-key" placeholder="re_…" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button @click="guardarResend" :disabled="resendGuardando || !resendApiKey.trim()"
              class="rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
              {{ resendGuardando ? 'Guardando…' : 'Guardar key' }}
            </button>
            <button v-if="resend?.configured" @click="quitarResend" :disabled="resendGuardando"
              class="rounded-xl bg-coral/10 px-5 py-2.5 text-sm font-bold text-coral transition-colors hover:bg-coral/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              Quitar
            </button>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Plantillas de Email">
        <div class="space-y-3">
          <div v-for="template in emailTemplates" :key="template.name" class="flex items-center justify-between p-3 bg-surface rounded-xl cursor-pointer hover:bg-surface-dark transition-colors" @click="selectedTemplate = template">
            <div class="flex items-center gap-3"><span class="text-xl">{{ template.icon }}</span><div><div class="text-sm font-bold">{{ template.name }}</div><div class="text-[10px] text-text-muted">{{ template.description }}</div></div></div>
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="template.active ? 'bg-teal/10 text-teal' : 'bg-surface text-text-muted'">{{ template.active ? 'Activa' : 'Inactiva' }}</span>
              <button @click.stop="template.active = !template.active" class="w-10 h-5 rounded-full relative transition-colors cursor-pointer" :class="template.active ? 'bg-teal' : 'bg-gray-300'"><div class="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="template.active ? 'right-0.5' : 'left-0.5'"></div></button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>

    <!-- Tab: Seguridad — SOLO LECTURA (#102). Todo lo que se ve sale de /api/admin/settings/status;
         no hay botón Guardar porque no hay nada editable. La tarjeta de políticas de contraseña
         que había acá se sacó en CFG-2 (#99): sus inputs nunca se persistieron (cero lectores
         en el backend), así que pintar switches que no cambiaban nada sólo confundía. -->
    <div v-if="activeTab === 'security'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Protección del alta">
        <p class="text-[11px] text-text-muted mb-3">Solo lectura: son variables del servidor, no se cambian desde acá.</p>
        <div class="space-y-3">
          <div v-for="fila in proteccionAlta" :key="fila.clave" class="p-3 bg-surface rounded-xl">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-bold">{{ fila.nombre }}</div>
              <span class="text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shrink-0"
                :class="fila.activo ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold'">
                <span class="w-1.5 h-1.5 rounded-full" :class="fila.activo ? 'bg-teal' : 'bg-gold'"></span>
                {{ fila.activo ? 'Activo' : 'Desactivado' }}
              </span>
            </div>
            <div class="text-[10px] text-text-muted mt-1">{{ fila.detalle }}</div>
          </div>
        </div>
      </SectionCard>
      <!-- CFG-4 (#101): esta tarjeta volvió porque ahora SÍ tiene lector: el backend aplica
           `security_policy` en alta de usuarios, cambio y restablecimiento de clave y registro
           público (`shared/usecases/password-policy.ts`). Guardar propio, como el resto (CFG-2). -->
      <SectionCard title="Políticas de Contraseña">
        <div class="space-y-4">
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Longitud Mínima</label>
            <input v-model.number="securityPolicy.minLength" type="number" min="6" max="32" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy">
            <p class="text-[10px] text-text-muted mt-1">Se aplica a alta de usuarios, cambio y restablecimiento de contraseña y registro público. El registro público exige además 10 caracteres como mínimo.</p>
          </div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Requerir mayúsculas</div><button @click="securityPolicy.requireUppercase = !securityPolicy.requireUppercase" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="securityPolicy.requireUppercase ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="securityPolicy.requireUppercase ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Requerir números</div><button @click="securityPolicy.requireNumbers = !securityPolicy.requireNumbers" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="securityPolicy.requireNumbers ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="securityPolicy.requireNumbers ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div class="flex items-center justify-between p-3 bg-surface rounded-xl"><div class="text-sm font-bold">Requerir caracteres especiales</div><button @click="securityPolicy.requireSpecial = !securityPolicy.requireSpecial" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="securityPolicy.requireSpecial ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="securityPolicy.requireSpecial ? 'right-0.5' : 'left-0.5'"></div></button></div>
          <div class="flex flex-wrap items-center gap-3 pt-2">
            <button @click="guardarSeguridad" :disabled="guardandoSeguridad"
              class="rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {{ guardandoSeguridad ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
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
        <!-- CFG-2 (#99): el Guardar de esta pestaña persiste SOLO la key de Maps (la tarjeta de la
             pasarela de pagos que había acá se sacó: nadie leía la clave que guardaba). -->
        <div class="flex flex-wrap items-center gap-3 mt-4">
          <button @click="guardarMaps" :disabled="guardandoMaps"
            class="rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {{ guardandoMaps ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
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

      <!-- #102: qué servicio está configurado y de dónde sale (env o panel). El endpoint nunca
           devuelve valores, solo booleanos; los nombres de las variables viven en settings-status.ts. -->
      <SectionCard title="Estado por servicio">
        <p class="text-[11px] text-text-muted mb-3">Qué está configurado y de dónde sale. Nunca muestra valores.</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div v-for="fila in integracionesEstado" :key="fila.clave" class="p-3 bg-surface rounded-xl">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-bold">{{ fila.nombre }}</div>
              <span class="text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shrink-0"
                :class="fila.configurado ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold'">
                <span class="w-1.5 h-1.5 rounded-full" :class="fila.configurado ? 'bg-teal' : 'bg-gold'"></span>
                {{ fila.configurado ? 'Configurado' : 'Falta' }}
              </span>
            </div>
            <div class="text-[10px] text-text-muted mt-1">{{ fila.detalle }}</div>
          </div>
        </div>
      </SectionCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ConfigService, PlatformService } from '@/services/Platform.service'
import type { MetaAppEstado, ResendEstado, SettingsStatus } from '@/services/Platform.service'
import { filasProteccionAlta, filasIntegraciones } from './settings-status'
import { validarDestinoPrueba, destinoPruebaPorDefecto, mensajeResultadoPrueba } from './settings-email'
import { useToast } from '@/composables/useToast'
import ChannexPlatformConfig from '@/components/features/ChannexPlatformConfig.vue'
import SectionCard from '@/components/ui/SectionCard.vue'

const toast = useToast()

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
const selectedTemplate = ref<any>(null)

// CFG-2 (#99): sin pestaña de facturación — sus controles (método de cobro, ciclo, gracia,
// impuestos) no tenían lector en el backend: se mostraban, "se guardaban" y nadie los leía.
const tabs = [
  { label: 'Plataforma', value: 'platform' },
  { label: 'Email', value: 'email' },
  { label: 'Seguridad', value: 'security' },
  { label: 'Integraciones', value: 'integrations' },
]

// CFG-2 (#99): sólo campos con lector real al otro lado. Moneda, zona horaria, dominio, color de
// marca y políticas de contraseña se sacaron de acá (cero lectores en backend/src).
const settings = ref<any>({
  platformName: '', supportEmail: '', supportPhone: '',
  smtpServer: '', smtpPort: '587', smtpUser: '', smtpPassword: '', fromEmail: '', fromName: '', smtpSecure: false,
})

// REQ-CFG-05: política de contraseña real (`configuration('security_policy')`), la lee el backend
// en alta/cambio/reset/registro. Default {6,false,false,false}; minLength acotada a 6..32.
const securityPolicy = ref({ minLength: 6, requireUppercase: false, requireNumbers: false, requireSpecial: false })
const clampMin = (n: any) => Math.min(32, Math.max(6, Math.round(Number(n) || 6)))
const emailTemplates = ref<any[]>([])
// #102: estado de captcha / verificación / servicios. null = no se pudo leer (las filas lo dicen).
const settingsStatus = ref<SettingsStatus | null>(null)
const proteccionAlta = computed(() => filasProteccionAlta(settingsStatus.value))
const integracionesEstado = computed(() => filasIntegraciones(settingsStatus.value))

onMounted(async () => {
  cargarMeta()
  // #100: estado de Resend por su propio endpoint; si falla no rompe la carga del resto.
  PlatformService.getResend().catch(() => null).then((r) => { resend.value = r })
  PlatformService.getSettingsStatus().catch(() => null).then((s) => { settingsStatus.value = s })
  try {
    // SMTP-UI (2026-08-19): se lee el CANÓNICO ('email_config', host/pass) con fallback al
    // legacy ('smtp', server/password) que guardaba esta misma página — antes el load ni
    // siquiera matcheaba los nombres (server ≠ smtpServer), así el form arrancaba vacío.
    const [plataforma, emailCfg, tmpl, maps, secPol] = await Promise.all([
      ConfigService.get('plataforma', 'platform'),
      ConfigService.get('email_config', 'platform').catch(() => null),
      ConfigService.get('email_templates', 'platform'),
      ConfigService.get('google_maps', 'platform'),
      ConfigService.get('security_policy', 'platform').catch(() => null),
      ConfigService.get('security_policy', 'platform').catch(() => null),
    ])
    // CFG-2 (#99): de la fila 'plataforma' sólo entran al formulario los tres campos que esta
    // pantalla vuelve a guardar; claves viejas que traiga la fila no se copian ni se re-guardan.
    if (plataforma) {
      settings.value.platformName = String(plataforma.platformName ?? '')
      settings.value.supportEmail = String(plataforma.supportEmail ?? '')
      settings.value.supportPhone = String(plataforma.supportPhone ?? '')
    }
    const smtp = emailCfg?.host || emailCfg?.user
      ? emailCfg
      : await ConfigService.get('smtp', 'platform').catch(() => null)
    if (smtp) {
      // from puede venir compuesto ("Nombre <a@b>") — se separa para los dos inputs.
      const fromMatch = /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(String(smtp.from ?? ''))
      settings.value.smtpServer = String(smtp.host ?? smtp.server ?? '')
      settings.value.smtpPort = String(smtp.port ?? 587)
      // #100: configs viejas no traen `secure` — se infiere del puerto 465.
      settings.value.smtpSecure = smtp.secure === true || Number(smtp.port) === 465
      settings.value.smtpUser = String(smtp.user ?? '')
      settings.value.smtpPassword = String(smtp.pass ?? smtp.password ?? '')
      settings.value.fromEmail = String(smtp.fromEmail ?? fromMatch?.[2] ?? (typeof smtp.from === 'string' && !smtp.from.includes('<') ? smtp.from : ''))
      settings.value.fromName = String(smtp.fromName ?? fromMatch?.[1] ?? '')
    }
    if (Array.isArray(tmpl)) emailTemplates.value = tmpl
    if (maps?.apiKey) mapsKey.value = String(maps.apiKey)
    if (secPol && typeof secPol === 'object') Object.assign(securityPolicy.value, { minLength: clampMin(secPol.minLength), requireUppercase: !!secPol.requireUppercase, requireNumbers: !!secPol.requireNumbers, requireSpecial: !!secPol.requireSpecial })
    testEmailTo.value = destinoPruebaPorDefecto(settings.value.supportEmail, settings.value.fromEmail)
  } catch { toast.error('No se pudo cargar la configuración de la plataforma') }
})

// ── CFG-2 (#99): un Guardar por pestaña ─────────────────────────────────────────────────────
// Cada botón hace UN solo POST a /api/configuracion y tiene su toast específico, así el
// operador sabe qué se guardó (antes un botón global disparaba cuatro claves de una y el
// "Error al guardar" no decía cuál había fallado).

const guardandoPlataforma = ref(false)
async function guardarPlataforma() {
  guardandoPlataforma.value = true
  try {
    // EXACTAMENTE los tres campos que existen; nada más viaja en la clave 'plataforma'.
    await ConfigService.set('plataforma', {
      platformName: settings.value.platformName,
      supportEmail: settings.value.supportEmail,
      supportPhone: settings.value.supportPhone,
    }, 'platform')
    toast.success('Datos de plataforma guardados')
  } catch {
    toast.error('No se pudo guardar', 'Revisá los datos de la plataforma e intentá de nuevo')
  } finally {
    guardandoPlataforma.value = false
  }
}

const guardandoEmail = ref(false)
async function guardarEmail() {
  guardandoEmail.value = true
  try {
    // SMTP-UI (2026-08-19): key y shape CANÓNICOS que lee el motor de envío — antes
    // guardaba 'smtp'/{server,password} y el EmailService nunca la encontraba.
    await ConfigService.set('email_config', {
      host: settings.value.smtpServer,
      port: Number(settings.value.smtpPort) || 587,
      secure: settings.value.smtpSecure === true,
      user: settings.value.smtpUser,
      pass: settings.value.smtpPassword,
      fromEmail: settings.value.fromEmail,
      fromName: settings.value.fromName,
    }, 'platform')
    toast.success('Configuración de correo guardada')
  } catch {
    toast.error('No se pudo guardar', 'Revisá la configuración SMTP e intentá de nuevo')
  } finally {
    guardandoEmail.value = false
  }
}

const guardandoMaps = ref(false)
async function guardarMaps() {
  guardandoMaps.value = true
  try {
    await ConfigService.set('google_maps', { apiKey: mapsKey.value.trim() }, 'platform')
    toast.success('Clave de Google Maps guardada')
  } catch {
    toast.error('No se pudo guardar', 'Revisá la clave de Maps e intentá de nuevo')
  } finally {
    guardandoMaps.value = false
  }
}

// CFG-4 (#101): la política de contraseña se guarda sola. La lee el backend en cada validación
// (`readPasswordPolicy`), así que el cambio aplica al siguiente alta/cambio sin reiniciar nada.
const guardandoSeguridad = ref(false)
async function guardarSeguridad() {
  guardandoSeguridad.value = true
  try {
    await ConfigService.set('security_policy', {
      minLength: clampMin(securityPolicy.value.minLength),
      requireUppercase: !!securityPolicy.value.requireUppercase,
      requireNumbers: !!securityPolicy.value.requireNumbers,
      requireSpecial: !!securityPolicy.value.requireSpecial,
    }, 'platform')
    toast.success('Política de contraseña guardada')
  } catch {
    toast.error('No se pudo guardar', 'Revisá la política de contraseña e intentá de nuevo')
  } finally {
    guardandoSeguridad.value = false
  }
}

// SMTP-UI (2026-08-19): test REAL — antes era un toast falso que "confirmaba" envíos que
// nunca salieron (por eso la desconexión de config pasó inadvertida).
// #100: el destino lo elige el usuario (default: soporte, si no remitente); si es inválido
// se muestra el error inline y NO se llama al backend. El resultado (proveedor usado o el
// error real de SMTP/Resend) queda inline además del toast.
const testingEmail = ref(false)
const testEmailTo = ref('')
const testEmailError = ref('')
const testEmailResult = ref('')
const testEmail = async () => {
  testEmailResult.value = ''
  // Si al montar no había default (sin soporte ni remitente) y el usuario tampoco escribió, se reintenta.
  if (!testEmailTo.value.trim()) {
    testEmailTo.value = destinoPruebaPorDefecto(settings.value.supportEmail, settings.value.fromEmail)
  }
  const to = testEmailTo.value.trim()
  const err = validarDestinoPrueba(to)
  if (err) {
    testEmailError.value = err
    return
  }
  testEmailError.value = ''
  testingEmail.value = true
  try {
    const r = await PlatformService.testEmail(to)
    testEmailResult.value = mensajeResultadoPrueba(r.provider, to)
    toast.success(testEmailResult.value)
  } catch (e: any) {
    testEmailError.value = `Falló el envío: ${e?.message || 'error de SMTP/Resend — revisá la config'}`
    toast.error(testEmailError.value)
  } finally {
    testingEmail.value = false
  }
}

// #100: API key de Resend. Solo se conoce el estado (configurada + últimos 4); la key no queda
// en memoria del navegador después de guardarla.
const resend = ref<ResendEstado | null>(null)
const resendApiKey = ref('')
const resendGuardando = ref(false)

async function guardarResend() {
  const apiKey = resendApiKey.value.trim()
  if (!apiKey) return
  resendGuardando.value = true
  try {
    resend.value = await PlatformService.saveResend(apiKey)
    resendApiKey.value = ''
    toast.success('API key de Resend guardada')
  } catch (e: any) {
    toast.error('No se pudo guardar', e?.message || 'Revisá la key e intentá de nuevo')
  } finally {
    resendGuardando.value = false
  }
}

async function quitarResend() {
  resendGuardando.value = true
  try {
    resend.value = await PlatformService.deleteResend()
    toast.success('API key de Resend quitada')
  } catch (e: any) {
    toast.error('No se pudo quitar', e?.message || 'Intentá de nuevo')
  } finally {
    resendGuardando.value = false
  }
}
</script>
