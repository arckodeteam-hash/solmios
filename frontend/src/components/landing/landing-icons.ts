// landing-icons.ts — Set de íconos SVG inline compartido por los bloques de la landing pública.
// FIX (auditoría UX/SEO usuario): la landing usaba emoji (📶🏊🅿️🕐📍...) para amenities/trust-badges/
// footer/cta — inconsistente entre SO/navegador, se ve poco profesional en un producto premium.
// Mismo patrón ya establecido en el codebase (ReservationWizardModal.vue:ICON_LOCK, HeroSearchBar.vue:
// ICON_CALENDAR, etc.): string SVG inline renderizado vía v-html, 24x24, stroke-based, sin librería
// nueva (no hay ninguna librería de íconos de uso general en package.json — simple-icons es de marcas).
// Todos los paths son geometría simple (círculos/rects/líneas) para evitar errores de path data.

const AMENITY_ICON_SVGS = {
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5.5 12.5a11 11 0 0 1 13 0"/><path d="M9 16.5a6 6 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>',
  pool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 17c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0"/><path d="M2 21c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0"/><path d="M7 13V6a2 2 0 0 1 2-2h1l6 6"/><circle cx="17" cy="6" r="1.5" fill="currentColor" stroke="none"/></svg>',
  parking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 16V7h3.5a2.75 2.75 0 0 1 0 5.5H9"/></svg>',
  breakfast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3h11l-1 9a4.5 4.5 0 0 1-9 0Z"/><path d="M15 8h2a3 3 0 0 1 0 6h-2.4"/><path d="M6 21h8"/></svg>',
  ac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="6" width="20" height="6" rx="2"/><path d="M6 16v2M10 16v3M14 16v2M18 16v3"/></svg>',
  gym: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8v8M2 10v4M20 8v8M22 10v4M7 12h10"/><rect x="5" y="9" width="2.5" height="6" rx="0.5"/><rect x="16.5" y="9" width="2.5" height="6" rx="0.5"/></svg>',
  spa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c-4-1.5-7-5-7-9a7 7 0 0 1 7-7 7 7 0 0 1 7 7c0 4-3 7.5-7 9Z"/><path d="M12 5c0 4-3 5-3 9M12 5c0 4 3 5 3 9"/></svg>',
  restaurant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v8a2 2 0 0 0 4 0V2M8 2v20M17 2c-1.7 0-3 2-3 5s1.3 5 3 5v10"/></svg>',
  bar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16L12 13 4 4Z"/><path d="M12 13v7M8 20h8"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8M12 18v3"/></svg>',
  'room-service': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 17h20"/><path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 9V5M9.5 5h5"/></svg>',
  pets: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="9" r="2"/><circle cx="18.5" cy="9" r="2"/><circle cx="9" cy="5.5" r="2"/><circle cx="15" cy="5.5" r="2"/><path d="M12 10c-3 0-6 2.5-6 5.5S8.5 20 12 20s6-2 6-4.5S15 10 12 10Z"/></svg>',
  beach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 22 12 12M12 12 20 4M12 12l7 7M12 12C9 8 4 8 2 11c3-1 6 0 7 3"/><path d="M12 12c3-3 8-3 10 0-3-1-6 0-7 3"/></svg>',
  laundry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="12" cy="13" r="5"/><circle cx="12" cy="13" r="2"/><path d="M7 6h.01M10 6h.01"/></svg>',
  kitchen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v6a3 3 0 0 0 6 0V2M9 8v14M17 2v9a3 3 0 0 0 3 3v8"/></svg>',
  safe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v1M15 12h1M12 16v-1M8 12h1"/></svg>',
  elevator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="m10 9 2-2 2 2M10 15l2 2 2-2"/></svg>',
  garden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-8"/><path d="M12 14C7 14 5 10 5 6c4 0 7 2 7 6 0-4 3-6 7-6 0 4-2 8-7 8Z"/></svg>',
  terrace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
  'airport-shuttle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 16V8a1 1 0 0 1 1-1h10l4 4v5a1 1 0 0 1-1 1H3"/><path d="M14 7v4h6"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/></svg>',
  heating: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c-1.5 3-5 4.5-5 9a5 5 0 0 0 10 0c0-1.2-.4-2.1-.9-2.8.2 1.7-.9 2.8-2.1 2.8-1 0-1.8-.8-1.5-1.9 1-1.2 1-3.6-.5-7.1Z"/></svg>',
  wheelchair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4" r="1.5" fill="currentColor" stroke="none"/><path d="M13 8v4h4M13 12l3 7"/><circle cx="9" cy="15" r="5"/></svg>',
  concierge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17h16a1 1 0 0 0 1-1c-1.5 0-2-1-2-3v-1a7 7 0 0 0-14 0v1c0 2-.5 3-2 3a1 1 0 0 0 1 1Z"/><path d="M12 22c1.5 0 2.5-1 2.5-1"/></svg>',
  fallback: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6Z"/></svg>',
}

/** Alias en español → key canónica en inglés (datos viejos de `hotels.amenities` guardados
 *  en español antes de esta normalización). Mismos alias que tenía el ICONS map original de
 *  AmenitiesBlock.vue — no se pierde cobertura al migrar de emoji a SVG. */
const AMENITY_ALIASES: Record<string, keyof typeof AMENITY_ICON_SVGS> = {
  'wi-fi': 'wifi', internet: 'wifi',
  piscina: 'pool',
  estacionamiento: 'parking',
  desayuno: 'breakfast',
  'aire-acondicionado': 'ac', air_conditioning: 'ac',
  gimnasio: 'gym',
  restaurante: 'restaurant',
  servicio_habitacion: 'room-service',
  mascotas: 'pets',
  playa: 'beach',
  lavanderia: 'laundry',
  cocina: 'kitchen',
  tv_cable: 'tv', cable: 'tv',
  caja_fuerte: 'safe',
  ascensor: 'elevator',
  jardin: 'garden',
  terraza: 'terrace',
  airport_shuttle: 'airport-shuttle', shuttle: 'airport-shuttle', traslado_aeropuerto: 'airport-shuttle',
  room_service: 'room-service',
  pets_allowed: 'pets', mascotas_permitidas: 'pets',
  beach_access: 'beach', acceso_playa: 'beach',
  calefaccion: 'heating',
  silla_ruedas: 'wheelchair', acceso_silla_ruedas: 'wheelchair',
  conserjeria: 'concierge', conserjeria_24h: 'concierge',
}

export const AMENITY_ICONS: Record<string, string> = AMENITY_ICON_SVGS

export const TRUST_ICONS: Record<string, string> = {
  rate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4"/><path d="M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5"/></svg>',
  refund: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 4v4h-4"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 20v-4h4"/></svg>',
  secure: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/></svg>',
  'no-fee': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>',
  direct: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2" y="13" width="5" height="6" rx="1.5"/><rect x="17" y="13" width="5" height="6" rx="1.5"/><path d="M20 19v1a3 3 0 0 1-3 3h-3"/></svg>',
  'best-price': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M17 5.5c0-1.9-2.2-3.5-5-3.5S7 3.6 7 5.5 9.2 8.5 12 8.5s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/></svg>',
  instant: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  fallback: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6Z"/></svg>',
}

export const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>'
export const ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>'
export const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>'
export const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v4a2 2 0 0 1-2 2C9.4 21 3 14.6 3 6a2 2 0 0 1 1-2Z"/></svg>'
export const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m3 6 9 6 9-6"/></svg>'
export const ICON_GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
export const ICON_STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.7l-6.1 3.3 1.5-6.8-5.2-4.7 6.9-.7Z"/></svg>'
export const ICON_STAR_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.7l-6.1 3.3 1.5-6.8-5.2-4.7 6.9-.7Z"/></svg>'
export const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>'
export const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
export const ICON_X_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>'
export const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
export const ICON_WARNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>'
export const ICON_BED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 13h18"/><rect x="5" y="7" width="6" height="4" rx="1"/></svg>'
export const ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></svg>'
export const ICON_IMAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>'
export const ICON_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 0-2 2Z"/><path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 1 2 2Z"/></svg>'
export const ICON_SHIELD_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>'
export const ICON_QUESTION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><path d="M12 17h.01"/></svg>'
export const ICON_CLIPBOARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h6"/></svg>'
export const ICON_SPARKLES = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6Z"/><path d="M19 13.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z"/></svg>'
export const ICON_FOOTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15h18"/></svg>'
export const ICON_SUNRISE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 2v4M4.2 10.2l1.4 1.4M19.8 10.2l-1.4 1.4M2 18h20M6 18a6 6 0 0 1 12 0"/></svg>'
export const ICON_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M6 21V10M12 21V4M18 21v-7"/></svg>'
export const ICON_WIDGET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/><circle cx="6" cy="6" r=".6" fill="currentColor" stroke="none"/><circle cx="8.5" cy="6" r=".6" fill="currentColor" stroke="none"/></svg>'
// Tarea 3.5 (QA 2026-08-27) — toggle ocultar/mostrar en el gestor de galería.
export const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
export const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A11 11 0 0 1 12 5c7 0 10.5 7 10.5 7a13.9 13.9 0 0 1-3.2 4.2M6.6 6.6C3.5 8.5 1.5 12 1.5 12s3.5 7 10.5 7a10 10 0 0 0 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'

/** Metadatos visuales por tipo de bloque del landing builder (pagina-publica/landing.vue). */
export const BLOCK_TYPE_ICONS: Record<string, string> = {
  hero: ICON_SUNRISE,
  'trust-badges': ICON_SHIELD_CHECK,
  storytelling: ICON_BOOK,
  gallery: ICON_IMAGE,
  amenities: AMENITY_ICON_SVGS.pool,
  location: ICON_PIN,
  reviews: ICON_STAR,
  rooms: ICON_BED,
  faq: ICON_QUESTION,
  policies: ICON_CLIPBOARD,
  cta: ICON_SPARKLES,
  footer: ICON_FOOTER,
}

export function amenityIcon(key: string): string {
  const k = key.toLowerCase().trim().replace(/\s+/g, '_')
  const canonical = AMENITY_ALIASES[k] ?? k
  return AMENITY_ICON_SVGS[canonical as keyof typeof AMENITY_ICON_SVGS] ?? AMENITY_ICON_SVGS.fallback
}

export function trustIcon(key: string): string {
  return TRUST_ICONS[key] ?? TRUST_ICONS.fallback
}

/** Fila de N/5 estrellas como SVG concatenado (llenas hasta `rating`, contorno el resto) — usado
 *  por ReviewsBlock.vue/AggregateScore.vue (rating de reseñas, sobre 5). Reemplaza
 *  `'★'.repeat(n)` (glyph tipográfico, inconsistente entre fuentes/SO a tamaños chicos). */
export function starRow(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)))
  let html = ''
  for (let i = 0; i < 5; i++) html += i < filled ? ICON_STAR : ICON_STAR_OUTLINE
  return html
}

/** Fila de N estrellas LLENAS sin remanente en contorno — clasificación del hotel (ej. hotel
 *  4 estrellas = 4 íconos llenos, no "4 llenas + 1 vacía"). Semántica distinta a `starRow`
 *  (rating de reseñas sobre 5) — usado por HeroBlock.vue. */
export function filledStarRow(count: number): string {
  const n = Math.max(0, Math.min(5, Math.round(count)))
  return ICON_STAR.repeat(n)
}
