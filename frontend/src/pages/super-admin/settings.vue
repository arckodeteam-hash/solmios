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
            <div class="w-20 h-20 rounded-xl bg-gradient-to-br from-navy to-cyan flex items-center justify-center text-white text-3xl font-black">S</div>
            <div>
              <div class="text-sm font-bold text-navy mb-2">Logo Actual</div>
              <button class="px-3 py-1.5 bg-white border border-border rounded-lg text-[10px] font-bold hover:border-navy transition-colors cursor-pointer">Cambiar Logo</button>
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
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Contraseña</label><input v-model="settings.smtpPassword" type="password" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Email Remitente</label><input v-model="settings.fromEmail" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <div><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">Nombre Remitente</label><input v-model="settings.fromName" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy"></div>
          <button @click="testEmail" :disabled="testingEmail" class="w-full py-2.5 bg-surface text-navy rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait">{{ testingEmail ? 'Enviando…' : 'Enviar Email de Prueba' }}</button>
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
      </SectionCard>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard v-for="integration in integrations" :key="integration.name" :title="`${integration.icon} ${integration.name}`" :subtitle="integration.description">
        <template #actions>
          <button @click="integration.connected = !integration.connected" class="w-12 h-6 rounded-full relative transition-colors cursor-pointer" :class="integration.connected ? 'bg-teal' : 'bg-gray-300'"><div class="w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow" :class="integration.connected ? 'right-0.5' : 'left-0.5'"></div></button>
        </template>
        <div v-if="integration.connected" class="space-y-3">
          <div v-for="field in integration.fields" :key="field.name"><label class="block text-[10px] font-bold text-text-muted uppercase mb-2">{{ field.name }}</label><input :value="field.value" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-navy" :type="field.type || 'text'"></div>
          <button class="w-full py-2.5 bg-surface text-navy rounded-xl text-sm font-bold hover:bg-surface-dark transition-colors cursor-pointer">Probar Conexión</button>
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
import { ref, onMounted } from 'vue'
import { ConfigService, PlatformService } from '@/services/Platform.service'
import { useToast } from '@/composables/useToast'
import ChannexPlatformConfig from '@/components/features/ChannexPlatformConfig.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { CurrencyCode } from '@/types/currency'

const toast = useToast()

const activeTab = ref('platform')

// Key de Google Maps — se guarda en configuration(hotelId:'platform', key:'google_maps').
// Cada hotel la hereda por el fallback a 'platform' de getConfig.
const mapsKey = ref('')
const selectedTemplate = ref<any>(null)
const showSaved = ref(false)

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

const emailTemplates = ref<any[]>([])
const securityOptions = ref<any[]>([])
const integrations = ref<any[]>([
  { name: 'Stripe', icon: '💳', description: 'Pasarela de pagos con tarjeta', connected: false,
    fields: [{ name: 'Publishable Key', value: '', type: 'text' }, { name: 'Secret Key', value: '', type: 'password' }] },
  { name: 'WhatsApp Business', icon: '💬', description: 'API de WhatsApp para mensajes', connected: false,
    fields: [{ name: 'Phone Number ID', value: '', type: 'text' }, { name: 'Access Token', value: '', type: 'password' }] },
])

onMounted(async () => {
  try {
    // SMTP-UI (2026-08-19): se lee el CANÓNICO ('email_config', host/pass) con fallback al
    // legacy ('smtp', server/password) que guardaba esta misma página — antes el load ni
    // siquiera matcheaba los nombres (server ≠ smtpServer), así el form arrancaba vacío.
    const [plataforma, emailCfg, tmpl, seg, integ, maps] = await Promise.all([
      ConfigService.get('plataforma', 'platform'),
      ConfigService.get('email_config', 'platform').catch(() => null),
      ConfigService.get('email_templates', 'platform'),
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
    if (Array.isArray(tmpl)) emailTemplates.value = tmpl
    if (Array.isArray(seg)) securityOptions.value = seg
    if (Array.isArray(integ)) integrations.value = integ
    if (maps?.apiKey) mapsKey.value = String(maps.apiKey)
  } catch { toast.error('No se pudo cargar la configuración de la plataforma') }
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
    showSaved.value = true
    setTimeout(() => showSaved.value = false, 2000)
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
