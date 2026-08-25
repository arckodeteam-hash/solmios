<template>
  <!-- Tab "Motor de reservas" de Página pública (pages/pagina-publica/index.vue).
       Antes página propia con su propio header/logo; ahora vive embebida como las
       demás hermanas de tab — mismo patrón h2+subtítulo+acciones que general.vue/
       apariencia.vue, sin el chrome de página completa (min-h-screen, logo "S"). -->
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Motor de reservas</h2>
        <p class="text-sm text-text-muted mt-0.5">Google Hotel Ads · Widget web embebible en tu sitio</p>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="!configLoaded" class="text-xs font-bold px-3 py-1 rounded-full bg-gray-100 text-gray-500">
          ● Cargando…
        </span>
        <!-- FIX 2026-07-31 — QA encontró que esto era un badge de SOLO LECTURA: el toggle
             "Activo/Inactivo" ahora sí apaga/prende el motor público (ver public-rates.ts),
             pero no había forma de cambiarlo desde la UI. Ahora es clickeable — como el resto
             del form, requiere "Guardar" para persistir (sin autosave sorpresa). -->
        <button
          v-else
          type="button"
          @click="form.enabled = !form.enabled"
          :title="form.enabled ? 'Click para desactivar el motor de reservas' : 'Click para activar el motor de reservas'"
          class="text-xs font-bold px-3 py-1 rounded-full cursor-pointer transition-colors"
          :class="form.enabled ? 'bg-teal/10 text-teal hover:bg-teal/20' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'"
        >
          ● {{ form.enabled ? 'Activo' : 'Inactivo' }}
        </button>
        <button @click="saveConfig" :disabled="saving || !configLoaded" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50">
          {{ saving ? 'Guardando...' : 'Guardar' }}
        </button>
        <button @click="verWidget" class="px-4 py-2 bg-cyan text-navy text-sm font-bold rounded-xl cursor-pointer">
          Ver Widget
        </button>
      </div>
    </div>

    <!-- ═══ Widget embebible — CTA principal (prominente, arriba) ═══
         Antes enterrado al final del sidebar. Ahora es lo primero que ve
         el admin: cómo integrar el motor en su web. -->
    <SectionCard
        title="Integrá el widget en tu sitio web"
        subtitle="Pegá este código en el HTML de tu web, antes de cerrar </body>"
        body-class="p-5"
      >
        <template #actions>
          <span
            class="rounded-full px-3 py-1 text-[11px] font-bold whitespace-nowrap"
            :class="hotelSlug ? 'bg-teal/10 text-teal' : 'bg-warning/15 text-warning'"
          >
            {{ hotelSlug ? `Slug: ${hotelSlug}` : 'Falta configurar el slug' }}
          </span>
        </template>

        <!-- Aviso si no hay slug: el snippet no funciona sin él. -->
        <div v-if="!hotelSlug" class="mb-4 rounded-xl bg-warning/10 border border-warning/30 p-3 text-xs text-navy leading-relaxed">
          <strong>Antes necesitás tu slug público.</strong>
          Andá a
          <router-link :to="{ path: '/panel/pagina-publica', query: { tab: 'general' } }" class="font-bold text-cyan hover:underline">Página pública → General</router-link>
          y configurá la URL de tu hotel. Sin slug, el widget no sabe qué hotel mostrar.
        </div>

        <div class="grid lg:grid-cols-[1fr_auto] gap-4 items-stretch">
          <!-- Snippet -->
          <div class="bg-navy rounded-xl p-4 overflow-x-auto">
            <code class="text-[11px] text-white/85 whitespace-pre leading-relaxed">{{ embedCode }}</code>
          </div>
          <!-- Copy + preview -->
          <div class="flex lg:flex-col gap-2 lg:w-44">
            <button
              @click="copyCode"
              class="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-cyan text-navy text-xs font-extrabold rounded-xl hover:shadow-lg transition-all cursor-pointer"
            >
              <span v-if="copied" class="w-3 h-3" v-html="ICON_CHECK"></span>
              {{ copied ? 'Copiado' : 'Copiar código' }}
            </button>
            <button
              @click="verWidget"
              :disabled="!hotelSlug"
              class="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 py-2.5 px-4 bg-surface text-navy text-xs font-bold rounded-xl hover:bg-navy hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Ver demo ↗
            </button>
          </div>
        </div>

        <p class="mt-3 text-[11px] text-text-muted leading-relaxed">
          El widget carga el motor de reservas de tu hotel (búsqueda → selección → pago) embebido en
          tu propia web. Funciona en cualquier sitio (HTML, WordPress, Wix, etc.) — solo necesitás
          acceso para pegar el código.
        </p>
      </SectionCard>

      <!-- ═══ KPIs — con empty state cuando el motor está activo pero sin tráfico ═══ -->
      <div v-if="kpisHaveData" class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-white rounded-xl p-4 border border-border">
          <div class="text-[10px] font-bold text-text-muted uppercase">Búsquedas</div>
          <div class="text-2xl font-black text-navy mt-1">{{ analytics?.totalSearches ?? 0 }}</div>
          <div class="text-[10px] text-teal font-bold mt-1">últimos 30 días</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-border">
          <div class="text-[10px] font-bold text-text-muted uppercase">Reservas Directas</div>
          <div class="text-2xl font-black text-navy mt-1">{{ analytics?.totalBookings ?? 0 }}</div>
          <div class="text-[10px] text-teal font-bold mt-1">{{ (analytics?.conversionRate ?? 0).toFixed(1) }}% conversión</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-border">
          <div class="text-[10px] font-bold text-text-muted uppercase">Ingresos Directos</div>
          <div class="text-2xl font-black text-navy mt-1">${{ (analytics?.totalRevenue ?? 0).toLocaleString() }}</div>
          <div class="text-[10px] text-teal font-bold mt-1">sin comisiones OTA</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-border">
          <div class="text-[10px] font-bold text-text-muted uppercase">Ticket Promedio</div>
          <div class="text-2xl font-black text-teal mt-1">${{ (analytics?.averageBookingValue ?? 0).toLocaleString() }}</div>
          <div class="text-[10px] text-teal font-bold mt-1">por reserva</div>
        </div>
      </div>
      <SectionCard
        v-else
        title="Tu motor está activo"
        body-class="p-0"
      >
        <EmptyState
          :icon="ICON_CHECK_CIRCLE"
          title="Tu motor está activo"
          message="Cuando recibas las primeras búsquedas, acá vas a ver las estadísticas: búsquedas, reservas, ingresos y conversión. Mientras tanto, integrá el widget en tu web (arriba) para empezar a recibir tráfico."
        />
      </SectionCard>

      <!-- ═══ F4 4.1 (D13) — Funnel de conversión real desde tracking_events. ═══ -->
      <SectionCard
        title="Funnel de Conversión"
        subtitle="Vista → Búsqueda → Selección → Upsell → Form → Pago → Confirmación"
        body-class="p-0"
      >
        <div v-if="funnelHasData" class="p-5 space-y-3">
          <div v-for="(step, idx) in funnelRows" :key="step.step">
            <div class="flex items-center gap-3 mb-1.5">
              <div class="w-6 h-6 rounded-full bg-navy text-white text-[10px] font-black grid place-items-center flex-shrink-0">{{ idx + 1 }}</div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-bold text-navy truncate">{{ step.label }}</div>
              </div>
              <div class="text-right">
                <div class="text-sm font-black text-navy tabular-nums">{{ step.count.toLocaleString() }}</div>
                <div v-if="step.dropOff !== null" class="text-[10px] font-bold tabular-nums"
                  :class="dropOffColor(step.dropOff)">
                  {{ step.dropOff }}% avanza
                </div>
                <div v-else class="text-[10px] font-bold text-text-muted">step final</div>
              </div>
            </div>
            <div class="ml-9 h-2 bg-surface rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500"
                :class="funnelBarColor(idx)"
                :style="{ width: `${funnelBarWidth(step.count)}%` }"></div>
            </div>
          </div>
        </div>
        <EmptyState
          v-else
          :icon="ICON_CHART"
          title="Sin datos de funnel todavía"
          message="Los eventos del widget (vista, búsqueda, selección, pago) se acumulan acá a medida que los huéspedes navegan el motor de reservas. Hacé una reserva de prueba para ver el funnel poblarse."
        />
      </SectionCard>

      <div class="grid lg:grid-cols-3 gap-6">
        <!-- Widget Config -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Loading / error / form.
               Config puede llegar null si falla la red: antes los bindings `config!.X`
               crasheaban el panel entero. Ahora el form solo renderiza con datos reales
               cargados en `form` (reactive, siempre non-null); si cae, EmptyState con retry. -->
          <div v-if="configLoaded" class="bg-white rounded-2xl border border-border p-6">
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-black text-navy">Configuración del Widget</h2>
            </div>

            <div class="grid md:grid-cols-2 gap-6">
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Color de acento del widget</label>
                <!-- Tarea 3.4 (corrección 2026-08-25) — antes decía "Tema del Widget" con
                     opciones "Claro"/"Oscuro" que no hacían nada, y ni siquiera hubieran
                     podido: el widget mezcla clases de color propias del proyecto con paleta
                     cruda de Tailwind, invertir fondo/texto de verdad exige migrar ~8
                     archivos (ver tasks.md 3.4). Alcance real, decidido con el dueño del
                     producto: el color del botón principal/CTA cambia, el resto del widget
                     (fondos, bordes, textos) se mantiene igual siempre. -->
                <div class="grid grid-cols-3 gap-2">
                  <button
                    v-for="theme in themes"
                    :key="theme.id"
                    type="button"
                    @click="form.theme = theme.id"
                    class="p-3 rounded-xl border-2 text-center transition-all cursor-pointer"
                    :class="form.theme === theme.id ? 'border-cyan bg-cyan/5' : 'border-border hover:border-gray-300'"
                  >
                    <div class="w-6 h-6 rounded-full mx-auto mb-1" :class="theme.color"></div>
                    <div class="text-[10px] font-bold">{{ theme.name }}</div>
                  </button>
                </div>
                <p class="mt-1 text-[10px] text-text-muted">Solo cambia el color del botón principal del widget — el resto queda igual.</p>
              </div>

              <div>
                <label for="booking-engine-posicion-en-la-web" class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Posición en la Web</label>
                <select id="booking-engine-posicion-en-la-web" name="position" v-model="form.position" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan cursor-pointer">
                  <option value="corner">Esquina inferior derecha</option>
                  <option value="center">Centro de pantalla</option>
                  <option value="inline">Integrado en página</option>
                  <option value="popup">Popup al cargar</option>
                </select>
                <!-- Tarea 3.4 (corrección 2026-08-25) — este dato va HORNEADO en el snippet
                     (`data-position`, ver embedCode), no se lee en vivo del backend: cambiar
                     la posición acá requiere volver a copiar/pegar el código de abajo en el
                     sitio del hotel para que tome efecto — mismo criterio que ya aplica si
                     cambia el slug. -->
                <p class="mt-1 text-[10px] text-text-muted">Guardá y volvé a copiar el código de abajo para que el cambio se vea en tu sitio.</p>
              </div>

              <div>
                <label for="booking-engine-moneda" class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Moneda por defecto del widget</label>
                <!-- Tarea 3.4 (corrección 2026-08-25) — el huésped puede cambiarla desde el
                     switcher del widget; esto solo decide con QUÉ arranca. NO es la moneda de
                     cobro del hotel (esa es `hotels.currency`, se configura en Ajustes). -->
                <select id="booking-engine-moneda" name="currency" v-model="form.currency" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan cursor-pointer">
                  <option value="USD">USD - Dólar</option>
                  <option value="DOP">DOP - Peso Dominicano</option>
                  <option value="MXN">MXN - Peso Mexicano</option>
                  <option value="COP">COP - Peso Colombiano</option>
                  <option value="EUR">EUR - Euro</option>
                </select>
              </div>

              <div>
                <label for="booking-engine-idioma" class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Idioma por defecto del widget</label>
                <!-- Tarea 3.4 (corrección 2026-08-25) — 'fr' se sacó a propósito: el widget
                     (useBookingI18n.ts) solo traduce es/en/pt. Ofrecerlo acá era el mismo bug
                     que se está cerrando en esta tarea (una opción que no hace nada), solo que
                     para francés en vez de para los 4 controles originales. -->
                <select id="booking-engine-idioma" name="language" v-model="form.language" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan cursor-pointer">
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="pt">Português</option>
                </select>
              </div>
            </div>

            <!-- FIX 2026-07-31 — antes minNights/maxNights/cancellationPolicy se guardaban
                 (defaults 1/30/'') pero NO había ningún input para cambiarlos: el backend ya
                 los hacía cumplir (ver public-rates.ts) pero el admin no tenía forma de
                 configurarlos. -->
            <div class="mt-6 pt-6 border-t border-border">
              <label class="text-[10px] font-bold text-text-muted uppercase mb-3 block">Reglas de estadía</label>
              <div class="grid md:grid-cols-2 gap-6">
                <div>
                  <label for="booking-engine-minimo-de-noches" class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Mínimo de noches</label>
                  <input id="booking-engine-minimo-de-noches" name="minNights"
                    v-model.number="form.minNights"
                    type="number"
                    min="1"
                    class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan"
                  />
                </div>
                <div>
                  <label for="booking-engine-maximo-de-noches" class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Máximo de noches</label>
                  <input id="booking-engine-maximo-de-noches" name="maxNights"
                    v-model.number="form.maxNights"
                    type="number"
                    min="1"
                    class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan"
                  />
                </div>
              </div>
              <!-- F3 (#627): editor estructurado de políticas de cancelación (base + overrides).
                   Reemplaza al textarea libre: el merchant arma niveles de penalidad por hora/%.
                   El textarea libre queda como "Texto display opcional" colapsable abajo (fallback
                   para hoteles que solo quieren mostrar un texto, sin motor de penalidades). -->
              <div class="mt-4">
                <label class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Política de cancelación</label>
                <div class="rounded-xl border border-border p-4">
                  <CancellationPolicyEditor :hotel-id="hotelId" />
                </div>
              </div>

              <!-- tasks.md 2.2/2.4 (solmi-direct-booking-qa-fixes) — Regímenes de alimentación:
                   catálogo fijo de 3 códigos (antes era un placeholder decorativo en el widget,
                   ver RoomsStep.vue/BookingModal.vue). Mismo lugar de embed que la política de
                   cancelación de arriba: ambas son "condiciones de la reserva" que configura el
                   dueño del motor de reservas. -->
              <div class="mt-4">
                <label class="text-[10px] font-bold text-text-muted uppercase mb-2 block">Regímenes de alimentación</label>
                <div class="rounded-xl border border-border p-4">
                  <MealPlansEditor />
                </div>
              </div>

              <!-- Texto display opcional (fallback). Colapsado por defecto; si ya tenía contenido
                   se muestra expandido para no esconder data existente del merchant. -->
              <div class="mt-3">
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-[11px] font-bold text-text-muted hover:text-navy cursor-pointer"
                  @click="showPolicyText = !showPolicyText"
                >
                  <span class="transition-transform" :class="showPolicyText ? 'rotate-90' : ''">▶</span>
                  Texto display opcional
                  <span v-if="form.cancellationPolicy" class="text-[9px] text-teal font-bold">(definido)</span>
                </button>
                <div v-if="showPolicyText" class="mt-2">
                  <textarea id="booking-engine-cancellation-policy" name="cancellationPolicy" aria-label="Ej: Cancelación gratis hasta 48h antes del check-in"
                    v-model="form.cancellationPolicy"
                    rows="2"
                    placeholder="Ej: Cancelación gratis hasta 48h antes del check-in."
                    class="w-full px-4 py-2 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan resize-none"
                  />
                  <p class="mt-1 text-[10px] text-text-muted">
                    Texto libre que se muestra al huésped en el motor de reservas. No afecta el cálculo de penalidades.
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-6 pt-6 border-t border-border">
              <label class="text-[10px] font-bold text-text-muted uppercase mb-3 block">Opciones de Reserva</label>
              <div class="grid md:grid-cols-2 gap-3">
                <label class="flex items-center gap-3 p-3 bg-surface rounded-xl cursor-pointer">
                  <input id="booking-engine-confirmacion-instantanea-sin-intervencion" name="instantConfirmation" type="checkbox" v-model="form.instantConfirmation" class="w-4 h-4 text-cyan rounded" />
                  <div>
                    <div class="text-sm font-bold text-navy">Confirmación Instantánea</div>
                    <div class="text-[10px] text-text-muted">Sin intervención manual</div>
                  </div>
                </label>
                <!-- FIX 2026-07-31 — googleAdsEnabled/whatsappConfirmation se guardaban pero no
                     existe ninguna integración real detrás (sin feed de Google Hotel Ads, sin
                     WhatsApp Business API conectado — deuda documentada en CLAUDE.md). Prenderlos
                     no hacía nada; mejor avisar "Próximamente" que mentirle al merchant. -->
                <label class="flex items-center gap-3 p-3 bg-surface rounded-xl opacity-60 cursor-not-allowed" title="Todavía no hay integración real detrás de esta opción">
                  <input id="booking-engine-google-hotel-ads-sincronizar" type="checkbox" disabled class="w-4 h-4 rounded" />
                  <div>
                    <div class="text-sm font-bold text-navy">Google Hotel Ads</div>
                    <div class="text-[10px] text-text-muted">Sincronizar tarifas — Próximamente</div>
                  </div>
                </label>
                <label class="flex items-center gap-3 p-3 bg-surface rounded-xl opacity-60 cursor-not-allowed" title="Requiere conectar WhatsApp Business API">
                  <input id="booking-engine-confirmacion-whats-app-envio" type="checkbox" disabled class="w-4 h-4 rounded" />
                  <div>
                    <div class="text-sm font-bold text-navy">Confirmación WhatsApp</div>
                    <div class="text-[10px] text-text-muted">Envío automático — Próximamente</div>
                  </div>
                </label>
                <label class="flex items-center gap-3 p-3 bg-surface rounded-xl cursor-pointer">
                  <input id="booking-engine-comparar-con-otas-mostrar" name="showComparison" type="checkbox" v-model="form.showComparison" class="w-4 h-4 text-cyan rounded" />
                  <div>
                    <div class="text-sm font-bold text-navy">Comparar con OTAs</div>
                    <div class="text-[10px] text-text-muted">Mostrar ahorro vs Booking/Expedia</div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <!-- Error de carga de config: EmptyState con retry (no mostramos form con defaults). -->
          <SectionCard v-else-if="loadError" title="Configuración del Widget" body-class="p-0">
            <EmptyState
              :icon="ICON_WARNING"
              title="No pudimos cargar la configuración"
              :message="loadError"
            >
              <template #action>
                <button
                  type="button"
                  @click="loadAll"
                  class="rounded-full bg-navy px-5 py-2 text-sm font-bold text-white hover:shadow-lg cursor-pointer"
                >
                  Reintentar
                </button>
              </template>
            </EmptyState>
          </SectionCard>

          <!-- Loading skeleton -->
          <div v-else class="bg-white rounded-2xl border border-border p-6">
            <div class="h-6 w-48 bg-surface rounded animate-pulse mb-6"></div>
            <div class="grid md:grid-cols-2 gap-6">
              <div v-for="i in 4" :key="i" class="h-10 bg-surface rounded-xl animate-pulse"></div>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="space-y-6">
          <!-- Widget Preview -->
          <div class="bg-white rounded-2xl border border-border p-6">
            <h3 class="text-sm font-black text-navy mb-3">Vista Previa</h3>
            <div class="aspect-video bg-surface rounded-xl flex items-center justify-center border border-border">
              <div class="text-center">
                <div class="w-8 h-8 mx-auto mb-2 text-text-muted" v-html="ICON_WIDGET"></div>
                <div class="text-xs text-text-muted">Widget Preview</div>
                <button @click="verWidget" class="mt-2 text-[10px] font-bold text-cyan hover:underline">Abrir widget →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { BookingEngineService, type BookingConfig, type BookingAnalytics, type FunnelStep } from '@/services/BookingEngine.service'
import { http } from '@/services/http'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import CancellationPolicyEditor from '@/components/booking/CancellationPolicyEditor.vue'
import MealPlansEditor from '@/components/booking/MealPlansEditor.vue'
import { ICON_CHECK, ICON_CHECK_CIRCLE, ICON_CHART, ICON_WARNING, ICON_WIDGET } from '@/components/landing/landing-icons'

const auth = useAuthStore()
const toast = useToast()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

// ─── Config: form reactivo SIEMPRE non-null (defaults) + bandera de carga ──
// Antes `config` era `ref<BookingConfig | null>(null)` y los bindings `config!.X`
// crasheaban si la red fallaba. Ahora el form parte de defaults concretos y se
// hidrata al cargar; `configLoaded` separa "tengo datos reales" de "estoy mostrando
// defaults", así el form nunca se renderiza con datos inválidos.
const configLoaded = ref(false)
const loadError = ref('')
const saving = ref(false)
const copied = ref(false)
// F3 (#627): el textarea "Texto display opcional" arranca colapsado; si el hotel ya tenía
// un cancellationPolicy definido, se expande al cargar para no esconder data existente.
const showPolicyText = ref(false)
// F2 2.11-2.13 (solmi-direct-booking): el snippet embebible y la URL del widget usan
// el SLUG público del hotel, no el hotelId. Si el hotel no tiene slug todavía (alta
// pre-seeder), el snippet muestra un placeholder y el CTA "Ver demo" se deshabilita.
const hotelSlug = ref<string>('')

function defaultConfig(): BookingConfig {
  return {
    id: '',
    hotelId: '',
    enabled: false,
    theme: 'navy',
    position: 'corner',
    currency: 'USD',
    language: 'es',
    minNights: 1,
    maxNights: 30,
    cancellationPolicy: '',
    showComparison: false,
    googleAdsEnabled: false,
    whatsappConfirmation: false,
    instantConfirmation: false,
    stripeAccountId: '',
    allowedCountries: [],
  }
}

// Form editable (reactive). Siempre non-null → los v-model del template son seguros.
const form = reactive<BookingConfig>(defaultConfig())

const analytics = ref<BookingAnalytics | null>(null)

// Tiempo que el botón "Copiar código" muestra el check de confirmación (UX micro-timing).
const COPY_FEEDBACK_MS = 2000

// ─── KPIs — "motor activo sin tráfico" se ve como EmptyState, no como ceros rotos ─
const kpisHaveData = computed(() =>
  (analytics.value?.totalSearches ?? 0) > 0 || (analytics.value?.totalBookings ?? 0) > 0,
)

// F4 4.1 (D13) — Funnel de conversión desde tracking_events.
const funnelRows = computed<FunnelStep[]>(() => analytics.value?.funnel ?? [])
const funnelHasData = computed(() => funnelRows.value.some((s) => s.count > 0))
const funnelMax = computed(() => Math.max(1, ...funnelRows.value.map((s) => s.count)))
function funnelBarWidth(count: number): number {
  return Math.max(2, Math.round((count / funnelMax.value) * 100))
}
function funnelBarColor(idx: number): string {
  const colors = ['bg-navy', 'bg-navy', 'bg-cyan', 'bg-cyan', 'bg-teal', 'bg-teal', 'bg-teal']
  return colors[idx] ?? 'bg-navy'
}
function dropOffColor(pct: number): string {
  if (pct >= 70) return 'text-teal'
  if (pct >= 40) return 'text-gold'
  return 'text-rose'
}

// Tarea 3.4 (corrección 2026-08-25) — 'white'/'dark' se renombraron a 'gold'/'coral': con el
// alcance real (solo el color del botón cambia, ver ACCENT_PRESETS en booking-widget.vue),
// "Claro"/"Oscuro" prometían una inversión de fondo que este alcance no hace. Una fila vieja
// con 'white'/'dark' guardada antes de este cambio no rompe — el widget simplemente no
// encuentra el preset y se ve con sus colores de siempre (mismo criterio "sin match = sin
// override" que ya usa `resolveStayLimits` del lado del backend).
const themes = [
  { id: 'navy', name: 'Navy', color: 'bg-navy' },
  { id: 'cyan', name: 'Cyan', color: 'bg-cyan' },
  { id: 'teal', name: 'Teal', color: 'bg-teal' },
  { id: 'gold', name: 'Dorado', color: 'bg-gold' },
  { id: 'coral', name: 'Coral', color: 'bg-coral' },
]

// Tarea 3.4 (corrección 2026-08-25) — `data-position` viaja HORNEADO en el snippet, no vía
// fetch en runtime: `widget/loader.js` es un script standalone sin dependencias que corre en
// sitios de TERCEROS, así que un round-trip extra al backend solo para saber "dónde pintarme"
// sería un costo de carga en la web del hotel por un dato que casi nunca cambia. Mismo patrón
// que usan snippets de Analytics/Stripe: si el hotelero cambia "Posición en la Web" en este
// panel, tiene que volver a copiar/pegar el snippet actualizado — igual que ya pasaba con
// `data-hotel` si cambiara el slug. Ver `loader.js` para el detalle de qué hace cada valor.
const embedCode = computed(() =>
  `<script src="${window.location.origin}/widget/loader.js"\n` +
  `  data-hotel="${hotelSlug.value || 'SLUG-DEL-HOTEL'}"\n` +
  `  data-position="${form.position || 'inline'}">\n` +
  `<\/script>`
)

async function saveConfig() {
  if (!configLoaded.value) return
  saving.value = true
  try {
    const updated = await BookingEngineService.updateConfig(form)
    // El backend puede normalizar/normalizar campos: reflotar el form con la respuesta.
    Object.assign(form, updated)
    toast.success('Configuración guardada')
  } catch {
    toast.error('Error al guardar')
  } finally {
    saving.value = false
  }
}

function verWidget() {
  if (!hotelSlug.value) {
    toast.error('Definí el slug del hotel en Página pública → General')
    return
  }
  // F2 2.13: abrimos el widget en modo embed (mismo layout que tendría embebido en sitio externo).
  window.open(`/book/${encodeURIComponent(hotelSlug.value)}?embed=1`, '_blank')
}

function copyCode() {
  navigator.clipboard.writeText(embedCode.value)
  copied.value = true
  setTimeout(() => (copied.value = false), COPY_FEEDBACK_MS)
}

async function loadAll() {
  loadError.value = ''
  configLoaded.value = false
  try {
    const tasks: Promise<unknown>[] = [
      BookingEngineService.getConfig(),
      BookingEngineService.getAnalytics(),
    ]
    if (hotelId.value) {
      tasks.push(http.get<{ slug?: string }>(`/hoteles/${hotelId.value}`))
    }
    const [cfg, stats, hotel] = await Promise.all(tasks) as [BookingConfig, BookingAnalytics, { slug?: string } | undefined]
    // Hidratar el form reactivo (NO pisar la referencia: tablas reactivas se mutan).
    Object.assign(form, cfg)
    showPolicyText.value = !!form.cancellationPolicy
    analytics.value = stats
    if (hotel && typeof hotel.slug === 'string' && hotel.slug.trim() !== '') {
      hotelSlug.value = hotel.slug.trim()
    }
    configLoaded.value = true
  } catch (e) {
    // Sin config: dejamos el form con defaults pero NO marcamos como cargado → EmptyState con retry.
    loadError.value = (e as Error)?.message || 'No pudimos cargar la configuración del motor.'
  }
}

onMounted(loadAll)
</script>
