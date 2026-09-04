import type { AiIntentDTO, BotResponse } from '../types'
import { detectIntent } from './nlp-engine'
import { buildResponse } from './response-builder'
import type { LlmConfig, LlmMessage } from './llm-provider'
import { llmChat, buildSystemPrompt, RECEPTIONIST_TOOLS } from './llm-provider'
import { hotelCheckInTime, hotelCheckOutTime } from '../../../shared/utils/hotel-schedule'
import { assertReservationFitsCapacity } from '../../../shared/usecases/reservation-capacity'

/**
 * Puerto de cancelación hacia `reservas` (lo cablea `connectors/ai-recepcionista-reservas.ts`).
 * `ai-recepcionista` NO puede importar `reservas` → tipo estructural.
 *
 * Antes la tool hacía `reservationRepo.update(id, {status:'cancelled'})`: sin política, sin
 * snapshot y sin el evento `onReservationCancelled` que libera el depósito retenido. El puerto
 * hace la cancelación REAL (misma que el panel) y hace el guard de tenant del lado de reservas.
 */
export type ReservationCancelPort = (
  reservationId: string,
  hotelId: string,
  reason: string,
) => Promise<{ ok: boolean; error?: string; idempotent?: boolean; refundAmount?: number; cancellationFee?: number }>

export interface ToolRepos {
  roomRepo: any
  reservationRepo: any
  hotelRepo: any
  /** Cancelación real vía el módulo reservas. Ausente = la tool no puede cancelar (falla explícito). */
  cancelReservation?: ReservationCancelPort
  guestRepo?: any
  paymentLinkRepo?: any
  configRepo?: any
  invoiceRepo?: any
  logger?: { error?: (msg: string, meta?: Record<string, unknown>) => void }
  onReservationCreated?: (hotelId: string, roomId: string) => Promise<void>
}

export async function generateReply(
  message: string,
  intents: AiIntentDTO[],
  conversationHistory: { role: 'guest' | 'bot'; content: string }[],
  variables: Record<string, string>,
  llmConfig?: LlmConfig | null,
  toolRepos?: ToolRepos,
): Promise<BotResponse> {
  const nlpResult = detectIntent(message, intents)

  // Detect intent for actions (even if LLM will generate the text)
  const matchedIntent = nlpResult.intent
  const intentAction = matchedIntent?.action || undefined

  // Force tool calls for payment-related messages (LLM sometimes skips tools)
  const lowerMsg = message.toLowerCase()
  if (toolRepos && (lowerMsg.includes('transferencia') || lowerMsg.includes('transferir') || lowerMsg.includes('banco') || lowerMsg.includes('cbu') || lowerMsg.includes('alias') || lowerMsg.includes('datos bancario'))) {
    const paymentResult = await executeTool('get_payment_methods', {}, variables.hotelId || '', toolRepos)
    const bankInfo = paymentResult as any
    if (bankInfo?.bankDetails) {
      return {
        text: `¡Claro! Estos son los datos para transferir:\n\n🏦 **${bankInfo.bankDetails.bank}**\nTitular: ${bankInfo.bankDetails.holder}\nCTA: ${bankInfo.bankDetails.account}\nCBU: ${bankInfo.bankDetails.cbu}\nAlias: ${bankInfo.bankDetails.alias}\nCUIT: ${bankInfo.bankDetails.cuit}\n\nUna vez que transferís, subí el comprobante y lo confirmamos. ¡Gracias! 😊`,
        intentDetected: 'payment_transfer',
        confidence: 0.9,
        actionTaken: 'get_payment_methods',
        actionResult: bankInfo,
      }
    }
  }

  if (toolRepos && (lowerMsg.includes('tarjeta') || lowerMsg.includes('link de pago') || lowerMsg.includes('pagar con tarjeta'))) {
    // Find last reservation for this conversation
    try {
      const allRes = await toolRepos.reservationRepo.findMany({ hotelId: variables.hotelId || '' })
      const reservations = Array.isArray(allRes) ? allRes : (allRes?.data || [])
      const lastRes = reservations[reservations.length - 1]
      if (lastRes) {
        const paymentResult = await executeTool('generate_payment_link', {
          reservationId: lastRes.id,
          amount: lastRes.totalAmount || 0,
          description: `Reserva ${lastRes.roomId} - ${lastRes.checkIn} al ${lastRes.checkOut}`,
        }, variables.hotelId || '', toolRepos)
        const payLink = paymentResult as any
        if (payLink?.paymentUrl) {
          return {
            text: `¡Acá tenés el link de pago 👇\n\n🔗 ${payLink.paymentUrl}\n\n**$${payLink.amount} USD** — vence en ${payLink.expiresIn}.\n\n¿Necesitás algo más? 😊`,
            intentDetected: 'payment_link',
            confidence: 0.9,
            actionTaken: 'generate_payment_link',
            actionResult: payLink,
          }
        }
      }
    } catch {}
  }

  // Force quote generation
  if (toolRepos && (lowerMsg.includes('cotización') || lowerMsg.includes('cotizacion') || lowerMsg.includes('cuánto sale') || lowerMsg.includes('cuanto sale') || lowerMsg.includes('presupuesto') || lowerMsg.includes('price'))) {
    // Extract room type and dates from conversation history
    const lastBotMsg = conversationHistory.filter(m => m.role === 'bot').pop()?.content || ''
    const lastUserMsg = conversationHistory.filter(m => m.role === 'guest').pop()?.content || ''
    const combined = (lastUserMsg + ' ' + message).toLowerCase()

    let roomType = 'double'
    if (combined.includes('suite')) roomType = 'suite'
    else if (combined.includes('familiar') || combined.includes('family')) roomType = 'family'
    else if (combined.includes('simple') || combined.includes('single')) roomType = 'single'

    // Try to extract dates
    const dateMatch = combined.match(/(\d{1,2})\s*(?:al|a|-)\s*(\d{1,2})\s*(?:de\s*)?(\w+)/)
    if (dateMatch) {
      const months: Record<string, string> = { enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06', julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12' }
      const monthNum = months[dateMatch[3]] || '07'
      const year = new Date().getFullYear()
      const checkIn = `${year}-${monthNum}-${dateMatch[1].padStart(2, '0')}`
      const checkOut = `${year}-${monthNum}-${dateMatch[2].padStart(2, '0')}`

      const quoteResult = await executeTool('request_quote', { roomType, checkIn, checkOut, adults: 2, addBreakfast: combined.includes('desayuno'), addAirportTransfer: combined.includes('aeropuerto') || combined.includes('traslado') }, variables.hotelId || '', toolRepos)
      const quote = quoteResult as any
      if (quote?.total) {
        return {
          text: `📋 **Cotización** — ${variables.hotelName}\n\n🛏️ Habitación ${roomType}: $${quote.roomRate}/noche × ${quote.nights} = $${quote.roomTotal}\n${quote.breakfast ? `🥐 Desayuno: ${quote.breakfast}\n` : ''}${quote.transfer ? `🚗 Traslado: ${quote.transfer}\n` : ''}📊 Impuestos: $${quote.taxes}\n💰 **TOTAL: $${quote.total} USD**\n\n¿Te gustaría hacer la reserva? 😊`,
          intentDetected: 'quote',
          confidence: 0.9,
          actionTaken: 'request_quote',
          actionResult: quote,
        }
      }
    }
  }

  // Force invoice generation
  if (toolRepos && (lowerMsg.includes('factura') || lowerMsg.includes('facturar') || lowerMsg.includes('invoice'))) {
    // Find last reservation
    try {
      const allRes = await toolRepos.reservationRepo.findMany({ hotelId: variables.hotelId || '' })
      const reservations = Array.isArray(allRes) ? allRes : (allRes?.data || [])
      const lastRes = reservations[reservations.length - 1]
      if (lastRes) {
        const invoiceResult = await executeTool('generate_invoice', { reservationId: lastRes.id, paymentMethod: 'transfer' }, variables.hotelId || '', toolRepos)
        const inv = invoiceResult as any
        if (inv?.invoiceNumber) {
          return {
            text: `🧾 **Factura ${inv.invoiceNumber}**\n\n👤 Huésped: ${inv.guestName}\n🛏️ Habitación: ${inv.roomType}\n📅 ${inv.checkIn} al ${inv.checkOut} (${inv.nights} noches)\n💵 Habitación: $${inv.roomTotal}\n📊 Impuestos: $${inv.taxes}\n💰 **Total: $${inv.total} USD**\n\n✅ Factura emitida. ¿Necesitás algo más?`,
            intentDetected: 'invoice',
            confidence: 0.9,
            actionTaken: 'generate_invoice',
            actionResult: inv,
          }
        }
      }
    } catch {}
  }

  // Always use LLM for natural responses if available
  if (llmConfig) {
    try {
      const intentsList = intents
        .filter(i => i.isActive)
        .map(i => `- "${i.name}": ${i.triggerPhrases.slice(0, 3).join(', ')}`)
        .join('\n')

      const intentContext = matchedIntent
        ? `\nEl huésped parece querer: ${matchedIntent.name} (${matchedIntent.category}). Respondé sobre eso de forma natural.`
        : ''

      const personalContext = variables.guestName !== 'Huésped'
        ? `\nEl huésped se llama ${variables.guestName}. Tratalo por su nombre de forma natural (no en cada respuesta).`
        : ''

      const messages: LlmMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt(
            variables.hotelName || 'Hotel',
            variables.botName || 'Sofía',
            variables.language || 'es',
            intentsList || 'general',
          ) + intentContext + personalContext,
        },
        ...conversationHistory.slice(-10).map(m => ({
          role: m.role === 'guest' ? 'user' as const : 'assistant' as const,
          content: m.content,
        })),
        { role: 'user', content: message },
      ]

      let response = await llmChat(llmConfig, messages, RECEPTIONIST_TOOLS)
      let attempt = 0

      while (response.toolCalls?.length && attempt < 3) {
        messages.push({
          role: 'assistant',
          content: response.content || '',
        })

        for (const tc of response.toolCalls) {
          console.log(`[TOOL-CALL] ${tc.name} args=${JSON.stringify(tc.arguments)}`)
          let toolResult: any
          try {
            toolResult = await executeTool(tc.name, tc.arguments, variables.hotelId || '', toolRepos)
          } catch (e: any) {
            console.log(`[TOOL-ERROR] ${tc.name}: ${e?.message}`)
            toolResult = { error: 'Tool execution failed' }
          }
          console.log(`[TOOL-RESULT] ${tc.name}: ${JSON.stringify(toolResult).substring(0, 200)}`)
          messages.push({
            role: 'user',
            content: `Tool ${tc.name} result: ${JSON.stringify(toolResult)}`,
          })
        }

        response = await llmChat(llmConfig, messages, RECEPTIONIST_TOOLS)
        attempt++
      }

      return {
        text: response.content || 'Disculpá, no pude procesar eso. ¿Podés repetirlo?',
        intentDetected: matchedIntent?.name || 'llm_chat',
        confidence: nlpResult.confidence || 0.5,
        actionTaken: response.toolCalls?.[0]?.name || intentAction,
        actionResult: response.toolCalls?.[0]?.arguments as any,
      }
    } catch {
      // LLM failed, fall through to template
    }
  }

  // Fallback: use template only if no LLM
  return buildResponse(nlpResult, variables)
}

/**
 * findById + guard de tenant (IA-A2): una tool solo puede ver/tocar reservas del hotel del bot que
 * está respondiendo. El `reservationId` lo dicta el LLM, y el webchat es PÚBLICO sin auth, así que
 * un anónimo con prompt-injection podía leer/cancelar/facturar reservas de CUALQUIER hotel. Este
 * guard corta eso: si la reserva no es del `hotelId` de contexto, es como si no existiera.
 */
async function findOwnedReservation(repo: any, resId: string, hotelId: string): Promise<any | null> {
  if (!resId) return null
  const r = await repo.findById(resId)
  return r && r.hotelId === hotelId ? r : null
}

/** Exportada para tests (las tools destructivas necesitan cobertura directa, sin LLM de por medio). */
export async function executeTool(name: string, args: Record<string, unknown>, hotelId: string, repos?: ToolRepos): Promise<unknown> {
  if (!repos) return { error: 'Repos not available' }

  switch (name) {
    case 'search_availability': {
      const checkIn = args.checkIn as string
      const checkOut = args.checkOut as string
      const adults = (args.adults as number) || 2

      console.log(`[TOOL] search_availability: hotelId=${hotelId} checkIn=${checkIn} checkOut=${checkOut}`)

      // Get all rooms for this hotel
      const allRooms = await repos.roomRepo.findMany({ hotelId })
      const rooms = Array.isArray(allRooms) ? allRooms : (allRooms?.data || [])
      console.log(`[TOOL] rooms found: ${rooms.length}`)

      // Get reservations that overlap with requested dates
      const allRes = await repos.reservationRepo.findMany({ hotelId })
      const reservations = Array.isArray(allRes) ? allRes : (allRes?.data || [])
      console.log(`[TOOL] reservations found: ${reservations.length}`)

      const bookedRoomIds = new Set(
        reservations
          .filter((r: any) => {
            if (r.status === 'cancelled') return false
            const rCheckIn = new Date(r.checkIn || r.checkinDate)
            const rCheckOut = new Date(r.checkOut || r.checkoutDate)
            const reqCheckIn = new Date(checkIn)
            const reqCheckOut = new Date(checkOut)
            return rCheckIn < reqCheckOut && rCheckOut > reqCheckIn
          })
          .map((r: any) => r.roomId)
      )

      const available = rooms.filter((r: any) => !bookedRoomIds.has(r.id))

      // Group by type for clear presentation with amenities
      const byType: Record<string, { count: number; price: number; amenities: string; description: string; ids: string[] }> = {}
      for (const r of available) {
        const type = r.type || 'standard'
        if (!byType[type]) byType[type] = { count: 0, price: r.basePrice || 0, amenities: r.amenities || '', description: r.description || '', ids: [] }
        byType[type].count++
        byType[type].ids.push(r.id)
      }

      return {
        available: available.length,
        summary: Object.entries(byType).map(([type, info]) =>
          `${info.count} ${type} ($${info.price}/noche) — ${info.amenities || 'WiFi, baño privado'}`
        ).join('\n'),
        rooms: available.slice(0, 10).map((r: any) => ({
          id: r.id,
          type: r.type || 'standard',
          name: r.name || r.number || '',
          price: r.basePrice || 0,
          capacity: r.capacity || 2,
          amenities: r.amenities || 'WiFi, baño privado',
          description: r.description || '',
          floor: r.floor,
          bathrooms: r.bathrooms,
        })),
        message: available.length > 0
          ? `Hay ${available.length} habitaciones disponibles.`
          : 'No hay habitaciones disponibles para esas fechas.',
      }
    }

    case 'create_reservation': {
      let roomId = args.roomId as string
      const roomType = args.roomType as string
      const checkIn = args.checkIn as string
      const checkOut = args.checkOut as string
      const guestName = args.guestName as string || 'Guest'
      const guestEmail = args.guestEmail as string || ''
      const guestPhone = args.guestPhone as string || ''
      const adults = (args.adults as number) || 2

      if (!checkIn || !checkOut) {
        return { error: 'Faltan checkIn y checkOut' }
      }

      // If no roomId, find an available room of the requested type
      if (!roomId && roomType) {
        const allRooms = await repos.roomRepo.findMany({ hotelId, type: roomType })
        const rooms = Array.isArray(allRooms) ? allRooms : (allRooms?.data || [])
        const allRes = await repos.reservationRepo.findMany({ hotelId })
        const reservations = Array.isArray(allRes) ? allRes : (allRes?.data || [])
        const bookedRoomIds = new Set(
          reservations.filter((r: any) => {
            if (r.status === 'cancelled') return false
            const rCI = new Date(r.checkIn)
            const rCO = new Date(r.checkOut)
            return rCI < new Date(checkOut) && rCO > new Date(checkIn)
          }).map((r: any) => r.roomId)
        )
        const available = rooms.filter((r: any) => !bookedRoomIds.has(r.id))
        if (available.length === 0) return { error: `No hay habitaciones ${roomType} disponibles para esas fechas` }
        roomId = available[0].id
      }

      if (!roomId) {
        return { error: 'Necesitás roomId o roomType' }
      }

      const room = await repos.roomRepo.findById(roomId)
      const hotel = await repos.hotelRepo.findById(hotelId)

      // Auditoría de integridad (cierre, 2026-09-04) — el bot de Recepción IA escribía directo con
      // `reservationRepo.create`, sin ningún chequeo de capacidad. Mismo criterio que el panel y el
      // motor público, reutilizado sin copiar reglas: sin edad por niño acá (la tool no las pide),
      // el conservador de `resolveAdminCapacityComposition` decide — un niño sin edad conocida
      // SIEMPRE consume plaza.
      await assertReservationFitsCapacity(repos.configRepo, room, { hotelId, adults, children: 0, childrenAges: [] })

      const totalNights = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
      const totalPrice = (room?.basePrice || room?.price || 0) * totalNights

      // Reservations no declara guestName/guestEmail/guestPhone (mem 1805) — usa guestId FK a Guests.
      // Busca huésped existente por email (más preciso) o nombre dentro del hotel; si no existe, lo crea.
      let guestId: string | undefined
      if (repos.guestRepo) {
        const existing = guestEmail
          ? await repos.guestRepo.findMany({ hotelId, email: guestEmail }).catch(() => [])
          : await repos.guestRepo.findMany({ hotelId, name: guestName }).catch(() => [])
        const found = (Array.isArray(existing) ? existing : (existing?.data || []))[0]
        guestId = found?.id
        if (!guestId) {
          const g = await repos.guestRepo.create({
            id: crypto.randomUUID(), hotelId, name: guestName, email: guestEmail, phone: guestPhone,
          } as any)
          guestId = g?.id
        }
      }

      const reservation = await repos.reservationRepo.create({
        id: crypto.randomUUID(),
        hotelId,
        roomId,
        guestId,
        checkIn,
        checkOut,
        adults,
        status: 'confirmed',
        totalAmount: totalPrice,
        createdAt: new Date().toISOString(),
      })

      // Push availability to Channex (block room in channel manager)
      if (repos.onReservationCreated) {
        await repos.onReservationCreated(hotelId, roomId).catch(() => {})
      }

      return {
        reservationId: reservation.id,
        status: 'confirmed',
        room: room?.name || room?.type || 'Habitación',
        roomType: room?.type || 'standard',
        checkIn,
        checkOut,
        nights: totalNights,
        pricePerNight: room?.basePrice || room?.price || 0,
        totalPrice,
        guestName,
        hotelName: hotel?.name || 'Hotel',
        message: `Reserva confirmada para ${guestName}. ${room?.type || 'Habitación'} del ${checkIn} al ${checkOut}. Total: $${totalPrice}.`,
      }
    }

    case 'get_reservation': {
      const email = args.email as string
      const resId = args.reservationId as string

      let reservations
      if (resId) {
        const found = await findOwnedReservation(repos.reservationRepo, resId, hotelId)
        reservations = found ? [found] : []
      } else if (email) {
        const all = await repos.reservationRepo.findMany({ hotelId })
        reservations = (Array.isArray(all) ? all : []).filter((r: any) =>
          r.guestEmail === email || r.email === email
        )
      } else {
        return { error: 'Necesitá email o número de reserva' }
      }

      if (!reservations.length) return { found: false, message: 'No encontré reservas con esos datos.' }

      return {
        found: true,
        reservations: reservations.slice(0, 3).map((r: any) => ({
          id: r.id,
          room: r.roomId,
          checkIn: r.checkIn || r.checkinDate,
          checkOut: r.checkOut || r.checkoutDate,
          status: r.status,
          guest: r.guestName || r.name,
        })),
      }
    }

    case 'cancel_reservation': {
      const resId = args.reservationId as string
      if (!resId) return { error: 'Necesitá el número de reserva' }

      // El guard de tenant sigue estando (IA-A2) y además lo repite `cancelBySystem` del lado de
      // reservas: el reservationId lo dicta el LLM sobre un canal público.
      const reservation = await findOwnedReservation(repos.reservationRepo, resId, hotelId)
      if (!reservation) return { error: 'No encontré esa reserva' }

      if (!repos.cancelReservation) return { error: 'No puedo cancelar reservas en este momento.' }
      // Cancelación REAL: aplica la política del hotel, persiste el snapshot financiero y emite
      // onReservationCancelled → libera el depósito retenido. `hotel-policy` porque es una
      // cancelación directa del huésped, igual que si llamara a recepción.
      const res = await repos.cancelReservation(resId, hotelId, 'Cancelada por el huésped vía asistente virtual')
      if (!res.ok) return { error: res.error || 'No pude cancelar esa reserva' }
      return {
        cancelled: true, reservationId: resId, idempotent: res.idempotent === true,
        refundAmount: res.refundAmount, cancellationFee: res.cancellationFee,
        message: 'Reserva cancelada correctamente.',
      }
    }

    case 'get_hotel_info': {
      const hotel = await repos.hotelRepo.findById(hotelId)
      return {
        name: hotel?.name || 'Hotel',
        // Claves de plantilla del AI ({checkInTime}/{checkOutTime} en seed-intents), pero el
        // VALOR sale del modelo real (`hotel.checkIn`). Antes leía un campo inexistente y el
        // recepcionista respondía siempre 14:00 (fix 2026-08-29).
        checkInTime: hotelCheckInTime(hotel as any),
        checkOutTime: hotelCheckOutTime(hotel as any),
        wifi: hotel?.wifiNetwork || 'hotel_guest',
        wifiPassword: hotel?.wifiPassword || 'welcome2024',
        parking: hotel?.parking || 'Gratuito',
        phone: hotel?.phone || '',
      }
    }

    case 'get_payment_methods': {
      let methods: any[] = []
      let bankDetails: any = null

      console.log(`[TOOL] get_payment_methods: hotelId=${hotelId} configRepo=${!!repos.configRepo}`)
      if (repos.configRepo) {
        try {
          const configs = await repos.configRepo.findMany({ hotelId, key: 'payment_methods' })
          console.log(`[TOOL] payment_methods found: ${configs?.length || 0} type=${typeof configs?.[0]?.value}`)
          if (configs?.[0]?.value) {
            const v = configs[0].value
            methods = typeof v === 'string' ? JSON.parse(v) : Array.isArray(v) ? v : []
          }
          const bankConfigs = await repos.configRepo.findMany({ hotelId, key: 'bank_details' })
          console.log(`[TOOL] bank_details found: ${bankConfigs?.length || 0} type=${typeof bankConfigs?.[0]?.value}`)
          if (bankConfigs?.[0]?.value) {
            const v = bankConfigs[0].value
            bankDetails = typeof v === 'string' ? JSON.parse(v) : v
            console.log(`[TOOL] bankDetails parsed: ${!!bankDetails} keys=${Object.keys(bankDetails || {}).join(',')}`)
          }
        } catch (e: any) { console.log(`[TOOL] config error: ${e?.message}`) }
      }

      const activeMethods = methods.filter((m: any) => m.activo)

      return {
        methods: activeMethods.map((m: any) => ({
          id: m.id,
          name: m.nombre,
          icon: m.icono,
        })),
        bankDetails: bankDetails ? {
          bank: bankDetails.banco,
          holder: bankDetails.titular,
          account: bankDetails.cta_corriente,
          cbu: bankDetails.cbu,
          alias: bankDetails.alias,
          cuit: bankDetails.cuit,
        } : null,
        paypal: bankDetails?.paypal_email || null,
        mercadopago: bankDetails?.mercadopago || null,
        message: `Métodos de pago disponibles: ${activeMethods.map((m: any) => m.nombre).join(', ')}`,
      }
    }

    case 'generate_payment_link': {
      const reservationId = args.reservationId as string
      const amount = (args.amount as number) || 0
      const description = (args.description as string) || 'Reserva hotel'
      const PAYMENT_LINK_EXPIRY_HOURS = 24
      const MS_PER_HOUR = 3600000

      if (!reservationId || !amount) return { error: 'Necesitás reservationId y amount' }

      // Generate a payment token
      const { randomBytes } = await import('crypto')
      const token = randomBytes(16).toString('hex')
      const paymentUrl = `https://pay.hotel.com/${hotelId}/${token}`

      // Save to DB if repo available
      if (repos.paymentLinkRepo) {
        try {
          await repos.paymentLinkRepo.create({
            id: crypto.randomUUID(),
            hotelId,
            reservationId,
            amount,
            currency: 'USD',
            description,
            status: 'active',
            token,
            expiresAt: new Date(Date.now() + PAYMENT_LINK_EXPIRY_HOURS * MS_PER_HOUR).toISOString(),
            maxUses: 1,
            useCount: 0,
          })
        } catch (e: any) {
          // No abortamos la respuesta al huésped, pero un link que no se persiste es un cobro perdido.
          repos.logger?.error?.('No se pudo guardar el link de pago de la IA', { hotelId, reservationId, error: e?.message })
        }
      }

      return {
        paymentUrl,
        amount,
        currency: 'USD',
        description,
        expiresIn: '24 horas',
        message: `Link de pago generado: $${amount} USD — ${paymentUrl}`,
      }
    }

    case 'generate_invoice': {
      const reservationId = args.reservationId as string
      const paymentMethod = (args.paymentMethod as string) || 'cash'

      if (!reservationId) return { error: 'Necesitás reservationId' }

      const reservation = await findOwnedReservation(repos.reservationRepo, reservationId, hotelId)
      if (!reservation) return { error: 'Reserva no encontrada' }

      const room = await repos.roomRepo.findById(reservation.roomId)
      const hotel = await repos.hotelRepo.findById(hotelId)
      const nights = Math.ceil((new Date(reservation.checkOut).getTime() - new Date(reservation.checkIn).getTime()) / 86400000)
      const roomTotal = (room?.basePrice || 0) * nights
      const taxRate = 0.16
      const taxes = Math.round(roomTotal * taxRate)
      const total = roomTotal + taxes

      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`
      const invoice: any = {
        id: crypto.randomUUID(),
        reservationId,
        hotelId,
        guestId: reservation.guestId || null,
        invoiceNumber,
        type: 'stay',
        amount: roomTotal,
        currency: 'USD',
        taxes,
        paymentMethod,
        status: 'issued',
        issueDate: new Date().toISOString(),
        notes: `${nights} noches × $${room?.basePrice || 0} + ${taxRate * 100}% tax`,
      }

      // Sin factura persistida no hay factura: anunciarle el número al huésped inventa un comprobante.
      if (!repos.invoiceRepo) {
        repos.logger?.error?.('La IA no puede emitir facturas: falta invoiceRepo', { hotelId, reservationId })
        return { error: 'No se pudo emitir la factura' }
      }
      try {
        await repos.invoiceRepo.create(invoice)
      } catch (e: any) {
        repos.logger?.error?.('No se pudo guardar la factura de la IA', { hotelId, reservationId, invoiceNumber, error: e?.message })
        return { error: 'No se pudo emitir la factura' }
      }

      return {
        invoiceNumber,
        guestName: reservation.guestName || 'Guest',
        roomType: room?.type || 'standard',
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        nights,
        roomRate: room?.basePrice || 0,
        roomTotal,
        taxRate: `${taxRate * 100}%`,
        taxes,
        total,
        paymentMethod,
        status: 'issued',
        message: `Factura ${invoiceNumber} generada. Total: $${total} USD (${roomTotal} + ${taxes} tax)`,
      }
    }

    case 'request_quote': {
      const roomType = (args.roomType as string) || 'double'
      const checkIn = args.checkIn as string
      const checkOut = args.checkOut as string
      const adults = (args.adults as number) || 2
      const addBreakfast = args.addBreakfast as boolean
      const addAirportTransfer = args.addAirportTransfer as boolean

      if (!checkIn || !checkOut) return { error: 'Necesitás checkIn y checkOut' }

      // Find room price
      const rooms = await repos.roomRepo.findMany({ hotelId, type: roomType })
      const roomList = Array.isArray(rooms) ? rooms : (rooms?.data || [])
      const room = roomList[0]
      if (!room) return { error: `No hay habitaciones tipo ${roomType}` }

      const nights = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
      const roomTotal = (room.basePrice || 0) * nights
      const breakfastTotal = addBreakfast ? 15 * adults * nights : 0
      const transferTotal = addAirportTransfer ? 40 : 0
      const subtotal = roomTotal + breakfastTotal + transferTotal
      const taxRate = 0.16
      const taxes = Math.round(subtotal * taxRate)
      const total = subtotal + taxes

      const lines = [
        `🛏️ Habitación ${roomType} ($${room.basePrice}/noche × ${nights} noches) = $${roomTotal}`,
      ]
      if (addBreakfast) lines.push(`🥐 Desayuno ($15 × ${adults} pers × ${nights} días) = $${breakfastTotal}`)
      if (addAirportTransfer) lines.push(`🚗 Traslado aeropuerto = $${transferTotal}`)
      lines.push(`📊 Impuestos (${taxRate * 100}%) = $${taxes}`)
      lines.push(`💰 TOTAL = $${total} USD`)

      return {
        roomType,
        roomRate: room.basePrice,
        nights,
        roomTotal,
        breakfast: addBreakfast ? `$${breakfastTotal}` : null,
        transfer: addAirportTransfer ? `$${transferTotal}` : null,
        subtotal,
        taxes,
        total,
        currency: 'USD',
        amenities: room.amenities || '',
        message: `Cotización para ${roomType} del ${checkIn} al ${checkOut}:\n${lines.join('\n')}`,
      }
    }

    case 'escalate_to_human':
      return { message: 'Transferido a agente humano.', severity: args.severity || 'medium' }

    case 'register_incident':
      return { incidentId: 'INC-' + Date.now(), status: 'registered', type: args.type }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
