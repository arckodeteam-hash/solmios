export type LlmProvider = 'deepseek' | 'zai' | 'openai' | 'ollama'

export interface LlmConfig {
  provider: LlmProvider
  model: string
  apiKey?: string
  baseUrl?: string
  temperature: number
  maxTokens: number
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const DEFAULT_CONFIGS: Record<LlmProvider, { endpoint: string; model: string }> = {
  deepseek: { endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  zai: { endpoint: 'https://api.z.ai/api/coding/paas/v4', model: 'glm-4' },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' },
  ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'qwen3:14b' },
}

function buildBody(cfg: LlmConfig, messages: LlmMessage[], tools?: LlmToolDefinition[]) {
  const defaults = DEFAULT_CONFIGS[cfg.provider]
  return {
    model: cfg.model || defaults.model,
    messages,
    temperature: cfg.temperature ?? 0.7,
    max_tokens: cfg.maxTokens ?? 1024,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
  }
}

export async function llmChat(
  cfg: LlmConfig,
  messages: LlmMessage[],
  tools?: LlmToolDefinition[],
): Promise<{ content: string; toolCalls?: { name: string; arguments: Record<string, unknown> }[] }> {
  const defaults = DEFAULT_CONFIGS[cfg.provider]
  const endpoint = cfg.baseUrl || defaults.endpoint

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (cfg.provider !== 'ollama') {
    const key = cfg.apiKey || process.env.LLM_API_KEY || ''
    headers['Authorization'] = `Bearer ${key}`
  }

  const body = buildBody(cfg, messages, tools)
  console.log(`[LLM] tools=${tools?.length || 0} messages=${messages.length}`)

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.log(`[LLM] ERROR ${res.status}: ${errText.slice(0, 200)}`)
    throw new Error(`LLM ${cfg.provider} error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const json: any = await res.json()
  const choice = json.choices?.[0]
  const msg = choice?.message

  if (!msg) throw new Error(`LLM ${cfg.provider}: respuesta vacía`)

  const result: { content: string; toolCalls?: { name: string; arguments: Record<string, unknown> }[] } = {
    content: msg.content || '',
  }

  if (msg.tool_calls?.length) {
    result.toolCalls = msg.tool_calls.map((tc: any) => ({
      name: tc.function?.name || '',
      arguments: (() => {
        try { return JSON.parse(tc.function?.arguments || '{}') }
        catch { return {} }
      })(),
    }))
  }

  return result
}

export function buildSystemPrompt(hotelName: string, botName: string, language: string, intentsList: string): string {
  return `Sos ${botName}, recepcionista y asesora de reservas de ${hotelName}. Hablás por WhatsApp en español.

Tu rol: recepcionista virtual. Tu trabajo es:
1. DAR LA BIENVENIDA cálida
2. INFORMAR sobre habitaciones, amenities, servicios, precios
3. AYUDAR a reservar (buscar disponibilidad, explicar opciones, cerrar la venta)
4. ADMINISTRAR reservas (modificar, cancelar, consultar)
5. RESOLVER quejas con empatía
6. UPSELL: ofrecer desayuno ($15/pers), traslado ($40), spa, late checkout
7. GENERAR LINK DE PAGO después de confirmar la reserva
8. PREGUNTAR MÉTODO DE PAGO: tarjeta, transferencia, PayPal, efectivo

HERRAMIENTAS — SIEMPRE usá las herramientas. NUNCA inventes datos.
Cuando el huésped diga "transferencia" o "banco", DEBÉS llamar get_payment_methods.
Cuando diga "tarjeta" o "link", DEBÉS llamar generate_payment_link.
NUNCA digas "te transfiero a un humano" para temas de pago.

REGLAS:
- SOLO trabajás en ${hotelName}. NO existen otros hoteles.
- Describí habitaciones con AMENITIES cuando pregunte
- Si dice "quiero reservar", guialo: fechas → tipo → datos → CREAR RESERVA
- Cuando tengas todos los datos, CREÁ la reserva SIN pedir confirmación extra
- DESPUÉS de crear la reserva, preguntá: "¿Cómo preferís pagar?"
- Si dice TARJETA → llamá generate_payment_link y pasá el link
- Si dice TRANSFERENCIA → llamá get_payment_methods y pasá datos bancarios
- Si dice PAYPAL → pasá link de PayPal
- Si dice EFECTIVO → "Perfecto, pagás al check-in"
- Si sube voucher → "Recibido, lo verificamos"
- Emergencia médica → escalar

Estilo:
- Natural, cálida, como WhatsApp real
- NO "Estimado cliente". Decí "¡Hola!", "¡Claro!", "Dale"
- 1-3 oraciones, cada vez diferente

Habitaciones (describí con amenities cuando consulten):
- Simple ($65/noche, 1 pers): WiFi, TV 42", AC, baño privado, caja fuerte
- Doble ($85/noche, 2 pers): WiFi, TV 50", AC, baño con jacuzzi, balkón
- Suite ($155/noche, 2 pers): WiFi, TV 55", AC, sala de estar, jacuzzi privado, balkón con vista, minibar
- Familiar ($120/noche, 4 pers): WiFi, TV 50", AC, 2 baños, zona de estar, cama extra

Servicios:
- Check-in 14:00 / Check-out 12:00
- WiFi: hotel_guest / welcome2024 (gratis)
- Desayuno: 7am-10am, $15/pers
- Restaurante: 7am-10pm + room service
- Piscina: 8am-8pm
- Estacionamiento: gratis
- Traslado aeropuerto: $40
- Spa: masajes desde $50

Intenciones: ${intentsList}`
}

export const RECEPTIONIST_TOOLS: LlmToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_availability',
      description: 'Buscar habitaciones disponibles en el hotel para fechas específicas',
      parameters: {
        type: 'object',
        properties: {
          checkIn: { type: 'string', description: 'Fecha de entrada (YYYY-MM-DD)' },
          checkOut: { type: 'string', description: 'Fecha de salida (YYYY-MM-DD)' },
          adults: { type: 'number', description: 'Número de adultos' },
        },
        required: ['checkIn', 'checkOut'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reservation',
      description: 'Crear una reserva por TIPO de habitación (double, single, suite, family). La habitación concreta se asigna en recepción al check-in, no acá: nunca prometas un número de habitación.',
      parameters: {
        type: 'object',
        properties: {
          roomId: { type: 'string', description: 'ID de una habitación de search_availability (opcional): sólo sirve para deducir el tipo, no se reserva esa unidad' },
          roomType: { type: 'string', enum: ['single', 'double', 'suite', 'family'], description: 'Tipo de habitación a reservar' },
          checkIn: { type: 'string', description: 'Fecha entrada YYYY-MM-DD' },
          checkOut: { type: 'string', description: 'Fecha salida YYYY-MM-DD' },
          guestName: { type: 'string', description: 'Nombre completo del huésped' },
          guestEmail: { type: 'string', description: 'Email del huésped' },
          guestPhone: { type: 'string', description: 'Teléfono del huésped' },
          adults: { type: 'number', description: 'Número de adultos' },
        },
        required: ['checkIn', 'checkOut', 'guestName', 'guestEmail'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reservation',
      description: 'Consultar datos de una reserva por email o ID',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          reservationId: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_reservation',
      description: 'Cancelar una reserva existente',
      parameters: {
        type: 'object',
        properties: {
          reservationId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['reservationId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hotel_info',
      description: 'Obtener información del hotel: wifi, horarios, amenities, servicios',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_payment_link',
      description: 'Generar link de pago para una reserva. Creá el link y pasáselo al huésped.',
      parameters: {
        type: 'object',
        properties: {
          reservationId: { type: 'string', description: 'ID de la reserva' },
          amount: { type: 'number', description: 'Monto a cobrar' },
          description: { type: 'string', description: 'Descripción del cobro' },
        },
        required: ['reservationId', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_methods',
      description: 'Obtener métodos de pago disponibles y datos bancarios del hotel para transferencias.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description: 'Transferir la conversación a un recepcionista humano',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Razón del escalamiento' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_incident',
      description: 'Registrar una incidencia o queja del huésped',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['maintenance', 'housekeeping', 'complaint', 'other'] },
          description: { type: 'string' },
          roomNumber: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        },
        required: ['type', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_invoice',
      description: 'Generar factura para una reserva. Creá la factura y pasásela al huésped.',
      parameters: {
        type: 'object',
        properties: {
          reservationId: { type: 'string', description: 'ID de la reserva' },
          paymentMethod: { type: 'string', enum: ['card', 'transfer', 'cash', 'paypal'], description: 'Método de pago' },
        },
        required: ['reservationId', 'paymentMethod'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_quote',
      description: 'Generar cotización para una estadía. Calcula precio total con servicios.',
      parameters: {
        type: 'object',
        properties: {
          roomType: { type: 'string', enum: ['single', 'double', 'suite', 'family'] },
          checkIn: { type: 'string', description: 'Fecha entrada YYYY-MM-DD' },
          checkOut: { type: 'string', description: 'Fecha salida YYYY-MM-DD' },
          adults: { type: 'number' },
          addBreakfast: { type: 'boolean', description: 'Agregar desayuno $15/pers/día' },
          addAirportTransfer: { type: 'boolean', description: 'Agregar traslado aeropuerto $40' },
        },
        required: ['roomType', 'checkIn', 'checkOut'],
      },
    },
  },
]
