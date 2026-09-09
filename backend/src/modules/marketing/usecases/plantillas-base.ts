// marketing/usecases/plantillas-base.ts — Plantillas listas para usar, con un clic.
//
// Escribir una plantilla que Meta apruebe tiene trampas: no puede empezar ni terminar con una
// variable, ni tener dos seguidas, y la categoría cambia el precio del mensaje y el rigor de la
// revisión. Pedirle eso a un recepcionista es pedirle que aprenda las reglas de Meta.
//
// Estos son los mensajes que un hotel manda de verdad, ya redactados y ya validados contra esas
// reglas (hay un test que las pasa todas por `metaBodyProblem`). El hotel las crea de una vez y las
// manda a aprobar; después puede editar el texto de las que no le gusten.

export interface PlantillaBase {
  /** Clave estable: es lo que evita duplicar si se toca el botón dos veces. */
  slug: string
  name: string
  /** Categoría interna del PMS, la que agrupa e ilustra la lista. */
  category: 'reservation' | 'checkin' | 'checkout' | 'payment' | 'general' | 'marketing'
  /** Categoría de META, que define el precio y qué tan estricta es la revisión. */
  metaCategory: 'UTILITY' | 'MARKETING'
  body: string
  /** Para qué sirve, en la lista del panel. */
  descripcion: string
}

/**
 * `UTILITY` en todas a propósito: son mensajes que el huésped espera porque hizo una reserva.
 * `MARKETING` cuesta más y se rechaza mucho más seguido.
 *
 * NINGUNA entrega una credencial —clave de wifi, código de la puerta, PIN—, y eso NO es un
 * descuido. Probado contra Meta el 2026-09-07: una plantilla que entrega un código se rechaza al
 * instante con `INCORRECT_CATEGORY`, porque Meta la quiere como AUTHENTICATION… y esa categoría
 * solo admite un formato fijo de código de verificación, que no sirve para "el código de tu
 * habitación es X".
 *
 * OJO al corregir una rechazada: BORRARLA en Meta no libera el nombre enseguida. Durante un buen
 * rato, crear otra con el mismo nombre responde "no es posible añadir contenido nuevo mientras se
 * está eliminando el contenido existente". Conviene corregir el texto y mandarla con OTRO nombre,
 * en vez de borrar y recrear.
 *
 * Y no alcanza con no mandar el dato: MENCIONARLO basta. "te pasamos el código de acceso" también
 * se rechazó. Por eso ninguna de estas nombra códigos, claves ni contraseñas — invitan a responder,
 * y el dato se manda por texto libre, que dentro de la ventana de 24 h no necesita plantilla.
 */
export const PLANTILLAS_BASE: PlantillaBase[] = [
  // ── Al reservar ────────────────────────────────────────────────────────────
  {
    slug: 'confirmacion_reserva',
    name: 'Confirmación de reserva',
    category: 'reservation',
    metaCategory: 'UTILITY',
    descripcion: 'Apenas la reserva queda confirmada. Es la más usada.',
    body: 'Hola {guest_name}, tu reserva en {hotel_name} quedó confirmada. Llegada el {checkin_date} y salida el {checkout_date}, por un total de {total_amount}. Tu código de reserva es {locator}. ¡Te esperamos!',
  },
  {
    slug: 'pago_recibido',
    name: 'Pago recibido',
    category: 'payment',
    metaCategory: 'UTILITY',
    descripcion: 'Confirma un cobro. Evita el "¿me llegó el pago?" por teléfono.',
    body: 'Hola {guest_name}, recibimos tu pago para la reserva {locator} en {hotel_name}. Queda un saldo pendiente de {pending_amount}. Cualquier duda, respondé este mensaje.',
  },
  {
    slug: 'saldo_pendiente',
    name: 'Saldo pendiente',
    category: 'payment',
    metaCategory: 'UTILITY',
    descripcion: 'Recordatorio de saldo antes de la llegada. Es la que más plata recupera.',
    body: 'Hola {guest_name}, te queda un saldo pendiente de {pending_amount} por tu reserva en {hotel_name}. Podés abonarlo antes de tu llegada el {checkin_date} o directamente en recepción.',
  },

  // ── Antes de llegar ────────────────────────────────────────────────────────
  {
    slug: 'checkin_online',
    name: 'Check-in online',
    category: 'checkin',
    metaCategory: 'UTILITY',
    descripcion: 'Manda el enlace para completar los datos antes de llegar y evitar la fila.',
    body: 'Hola {guest_name}, para agilizar tu llegada a {hotel_name} podés hacer el check-in online acá: {precheckin_link}. Te toma dos minutos y evitás la espera en recepción.',
  },
  {
    slug: 'recordatorio_llegada',
    name: 'Recordatorio de llegada',
    category: 'reservation',
    metaCategory: 'UTILITY',
    descripcion: 'Un día antes. Baja los no-shows.',
    body: 'Hola {guest_name}, te esperamos mañana {checkin_date} en {hotel_name} a partir de las {checkin_time}. Si vas a llegar más tarde, avisanos respondiendo este mensaje.',
  },
  {
    slug: 'como_llegar',
    name: 'Cómo llegar',
    category: 'checkin',
    metaCategory: 'UTILITY',
    descripcion: 'La dirección y el teléfono, para el que ya está viajando.',
    body: 'Hola {guest_name}, te dejamos los datos de {hotel_name} para tu llegada del {checkin_date}. Dirección: {hotel_address}. Teléfono: {hotel_phone}. Cualquier cosa en el camino, escribinos por acá.',
  },

  // ── Durante la estadía ─────────────────────────────────────────────────────
  {
    slug: 'bienvenida_checkin',
    name: 'Bienvenida al llegar',
    category: 'checkin',
    metaCategory: 'UTILITY',
    descripcion: 'Al hacer el check-in. La clave del wifi se manda respondiendo, no acá.',
    body: 'Bienvenido a {hotel_name}, {guest_name}. Tu habitación es la {room_number} y ya está lista. Si necesitás el wifi o cualquier otra cosa, respondé este mensaje y te ayudamos.',
  },
  {
    slug: 'habitacion_lista',
    name: 'Habitación lista',
    category: 'checkin',
    metaCategory: 'UTILITY',
    descripcion: 'Para el huésped que llegó antes del horario de entrada.',
    body: 'Hola {guest_name}, tu habitación {room_number} en {hotel_name} ya está lista para tu llegada del {checkin_date}. Respondé este mensaje cuando estés en camino así te esperamos.',
  },

  // ── Al irse ────────────────────────────────────────────────────────────────
  {
    slug: 'recordatorio_salida',
    name: 'Recordatorio de salida',
    category: 'checkout',
    metaCategory: 'UTILITY',
    descripcion: 'La noche anterior. Evita demoras y discusiones por el horario.',
    body: 'Hola {guest_name}, te recordamos que mañana {checkout_date} es tu salida de {hotel_name}, hasta las {checkout_time}. Si necesitás salir más tarde, respondé este mensaje y vemos si hay disponibilidad.',
  },
  {
    slug: 'gracias_estadia',
    name: 'Gracias por la estadía',
    category: 'checkout',
    metaCategory: 'UTILITY',
    descripcion: 'Después del check-out. Abre la puerta a la factura y a la reseña.',
    body: 'Gracias por elegir {hotel_name}, {guest_name}. Fue un gusto tenerte con nosotros. Si algo se te quedó o necesitás la factura, respondé este mensaje y lo resolvemos.',
  },
]

/** Nombre del catálogo por slug, para los mensajes de la UI. */
export function plantillaBasePorSlug(slug: string): PlantillaBase | undefined {
  return PLANTILLAS_BASE.find((p) => p.slug === slug)
}
