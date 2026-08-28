// domain-verification.test.ts — El meta de verificación de dominio de Meta no puede desaparecer.
//
// Vive en `index.html` y no lo escribe ningún componente, así que nada del código de la app lo
// referencia: es exactamente el tipo de línea que un refactor del `<head>` se lleva puesta sin
// que falle nada. Cuando eso pasa, Meta revoca la verificación del dominio y se cae el Pixel, el
// catálogo y los permisos de anuncios — pero recién se nota semanas después, en Business Manager.
//
// Se lee el archivo fuente a propósito: es lo que Vite copia tal cual al `dist/`, y es lo que el
// crawler de Meta va a leer. El crawler NO ejecuta la SPA, así que un meta puesto por JS
// (`usePageMeta`) no serviría para esto.
import { describe, it, expect } from 'vitest'
// `?raw` de Vite en vez de `node:fs`: el tsconfig del frontend no incluye los tipos de Node, y
// esto además ata el test al MISMO archivo que Vite copia al `dist/`.
import html from '../../../index.html?raw'

describe('index.html — verificación de dominio de Meta', () => {
  it('el meta está presente en el HTML servido (no inyectado por JS)', () => {
    expect(html).toContain('name="facebook-domain-verification"')
  })

  // Pasó de verdad: dos sesiones agregaron el mismo meta en posiciones distintas del <head> y el
  // rebase no lo marcó como conflicto. Repetirlo no verifica dos veces — sólo ensucia el <head> y
  // esconde cuál es el token vigente el día que haya que rotarlo.
  it('aparece UNA sola vez', () => {
    const veces = html.match(/name="facebook-domain-verification"/g)?.length ?? 0
    expect(veces).toBe(1)
  })

  it('conserva el token exacto que emitió Business Manager', () => {
    const match = html.match(/<meta\s+name="facebook-domain-verification"\s+content="([^"]+)"/)
    expect(match?.[1]).toBe('jsbyldr610laxecqusawj9gauexmaz')
  })

  it('está dentro del <head>: fuera de ahí el crawler no lo lee', () => {
    const headEnd = html.indexOf('</head>')
    expect(headEnd).toBeGreaterThan(-1)
    expect(html.indexOf('facebook-domain-verification')).toBeLessThan(headEnd)
  })
})
