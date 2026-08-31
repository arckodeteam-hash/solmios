// accounting/service.ts — Facade del módulo de contabilidad. Solo orquesta: toda la lógica vive en
// usecases/ (CRUD de cuentas, asientos, períodos, asiento automático, reportes). Depende de
// RepositoryAdapter, no del ORM (salvo la escotilla `orm` opcional para transacciones). NO importa de
// otros módulos. Cubre CTB-0..6 del openspec contabilidad-tesoreria.
import type { RepositoryAdapter, Logger, CacheAdapter, Auth, ORM } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { CreateAccountDTO, UpdateAccountDTO, AccountsQuery, CurrentUser, AccountDTO } from './types'
import type { AccountingSockets } from './sockets'
import * as crud from './usecases/accounts-crud'
import { seedChartOfAccounts, taxNameOf } from './usecases/seed-chart-of-accounts'
import {
  createJournalEntry, postEntry, reverseEntry, listEntries,
  type CreateEntryInput, type JournalDeps,
} from './usecases/journal-entry'
import { closePeriod, lockPeriod, listPeriods } from './usecases/period'
import { recordAutoEntry, type RecordAutoInput } from './usecases/record-auto'
import { trialBalance, generalLedger, profitLoss, balanceSheet, type ReportDeps } from './usecases/reports'

export class AccountingService {
  private sockets: AccountingSockets = {}
  // Versionado de cache: cada mutación bumpa → las cacheKey viejas expiran solas (no hay deletePrefix).
  private state = { version: 0 }

  constructor(
    private readonly accounts: RepositoryAdapter<AccountDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
    private readonly lines: RepositoryAdapter<any>,
    // Cabecera de asientos + orm (transacciones atómicas cabecera+líneas). `orm` opcional: es la
    // escotilla para transacciones multi-tabla, no la dependencia principal (esas son los repos).
    private readonly entries?: RepositoryAdapter<any>,
    private readonly orm?: ORM,
    private readonly periods?: RepositoryAdapter<any>,
  ) {}

  private journalDeps(): JournalDeps {
    if (!this.orm || !this.entries || !this.periods) throw new ValidationError('Contabilidad sin transacciones configurada')
    return { orm: this.orm, accounts: this.accounts, entries: this.entries, lines: this.lines, periods: this.periods }
  }
  private reportDeps(): ReportDeps {
    if (!this.entries) throw new ValidationError('Contabilidad sin asientos configurada')
    return { accounts: this.accounts, entries: this.entries, lines: this.lines }
  }
  private crudDeps(): crud.AccountsCrudDeps {
    return { accounts: this.accounts, userRepo: this.userRepo, cache: this.cache, auth: this.auth, lines: this.lines, sockets: this.sockets, state: this.state }
  }
  private hotelFor(user: CurrentUser): string {
    const h = user.hotelId || ''
    if (!h) throw new ValidationError('Sin hotel asignado')
    return h
  }

  // Acumula handlers, nunca pisa el anterior (composición de sockets).
  setSockets(s: Partial<AccountingSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  // ─── Plan de cuentas (CTB-0/CTB-1) — delegan a usecases/accounts-crud ───
  listAccounts(query: AccountsQuery | undefined, user: CurrentUser) { return crud.listAccounts(this.crudDeps(), query, user) }
  getAccount(id: string, user: CurrentUser) { return crud.getAccount(this.crudDeps(), id, user) }
  createAccount(dto: CreateAccountDTO, user: CurrentUser) { return crud.createAccount(this.crudDeps(), dto, user) }
  updateAccount(id: string, dto: UpdateAccountDTO, user: CurrentUser) { return crud.updateAccount(this.crudDeps(), id, dto, user) }
  deleteAccount(id: string, user: CurrentUser) { return crud.deleteAccount(this.crudDeps(), id, user) }

  /** Siembra el plan de cuentas base para el hotel del usuario. Idempotente (CTB-1.3). */
  async seedChart(user: CurrentUser): Promise<{ created: number; total: number }> {
    // El impuesto sale de la configuración del HOTEL, no de un literal (2026-08-30).
    const hotelId = this.hotelFor(user)
    let taxName: string | undefined
    try {
      const rows = await (this.orm as any).findMany?.('Hotels', { id: hotelId })
      taxName = taxNameOf(rows?.[0])
    } catch { /* el seed cae a su default */ }
    const res = await seedChartOfAccounts(this.accounts, hotelId, taxName)
    this.state.version++
    return res
  }

  // ─── Asientos de doble entrada (CTB-2) ───
  createEntry(input: CreateEntryInput, user: CurrentUser) { return createJournalEntry(this.journalDeps(), this.hotelFor(user), input, user.id) }
  postEntry(id: string, user: CurrentUser) { return postEntry(this.journalDeps(), id, this.hotelFor(user)) }
  reverseEntry(id: string, user: CurrentUser) { return reverseEntry(this.journalDeps(), id, this.hotelFor(user), user.id) }
  listEntries(period: string | undefined, user: CurrentUser) { return listEntries(this.journalDeps(), this.hotelFor(user), period) }

  // ─── Períodos contables (CTB-3) ───
  listPeriods(user: CurrentUser) { return listPeriods(this.journalDeps(), this.hotelFor(user)) }
  closePeriod(id: string, user: CurrentUser) { return closePeriod(this.journalDeps(), this.hotelFor(user), id, user.id) }
  lockPeriod(id: string, user: CurrentUser) { return lockPeriod(this.journalDeps(), this.hotelFor(user), id) }

  // ─── Asiento automático desde conectores (CTB-4) — hotelId del EVENTO, no de un user ───
  recordAuto(hotelId: string, input: RecordAutoInput) { return recordAutoEntry(this.journalDeps(), hotelId, input) }

  // ─── Reportes (CTB-5 mayor/comprobación, CTB-6 P&L/balance) ───
  trialBalance(period: string | undefined, user: CurrentUser) { return trialBalance(this.reportDeps(), this.hotelFor(user), period) }
  generalLedger(accountId: string, user: CurrentUser) { return generalLedger(this.reportDeps(), this.hotelFor(user), accountId) }
  profitLoss(from: string | undefined, to: string | undefined, user: CurrentUser) { return profitLoss(this.reportDeps(), this.hotelFor(user), from, to) }
  balanceSheet(uptoPeriod: string | undefined, user: CurrentUser) { return balanceSheet(this.reportDeps(), this.hotelFor(user), uptoPeriod) }
}
