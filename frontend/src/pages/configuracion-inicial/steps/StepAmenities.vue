<template>
  <div class="rounded-xl bg-surface/70 border border-border p-4 space-y-4">
    <div v-if="loading" class="h-32 animate-pulse bg-surface rounded-lg"></div>
    <template v-else>
      <div>
        <p class="text-[11px] font-black uppercase tracking-wide text-navy mb-2">Amenities del hotel</p>
        <div v-for="(items, category) in catalog" :key="category" class="mb-3">
          <p class="text-[10px] font-bold text-text-muted uppercase mb-1.5">{{ CATEGORY_LABELS[category] || category }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="key in items" :key="key" type="button" @click="toggle(key)"
              class="px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition-colors cursor-pointer"
              :class="selected.includes(key) ? 'bg-navy text-white border-navy' : 'bg-white text-text-secondary border-border hover:border-navy/40'">
              {{ AMENITY_LABELS[key] || key }}
            </button>
          </div>
        </div>
        <p class="text-[11px] text-text-muted">Catálogo completo con personalizadas en Configuración → Amenities.</p>
      </div>

      <div class="border-t border-border pt-3 space-y-2.5">
        <label class="relative inline-flex items-center gap-2 cursor-pointer">
          <input v-model="childPolicy.acceptChildren" type="checkbox" class="sr-only peer">
          <span class="w-9 h-5 bg-border rounded-full peer-checked:bg-teal transition-colors relative">
            <span class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></span>
          </span>
          <span class="text-xs font-bold text-navy">Acepta niños</span>
        </label>
        <div v-if="childPolicy.acceptChildren" class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-[10px] font-bold text-text-muted uppercase">Edad máxima de niño</label>
            <input v-model.number="childPolicy.maxChildAge" type="number" min="0" max="17"
              class="w-full rounded-full border border-border px-3 py-1.5 text-sm font-bold text-navy text-right">
          </div>
          <div>
            <label class="mb-1 block text-[10px] font-bold text-text-muted uppercase">No consume plaza hasta</label>
            <input v-model.number="childPolicy.maxFreeAge" type="number" min="0" max="17"
              class="w-full rounded-full border px-3 py-1.5 text-sm font-bold text-navy text-right"
              :class="childPolicyError ? 'border-danger' : 'border-border'">
          </div>
        </div>
        <p v-if="childPolicyError" class="text-[10px] font-bold text-danger">{{ childPolicyError }}</p>
      </div>

      <p v-if="error" class="text-[11px] font-bold text-danger">{{ error }}</p>
      <div class="flex justify-end">
        <button @click="onSave" :disabled="saving"
          class="bg-navy text-white font-bold text-xs px-4 py-2 rounded-full hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { HotelService, type AmenityCatalog } from '@/services/Hotel.service'
import { ConfigService } from '@/services/Platform.service'
import { useToast } from '@/composables/useToast'
import { useOnboardingStep } from '@/composables/useOnboardingStep'
import type { OnboardingStep, OnboardingStatus } from '@/services/Onboarding.service'

defineProps<{ step: OnboardingStep }>()
const emit = defineEmits<{ saved: [status: OnboardingStatus] }>()

// `catalog` (abajo) trae el catálogo COMPLETO (37 keys, `HotelService.amenitiesCatalog()` —
// mismo que Configuración → Amenities), no una lista reducida — este mapa tiene que cubrirlo
// entero. Copiado 1:1 de `settings/index.vue` (única fuente de verdad de estos labels): un mapa
// parcial acá mostraba la key cruda (ej. "kids_playground") para cualquier amenity fuera del
// subconjunto que tenía antes. Personalizadas siguen viviendo solo en Configuración → Amenities.
const CATEGORY_LABELS: Record<string, string> = { interior: 'Interior', exterior: 'Exterior', services: 'Servicios' }
const AMENITY_LABELS: Record<string, string> = {
  ac: 'Aire Acondicionado', heating: 'Calefacción', kitchen: 'Cocina', microwave: 'Microondas',
  fridge: 'Nevera', coffee_maker: 'Cafetera', washer: 'Lavadora', dishwasher: 'Lavavajillas',
  tv: 'TV', wifi: 'WiFi', safe: 'Caja Fuerte', minibar: 'Minibar', hair_dryer: 'Secador',
  iron: 'Plancha', balcony: 'Balcón', bathtub: 'Bañera', work_desk: 'Escritorio',
  pool: 'Piscina', pool_heated: 'Piscina Climatizada', parking_free: 'Parking Gratis',
  parking_paid: 'Parking Pago', gym: 'Gimnasio', spa: 'SPA', restaurant: 'Restaurante',
  bar: 'Bar', garden: 'Jardín', terrace: 'Terraza', bbq: 'Barbacoa', elevator: 'Ascensor',
  lounge: 'Salón', kids_playground: 'Zona Infantil',
  room_service: 'Room Service', laundry: 'Lavandería', concierge: 'Conserjería',
  luggage_storage: 'Guardaequipaje', pets_allowed: 'Mascotas', wheelchair_access: 'Acceso Silla Ruedas',
}

const toast = useToast()
const loading = ref(true)
const catalog = ref<AmenityCatalog>({ interior: [], exterior: [], services: [] })
const selected = ref<string[]>([])
const childPolicy = ref({ acceptChildren: true, maxChildAge: 17, maxFreeAge: 0 })

// Mismo criterio que settings/index.vue: "no consume plaza hasta" no puede superar la "edad
// máxima de niño" (si no, un rango imposible deja niños sin clasificación).
const childPolicyError = computed(() => (
  childPolicy.value.maxFreeAge > childPolicy.value.maxChildAge
    ? 'La edad sin cargo no puede ser mayor que la edad máxima de niño' : ''
))

function toggle(key: string) {
  selected.value = selected.value.includes(key) ? selected.value.filter((k) => k !== key) : [...selected.value, key]
}

onMounted(async () => {
  try {
    const [cat, sel, cp] = await Promise.all([
      HotelService.amenitiesCatalog(),
      HotelService.amenitiesHotel().catch(() => ({ data: [] })),
      ConfigService.get('child_policy').catch(() => null) as Promise<{ acceptChildren?: boolean; maxChildAge?: number; maxFreeAge?: number } | null>,
    ])
    catalog.value = cat
    selected.value = sel.data.map((a) => a.amenityKey)
    if (cp) childPolicy.value = { acceptChildren: cp.acceptChildren !== false, maxChildAge: cp.maxChildAge ?? 17, maxFreeAge: cp.maxFreeAge ?? 0 }
  } finally {
    loading.value = false
  }
})

const { saving, error, save } = useOnboardingStep(async () => {
  await Promise.all([
    HotelService.saveAmenitiesHotel(selected.value),
    ConfigService.set('child_policy', { ...childPolicy.value }),
  ])
}, (status) => emit('saved', status))

async function onSave() {
  if (childPolicyError.value) { toast.error(childPolicyError.value); return }
  await save()
  if (!error.value) toast.success('Amenities guardadas')
}
</script>
