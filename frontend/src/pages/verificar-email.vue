<template>
  <div class="min-h-screen bg-surface flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <img :src="logoStackedColor" alt="SolmiOS" class="h-20 w-auto mx-auto mb-2">
        <p class="text-sm text-text-muted">Hospitality OS · LATAM</p>
      </div>

      <!-- Result Card -->
      <div class="bg-white rounded-2xl border border-border card-shadow p-8 text-center">
        <div class="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4" :class="view.iconBg">
          <span class="w-8 h-8" :class="view.iconColor" v-html="view.icon"></span>
        </div>
        <h2 class="text-lg font-extrabold text-navy mb-2">{{ view.title }}</h2>
        <p class="text-sm text-text-muted mb-6">{{ view.text }}</p>

        <router-link v-if="view.showPanelButton" to="/panel"
          class="inline-block h-11 px-6 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors leading-11">
          Ir al panel
        </router-link>
        <router-link v-else to="/login"
          class="inline-block h-11 px-6 bg-navy text-white font-extrabold text-sm rounded-xl hover:bg-navy-light transition-colors leading-11">
          Iniciar sesión
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import logoStackedColor from '@/assets/logo/logo-stacked-color.png'

type Outcome = 'verified' | 'invalid' | 'expired' | 'already_verified'

const ICON_CHECK = '<svg class="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>'
const ICON_WARN = '<svg class="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>'
const ICON_LINK = '<svg class="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101m-.758-4.899a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1" /></svg>'

interface View {
  title: string
  text: string
  icon: string
  iconBg: string
  iconColor: string
  showPanelButton: boolean
}

const route = useRoute()

const status = computed<Outcome | ''>(() => {
  const s = route.query.status
  const val = Array.isArray(s) ? s[0] : s
  return (val as Outcome) ?? ''
})

const VIEWS: Record<Outcome, View> = {
  verified: {
    title: '¡Email verificado!',
    text: 'Tu correo quedó confirmado. Ya podés usar tu cuenta con normalidad.',
    icon: ICON_CHECK,
    iconBg: 'bg-success/10',
    iconColor: 'text-success',
    showPanelButton: true,
  },
  already_verified: {
    title: 'Tu email ya estaba verificado',
    text: 'No hace falta hacer nada más. Tu cuenta ya está confirmada.',
    icon: ICON_CHECK,
    iconBg: 'bg-success/10',
    iconColor: 'text-success',
    showPanelButton: true,
  },
  expired: {
    title: 'El enlace venció',
    text: 'Este enlace de verificación expiró. Ingresá al panel y pedí un correo nuevo desde el aviso de verificación.',
    icon: ICON_WARN,
    iconBg: 'bg-warning/10',
    iconColor: 'text-warning',
    showPanelButton: false,
  },
  invalid: {
    title: 'Enlace inválido',
    text: 'El enlace de verificación no es válido. Ingresá al panel y solicitá uno nuevo.',
    icon: ICON_LINK,
    iconBg: 'bg-danger/10',
    iconColor: 'text-danger',
    showPanelButton: false,
  },
}

const view = computed<View>(() => VIEWS[status.value as Outcome] ?? VIEWS.invalid)
</script>

<style scoped></style>
