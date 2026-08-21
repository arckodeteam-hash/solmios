<template>
  <!--
    HeroSearchBar — buscador del hero de la landing pública (`/h/:slug`). ES para el huésped, no
    reusa el wizard del panel. Usado por las 3 variantes de HeroBlock.vue (classic/modern/
    boutique) con distinto wrapper.

    REDISEÑO (motor de reservas de verdad):
    - Fechas: antes eran dos `<input type="date">` sueltos — el huésped tenía que saber de
      memoria qué días hay lugar y cuánto sale cada noche. Ahora es UN campo que abre
      `RateCalendar`: vista de rango conectada, precio por noche en cada celda y días sin
      disponibilidad marcados (Baymard/NN-g: el buscador es el contenido primario del hero).
    - Huéspedes: QUITADO del buscador (2026-08-20, decisión de producto). Cada tipo de
      habitación tiene su propio límite de capacidad, y la ocupación exacta ("para 1"/"para
      2"/"para 4") se elige recién al ver los tipos disponibles (matriz de ocupaciones en
      `RoomsStep.vue`/`BookingModal.vue`), no de antemano en la barra de búsqueda — pedirla acá
      era un paso redundante que además podía excluir tipos válidos de la búsqueda inicial. El
      buscador consulta con la ocupación mínima (`store.guests` default 1, ver `useBooking.ts`)
      para no filtrar ningún tipo por capacidad.

    LAYOUT (fix v3 que se conserva): breakpoints de VIEWPORT (`sm:`/`lg:`) no saben que este
    componente vive dentro de un contenedor `max-w-3xl/4xl` — a un viewport ancho el breakpoint
    fuerza una fila que el ANCHO RENDERIZADO real no puede sostener, y los campos se salían del
    fondo blanco. Por eso TODOS los campos + el botón son hijos DIRECTOS de un único
    `flex flex-wrap` sin breakpoints, cada uno con su `min-width`: el browser decide cuántos
    entran según el espacio real y lo que no entra cae a la línea siguiente, siempre adentro del
    fondo blanco.
    ⚠️ Ya NO lleva `overflow-hidden`: recortaba los paneles flotantes. No hace falta — el wrap lo
    resuelve el flex, y los paneles van teletransportados a <body> (useAnchoredPanel), fuera
    también del `overflow-hidden` del <section> del hero.

    DESTINO DEL SUBMIT (2 caminos, a propósito):
    1. Dentro de la landing (`/h/:slug`) hay un `provideLandingBooking` → se abre `BookingModal`
       ENCIMA de la landing con las fechas ya cargadas y saltando directo al paso de
       habitaciones. El huésped nunca abandona la página del hotel.
    2. Fuera de la landing (sin provider) → se conserva la navegación a `/book/:slug` con el
       contrato de URL `?checkIn&checkOut` que lee `booking-widget.vue`. Sin `guests`/`rooms`/
       `children`: el widget tampoco los pide (mismo cambio de producto), y sin el param el
       store usa su propio default (`guests=1`, `useBooking.ts`). El param `?guests=` sigue
       existiendo por si un integrador externo lo manda a mano — solo se quitó el control que
       lo escribía DESDE la propia app.
  -->
  <form
    @submit.prevent="onSubmit"
    class="flex flex-wrap items-stretch gap-1 rounded-2xl bg-white p-2 shadow-2xl"
  >
    <RateCalendar
      v-model:check-in="checkIn"
      v-model:check-out="checkOut"
      :hotel-slug="hotelSlug"
      :guests="1"
      @validity="onCalendarValidity"
    />

    <button
      type="submit"
      class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy px-7 py-3 text-xs font-extrabold uppercase tracking-wide text-white transition-colors hover:bg-navy-light"
    >
      {{ ctaText }}
      <span aria-hidden="true">→</span>
    </button>

    <p v-if="error" class="basis-full px-2 text-xs font-bold text-danger" role="alert">{{ error }}</p>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import RateCalendar from './RateCalendar.vue'
import { useLandingBooking } from '@/composables/useLandingBooking'
import { nightsBetween } from '@/utils/rate-calendar'

const props = defineProps<{
  hotelSlug: string
  ctaText: string
}>()

const router = useRouter()
/** `null` fuera de la landing → se navega al widget como siempre. */
const openBooking = useLandingBooking()

const checkIn = ref('')
const checkOut = ref('')
const error = ref('')

/** Restricciones que solo conoce el calendario (estadía mínima del día de entrada). Se guardan
 *  acá para frenar el submit con el mismo mensaje que ya se ve dentro del panel. */
const calendarError = ref('')

function onCalendarValidity(payload: { ok: boolean; message: string }): void {
  calendarError.value = payload.ok ? '' : payload.message
  if (payload.ok && error.value === calendarError.value) error.value = ''
}

function onSubmit(): void {
  error.value = ''
  if (!checkIn.value || !checkOut.value) {
    error.value = 'Elegí las fechas de llegada y salida.'
    return
  }
  if (nightsBetween(checkIn.value, checkOut.value) < 1) {
    error.value = 'La salida debe ser posterior a la llegada.'
    return
  }
  if (calendarError.value) {
    error.value = calendarError.value
    return
  }

  // Camino 1 — la landing: el modal abre con TODO el contexto y arranca en habitaciones
  // (`skipToRooms`). Sin `adults`/`children`/`rooms`: ya no se piden acá (2026-08-20) — el
  // store abre con su propio default (`guests=1`) y la ocupación real se elige recién al ver
  // los tipos de habitación (matriz de ocupaciones).
  if (openBooking) {
    openBooking({
      checkIn: checkIn.value,
      checkOut: checkOut.value,
      skipToRooms: true,
    })
    return
  }

  // Camino 2 — fuera de la landing: contrato de URL intacto, solo fechas. Sin `guests`/`rooms`/
  // `children`: el widget usa su propio default (`guests=1`, `useBooking.ts`) igual que acá.
  const qs = new URLSearchParams({
    checkIn: checkIn.value,
    checkOut: checkOut.value,
  })

  router.push(`/book/${encodeURIComponent(props.hotelSlug)}?${qs.toString()}`)
}
</script>
