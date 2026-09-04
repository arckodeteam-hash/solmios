// ai-gerente/service.ts — M17 Gerente IA: orquesta KPIs → LLM → historial.
import type { Logger, CacheAdapter } from 'arckode-framework'
import { AuthError } from 'arckode-framework'
import type { AiGerenteDTO, AiGerenteQuery, AiGerentePaginated } from './types'
import type { AiGerenteSockets } from './sockets'
import { getHotelKpis, askGerente } from './usecases/ask'
import type { ReservationCancelPort } from './usecases/tools'

export class AiGerenteService {
  private sockets: AiGerenteSockets = {}
  /** Cancelación real de reservas (política + snapshot + release de depósito). Lo inyecta el connector `ai-gerente-reservas`. */
  private cancelReservationPort: ReservationCancelPort | null = null
  setReservationCancelPort(fn: ReservationCancelPort): void { this.cancelReservationPort = fn }

  constructor(
    private readonly interactionRepo: any,
    private readonly reservationRepo: any,
    private readonly roomRepo: any,
    private readonly hotelRepo: any,
    private readonly configRepo: any,
    private readonly guestRepo: any,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
  ) {}

  setSockets(_s: Partial<AiGerenteSockets>): void { /* reservado para F3 (briefing proactivo) */ }

  private async resolveHotelId(user: { id: string; role: string; hotelId?: string }, qHotelId?: string): Promise<string> {
    if (user.role === 'super_admin' && qHotelId) return qHotelId
    if (user.hotelId && user.hotelId !== 'platform') return user.hotelId
    throw new AuthError('No hotel assigned')
  }

  /** Pregunta del gerente → agrega KPIs reales → LLM → guarda interaction → devuelve. */
  async ask(query: string, user: { id: string; role: string; hotelId?: string }, qHotelId?: string): Promise<AiGerenteDTO> {
    const hotelId = await this.resolveHotelId(user, qHotelId)
    const t0 = Date.now()
    this.logger.info('Gerente ask', { hotelId, queryLen: query.length })

    const kpis = await getHotelKpis(this.reservationRepo, this.roomRepo, hotelId)
    // @ignore IDOR_RISK
    const hotel = await this.hotelRepo.findById(hotelId)
    const hotelName = hotel?.name || 'el hotel'

    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || ''
    const { response, confidence, actions } = await askGerente(
      query, kpis, hotelName, apiKey,
      { reservationRepo: this.reservationRepo, roomRepo: this.roomRepo, hotelRepo: this.hotelRepo, guestRepo: this.guestRepo, cancelReservation: this.cancelReservationPort ?? undefined, configRepo: this.configRepo },
      hotelId,
    )

    const interaction = await this.interactionRepo.create({
      id: crypto.randomUUID(), hotelId, userId: user.id,
      query, response,
      queryType: actions?.length ? 'action_request' : 'question',
      dataSourcesUsed: actions?.length ? actions.map((a) => a.tool) : ['reservations', 'rooms'],
      confidence,
      responseTimeMs: Date.now() - t0,
    } as any)
    return interaction
  }

  async list(query: AiGerenteQuery): Promise<AiGerentePaginated> {
    const page = query?.page ?? 1
    const limit = query?.limit ?? 20
    const result = await this.interactionRepo.paginate(
      { hotelId: query?.hotelId },
      { limit, offset: (page - 1) * limit },
    )
    return {
      data: result.data,
      pagination: {
        page, limit, total: result.total, totalPages: result.pages,
        hasNext: (page - 1) * limit + limit < result.total, hasPrev: page > 1,
      },
    }
  }

  async feedback(id: string, feedback: string, user?: { hotelId?: string; role?: string }): Promise<AiGerenteDTO | null> {
    // @ignore IDOR_RISK
    const existing = await this.interactionRepo.findById(id)
    if (!existing) return null
    if (user && user.role !== 'super_admin' && existing.hotelId !== user.hotelId) {
      throw new AuthError('No autorizado')
    }
    return this.interactionRepo.update(id, { feedback } as any)
  }
}
