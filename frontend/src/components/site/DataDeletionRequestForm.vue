<template>
  <!-- Formulario del punto "1. Por el formulario web" de /p/eliminacion-datos. Vive dentro
       de la misma card del contenido legal, al final — coincide con lo que dice el texto
       ("el formulario que está al final de esta misma página"). -->
  <div id="formulario-eliminacion-datos" class="mt-10 pt-8 border-t border-slate-100 scroll-mt-24">
    <h2 class="text-[1.3rem] font-black text-navy leading-tight mb-1 pl-[0.9rem] border-l-4 border-blue">
      Formulario de eliminación de datos
    </h2>
    <p class="text-sm text-slate-500 mb-6">
      Completalo y te confirmamos el número de tu solicitud al instante.
    </p>

    <!-- Confirmación -->
    <div v-if="ack" class="bg-teal-50 border border-teal-100 rounded-xl p-6 flex items-start gap-4">
      <span class="text-2xl leading-none">✅</span>
      <div>
        <p class="font-black text-navy mb-1">Solicitud recibida</p>
        <p class="text-sm text-slate-600 mb-2">
          Tu número de solicitud es <strong class="font-mono text-navy">{{ ack.requestNumber }}</strong>.
          Guardalo para hacer seguimiento. Verificaremos tu identidad y te confirmamos por escrito
          en los plazos indicados arriba.
        </p>
        <button class="text-xs font-bold text-blue hover:underline cursor-pointer" @click="ack = null">
          Enviar otra solicitud
        </button>
      </div>
    </div>

    <!-- Formulario -->
    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1" for="del-fullName">Nombre completo *</label>
        <input
          id="del-fullName"
          v-model="form.fullName"
          type="text"
          required
          maxlength="200"
          class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
          placeholder="Tu nombre completo"
        />
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1" for="del-contact">
          Teléfono o usuario con el que nos escribiste *
        </label>
        <input
          id="del-contact"
          v-model="form.contactHandle"
          type="text"
          required
          maxlength="100"
          class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
          placeholder="+1 809 555 0000 o tu usuario de Instagram/Facebook"
        />
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1" for="del-hotel">
          Hotel o establecimiento con el que interactuaste (si lo recordás)
        </label>
        <input
          id="del-hotel"
          v-model="form.hotelName"
          type="text"
          maxlength="200"
          class="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100"
          placeholder="Opcional"
        />
      </div>

      <p v-if="error" class="text-sm text-coral font-bold">{{ error }}</p>

      <button
        type="submit"
        class="bg-blue text-white font-bold text-sm px-6 py-3 rounded-xl hover:bg-navy transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        :disabled="submitting"
      >
        {{ submitting ? 'Enviando…' : 'Enviar solicitud' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { PublicDeletionRequests } from '@/services/DeletionRequests.service'
import { ApiError } from '@/services/http'
import type { DeletionRequestAck } from '@/types/deletion-requests'

const form = reactive({ fullName: '', contactHandle: '', hotelName: '' })
const submitting = ref(false)
const error = ref('')
const ack = ref<DeletionRequestAck | null>(null)

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    ack.value = await PublicDeletionRequests.create({
      fullName: form.fullName.trim(),
      contactHandle: form.contactHandle.trim(),
      hotelName: form.hotelName.trim() || undefined,
    })
    form.fullName = ''
    form.contactHandle = ''
    form.hotelName = ''
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) {
      error.value = 'Demasiados intentos. Esperá un minuto y volvé a intentar.'
    } else {
      error.value = e instanceof ApiError ? e.message : 'No se pudo enviar la solicitud. Intentá de nuevo.'
    }
  } finally {
    submitting.value = false
  }
}
</script>
