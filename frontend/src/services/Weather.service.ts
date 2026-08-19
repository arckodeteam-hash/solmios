// services/Weather.service.ts — Clima actual para el header del dashboard.
//
// Por qué existe: el dashboard hacía `fetch('https://api.open-meteo.com/...')` inline dentro
// del componente. Eso rompía dos cosas a la vez —
//   1. la regla del proyecto "NUNCA fetch() en componentes → XxxService.method()", y
//   2. dejaba el proveedor externo clavado en el código: sin forma de apuntar a un proxy
//      propio (ni de apagarlo) sin recompilar el frontend.
//
// El endpoint es configurable por build (`VITE_WEATHER_API_URL`). El default es Open-Meteo
// porque no pide API key; si se define vacío, el clima simplemente no se muestra.
// NO pasa por `http.ts` a propósito: ese cliente prefija `/api` y adjunta el JWT del hotel,
// que no debe viajar a un tercero.

export interface WeatherInfo {
  temp: number
  label: string
  icon: string
}

/** Endpoint del proveedor de clima. Vacío = feature apagada: `current()` devuelve null y el
 *  pill del header queda en su estado "No disponible" (no se oculta). */
const WEATHER_API_URL = import.meta.env.VITE_WEATHER_API_URL ?? 'https://api.open-meteo.com/v1/forecast'

/** Códigos WMO 4677 agrupados por condición. https://open-meteo.com/en/docs */
const WMO_CONDITIONS: Array<{ codes: number[]; label: string; icon: string }> = [
  { codes: [0], label: 'Despejado', icon: '☀️' },
  { codes: [1, 2], label: 'Parcialmente nublado', icon: '⛅' },
  { codes: [3], label: 'Nublado', icon: '☁️' },
  { codes: [45, 48], label: 'Niebla', icon: '🌫️' },
  { codes: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67], label: 'Lluvia', icon: '🌧️' },
  { codes: [71, 73, 75, 77, 85, 86], label: 'Nieve', icon: '❄️' },
  { codes: [80, 81, 82], label: 'Chubascos', icon: '🌦️' },
  { codes: [95, 96, 99], label: 'Tormenta', icon: '⛈️' },
]

const UNKNOWN_CONDITION = { label: 'Clima', icon: '🌤️' }

function conditionOf(code: unknown) {
  const n = Number(code)
  if (!Number.isFinite(n)) return UNKNOWN_CONDITION
  return WMO_CONDITIONS.find(c => c.codes.includes(n)) ?? UNKNOWN_CONDITION
}

export const WeatherService = {
  /**
   * Clima actual en unas coordenadas. Devuelve `null` —sin tirar— si el hotel no tiene
   * coordenadas cargadas, si la feature está apagada, o si el proveedor falla: el clima es
   * decorativo y nunca debe tumbar el render del dashboard.
   */
  async current(latitude?: number | string | null, longitude?: number | string | null): Promise<WeatherInfo | null> {
    const lat = Number(latitude)
    const lon = Number(longitude)
    // `0` es una coordenada válida en teoría (Golfo de Guinea), pero en esta base es el
    // default del modelo `hotels` → significa "sin localizar", no "en el ecuador".
    if (!WEATHER_API_URL || !lat || !lon) return null

    try {
      const url = `${WEATHER_API_URL}?latitude=${lat}&longitude=${lon}&current_weather=true`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      const cw = data?.current_weather
      if (!cw || !Number.isFinite(Number(cw.temperature))) return null
      const condition = conditionOf(cw.weathercode)
      return { temp: Number(cw.temperature), label: condition.label, icon: condition.icon }
    } catch {
      return null
    }
  },
}
