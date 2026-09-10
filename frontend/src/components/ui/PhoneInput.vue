<template>
  <div>
    <div class="relative">
      <!-- Prefijo del país. Solo aparece cuando sabemos de qué país es: sin
           país elegido, mostrar un "+1" fijo haría escribir el número mal. -->
      <span v-if="dialCode"
        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-sm font-bold"
        :class="pill ? 'text-teal' : 'text-text-secondary'">
        <span class="text-base leading-none">{{ flag }}</span>
        {{ dialCode }}
      </span>
      <span v-else class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" :class="pill ? 'text-teal' : 'text-text-muted'" v-html="ICON_PHONE"></span>

      <input
        :value="modelValue"
        @input="onInput"
        @blur="touched = true"
        type="tel"
        :maxlength="maxlength"
        :disabled="disabled"
        :placeholder="placeholder || examplePlaceholder"
        class="w-full bg-white border focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface"
        :class="[
          pill ? 'h-12 rounded-full pr-4.5 text-sm font-semibold focus:border-teal' : 'py-2.5 pr-3 rounded-xl text-sm focus:border-navy',
          dialCode ? prefixPadding : (pill ? 'pl-11' : 'pl-9'),
          showError || invalid ? 'border-danger' : 'border-border',
        ]"
      />
    </div>

    <p v-if="showError" class="text-[11px] text-danger mt-1">
      Ese número no parece válido para {{ country }}.
    </p>
    <p v-else-if="hint" class="text-[11px] text-text-muted mt-1">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
// PhoneInput.vue — Teléfono con formato y validación según el país.
//
// El país NO se pide acá: se recibe del formulario, que ya lo preguntó. Pedir
// dos veces lo mismo (país arriba, prefijo abajo) es la forma habitual de que
// queden en desacuerdo.
//
// Guarda el número tal como se escribe, formateado para el país. El backend
// recibe texto libre: no se fuerza E.164 porque los teléfonos existentes de la
// base están en formatos variados y normalizarlos es una migración aparte.
import { computed, ref, watch } from 'vue'
import { AsYouType, isValidPhoneNumber, getCountryCallingCode, getExampleNumber } from 'libphonenumber-js'
import examples from 'libphonenumber-js/mobile/examples'
import type { CountryCode } from 'libphonenumber-js'
import { countryCode } from '@/data/locales'

const props = withDefaults(defineProps<{
  /** Puede llegar undefined mientras el formulario no cargó: se trata como vacío. */
  modelValue: string | undefined
  /** Nombre del país en español, tal como lo devuelve el selector. */
  country?: string
  placeholder?: string
  hint?: string
  maxlength?: number
  disabled?: boolean
  /** Variante pill (borde 9999px, 48px de alto, ícono teal) para el wizard de Centro de
   *  configuración (`.wizard-input`, `styles/main.css`) — el resto de las pantallas
   *  (Configuración, registro, huéspedes, ReservationWizardModal) sigue con el estilo
   *  original (rounded-xl) sin tocar nada. */
  pill?: boolean
  /** Fuerza el borde rojo desde afuera (ej. "campo obligatorio" del formulario que lo
   *  contiene) sin pisar el mensaje de formato inválido de acá adentro — son dos chequeos
   *  distintos (obligatoriedad vs. forma del número), cada uno con su propio texto. */
  invalid?: boolean
}>(), { modelValue: '', country: '', placeholder: '', hint: '', maxlength: 25, disabled: false, pill: false, invalid: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const touched = ref(false)

const iso = computed<CountryCode | undefined>(() => {
  const code = countryCode(props.country)
  return code ? (code as CountryCode) : undefined
})

const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"/></svg>'

/** `+34`, `+1`… Vacío si no sabemos el país. */
const dialCode = computed(() => {
  if (!iso.value) return ''
  try { return `+${getCountryCallingCode(iso.value)}` } catch { return '' }
})

/**
 * Bandera por emoji, derivada del código ISO (A=🇦). Sin imágenes ni fuente
 * externa: son dos code points por letra.
 */
const flag = computed(() => {
  const code = iso.value
  if (!code || code.length !== 2) return ''
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
})

/** El input arranca donde termina el prefijo, que cambia de ancho (+1 vs +598). */
const prefixPadding = computed(() => {
  const len = dialCode.value.length
  if (len <= 2) return 'pl-16'
  if (len === 3) return 'pl-[4.5rem]'
  return 'pl-20'
})

/** Un número real del país como placeholder: enseña el formato sin explicarlo. */
const examplePlaceholder = computed(() => {
  if (!iso.value) return '+1 809 555 0100'
  try {
    const ex = getExampleNumber(iso.value, examples)
    return ex ? ex.formatNational() : ''
  } catch { return '' }
})

const isValid = computed(() => {
  const v = props.modelValue?.trim()
  if (!v || !iso.value) return true   // vacío es válido: el teléfono es opcional
  try { return isValidPhoneNumber(v, iso.value) } catch { return true }
})

// El error aparece recién al salir del campo: marcarlo en rojo mientras se
// escribe el tercer dígito es hostil, porque todavía no terminó.
const showError = computed(() => touched.value && !!props.modelValue?.trim() && !isValid.value)

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  emit('update:modelValue', format(raw))
}

/**
 * Formatea mientras se escribe. Al borrar NO se reformatea: si el usuario borra
 * un separador que el formateador vuelve a poner, el cursor queda trabado y no
 * puede borrar hacia atrás.
 */
function format(raw: string): string {
  if (!iso.value) return raw
  if (raw.length < (props.modelValue?.length ?? 0)) return raw
  try { return new AsYouType(iso.value).input(raw) } catch { return raw }
}

// Al cambiar de país, lo escrito ya no corresponde a ese formato: se reformatea
// desde los dígitos crudos en vez de dejar un número con separadores del país
// anterior.
watch(iso, (code) => {
  const v = props.modelValue?.trim()
  if (!v || !code) return
  const digits = v.replace(/[^\d+]/g, '')
  try { emit('update:modelValue', new AsYouType(code).input(digits)) } catch { /* se deja como está */ }
  touched.value = false
})
</script>
