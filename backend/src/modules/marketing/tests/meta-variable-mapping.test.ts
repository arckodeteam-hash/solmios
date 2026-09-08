// marketing/tests/meta-variable-mapping.test.ts — Traducción del cuerpo local al formato de Meta.
import { describe, it, expect } from 'bun:test'
import { toMetaBody, metaTemplateName, metaBodyProblem, buildTemplateComponents, VARIABLES_CONOCIDAS } from '../usecases/meta-variable-mapping'
import { PLANTILLAS_BASE } from '../usecases/plantillas-base'

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

  // Regresión (2026-09-07): la primera versión miraba el final literal, así que un punto detrás de
  // la variable la dejaba pasar y Meta la rechazaba igual — con un 500 genérico del lado del panel.
  // Probado contra la API real: "Las variables no pueden estar al principio ni al final".
  it('rechaza terminar con una variable AUNQUE haya un punto después', () => {
    expect(metaBodyProblem('Tu habitación es la {{3}}.')).toContain('TERMINE')
    expect(metaBodyProblem('Tu habitación es la {{3}}!')).toContain('TERMINE')
    expect(metaBodyProblem('Tu habitación es la {{3}} ')).toContain('TERMINE')
  })

  it('acepta una variable al final si hay texto después del punto', () => {
    expect(metaBodyProblem('Tu habitación es la {{3}}. Te esperamos.')).toBeNull()
  })

  it('rechaza empezar con una variable después de un signo de apertura', () => {
    expect(metaBodyProblem('¡{{1}} bienvenido!')).toContain('EMPIECE')
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

// ─────────────────────────────────────────────────────────────────────────────
// Plantillas recomendadas
// ─────────────────────────────────────────────────────────────────────────────

describe('PLANTILLAS_BASE', () => {
  // El sentido de estas plantillas es que el hotel no tenga que aprenderse las reglas de Meta.
  // Si una del catálogo saliera rechazada, el atajo sería peor que escribirlas a mano.
  it('todas pasan las reglas de forma de Meta', () => {
    for (const p of PLANTILLAS_BASE) {
      const problema = metaBodyProblem(toMetaBody(p.body).metaBody)
      expect(problema, `"${p.name}": ${problema}`).toBeNull()
    }
  })

  // La lista sale de VARIABLES_CONOCIDAS, no de una copia acá: una segunda lista se desincroniza
  // y el test empieza a rebotar plantillas correctas (o a dejar pasar rotas).
  it('todas usan variables que el PMS sabe resolver', () => {
    const conocidas = new Set(VARIABLES_CONOCIDAS)
    for (const p of PLANTILLAS_BASE) {
      for (const v of toMetaBody(p.body).variableOrder) {
        expect(conocidas.has(v), `"${p.name}" usa {${v}}, que nadie resuelve`).toBe(true)
      }
    }
  })

  it('los nombres se convierten en identificadores válidos y distintos', () => {
    const slugs = PLANTILLAS_BASE.map(p => metaTemplateName(p.name))
    expect(new Set(slugs).size).toBe(PLANTILLAS_BASE.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9_]+$/)
  })

  // MARKETING cuesta más y se rechaza mucho más seguido: solo donde de verdad corresponde.
  it('ninguna se declara MARKETING sin necesidad', () => {
    for (const p of PLANTILLAS_BASE) {
      expect(['UTILITY', 'MARKETING']).toContain(p.metaCategory)
    }
  })

  // Regresión (2026-09-07, probado contra Meta): una plantilla UTILITY que entrega una credencial
  // se rechaza al instante con INCORRECT_CATEGORY — Meta la quiere AUTHENTICATION, y esa categoría
  // solo admite el formato fijo de código de verificación. El código se manda por texto libre
  // dentro de la ventana de 24 h, no por plantilla.
  it('ninguna entrega credenciales: Meta las rechaza por categoría', () => {
    const credenciales = ['wifi_password', 'lock_codes']
    for (const p of PLANTILLAS_BASE) {
      for (const v of toMetaBody(p.body).variableOrder) {
        expect(credenciales.includes(v), `"${p.name}" entrega {${v}}: Meta la va a rechazar`).toBe(false)
      }
    }
  })

  // Y no alcanza con no mandar el dato: MENCIONARLO basta. "te pasamos el código de acceso" fue
  // rechazada con INCORRECT_CATEGORY igual que la que lo entregaba (probado 2026-09-07).
  //
  // La regla es sobre credenciales de ACCESO, no sobre la palabra "código": "tu código de reserva
  // es {locator}" pasó sin problema — es un localizador, no una llave. Este test cubre lo que la
  // evidencia sostiene, ni más ni menos.
  it('ninguna menciona claves ni códigos de acceso', () => {
    const credencial = /\b(clave|contrase[nñ]a|pin)\b|c[oó]digo\s+(de\s+)?(acceso|la\s+puerta|entrada|wifi)/i
    for (const p of PLANTILLAS_BASE) {
      expect(credencial.test(p.body), `"${p.name}" menciona una credencial de acceso`).toBe(false)
    }
  })
})
