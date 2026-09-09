<template>
  <!-- Plan contratado, en la barra superior del panel.
       Es la única pastilla que navega: el resto informa, esta lleva a /panel/suscripcion — que
       hasta acá solo era alcanzable desde el aviso de la prueba y quedaba huérfana apenas el
       hotel pagaba (el aviso desaparece en `active`).

       Vive en su propio componente y no dentro de CommandCenterHeader porque ese header es
       PRESENTACIONAL: recibe todo por props y no toca stores. Lo que necesita dependencias
       propias (UserMenu, NotificationBell, EmergencyButton) va en hijos, que además así se
       stubean en los tests del header sin arrastrar pinia. -->
  <router-link v-if="show" to="/panel/suscripcion" class="pill" :title="title">
    <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full" :class="iconClass">
      <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
      </svg>
    </span>
    <div class="min-w-0">
      <div class="pill-label truncate">Tu plan</div>
      <div class="truncate text-[12px] font-black leading-tight uppercase" :class="textClass">{{ value }}</div>
      <div class="pill-sub truncate">{{ hint }}</div>
    </div>
  </router-link>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { useSubscriptionStore } from '@/stores/subscription.store'

const auth = useAuthStore()
const subscription = useSubscriptionStore()

/** Solo el dueño/gerente. Recepción, limpieza y mantenimiento no ven el plan ni los precios:
 *  no pueden cambiarlo (la ruta los rebota por `requiresHotelAdmin`) y les comería ancho de las
 *  pastillas que sí usan. */
const puedeVer = computed(() => auth.canActAsHotelAdmin)
const show = computed(() => puedeVer.value && subscription.ready && !!subscription.status)

/** Nombre del plan; si el hotel todavía no eligió ninguno, el estado hace de nombre. */
const value = computed(() => {
  if (subscription.planName) return subscription.planName
  return subscription.status === 'trialing' ? 'Prueba gratis' : 'Sin plan'
})

/** La segunda línea dice qué HACER, no repite el estado: es lo que justifica que la pastilla
 *  sea un link. En marcha invita a mejorar; en problema, dice qué hay que resolver. */
const hint = computed(() => {
  const dias = subscription.sub?.daysLeft
  switch (subscription.status) {
    case 'trialing':
      return dias === null || dias === undefined
        ? 'Elegí tu plan'
        : `${dias} ${dias === 1 ? 'día' : 'días'} de prueba`
    case 'active': return 'Ver o mejorar plan'
    case 'past_due': return 'Pago pendiente'
    case 'expired': return 'Vencida — reactivar'
    case 'canceled': return 'Cancelada — reactivar'
    case 'suspended': return 'Suspendida — regularizar'
    default: return 'Elegí tu plan'
  }
})

const title = computed(() => `${value.value} · ${hint.value}`)

/** Mismo semáforo que el resto de la barra: verde en marcha, ámbar si hay que actuar, rojo si
 *  ya cortó. Sin esto, un "pago pendiente" se leería igual que un plan al día. */
const tone = computed(() => {
  switch (subscription.status) {
    case 'active': return 'ok'
    case 'trialing': return 'info'
    case 'past_due': return 'warn'
    case 'none': return 'muted'
    default: return 'danger' // expired / canceled / suspended
  }
})
const textClass = computed(() => ({
  ok: 'text-[#22C55E]', info: 'text-white', warn: 'text-[#F59E0B]',
  danger: 'text-[#EF4444]', muted: 'text-slate-500',
}[tone.value]))
const iconClass = computed(() => ({
  ok: 'bg-[#22C55E]/20 text-[#22C55E]', info: 'bg-[#06B6D4]/20 text-[#22D3EE]',
  warn: 'bg-[#F59E0B]/20 text-[#F59E0B]', danger: 'bg-[#EF4444]/20 text-[#EF4444]',
  muted: 'bg-white/5 text-slate-500',
}[tone.value]))

onMounted(() => {
  // Solo para quien la va a ver: no gastar un request por cada recepcionista que abre el panel.
  if (!puedeVer.value) return
  const hotelId = auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : null
  void subscription.ensure(hotelId)
})
</script>

<style scoped>
/* Mismas medidas que las pastillas del header (`.cc-pill`), más el affordance de clic: se
   despega apenas del resto, sin borde ni fondo propio que la haría competir con las otras. */
.pill {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 0%;
  min-width: 0;
  cursor: pointer;
  border-radius: 12px;
  margin: -6px -8px;
  padding: 6px 8px;
  transition: background-color 0.15s ease;
}
.pill:hover {
  background: rgba(255, 255, 255, 0.06);
}
.pill-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--color-text-muted);
}
.pill-sub {
  font-size: 10px;
  color: var(--color-text-secondary);
}
</style>
