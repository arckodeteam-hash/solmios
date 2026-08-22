<template>
  <CommandCenterHeader
    :hotel-name="hotelName"
    :logo-url="hotelLogo"
    :star-rating="hotelStars"
    :api-online="apiOnline"
    :last-sync="lastSync"
    :weather="weather"
    :alerts="alerts"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import CommandCenterHeader from '@/components/features/dashboard/CommandCenterHeader.vue'
import { HotelService, type HotelData } from '@/services/Hotel.service'
import { ChannelService } from '@/services/Channel.service'
import { WeatherService, type WeatherInfo } from '@/services/Weather.service'
import { useAuthStore } from '@/stores/auth.store'
import { useDashboardStore } from '@/stores/dashboard.store'
import { useModulesStore } from '@/stores/modules.store'

// Header global del panel: la misma barra "command center" del dashboard, en todas las páginas.
const auth = useAuthStore()
const dashboard = useDashboardStore()
const modules = useModulesStore()

const hotelData = ref<HotelData | null>(null)
const apiOnline = ref(true)
const lastSync = ref<string | null>(null)
const weather = ref<WeatherInfo | null>(null)
/** Logo del hotel: sale del mismo GET /settings que el nombre y las estrellas, así el header
 *  se ve igual para todos los roles del panel (leerlo de `hotel-media` exigiría `media:view`,
 *  que solo tiene hotel_admin). */
const hotelLogo = computed(() => hotelData.value?.logo || null)

const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))
const hotelName = computed(() => hotelData.value?.name || auth.currentHotel || 'Mi Hotel')
const hotelStars = computed(() => hotelData.value?.starRating ?? null)
// Incidencias abiertas: reactivo al dashboard store si ya fue cargado; si no, 0 → "ONLINE".
const alerts = computed(() => dashboard.stats?.openIncidents ?? 0)

// Clima: misma lógica que el dashboard, ahora vía el service compartido.
// Antes este archivo tenía una copia LITERAL del bloque de open-meteo del dashboard (URL del
// proveedor + tabla WMO + fetch, comentada como "Copiado del dashboard"): dos copias del mismo
// endpoint de un tercero clavado en el bundle, que había que corregir en dos lugares.
// El logo NO necesita request propio: ya viene en el `hotelData` que se pide abajo.
onMounted(async () => {
  try { hotelData.value = ((await HotelService.settings(hotelId.value)) as any)?.hotel ?? null } catch { /* sin datos */ }
  // A9: el estado de canales SOLO existe si el plan del hotel incluye el módulo `channel`.
  // Antes se fetcheaba igual en cada vista: para planes sin canal era un 403 en consola que
  // además marcaba el indicador como "Sin conexión" (apiOnline=false) sin estar desconectado.
  // ensure() es idempotente y comparte el fetch en curso con el menú/guard de rutas.
  await modules.ensure(hotelId.value)
  if (modules.enabled('channel')) {
    try { lastSync.value = (await ChannelService.status(hotelId.value)).lastSync ?? null; apiOnline.value = true } catch { apiOnline.value = false }
  }
  weather.value = await WeatherService.current(hotelData.value?.latitude, hotelData.value?.longitude)
})
</script>
