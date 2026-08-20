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
        <h2 class="text-lg font-extrabold text-navy mb-6">Cambiar Contraseña</h2>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <!-- Current Password -->
          <div>
            <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Contraseña Actual</label>
            <input
              v-model="currentPassword"
              type="password"
              placeholder="Contraseña actual"
              class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30"
              required
            />
          </div>

          <!-- New Password -->
          <div>
            <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Nueva Contraseña</label>
            <input
              v-model="newPassword"
              type="password"
              placeholder="Nueva contraseña"
              class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30"
              required
            />
          </div>

          <!-- Confirm Password -->
          <div>
            <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-1.5 block">Confirmar Nueva Contraseña</label>
            <input
              v-model="confirmPassword"
              type="password"
              placeholder="Confirmar contraseña"
              class="w-full h-11 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30"
              required
            />
          </div>

          <!-- Error -->
          <div v-if="error" class="bg-red/10 text-red text-xs font-bold p-3 rounded-xl">{{ error }}</div>

          <!-- Success -->
          <div v-if="success" class="bg-teal/10 text-teal text-xs font-bold p-3 rounded-xl">{{ success }}</div>

          <!-- Submit -->
          <button
            type="submit"
            :disabled="loading"
            class="w-full h-11 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors disabled:opacity-50 cursor-pointer"
          >
            {{ loading ? 'Guardando...' : 'Actualizar Contraseña' }}
          </button>
        </form>

        <!-- Back to login -->
        <div class="mt-6 pt-6 border-t border-border text-center">
          <router-link to="/login" class="text-xs text-cyan font-bold hover:underline">Volver al inicio de sesion</router-link>
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

usePageMeta(AUTH_PAGE_META.changePassword)

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

function validate(): string | null {
  if (newPassword.value.length < 6) {
    return 'La nueva contraseña debe tener al menos 6 caracteres'
  }
  if (newPassword.value === currentPassword.value) {
    return 'La nueva contraseña debe ser diferente a la actual'
  }
  if (newPassword.value !== confirmPassword.value) {
    return 'Las contraseñas no coinciden'
  }
  return null
}

async function handleSubmit() {
  error.value = ''
  success.value = ''

  const validationError = validate()
  if (validationError) {
    error.value = validationError
    return
  }

  loading.value = true
  try {
    await AuthService.changePassword(currentPassword.value, newPassword.value)
    success.value = 'Contraseña actualizada correctamente'
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Error al cambiar la contraseña'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
</style>
