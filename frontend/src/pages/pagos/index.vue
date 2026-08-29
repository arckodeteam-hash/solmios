<template>
  <div>
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Pasarelas de Pago</h2>
        <p class="text-sm text-text-muted mt-0.5">Conectá tu cuenta: el dinero de tus reservas entra directo a tu banco</p>
      </div>
    </div>

    <!-- Cada hotel cobra a SU cuenta: el aviso importa porque acá se cargan llaves que mueven plata -->
    <div class="mb-6 flex gap-3 rounded-2xl border border-cyan/30 bg-cyan/5 px-4 py-3.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan/15 text-cyan">
        <span class="h-4.5 w-4.5" v-html="ICON_LOCK"></span>
      </span>
      <div class="text-xs leading-relaxed text-text-secondary">
        <strong class="text-navy">Estas credenciales son tuyas y de nadie más.</strong>
        Los cobros de tu hotel se procesan contra la cuenta que configurés acá, y el dinero llega a tu banco.
        Las llaves se guardan cifradas y no se muestran nunca más una vez cargadas.
      </div>
    </div>

    <SkeletonLoader v-if="loading" variant="card" :rows="3" />

    <!-- Sin pasarela activa no hay cobro online: ni el motor de reservas ni los links de pago
         pueden capturar plata. El catálogo de abajo nunca está vacío, así que el vacío real
         (cero pasarelas conectadas) se avisa acá arriba con el primer paso. -->
    <SetupAlert
      v-if="!loading && !activeGateway"
      class="mb-6"
      :title="gateways.length === 0 ? 'Todavía no podés cobrar online' : 'Ninguna pasarela está activa'"
      :message="gateways.length === 0
        ? 'No hay ninguna pasarela conectada. Hasta que conectes una, las reservas del motor y los links de pago no pueden cobrarse.'
        : 'Cargaste las credenciales pero la pasarela está desactivada, así que los cobros online no se procesan. Activala para empezar a cobrar.'"
    >
      <template v-if="canEditGateways" #action>
        <button
          @click="openSetupForm"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer"
        >
          {{ gateways.length === 0 ? 'Conectar una pasarela' : 'Activar pasarela' }}
        </button>
      </template>
    </SetupAlert>

    <div v-if="!loading" class="space-y-4">
      <SectionCard v-for="p in providers" :key="p.provider"
        :title="p.name" :subtitle="p.description" body-class="p-0">
        <template #actions>
          <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide" :class="providerBadge(p)">
            {{ providerStatus(p) }}
          </span>
          <button
            v-if="p.implemented"
            @click="toggleForm(p.provider)"
            class="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/15 transition-colors cursor-pointer"
          >{{ openForm === p.provider ? 'Cerrar' : (gatewayOf(p.provider) ? 'Editar' : 'Configurar') }}</button>
        </template>

        <!-- Lo que el proveedor puede y no puede hacer: se lee del backend, no se adivina -->
        <div v-if="p.implemented || gatewayOf(p.provider)" class="flex flex-wrap gap-2 px-5 py-4">
          <span class="rounded-full bg-surface px-2.5 py-1 text-[10px] font-bold text-text-secondary">{{ confirmationLabel(p.confirmation) }}</span>
          <span class="rounded-full px-2.5 py-1 text-[10px] font-bold" :class="p.capabilities.refund ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'">
            {{ p.capabilities.refund ? 'Permite reembolsos' : 'No permite reembolsos' }}
          </span>
          <span v-if="p.capabilities.paymentLinks" class="rounded-full bg-surface px-2.5 py-1 text-[10px] font-bold text-text-secondary">Links de pago</span>
        </div>

        <!-- Formulario -->
        <div v-if="openForm === p.provider" class="border-t border-border bg-surface/40 p-5">
          <!-- Sin credenciales de comercio reales: este flujo no se pudo probar contra el procesador -->
          <div v-if="PENDING_VERIFICATION.includes(p.provider)" class="mb-4 flex gap-3 rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3">
            <span class="mt-0.5 h-4 w-4 shrink-0 text-warning" v-html="ICON_ALERT"></span>
            <p class="text-[11px] font-bold text-warning">
              Modo prueba — pendiente verificación con procesador real. Todavía no probamos esta pasarela contra el sandbox real de {{ p.name }} (sin credenciales de comercio).
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label :for="`pagos-${p.provider}-mode`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Modo</label>
              <select :id="`pagos-${p.provider}-mode`" name="mode" v-model="form.mode" class="w-full cursor-pointer rounded-xl border border-border bg-white px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
                <option value="test">Prueba (no cobra dinero real)</option>
                <option value="live">Producción (cobra dinero real)</option>
              </select>
            </div>
            <div>
              <label :for="`pagos-${p.provider}-currency`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Moneda</label>
              <select :id="`pagos-${p.provider}-currency`" name="currency" v-model="form.currency" class="w-full cursor-pointer rounded-xl border border-border bg-white px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
                <option value="usd">USD — Dólar</option>
                <option value="dop">DOP — Peso dominicano</option>
                <option value="eur">EUR — Euro</option>
              </select>
            </div>
            <div v-if="needsMerchantId(p.provider)">
              <label :for="`pagos-${p.provider}-merchant-id`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">{{ merchantIdLabel(p.provider) }}</label>
              <input
                :id="`pagos-${p.provider}-merchant-id`" name="merchantId" autocomplete="off"
                v-model="form.merchantId" type="text"
                :placeholder="current?.hasMerchantId ? '•••••••• (guardado)' : 'Asignado por el procesador'"
                class="w-full rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-sm focus:border-navy focus:outline-none"
              />
              <p v-if="current?.hasMerchantId" class="mt-1.5 text-[11px] text-text-muted">Guardado. Dejalo vacío para conservarlo.</p>
            </div>
            <div v-if="p.provider === 'cardnet'">
              <label :for="`pagos-${p.provider}-terminal-id`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Terminal (CardNet)</label>
              <input :id="`pagos-${p.provider}-terminal-id`" name="terminalId" autocomplete="off" v-model="form.terminalId" type="text" placeholder="Terminal asignada por CardNet"
                class="w-full rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-sm focus:border-navy focus:outline-none" />
            </div>
            <div>
              <label :for="`pagos-${p.provider}-secret-key`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">{{ secretLabel(p.provider) }}</label>
              <input
                :id="`pagos-${p.provider}-secret-key`" name="secretKey" autocomplete="new-password"
                v-model="form.secretKey" type="password"
                :placeholder="current?.hasSecret ? `${current.secretMask} (guardada)` : secretPlaceholder(p.provider)"
                class="w-full rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-sm focus:border-navy focus:outline-none"
              />
              <p v-if="current?.hasSecret" class="mt-1.5 text-[11px] text-text-muted">Guardada. Dejala vacía para conservarla.</p>
            </div>
            <div v-if="p.provider === 'stripe' || p.provider === 'paypal'">
              <label :for="`pagos-${p.provider}-publishable-key`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Llave pública</label>
              <input :id="`pagos-${p.provider}-publishable-key`" name="publishableKey" autocomplete="off" v-model="form.publishableKey" type="text" placeholder="pk_test_… o pk_live_…"
                class="w-full rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-sm focus:border-navy focus:outline-none" />
            </div>
            <div v-if="p.provider === 'azul'">
              <label :for="`pagos-${p.provider}-cert-pem`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Certificado cliente (PEM)</label>
              <textarea
                :id="`pagos-${p.provider}-cert-pem`" name="certPem"
                v-model="form.certPem" rows="3"
                :placeholder="current?.hasCert ? '•••••••• (guardado)' : '-----BEGIN CERTIFICATE-----…'"
                class="w-full rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-xs focus:border-navy focus:outline-none"
              ></textarea>
            </div>
            <div v-if="p.provider === 'azul'">
              <label :for="`pagos-${p.provider}-cert-key-pem`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Llave del certificado (PEM)</label>
              <textarea
                :id="`pagos-${p.provider}-cert-key-pem`" name="certKeyPem"
                v-model="form.certKeyPem" rows="3"
                :placeholder="current?.hasCert ? '•••••••• (guardada)' : '-----BEGIN PRIVATE KEY-----…'"
                class="w-full rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-xs focus:border-navy focus:outline-none"
              ></textarea>
              <p v-if="current?.hasCert" class="mt-1.5 text-[11px] text-text-muted">Guardados. Dejalos vacíos para conservarlos.</p>
            </div>
            <div v-if="p.provider === 'stripe' || p.provider === 'paypal'" class="md:col-span-2">
              <label :for="`pagos-${p.provider}-webhook-secret`" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Secreto del webhook</label>
              <input
                :id="`pagos-${p.provider}-webhook-secret`" name="webhookSecret" autocomplete="new-password"
                v-model="form.webhookSecret" type="password"
                :placeholder="current?.hasWebhookSecret ? '•••••••• (guardado)' : 'whsec_…'"
                class="w-full rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-sm focus:border-navy focus:outline-none"
              />
              <p class="mt-1.5 text-[11px] text-text-muted">
                En Stripe, apuntá el webhook a: <code class="font-mono text-navy">{{ webhookUrl }}</code>
                <span class="mt-1 block text-text-muted">Con esta única URL alcanza: cubre tanto los links de pago como las reservas del motor web.</span>
              </p>
            </div>
          </div>

          <!-- Modo producción: el aviso va antes de los botones, no después -->
          <div v-if="form.mode === 'live'" class="mt-4 flex gap-3 rounded-2xl border border-coral/30 bg-coral/5 px-4 py-3">
            <span class="mt-0.5 h-4 w-4 shrink-0 text-coral" v-html="ICON_ALERT"></span>
            <p class="text-[11px] font-bold text-coral">
              En modo Producción los cobros son reales y el dinero se mueve de verdad.
            </p>
          </div>

          <div class="mt-5 flex flex-wrap items-center gap-2">
            <button @click="save(p.provider)" :disabled="saving"
              class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
              {{ saving ? 'Guardando…' : 'Guardar' }}
            </button>
            <button v-if="current" @click="testConnection(current.id)" :disabled="testing"
              class="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-light transition-colors cursor-pointer disabled:opacity-50">
              {{ testing ? 'Probando…' : 'Probar conexión' }}
            </button>
            <button v-if="current" @click="toggleEnabled(current)"
              class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer">
              {{ current.enabled ? 'Desactivar' : 'Activar' }}
            </button>
            <button v-if="current" @click="remove(current)" title="Eliminar pasarela"
              class="ml-auto grid h-9 w-9 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
              <span class="h-4 w-4" v-html="ICON_TRASH"></span>
            </button>
          </div>
        </div>
      </SectionCard>
    </div>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useToast } from '@/composables/useToast'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SetupAlert from '@/components/ui/SetupAlert.vue'
import { usePermissions } from '@/composables/usePermissions'

const ICON_LOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="11" width="16" height="10" rx="2"/><path stroke-linecap="round" d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
const ICON_ALERT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>'
import { useAuthStore } from '@/stores/auth.store'
import {
  PaymentGatewayService,
  type PaymentGateway,
  type PaymentProvider,
  type ConfirmationMode,
} from '@/services/PaymentGateway.service'

const toast = useToast()
const { handle } = useApiError()
const auth = useAuthStore()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => load(),
  onError: (e) => handle(e, 'No se pudo eliminar la pasarela'),
})

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const gateways = ref<PaymentGateway[]>([])
const openForm = ref<PaymentProvider | null>(null)

const form = reactive({
  mode: 'test' as 'test' | 'live',
  currency: 'usd',
  secretKey: '',
  publishableKey: '',
  webhookSecret: '',
  // Azul: MerchantId · CardNet: Comercio.
  merchantId: '',
  // CardNet: Terminal. Azul no lo usa.
  terminalId: '',
  // Azul (mTLS): el usuario pega el PEM tal cual (con sus saltos de línea) en un textarea; se
  // codifica a base64 recién al armar el payload (ver save()) para que el validador del backend
  // no le colapse los saltos de línea a un espacio.
  certPem: '',
  certKeyPem: '',
})

/** Pendientes de verificación real: sin credenciales de comercio, Azul/CardNet no se probaron end-to-end. */
const PENDING_VERIFICATION: PaymentProvider[] = ['azul', 'cardnet']

function needsMerchantId(provider: PaymentProvider): boolean {
  return provider === 'azul' || provider === 'cardnet'
}
function merchantIdLabel(provider: PaymentProvider): string {
  return provider === 'azul' ? 'Merchant ID (Azul)' : 'Comercio (CardNet)'
}
function secretLabel(provider: PaymentProvider): string {
  if (provider === 'azul') return 'AuthKey (llave de firma de Azul)'
  if (provider === 'cardnet') return 'Llave (firma de CardNet)'
  return 'Llave secreta'
}
function secretPlaceholder(provider: PaymentProvider): string {
  if (provider === 'azul') return 'AuthKey que te dio Azul…'
  if (provider === 'cardnet') return 'Llave que te dio CardNet…'
  return 'sk_test_… o sk_live_…'
}

/**
 * Catálogo de proveedores. Las capacidades reales las manda el backend por cada pasarela ya
 * configurada; esto describe lo que el sistema ofrece hoy. `implemented: false` = el puerto lo
 * admite pero falta el adapter, así que no se puede configurar todavía.
 */
const CATALOG = [
  {
    provider: 'stripe' as PaymentProvider,
    name: 'Stripe',
    icon: '💳',
    description: 'Tarjetas internacionales. Cobros, links de pago y reembolsos.',
    implemented: true,
    confirmation: 'push' as ConfirmationMode,
    capabilities: { refund: true, void: true, paymentLinks: true, confirmation: 'push' as ConfirmationMode },
  },
  {
    provider: 'azul' as PaymentProvider,
    name: 'Azul (Banco Popular)',
    icon: '🇩🇴',
    description: 'Pasarela dominicana. El huésped paga en el sitio de Azul y vuelve.',
    implemented: true,
    confirmation: 'return' as ConfirmationMode,
    capabilities: { refund: false, void: false, paymentLinks: false, confirmation: 'return' as ConfirmationMode },
  },
  {
    provider: 'cardnet' as PaymentProvider,
    name: 'CardNet',
    icon: '🏦',
    description: 'Pasarela dominicana. Requiere confirmar el tipo de contrato con tu ejecutivo.',
    implemented: true,
    confirmation: 'pull' as ConfirmationMode,
    capabilities: { refund: true, void: true, paymentLinks: false, confirmation: 'pull' as ConfirmationMode },
  },
  {
    provider: 'paypal' as PaymentProvider,
    name: 'PayPal',
    icon: '🅿️',
    description: 'Wallet y tarjetas. El huésped paga en PayPal y vuelve.',
    implemented: false,
    confirmation: 'push' as ConfirmationMode,
    capabilities: { refund: true, void: true, paymentLinks: false, confirmation: 'push' as ConfirmationMode },
  },
]

const providers = computed(() => CATALOG)

const current = computed(() => (openForm.value ? gatewayOf(openForm.value) : undefined))

// La ruta real del backend es /api/stripe/webhook/:hotelId (payment-requests/index.ts). Antes acá
// figuraba /api/webhooks/stripe/{tuHotelId} — path invertido y el placeholder sin reemplazar: quien
// registraba ESA URL en Stripe recibía 404 y el pago de la seña nunca se confirmaba.
//
// Esta URL alcanza para TODOS los cobros del hotel. El sistema tiene dos handlers —links de pago y
// motor de reservas público— y el connector `payment-requests-bookingengine-webhook` los cruza: el
// que recibe un evento del otro flujo se lo reenvía. Antes acá se publicaba sólo la de links de
// pago, así que todo cobro del motor moría en el handler equivocado con un 200 mudo: el huésped
// pagaba y su reserva quedaba `pending` para siempre (verificado en producción, 2026-08-28).
const webhookUrl = computed(() => {
  const hid = auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : '{tuHotelId}'
  return `${window.location.origin}/api/stripe/webhook/${hid}`
})

function gatewayOf(provider: PaymentProvider): PaymentGateway | undefined {
  return gateways.value.find(g => g.provider === provider)
}

// Todas las rutas de /api/payment-gateways piden `billing:edit` (backend: modules/payment-gateways/
// index.ts:61-65). Sin el permiso el CTA no se muestra: apretarlo terminaría en 403.
const { can } = usePermissions()
const canEditGateways = computed(() => can('billing', 'edit'))

/** ¿Hay alguna pasarela que efectivamente cobre? Cargada pero apagada NO cuenta. */
const activeGateway = computed(() => gateways.value.find(g => g.enabled))

/** Primer paso: abrir el formulario que ya existe — el de la pasarela cargada, o Stripe si no hay ninguna. */
function openSetupForm() {
  const firstConfigured = gateways.value.find(g => CATALOG.some(c => c.provider === g.provider && c.implemented))
  const target = firstConfigured?.provider ?? 'stripe'
  // toggleForm cierra si ya está abierto; acá el CTA siempre tiene que ABRIR.
  if (openForm.value !== target) toggleForm(target)
}

// Estado de la pasarela en una sola lectura: no implementada / activa / cargada pero apagada / vacía.
function providerStatus(p: { provider: PaymentProvider; implemented: boolean }): string {
  if (!p.implemented) return 'Próximamente'
  const gw = gatewayOf(p.provider)
  if (gw?.enabled) return 'Activa'
  if (gw) return 'Configurada — inactiva'
  return 'Sin configurar'
}

function providerBadge(p: { provider: PaymentProvider; implemented: boolean }): string {
  if (!p.implemented) return 'bg-white/10 text-white/60'
  const gw = gatewayOf(p.provider)
  if (gw?.enabled) return 'bg-[#22C55E]/20 text-[#4ADE80]'
  if (gw) return 'bg-gold/20 text-gold'
  return 'bg-white/10 text-white/60'
}

function confirmationLabel(mode: ConfirmationMode): string {
  if (mode === 'push') return 'Confirma solo (webhook)'
  if (mode === 'return') return 'Confirma al volver del pago'
  return 'Confirma por consulta'
}

async function load() {
  loading.value = true
  try {
    const r = await PaymentGatewayService.list()
    gateways.value = r.data || []
  } catch (e) {
    toast.error((e as Error).message || 'No se pudieron cargar las pasarelas')
  } finally {
    loading.value = false
  }
}

function toggleForm(provider: PaymentProvider) {
  if (openForm.value === provider) {
    openForm.value = null
    return
  }
  openForm.value = provider
  const existing = gatewayOf(provider)
  // Los secretos nunca vuelven del backend: los campos arrancan vacíos y vacío = "no lo toques".
  form.mode = existing?.mode ?? 'test'
  form.currency = existing?.currency ?? 'usd'
  form.secretKey = ''
  form.publishableKey = ''
  form.webhookSecret = ''
  form.merchantId = ''
  form.terminalId = ''
  form.certPem = ''
  form.certKeyPem = ''
}

/** btoa asume Latin1; un PEM (dashes, base64, saltos de línea) es ASCII puro, así que es seguro. */
function toBase64(s: string): string {
  return btoa(s)
}

async function save(provider: PaymentProvider) {
  const existing = gatewayOf(provider)
  if (!existing && !form.secretKey) {
    toast.error('Cargá la llave secreta para conectar la pasarela')
    return
  }
  saving.value = true
  try {
    await PaymentGatewayService.upsert({
      provider,
      mode: form.mode,
      currency: form.currency,
      // Vacíos = conservar los guardados. No mandarlos evita pisarlos con ''.
      ...(form.secretKey ? { secretKey: form.secretKey } : {}),
      ...(form.publishableKey ? { publishableKey: form.publishableKey } : {}),
      ...(form.webhookSecret ? { webhookSecret: form.webhookSecret } : {}),
      ...(form.merchantId ? { merchantId: form.merchantId } : {}),
      ...(form.terminalId ? { terminalId: form.terminalId } : {}),
      // PEM codificado en base64: el backend lo decodifica antes de guardar (ver PaymentGatewaysService.upsert).
      ...(form.certPem ? { certPem: toBase64(form.certPem) } : {}),
      ...(form.certKeyPem ? { certKeyPem: toBase64(form.certKeyPem) } : {}),
      ...(existing ? {} : { enabled: true, isDefault: gateways.value.length === 0 }),
    })
    toast.success('Pasarela guardada')
    form.secretKey = ''
    form.webhookSecret = ''
    form.certPem = ''
    form.certKeyPem = ''
    await load()
  } catch (e) {
    // El backend rechaza, por ejemplo, una llave sk_live_ guardada en modo prueba.
    toast.error((e as Error).message || 'No se pudo guardar la pasarela')
  } finally {
    saving.value = false
  }
}

async function testConnection(id: string) {
  testing.value = true
  try {
    const r = await PaymentGatewayService.test(id)
    if (r.ok) toast.success(r.message)
    else toast.error(r.message)
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo probar la conexión')
  } finally {
    testing.value = false
  }
}

async function toggleEnabled(gw: PaymentGateway) {
  try {
    await PaymentGatewayService.setEnabled(gw.id, !gw.enabled)
    toast.success(gw.enabled ? 'Pasarela desactivada' : 'Pasarela activada')
    await load()
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo cambiar el estado')
  }
}

function remove(gw: PaymentGateway) {
  askConfirm({
    title: 'Eliminar pasarela',
    message: `¿Eliminar la pasarela ${gw.provider}? Vas a tener que volver a cargar las llaves para cobrar.`,
    confirmLabel: 'Eliminar',
    danger: true,
    run: async () => {
      await PaymentGatewayService.remove(gw.id)
      toast.success('Pasarela eliminada')
      openForm.value = null
    },
  })
}

onMounted(load)
</script>

<style scoped>
code {
  word-break: break-all;
}
</style>
