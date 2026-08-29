// wallet-pass/model.ts — Schema físico de `wallet_passes` (F3, spec wallet-pass).
// DB en inglés, multi-tenant por hotelId, id = TEXT UUID, timestamps estándar.
//
// Anti-patrón ORM (mem 1805): TODO campo persistido por service/DTO/validator/connector
// está declarado acá — case-sensitive (`appleUrl` ≠ `appleurl`). Renombrar un campo en
// el modelo = columna orphan (ADD COLUMN, no rename) → migrar data a mano.
//
// Modelo dual (regla Manager Hotel): el módulo `wallet-pass` es DUEÑO del modelo
// `WalletPasses` → NO se define en `shared/models.ts` (evita la trampa del "último gana"
// que ya picó con lock_codes.hotelId — ver CLAUDE.md "Modelos duales").
//
// Unique constraint (spec.md:135): `(reservationId)` para garantizar 1 pass vigente por
// reserva. El framework no expone UNIQUE simple declarado en el modelo de forma que
// portable cree el índice en ambos motores — se crea con
// `CREATE UNIQUE INDEX IF NOT EXISTS wallet_passes_reservation ON wallet_passes(reservationId)`
// en `migrate-db.ts`. El service captura la violación y la traduce a idempotente return
// (mismo patrón que promo-codes / external-reviews / folio-entries).
//
// `obsoleteAt` (spec.md:130): seteado si la pass se regenera por reasignación de habitación.
// Hasta que ese socket se cablee, queda siempre null (pass vigente). Declarado de antemano
// para que el campo físico exista el día que se active onRoomReassigned.
import type { ModelDefinition, ORM } from 'arckode-framework'

/**
 * Wallet pass (F3). Una fila por reserva confirmada con los URLs a Apple Wallet (.pkpass)
 * y Google Wallet (save URL) + el lockCode TTLock embebido. Best-effort: si Apple/Google
 * fallan o faltan creds, las columnas correspondientes quedan null y el email igual sale
 * con el lockCode visible como fallback (spec.md:55-61).
 */
export const WalletPassModel: ModelDefinition = {
  table: 'wallet_passes',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    // FK lógica a `reservations.id`. UNIQUE (1 pass vigente por reserva, spec.md:122).
    reservationId: { type: 'string', required: true },
    // URL firmada al `.pkpass` (Apple). Null si el hotel no tiene cert Apple configurado
    // o la firma falló (cert vencido/inválido). Best-effort: spec.md:55-61.
    appleUrl: { type: 'string' },
    // URL "Add to Google Wallet" (save URL con JWT). Null si no hay service account.
    googleUrl: { type: 'string' },
    // Código TTLock embebido en el pass (spec.md:128). REQUIRED: el pass sin código no
    // sirve al huésped — mejor no generarlo. El usecase lo obtiene de ttlock (existente
    // o recién generado) antes de persistir.
    lockCode: { type: 'string', required: true },
    // Timestamp de generación (spec.md:129). cuándo se generaron los URLs.
    generatedAt: { type: 'date', required: true },
    // Cuándo se le avisó al huésped (habitación + código). Lo setea `prearrival-pass-cron.ts`
    // 24 h antes de la llegada; vacío = todavía no se mandó. Es el flag de idempotencia del
    // cron: sin esto reenviaría el correo en cada tick. Anti-patrón ORM D5: declarado acá.
    emailSentAt: { type: 'date' },
    // Seteo futuro (spec.md:130 — onRoomReassigned): marca la fila como obsoleta tras
    // regenerar el pass por cambio de habitación. Hasta cablear ese socket, queda null.
    obsoleteAt: { type: 'date' },
  },
  timestamps: true,
}

/** Registra el modelo en el ORM. Idempotente (orm.define usa Map.set). */
export function registerWalletPassModels(orm: ORM): void {
  orm.define('WalletPasses', WalletPassModel)
}
