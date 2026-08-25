// El alta perdía el país en silencio: el formulario lo mandaba, pero SignupSchema
// no lo declaraba y `validateSchema` devuelve SOLO los campos del schema, así que
// el campo moría en el controller sin error ni log — el hotel se creaba con
// country vacío.
//
// Los tests del usecase no cubren esto: llaman a signup() directo con un objeto
// armado a mano, salteando la validación. Este archivo cubre esa capa: que todo
// lo que el formulario manda sobreviva a validateSchema.
import { describe, it, expect } from 'bun:test'
import { validateSchema } from 'arckode-framework'
import { SignupSchema } from '../validators/schema'

/** Exactamente lo que manda frontend/src/pages/auth/register.vue. */
const FROM_FORM = {
  hotelName: 'Hotel Prueba',
  email: 'dueno@ejemplo.com',
  password: 'unaClave123',
  ownerName: 'Ana Pérez',
  country: 'España',
  address: 'Barcelona',
  phone: '+34 600 000 000',
  planId: 'plan-starter',
}

describe('SignupSchema', () => {
  it('no descarta ningún campo del formulario de alta', () => {
    const out = validateSchema(SignupSchema, FROM_FORM) as Record<string, unknown>

    for (const key of Object.keys(FROM_FORM)) {
      expect(out).toHaveProperty(key)
    }
  })

  it('conserva el país: es el campo que se perdía', () => {
    const out = validateSchema(SignupSchema, FROM_FORM) as any
    expect(out.country).toBe('España')
  })

  it('el país es opcional: sin él el alta sigue siendo válida', () => {
    const { country, ...sinPais } = FROM_FORM
    const out = validateSchema(SignupSchema, sinPais) as any
    expect(out.hotelName).toBe('Hotel Prueba')
    expect(out.country).toBeUndefined()
  })

  it('rechaza un país absurdamente largo en vez de truncarlo al guardar', () => {
    expect(() => validateSchema(SignupSchema, { ...FROM_FORM, country: 'x'.repeat(81) }))
      .toThrow()
  })

  // CS-3: un alta sin plan creaba una suscripción trialing con planId vacío y el gate la
  // resolvía como "sin matriz" → el hotel entraba con TODO el panel. Ahora rebota acá,
  // con un mensaje que dice qué falta (registro que no cargó los planes por red/API).
  it('planId obligatorio: sin él el alta rebota con "Elegí un plan..." (CS-3)', () => {
    const { planId, ...sinPlan } = FROM_FORM
    let thrown: any
    try { validateSchema(SignupSchema, sinPlan) } catch (e) { thrown = e }
    expect(thrown?.fields?.planId).toContain('Elegí un plan para empezar tu prueba')
  })

  it('planId vacío o de espacios también rebota (required solo cubre undefined/null)', () => {
    for (const vacio of ['', '   ']) {
      let thrown: any
      try { validateSchema(SignupSchema, { ...FROM_FORM, planId: vacio }) } catch (e) { thrown = e }
      expect(thrown?.fields?.planId).toContain('Elegí un plan para empezar tu prueba')
    }
  })
})
