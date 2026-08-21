<template>
  <div class="min-h-screen bg-surface flex items-center justify-center p-4">
    <!-- ── Loading inicial ── -->
    <div v-if="loadingReservation" class="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8 text-center">
      <div class="text-3xl mb-2">🛎️</div>
      <p class="text-sm text-text-secondary">Cargando tu reserva…</p>
    </div>

    <!-- ── Link inválido / expirado ── -->
    <div v-else-if="loadError" class="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8 text-center">
      <div class="text-3xl mb-2">⚠️</div>
      <h2 class="text-xl font-black text-navy mb-2">No pudimos abrir tu check-in</h2>
      <p class="text-sm text-text-secondary">{{ loadError }}</p>
    </div>

    <!-- ── Flujo multi-paso ── -->
    <div v-else class="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
      <!-- Header -->
      <div class="bg-navy px-6 py-5 text-center">
        <div class="text-2xl mb-1">🛎️</div>
        <h2 class="text-lg font-black text-white">Pre Check-in</h2>
        <p class="text-xs text-white/70 mt-0.5">{{ reservation.hotelName }}</p>
      </div>

      <!-- Stepper (solo pasos 1-5, procesando/confirmación son pantalla completa) -->
      <div v-if="step <= 5" class="flex items-center justify-center gap-1.5 px-6 pt-5">
        <template v-for="n in 5" :key="n">
          <div
            class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
            :class="n < step ? 'bg-teal text-white' : n === step ? 'bg-navy text-white' : 'bg-surface-dark text-text-muted'"
          >
            <Icon v-if="n < step" name="check" :size="12" />
            <span v-else>{{ n }}</span>
          </div>
          <div v-if="n < 5" class="flex-1 h-0.5" :class="n < step ? 'bg-teal' : 'bg-surface-dark'" />
        </template>
      </div>

      <div class="p-6">
        <div v-if="error" class="mb-4 px-4 py-2 rounded-lg bg-coral/10 text-coral text-xs font-bold">{{ error }}</div>

        <!-- ── PASO 1 — Reserva (solo lectura) ── -->
        <div v-if="step === 1">
          <h3 class="text-sm font-black text-navy uppercase mb-3">Tu reserva</h3>
          <div class="bg-surface rounded-xl p-4 text-sm space-y-2">
            <div class="flex justify-between"><span class="text-text-secondary">Check-in</span><span class="font-bold text-navy">{{ reservation.checkIn }}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">Check-out</span><span class="font-bold text-navy">{{ reservation.checkOut }}</span></div>
            <div class="flex justify-between"><span class="text-text-secondary">Habitación</span><span class="font-bold text-navy">{{ reservation.roomNumber }}</span></div>
          </div>
          <p class="text-xs text-text-muted mt-4">Completá tu registro antes de llegar: te va a tomar solo unos minutos.</p>
          <button type="button" class="w-full mt-6 py-3 bg-teal text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-teal/80" @click="step = 2">
            Empezar
          </button>
        </div>

        <!-- ── PASO 2 — Grupo ── -->
        <div v-else-if="step === 2">
          <h3 class="text-sm font-black text-navy uppercase mb-3">¿Quién viaja?</h3>
          <div class="space-y-4">
            <div>
              <label for="prechk-name" class="block text-[11px] font-bold text-navy uppercase mb-2">Nombre completo *</label>
              <input id="prechk-name" name="name" required aria-required="true" v-model="mainGuest.name" type="text" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" />
            </div>
            <div>
              <label for="prechk-email" class="block text-[11px] font-bold text-navy uppercase mb-2">Email</label>
              <input id="prechk-email" name="email" autocomplete="email" v-model="mainGuest.email" type="email" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" />
            </div>

            <div class="flex rounded-xl border border-border overflow-hidden">
              <button
                type="button"
                class="flex-1 py-2.5 text-xs font-bold cursor-pointer"
                :class="travelingAlone ? 'bg-teal text-white' : 'bg-white text-text-secondary'"
                @click="setTravelingAlone(true)"
              >Viajo solo/a</button>
              <button
                type="button"
                class="flex-1 py-2.5 text-xs font-bold cursor-pointer"
                :class="!travelingAlone ? 'bg-teal text-white' : 'bg-white text-text-secondary'"
                @click="setTravelingAlone(false)"
              >Viajo acompañado/a</button>
            </div>

            <div v-if="!travelingAlone" class="space-y-2">
              <label class="block text-[11px] font-bold text-navy uppercase">Acompañantes</label>
              <div v-for="(c, i) in companions" :key="i" class="flex items-center gap-2 bg-surface rounded-lg p-2">
                <input :id="`prechk-companion-${i}-name`" :name="`companionName${i}`" :aria-label="`Nombre del acompañante ${i + 1}`" v-model="c.name" type="text" placeholder="Nombre del acompañante" class="flex-1 px-3 py-1.5 rounded-lg border border-border text-xs" />
                <button type="button" class="text-coral text-xs font-bold cursor-pointer px-2" @click="companions.splice(i, 1)">✕</button>
              </div>
              <button
                v-if="companions.length < MAX_COMPANIONS"
                type="button"
                class="text-xs font-bold text-teal hover:underline cursor-pointer"
                @click="companions.push({ name: '', documentNumber: '' })"
              >+ Agregar acompañante</button>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-3 rounded-xl text-sm font-bold border border-border text-text-secondary cursor-pointer" @click="step = 1">Volver</button>
            <button type="button" class="flex-1 py-3 bg-teal text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-teal/80" @click="goToStep3">Continuar</button>
          </div>
        </div>

        <!-- ── PASO 3 — Documentos ── -->
        <div v-else-if="step === 3">
          <h3 class="text-sm font-black text-navy uppercase mb-3">Documento del titular</h3>

          <div v-if="documentMode === 'choose'" class="grid grid-cols-1 gap-3">
            <button type="button" class="flex items-center gap-3 p-4 rounded-xl border-2 border-teal text-left cursor-pointer hover:bg-teal/5" @click="documentMode = 'scan'">
              <Icon name="document" :size="22" class="text-teal" />
              <div>
                <div class="text-sm font-bold text-navy">Escanear documento</div>
                <div class="text-xs text-text-muted">Sacale una foto y completamos el número por vos</div>
              </div>
            </button>
            <button type="button" class="flex items-center gap-3 p-4 rounded-xl border border-border text-left cursor-pointer hover:bg-surface" @click="documentMode = 'manual'">
              <Icon name="edit" :size="22" class="text-text-secondary" />
              <div>
                <div class="text-sm font-bold text-navy">Llenar manualmente</div>
                <div class="text-xs text-text-muted">Completo los datos yo mismo</div>
              </div>
            </button>
          </div>

          <div v-else class="space-y-4">
            <div v-if="documentMode === 'scan'" class="bg-surface rounded-xl p-4">
              <input id="prechk-document-file" name="documentPhoto" ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileSelected" />

              <!-- Fase 1: elegir/tomar foto -->
              <div v-if="scanPhase === 'capture'" class="text-center">
                <button type="button" class="px-4 py-2.5 bg-teal text-white rounded-xl text-xs font-bold cursor-pointer" @click="fileInputRef?.click()">
                  📷 Tomar / elegir foto
                </button>
              </div>

              <!-- Fase 2: recorte manual — aísla el documento del fondo/reflejos antes del OCR -->
              <div v-else-if="scanPhase === 'crop'" class="space-y-2">
                <p class="text-xs text-text-secondary text-center">Ajustá el recuadro para cubrir solo el documento (dejá afuera fondo y reflejos). Si está de costado, giralo primero.</p>
                <canvas
                  ref="cropCanvasRef"
                  class="w-full rounded-lg border border-border touch-none cursor-move block"
                  @pointerdown="cropPointerDown"
                  @pointermove="cropPointerMove"
                  @pointerup="cropPointerUp"
                  @pointerleave="cropPointerUp"
                />
                <div class="flex gap-2 justify-center">
                  <button type="button" class="px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-text-secondary cursor-pointer" @click="rotateCrop(-90)">↺ Girar izquierda</button>
                  <button type="button" class="px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-text-secondary cursor-pointer" @click="rotateCrop(90)">↻ Girar derecha</button>
                </div>
                <div class="flex gap-2">
                  <button type="button" class="flex-1 py-2 rounded-lg border border-border text-xs font-bold text-text-secondary cursor-pointer" @click="fileInputRef?.click()">Elegir otra foto</button>
                  <button type="button" class="flex-1 py-2 bg-teal text-white rounded-lg text-xs font-bold cursor-pointer" @click="confirmCrop">Confirmar recorte</button>
                </div>
              </div>

              <!-- Fase 3: resultado — foto original (queda como respaldo) + estado del OCR -->
              <div v-else class="space-y-2">
                <img :src="documentPhotoDataUrl" alt="Foto del documento" class="w-full max-h-48 object-contain rounded-lg border border-border" />
                <button type="button" class="text-xs font-bold text-teal hover:underline cursor-pointer" @click="fileInputRef?.click()">Cambiar foto</button>
              </div>

              <div v-if="ocrStatus === 'running'" class="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                <span class="inline-block w-3 h-3 border-2 border-teal border-t-transparent rounded-full animate-spin" />
                Extrayendo texto del documento…
              </div>
              <div v-else-if="ocrMessage" class="mt-3 text-xs font-bold" :class="ocrFound ? 'text-teal' : 'text-text-muted'">
                {{ ocrMessage }}
              </div>
            </div>

            <button type="button" class="text-xs font-bold text-text-muted hover:underline cursor-pointer" @click="documentMode = 'choose'; resetOcr()">
              ← Elegir otro método
            </button>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-[11px] font-bold text-navy uppercase mb-2">Tipo documento</label>
                <select id="prechk-document-type" name="documentType" v-model="mainGuest.documentType" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer">
                  <option value="passport">Pasaporte</option>
                  <option value="dni">Cédula / DNI</option>
                  <option value="other">Licencia / Otro</option>
                </select>
              </div>
              <div>
                <label for="prechk-document" class="block text-[11px] font-bold text-navy uppercase mb-2">Nº Documento</label>
                <input id="prechk-document" name="document" v-model="mainGuest.document" type="text" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div><label for="prechk-nationality" class="block text-[11px] font-bold text-navy uppercase mb-2">Nacionalidad</label><input id="prechk-nationality" name="nationality" v-model="mainGuest.nationality" type="text" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
              <div><label for="prechk-phone" class="block text-[11px] font-bold text-navy uppercase mb-2">Teléfono</label><input id="prechk-phone" name="phone" autocomplete="tel" v-model="mainGuest.phone" type="tel" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm" /></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label for="prechk-address" class="block text-[11px] font-bold text-navy uppercase mb-2">Dirección</label><input id="prechk-address" name="address" v-model="mainGuest.address" type="text" class="w-full px-3 py-2.5 rounded-xl border border-border text-sm" /></div>
              <div><label for="prechk-city" class="block text-[11px] font-bold text-navy uppercase mb-2">Ciudad</label><input id="prechk-city" name="city" v-model="mainGuest.city" type="text" class="w-full px-3 py-2.5 rounded-xl border border-border text-sm" /></div>
              <div><label for="prechk-country" class="block text-[11px] font-bold text-navy uppercase mb-2">País</label><input id="prechk-country" name="country" v-model="mainGuest.country" type="text" class="w-full px-3 py-2.5 rounded-xl border border-border text-sm" /></div>
            </div>

            <div v-if="!travelingAlone && companions.length" class="space-y-2">
              <label class="block text-[11px] font-bold text-navy uppercase">Documento de tus acompañantes</label>
              <div v-for="(c, i) in companions" :key="i" class="flex items-center gap-2 bg-surface rounded-lg p-2">
                <span class="flex-1 text-xs text-navy font-bold truncate">{{ c.name || `Acompañante ${i + 1}` }}</span>
                <input :id="`prechk-companion-${i}-document`" :name="`companionDocument${i}`" :aria-label="`Número de documento del acompañante ${i + 1}`" v-model="c.documentNumber" type="text" placeholder="Nº documento" class="w-32 px-3 py-1.5 rounded-lg border border-border text-xs" />
              </div>
            </div>
          </div>

          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-3 rounded-xl text-sm font-bold border border-border text-text-secondary cursor-pointer" @click="step = 2">Volver</button>
            <button type="button" class="flex-1 py-3 bg-teal text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-teal/80" :disabled="ocrStatus === 'running'" @click="goToStep4">Continuar</button>
          </div>
        </div>

        <!-- ── PASO 4 — Contrato + firma ── -->
        <div v-else-if="step === 4">
          <h3 class="text-sm font-black text-navy uppercase mb-3">Contrato de hospedaje</h3>
          <div class="bg-surface rounded-xl p-4 text-xs text-text-secondary max-h-32 overflow-y-auto leading-relaxed mb-4">
            <p>Al firmar, el huésped titular declara que los datos suministrados son correctos y acepta las normas de convivencia y uso de las instalaciones de {{ reservation.hotelName }}.</p>
            <p class="mt-2">El huésped se compromete a respetar los horarios de check-in/check-out informados, a hacer un uso adecuado de la habitación y el mobiliario, y a responder por daños ocasionados durante la estadía por sí o por sus acompañantes.</p>
            <p class="mt-2">El hotel podrá solicitar una garantía y se reserva el derecho de admisión conforme a la normativa vigente.</p>
          </div>

          <label class="block text-[11px] font-bold text-navy uppercase mb-2">Tu firma</label>
          <div class="rounded-xl border border-border bg-white overflow-hidden touch-none">
            <canvas
              ref="canvasRef"
              width="500" height="180"
              class="w-full h-[180px] touch-none cursor-crosshair"
              @pointerdown="startDraw"
              @pointermove="draw"
              @pointerup="endDraw"
              @pointerleave="endDraw"
            />
          </div>
          <button type="button" class="text-xs font-bold text-coral hover:underline cursor-pointer mt-2" @click="clearSignature">Borrar firma</button>

          <div class="flex items-start gap-3 bg-surface rounded-xl p-4 mt-4">
            <input id="prechk-contract-accepted" name="contractAccepted" required aria-required="true" v-model="contractAccepted" type="checkbox" class="mt-1 w-4 h-4 rounded text-cyan cursor-pointer" />
            <label for="prechk-contract-accepted" class="text-xs text-text-secondary cursor-pointer">Leí y acepto las normas del establecimiento descritas arriba.</label>
          </div>

          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-3 rounded-xl text-sm font-bold border border-border text-text-secondary cursor-pointer" @click="step = 3">Volver</button>
            <button type="button" class="flex-1 py-3 bg-teal text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-teal/80" @click="goToStep5">Continuar</button>
          </div>
        </div>

        <!-- ── PASO 5 — Datos / privacidad ── -->
        <div v-else-if="step === 5">
          <h3 class="text-sm font-black text-navy uppercase mb-3">Tratamiento de tus datos</h3>
          <div class="space-y-3">
            <label class="flex items-start gap-3 bg-surface rounded-xl p-4 cursor-pointer">
              <input id="prechk-gdpr-accepted" name="gdprAccepted" required aria-required="true" v-model="gdprAccepted" type="checkbox" class="mt-1 w-4 h-4 rounded text-cyan cursor-pointer" />
              <span class="text-xs text-text-secondary">Autorizo el tratamiento de mis datos personales para el registro de hospedaje, conforme a la política de privacidad del hotel. *</span>
            </label>
            <label class="flex items-start gap-3 bg-surface rounded-xl p-4 cursor-pointer">
              <input id="prechk-marketing-accepted" name="marketingAccepted" v-model="marketingAccepted" type="checkbox" class="mt-1 w-4 h-4 rounded text-cyan cursor-pointer" />
              <span class="text-xs text-text-secondary">Quiero recibir promociones y novedades del hotel por email (opcional).</span>
            </label>
          </div>

          <div class="flex gap-3 mt-6">
            <button type="button" class="flex-1 py-3 rounded-xl text-sm font-bold border border-border text-text-secondary cursor-pointer" @click="step = 4">Volver</button>
            <button type="button" class="flex-1 py-3 bg-teal text-white rounded-xl text-sm font-bold cursor-pointer hover:bg-teal/80" :disabled="!gdprAccepted" @click="finalizeSubmit">
              Finalizar check-in
            </button>
          </div>
        </div>

        <!-- ── PASO 6 — Procesando ── -->
        <div v-else-if="step === 6" class="text-center py-6">
          <span class="inline-block w-8 h-8 border-4 border-teal border-t-transparent rounded-full animate-spin mb-4" />
          <p class="text-sm font-bold text-navy">{{ processingMessage }}</p>
        </div>

        <!-- ── PASO 7 — Confirmación ── -->
        <div v-else-if="step === 7" class="text-center py-4">
          <div class="text-5xl mb-4">✅</div>
          <h2 class="text-xl font-black text-navy mb-2">¡Check-in Completado!</h2>
          <p class="text-sm text-text-secondary mb-4">{{ mainGuest.name }}, tu registro fue recibido. Te esperamos el {{ reservation.checkIn }}.</p>
          <div class="bg-surface rounded-xl p-3 text-xs text-text-secondary">
            Recibirás los códigos de acceso el día de tu llegada.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { http } from '@/services/http'
import Icon from '@/components/ui/Icon.vue'

const route = useRoute()
const hash = computed(() => (route.params.hash as string) || (route.query.hash as string) || '')

const MAX_COMPANIONS = 8

// ── Carga inicial de la reserva ──
const loadingReservation = ref(true)
const loadError = ref('')
const error = ref('')

const reservation = reactive({
  hotelName: '',
  roomNumber: '',
  checkIn: '',
  checkOut: '',
  reservationId: '',
})

onMounted(async () => {
  if (!hash.value) { loadError.value = 'Link inválido'; loadingReservation.value = false; return }
  try {
    const data = await http.get<any>(`/public/pre-checkin/${hash.value}`)
    if (!data || data.error) { loadError.value = data?.error || 'Reserva no encontrada'; return }
    reservation.hotelName = data.hotelName || ''
    reservation.roomNumber = data.roomNumber || ''
    reservation.checkIn = String(data.checkIn || '').slice(0, 10)
    reservation.checkOut = String(data.checkOut || '').slice(0, 10)
    reservation.reservationId = data.reservationId || data.id || ''
    mainGuest.name = data.guestName || data.name || ''
    mainGuest.email = data.email || ''
  } catch (e: any) {
    loadError.value = e.message || 'Error al cargar datos de la reserva'
  } finally {
    loadingReservation.value = false
  }
})

// ── Paso actual (1 Reserva · 2 Grupo · 3 Documentos · 4 Contrato+firma · 5 Datos · 6 Procesando · 7 Confirmación) ──
const step = ref(1)

// ── Paso 2 — Grupo ──
interface CompanionForm { name: string; documentNumber: string }
const travelingAlone = ref(true)
const companions = ref<CompanionForm[]>([])

function setTravelingAlone(alone: boolean): void {
  travelingAlone.value = alone
  if (alone) companions.value = []
  else if (!companions.value.length) companions.value.push({ name: '', documentNumber: '' })
}

function goToStep3(): void {
  error.value = ''
  if (!mainGuest.name || mainGuest.name.trim().length < 2) { error.value = 'Ingresá tu nombre completo'; return }
  if (!travelingAlone.value) {
    if (!companions.value.length) { error.value = 'Agregá al menos un acompañante o marcá "Viajo solo/a"'; return }
    if (companions.value.some((c) => !c.name.trim())) { error.value = 'Completá el nombre de cada acompañante'; return }
  }
  step.value = 3
}

// ── Paso 3 — Documentos ──
interface MainGuestForm {
  name: string; email: string; phone: string
  documentType: 'passport' | 'dni' | 'other'
  document: string; nationality: string
  address: string; city: string; country: string
}
const mainGuest = reactive<MainGuestForm>({
  name: '', email: '', phone: '', documentType: 'passport', document: '',
  nationality: '', address: '', city: '', country: '',
})

type DocumentMode = 'choose' | 'scan' | 'manual'
const documentMode = ref<DocumentMode>('choose')
const fileInputRef = ref<HTMLInputElement | null>(null)
const documentFile = ref<File | null>(null)
const documentPhotoDataUrl = ref('')
const ocrStatus = ref<'idle' | 'running' | 'done' | 'error'>('idle')
const ocrMessage = ref('')
const ocrFound = ref(false)

// ── Recorte manual previo al OCR ──
// Una foto de celular sin recortar trae fondo (mesa/mano), reflejo del laminado/holograma
// de la cédula y resolución de varios MP: todo eso degrada mucho la lectura de Tesseract.
// Aislar el documento del resto del cuadro ANTES de correr OCR es la mejora de mayor impacto.
type ScanPhase = 'capture' | 'crop' | 'result'
const scanPhase = ref<ScanPhase>('capture')
const cropCanvasRef = ref<HTMLCanvasElement | null>(null)
const cropImageEl = ref<HTMLImageElement | null>(null)
const cropBox = reactive({ x: 0, y: 0, w: 0, h: 0 })
const CROP_CANVAS_W = 360
const CROP_HANDLE = 16
const CROP_MIN = 40
let cropScale = 1
let cropDrag: { mode: 'move' | 'tl' | 'tr' | 'bl' | 'br'; startX: number; startY: number; box0: { x: number; y: number; w: number; h: number } } | null = null

function resetOcr(): void {
  documentFile.value = null
  documentPhotoDataUrl.value = ''
  ocrStatus.value = 'idle'
  ocrMessage.value = ''
  ocrFound.value = false
  scanPhase.value = 'capture'
  cropImageEl.value = null
}

function drawCrop(): void {
  const canvas = cropCanvasRef.value
  const img = cropImageEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !img || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'rgba(13, 43, 78, 0.55)'
  ctx.fillRect(0, 0, canvas.width, cropBox.y)
  ctx.fillRect(0, cropBox.y + cropBox.h, canvas.width, canvas.height - cropBox.y - cropBox.h)
  ctx.fillRect(0, cropBox.y, cropBox.x, cropBox.h)
  ctx.fillRect(cropBox.x + cropBox.w, cropBox.y, canvas.width - cropBox.x - cropBox.w, cropBox.h)

  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h)

  ctx.fillStyle = '#2BB6A3'
  const corners: Array<[number, number]> = [
    [cropBox.x, cropBox.y],
    [cropBox.x + cropBox.w, cropBox.y],
    [cropBox.x, cropBox.y + cropBox.h],
    [cropBox.x + cropBox.w, cropBox.y + cropBox.h],
  ]
  for (const [cx, cy] of corners) ctx.fillRect(cx - CROP_HANDLE / 2, cy - CROP_HANDLE / 2, CROP_HANDLE, CROP_HANDLE)
}

async function initCrop(dataUrl: string): Promise<void> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('No se pudo leer la imagen'))
    img.src = dataUrl
  })
  cropImageEl.value = img
  cropScale = CROP_CANVAS_W / img.width
  const cropCanvasH = Math.round(img.height * cropScale)
  scanPhase.value = 'crop'
  await nextTick()
  const canvas = cropCanvasRef.value
  if (!canvas) return
  canvas.width = CROP_CANVAS_W
  canvas.height = cropCanvasH
  // Recuadro inicial centrado, proporción ~ID-1 (tarjeta de identidad, 1.586:1), 90% del ancho
  const boxW = CROP_CANVAS_W * 0.9
  const boxH = Math.min(cropCanvasH * 0.9, boxW / 1.586)
  cropBox.x = (CROP_CANVAS_W - boxW) / 2
  cropBox.y = (cropCanvasH - boxH) / 2
  cropBox.w = boxW
  cropBox.h = boxH
  drawCrop()
}

/**
 * Gira la imagen base 90° antes del recorte. Un documento fotografiado de costado (común al
 * sacarle la foto con el celular en la orientación "natural" de la mano) tiene el texto
 * vertical — Tesseract no lo detecta salvo que esté aproximadamente horizontal. Se re-renderiza
 * a un nuevo data URL y se reinicia el recorte sobre esa imagen ya girada (reusa initCrop tal
 * cual, con el recuadro por defecto recentrado).
 */
async function rotateCrop(degrees: 90 | -90): Promise<void> {
  const img = cropImageEl.value
  if (!img) return
  const canvas = document.createElement('canvas')
  canvas.width = img.height
  canvas.height = img.width
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(img, -img.width / 2, -img.height / 2)
  await initCrop(canvas.toDataURL('image/png'))
}

function hitCropHandle(x: number, y: number): 'tl' | 'tr' | 'bl' | 'br' | null {
  const pts: Array<['tl' | 'tr' | 'bl' | 'br', number, number]> = [
    ['tl', cropBox.x, cropBox.y],
    ['tr', cropBox.x + cropBox.w, cropBox.y],
    ['bl', cropBox.x, cropBox.y + cropBox.h],
    ['br', cropBox.x + cropBox.w, cropBox.y + cropBox.h],
  ]
  for (const [name, cx, cy] of pts) {
    if (Math.abs(x - cx) <= CROP_HANDLE && Math.abs(y - cy) <= CROP_HANDLE) return name
  }
  return null
}

function cropCanvasPoint(e: PointerEvent): { x: number; y: number } {
  const canvas = cropCanvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) }
}

function cropPointerDown(e: PointerEvent): void {
  const canvas = cropCanvasRef.value
  if (!canvas) return
  const { x, y } = cropCanvasPoint(e)
  const handle = hitCropHandle(x, y)
  const inside = x >= cropBox.x && x <= cropBox.x + cropBox.w && y >= cropBox.y && y <= cropBox.y + cropBox.h
  if (!handle && !inside) return
  cropDrag = { mode: handle || 'move', startX: x, startY: y, box0: { ...cropBox } }
  canvas.setPointerCapture(e.pointerId)
}

function cropPointerMove(e: PointerEvent): void {
  if (!cropDrag) return
  const canvas = cropCanvasRef.value
  if (!canvas) return
  const { x, y } = cropCanvasPoint(e)
  const b0 = cropDrag.box0

  if (cropDrag.mode === 'move') {
    const dx = x - cropDrag.startX
    const dy = y - cropDrag.startY
    cropBox.x = Math.min(Math.max(0, b0.x + dx), canvas.width - b0.w)
    cropBox.y = Math.min(Math.max(0, b0.y + dy), canvas.height - b0.h)
    drawCrop()
    return
  }

  // Resize: la esquina opuesta a la que se arrastra queda fija como ancla.
  const anchors: Record<'tl' | 'tr' | 'bl' | 'br', { ax: number; ay: number }> = {
    tl: { ax: b0.x + b0.w, ay: b0.y + b0.h },
    tr: { ax: b0.x, ay: b0.y + b0.h },
    bl: { ax: b0.x + b0.w, ay: b0.y },
    br: { ax: b0.x, ay: b0.y },
  }
  const { ax, ay } = anchors[cropDrag.mode]
  const isLeft = cropDrag.mode === 'tl' || cropDrag.mode === 'bl'
  const isTop = cropDrag.mode === 'tl' || cropDrag.mode === 'tr'
  const px = isLeft ? Math.min(x, ax - CROP_MIN) : Math.max(x, ax + CROP_MIN)
  const py = isTop ? Math.min(y, ay - CROP_MIN) : Math.max(y, ay + CROP_MIN)
  const clampedX = Math.max(0, Math.min(px, canvas.width))
  const clampedY = Math.max(0, Math.min(py, canvas.height))

  cropBox.x = Math.min(ax, clampedX)
  cropBox.y = Math.min(ay, clampedY)
  cropBox.w = Math.abs(clampedX - ax)
  cropBox.h = Math.abs(clampedY - ay)
  drawCrop()
}

function cropPointerUp(): void {
  cropDrag = null
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

/**
 * Extrae un posible número de documento de texto OCR crudo. Cubre:
 *  1) Cédula dominicana: 3-7-1 dígitos, con o sin guiones (formato oficial RD).
 *  2) Pasaporte: 1-2 letras + 6-9 dígitos (formato típico de la mayoría de países).
 *  3) Fallback genérico: token alfanumérico de 6-15 caracteres CON al menos un
 *     dígito (evita matchear palabras sueltas del OCR — títulos, "REPÚBLICA", etc.
 *     — que no tienen números). El huésped SIEMPRE revisa/corrige este valor: nunca
 *     se autocompleta en silencio, queda en un input editable.
 */
function extractDocumentNumber(rawText: string): string | null {
  const text = rawText.replace(/\n/g, ' ')
  const cedula = text.match(/\b(\d{3})-?(\d{7})-?(\d)\b/)
  if (cedula) return `${cedula[1]}-${cedula[2]}-${cedula[3]}`
  const passport = text.match(/\b[A-Z]{1,2}\d{6,9}\b/i)
  if (passport) return passport[0].toUpperCase()
  const generic = text.split(/\s+/).find((t) => /^[A-Z0-9]{6,15}$/i.test(t) && /\d/.test(t))
  return generic ? generic.toUpperCase() : null
}

// Downscale a un tamaño manejable para Tesseract + escala de grises + estiramiento de
// contraste (min-max normalization). Esto combate específicamente lo que rompe el OCR en
// una foto de celular real: reflejo del laminado/holograma de la cédula (baja el contraste
// local) y resolución de varios MP (lenta y con ruido de más). No requiere librerías nuevas.
const MAX_OCR_DIM = 1600

function preprocessForOcr(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
  const scale = Math.min(1, MAX_OCR_DIM / Math.max(sourceCanvas.width, sourceCanvas.height))
  const w = Math.max(1, Math.round(sourceCanvas.width * scale))
  const h = Math.max(1, Math.round(sourceCanvas.height * scale))
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) return Promise.reject(new Error('No se pudo preparar la imagen'))
  ctx.drawImage(sourceCanvas, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data
  const gray = new Uint8ClampedArray(w * h)
  let min = 255
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    gray[i / 4] = g
    if (g < min) min = g
    if (g > max) max = g
  }
  const range = Math.max(1, max - min)
  for (let i = 0; i < data.length; i += 4) {
    const stretched = ((gray[i / 4] - min) / range) * 255
    data[i] = data[i + 1] = data[i + 2] = stretched
  }
  ctx.putImageData(imageData, 0, 0)

  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen'))), 'image/png')
  })
}

async function runOcr(image: File | Blob): Promise<void> {
  ocrStatus.value = 'running'
  ocrMessage.value = ''
  ocrFound.value = false
  try {
    // Import dinámico: Tesseract.js (WASM + worker) NUNCA debe ir en el bundle inicial,
    // solo se descarga cuando el huésped efectivamente elige escanear.
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('eng')
    try {
      const { data } = await worker.recognize(image)
      const found = extractDocumentNumber(data.text || '')
      if (found) {
        mainGuest.document = found
        ocrFound.value = true
        ocrMessage.value = 'Detectamos un posible número de documento — revisalo y corregilo si hace falta.'
      } else {
        ocrMessage.value = 'No pudimos leer el número, completalo a mano.'
      }
    } finally {
      await worker.terminate()
    }
    ocrStatus.value = 'done'
  } catch {
    ocrStatus.value = 'error'
    ocrMessage.value = 'No pudimos procesar la imagen. Completá los datos a mano; la foto igual queda guardada.'
  }
}

async function onFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  documentFile.value = file
  ocrStatus.value = 'idle'
  ocrMessage.value = ''
  ocrFound.value = false
  try {
    documentPhotoDataUrl.value = await fileToDataUrl(file)
  } catch {
    error.value = 'No pudimos leer la foto seleccionada'
    return
  }
  try {
    await initCrop(documentPhotoDataUrl.value)
  } catch {
    // Si por lo que sea no se puede armar el recorte (imagen corrupta, etc.), no se bloquea
    // el flujo: se cae al comportamiento anterior, OCR directo sobre la foto completa.
    scanPhase.value = 'result'
    await runOcr(file)
  }
}

async function confirmCrop(): Promise<void> {
  const img = cropImageEl.value
  if (!img) return
  const sx = cropBox.x / cropScale
  const sy = cropBox.y / cropScale
  const sw = cropBox.w / cropScale
  const sh = cropBox.h / cropScale

  const cropped = document.createElement('canvas')
  cropped.width = Math.max(1, Math.round(sw))
  cropped.height = Math.max(1, Math.round(sh))
  const ctx = cropped.getContext('2d')
  scanPhase.value = 'result'
  if (!ctx) {
    ocrStatus.value = 'error'
    ocrMessage.value = 'No pudimos procesar la imagen. Completá los datos a mano; la foto igual queda guardada.'
    return
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cropped.width, cropped.height)

  try {
    const blob = await preprocessForOcr(cropped)
    await runOcr(blob)
  } catch {
    ocrStatus.value = 'error'
    ocrMessage.value = 'No pudimos procesar la imagen. Completá los datos a mano; la foto igual queda guardada.'
  }
}

function goToStep4(): void {
  error.value = ''
  if (documentMode.value === 'choose') { error.value = 'Elegí cómo vas a completar tu documento'; return }
  if (ocrStatus.value === 'running') { error.value = 'Esperá a que termine de leer el documento'; return }
  step.value = 4
}

// ── Paso 4 — Contrato + firma ──
const canvasRef = ref<HTMLCanvasElement | null>(null)
const contractAccepted = ref(false)
const hasSignature = ref(false)
const signatureDataUrl = ref('')
let drawing = false

function canvasPoint(e: PointerEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) }
}

function startDraw(e: PointerEvent): void {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  drawing = true
  const { x, y } = canvasPoint(e, canvas)
  ctx.beginPath()
  ctx.moveTo(x, y)
  canvas.setPointerCapture(e.pointerId)
}

function draw(e: PointerEvent): void {
  if (!drawing) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const { x, y } = canvasPoint(e, canvas)
  ctx.strokeStyle = '#0D2B4E'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineTo(x, y)
  ctx.stroke()
  hasSignature.value = true
}

function endDraw(): void {
  drawing = false
}

function clearSignature(): void {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  hasSignature.value = false
  signatureDataUrl.value = ''
}

// Al volver al paso 4 con una firma ya guardada, se redibuja (el <canvas> se remonta vacío
// porque el template usa v-if por paso).
watch(step, async (s) => {
  if (s === 4 && signatureDataUrl.value) {
    await nextTick()
    const canvas = canvasRef.value
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    img.src = signatureDataUrl.value
  }
})

function goToStep5(): void {
  error.value = ''
  if (!hasSignature.value) { error.value = 'Firmá en el recuadro antes de continuar'; return }
  if (!contractAccepted.value) { error.value = 'Debés aceptar las normas del establecimiento'; return }
  const canvas = canvasRef.value
  if (canvas) signatureDataUrl.value = canvas.toDataURL('image/png')
  step.value = 5
}

// ── Paso 5 — Datos / privacidad ──
const gdprAccepted = ref(false)
const marketingAccepted = ref(false)

// ── Paso 6/7 — Envío real (sin animación fingida: el mensaje refleja el request en vuelo) ──
const processingMessage = ref('')

async function finalizeSubmit(): Promise<void> {
  error.value = ''
  if (!gdprAccepted.value) { error.value = 'Debés autorizar el tratamiento de tus datos'; return }
  if (!signatureDataUrl.value) { error.value = 'Falta la firma'; step.value = 4; return }
  step.value = 6
  try {
    if (documentMode.value === 'scan' && documentPhotoDataUrl.value) {
      processingMessage.value = 'Subiendo documento…'
      await http.post(`/public/pre-checkin/${hash.value}/photo`, { photo: documentPhotoDataUrl.value, fileName: documentFile.value?.name })
    }

    processingMessage.value = 'Enviando datos…'
    const payload: Record<string, unknown> = {
      name: mainGuest.name,
      contractAccepted: contractAccepted.value,
      gdprAccepted: gdprAccepted.value,
      signature: signatureDataUrl.value,
    }
    if (mainGuest.email) payload.email = mainGuest.email
    if (mainGuest.phone) payload.phone = mainGuest.phone
    if (mainGuest.documentType) payload.documentType = mainGuest.documentType
    if (mainGuest.document) payload.document = mainGuest.document
    if (mainGuest.nationality) payload.nationality = mainGuest.nationality
    if (mainGuest.address) payload.address = mainGuest.address
    if (mainGuest.city) payload.city = mainGuest.city
    if (mainGuest.country) payload.country = mainGuest.country
    if (marketingAccepted.value) payload.marketingAccepted = true
    if (!travelingAlone.value && companions.value.length) {
      payload.companions = companions.value.map((c) => ({ name: c.name, documentNumber: c.documentNumber || '' }))
    }

    await http.post(`/public/pre-checkin/${hash.value}`, payload)
    step.value = 7
  } catch (e: any) {
    error.value = e.message || 'No pudimos completar el check-in. Intentá de nuevo.'
    step.value = 5
  }
}
</script>
