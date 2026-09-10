// sockets.ts — Hooks para que otros módulos reaccionen al ciclo de la suscripción.
//
// Todavía sin consumidores: los avisos de "te quedan 2 días" y el corte por
// falta de pago van a colgarse de acá (connector → notificaciones/email), sin
// que este módulo tenga que conocerlos.

export interface SubscriptionSockets {
  /** Se creó una cuenta nueva y arrancó su prueba gratis. `referralCode`: código de referido
   *  usado en el alta, si vino uno — lo consume el módulo `referrals` (connector subscriptions-referrals.ts). */
  onTrialStarted?: (payload: { hotelId: string; trialEndsAt: string; referralCode?: string }) => Promise<void>
  /** Se venció la prueba y se cortó el acceso. */
  onTrialExpired?: (payload: { hotelId: string }) => Promise<void>
  /** Cambió el estado de la suscripción (pagó, falló el cobro, se dio de baja). */
  onStatusChanged?: (payload: { hotelId: string; status: string }) => Promise<void>
  /**
   * REQ-PIPE-04 (#145): un hotel acaba de registrarse por el alta pública. Lleva lo que el equipo
   * de ventas necesita para llamarlo YA (hotel, dueño, plan elegido) sin que el consumidor tenga
   * que releer nada. Lo consume `sales-leads` vía `connectors/subscriptions-sales-alert.ts`.
   * Best-effort: se dispara DESPUÉS de que la cuenta existe y un fallo no la deshace.
   */
  onHotelSignedUp?: (hotel: SignedUpHotel, owner: SignedUpOwner, planId: string) => Promise<void>
}

/** Datos del hotel recién creado, tal como los cargó el formulario del alta. */
export interface SignedUpHotel {
  id: string
  name: string
  email: string
  phone: string
  country: string
  createdAt: string
}

/** El dueño de la cuenta (usuario `hotel_admin` que creó el alta). */
export interface SignedUpOwner {
  id: string
  name: string
  email: string
}
