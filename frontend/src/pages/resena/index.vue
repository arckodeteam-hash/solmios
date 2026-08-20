<script setup lang="ts">
// pages/resena/index.vue — Página PÚBLICA para que el huésped deje su reseña (sin login).
// El token de la URL (/resena/:token) es la autorización; lo genera el invite post-checkout.
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import logoStackedColor from '@/assets/logo/logo-stacked-color.png'
import { ReviewsService } from '@/services/Reviews.service'

const route = useRoute()
const token = String(route.params.token || '')

type State = 'loading' | 'form' | 'done' | 'already' | 'notfound' | 'error'
const state = ref<State>('loading')
const hotelName = ref('')
const rating = ref(0)
const hover = ref(0)
const comment = ref('')
const submitting = ref(false)

const stars = [1, 2, 3, 4, 5]
const canSubmit = computed(() => rating.value >= 1 && rating.value <= 5 && !submitting.value)

onMounted(async () => {
  if (!token) { state.value = 'notfound'; return }
  try {
    const data = await ReviewsService.get(token)
    hotelName.value = data.hotelName
    state.value = data.alreadyDone ? 'already' : 'form'
  } catch (e) {
    state.value = (e as Error).message === '404' ? 'notfound' : 'error'
  }
})

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const res = await ReviewsService.submit(token, { rating: rating.value, comment: comment.value.trim() })
    if (res.ok) state.value = 'done'
    else if (res.status === 409) state.value = 'already'
    else state.value = 'error'
  } catch {
    state.value = 'error'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-surface flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <img :src="logoStackedColor" alt="SolmiOS" class="h-20 w-auto mx-auto">
      </div>

      <div class="bg-white rounded-2xl border border-border card-shadow p-8">
        <!-- Loading -->
        <p v-if="state === 'loading'" class="text-center text-sm text-text-muted py-8">Cargando…</p>

        <!-- Formulario -->
        <div v-else-if="state === 'form'">
          <h2 class="text-lg font-extrabold text-navy mb-1 text-center">¿Cómo fue tu estadía{{ hotelName ? ` en ${hotelName}` : '' }}?</h2>
          <p class="text-sm text-text-muted mb-6 text-center">Tu opinión nos ayuda a mejorar. Solo te toma un minuto.</p>

          <div class="flex justify-center gap-2 mb-6" @mouseleave="hover = 0">
            <button v-for="s in stars" :key="s" type="button" class="text-4xl leading-none transition-transform hover:scale-110"
              :class="(hover || rating) >= s ? 'text-amber-400' : 'text-gray-300'"
              @mouseenter="hover = s" @click="rating = s" :aria-label="`${s} estrellas`">★</button>
          </div>

          <textarea v-model="comment" rows="4" maxlength="2000"
            placeholder="Contanos qué te gustó o qué podríamos mejorar (opcional)"
            class="w-full border border-border rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan mb-5"></textarea>

          <button type="button" :disabled="!canSubmit" @click="submit"
            class="w-full h-11 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {{ submitting ? 'Enviando…' : 'Enviar reseña' }}
          </button>
        </div>

        <!-- Estados finales -->
        <div v-else class="text-center py-4">
          <div class="text-5xl mb-4">{{ state === 'done' ? '🙏' : state === 'already' ? '✅' : state === 'notfound' ? '🔍' : '⚠️' }}</div>
          <h2 class="text-lg font-extrabold text-navy mb-2">
            {{ state === 'done' ? '¡Gracias por tu reseña!' : state === 'already' ? 'Ya respondiste esta reseña' : state === 'notfound' ? 'Enlace no válido' : 'Algo salió mal' }}
          </h2>
          <p class="text-sm text-text-muted">
            {{ state === 'done' ? 'Valoramos mucho tu opinión.' : state === 'already' ? 'Gracias, tu opinión ya fue registrada.' : state === 'notfound' ? 'El enlace expiró o no existe.' : 'Probá de nuevo en un momento.' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
