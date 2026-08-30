// shared/usecases/cancellation-text.ts — Texto legible de la política de cancelación.
//
// El widget público ya se lo muestra al huésped antes de pagar, pero ese texto vive en el
// i18n del frontend (`useBookingI18n.ts`, claves `pay.cancel*Headline`). El correo de
// confirmación se arma en el servidor, así que necesita su propia redacción — con las MISMAS
// reglas que `PRESET_TIERS` de `cancellation-math.ts`, para que el huésped no lea una condición
// en pantalla y otra distinta en el correo.
//
// Si acá y en `PRESET_TIERS` dejan de coincidir, el hotel promete algo que el cálculo no cumple.

import type { NotificationLanguage } from '../../services/notification-defaults'

/** Tipos de `hotels.cancellationType` (espejan las claves de `PRESET_TIERS`). */
export type CancellationType = 'flexible' | 'moderate' | 'strict' | 'non_refundable'

const TEXTS: Record<CancellationType, Record<NotificationLanguage, string>> = {
  flexible: {
    es: 'Cancelación gratuita hasta el día del check-in.',
    en: 'Free cancellation until the check-in date.',
    pt: 'Cancelamento gratuito até o dia do check-in.',
  },
  moderate: {
    es: 'Cancelación sin cargo hasta 72 horas antes del check-in. Después se retiene el 50%.',
    en: 'Free cancellation until 72 hours before check-in. After that, 50% is retained.',
    pt: 'Cancelamento sem custo até 72 horas antes do check-in. Depois, retém-se 50%.',
  },
  strict: {
    es: 'Cancelación sin cargo hasta 7 días antes del check-in. Pasado ese plazo, la reserva no es reembolsable.',
    en: 'Free cancellation until 7 days before check-in. After that, the booking is non-refundable.',
    pt: 'Cancelamento sem custo até 7 dias antes do check-in. Depois disso, a reserva não é reembolsável.',
  },
  non_refundable: {
    es: 'Esta reserva no admite cancelación con reembolso.',
    en: 'This booking is non-refundable.',
    pt: 'Esta reserva não permite cancelamento com reembolso.',
  },
}

const UNKNOWN: Record<NotificationLanguage, string> = {
  es: 'Consultá las condiciones de cancelación con el hotel.',
  en: 'Please check the cancellation terms with the hotel.',
  pt: 'Consulte as condições de cancelamento com o hotel.',
}

/**
 * Texto de la política para el correo. Un tipo desconocido (o el hotel sin política cargada)
 * NO inventa condiciones: remite al hotel. Prometer "cancelación gratis" por defecto sería
 * comprometer al hotel a algo que no eligió.
 */
export function cancellationPolicyText(type: unknown, language: NotificationLanguage = 'es'): string {
  const key = String(type ?? '') as CancellationType
  const entry = TEXTS[key]
  return (entry ?? UNKNOWN)[language] ?? (entry ?? UNKNOWN).es
}
