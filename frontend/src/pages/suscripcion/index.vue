<template>
  <div>
    <div class="mb-6">
      <h2 class="text-xl font-black text-navy">Tu suscripción</h2>
      <p class="text-sm text-text-muted mt-0.5">Estado de tu cuenta y planes disponibles</p>
    </div>

    <!-- Estado actual -->
    <SectionCard title="Estado" :subtitle="stateSubtitle">
      <div v-if="loading" class="h-16 animate-pulse rounded-xl bg-surface"></div>
      <div v-else class="flex items-center gap-4 flex-wrap">
        <!-- El plan se nombra SIEMPRE que se sepa cuál es, también con la suscripción vencida: el
             badge solo dice cómo está, no de qué plan (CA 9/10/22). Sin `planName` (plan retirado
             del catálogo) el bloque no se pinta en vez de mostrar "Plan actual: —". -->
        <div v-if="sub?.planName" class="text-sm text-text-secondary">
          Plan actual: <strong class="text-navy">{{ sub.planName }}</strong>
        </div>
        <span class="text-[11px] font-bold px-3 py-1.5 rounded-full" :class="statusClass">{{ statusLabel }}</span>
        <span v-if="sub?.specialCategory" class="text-[11px] font-bold px-3 py-1.5 rounded-full bg-warning/10 text-warning">{{ categoryLabel(sub.specialCategory) }}</span>
        <span v-if="sub?.activeDiscountPct" class="text-[11px] font-bold px-3 py-1.5 rounded-full bg-teal/10 text-teal">{{ sub.activeDiscountPct }}% de descuento activo</span>
        <div v-if="sub?.status === 'trialing' && sub.daysLeft !== null" class="text-sm text-text-secondary">
          Te {{ sub.daysLeft === 1 ? 'queda' : 'quedan' }}
          <strong class="text-navy">{{ sub.daysLeft }} {{ sub.daysLeft === 1 ? 'día' : 'días' }}</strong>
          de prueba.
        </div>
        <div v-else-if="sub?.status === 'past_due'" class="text-sm text-warning font-bold">
          Tu pago está pendiente. Regularizalo antes de que termine el período de gracia para no perder el acceso.
        </div>
        <div v-else-if="sub && !sub.allowed" class="text-sm text-danger font-bold">
          Tu acceso está cortado. Elegí un plan para volver a entrar.
        </div>
        <button
          v-if="sub?.hasStripeCustomer"
          @click="openPortal"
          :disabled="portalLoading"
          class="ml-auto text-xs font-bold px-3 py-1.5 rounded-lg bg-surface text-navy hover:bg-surface-dark transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
        >{{ portalLoading ? 'Abriendo…' : 'Gestionar método de pago' }}</button>
      </div>
    </SectionCard>

    <!-- Suspendido: bloquea el resto del panel, solo queda pagar/reactivar -->
    <SectionCard v-if="sub?.status === 'suspended'" title="Suscripción suspendida" class="mt-6">
      <div class="text-center py-6">
        <p class="text-sm text-text-secondary mb-4 max-w-md mx-auto">
          Tu suscripción fue suspendida por falta de pago. Regularizá el pago para volver a acceder
          al panel y a tus reservas.
        </p>
        <button
          v-if="sub?.hasStripeCustomer"
          @click="openPortal"
          :disabled="portalLoading"
          class="px-6 py-2.5 bg-navy text-white rounded-xl text-sm font-bold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-60"
        >{{ portalLoading ? 'Abriendo…' : 'Regularizar pago' }}</button>
      </div>
    </SectionCard>

    <!-- Planes -->
    <div v-else class="mt-6">
      <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide mb-3">Planes disponibles</div>
      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="h-56 animate-pulse rounded-2xl bg-surface"></div>
      </div>
      <EmptyState
        v-else-if="!plans.length"
        title="Todavía no hay planes publicados"
        message="Escribinos y te ayudamos a activar tu cuenta."
      />
      <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          v-for="p in plans" :key="p.id"
          class="rounded-2xl border-2 bg-white p-5 flex flex-col transition-colors"
          :class="isCurrentPlan(p) ? 'border-navy' : 'border-border hover:border-navy/30'"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-black text-navy">{{ p.name }}</div>
            <span v-if="isCurrentPlan(p)" class="text-[9px] font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full shrink-0">Plan actual</span>
          </div>
          <div class="mt-2 mb-1">
            <span class="text-3xl font-black text-navy tabular-nums">${{ p.price }}</span>
            <span class="text-xs text-text-muted">/mes</span>
          </div>
          <p v-if="p.description" class="text-xs text-text-secondary mb-3">{{ p.description }}</p>
          <ul v-if="p.features?.length" class="space-y-1.5 mb-4">
            <li v-for="f in p.features" :key="f" class="flex items-start gap-2 text-xs text-text-secondary">
              <span class="w-3.5 h-3.5 mt-0.5 rounded-full bg-teal/15 grid place-items-center shrink-0">
                <svg class="w-2 h-2 text-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
              </span>
              {{ f }}
            </li>
          </ul>
          <button
            @click="choose(p)"
            :disabled="checkoutLoading !== null || previewLoading !== null || isPlanLocked(p)"
            class="mt-auto w-full py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-60"
            :class="isPlanLocked(p)
              ? 'bg-surface text-navy cursor-default'
              : 'bg-navy text-white hover:bg-navy-light cursor-pointer disabled:cursor-wait'"
          >{{ ctaLabel(p) }}</button>
        </div>
      </div>
    </div>

    <!-- Cambio de plan (#46, ampliado en #84 a las dos direcciones). Dos momentos, un solo modal:
         a) confirmación — el prorrateo SIEMPRE se muestra ANTES de tocar la tarjeta, sea un cobro
            (plan más caro) o un crédito a favor (plan más barato: no se cobra nada ahora);
         b) cobro rechazado — el plan quedó aplicado pero la factura no se pagó, y la única
            salida es arreglar el método de pago en el portal. -->
    <AppModal
      v-if="upgradePreview || pendingUpgrade"
      :title="pendingUpgrade ? 'Plan actualizado, pago pendiente' : 'Confirmar cambio de plan'"
      size="sm"
      @close="closeUpgrade"
    >
      <div v-if="pendingUpgrade" class="space-y-3">
        <p class="text-sm text-text-secondary">
          Ya estás en <strong class="text-navy">{{ pendingUpgrade.planName }}</strong>, pero no pudimos
          cobrar <strong class="text-navy tabular-nums">{{ money(pendingUpgrade.amountCharged, pendingUpgrade.currency) }}</strong>:
          el pago quedó pendiente.
        </p>
        <p class="text-sm text-warning font-bold">
          Actualizá tu método de pago para que no se corte el acceso — vamos a reintentar el cobro.
        </p>
      </div>
      <div v-else-if="upgradePreview" class="space-y-3">
        <p class="text-sm text-text-secondary">
          Vas a pasar de <strong class="text-navy">{{ upgradePreview.currentPlanName }}</strong>
          a <strong class="text-navy">{{ upgradePreview.planName }}</strong>.
        </p>
        <div class="rounded-xl bg-teal/10 p-4">
          <template v-if="upgradePreview.amountDue > 0">
            <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide">Se te cobra ahora</div>
            <div class="text-2xl font-black text-navy tabular-nums">{{ money(upgradePreview.amountDue, upgradePreview.currency) }}</div>
            <p class="text-xs text-text-secondary mt-1">
              Es solo la diferencia por lo que falta del ciclo{{ periodEndLabel }}. Desde la próxima
              renovación pagás el precio completo del plan nuevo.
            </p>
          </template>
          <template v-else>
            <!-- Bajar de plan con prorrateo genera CRÉDITO, no cobro: decir "se te cobra 0" acá
                 haría dudar de si hay un cargo (#84). -->
            <div class="text-[10px] font-bold text-text-muted uppercase tracking-wide">No se te cobra nada ahora</div>
            <p class="text-xs text-text-secondary mt-1">
              El saldo a favor por lo que falta del ciclo{{ periodEndLabel }} se aplica a tu próxima
              factura. Desde la próxima renovación pagás el precio completo del plan nuevo.
            </p>
          </template>
        </div>
      </div>
      <template #footer>
        <template v-if="pendingUpgrade">
          <button
            @click="closeUpgrade"
            class="px-4 py-2 rounded-xl text-sm font-bold bg-surface text-navy hover:bg-surface-dark transition-colors cursor-pointer"
          >Cerrar</button>
          <button
            @click="openPortal"
            :disabled="portalLoading"
            class="px-4 py-2 rounded-xl text-sm font-bold bg-navy text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >{{ portalLoading ? 'Abriendo…' : 'Gestionar método de pago' }}</button>
        </template>
        <template v-else>
          <button
            @click="closeUpgrade"
            :disabled="upgradeLoading"
            class="px-4 py-2 rounded-xl text-sm font-bold bg-surface text-navy hover:bg-surface-dark transition-colors cursor-pointer disabled:opacity-60"
          >Cancelar</button>
          <button
            @click="confirmUpgrade"
            :disabled="upgradeLoading"
            class="px-4 py-2 rounded-xl text-sm font-bold bg-navy text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >{{ upgradeChargesNow ? (upgradeLoading ? 'Cobrando…' : 'Confirmar y pagar') : (upgradeLoading ? 'Aplicando…' : 'Confirmar cambio') }}</button>
        </template>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { SignupService, type PublicPlan, type MySubscription } from '@/services/Signup.service'
import { useSubscriptionStore } from '@/stores/subscription.store'
import { SubscriptionsService, type UpgradePreview, type UpgradeResult } from '@/services/Subscriptions.service'
import { useToast } from '@/composables/useToast'
import { formatCurrency } from '@/types/currency'
import { useModulesStore } from '@/stores/modules.store'
import { useAuthStore } from '@/stores/auth.store'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'

const toast = useToast()
const auth = useAuthStore()
/**
 * El estado de la suscripción es COMPARTIDO (barra superior, aviso, menú y esta página).
 * Esta página lo lee del store en vez de tener su propia copia: si no, mejorar el plan acá
 * dejaba a la pastilla del header y al aviso mostrando el plan viejo hasta el próximo F5.
 */
const subscription = useSubscriptionStore()

const loading = ref(true)
const sub = computed<MySubscription | null>(() => subscription.sub)
const plans = ref<PublicPlan[]>([])
/** id del plan cuyo checkout está en curso — null cuando no hay ninguno en vuelo. */
const checkoutLoading = ref<string | null>(null)
const portalLoading = ref(false)
/** id del plan cuyo cambio se está cotizando — null cuando no hay ninguno en vuelo. */
const previewLoading = ref<string | null>(null)
/** Cotización del prorrateo esperando confirmación. Mientras esto vale algo, NO se cobró nada. */
const upgradePreview = ref<UpgradePreview | null>(null)
/** Cambio de plan aplicado cuyo cobro quedó pendiente (`paid: false`). */
const pendingUpgrade = ref<UpgradeResult | null>(null)
const upgradeLoading = ref(false)

const STATUS_LABELS: Record<string, string> = {
  trialing: 'En prueba', active: 'Activa', past_due: 'Pago pendiente',
  expired: 'Vencida', canceled: 'Cancelada', suspended: 'Suspendida', none: 'Sin suscripción',
}
const CATEGORY_LABELS: Record<string, string> = { founder_one: 'Fundador Uno', founder_two: 'Fundador Dos', pioneer: 'Pionero' }
const categoryLabel = (key?: string | null) => (key ? CATEGORY_LABELS[key] ?? key : '')

const statusLabel = computed(() => STATUS_LABELS[sub.value?.status ?? 'none'] ?? sub.value?.status ?? '—')
const statusClass = computed(() => {
  const s = sub.value?.status
  if (s === 'active') return 'bg-teal/10 text-teal'
  if (s === 'trialing') return 'bg-cyan/10 text-cyan'
  if (s === 'past_due') return 'bg-warning/10 text-warning'
  if (s === 'none') return 'bg-surface text-text-muted'
  return 'bg-danger/10 text-danger' // expired / canceled / suspended
})
const stateSubtitle = computed(() =>
  sub.value?.trialEndsAt ? `Prueba hasta el ${new Date(sub.value.trialEndsAt).toLocaleDateString('es-DO')}` : '',
)

/**
 * Estados en los que YA existe una suscripción viva en Stripe. Ahí NINGÚN plan se contrata por
 * Checkout, ni siquiera uno distinto: lanzar el Checkout con CUALQUIER plan crea una SEGUNDA
 * suscripción (y un segundo cobro mensual) y huérfana la vieja — el webhook pisa
 * `stripeSubscriptionId` y la anterior sigue activa en Stripe sin rastro local (BUG-9).
 * Eso NO cambió. Lo que cambió (#46, ampliado en #84) es que hay una salida propia para cambiar
 * de plan sin pasar por el Checkout: `/subscriptions/upgrade` mueve el ítem de la suscripción que
 * ya existe y liquida SOLO el prorrateo (ver `isPlanChangeTarget`). Va en las DOS direcciones:
 * el backend acepta cualquier plan activo distinto del actual, más caro o más barato. El Billing
 * Portal ("Gestionar método de pago") queda para el método de pago, no para bajar de plan.
 * `trialing` NO entra: la prueba no tiene suscripción en Stripe todavía, y el Checkout es la
 * única vía para convertirla en plan pago (ver `subscriptions/usecases/create-checkout-session.ts`).
 */
const LIVE_STRIPE_STATUSES = ['active', 'past_due']

/** El badge "Plan actual" y el CTA miran lo MISMO: el plan, no el estado (issue #29). */
const isCurrentPlan = (p: PublicPlan) => !!sub.value?.planId && p.id === sub.value.planId
/** Hay una suscripción cobrando en Stripe ahora mismo. */
const hasLiveSubscription = computed(() => LIVE_STRIPE_STATUSES.includes(sub.value?.status ?? ''))
/** Plan al que se puede saltar con la suscripción viva: MISMO criterio que el backend
 * (`upgrade-plan.ts`), cualquier plan activo que no sea el actual — más caro o más barato (#84).
 * No mira el precio a propósito: si el plan actual fue retirado del catálogo público no se puede
 * comparar contra nada, y el backend igual resuelve el cambio. */
const isPlanChangeTarget = (p: PublicPlan) => hasLiveSubscription.value && !isCurrentPlan(p)
/** Lo único que no se re-contrata con la suscripción viva es el plan que ya se está pagando. */
const isPlanLocked = (p: PublicPlan) => hasLiveSubscription.value && isCurrentPlan(p)

function ctaLabel(p: PublicPlan): string {
  if (checkoutLoading.value === p.id) return 'Redirigiendo…'
  if (previewLoading.value === p.id) return 'Calculando…'
  // CA 2/25/26: TODO plan que no sea el actual se ofrece igual, sin etiquetar la dirección del
  // cambio ("Mejorar a X" / "Ya tenés una suscripción activa"). Lo que cambia por debajo es la
  // vía (cambio de plan con la suscripción viva, Checkout sin ella), no lo que se lee.
  if (!isCurrentPlan(p)) return `Suscribirse a ${p.name}`
  // CA 23/24: el plan del hotel se identifica como el actual y no se vuelve a contratar.
  if (isPlanLocked(p)) {
    return sub.value?.status === 'past_due' ? 'Tu plan actual · pago pendiente' : 'Tu plan actual'
  }
  if (sub.value?.status === 'trialing') return 'Activar tu plan actual'
  return `Reactivar ${p.name}` // expired / canceled: el plan sigue siendo el suyo, pero sin acceso
}

/** Elige un plan: crea la Checkout Session de Stripe y redirige el navegador ahí mismo
 * (no una pestaña nueva — el hotel tiene que volver a `/panel/suscripcion` al terminar). */
async function choose(p: PublicPlan) {
  if (checkoutLoading.value || previewLoading.value || isPlanLocked(p)) return
  // Con la suscripción viva el Checkout duplicaría el cobro: el cambio va por su propio flujo.
  if (isPlanChangeTarget(p)) return startUpgrade(p)
  checkoutLoading.value = p.id
  try {
    const { url } = await SubscriptionsService.checkout(p.id)
    window.location.href = url
  } catch (e: any) {
    toast.error('No se pudo iniciar el pago', e.message)
    checkoutLoading.value = null
  }
}

/** Los montos de Stripe vienen en CENTAVOS (la menor unidad de la moneda): sin dividir por 100,
 * un prorrateo de 12,34 se leería como 1234. */
const money = (cents: number, currency: string) => formatCurrency(cents / 100, currency)

/** Un prorrateo de 0 o menos no es un cobro: es crédito a favor (bajar de plan). */
const upgradeChargesNow = computed(() => (upgradePreview.value?.amountDue ?? 0) > 0)

/** " , hasta el 12/10/2026" — hasta cuándo cubre el ciclo que el hotel ya pagó. */
const periodEndLabel = computed(() => {
  const end = upgradePreview.value?.periodEnd
  return end ? `, hasta el ${new Date(end).toLocaleDateString('es-DO')}` : ''
})

/** Paso 1 del cambio de plan: cotiza el prorrateo y abre la confirmación. NO cobra nada — la
 * persona tiene que ver cuánto le sale antes de que le toquemos la tarjeta. */
async function startUpgrade(p: PublicPlan) {
  previewLoading.value = p.id
  try {
    upgradePreview.value = await SubscriptionsService.upgradePreview(p.id)
  } catch (e: any) {
    // El backend redacta estos motivos para el usuario final (plan inexistente o inactivo, sin
    // suscripción viva, plan sin precio en Stripe): se muestran tal cual vienen.
    toast.error('No pudimos calcular el cambio de plan', e.message)
  } finally {
    previewLoading.value = null // nunca dejar el botón colgado en "Calculando…"
  }
}

/** Paso 2: cobra la diferencia y aplica el plan. */
async function confirmUpgrade() {
  const preview = upgradePreview.value
  if (!preview || upgradeLoading.value) return
  upgradeLoading.value = true
  try {
    const result = await SubscriptionsService.upgrade(preview.planId)
    upgradePreview.value = null
    if (!result.applied) {
      // El backend confirmó contra Stripe que el cambio NO quedó aplicado (no se cobró nada y el
      // plan sigue siendo el viejo). Va antes que el chequeo de `paid` porque acá `paid` también
      // es false, y el mensaje de "pago pendiente" diría dos cosas falsas: que el plan quedó
      // activo y que hay un cobro que reintentar.
      toast.error('No pudimos aplicar el cambio de plan',
        'Tu plan y tu facturación quedaron como estaban. Probá de nuevo en un momento.')
    } else if (result.paid) {
      toast.success(`Ya estás en ${result.planName}`,
        result.amountCharged > 0
          ? `Te cobramos ${money(result.amountCharged, result.currency)} por lo que falta del ciclo.`
          : 'No te cobramos nada ahora: el saldo a favor se aplica a tu próxima factura.')
    } else {
      // `applied: true` con `paid: false`: en Stripe el plan nuevo YA rige, pero la factura del
      // prorrateo quedó ABIERTA y el dunning la va a reintentar. Decir "listo" acá sería mentir:
      // se avisa y se lo manda al portal a arreglar la tarjeta.
      pendingUpgrade.value = result
      toast.warning(`${result.planName} quedó activo, pero el pago está pendiente`,
        `No pudimos cobrar ${money(result.amountCharged, result.currency)}. Actualizá tu método de pago.`)
    }
    await refreshAfterUpgrade()
  } catch (e: any) {
    toast.error('No se pudo aplicar el cambio de plan', e.message)
  } finally {
    upgradeLoading.value = false
  }
}

function closeUpgrade() {
  if (upgradeLoading.value) return // no cerrar sobre un cobro en vuelo
  upgradePreview.value = null
  pendingUpgrade.value = null
}

/**
 * Deja la pantalla consistente sin F5: el estado de la suscripción (badge, "Plan actual", CTAs) y el
 * cache de módulos, que es lo que decide qué muestra el menú lateral — el plan nuevo habilita
 * módulos que el cache viejo sigue dando por apagados.
 *
 * `refresh()` y NO `reset()` + `ensure()`: `reset()` vacía el estado, y con el estado vacío el
 * store falla ABIERTO (todo visible), así que el menú parpadea mostrando módulos que el hotel
 * quizá no tiene hasta que llega la respuesta. `refresh()` fuerza el refetch conservando el
 * estado bueno mientras tanto. (`ensure()` solo no alcanza: refetchea si cambió el hotel, y acá
 * el hotel es el mismo.)
 * Los stores se resuelven acá y no en el setup porque solo hacen falta después del cambio.
 */
async function refreshAfterUpgrade() {
  await subscription.refresh(hotelIdActual()).catch(() => { /* el store conserva el estado bueno */ })
  // Best-effort: el cambio ya está liquidado y aplicado; un fallo refrescando el menú no es un
  // error que mostrarle a nadie (el próximo ensure() lo resuelve).
  try {
    await useModulesStore().refresh(useAuthStore().user?.hotelId)
  } catch { /* el menú se rehidrata en la próxima navegación */ }
}

async function openPortal() {
  if (portalLoading.value) return
  portalLoading.value = true
  try {
    const { url } = await SubscriptionsService.portal()
    window.location.href = url
  } catch (e: any) {
    toast.error('No se pudo abrir el portal de facturación', e.message)
    portalLoading.value = false
  }
}

/** Mismo criterio que el resto del panel: 'platform' no es un hotel. */
function hotelIdActual(): string | null {
  const id = auth.user?.hotelId
  return id && id !== 'platform' ? id : null
}

onMounted(async () => {
  try {
    const [, p] = await Promise.all([
      subscription.ensure(hotelIdActual()),
      SignupService.publicPlans().catch(() => []),
    ])
    plans.value = p
  } finally {
    loading.value = false
  }

  // Vuelta del Checkout/Portal de Stripe (success_url/cancel_url en create-checkout-session.ts).
  const params = new URLSearchParams(window.location.search)
  if (params.get('checkout') === 'success') {
    toast.success('¡Listo! Tu pago se está confirmando — puede tardar unos segundos en reflejarse acá.')
  } else if (params.get('checkout') === 'cancelled') {
    toast.info('Pago cancelado. Podés intentar de nuevo cuando quieras.')
  }
})
</script>

<style scoped>
</style>
