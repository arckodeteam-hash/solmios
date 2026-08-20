<template>
  <div class="min-h-screen bg-surface flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <img :src="logoStackedColor" alt="SolmiOS" class="h-20 w-auto mx-auto mb-2">
        <p class="text-sm text-text-muted">Hospitality OS · LATAM</p>
      </div>

      <!-- Form Card -->
      <div class="bg-white rounded-2xl border border-border card-shadow p-8">
        <!-- Error: Invalid Token -->
        <div v-if="invalidToken" class="text-center">
          <div class="w-16 h-16 rounded-full bg-red/10 mx-auto flex items-center justify-center mb-4">
            <svg class="w-8 h-8 text-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 class="text-lg font-extrabold text-navy mb-2">Token inválido o expirado</h2>
          <p class="text-sm text-text-muted mb-6">El enlace para restablecer tu contraseña no es válido o ya expiró. Solicita uno nuevo.</p>
          <router-link to="/login" class="inline-block h-11 px-6 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors leading-11">Volver al Login</router-link>
        </div>

        <!-- Success -->
        <div v-else-if="success" class="text-center">
          <div class="w-16 h-16 rounded-full bg-teal/10 mx-auto flex items-center justify-center mb-4">
            <svg class="w-8 h-8 text-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 class="text-lg font-extrabold text-navy mb-2">Contraseña restablecida</h2>
          <p class="text-sm text-text-muted mb-6">Tu contraseña se actualizó correctamente. Ya podés iniciar sesión.</p>
          <router-link to="/login" class="inline-block h-11 px-6 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors leading-11">Ir al Login</router-link>
        </div>

        <!-- Reset Form -->
        <template v-else>
          <h2 class="text-lg font-extrabold text-navy mb-6">Nueva Contraseña</h2>

          <form @submit.prevent="handleReset" class="space-y-4">
            <div>
              <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Nueva Contraseña</label>
              <input v-model="password" type="password" placeholder="••••••••" class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30" required />
            </div>

            <div>
              <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Confirmar Contraseña</label>
              <input v-model="confirmPassword" type="password" placeholder="••••••••" class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30" required />
            </div>

            <div v-if="error" class="bg-red/10 text-red text-xs font-bold p-3 rounded-xl">{{ error }}</div>

            <button type="submit" :disabled="loading" class="w-full h-11 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors disabled:opacity-50 cursor-pointer">
              {{ loading ? 'Guardando...' : 'Restablecer Contraseña' }}
            </button>
          </form>

          <div class="mt-6 text-center">
            <router-link to="/login" class="text-xs font-bold text-text-muted hover:text-cyan transition-colors">Volver al Login</router-link>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import logoStackedColor from '@/assets/logo/logo-stacked-color.png'
import { AuthService } from '@/services/Auth.service'
import { usePageMeta } from '@/composables/usePageMeta'
import { AUTH_PAGE_META } from './auth-meta'

usePageMeta(AUTH_PAGE_META.resetPassword)

const route = useRoute()
const router = useRouter()

const token = route.query.token as string

const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const success = ref(false)
const invalidToken = ref(false)

onMounted(() => {
  if (!token) {
    invalidToken.value = true
  }
})

async function handleReset() {
  error.value = ''

  if (password.value.length < 6) {
    error.value = 'La contraseña debe tener al menos 6 caracteres'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'Las contraseñas no coinciden'
    return
  }

  loading.value = true
  try {
    await AuthService.resetPassword(token, password.value)
    success.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Error al restablecer la contraseña'
  } finally {
    loading.value = false
  }
}
</script>
