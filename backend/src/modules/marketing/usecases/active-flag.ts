// marketing/usecases/active-flag.ts — Normalización del flag isActive (extraído del
// service para mantenerlo < 200 líneas, convención del analyzer).

/**
 * Normaliza isActive al flag INTEGER del modelo. El wire manda `0|1` (schemas `type:'number'`)
 * y el boolean legacy también se acepta. OJO con la coerción: `0 !== false` es `true` (tipos
 * distintos), así que NO se puede discriminar con `!== false` — un 0 caería en el branch
 * ACTIVO y un mensaje creado PAUSADO lo enviaría el cron (bug INT-1/COR-1). `undefined`
 * sigue siendo ACTIVO (default del modelo).
 */
export const activeFlag = (v: unknown): 0 | 1 => (v === 0 || v === false ? 0 : 1)
