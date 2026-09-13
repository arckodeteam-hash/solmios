// landing-theme.test.ts — helpers puros del theme público (landing + card "Your stay", #381).
import { describe, it, expect } from 'vitest'
import { PRESET_MAP } from '@/types/landing'
import type { LandingTheme } from '@/types/landing'
import {
  mergeThemeTokens, themeToCssVars, parseHexColor, relativeLuminance,
  darkestThemeColor, contrastTextColor,
} from './landing-theme'

describe('parseHexColor', () => {
  it('acepta #RGB y #RRGGBB en mayúsculas o minúsculas', () => {
    expect(parseHexColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('#0d2b4e')).toEqual({ r: 13, g: 43, b: 78 })
    expect(parseHexColor('#0D2B4E')).toEqual({ r: 13, g: 43, b: 78 })
  })
  it('rechaza lo que no es hex', () => {
    expect(parseHexColor('red')).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
    expect(parseHexColor('0D2B4E')).toBeNull()
    expect(parseHexColor('')).toBeNull()
    expect(parseHexColor(null)).toBeNull()
  })
})

describe('mergeThemeTokens — preset + overrides', () => {
  it('sin theme → classic completo', () => {
    expect(mergeThemeTokens(null)).toEqual(PRESET_MAP.classic)
    expect(mergeThemeTokens(undefined)).toEqual(PRESET_MAP.classic)
  })
  it('templateId desconocido → cae a classic', () => {
    const theme = { templateId: 'nope' } as unknown as LandingTheme
    expect(mergeThemeTokens(theme)).toEqual(PRESET_MAP.classic)
  })
  it('el override puntual pisa el token del preset y deja el resto intacto', () => {
    const merged = mergeThemeTokens({ templateId: 'modern', colors: { gold: '#123456' } })
    expect(merged).toEqual({ ...PRESET_MAP.modern, gold: '#123456' })
  })
  it('override vacío o no-hex NO pisa el preset', () => {
    const merged = mergeThemeTokens({
      templateId: 'classic',
      colors: { navy: '', cyan: '   ', gold: 'red', teal: '#12', blue: undefined },
    })
    expect(merged).toEqual(PRESET_MAP.classic)
  })
  it('no devuelve la misma referencia del preset (no muta PRESET_MAP)', () => {
    const merged = mergeThemeTokens({ templateId: 'classic' })
    merged.navy = '#000000'
    expect(PRESET_MAP.classic.navy).toBe('#0D2B4E')
  })
})

describe('themeToCssVars — camelCase → --color-kebab', () => {
  it('null → las 10 custom properties del classic', () => {
    expect(themeToCssVars(null)).toEqual({
      '--color-navy': '#0D2B4E',
      '--color-navy-light': '#1A3A5C',
      '--color-blue': '#1D67E3',
      '--color-cyan': '#00B4D8',
      '--color-cyan-light': '#48CAE4',
      '--color-teal': '#117A65',
      '--color-gold': '#B7950B',
      '--color-gold-light': '#D4AC0D',
      '--color-surface': '#F8FAFC',
      '--color-surface-dark': '#F1F5F9',
    })
  })
  it('mapea navyLight/surfaceDark a kebab con el override aplicado', () => {
    const vars = themeToCssVars({
      templateId: 'boutique',
      colors: { navyLight: '#ABCDEF', surfaceDark: '#fed' },
    })
    expect(vars['--color-navy-light']).toBe('#ABCDEF')
    expect(vars['--color-surface-dark']).toBe('#fed')
    expect(vars['--color-navy']).toBe(PRESET_MAP.boutique.navy)
    expect(Object.keys(vars)).toHaveLength(10)
  })
  it('un override inválido cae al preset en vez de llegar al CSS', () => {
    const vars = themeToCssVars({ templateId: 'classic', colors: { navy: 'rgb(0,0,0)' } })
    expect(vars['--color-navy']).toBe('#0D2B4E')
  })
})

describe('relativeLuminance — WCAG 2', () => {
  it('blanco = 1, negro = 0', () => {
    expect(relativeLuminance('#FFFFFF')).toBe(1)
    expect(relativeLuminance('#000000')).toBe(0)
  })
  it('#RGB equivale a su #RRGGBB', () => {
    expect(relativeLuminance('#fff')).toBe(1)
    expect(relativeLuminance('#0D2B4E')).toBeCloseTo(0.0236, 3)
  })
  it('hex inválido → 1 (nunca es el más oscuro)', () => {
    expect(relativeLuminance('rojo')).toBe(1)
    expect(relativeLuminance(null)).toBe(1)
  })
})

describe('darkestThemeColor', () => {
  it('classic sin overrides → navy #0D2B4E', () => {
    expect(darkestThemeColor(null)).toBe('#0D2B4E')
    expect(darkestThemeColor({ templateId: 'classic' })).toBe('#0D2B4E')
  })
  it('un override más oscuro que el navy gana', () => {
    expect(darkestThemeColor({ templateId: 'classic', colors: { gold: '#000000' } })).toBe('#000000')
  })
  it('un override roto no gana: cae al preset', () => {
    expect(darkestThemeColor({ templateId: 'classic', colors: { gold: 'black' } })).toBe('#0D2B4E')
  })
  it('en empate gana el primero en el orden de ThemeTokens', () => {
    expect(darkestThemeColor({ templateId: 'classic', colors: { navy: '#000000', gold: '#000' } })).toBe('#000000')
  })
})

describe('contrastTextColor', () => {
  it('fondo oscuro → blanco; fondo claro → navy classic', () => {
    expect(contrastTextColor('#0D2B4E')).toBe('#FFFFFF')
    expect(contrastTextColor('#000000')).toBe('#FFFFFF')
    expect(contrastTextColor('#F8FAFC')).toBe('#0D2B4E')
    expect(contrastTextColor('#FFFFFF')).toBe('#0D2B4E')
  })
  it('hex inválido → se trata como claro (navy)', () => {
    expect(contrastTextColor('nope')).toBe('#0D2B4E')
  })
})
