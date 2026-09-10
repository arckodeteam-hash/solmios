<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-black text-navy">Anuncios & Comunicados</h2>
        <p class="text-sm text-text-muted mt-0.5">Envía mensajes a los hoteles de la plataforma</p>
      </div>
      <button @click="abrirNuevo()" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-xl hover:bg-navy-light transition-colors cursor-pointer flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        Nuevo Anuncio
      </button>
    </div>

    <!-- Sent Announcements -->
    <div class="bg-white rounded-2xl border border-border overflow-hidden mb-6">
      <div class="px-5 py-4 bg-navy">
        <h3 class="font-extrabold text-white text-sm">Anuncios Enviados</h3>
      </div>
      <SkeletonLoader v-if="loading" variant="table" :rows="5" class="p-4" />
      <EmptyState
        v-else-if="announcements.length === 0"
        title="Todavía no publicaste ningún anuncio"
        message="Un anuncio aparece como una franja arriba del panel de los hoteles que elijas."
      />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px] tbl-head">
          <thead>
            <tr class="border-b border-border">
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Título</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Tipo</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Audiencia</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Vigencia</th>
              <th class="text-right py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Leído por</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
              <th class="text-right py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ann in announcements" :key="ann.id" class="border-b border-border/50 hover:bg-surface/50 transition-colors">
              <td class="py-3 px-4">
                <div class="text-sm font-bold text-navy">{{ ann.title }}</div>
                <div v-if="ann.excerpt" class="text-[10px] text-text-muted truncate max-w-[250px]">{{ ann.excerpt }}</div>
              </td>
              <td class="py-3 px-4">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="ann.typeClass">{{ ann.type }}</span>
              </td>
              <td class="py-3 px-4">
                <span class="text-xs text-navy">{{ ann.audience }}</span>
              </td>
              <td class="py-3 px-4 text-xs text-text-muted whitespace-nowrap">{{ ann.vigencia }}</td>
              <td class="py-3 px-4 text-right">
                <div class="text-sm font-bold text-navy tabular-nums">{{ ann.seenCount }} / {{ ann.recipients }}</div>
                <div class="text-[9px] text-text-muted tabular-nums">{{ ann.openRate }}</div>
              </td>
              <td class="py-3 px-4">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="ann.statusClass">{{ ann.status }}</span>
              </td>
              <td class="py-3 px-4 text-right whitespace-nowrap">
                <button type="button" class="text-[10px] font-bold text-cyan hover:underline cursor-pointer mr-2" @click="verAnuncio(ann)">Ver</button>
                <button type="button" :disabled="borrandoId === ann.id"
                  class="text-[10px] font-bold text-coral hover:underline cursor-pointer disabled:opacity-40"
                  @click="pedirBorrado(ann)">{{ borrandoId === ann.id ? 'Borrando…' : 'Eliminar' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Audience Stats -->
    <div class="grid md:grid-cols-3 gap-6">
      <SectionCard title="Alcance">
        <SkeletonLoader v-if="loading" variant="table" :rows="3" />
        <div v-else class="space-y-3">
          <div class="flex justify-between">
            <span class="text-xs text-text-muted">Hoteles totales</span>
            <span class="text-xs font-bold text-navy tabular-nums">{{ reach?.hotels ?? '—' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-xs text-text-muted">Usuarios activos</span>
            <span class="text-xs font-bold text-navy tabular-nums">{{ reach?.users ?? '—' }}</span>
          </div>
          <div v-if="reach?.lastAnnouncement" class="pt-3 border-t border-border">
            <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1">Último anuncio difundido</div>
            <div class="text-xs font-bold text-navy truncate">{{ reach.lastAnnouncement.title }}</div>
            <div class="flex justify-between mt-1.5">
              <span class="text-xs text-text-muted">Tasa de apertura</span>
              <span class="text-xs font-bold tabular-nums" :class="reach.lastAnnouncement.openRate === null ? 'text-text-muted' : 'text-teal'">
                {{ reach.lastAnnouncement.openRate === null ? 'sin datos' : `${reach.lastAnnouncement.openRate}%` }}
              </span>
            </div>
            <div class="text-[10px] text-text-muted mt-0.5 tabular-nums">
              {{ reach.lastAnnouncement.seenCount }} de {{ reach.lastAnnouncement.recipients }} destinatarios
            </div>
          </div>
          <p v-else class="pt-3 border-t border-border text-xs text-text-muted">
            Todavía no difundiste ningún anuncio a varios hoteles.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Plantillas Guardadas">
        <template #actions>
          <button type="button" class="text-[10px] font-bold text-white/80 hover:text-white cursor-pointer" @click="guardarComoPlantilla">
            Guardar la última como plantilla
          </button>
        </template>
        <div class="space-y-2">
          <div v-for="(tpl, i) in templates" :key="tpl.name" class="p-2 bg-surface rounded-lg flex items-center gap-2">
            <button type="button" class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer" @click="usarPlantilla(tpl)">
              <span class="text-lg">{{ tpl.icon }}</span>
              <span class="min-w-0">
                <span class="block text-xs font-bold text-navy truncate">{{ tpl.name }}</span>
                <span class="block text-[9px] text-text-muted truncate">{{ tpl.description }}</span>
              </span>
            </button>
            <button type="button" class="text-[10px] font-bold text-coral hover:underline cursor-pointer shrink-0" @click="borrarPlantilla(i)">Quitar</button>
          </div>
          <p v-if="templates.length === 0" class="text-center text-xs text-text-muted py-4">
            Sin plantillas. Escribí un anuncio y guardalo acá para reutilizarlo.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Programación">
        <div class="space-y-3">
          <div v-for="sched in scheduled" :key="sched.id" class="bg-surface rounded-xl p-3">
            <div class="text-xs font-bold text-navy truncate">{{ sched.title }}</div>
            <div class="flex justify-between text-[10px] mt-1">
              <span class="text-text-muted">Se publica el {{ sched.startsAt }}</span>
              <span class="text-teal font-bold">{{ sched.audience }}</span>
            </div>
          </div>
          <div v-if="scheduled.length === 0" class="text-center text-sm text-text-muted py-4">No hay anuncios programados</div>
        </div>
      </SectionCard>
    </div>

    <!-- Create Modal -->
    <AppModal v-if="showCreateModal" size="lg" title="Nuevo Anuncio" @close="showCreateModal = false">
      <div class="space-y-4">
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Título</label>
          <input v-model="draft.title" type="text" placeholder="Ej: ¡Nueva función disponible!" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan" />
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Tipo</label>
          <select v-model="draft.type" class="w-full h-10 px-4 rounded-xl border border-border text-sm cursor-pointer">
            <option v-for="t in TIPOS" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>

        <!-- Audiencia: tres opciones EXCLUYENTES. Antes eran dos checkboxes que se podían marcar
             juntos y no viajaban en el POST: marcar o no marcar daba lo mismo. -->
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Audiencia</label>
          <div class="space-y-2">
            <label v-for="op in AUDIENCIAS" :key="op.value" class="flex items-start gap-2 p-2 bg-surface rounded-lg cursor-pointer">
              <input type="radio" :value="op.value" v-model="draft.audience" class="mt-0.5 w-4 h-4 text-cyan" />
              <span>
                <span class="block text-xs font-bold text-navy">{{ op.label }}</span>
                <span class="block text-[10px] text-text-muted">{{ op.hint }}</span>
              </span>
            </label>
          </div>
          <select v-if="draft.audience === 'hotel'" v-model="draft.hotelId" class="mt-2 w-full h-10 px-4 rounded-xl border border-border text-sm cursor-pointer">
            <option value="">Elegí un hotel…</option>
            <option v-for="h in hoteles" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
        </div>

        <!-- Vigencia -->
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Publicación</label>
          <div class="flex gap-2">
            <label class="flex items-center gap-2 p-2 bg-surface rounded-lg cursor-pointer flex-1">
              <input type="radio" value="ahora" v-model="draft.cuando" class="w-4 h-4 text-cyan" />
              <span class="text-xs font-bold text-navy">Publicar ahora</span>
            </label>
            <label class="flex items-center gap-2 p-2 bg-surface rounded-lg cursor-pointer flex-1">
              <input type="radio" value="programar" v-model="draft.cuando" class="w-4 h-4 text-cyan" />
              <span class="text-xs font-bold text-navy">Programar</span>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2 mt-2">
            <div v-if="draft.cuando === 'programar'">
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Desde</label>
              <input v-model="draft.startsAt" type="datetime-local" class="w-full h-10 px-3 rounded-xl border border-border text-sm" />
            </div>
            <div :class="draft.cuando === 'programar' ? '' : 'col-span-2'">
              <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Hasta (opcional)</label>
              <input v-model="draft.endsAt" type="datetime-local" class="w-full h-10 px-3 rounded-xl border border-border text-sm" />
            </div>
          </div>
          <p class="text-[10px] text-text-muted mt-1">Sin fecha de fin, el anuncio se ve hasta que lo elimines.</p>
        </div>

        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Mensaje</label>
          <textarea v-model="draft.message" rows="4" class="w-full px-4 py-3 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan resize-none" placeholder="Escribe el mensaje del anuncio..."></textarea>
        </div>
      </div>
      <template #footer>
        <button @click="showCreateModal = false" class="px-4 py-2.5 bg-surface text-navy text-sm font-bold rounded-xl cursor-pointer">Cancelar</button>
        <button :disabled="enviando" @click="sendAnnouncement" class="px-4 py-2.5 bg-navy text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50">
          {{ enviando ? 'Publicando…' : (draft.cuando === 'programar' ? 'Programar' : 'Enviar Ahora') }}
        </button>
      </template>
    </AppModal>

    <!-- Detalle -->
    <AppModal v-if="detalle" size="md" :title="detalle.title" @close="detalle = null">
      <div class="space-y-4">
        <p class="whitespace-pre-line text-sm text-text-secondary">{{ detalle.message || 'Este anuncio no tiene cuerpo.' }}</p>
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div class="text-[10px] font-bold uppercase text-text-muted">Destinatarios</div>
            <div class="font-bold text-navy">{{ detalle.audience }}</div>
          </div>
          <div>
            <div class="text-[10px] font-bold uppercase text-text-muted">Estado</div>
            <div class="font-bold text-navy">{{ detalle.status }}</div>
          </div>
          <div>
            <div class="text-[10px] font-bold uppercase text-text-muted">Vigencia</div>
            <div class="font-bold text-navy">{{ detalle.vigencia }}</div>
          </div>
          <div>
            <div class="text-[10px] font-bold uppercase text-text-muted">Leído por</div>
            <div class="font-bold text-navy tabular-nums">{{ detalle.seenCount }} de {{ detalle.recipients }}</div>
          </div>
        </div>
      </div>
      <template #footer>
        <button type="button" class="rounded-xl bg-surface px-4 py-2.5 text-sm font-bold text-text-secondary" @click="detalle = null">Cerrar</button>
      </template>
    </AppModal>

    <!-- Borrar es destructivo: se confirma, no se ejecuta al primer clic -->
    <ConfirmModal
      v-if="aBorrar"
      title="Eliminar anuncio"
      :message="`¿Eliminar «${aBorrar.title}»? Los hoteles dejarán de verlo. No se puede deshacer.`"
      confirm-label="Eliminar"
      danger
      @confirm="confirmarBorrado"
      @close="aBorrar = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useToast } from '@/composables/useToast'
import { PlatformService, ConfigService } from '@/services/Platform.service'
import type { AnnouncementsReach } from '@/services/Platform.service'
import { SuperAdminService } from '@/services/SuperAdmin.service'
import { AnnouncementsService } from '@/services/Announcements.service'
import type { AnnouncementAudience } from '@/services/Announcements.service'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const toast = useToast()
const loading = ref(true)
const showCreateModal = ref(false)

/** Las opciones son EXACTAMENTE el enum que acepta el validador: ninguna devuelve 400. */
const TIPOS = [
  { value: 'feature', label: 'Nueva función' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'promo', label: 'Promoción' },
  { value: 'info', label: 'Informativo' },
  { value: 'warning', label: 'Aviso' },
  { value: 'urgent', label: 'Urgente' },
] as const

const AUDIENCIAS: { value: AnnouncementAudience; label: string; hint: string }[] = [
  { value: 'all', label: 'Todos los hoteles', hint: 'Lo ve cualquier usuario de cualquier hotel.' },
  { value: 'admins', label: 'Solo administradores', hint: 'Todos los hoteles, pero solo los dueños y gerentes.' },
  { value: 'hotel', label: 'Un hotel', hint: 'Solo los usuarios del hotel que elijas.' },
]

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]))
const TYPE_CLASS: Record<string, string> = {
  feature: 'bg-teal/10 text-teal', maintenance: 'bg-gold/10 text-gold', warning: 'bg-gold/10 text-gold',
  urgent: 'bg-coral/10 text-coral', promo: 'bg-navy/10 text-navy', info: 'bg-cyan/10 text-cyan',
}

interface Plantilla { name: string; icon: string; description: string; type: string; message: string }

const announcements = ref<any[]>([])
const scheduled = ref<any[]>([])
const reach = ref<AnnouncementsReach | null>(null)
const hoteles = ref<{ id: string; name: string }[]>([])
const templates = ref<Plantilla[]>([])

function nuevoDraft() {
  return { title: '', type: 'feature', audience: 'all' as AnnouncementAudience, hotelId: '', message: '', cuando: 'ahora', startsAt: '', endsAt: '' }
}
const draft = ref(nuevoDraft())

const fecha = (v?: string) => (v ? String(v).slice(0, 10) : '')

/** Un `datetime-local` no trae zona: se envía como instante para que el servidor no lo interprete mal. */
const aIso = (v: string) => (v ? new Date(v).toISOString() : undefined)

function describirVigencia(a: any): string {
  const desde = fecha(a.startsAt)
  const hasta = fecha(a.endsAt)
  if (desde && hasta) return `${desde} → ${hasta}`
  if (desde) return `desde ${desde}`
  if (hasta) return `hasta ${hasta}`
  return fecha(a.date) || 'permanente'
}

function nombreHotel(id?: string): string {
  if (!id) return ''
  return hoteles.value.find((h) => h.id === id)?.name ?? 'Hotel'
}

/** Qué muestra la columna Audiencia. Nunca un id crudo: el dueño no sabe qué hotel es un UUID. */
function describirAudiencia(a: any): string {
  const aud = a.audience ?? (a.hotelId ? 'hotel' : 'all')
  if (aud === 'all') return 'Todos los hoteles'
  if (aud === 'admins') return 'Administradores'
  return nombreHotel(a.hotelId) || 'Un hotel'
}

function describirEstado(a: any): { label: string; cls: string } {
  const ahora = Date.now()
  if (!(a.active === 1 || a.active === true)) return { label: 'Inactivo', cls: 'bg-surface text-text-muted' }
  if (a.startsAt && Date.parse(a.startsAt) > ahora) return { label: 'Programado', cls: 'bg-cyan/10 text-cyan' }
  if (a.endsAt && Date.parse(a.endsAt) < ahora) return { label: 'Vencido', cls: 'bg-surface text-text-muted' }
  return { label: 'Publicado', cls: 'bg-teal/10 text-teal' }
}

async function cargarAnuncios(): Promise<void> {
  loading.value = true
  try {
    const [lista, alcance] = await Promise.all([
      PlatformService.announcements(),
      PlatformService.announcementsReach().catch(() => null),
    ])
    reach.value = alcance
    announcements.value = lista.data.map((a: any) => {
      const estado = describirEstado(a)
      const recipients = Number(a.recipients ?? 0)
      const seenCount = Number(a.seenCount ?? 0)
      return {
        id: a.id,
        title: a.title,
        excerpt: (a.message ?? '').slice(0, 80),
        message: a.message ?? '',
        rawType: a.type,
        type: TYPE_LABEL[a.type] ?? 'Informativo',
        typeClass: TYPE_CLASS[a.type] ?? 'bg-cyan/10 text-cyan',
        audience: describirAudiencia(a),
        vigencia: describirVigencia(a),
        recipients,
        seenCount,
        // Sin lecturas todavía no se muestra 0%: un cero se lee como "no lo abrió nadie".
        openRate: recipients > 0 && seenCount > 0 ? `${Math.round((seenCount / recipients) * 100)}%` : 'sin datos',
        status: estado.label,
        statusClass: estado.cls,
        startsAt: fecha(a.startsAt),
        rawStartsAt: a.startsAt,
      }
    })
    scheduled.value = announcements.value.filter((a) => a.rawStartsAt && Date.parse(a.rawStartsAt) > Date.now())
  } catch { toast.error('No se pudieron cargar los anuncios') } finally { loading.value = false }
}

async function cargarHoteles(): Promise<void> {
  try {
    const { hotels } = await SuperAdminService.hotels()
    hoteles.value = hotels.map((h: any) => ({ id: h.id, name: h.name }))
  } catch { hoteles.value = [] }
}

async function cargarPlantillas(): Promise<void> {
  try {
    const guardadas = await ConfigService.get('announcement_templates', 'platform')
    const lista = typeof guardadas === 'string' ? JSON.parse(guardadas) : guardadas
    templates.value = Array.isArray(lista) ? lista : []
  } catch { templates.value = [] }
}

onMounted(() => { cargarAnuncios(); cargarHoteles(); cargarPlantillas() })

function abrirNuevo(): void {
  draft.value = nuevoDraft()
  showCreateModal.value = true
}

/**
 * BUG (corregido): esto era `announcements.value.unshift(...)` y nada más — el anuncio se veía
 * aparecer en la lista, pero NO se guardaba ni llegaba a ningún hotel. Al recargar desaparecía.
 */
const enviando = ref(false)
async function sendAnnouncement(): Promise<void> {
  const d = draft.value
  if (!d.title.trim()) { toast.error('El anuncio necesita un título'); return }
  if (d.audience === 'hotel' && !d.hotelId) { toast.error('Elegí a qué hotel va dirigido'); return }
  if (d.cuando === 'programar' && !d.startsAt) { toast.error('Elegí la fecha de publicación'); return }

  enviando.value = true
  try {
    await AnnouncementsService.create({
      title: d.title.trim(),
      message: d.message.trim(),
      type: d.type as any,
      priority: d.type === 'urgent' ? 'urgent' : d.type === 'maintenance' ? 'high' : 'medium',
      active: 1,
      audience: d.audience,
      hotelId: d.audience === 'hotel' ? d.hotelId : undefined,
      startsAt: d.cuando === 'programar' ? aIso(d.startsAt) : undefined,
      endsAt: aIso(d.endsAt),
      date: new Date().toISOString(),
    })
    showCreateModal.value = false
    toast.success(d.cuando === 'programar' ? 'Anuncio programado' : 'Anuncio publicado')
    draft.value = nuevoDraft()
    await cargarAnuncios()
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo publicar el anuncio')
  } finally {
    enviando.value = false
  }
}

// ---- Plantillas: viven en configuration('announcement_templates', 'platform') ----

async function persistirPlantillas(): Promise<void> {
  await ConfigService.set('announcement_templates', JSON.stringify(templates.value), 'platform')
}

function usarPlantilla(tpl: Plantilla): void {
  draft.value = { ...nuevoDraft(), title: tpl.name, type: tpl.type, message: tpl.message }
  showCreateModal.value = true
}

async function guardarComoPlantilla(): Promise<void> {
  const d = draft.value
  if (!d.title.trim()) { toast.error('Escribí un anuncio primero: se guarda lo que haya en el formulario'); return }
  templates.value = [
    ...templates.value.filter((t) => t.name !== d.title.trim()),
    { name: d.title.trim(), icon: '📌', description: (d.message || '').slice(0, 60), type: d.type, message: d.message },
  ]
  try {
    await persistirPlantillas()
    toast.success('Plantilla guardada')
  } catch (e: any) {
    await cargarPlantillas()
    toast.error(e?.message || 'No se pudo guardar la plantilla')
  }
}

async function borrarPlantilla(i: number): Promise<void> {
  const previas = [...templates.value]
  templates.value = templates.value.filter((_, idx) => idx !== i)
  try {
    await persistirPlantillas()
  } catch {
    templates.value = previas
    toast.error('No se pudo quitar la plantilla')
  }
}

const detalle = ref<any | null>(null)
function verAnuncio(ann: any): void { detalle.value = ann }

const borrandoId = ref<string | null>(null)
const aBorrar = ref<any | null>(null)
function pedirBorrado(ann: any): void { aBorrar.value = ann }

async function confirmarBorrado(): Promise<void> {
  const ann = aBorrar.value
  if (!ann) return
  borrandoId.value = ann.id
  aBorrar.value = null
  try {
    await AnnouncementsService.remove(String(ann.id))
    announcements.value = announcements.value.filter((a: any) => a.id !== ann.id)
    scheduled.value = scheduled.value.filter((a: any) => a.id !== ann.id)
    toast.success('Anuncio eliminado')
    await cargarAnuncios()
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo eliminar el anuncio')
  } finally {
    borrandoId.value = null
  }
}
</script>
