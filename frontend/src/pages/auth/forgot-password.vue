<template>
  <div class="min-h-screen bg-surface flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <img :src="logoStackedColor" alt="SolmiOS" class="h-20 w-auto mx-auto mb-2">
        <p class="text-sm text-text-muted">Hospitality OS · LATAM</p>
      </div>

      <!-- Forgot Password Form -->
      <div class="bg-white rounded-2xl border border-border card-shadow p-8">
        <template v-if="!submitted">
          <h2 class="text-lg font-extrabold text-navy mb-2">Recuperar Contraseña</h2>
          <p class="text-xs text-text-muted mb-6">Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña.</p>

          <form @submit.prevent="handleSubmit" class="space-y-4">
            <div>
              <label for="auth-forgot-password-email" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Email</label>
              <input id="auth-forgot-password-email" name="email" aria-required="true"
                v-model="email"
                type="email"
                placeholder="admin@hotel.com"
                class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30"
                required
              />
            </div>

            <div v-if="error" class="bg-red/10 text-red text-xs font-bold p-3 rounded-xl">{{ error }}</div>

            <button
              type="submit"
              :disabled="loading"
              class="w-full h-11 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors disabled:opacity-50 cursor-pointer"
            >
              {{ loading ? 'Enviando...' : 'Enviar enlace de recuperación' }}
            </button>
          </form>
        </template>

        <!-- Success state -->
        <template v-else>
          <div class="text-center py-4">
            <div class="w-14 h-14 rounded-full bg-teal/10 mx-auto flex items-center justify-center mb-4">
              <svg class="w-7 h-7 text-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 class="text-lg font-extrabold text-navy mb-2">Email enviado</h2>
            <p class="text-sm text-text-muted">Si el email existe, recibirás un enlace de recuperación.</p>
          </div>
        </template>

        <!-- Back to login -->
        <div class="mt-6 pt-6 border-t border-border text-center">
          <router-link to="/login" class="text-xs font-bold text-cyan hover:text-navy transition-colors">
            Volver al inicio de sesión
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import logoStackedColor from '@/assets/logo/logo-stacked-color.png'
import { AuthService } from '@/services/Auth.service'
import { usePageMeta } from '@/composables/usePageMeta'
import { AUTH_PAGE_META } from './auth-meta'

usePageMeta(AUTH_PAGE_META.forgotPassword)

const email = ref('')
const error = ref('')
const loading = ref(false)
const submitted = ref(false)

async function handleSubmit() {
  loading.value = true
  error.value = ''
  try {
    await AuthService.forgotPassword(email.value)
    submitted.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Error al enviar el enlace de recuperación'
  } finally {
    loading.value = false
  }
}
</script>
