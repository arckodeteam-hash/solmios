// reservas/model.ts — Schema de base de datos
import type { ModelDefinition, ORM } from 'arckode-framework'

export const ReservasModel: ModelDefinition = {
  table: 'reservations',
  fields: {
    id: { type: 'string', required: true },
    guestId: { type: 'string' },
    roomId: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    checkIn: { type: 'string', required: true },
    checkOut: { type: 'string', required: true },
    status: { type: 'string', default: 'pending' },
    channel: { type: 'string', default: 'direct' },
    totalAmount: { type: 'number', required: true },
    deposit: { type: 'number', default: 0 },
    currency: { type: 'string', default: 'USD' },
    adults: { type: 'number', default: 2 },
    children: { type: 'number', default: 0 },
    notes: { type: 'text' },
    // Campos OTA + pagos (Fase 1)
    source: { type: 'string', default: 'direct' },
    externalLocator: { type: 'string' },
    commission: { type: 'number', default: 0 },
    commissionAmount: { type: 'number', default: 0 },
    paymentMethod: { type: 'string' },
    pendingAmount: { type: 'number', default: 0 },
    autoSendEnabled: { type: 'boolean', default: true },
    preCheckinStatus: { type: 'string', default: 'pending' },
    preCheckinHash: { type: 'string' },
    documentScanned: { type: 'boolean', default: false },
    groupId: { type: 'string' },
    otaNotes: { type: 'text' },
    // Campos nuevos del modal
    depositPercentage: { type: 'number', default: 100 },
    depositStatus: { type: 'string', default: 'unpaid' },
    ownerNotes: { type: 'text' },
    regime: { type: 'string', default: 'room_only' },
    promoCode: { type: 'string' },
    communicateClient: { type: 'string', default: 'none' },
    // F3 MisterPlan: condiciones de reserva + otros cobros
    gdprAccepted: { type: 'boolean', default: false },
    marketingAccepted: { type: 'boolean', default: false },
    termsAccepted: { type: 'boolean', default: false },
    otherCharges: { type: 'number', default: 0 },
    // Tarjeta de garantía (MisterPlan): datos parciales + bandera.
    // NO se guarda el número completo ni el CVV (PCI). Los datos se revelan solo tras PIN.
    hasGuaranteeCard: { type: 'boolean', default: false },
    cardHolder: { type: 'string' },
    cardBrand: { type: 'string' },
    cardLast4: { type: 'string' },
    cardExpMonth: { type: 'string' },
    cardExpYear: { type: 'string' },
    // Check-in / check-out real (folio + auditoría)
    checkedInAt: { type: 'string' },
    checkedOutAt: { type: 'string' },
    folioId: { type: 'string' },
    // F0 0.13 — AccessToken público (UUID) para consulta sin login (spec booking-unification).
    // Lo setea `createPublicBookingDirect` al crear por flujo público (`/api/public/booking`).
    // Las reservas creadas desde el panel NO lo setean → queda null → 404 en el endpoint público
    // (anti-IDOR: no revela existencia). Anti-patrón ORM D5: declarado acá, case-sensitive.
    accessToken: { type: 'string' },
    // F3 3.14 — Abandon recovery: marca que ya se envió el email de recuperación a esta
    // reserva. Lo setea el cron `abandon-recovery-cron` (cada 30 min) cuando encuentra una
    // reserva `pending` con `createdAt` entre 1h y 4h atrás. Idempotente por diseño: el flag
    // evita re-enviar el email en el próximo tick. Default false (0 en BD INTEGER). Case-sensitive.
    abandonEmailSent: { type: 'boolean', default: false },
    // F1 plan #627 — Políticas de cancelación. Snapshot del cálculo al cancelar.
    // cancelledAt: momento ISO de la cancelación. cancellationReason: texto libre del motivo.
    // cancellationFee/refundAmount: resultado de computePenalty (cuánto se retiene/devuelve).
    // policyApplied: ResolvedPolicy serializada (tiers + policyId + source) para auditoría.
    // Anti-patrón ORM: declarados acá case-sensitive o se descartan al persistir. type:'json'
    // nativo en el ORM (mismo que bookingengine allowedCountries). RUN_MIGRATE ADD COLUMN.
    cancelledAt: { type: 'string' },
    cancellationReason: { type: 'text' },
    cancellationFee: { type: 'number', default: 0 },
    refundAmount: { type: 'number', default: 0 },
    policyApplied: { type: 'json' },
    // Pre-checkin público (prototipo 8 pasos): firma digital + timestamp de aceptación del
    // contrato. signatureUrl es la URL del storage (carpeta 'signatures') donde queda la imagen
    // del canvas firmado; contractAcceptedAt es el ISO timestamp de cuándo el huésped aceptó.
    // Anti-patrón ORM: declarados acá case-sensitive o se descartan al persistir. RUN_MIGRATE ADD COLUMN.
    signatureUrl: { type: 'string' },
    contractAcceptedAt: { type: 'string' },
    // Tarea 3.4 (corrección 2026-08-25) — "Confirmación instantánea" apagada en
    // booking_config: la reserva pública queda 'pending' (o null si no aplica) hasta que el
    // hotel la apruebe manualmente (`POST /api/reservas/:id/approve`). Eje INDEPENDIENTE de
    // `status` a propósito — la reserva ya ocupa la habitación y ya cobró, esto es solo una
    // revisión humana antes de darla por buena, no un segundo estado de disponibilidad. Solo
    // lo setean los usecases públicos de bookingengine; una reserva cargada a mano desde el
    // panel no pasa por acá. Anti-patrón ORM: declarado acá o se descarta al persistir.
    approvalStatus: { type: 'string' },
  },
  timestamps: true,
}

export function registerReservasModels(orm: ORM): void {
  orm.define('Reservations', ReservasModel)
}
