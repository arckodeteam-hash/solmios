<template>
  <!-- AppModal: mismo componente que usa BookingModal en la landing pública — da gratis
       Escape-to-close, bloqueo de scroll del body y la pila de modales (por si algún día
       convive con otro modal público abierto encima). -->
  <AppModal
    :open="open"
    title="Hablar con Ventas"
    subtitle="Te contactamos en menos de 24 horas hábiles."
    :closable="!submitting"
    :close-on-backdrop="!submitting"
    @close="close"
  >
    <!-- Confirmación -->
    <div v-if="sent" class="p-2 text-center">
      <div class="text-4xl mb-3">✅</div>
      <p class="font-black text-navy mb-1">¡Listo! Recibimos tu consulta</p>
      <p class="text-sm text-slate-500 mb-6">
        Nuestro equipo de ventas te va a escribir pronto{{ form.email ? ` a ${form.email}` : '' }}.
      </p>
      <button
        class="bg-blue text-white font-bold text-sm px-6 py-3 rounded-xl hover:bg-navy transition-all cursor-pointer"
        @click="close"
      >
        Cerrar
      </button>
    </div>

    <!-- Formulario -->
    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1" for="sales-fullName">Nombre completo *</label>
        <input
          id="sales-fullName"
          v-model="form.fullName"
          type="text"
          required
          maxlength="200"
          class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
          placeholder="Tu nombre completo"
        />
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1" for="sales-email">Correo electrónico *</label>
        <input
          id="sales-email"
          v-model="form.email"
          type="email"
          required
          maxlength="200"
          class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
          placeholder="tu@correo.com"
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1" for="sales-phone">Teléfono</label>
          <input
            id="sales-phone"
            v-model="form.phone"
            type="tel"
            maxlength="50"
            class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
            placeholder="Opcional"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1" for="sales-rooms">Habitaciones aprox.</label>
          <input
            id="sales-rooms"
            v-model="form.roomsRange"
            type="text"
            maxlength="50"
            class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
            placeholder="Ej: 20-50"
          />
        </div>
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1" for="sales-hotel">Hotel o establecimiento</label>
        <input
          id="sales-hotel"
          v-model="form.hotelName"
          type="text"
          maxlength="200"
          class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
          placeholder="Opcional"
        />
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1" for="sales-message">Mensaje</label>
        <textarea
          id="sales-message"
          v-model="form.message"
          rows="3"
          maxlength="2000"
          class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
          placeholder="Contanos qué necesitás (opcional)"
        />
      </div>

      <p v-if="error" class="text-sm text-coral font-bold">{{ error }}</p>

      <button
        type="submit"
        class="w-full bg-blue text-white font-bold text-sm px-6 py-3 rounded-xl hover:bg-navy transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        :disabled="submitting"
      >
        {{ submitting ? 'Enviando…' : 'Enviar consulta' }}
      </button>
    </form>
  </AppModal>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import { PublicSalesLeads } from '@/services/SalesLeads.service'
import { ApiError } from '@/services/http'

const props = defineProps<{
  open: boolean
  /** Slug del plan cuando se abre desde "Contactar ventas" de una tarjeta de plan a cotización. */
  planInterest?: string
}>()

const emit = defineEmits<{ 'update:open': [boolean] }>()

const form = reactive({ fullName: '', email: '', phone: '', roomsRange: '', hotelName: '', message: '' })
const submitting = ref(false)
const error = ref('')
const sent = ref(false)

// Reset del formulario cada vez que se vuelve a abrir — no arrastrar el envío anterior.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  sent.value = false
  error.value = ''
  form.fullName = ''
  form.email = ''
  form.phone = ''
  form.roomsRange = ''
  form.hotelName = ''
  form.message = ''
})

function close() {
  emit('update:open', false)
}

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await PublicSalesLeads.create({
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      roomsRange: form.roomsRange.trim() || undefined,
      hotelName: form.hotelName.trim() || undefined,
      message: form.message.trim() || undefined,
      planInterest: props.planInterest || undefined,
    })
    sent.value = true
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) {
      error.value = 'Demasiados intentos. Esperá un minuto y volvé a intentar.'
    } else {
      error.value = e instanceof ApiError ? e.message : 'No se pudo enviar la consulta. Intentá de nuevo.'
    }
  } finally {
    submitting.value = false
  }
}
</script>
