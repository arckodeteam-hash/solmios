<template>
  <!--
    Ubicación de la Página pública — migrado desde settings/index.vue (tab «location»,
    docs/wizard-refactor tareas 1.3-1.5). Mismo mapa/campos que tenía Configuración → Ubicación,
    ahora con guardado propio y aislado: NO comparte validación con Hotel/Condiciones (fix del
    bug 3.1 — antes un campo inválido en OTRA pestaña dejaba el botón "Guardar" deshabilitado acá
    también, sin decir por qué). Ver docs/wizard-refactor/01-auditoria-estado-actual.md sección 3.1/3.3.

    País sigue viviendo en Configuración (doc 03: es identidad administrativa/fiscal, no solo
    contenido público) — acá se muestra de solo lectura con link para cambiarlo, así no hay dos
    lugares editando el mismo campo.
  -->
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Ubicación</h2>
        <p class="text-sm text-text-muted mt-0.5">
          Dirección y mapa que ve el huésped en la landing pública <code class="px-1 bg-surface rounded">/h/:slug</code>
          y en el motor de reservas.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="hasErrors" class="text-[11px] font-bold text-danger">
          {{ Object.keys(fieldErrors).length }} campo(s) con errores
        </span>
        <span v-else-if="isDirty" class="text-[11px] font-bold text-warning">Cambios sin guardar</span>
        <button @click="save" :disabled="saving || hasErrors"
          :title="hasErrors ? 'Corregí los campos marcados en rojo para poder guardar' : ''"
          class="bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-full hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-6">
      <div v-for="i in 3" :key="i" class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
        <div class="h-14 bg-navy animate-pulse"></div>
        <div class="p-5 space-y-3">
          <div class="h-10 bg-surface rounded-xl animate-pulse"></div>
          <div class="h-40 bg-surface rounded-xl animate-pulse"></div>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-6">
          <SectionCard title="País y dirección"
            subtitle="La dirección, junto a provincia, municipio y código postal, forma la dirección completa del hotel en facturas, emails, OTAs y la página pública. No mueve el pin: para eso usá el mapa o las coordenadas de abajo.">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">País</label>
                <div class="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-navy">
                  <span class="flex-1 truncate">{{ form.country || 'Sin definir' }}</span>
                  <router-link to="/panel/config?tab=hotel" class="shrink-0 text-[11px] font-bold text-teal hover:underline">
                    Cambiar
                  </router-link>
                </div>
                <p class="mt-1 text-[10px] text-text-muted">El país se edita en Configuración → Hotel — acá solo se muestra.</p>
              </div>
              <div class="relative">
                <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Dirección</label>
                <input ref="addressInputEl" v-model="form.address" type="text" autocomplete="off"
                  placeholder="Buscá la dirección…"
                  class="w-full rounded-xl border px-4 py-2.5 text-sm focus:border-navy focus:outline-none"
                  :class="fieldClass('address')" data-field="address"
                  @blur="touchField('address')">
                <p v-if="errorOf('address')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('address') }}</p>
                <p v-else class="mt-1 text-[10px] text-text-muted">
                  Escribí para buscar — elegí una sugerencia y el mapa y los campos de abajo se completan solos.
                </p>
                <!-- Sugerencias — solo aparece con el fallback Nominatim (sin key de Google, que trae su
                     propio dropdown nativo pegado al input). -->
                <ul v-if="addressSuggestions.length" class="absolute z-10 mt-1 w-full rounded-xl border border-border bg-white shadow-lg overflow-hidden">
                  <li v-for="s in addressSuggestions" :key="`${s.lat},${s.lng}`">
                    <button type="button" @click="selectAddressSuggestion(s)"
                      class="w-full px-4 py-2.5 text-left text-sm text-navy hover:bg-surface cursor-pointer truncate">
                      {{ s.label }}
                    </button>
                  </li>
                </ul>
                <p v-else-if="addressSearching" class="absolute z-10 mt-1 w-full rounded-xl border border-border bg-white shadow-lg px-4 py-2.5 text-xs text-text-muted">
                  Buscando…
                </p>
                <p v-else-if="addressSearchError" class="absolute z-10 mt-1 w-full rounded-xl border border-warning/40 bg-white shadow-lg px-4 py-2.5 text-xs text-warning">
                  No se pudo buscar — revisá tu conexión, o completá moviendo el pin en el mapa.
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Mapa Interactivo">
            <!-- Con API key de Google: mapa interactivo (clic y arrastre). Sin key: iframe embed. -->
            <div v-show="mapsInteractive" ref="mapEl" class="w-full h-96 rounded-xl border border-border overflow-hidden"></div>
            <iframe v-if="!mapsInteractive" :src="googleMapsEmbedUrl" class="w-full h-96 rounded-xl border border-border"
              style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
              title="Ubicación del hotel en Google Maps"></iframe>
            <div class="mt-2 flex items-center justify-between gap-3">
              <p class="text-[11px] text-text-muted">
                <template v-if="mapsInteractive">Hacé clic en el mapa o arrastrá el pin para ajustar la ubicación.</template>
                <template v-else>Para mover el pin: pegá abajo el enlace de Google Maps del lugar, o escribí las coordenadas.</template>
              </p>
              <a :href="googleMapsLinkUrl" target="_blank" rel="noopener"
                class="shrink-0 text-[11px] font-bold text-teal hover:underline">Abrir en Google Maps</a>
            </div>
          </SectionCard>
        </div>

        <div class="space-y-4">
          <SectionCard title="Coordenadas" subtitle="Solo lectura — se completan al elegir una dirección, mover el pin, pegar un link o usar tu ubicación actual.">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Latitud</label>
                <input :value="form.latitude" type="number" step="0.000001" disabled
                  class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy bg-surface disabled:cursor-not-allowed disabled:opacity-70" :class="fieldClass('latitude')" data-field="latitude">
                <p v-if="errorOf('latitude')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('latitude') }}</p>
              </div>
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Longitud</label>
                <input :value="form.longitude" type="number" step="0.000001" disabled
                  class="w-full px-3 py-2 rounded-full border text-sm font-bold text-navy bg-surface disabled:cursor-not-allowed disabled:opacity-70" :class="fieldClass('longitude')" data-field="longitude">
                <p v-if="errorOf('longitude')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('longitude') }}</p>
              </div>
            </div>
            <div class="mt-3">
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Pegar enlace de Google Maps</label>
              <input v-model="mapsPaste" @input="applyMapsPaste" type="text"
                placeholder="https://maps.google.com/… o 18.4861, -69.9312"
                class="w-full px-3 py-2 rounded-full border border-border text-sm">
              <p class="text-[10px] text-text-muted mt-1">
                En Google Maps, clic derecho sobre el punto → copiar coordenadas, y pegalas acá.
              </p>
            </div>
            <button @click="useMyLocation" class="mt-3 w-full text-xs font-bold text-teal hover:underline cursor-pointer">
              Usar mi ubicación actual
            </button>
          </SectionCard>

          <SectionCard title="Provincia, Municipio y Código Postal"
            subtitle="Solo lectura — se completan solos junto con la dirección o al mover el pin.">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Provincia</label>
                <input :value="form.province" disabled class="w-full px-3 py-2 rounded-full border text-sm bg-surface disabled:cursor-not-allowed disabled:opacity-70" :class="fieldClass('province')" data-field="province">
                <p v-if="errorOf('province')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('province') }}</p>
              </div>
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Municipio</label>
                <input :value="form.municipality" disabled class="w-full px-3 py-2 rounded-full border text-sm bg-surface disabled:cursor-not-allowed disabled:opacity-70" :class="fieldClass('municipality')" data-field="municipality">
                <p v-if="errorOf('municipality')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('municipality') }}</p>
              </div>
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Localidad</label>
                <input :value="form.locality" disabled class="w-full px-3 py-2 rounded-full border text-sm bg-surface disabled:cursor-not-allowed disabled:opacity-70" :class="fieldClass('locality')" data-field="locality">
                <p v-if="errorOf('locality')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('locality') }}</p>
              </div>
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Código Postal</label>
                <input :value="form.postalCode" disabled class="w-full px-3 py-2 rounded-full border text-sm bg-surface disabled:cursor-not-allowed disabled:opacity-70" :class="fieldClass('postalCode')" data-field="postalCode">
                <p v-if="errorOf('postalCode')" class="mt-1 text-[10px] font-bold text-danger">{{ errorOf('postalCode') }}</p>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import SectionCard from '@/components/ui/SectionCard.vue'
import { SettingsService, type HotelFull } from '@/services/Settings.service'
import { countryName } from '@/data/locales'
import { useToast } from '@/composables/useToast'
import { validateField, warnOnUnsavedChanges, HOTEL_RULES } from '@/composables/useFieldValidation'
import { useHotelLocationMap } from '@/composables/useHotelLocationMap'

const toast = useToast()
const loading = ref(true)
const saving = ref(false)

type LocationForm = Pick<Partial<HotelFull>, 'country' | 'address' | 'latitude' | 'longitude' | 'province' | 'municipality' | 'locality' | 'postalCode'>

const form = ref<LocationForm>({
  country: '', address: '', latitude: undefined, longitude: undefined,
  province: '', municipality: '', locality: '', postalCode: '',
})

// ─── Mapa — composable compartido con Configuración (tarea 1.1) ────────────
const {
  mapEl, mapsInteractive, googleMapsEmbedUrl, googleMapsLinkUrl,
  mapsPaste, applyMapsPaste, useMyLocation, syncMarkerFromForm, initInteractiveMap,
  addressInputEl, addressSuggestions, addressSearching, addressSearchError, initAddressAutocomplete, selectAddressSuggestion,
  markLocationLoaded,
} = useHotelLocationMap(form)

// ─── Validación — misma fuente que Configuración (HOTEL_RULES), pero AISLADA: esta pantalla
// tiene su propio `touchedFields`/`fieldErrors`, no comparte estado con ninguna otra (fix del
// bug 3.1 desde el diseño, no como parche — ver auditoría 01 sección 3.1/3.3). ────────────────
const LOCATION_FIELDS = ['address', 'latitude', 'longitude', 'province', 'municipality', 'locality', 'postalCode'] as const
const fieldErrors = ref<Record<string, string>>({})
const touchedFields = ref<Set<string>>(new Set())

function touchField(field: string) {
  touchedFields.value.add(field)
  const rule = HOTEL_RULES[field]
  if (!rule) return
  const msg = validateField((form.value as Record<string, unknown>)[field], rule)
  if (msg) fieldErrors.value = { ...fieldErrors.value, [field]: msg }
  else { const { [field]: _drop, ...rest } = fieldErrors.value; fieldErrors.value = rest }
}
function errorOf(field: string): string {
  return touchedFields.value.has(field) ? (fieldErrors.value[field] ?? '') : ''
}
function fieldClass(field: string): string {
  return errorOf(field) ? 'border-danger' : 'border-border'
}
const hasErrors = computed(() => Object.keys(fieldErrors.value).length > 0)

let hotelId = ''

onMounted(async () => {
  try {
    const s = await SettingsService.get()
    const h = s.hotel as HotelFull & Record<string, unknown>
    hotelId = (h.id as string) || ''
    form.value = {
      // countryName() acepta el nombre o el ISO viejo ('DO'): la columna quedó con los dos
      // formatos conviviendo (ver comentario de countryName() en data/locales.ts) — sin esto
      // un hotel con 'DO' guardado mostraría el código crudo en vez de "República Dominicana".
      country: countryName(h.country) || h.country || '',
      address: h.address ?? '',
      // Falsy (incluye 0, el default físico de la columna) = "sin coordenadas reales" — mismo
      // criterio que settings/index.vue (línea ~1559) y que el paso `ubicacion` del backend
      // (docs/wizard-refactor tarea 2.5): 0,0 no es un pin válido, es "nunca se tocó".
      latitude: h.latitude ? Number(h.latitude) : undefined,
      longitude: h.longitude ? Number(h.longitude) : undefined,
      province: h.province ?? '',
      municipality: h.municipality ?? '',
      locality: h.locality ?? '',
      postalCode: h.postalCode ?? '',
    }
  } catch {
    toast.error('Error al cargar los datos de ubicación')
  } finally {
    // BUG (2026-09-08): `initInteractiveMap()`/`initAddressAutocomplete()` necesitan que
    // `mapEl`/`addressInputEl` ya estén montados — y esos `<div ref>`/`<input ref>` viven en el
    // `v-else` del `v-if="loading"` de arriba, así que hay que esperar a que `loading` pase a
    // `false` y el DOM se actualice ANTES de llamarlos. Antes se llamaban mientras `loading`
    // todavía era `true` (dentro del `try`, antes de este bloque) — los refs daban `null`, los
    // dos `init*` retornaban de una por su guard `if (!el.value) return`, y la pantalla quedaba
    // pegada al iframe no interactivo + sin autocompletado SIEMPRE, con o sin key de Google
    // configurada. Mismo bug que reportó el usuario ("tiene los errores que tiene la otra tab").
    loading.value = false
    await nextTick()
    await initInteractiveMap()
    await initAddressAutocomplete()
    markClean()
    // Recién ahora el watch de país (composable) puede limpiar campos ante un cambio real —
    // antes de esto, asignar `form.value` desde la API también "cambia" el país y no debe limpiar.
    markLocationLoaded()
  }
})

// ─── Cambios sin guardar ─────────────────────────────────────────────────────
const savedSnapshot = ref('')
function snapshot(): string { return JSON.stringify(form.value) }
function markClean() { savedSnapshot.value = snapshot() }
const isDirty = computed(() => savedSnapshot.value !== '' && snapshot() !== savedSnapshot.value)

onBeforeRouteLeave(() => {
  if (!isDirty.value) return true
  return window.confirm('Tenés cambios sin guardar en la ubicación. ¿Salir y descartarlos?')
})
let stopUnloadWarning: (() => void) | null = null
onMounted(() => { stopUnloadWarning = warnOnUnsavedChanges(() => isDirty.value) })
onUnmounted(() => { stopUnloadWarning?.() })

// ─── Guardado — aislado: solo valida y persiste los campos de ESTA pantalla (bug 3.1). ────────
async function save() {
  if (saving.value) return

  for (const f of LOCATION_FIELDS) touchField(f)
  if (hasErrors.value) {
    const first = LOCATION_FIELDS.find((f) => fieldErrors.value[f])
    if (first) {
      await nextTick()
      document.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus()
    }
    toast.error(hasErrors.value && Object.keys(fieldErrors.value).length === 1
      ? Object.values(fieldErrors.value)[0]!
      : `Hay ${Object.keys(fieldErrors.value).length} campos con errores. Revisá los marcados en rojo.`)
    return
  }

  saving.value = true
  try {
    await SettingsService.patchHotel({
      address: form.value.address,
      latitude: form.value.latitude,
      longitude: form.value.longitude,
      province: form.value.province,
      municipality: form.value.municipality,
      locality: form.value.locality,
      postalCode: form.value.postalCode,
    })
    markClean()
    toast.success('Ubicación guardada')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo guardar la ubicación')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
</style>
