<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-black text-navy">Anuncios & Comunicados</h2>
        <p class="text-sm text-text-muted mt-0.5">Envía mensajes a todos los hoteles de la plataforma</p>
      </div>
      <button @click="showCreateModal = true" class="px-4 py-2 bg-navy text-white text-sm font-bold rounded-xl hover:bg-navy-light transition-colors cursor-pointer flex items-center gap-2">
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
      <div v-else class="overflow-x-auto">
        <table class="w-full tbl-head">
          <thead>
            <tr class="border-b border-border">
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Título</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Tipo</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Audiencia</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Fecha</th>
              <th class="text-center py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Vistas</th>
              <th class="text-left py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Estado</th>
              <th class="text-right py-3 px-4 text-[10px] font-bold text-text-muted uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ann in announcements" :key="ann.id" class="border-b border-border/50 hover:bg-surface/50 transition-colors">
              <td class="py-3 px-4">
                <div class="text-sm font-bold text-navy">{{ ann.title }}</div>
                <div class="text-[10px] text-text-muted truncate max-w-[250px]">{{ ann.excerpt }}</div>
              </td>
              <td class="py-3 px-4">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="ann.typeClass">{{ ann.type }}</span>
              </td>
              <td class="py-3 px-4">
                <span class="text-xs text-navy">{{ ann.audience }}</span>
              </td>
              <td class="py-3 px-4 text-xs text-text-muted">{{ ann.date }}</td>
              <td class="py-3 px-4 text-center">
                <div class="text-sm font-bold text-navy">{{ ann.views }}</div>
                <div class="text-[9px] text-text-muted">{{ ann.reads }} leídos</div>
              </td>
              <td class="py-3 px-4">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="ann.status === 'Enviado' ? 'bg-teal/10 text-teal' : 'bg-gold/10 text-gold'">{{ ann.status }}</span>
              </td>
              <td class="py-3 px-4 text-right">
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
        <div class="space-y-3">
          <div class="flex justify-between">
            <span class="text-xs text-text-muted">Hoteles totales</span>
            <span class="text-xs font-bold text-navy">24</span>
          </div>
          <div class="flex justify-between">
            <span class="text-xs text-text-muted">Usuarios totales</span>
            <span class="text-xs font-bold text-navy">89</span>
          </div>
          <div class="flex justify-between">
            <span class="text-xs text-text-muted">Tasa apertura</span>
            <span class="text-xs font-bold text-teal">72%</span>
          </div>
          <div class="flex justify-between">
            <span class="text-xs text-text-muted">Tasa click</span>
            <span class="text-xs font-bold text-cyan">18%</span>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Plantillas Guardadas">
        <div class="space-y-2">
          <div v-for="tpl in templates" :key="tpl.name" class="p-2 bg-surface rounded-lg flex items-center gap-2 cursor-pointer hover:bg-surface-dark transition-colors">
            <span class="text-lg">{{ tpl.icon }}</span>
            <div>
              <div class="text-xs font-bold text-navy">{{ tpl.name }}</div>
              <div class="text-[9px] text-text-muted">{{ tpl.description }}</div>
            </div>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Programación">
        <div class="space-y-3">
          <div v-for="sched in scheduled" :key="sched.id" class="bg-surface rounded-xl p-3" data-testid="scheduled-item">
            <div class="text-xs font-bold text-navy">{{ sched.title }}</div>
            <div class="flex justify-between text-[10px] mt-1">
              <span class="text-text-muted">{{ formatFecha(sched.startsAt) }}</span>
              <span class="text-teal font-bold">{{ sched.endsAt ? `Hasta ${formatFecha(sched.endsAt)}` : 'Programado' }}</span>
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
          <input v-model="newAnnouncement.title" type="text" placeholder="Ej: ¡Nueva función disponible!" class="w-full h-10 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan" />
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Tipo</label>
          <select v-model="newAnnouncement.type" class="w-full h-10 px-4 rounded-xl border border-border text-sm cursor-pointer">
            <option value="feature">Nueva función</option>
            <option value="maintenance">Mantenimiento</option>
            <option value="promo">Promoción</option>
            <option value="info">Informativo</option>
            <option value="urgent">Urgente</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Audiencia</label>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex items-center gap-2 p-2 bg-surface rounded-lg cursor-pointer">
              <input type="checkbox" v-model="newAnnouncement.allHotels" class="w-4 h-4 text-cyan rounded" />
              <span class="text-xs font-bold text-navy">Todos los hoteles</span>
            </label>
            <label class="flex items-center gap-2 p-2 bg-surface rounded-lg cursor-pointer">
              <input type="checkbox" v-model="newAnnouncement.adminsOnly" class="w-4 h-4 text-cyan rounded" />
              <span class="text-xs font-bold text-navy">Solo admins</span>
            </label>
          </div>
        </div>
        <!-- #107 (ANN-3): vigencia. Sin tocar nada se publica ya y no vence (el body no lleva startsAt/endsAt). -->
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Publicación</label>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex items-center gap-2 p-2 bg-surface rounded-lg cursor-pointer">
              <input id="announcement-publish-now" name="publishMode" type="radio" value="now" v-model="newAnnouncement.publishMode" class="w-4 h-4 text-cyan" />
              <span class="text-xs font-bold text-navy">Publicar ahora</span>
            </label>
            <label class="flex items-center gap-2 p-2 bg-surface rounded-lg cursor-pointer">
              <input id="announcement-publish-scheduled" name="publishMode" type="radio" value="scheduled" v-model="newAnnouncement.publishMode" class="w-4 h-4 text-cyan" />
              <span class="text-xs font-bold text-navy">Programar</span>
            </label>
          </div>
          <div v-if="newAnnouncement.publishMode === 'scheduled'" class="mt-2">
            <label for="announcement-starts-at" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Fecha de publicación</label>
            <input id="announcement-starts-at" name="startsAt" v-model="newAnnouncement.startsAt" type="datetime-local" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
          </div>
        </div>
        <div>
          <label for="announcement-ends-at" class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Fecha de fin <span class="normal-case font-normal text-text-muted/70">(opcional)</span></label>
          <input id="announcement-ends-at" name="endsAt" v-model="newAnnouncement.endsAt" type="datetime-local" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
          <p class="text-[10px] text-text-muted mt-1">Vacío = sin vencimiento.</p>
        </div>
        <div>
          <label class="text-[10px] font-bold text-text-muted uppercase mb-1 block">Mensaje</label>
          <textarea v-model="newAnnouncement.message" rows="4" class="w-full px-4 py-3 rounded-xl border border-border text-sm focus:outline-none focus:border-cyan resize-none" placeholder="Escribe el mensaje del anuncio..."></textarea>
        </div>
      </div>
      <template #footer>
        <button @click="showCreateModal = false" class="px-4 py-2.5 bg-surface text-navy text-sm font-bold rounded-xl cursor-pointer">Cancelar</button>
        <button type="button" :disabled="enviando || !newAnnouncement.title.trim()" @click="sendAnnouncement" class="px-4 py-2.5 bg-navy text-white text-sm font-bold rounded-xl cursor-pointer disabled:opacity-50 disabled:cursor-default">{{ enviando ? 'Publicando…' : (newAnnouncement.publishMode === 'scheduled' ? 'Programar' : 'Enviar Ahora') }}</button>
      </template>
    </AppModal>

    <!-- Detalle: el botón "Ver" no hacía nada -->
    <AppModal v-if="detalle" size="md" :title="detalle.title" :subtitle="detalle.type" @close="detalle = null">
      <div class="space-y-4">
        <p class="whitespace-pre-line text-sm text-text-secondary">{{ detalle.message || 'Este anuncio no tiene mensaje.' }}</p>
        <div class="grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs">
          <div>
            <div class="text-[10px] font-bold uppercase text-text-muted">Destinatarios</div>
            <div class="font-bold text-navy">{{ detalle.audience }}</div>
          </div>
          <div>
            <div class="text-[10px] font-bold uppercase text-text-muted">Estado</div>
            <div class="font-bold text-navy">{{ detalle.status }}</div>
          </div>
          <div v-if="detalle.date">
            <div class="text-[10px] font-bold uppercase text-text-muted">Fecha</div>
            <div class="font-bold text-navy">{{ detalle.date }}</div>
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
import { ref, computed, onMounted } from 'vue'
import { useToast } from '@/composables/useToast'
import { PlatformService } from '@/services/Platform.service'
import { AnnouncementsService } from '@/services/Announcements.service'
import AppModal from '@/components/ui/AppModal.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'

const toast = useToast()
const loading = ref(true)
const showCreateModal = ref(false)

type PublishMode = 'now' | 'scheduled'
interface NewAnnouncement {
  title: string; type: string; allHotels: boolean; adminsOnly: boolean; message: string
  /** #107: 'now' publica ya (sin startsAt); 'scheduled' exige startsAt. endsAt siempre opcional. */
  publishMode: PublishMode; startsAt: string; endsAt: string
}
function draftVacio(): NewAnnouncement {
  return { title: '', type: 'feature', allHotels: true, adminsOnly: false, message: '', publishMode: 'now', startsAt: '', endsAt: '' }
}
const newAnnouncement = ref<NewAnnouncement>(draftVacio())

const TYPE_LABEL: Record<string, string> = { feature: 'Nueva función', maintenance: 'Mantenimiento', warning: 'Aviso', urgent: 'Urgente', promo: 'Promoción', success: 'Informativo', info: 'Informativo' }
const TYPE_CLASS: Record<string, string> = { feature: 'bg-teal/10 text-teal', maintenance: 'bg-gold/10 text-gold', warning: 'bg-gold/10 text-gold', urgent: 'bg-danger/10 text-danger', promo: 'bg-navy/10 text-navy', success: 'bg-cyan/10 text-cyan', info: 'bg-cyan/10 text-cyan' }

const announcements = ref<any[]>([])

const templates = [
  { name: 'Bienvenida', icon: '👋', description: 'Mensaje de bienvenida a nuevo hotel' },
  { name: 'Mantenimiento', icon: '🔧', description: 'Aviso de mantenimiento programado' },
  { name: 'Nueva función', icon: '🎉', description: 'Anuncio de funcionalidad nueva' },
  { name: 'Recordatorio pago', icon: '💰', description: 'Aviso de facturación pendiente' },
]

/** #107: programados = startsAt en el futuro. Sale de la misma lista (GET /admin/announcements trae todas las filas). */
const scheduled = computed(() =>
  announcements.value.filter((a: any) => a.startsAt && new Date(a.startsAt).getTime() > Date.now()),
)

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function cargarAnuncios(): Promise<void> {
  loading.value = true
  try {
    // #108 (ANN-4): TODOS los anuncios del endpoint de plataforma (GET /admin/announcements), que
    // ahora agrega a cada aviso su `reads` real (COUNT de announcement_reads). El listado del
    // módulo anuncios (GET /anuncios) no sirve para este panel: pagina con limit=20 sin UI de
    // paginación (se perdían avisos) y sirve de un cache de 300s que create/delete no invalidan
    // bien (#160), así que "Enviar Ahora" no se reflejaba. Crear/eliminar sí van por ahí: son los
    // únicos endpoints de escritura de anuncios.
    const { data } = await PlatformService.announcements()
    announcements.value = data.map((a: any) => ({
      id: a.id,
      title: a.title,
      excerpt: (a.message ?? '').slice(0, 80),
      rawType: a.type,
      message: a.message ?? '',
      type: TYPE_LABEL[a.type] ?? 'Informativo',
      typeClass: TYPE_CLASS[a.type] ?? 'bg-cyan/10 text-cyan',
      audience: a.hotelId ? 'Hotel específico' : 'Todos los hoteles',
      date: a.fecha ? String(a.fecha).slice(0, 10) : '',
      views: 0,
      // Lecturas reales de la API; 0 queda sólo como default vacío cuando no viene, nunca como dato falso.
      reads: a.reads ?? 0,
      status: a.active === 1 ? 'Enviado' : 'Borrador',
      startsAt: a.startsAt ?? null,
      endsAt: a.endsAt ?? null,
    }))
  } catch { toast.error('No se pudieron cargar los anuncios') } finally { loading.value = false }
}

onMounted(cargarAnuncios)

/**
 * BUG: esto era `announcements.value.unshift(...)` y nada más — el anuncio se veía aparecer en la
 * lista, pero NO se guardaba en ningún lado ni llegaba a ningún hotel. Al recargar desaparecía.
 * Mismo patrón que ya se había corregido en `roles.vue:savePermissions`.
 *
 * `hotelId` ausente = anuncio global (el backend lo trata así, ver `anuncios/service.ts`).
 */
const enviando = ref(false)
async function sendAnnouncement(): Promise<void> {
  const draft = newAnnouncement.value
  if (!draft.title.trim()) { toast.error('El anuncio necesita un título'); return }
  const programado = draft.publishMode === 'scheduled'
  if (programado && !draft.startsAt) { toast.error('Elegí la fecha de publicación'); return }
  const startsAt = programado ? new Date(draft.startsAt).toISOString() : undefined
  const endsAt = draft.endsAt ? new Date(draft.endsAt).toISOString() : undefined
  if (startsAt && endsAt && endsAt <= startsAt) { toast.error('La fecha de fin tiene que ser posterior al inicio'); return }
  enviando.value = true
  try {
    // Sólo se mandan startsAt/endsAt si el usuario los cargó: sin tocar nada el body es el de siempre.
    await AnnouncementsService.create({
      title: draft.title.trim(),
      message: draft.message.trim(),
      type: draft.type,
      priority: draft.type === 'maintenance' ? 'high' : 'medium',
      active: 1,
      date: new Date().toISOString(),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    } as any)
    showCreateModal.value = false
    newAnnouncement.value = draftVacio()
    toast.success(programado ? 'Anuncio programado' : 'Anuncio publicado')
    await cargarAnuncios()
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo publicar el anuncio')
  } finally {
    enviando.value = false
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
    toast.success('Anuncio eliminado')
  } catch (e: any) {
    toast.error(e?.message || 'No se pudo eliminar el anuncio')
  } finally {
    borrandoId.value = null
  }
}
</script>
