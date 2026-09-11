<template>
  <SectionCard title="Captcha del registro" subtitle="La barrera anti-robots del alta pública de hoteles">
    <template #actions>
      <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black" :class="badge.cls">
        <span class="h-2 w-2 rounded-full" :class="badge.dot"></span>{{ badge.label }}
      </span>
    </template>

    <div v-if="cargando" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-11 animate-pulse rounded-xl bg-surface"></div>
    </div>

    <div v-else class="space-y-4">
      <!-- Sin captcha el alta queda sólo con el rate-limit por IP, que frena a una máquina pero no
           a un bot distribuido. Se dice en la pantalla porque apagado e imposible de distinguir
           de prendido era justamente el problema. -->
      <p v-if="!estado.enabled" class="rounded-xl border-2 border-gold/30 bg-gold/10 px-4 py-3 text-[12px] text-gold">
        <span class="font-bold">El registro público está sin captcha.</span>
        Lo protege solo el límite por IP: frena la fuerza bruta desde una máquina, no a un bot
        distribuido creando hoteles basura.
      </p>

      <p v-if="estado.origen === 'entorno'" class="rounded-xl border-2 border-navy/15 bg-navy/5 px-4 py-3 text-[12px] text-text-secondary">
        <span class="font-bold text-navy">Configurado en el servidor</span> (`TURNSTILE_SECRET` en el
        <code>.env</code>). Esta pantalla queda de solo lectura: lo que está en el servidor manda
        sobre lo que se cargue acá.
      </p>
      <p v-else-if="!estado.puedeGuardar" class="rounded-xl border-2 border-coral/30 bg-coral/10 px-4 py-3 text-[12px] text-coral">
        Falta <code>PAYMENTS_ENCRYPTION_KEY</code> en el servidor: sin ella el secreto se guardaría
        en claro en la base, así que esta pantalla no puede grabar.
      </p>

      <div class="flex items-center justify-between rounded-xl bg-surface p-3">
        <div class="min-w-0">
          <div class="text-sm font-bold">Captcha activo</div>
          <div class="text-[10px] text-text-muted">Interruptor general. Se aplica al siguiente intento, sin reiniciar ni recompilar nada.</div>
        </div>
        <button @click="form.enabled = !form.enabled" :disabled="bloqueado" aria-label="Activar captcha"
          class="relative h-6 w-12 shrink-0 rounded-full transition-colors"
          :class="[form.enabled ? 'bg-teal' : 'bg-gray-300', bloqueado ? 'cursor-not-allowed opacity-50' : 'cursor-pointer']">
          <div class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="form.enabled ? 'right-0.5' : 'left-0.5'"></div>
        </button>
      </div>

      <!-- Alcance por pantalla. Cada una tiene su switch; el general de arriba manda sobre los dos. -->
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3" data-testid="captcha-scope-register">
          <div class="min-w-0">
            <div class="text-sm font-bold">En el registro</div>
            <div class="text-[10px] text-text-muted">La barrera contra altas basura: cada alta escribe hotel, usuario, roles y suscripción.</div>
          </div>
          <button @click="form.register = !form.register" :disabled="bloqueado" aria-label="Captcha en el registro"
            class="relative h-6 w-12 shrink-0 rounded-full transition-colors"
            :class="[form.register ? 'bg-teal' : 'bg-gray-300', bloqueado ? 'cursor-not-allowed opacity-50' : 'cursor-pointer']">
            <div class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="form.register ? 'right-0.5' : 'left-0.5'"></div>
          </button>
        </div>
        <div class="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3" data-testid="captcha-scope-login">
          <div class="min-w-0">
            <div class="text-sm font-bold">En el inicio de sesión</div>
            <div class="text-[10px] text-text-muted">Frena la fuerza bruta de contraseñas desde muchas IPs (el límite por IP no la ve).</div>
            <div class="mt-1 text-[10px] font-bold text-gold">La app móvil entra por el mismo endpoint y hoy no manda captcha: con esto prendido, la app no puede iniciar sesión hasta que lo soporte.</div>
          </div>
          <button @click="form.login = !form.login" :disabled="bloqueado" aria-label="Captcha en el inicio de sesión"
            class="relative h-6 w-12 shrink-0 rounded-full transition-colors"
            :class="[form.login ? 'bg-teal' : 'bg-gray-300', bloqueado ? 'cursor-not-allowed opacity-50' : 'cursor-pointer']">
            <div class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="form.login ? 'right-0.5' : 'left-0.5'"></div>
          </button>
        </div>
      </div>

      <div>
        <label for="captcha-proveedor" class="mb-2 block text-[10px] font-bold uppercase text-text-muted">Proveedor</label>
        <select id="captcha-proveedor" name="captchaProveedor" v-model="form.provider" :disabled="bloqueado"
          class="w-full cursor-pointer rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none disabled:opacity-50">
          <option v-for="p in estado.proveedores" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
        <p v-if="proveedorElegido" class="mt-1 text-[11px] text-text-muted">
          {{ proveedorElegido.hint }}
          <a :href="proveedorElegido.docsUrl" target="_blank" rel="noopener" class="ml-1 font-bold text-cyan underline decoration-dotted">
            Sacar las claves ↗
          </a>
        </p>
      </div>

      <div>
        <label for="captcha-sitekey" class="mb-2 block text-[10px] font-bold uppercase text-text-muted">Clave pública (site key)</label>
        <input id="captcha-sitekey" name="captchaSiteKey" v-model="form.siteKey" :disabled="bloqueado" autocomplete="off"
          placeholder="La que va en el widget, se ve en el navegador"
          class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none disabled:opacity-50" />
      </div>

      <div>
        <label for="captcha-secret" class="mb-2 block text-[10px] font-bold uppercase text-text-muted">Clave secreta</label>
        <input id="captcha-secret" name="captchaSecret" v-model="form.secret" type="password" :disabled="bloqueado" autocomplete="new-password"
          :placeholder="estado.configurado ? `Guardada (${estado.pista}) — escribí para reemplazarla` : 'La que valida el token del lado del servidor'"
          class="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm focus:border-navy focus:outline-none disabled:opacity-50" />
        <p class="mt-1 text-[11px] text-text-muted">
          Se guarda cifrada y no vuelve a mostrarse. Dejarla vacía conserva la que ya está: podés
          apagar el captcha o cambiar de proveedor sin ir a buscarla de nuevo.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3 pt-1">
        <button @click="guardar" :disabled="bloqueado || guardando"
          class="cursor-pointer rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
        <span v-if="error" class="text-xs font-bold text-coral">{{ error }}</span>
      </div>
    </div>
  </SectionCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { CaptchaService, type CaptchaEstado, type CaptchaProvider } from '@/services/Captcha.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')

const estado = ref<CaptchaEstado>({
  enabled: false, provider: 'turnstile', siteKey: '', configurado: false,
  origen: null, pista: null, puedeGuardar: false, proveedores: [],
  scopes: { register: true, login: false },
})

/** Lo editable. Se separa del estado para que el secreto escrito no se pise al recargar. */
const form = ref<{ enabled: boolean; provider: CaptchaProvider; siteKey: string; secret: string; register: boolean; login: boolean }>({
  enabled: false, provider: 'turnstile', siteKey: '', secret: '', register: true, login: false,
})

// De solo lectura cuando el secreto lo pone el servidor o cuando falta la clave de cifrado: en
// ninguno de los dos casos este formulario puede grabar, y dejar los campos vivos sería mentir.
const bloqueado = computed(() => !estado.value.puedeGuardar)
const proveedorElegido = computed(() => estado.value.proveedores.find((p) => p.value === form.value.provider))

const badge = computed(() => {
  if (cargando.value) return { label: 'Cargando…', cls: 'bg-navy/10 text-navy', dot: 'bg-navy animate-pulse' }
  if (estado.value.origen === 'entorno') return { label: 'Activo (servidor)', cls: 'bg-teal/15 text-teal', dot: 'bg-teal' }
  if (estado.value.enabled) return { label: 'Activo', cls: 'bg-teal/15 text-teal', dot: 'bg-teal' }
  if (estado.value.configurado) return { label: 'Configurado, apagado', cls: 'bg-gold/15 text-gold', dot: 'bg-gold' }
  return { label: 'Sin configurar', cls: 'bg-coral/15 text-coral', dot: 'bg-coral' }
})

function aplicar(e: CaptchaEstado) {
  estado.value = e
  form.value = { enabled: e.enabled, provider: e.provider, siteKey: e.siteKey, secret: '', register: e.scopes?.register ?? true, login: e.scopes?.login ?? false }
}

async function cargar() {
  cargando.value = true
  try {
    aplicar(await CaptchaService.estado())
  } catch {
    error.value = 'No se pudo leer la configuración del captcha.'
  } finally {
    cargando.value = false
  }
}

async function guardar() {
  guardando.value = true
  error.value = ''
  try {
    // El secreto sólo viaja si el admin escribió uno: vacío quiere decir "conservá el guardado".
    aplicar(await CaptchaService.guardar({
      enabled: form.value.enabled,
      provider: form.value.provider,
      siteKey: form.value.siteKey.trim(),
      register: form.value.register,
      login: form.value.login,
      ...(form.value.secret.trim() ? { secret: form.value.secret.trim() } : {}),
    }))
    toast.success(estado.value.enabled ? 'Captcha activado' : 'Configuración guardada')
  } catch (e) {
    // El backend explica POR QUÉ (falta una clave, el entorno manda): se muestra tal cual.
    error.value = (e as { message?: string })?.message || 'No se pudo guardar'
  } finally {
    guardando.value = false
  }
}

onMounted(cargar)
</script>
