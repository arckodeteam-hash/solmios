<template>
  <div v-if="visibleAnnouncements.length > 0" class="space-y-2 px-6 pt-4">
    <div
      v-for="a in visibleAnnouncements"
      :key="a.id"
      class="relative rounded-xl border p-3 pr-10 flex items-start gap-3"
      :class="[announcementMeta(a.type).bgClass, announcementMeta(a.type).borderClass]"
    >
      <span class="w-5 h-5 shrink-0" :class="announcementMeta(a.type).textClass" v-html="announcementMeta(a.type).icon"></span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-black" :class="announcementMeta(a.type).textClass">{{ a.title }}</span>
          <span v-if="a.priority === 'urgent' || a.priority === 'high'" class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/60 uppercase" :class="announcementMeta(a.type).textClass">
            {{ a.priority }}
          </span>
        </div>
        <p v-if="a.message" class="text-xs mt-0.5" :class="announcementMeta(a.type).textClass">{{ a.message }}</p>
      </div>
      <button
        @click="dismiss(a.id)"
        class="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/60 cursor-pointer transition-colors"
        :class="announcementMeta(a.type).textClass"
        aria-label="Cerrar anuncio"
      >✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { AnnouncementsService, announcementMeta } from '@/services/Announcements.service'
import type { Announcement } from '@/services/Announcements.service'

/**
 * Qué anuncios ve este usuario lo decide el BACKEND: los de su hotel más los de la plataforma,
 * ya filtrados por audiencia y por vigencia. Acá no se filtra por hotel — hacerlo escondía los
 * anuncios de plataforma, que es de dónde venía el bug original.
 */
const all = ref<Announcement[]>([])
// Descartes de ESTA sesión: sólo ocultan el aviso localmente (optimista). El registro
// persistente es por usuario y vive en el backend (announcement_reads), así que el ✕
// de un recepcionista ya no le esconde el aviso al resto del hotel.
const dismissedIds = ref<Set<string>>(new Set())

const visibleAnnouncements = computed(() =>
  all.value
    .filter((a) => a.active && !dismissedIds.value.has(a.id))
    // Prioridad: urgent > high > medium > low
    .sort((a, b) => {
      const order = { urgent: 0, high: 1, medium: 2, low: 3 } as Record<string, number>
      return (order[a.priority] ?? 4) - (order[b.priority] ?? 4)
    })
    .slice(0, 3) // Mostrar máximo 3 a la vez
)

// Los que el usuario ya descartó no llegan siquiera: el listado los excluye por token.

async function load() {
  try {
    const r = await AnnouncementsService.list({ activeOnly: true })
    all.value = r.data || []
  } catch { all.value = [] }
}

// Registrar la lectura de cada aviso que se muestra, UNA vez por aviso. El registro
// es telemetría: si seen falla (500, red caída), el aviso se muestra igual y en
// silencio — no hay toast ni estado de error que rompa el banner.
const seenIds = new Set<string>()
watch(visibleAnnouncements, (visible) => {
  for (const a of visible) {
    if (seenIds.has(a.id)) continue
    seenIds.add(a.id)
    AnnouncementsService.seen(a.id).catch(() => { /* silent: registrar no puede romper el banner */ })
  }
})

async function dismiss(id: string) {
  // Optimista: ocultar YA, el backend sólo registra para la próxima carga.
  dismissedIds.value = new Set([...dismissedIds.value, id])
  try {
    await AnnouncementsService.dismiss(id)
  } catch { /* silent: el aviso igual desaparece de esta vista */ }
}

onMounted(load)
</script>

<style scoped></style>
