// cash/service.ts — Facade del módulo Caja. Orquestador delgado.
// Movimientos CRUD + registerPaymentIncome aquí; turnos y stats delegan a ./usecases/.
// Depende de RepositoryAdapter (no del ORM directo). hotelId forzado del JWT en create (P0 IDOR).

import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import type {
  CashMovementDTO, CashShiftDTO, CashRegister, CreateMovementDTO, UpdateMovementDTO,
  MovementQuery, CashPaginated, ShiftHistoryPage, ShiftHistoryQuery, CurrentUser,
} from './types'
import type { CashSockets } from './sockets'
import { computeStats } from './usecases/stats'
import * as shiftsUc from './usecases/shifts'
import type { ShiftDeps } from './usecases/shifts'
import * as movementsUc from './usecases/movements'
import type { MovementDeps } from './usecases/movements'
import { registerPaymentIncome, registerExpenseOutflow, removeExpenseOutflow } from './usecases/auto-movements'
import type { AutoMovementDeps, PaymentIncomeInput, ExpenseOutflowInput } from './usecases/auto-movements'
import {
  auditSafely, movementDeleteEntry, shiftOpenEntry, shiftCloseEntry, shiftReconcileEntry,
  type AuditEntry, type AuditPort,
} from './usecases/audit'

export class CashService {
  private sockets: CashSockets = {}
  private listVersion = 0 // cache versioning: mutaciones bump → cacheKey viejas expiran a 300s
  private auditPort: AuditPort | null = null

  constructor(
    private readonly repo: RepositoryAdapter<CashMovementDTO>,
    private readonly shiftRepo: RepositoryAdapter<CashShiftDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
  ) {}

  setSockets(s: Partial<CashSockets>): void {
    const next = s as Record<string, any>; const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]; if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  /** Conecta el audit log. Lo inyecta el connector `cash-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  private audit(entry: AuditEntry): Promise<void> {
    return auditSafely(this.auditPort, this.logger, entry)
  }

  private hotelOfUser(user: CurrentUser, dtoHotelId?: string): string {
    if (user.role === 'super_admin') return dtoHotelId || user.hotelId || ''
    return user.hotelId || ''
  }

  private shiftDeps(): ShiftDeps {
    return {
      shiftRepo: this.shiftRepo, repo: this.repo, userRepo: this.userRepo,
      auth: this.auth, logger: this.logger, sockets: this.sockets,
      hotelOfUser: (u, h) => this.hotelOfUser(u, h),
      bumpVersion: () => { this.listVersion++ },
    }
  }

  private autoDeps(): AutoMovementDeps {
    return {
      repo: this.repo, logger: this.logger,
      resolveShift: (hotelId, register) => shiftsUc.resolveOpenShift(this.shiftDeps(), hotelId, register),
      onCreated: async (m) => { await this.sockets.onCashMovementCreated?.(m) },
      onDeleted: async (id) => { await this.sockets.onCashMovementDeleted?.(id) },
    }
  }

  private movementDeps(): MovementDeps {
    return {
      repo: this.repo, userRepo: this.userRepo, auth: this.auth, cache: this.cache,
      sockets: this.sockets, shiftDeps: this.shiftDeps(),
      hotelOfUser: (u, h) => this.hotelOfUser(u, h),
      listVersion: () => this.listVersion,
      bumpVersion: () => { this.listVersion++ },
    }
  }

  // ─── Movimientos (delegan a usecases/movements) ────────
  list(query: MovementQuery, user: CurrentUser, register?: CashRegister): Promise<CashPaginated> { return movementsUc.list(this.movementDeps(), query, user, register) }
  getById(id: string, user: CurrentUser, expectedRegister?: CashRegister): Promise<CashMovementDTO> { return movementsUc.getById(this.movementDeps(), id, user, expectedRegister) }
  create(dto: CreateMovementDTO, user: CurrentUser, register: CashRegister = 'reception'): Promise<CashMovementDTO> { return movementsUc.create(this.movementDeps(), dto, user, register) }
  update(id: string, dto: UpdateMovementDTO, user: CurrentUser, expectedRegister?: CashRegister): Promise<CashMovementDTO> { return movementsUc.update(this.movementDeps(), id, dto, user, expectedRegister) }

  async delete(id: string, user: CurrentUser, expectedRegister?: CashRegister): Promise<void> {
    const existing = await movementsUc.destroy(this.movementDeps(), id, user, expectedRegister)
    await this.audit(movementDeleteEntry(existing, user))
  }

  // ─── Movimientos automáticos (delegan a usecases/auto-movements) ──
  /** Conector payments→caja: ingreso por pago cash. Dedup por paymentId. */
  async registerPaymentIncome(input: PaymentIncomeInput): Promise<CashMovementDTO | null> {
    const item = await registerPaymentIncome(this.autoDeps(), input)
    if (item) this.listVersion++
    return item
  }

  /** Conector gastos→caja: egreso por gasto en efectivo. Dedup por expenseId. */
  async registerExpenseOutflow(input: ExpenseOutflowInput): Promise<CashMovementDTO | null> {
    const item = await registerExpenseOutflow(this.autoDeps(), input)
    if (item) this.listVersion++
    return item
  }

  /** Conector gastos→caja: revierte el egreso (gasto borrado, impago, o ya no en efectivo). */
  async removeExpenseOutflow(expenseId: string): Promise<boolean> {
    const removed = await removeExpenseOutflow(this.autoDeps(), expenseId)
    if (removed) this.listVersion++
    return removed
  }

  // ─── Turnos (delegan a usecases/shifts) ────────────────
  listShifts(hotelId: string | undefined, user: CurrentUser, register?: CashRegister) { return shiftsUc.listShifts(this.shiftDeps(), hotelId, user, register) }
  /** Histórico para auditoría: filtro por fecha de apertura + paginación + neto por método. */
  listShiftHistory(query: ShiftHistoryQuery, hotelId: string | undefined, user: CurrentUser, register?: CashRegister): Promise<ShiftHistoryPage> {
    return shiftsUc.listShiftHistory(this.shiftDeps(), hotelId, query, user, register)
  }
  getCurrentShift(user: CurrentUser, register: CashRegister = 'reception') { return shiftsUc.getCurrentShift(this.shiftDeps(), user, register) }

  async openShift(dto: OpenShiftLike, user: CurrentUser, register: CashRegister = 'reception') {
    const shift = await shiftsUc.openShift(this.shiftDeps(), dto, user, register)
    await this.audit(shiftOpenEntry(shift, user))
    return shift
  }

  async closeShift(id: string, dto: CloseShiftLike, user: CurrentUser, expectedRegister?: CashRegister) {
    const shift = await shiftsUc.closeShift(this.shiftDeps(), id, dto, user, expectedRegister)
    await this.audit(shiftCloseEntry(shift, user))
    return shift
  }

  async reconcile(id: string, user: CurrentUser, expectedRegister?: CashRegister) {
    const result = await shiftsUc.reconcile(this.shiftDeps(), id, user, expectedRegister)
    await this.audit(shiftReconcileEntry(result, user))
    return result
  }

  // ─── Stats ─────────────────────────────────────────────
  // register default 'reception': sin esto, /api/caja/stats (recepción, no manda register)
  // sumaba también los movimientos del restaurante — encontrado en vivo (QA-ALTO).
  async stats(hotelId: string | undefined, user: CurrentUser, register: CashRegister = 'reception') {
    const hid = this.hotelOfUser(user, hotelId)
    const movs = await this.repo.findMany({ hotelId: hid || '__none__', register } as any)
    return computeStats(movs, Date.now())
  }
}

// Alias de tipos de los usecases para firmas delgadas (sin importar Parameters<> que ensucia).
type OpenShiftLike = { openingAmount?: number; notes?: string }
type CloseShiftLike = { countedAmount: number; denominations?: string; notes?: string }
