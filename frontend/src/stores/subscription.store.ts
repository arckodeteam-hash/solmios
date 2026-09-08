// subscription.store.ts — Estado de la suscripción del hotel, compartido por todo el panel.
//
// Antes cada consumidor pedía `GET /subscriptions/mine` por su cuenta: la página
// `/panel/suscripcion` y el aviso de la prueba, cada uno con su fetch y su copia del estado.
// Con el plan visible también en la barra superior, el menú lateral y el menú de usuario, eso
// serían CUATRO requests idénticos en cada navegación — y cuatro estados que se desincronizan
// entre sí (el hotel mejora el plan y la barra sigue diciendo el viejo hasta el F5).
//
// Mismo contrato que `modules.store`: `ensure()` es idempotente y comparte el fetch en curso;
// `refresh()` fuerza y espera, que es lo que corresponde después de una acción del propio
// usuario (mejorar el plan). La diferencia con aquel: acá NO se falla abierto. Si no se sabe el
// estado, no se muestra nada — inventar un plan es peor que no mostrarlo.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SignupService, type MySubscription } from '@/services/Signup.service'

/** A partir de acá el estado se considera viejo y se revalida en segundo plano. La suscripción
 *  cambia poquísimas veces al día: no hace falta ir más seguido. */
const STALE_MS = 5 * 60_000

/** Estados en los que el hotel tiene algo pendiente que resolver en `/panel/suscripcion`. */
const ESTADOS_QUE_EXIGEN_ACCION = ['trialing', 'past_due', 'expired', 'canceled', 'suspended']

export const useSubscriptionStore = defineStore('subscription', () => {
  const sub = ref<MySubscription | null>(null)
  const loadedHotel = ref<string | null | undefined>(undefined)
  const loadedAt = ref(0)
  const loading = ref<Promise<void> | null>(null)
  const loadingHotel = ref<string | null>(null)

  function startFetch(hid: string | null): Promise<void> {
    const p: Promise<void> = SignupService.mySubscription()
      .then((data) => {
        sub.value = data
        loadedHotel.value = hid
        loadedAt.value = Date.now()
      })
      .catch(() => {
        // Un hotel viejo sin suscripción responde error y no tiene nada que mostrar: se marca
        // como cargado igual para no reintentar en bucle en cada navegación.
        sub.value = null
        loadedHotel.value = hid
        loadedAt.value = Date.now()
      })
      .finally(() => {
        if (loading.value === p) { loading.value = null; loadingHotel.value = null }
      })
    loadingHotel.value = hid
    loading.value = p
    return p
  }

  /** Carga el estado una vez por hotel. Si cambió el hotel (login/impersonación), recarga. */
  async function ensure(hotelId?: string | null): Promise<void> {
    const hid = hotelId ?? null
    if (loadedHotel.value !== undefined && loadedHotel.value === hid) {
      if (!loading.value && Date.now() - loadedAt.value >= STALE_MS) void startFetch(hid)
      return
    }
    if (loading.value && loadingHotel.value === hid) return loading.value
    return startFetch(hid)
  }

  /** Fuerza el refetch y ESPERA. Para después de mejorar el plan: la barra y el menú tienen
   *  que decir el plan nuevo sin que nadie recargue la página. */
  async function refresh(hotelId?: string | null): Promise<void> {
    const hid = hotelId === undefined ? (loadedHotel.value ?? null) : (hotelId ?? null)
    if (loading.value && loadingHotel.value === hid) return loading.value
    return startFetch(hid)
  }

  function reset(): void {
    sub.value = null
    loadedHotel.value = undefined
    loadedAt.value = 0
    loading.value = null
    loadingHotel.value = null
  }

  /** Hay estado conocido para mostrar. Mientras sea false NO se dibuja nada del plan. */
  const ready = computed(() => loadedHotel.value !== undefined)
  const status = computed(() => sub.value?.status ?? null)
  /** Nombre del plan tal como lo resolvió el backend. */
  const planName = computed(() => sub.value?.planName ?? null)
  /** El hotel tiene algo que resolver (prueba por vencer, pago pendiente, corte). */
  const needsAttention = computed(() =>
    !!status.value && ESTADOS_QUE_EXIGEN_ACCION.includes(status.value),
  )

  return { sub, ready, status, planName, needsAttention, ensure, refresh, reset }
})
