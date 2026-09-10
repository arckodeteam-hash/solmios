import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { TicketsService } from './service'
import { CreateTicketsSchema, UpdateTicketsSchema, AddMessageSchema } from './validators/schema'

export class TicketsController {
  constructor(
    private readonly service: TicketsService,
    private readonly logger: Logger,
  ) {}

  async index(req: HttpRequest) {
    const currentUser = req.user as any
    const result = await this.service.list(req.query as any, currentUser)
    return { status: 200, body: result }
  }

  async show(req: HttpRequest) {
    const currentUser = req.user as any
    const item = await this.service.getById(req.params.id, currentUser)
    return { status: 200, body: item }
  }

  async store(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(CreateTicketsSchema, req.body)
    const item = await this.service.create(data as any, currentUser)
    return { status: 201, body: item }
  }

  async update(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(UpdateTicketsSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, currentUser)
    return { status: 200, body: item }
  }

  async addMessage(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(AddMessageSchema, req.body)
    const item = await this.service.addMessage(req.params.id, data.message as string, currentUser)
    return { status: 201, body: item }
  }

  async destroy(req: HttpRequest) {
    const currentUser = req.user as any
    await this.service.delete(req.params.id, currentUser)
    return { status: 204, body: null }
  }
}
