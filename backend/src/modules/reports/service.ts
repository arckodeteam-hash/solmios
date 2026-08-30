import type { Logger } from 'arckode-framework'
import type { ReportQueries } from './usecases/report-queries'

export class ReportsService {
  constructor(
    private readonly logger: Logger,
    private readonly queries: ReportQueries,
  ) {}

  async getReports(req: any): Promise<any> {
    const id = await this.queries.resolveHotelId(req); if (!id) return {}
    return this.queries.getReports(id)
  }

  async getAdvancedReport(req: any): Promise<any> {
    const id = await this.queries.resolveHotelId(req); if (!id) return {}
    return this.queries.getAdvancedReport(id, req.query)
  }

  async getNightAudit(req: any): Promise<any> {
    const id = await this.queries.resolveHotelId(req)
    if (!id) return {}
    return this.queries.getNightAudit(id)
  }

  async markNoShows(req: any): Promise<number> {
    const id = await this.queries.resolveHotelId(req)
    return this.queries.markNoShows(id)
  }

  /**
   * Inyecta cómo expirar los códigos TTLock al marcar no-show (lo hace `reports-ttlock`).
   * reports no puede importar ttlock: la dependencia entra por connector.
   */
  setLockCodeExpirer(fn: (reservationId: string) => Promise<void>): void {
    this.queries.setLockCodeExpirer(fn)
  }
}
