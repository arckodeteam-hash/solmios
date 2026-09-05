// digitalizacion/model.ts — Schema de la tabla digitalization_cases.
//
// Expediente de digitalización de un hotel: SOLMI OS detecta hoteles sin presencia digital y los
// acompaña por seis etapas (página por plantilla, configuración completa —que se cobra—, Google
// Maps, Google Hotel y motor de reservas). Cada etapa lleva su propio `*Status` en vez de una
// sola columna `stage`: las etapas no son secuenciales estrictas (Maps y la web pueden avanzar en
// paralelo), solo googleHotel depende de googleMaps.
//
// Scope PLATAFORMA: aunque la fila apunta a un hotel, el expediente lo gestiona el super_admin
// del SaaS (no es contenido del hotel), mismo patrón que sales-leads / deletion-requests.
import type { ModelDefinition, ORM } from 'arckode-framework'

export const DigitalizationCasesModel: ModelDefinition = {
  table: 'digitalization_cases',
  fields: {
    id: { type: 'string', required: true },
    // El hotel que se digitaliza. Un expediente por hotel — la unicidad la garantiza el servicio
    // (ConflictError al abrir un segundo expediente), no un índice único: un hotel cancelado
    // puede volver a entrar al programa más adelante.
    hotelId: { type: 'string', required: true, indexed: true },
    // Copia denormalizada del nombre para el listado del super_admin — evita un join por fila,
    // igual que sales_leads.hotelName.
    hotelName: { type: 'string' },
    // Estado del expediente completo: abierto → completado → cancelado.
    status: { type: 'string', default: 'abierto' },

    // ── Etapa 1: página web por plantilla ──────────────────────────────────
    websiteStatus: { type: 'string', default: 'pendiente' },
    // Plantilla elegida del catálogo (SITE_TEMPLATE_KEYS en types.ts: classic · modern · boutique).
    templateKey: { type: 'string' },
    siteUrl: { type: 'string' },

    // ── Etapa 2: configuración completa del sistema (es el paso que se cobra) ──
    configStatus: { type: 'string', default: 'pendiente' },
    // NULLABLE a propósito: el precio exacto de la configuración todavía no está definido, así que
    // no hay default posible — null significa "aún sin cotizar", no "gratis".
    configFee: { type: 'number' },
    configCurrency: { type: 'string', default: 'USD' },
    configPaid: { type: 'boolean', default: false },

    // ── Etapa 3: ficha en Google Maps (prerrequisito de Google Hotel) ──────
    googleMapsStatus: { type: 'string', default: 'pendiente' },
    googlePlaceId: { type: 'string' },
    googleMapsUrl: { type: 'string' },

    // ── Etapa 4: Google Hotel (solo tras Maps listo) ──────────────────────
    googleHotelStatus: { type: 'string', default: 'pendiente' },

    // ── Etapa 5: motor de reservas ────────────────────────────────────────
    bookingEngineStatus: { type: 'string', default: 'pendiente' },
    bookingEngineUrl: { type: 'string' },

    // Notas internas del equipo — nunca públicas. `text`, no `string`: `string` aplasta los saltos
    // de línea (`replace(/\s+/g, ' ')` en validate-body.ts).
    notes: { type: 'text' },
  },
  timestamps: true,
}

export function registerDigitalizacionModels(orm: ORM): void {
  orm.define('DigitalizationCases', DigitalizationCasesModel)
}
