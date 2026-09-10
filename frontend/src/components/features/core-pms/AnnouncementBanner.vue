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
import { ref, computed, onMounted } from 'vue'
import { AnnouncementsService, announcementMeta } from '@/services/Announcements.service'
import type { Announcement } from '@/services/Announcements.service'

/**
 * Qué anuncios ve este usuario lo decide el BACKEND: los de su hotel más los de la plataforma,
 * ya filtrados por audiencia y por vigencia. Acá no se filtra por hotel — hacerlo escondía los
 * anuncios de plataforma, que es de dónde venía el bug original.
 */
const all = ref<Announcement[]>([])

/** Cerrados en esta sesión, para que el aviso desaparezca sin esperar al servidor. */
const justDismissed = ref<Set<string>>(new Set())

const visibleAnnouncements = computed(() =>
  all.value
    .filter((a) => a.active && !a.dismissed && !justDismissed.value.has(a.id))
    // Prioridad: urgent > high > medium > low
    .sort((a, b) => {
      const order = { urgent: 0, high: 1, medium: 2, low: 3 } as Record<string, number>
      return (order[a.priority] ?? 4) - (order[b.priority] ?? 4)
    })
    .slice(0, 3) // Mostrar máximo 3 a la vez
)

async function load() {
  try {
    const r = await AnnouncementsService.list({ activeOnly: true })
    all.value = r.data || []
  } catch {
    all.value = []
    return
  }

  // El acuse de lectura es una métrica, no una condición para mostrar el aviso: si falla, el
  // banner ya está en pantalla y no pasa nada. Por eso va después del render y se traga el error.
  for (const a of visibleAnnouncements.value) {
    if (a.seen) continue
    AnnouncementsService.markSeen(a.id).catch(() => { /* métrica perdida, aviso entregado */ })
  }
}

/**
 * Cerrar es POR USUARIO.
 *
 * Antes se guardaba como una clave de `configuration` por HOTEL: el primer empleado que cerraba
 * el aviso se lo ocultaba a todos sus compañeros, dueño incluido.
 */
async function dismiss(id: string) {
  justDismissed.value = new Set([...justDismissed.value, id])
  try {
    await AnnouncementsService.dismiss(id)
  } catch {
    // Se vuelve a mostrar en la próxima carga: es preferible a tragarse el error y que el usuario
    // crea que lo silenció para siempre.
    justDismissed.value = new Set([...justDismissed.value].filter((x) => x !== id))
  }
}

onMounted(load)
</script>

<style scoped></style>
