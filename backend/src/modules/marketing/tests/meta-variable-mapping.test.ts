// marketing/tests/meta-variable-mapping.test.ts — Traducción del cuerpo local al formato de Meta.
import { describe, it, expect } from 'bun:test'
import { toMetaBody, metaTemplateName, metaBodyProblem, buildTemplateComponents } from '../usecases/meta-variable-mapping'

describe('toMetaBody', () => {
  it('renumera las variables por orden de aparición', () => {
    const r = toMetaBody('Hola {guest_name}, tu check-in es el {checkin_date}')
    expect(r.metaBody).toBe('Hola {{1}}, tu check-in es el {{2}}')
    expect(r.variableOrder).toEqual(['guest_name', 'checkin_date'])
  })

  // Meta permite repetir un parámetro; el hotel espera que el nombre del huésped sea el mismo las
  // dos veces. Numerarlo dos veces obligaría a mandar el valor duplicado y confundiría el orden.
  it('una variable repetida reusa su número', () => {
    const r = toMetaBody('Hola {guest_name}. Te esperamos, {guest_name}.')
    expect(r.metaBody).toBe('Hola {{1}}. Te esperamos, {{1}}.')
    expect(r.variableOrder).toEqual(['guest_name'])
  })

  it('un cuerpo sin variables queda igual y sin orden', () => {
    const r = toMetaBody('Gracias por tu reserva.')
    expect(r.metaBody).toBe('Gracias por tu reserva.')
    expect(r.variableOrder).toEqual([])
    expect(r.samples).toEqual([])
  })

  it('una variable desconocida recibe un valor de muestra genérico', () => {
    const r = toMetaBody('Hola {no_existe}, gracias')
    expect(r.variableOrder).toEqual(['no_existe'])
    expect(r.samples).toEqual(['Ejemplo'])
  })

  it('las variables conocidas traen su valor de muestra', () => {
    const r = toMetaBody('Hola {guest_name} en {hotel_name}')
    expect(r.samples).toEqual(['María García', 'Hotel Paraíso'])
  })
})

describe('metaTemplateName', () => {
  it('convierte un nombre humano en el identificador que Meta acepta', () => {
    expect(metaTemplateName('Confirmación de reserva')).toBe('confirmacion_de_reserva')
  })

  it('colapsa signos y espacios repetidos', () => {
    expect(metaTemplateName('  ¡Bienvenida!!  ')).toBe('bienvenida')
  })

  // Un nombre que queda en nada (solo emojis o signos) rompería el POST con un error opaco de Meta.
  it('nunca devuelve vacío', () => {
    expect(metaTemplateName('***')).toBe('plantilla')
  })
})

describe('metaBodyProblem', () => {
  it('acepta un cuerpo válido', () => {
    expect(metaBodyProblem('Hola {{1}}, gracias')).toBeNull()
  })

  it('rechaza el cuerpo vacío', () => {
    expect(metaBodyProblem('   ')).toContain('vacío')
  })

  // Las tres reglas de forma de Meta. Sin este chequeo, Meta responde "Invalid parameter" sin decir
  // cuál es el problema, y cada rechazo queda en el historial de la cuenta del hotel.
  it('rechaza empezar con una variable', () => {
    expect(metaBodyProblem('{{1}} bienvenido')).toContain('EMPIECE')
  })

  it('rechaza terminar con una variable', () => {
    expect(metaBodyProblem('Tu código es {{1}}')).toContain('TERMINE')
  })

  it('rechaza dos variables seguidas', () => {
    expect(metaBodyProblem('Hola {{1}} {{2}} gracias')).toContain('dos variables seguidas')
  })

  it('rechaza un cuerpo de más de 1024 caracteres', () => {
    expect(metaBodyProblem('a'.repeat(1025))).toContain('1024')
  })
})

describe('buildTemplateComponents', () => {
  it('incluye los ejemplos cuando hay variables', () => {
    const c = buildTemplateComponents(toMetaBody('Hola {guest_name}, gracias'))
    expect(c[0].type).toBe('BODY')
    expect(c[0].example).toEqual({ body_text: [['María García']] })
  })

  // Mandar `example` vacío es un error de la API de Meta, no una sutileza de estilo.
  it('omite los ejemplos cuando no hay variables', () => {
    const c = buildTemplateComponents(toMetaBody('Gracias por tu reserva.'))
    expect(c[0].example).toBeUndefined()
  })
})
