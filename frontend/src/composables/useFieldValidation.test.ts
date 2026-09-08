// useFieldValidation.test.ts — GH-70: el campo Logo tenía `type: 'url'`, pero el uploader de la
// propia app (POST /api/settings/logo) guarda una ruta relativa como '/uploads/hotel-logos/x.png'.
// Como `saveAll()` revalida TODO el formulario con validateAll(form, HOTEL_RULES) y aborta si algo
// falla, subir el logo desde la pantalla dejaba el campo en rojo y bloqueaba el guardado de
// CUALQUIER ajuste de Configuración.
//
// Estos tests fijan el tipo `image-src` (URL http(s), ruta del sitio o data URL) y, sobre todo,
// que `website` conservó la regla estricta: aflojarla de más volvería a divergir del backend.
import { describe, it, expect } from 'vitest'
import { validateField, validateAll, HOTEL_RULES } from './useFieldValidation'

const logoRule = HOTEL_RULES.logo!
const websiteRule = HOTEL_RULES.website!

// data URL corto de verdad (1x1 gif): el mismo formato que produce FileReader en la preview.
const DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

describe('validateField — logo (image-src)', () => {
  it('acepta la ruta que devuelve el uploader de la app', () => {
    expect(validateField('/uploads/hotel-logos/1788905139044-a7v2xx1k7.png', logoRule)).toBe('')
  })

  it('acepta un data URL de imagen (el de la previsualización)', () => {
    expect(validateField(DATA_URL, logoRule)).toBe('')
  })

  it('acepta una URL http(s) de un logo alojado afuera', () => {
    expect(validateField('https://cdn.ejemplo.com/logo.png', logoRule)).toBe('')
    expect(validateField('http://cdn.ejemplo.com/logo.png', logoRule)).toBe('')
  })

  it('sigue rechazando lo que no es ninguna de las tres formas', () => {
    expect(validateField('cualquier texto', logoRule)).not.toBe('')
    expect(validateField('ftp://x', logoRule)).not.toBe('')
    expect(validateField('logo.png', logoRule)).not.toBe('')   // sin barra inicial no es ruta del sitio
  })

  it('vacío es válido: el logo es opcional', () => {
    expect(validateField('', logoRule)).toBe('')
    expect(validateField(undefined, logoRule)).toBe('')
  })

  it('el mensaje de error nombra el campo, para que el usuario sepa cuál corregir', () => {
    expect(validateField('cualquier texto', logoRule)).toContain('Logo')
  })
})

describe('validateField — website conserva la regla estricta', () => {
  it('sigue exigiendo http:// o https://', () => {
    expect(validateField('/uploads/x', websiteRule)).not.toBe('')
    expect(validateField(DATA_URL, websiteRule)).not.toBe('')
    expect(validateField('cualquier texto', websiteRule)).not.toBe('')
  })

  it('acepta una URL normal', () => {
    expect(validateField('https://hotel.ejemplo.com', websiteRule)).toBe('')
  })
})

describe('validateAll con HOTEL_RULES — el guardado ya no queda bloqueado', () => {
  const base = { name: 'Hotel Test', country: 'República Dominicana' }

  it('un formulario con el logo recién subido no reporta errores', () => {
    const errors = validateAll({ ...base, logo: '/uploads/hotel-logos/x.png' }, HOTEL_RULES)
    expect(errors).toEqual({})
  })

  it('un logo con basura sí frena el guardado', () => {
    const errors = validateAll({ ...base, logo: 'cualquier texto' }, HOTEL_RULES)
    expect(errors.logo).toBeTruthy()
  })
})
