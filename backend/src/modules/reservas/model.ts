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
    // Tarea 24 (#88) — desglose que el huésped vio y aceptó en el motor público
    // ({subtotal, promoDiscount, upsellsTotal, taxes, taxBreakdown[{name,rate,amount}], total}).
    // Nulo en reservas del panel/OTA. La confirmación pública lo muestra tal cual: es lo que
    // se le prometió antes de la pasarela, no una reconstrucción.
    priceBreakdown: { type: 'json' },
    deposit: { type: 'number', default: 0 },
    currency: { type: 'string', default: 'USD' },
    adults: { type: 'number', default: 2 },
    children: { type: 'number', default: 0 },
    // Edad declarada por el huésped al reservar (no fecha de nacimiento — feature
    // "adultos+niños+edades" 2026-09-02). NO siempre length === `children`: un niño con edad >
    // maxChildAge se cuenta en `adults`, no en `children`, pero su edad declarada SIGUE acá (es
    // la auditoría de lo que se tipeó — ver Requerimiento 11). [] si no hay niños o la reserva es
    // de antes de este feature (booking-engine viejo mandaba solo el contador).
    childrenAges: { type: 'json', default: [] },
    // Requerimiento 12 (Edad de referencia, 2026-09-03) — el check-in VIGENTE cuando se declaró
    // `childrenAges` (en la creación pública, siempre el checkIn de la reserva en ese momento).
    // Sin esto, una edad guardada como entero plano no tiene ancla temporal: "4 años" no dice
    // desde cuándo. Al reagendar, `composeFromPersistedReservation` proyecta cada edad a la
    // diferencia de AÑOS CALENDARIO entre esta fecha y el checkIn nuevo (aproximado — sin mes de
    // nacimiento no se puede saber el día exacto del cumpleaños). NUNCA se reescribe: queda fija
    // en la fecha de la declaración ORIGINAL, para que reagendar dos veces siga proyectando desde
    // la misma base (proyectar en cadena acumularía redondeo). null = reserva sin niños o de
    // antes de este campo — cae al comportamiento sin proyección (edad tal cual, como hoy).
    childrenAgesAsOf: { type: 'string' },
    // Tarea "Cobro % niños" (2026-09-09) — % del "valor de un adulto" REALMENTE usado para
    // cotizar a los niños con plaza de ESTA reserva, congelado al momento de crearla (auditoría:
    // si el hotel cambia el % en Configuración después, esta reserva sigue mostrando y cobrando
    // lo que se acordó). `null` = la regla no aplicó (deshabilitada, sin niños con plaza, o
    // reserva anterior a este campo).
    childrenRatePercentApplied: { type: 'number' },
    // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — asociada a ESTA habitación
    // (cada room-line de un grupo multi-habitación es su propia fila acá, ver
    // public-booking-group.ts): solo tiene sentido si esta reserva tiene al menos un bebé
    // (Tarea 21, `childrenAges` clasificado 'baby') Y el hotel habilitó la cuna
    // (`childPolicy.cribAvailable`); el backend lo re-valida al crear, nunca confía en lo que
    // mande el cliente. `cribCount` es 1/0 espejo de `needsCrib` — no existe un checklist de
    // amenidades adicionales, solo esta pregunta binaria.
    needsCrib: { type: 'boolean', default: false },
    cribCount: { type: 'number', default: 0 },
    // REQ-01 (#233) — Amenidades para niños/bebés elegidas para ESTA habitación (por fila, igual
    // que la cuna: cada unidad de un grupo lleva las suyas). Snapshot con precio congelado
    // [{id, name, price, quantity, total}] — si el hotel cambia el catálogo después, la reserva
    // sigue mostrando lo que se cotizó. `childAmenitiesTotal` es la Σ de `total` del snapshot y
    // ya está incluido en `totalAmount`/`priceBreakdown.subtotal`. Gateado server-side: solo con
    // al menos un menor en la composición y `childPolicy.acceptChildren` (ver public-booking.ts).
    childAmenities: { type: 'json' },
    childAmenitiesTotal: { type: 'number', default: 0 },
    // REQ-01 (#290) — Amenidades PERSONALIZADAS de la habitación asignada (filas `RoomAmenities`
    // con key `custom:<slug>`, name, price) elegidas para ESTA fila. Mismo criterio que
    // `childAmenities`: snapshot con precio congelado [{key, name, price, quantity, total}] —
    // validado server-side contra las filas de la unidad asignada (nunca el precio del body) — y
    // `roomAmenitiesTotal` = Σ `total`, ya incluido en `totalAmount`/`priceBreakdown.subtotal`.
    // En un grupo cada unidad física lleva las suyas (ver public-booking-group.ts).
    roomAmenities: { type: 'json' },
    roomAmenitiesTotal: { type: 'number', default: 0 },
    notes: { type: 'text' },
    // #270 — Hora estimada de llegada y pedido especial del huésped, estructurados. Hasta ahora
    // solo iban dentro de `notes` como texto libre ("Llegada estimada: ..." / "Pedido especial:
    // ..."); el correo de confirmación y el recibo los necesitan como campos propios. `notes` se
    // sigue escribiendo igual (el recepcionista lo lee de ahí). Nullable: solo el widget los llena.
    estimatedArrival: { type: 'string' },
    specialRequests: { type: 'text' },
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
    // Horario acordado con ESTE huésped (early check-in / late checkout), formato 'HH:MM'.
    // Vacío = manda el horario del hotel (`hotels.checkIn`/`checkOut`). Es lo que define la
    // ventana del código de la cerradura — ver `shared/utils/hotel-schedule.ts`.
    // Anti-patrón ORM D5: declarado acá y case-sensitive; sin esto se descarta al persistir.
    checkInTime: { type: 'string' },
    checkOutTime: { type: 'string' },
    folioId: { type: 'string' },
    // F0 0.13 — AccessToken público (UUID) para consulta sin login (spec booking-unification).
    // Lo setea `createPublicBookingDirect` al crear por flujo público (`/api/public/booking`).
    // Las reservas creadas desde el panel NO lo setean → queda null → 404 en el endpoint público
    // (anti-IDOR: no revela existencia). Anti-patrón ORM D5: declarado acá, case-sensitive.
    accessToken: { type: 'string' },
    // #266 — Límite (ISO) para pagar una reserva web pending: createdAt + booking_config.pendingTtlMinutes.
    // null = no vence (reservas del panel o previas a #266). Case-sensitive (anti-patrón ORM D5).
    paymentDeadlineAt: { type: 'string' },
    // #266 — Clave de idempotencia que manda el widget en POST /api/public/booking. Única por hotel
    // (idx_reservations_hotel_idempotency en migrate-db.ts); null en reservas del panel.
    idempotencyKey: { type: 'string' },
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
