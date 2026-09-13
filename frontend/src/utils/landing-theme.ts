// landing-theme.ts — Helpers puros del theme público del hotel (preset + overrides).
//
// Lo comparten la landing pública (hotel-landing.vue → CSS custom properties del <main>) y la
// card "Your stay" de la confirmación pública (#381: fondo = color más oscuro del theme, texto
// por contraste). Un solo cálculo para ambas pantallas: si el hoteliero cambia un color, la
// landing y la confirmación se mueven juntas.
import type { LandingTheme, ThemeTokens } from '@/types/landing'
import { PRESET_MAP } from '@/types/landing'

/** Orden canónico de los tokens (mismo que ThemeTokens): fija el desempate en `darkestThemeColor`. */
const TOKEN_KEYS: ReadonlyArray<keyof ThemeTokens> = [
  'navy', 'navyLight', 'blue', 'cyan', 'cyanLight', 'teal', 'gold', 'goldLight', 'surface', 'surfaceDark',
]

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * `#RGB` / `#RRGGBB` / `#RRGGBBAA` (mayúsc/minúsc) → {r,g,b} 0–255; el alfa se ignora (la
 * luminancia es la del color base). Cualquier otra cosa (`var(--x)`, nombres) → null.
 */
export function parseHexColor(hex: string | null | undefined): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null
  const value = hex.trim()
  if (!HEX_RE.test(value)) return null
  let digits = value.slice(1)
  if (digits.length === 3) digits = digits.split('').map(c => c + c).join('')
  if (digits.length === 8) digits = digits.slice(0, 6)
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  }
}

/**
 * mergeThemeTokens — PRESET_MAP[templateId] (default classic) pisado por `theme.colors`.
 * Pisa cualquier override que sea string no vacío (mismo criterio que tenía `themeCssVars` en
 * la landing): el backend ya valida el formato al guardar (hex 3/6/8 dígitos o `var(--token)`,
 * theme-crud.ts isValidColorString) y un `var(--x)` es un color legítimo para el CSS aunque
 * acá no se pueda medir su luminancia.
 */
export function mergeThemeTokens(theme: LandingTheme | null | undefined): ThemeTokens {
  const preset = (theme?.templateId && PRESET_MAP[theme.templateId]) || PRESET_MAP.classic
  const overrides: Partial<ThemeTokens> = theme?.colors ?? {}
  const merged: ThemeTokens = { ...preset }
  for (const key of TOKEN_KEYS) {
    const value = overrides[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    merged[key] = value
  }
  return merged
}

/**
 * themeToCssVars — tokens mergeados → `{ '--color-navy': '#...', '--color-navy-light': '#...' }`.
 * camelCase → kebab-case (surfaceDark → --color-surface-dark) para matchear los tokens `@theme`
 * de main.css: las utilities `bg-navy`/`text-cyan` compilan a `var(--color-navy)` y heredan el
 * override del contenedor donde se aplique el objeto como :style.
 */
export function themeToCssVars(theme: LandingTheme | null | undefined): Record<string, string> {
  const merged = mergeThemeTokens(theme)
  const vars: Record<string, string> = {}
  for (const key of TOKEN_KEYS) {
    const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase()
    vars[`--color-${kebab}`] = merged[key]
  }
  return vars
}

/** Canal sRGB 0–255 → lineal (WCAG 2.x). */
function linearizeChannel(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * relativeLuminance — WCAG 2: 0.2126·R + 0.7152·G + 0.0722·B sobre sRGB linealizado.
 * #FFFFFF → 1, #000000 → 0. Si el hex no parsea devuelve 1 (nunca gana como "el más oscuro").
 */
export function relativeLuminance(hex: string | null | undefined): number {
  const rgb = parseHexColor(hex)
  if (!rgb) return 1
  return 0.2126 * linearizeChannel(rgb.r) + 0.7152 * linearizeChannel(rgb.g) + 0.0722 * linearizeChannel(rgb.b)
}

/**
 * darkestThemeColor — el token de menor luminancia del theme mergeado (empate: gana el primero
 * en el orden de ThemeTokens). Classic sin overrides → '#0D2B4E' (navy). Es el fondo de la card
 * "Your stay" de la confirmación (#381).
 */
export function darkestThemeColor(theme: LandingTheme | null | undefined): string {
  const merged = mergeThemeTokens(theme)
  let darkest = merged[TOKEN_KEYS[0]]
  let min = relativeLuminance(darkest)
  for (const key of TOKEN_KEYS.slice(1)) {
    const lum = relativeLuminance(merged[key])
    if (lum < min) {
      min = lum
      darkest = merged[key]
    }
  }
  return darkest
}

/** Ratio de contraste WCAG 2 entre dos luminancias (1 = iguales, 21 = blanco/negro). */
function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = '#FFFFFF'

/**
 * Texto legible sobre `bgHex`: el que más contraste WCAG tenga entre blanco y navy classic.
 * No es un umbral fijo de luminancia: el cruce real blanco/navy está en ≈0.23, y con un corte
 * en 0.5 un fondo medio (luminancia 0.4) salía blanco con ≈2.3:1 cuando navy daba ≈6:1.
 * Hex inválido (`var(--x)`) → luminancia 1 → navy, el caso seguro sobre un fondo desconocido.
 */
export function contrastTextColor(bgHex: string | null | undefined): string {
  const bg = relativeLuminance(bgHex)
  const navy = PRESET_MAP.classic.navy
  return contrastRatio(bg, relativeLuminance(WHITE)) >= contrastRatio(bg, relativeLuminance(navy))
    ? WHITE
    : navy
}
