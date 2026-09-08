<template>
  <!-- Aviso del estado de la suscripción.
       Sin esto, el corte llega de sorpresa: el hotel entra, trabaja normal y de golpe no puede
       iniciar sesión. Antes este aviso solo existía durante la prueba (`TrialBanner`) y
       desaparecía apenas el hotel pagaba — justo cuando aparecen los estados que SÍ exigen
       actuar (pago rechazado, suscripción vencida o suspendida) y no había ni un cartel. -->
  <div
    v-if="tone"
    class="flex items-center gap-3 px-6 py-2.5 border-b"
    :class="tone === 'danger' ? 'bg-danger/10 border-danger/30'
      : tone === 'warn' ? 'bg-warning/10 border-warning/30'
      : 'bg-cyan/5 border-cyan/20'"
  >
    <span
      class="text-[10px] font-black px-2 py-1 rounded-full shrink-0"
      :class="tone === 'danger' ? 'bg-danger text-white'
        : tone === 'warn' ? 'bg-warning text-navy'
        : 'bg-cyan text-navy'"
    >{{ tag }}</span>

    <span class="text-xs font-bold text-navy">{{ headline }}</span>

    <span class="text-[11px] text-text-secondary hidden sm:inline">{{ detail }}</span>

    <router-link
      to="/panel/suscripcion"
      class="ml-auto shrink-0 px-3.5 py-1.5 rounded-full bg-navy text-white text-[11px] font-bold hover:bg-navy-light transition-colors"
    >{{ cta }}</router-link>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { useSubscriptionStore } from '@/stores/subscription.store'

/** A partir de acá el aviso de la prueba cambia de informativo a urgente. */
const URGENT_FROM_DAYS = 3

const auth = useAuthStore()
const subscription = useSubscriptionStore()

/** Solo el dueño/gerente: es el único que puede resolverlo, y el CTA lleva a una ruta que a
 *  los demás roles los rebota al panel (`requiresHotelAdmin`). Un cartel con un botón que no
 *  lleva a ningún lado es peor que no tener cartel. */
const puedeActuar = computed(() => auth.canActAsHotelAdmin)

const daysLeft = computed(() => subscription.sub?.daysLeft ?? null)

/** El tono decide si el aviso se muestra: `null` = suscripción al día, nada que avisar. */
const tone = computed<'info' | 'warn' | 'danger' | null>(() => {
  if (!puedeActuar.value || !subscription.ready) return null
  switch (subscription.status) {
    case 'trialing':
      if (daysLeft.value === null) return null
      return daysLeft.value <= URGENT_FROM_DAYS ? 'warn' : 'info'
    case 'past_due': return 'warn'
    case 'expired':
    case 'canceled':
    case 'suspended': return 'danger'
    default: return null // active / none: no hay nada que resolver
  }
})

const tag = computed(() => {
  switch (subscription.status) {
    case 'trialing': return 'PRUEBA GRATIS'
    case 'past_due': return 'PAGO PENDIENTE'
    case 'suspended': return 'SUSPENDIDA'
    case 'canceled': return 'CANCELADA'
    default: return 'VENCIDA'
  }
})

const headline = computed(() => {
  const d = daysLeft.value
  switch (subscription.status) {
    case 'trialing':
      if (d === 0) return 'Tu prueba termina hoy'
      if (d === 1) return 'Te queda 1 día de prueba'
      return `Te quedan ${d} días de prueba`
    case 'past_due': return 'No pudimos cobrar tu suscripción'
    case 'suspended': return 'Tu suscripción está suspendida'
    case 'canceled': return 'Tu suscripción está cancelada'
    default: return 'Tu suscripción venció'
  }
})

const detail = computed(() => {
  switch (subscription.status) {
    case 'trialing': return 'Después vas a necesitar un plan para seguir entrando.'
    case 'past_due': return 'Actualizá tu método de pago antes de que se corte el acceso.'
    case 'suspended': return 'Regularizá el pago para volver a entrar al panel.'
    default: return 'Elegí un plan para recuperar el acceso.'
  }
})

const cta = computed(() =>
  subscription.status === 'trialing' ? 'Ver planes'
    : subscription.status === 'past_due' || subscription.status === 'suspended' ? 'Regularizar'
      : 'Elegir plan',
)

onMounted(() => {
  if (!puedeActuar.value) return
  const hotelId = auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : null
  void subscription.ensure(hotelId)
})
</script>

<style scoped>
</style>
