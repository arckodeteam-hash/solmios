// child-composition.test.ts — feature "adultos+niños+edades" (2026-09-02).
//
// Regla del pedido: niño sin plaza = sin cargo, no cuenta para capacidad. Niño con plaza = cuenta
// como un ocupante normal (precio y capacidad). Mayor a la edad máxima = se trata como adulto.
import { describe, it, expect } from 'bun:test'
import {
  resolveChildComposition, fitsRoomCapacity, DEFAULT_CHILD_POLICY, type ChildPolicy,
  projectAge, projectChildrenAges, recoverRawAdults, composeFromPersistedReservation,
  classifyAge, describeChildrenAges, resolveAdminCapacityComposition,
} from '../child-composition'

// Ejemplo textual del pedido: "Aceptar niños: Sí, edad máxima niño: 12, edad máxima sin plaza: 3"
const POLICY: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

describe('resolveChildComposition', () => {
  it('0-3 años → no consume plaza (ejemplo del pedido)', () => {
    const c = resolveChildComposition(2, [3, 0], POLICY)
    expect(c.effectiveAdults).toBe(2)
    expect(c.freeChildren).toBe(2)
    expect(c.payingChildren).toBe(0)
    expect(c.chargeableOccupancy).toBe(2) // el precio NO sube — "para 2", no "para 4"
  })

  it('4-12 años → consume plaza, cuenta como ocupante normal', () => {
    const c = resolveChildComposition(2, [5, 10], POLICY)
    expect(c.payingChildren).toBe(2)
    expect(c.freeChildren).toBe(0)
    expect(c.chargeableOccupancy).toBe(4) // "para 4" — mismo precio que 4 adultos
  })

  it('mayor a 12 → se trata como adulto (ocupación/reserva)', () => {
    const c = resolveChildComposition(2, [15], POLICY)
    expect(c.effectiveAdults).toBe(3)
    expect(c.payingChildren).toBe(0)
    expect(c.freeChildren).toBe(0)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('mezcla: libre + con plaza + mayor de edad, todo en una reserva', () => {
    const c = resolveChildComposition(2, [1, 8, 16], POLICY)
    expect(c.effectiveAdults).toBe(3) // 2 + el de 16
    expect(c.payingChildren).toBe(1) // el de 8
    expect(c.freeChildren).toBe(1) // el de 1
    expect(c.chargeableOccupancy).toBe(4)
  })

  it('edad basura (negativa, no numérica) se ignora, no revienta la reserva', () => {
    const c = resolveChildComposition(2, [-1, NaN as unknown as number, 'abc' as unknown as number], POLICY)
    expect(c.effectiveAdults).toBe(2)
    expect(c.payingChildren).toBe(0)
    expect(c.freeChildren).toBe(0)
  })

  it('sin niños: chargeableOccupancy = adultos', () => {
    const c = resolveChildComposition(3, [], POLICY)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('adults inválido cae a 1 (nunca 0 huéspedes)', () => {
    expect(resolveChildComposition(0, [], POLICY).effectiveAdults).toBe(1)
    expect(resolveChildComposition(NaN as unknown as number, [], POLICY).effectiveAdults).toBe(1)
  })

  // Frontera exacta: maxFreeAge=3 es INCLUSIVE (libre), maxChildAge=12 es INCLUSIVE (niño).
  it('edad exactamente en el límite: maxFreeAge es inclusive', () => {
    expect(resolveChildComposition(2, [3], POLICY).freeChildren).toBe(1)
    expect(resolveChildComposition(2, [4], POLICY).payingChildren).toBe(1)
  })
  it('edad exactamente en el límite: maxChildAge es inclusive', () => {
    expect(resolveChildComposition(2, [12], POLICY).payingChildren).toBe(1)
    expect(resolveChildComposition(2, [13], POLICY).effectiveAdults).toBe(3)
  })
})

describe('fitsRoomCapacity', () => {
  it('respeta la capacidad total (plazas)', () => {
    const c = resolveChildComposition(2, [8], POLICY) // chargeableOccupancy = 3
    expect(fitsRoomCapacity({ capacity: 3 }, c)).toBe(true)
    expect(fitsRoomCapacity({ capacity: 2 }, c)).toBe(false)
  })

  it('un niño sin plaza NO cuenta contra la capacidad total (ejemplo del pedido)', () => {
    // 2 adultos + 1 niño de 2 años (libre) en una habitación "para 2".
    const c = resolveChildComposition(2, [2], POLICY)
    expect(fitsRoomCapacity({ capacity: 2 }, c)).toBe(true)
  })

  it('maxAdults/maxChildren sin configurar (null/undefined) → solo valida capacity total', () => {
    const c = resolveChildComposition(4, [], POLICY)
    expect(fitsRoomCapacity({ capacity: 4, maxAdults: null, maxChildren: null }, c)).toBe(true)
  })

  it('maxAdults configurado: rechaza si hay más adultos efectivos de los permitidos', () => {
    const c = resolveChildComposition(3, [], POLICY)
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 2, maxChildren: 5 }, c)).toBe(false)
  })

  it('maxChildren configurado: rechaza si hay más niños con plaza de los permitidos', () => {
    const c = resolveChildComposition(2, [5, 6, 7], POLICY) // 3 niños con plaza
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 4, maxChildren: 2 }, c)).toBe(false)
  })

  // Requerimiento 8 (Habitaciones compatibles, 2026-09-03) — `maxChildren` es "niños que
  // CONSUMEN plaza", no "niños físicos en la habitación": varios niños libres no deben bloquear
  // por maxChildren aunque el número de libres supere el máximo. Mismo criterio que la capacidad
  // total (`capacity`): un niño que no consume plaza no cuenta contra ningún límite de ocupación.
  it('maxChildren NO bloquea por niños LIBRES, aunque haya más libres que el máximo', () => {
    const c = resolveChildComposition(2, [0, 1, 2, 3], POLICY) // 4 niños libres (≤ maxFreeAge=3), 0 con plaza
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 4, maxChildren: 1 }, c)).toBe(true)
  })

  it('un adulto "por edad" (mayor al máximo) cuenta contra maxAdults, no maxChildren', () => {
    const c = resolveChildComposition(1, [15], POLICY) // effectiveAdults=2, sin niños
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 1, maxChildren: 5 }, c)).toBe(false)
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 2, maxChildren: 0 }, c)).toBe(true)
  })

  // Requerimiento 6 (Validación de capacidad, 2026-09-03) — caso explícito del pedido: cumplir
  // maxAdults Y maxChildren por separado no alcanza si la SUMA (capacity total) no entra. Los tres
  // límites son independientes — ninguno sustituye a los otros dos.
  it('cumple maxAdults y maxChildren individualmente, pero excede capacity total → rechazada', () => {
    const c = resolveChildComposition(3, [5, 6], POLICY) // effectiveAdults=3, payingChildren=2 → chargeableOccupancy=5
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 3, maxChildren: 2 }, c)).toBe(true) // sin el techo de capacity, entraría
    expect(fitsRoomCapacity({ capacity: 4, maxAdults: 3, maxChildren: 2 }, c)).toBe(false) // capacity=4 < 5 → rechazada
  })
})

describe('DEFAULT_CHILD_POLICY', () => {
  it('default = comportamiento de siempre (todo niño consume plaza, nada gratis)', () => {
    expect(DEFAULT_CHILD_POLICY.acceptChildren).toBe(true)
    expect(DEFAULT_CHILD_POLICY.maxFreeAge).toBe(0)
    const c = resolveChildComposition(2, [5], DEFAULT_CHILD_POLICY)
    expect(c.freeChildren).toBe(0)
    expect(c.payingChildren).toBe(1)
  })
})

// ─── Requerimiento 12 (Edad de referencia, 2026-09-03) ─────────────────────────────────────────
// "La edad que SOLMI utiliza... debe corresponder a la edad que tendrá durante la estadía,
// tomando como referencia la fecha de check-in" — Opción B: cada declaración de edades guarda su
// propio check-in de referencia (`childrenAgesAsOf`), y se proyecta al reagendar.
describe('projectAge', () => {
  it('sin fecha de referencia (reserva vieja / sin childrenAgesAsOf) devuelve la edad tal cual', () => {
    expect(projectAge(8, null, '2031-01-10')).toBe(8)
    expect(projectAge(8, undefined, '2031-01-10')).toBe(8)
  })

  it('sin fecha destino devuelve la edad tal cual (caller que no proyecta)', () => {
    expect(projectAge(8, '2030-01-10', null)).toBe(8)
  })

  it('mismo año, mueve unos meses: NO cambia la edad (sin mes de nacimiento no se asume cumpleaños)', () => {
    expect(projectAge(8, '2030-01-10', '2030-11-10')).toBe(8)
  })

  it('pasó menos de 365.25 días (justo antes del año): todavía NO cambia (conservador)', () => {
    expect(projectAge(8, '2030-01-10', '2030-12-31')).toBe(8) // 355 días
  })

  it('pasó un año completo o más: sube exactamente los años completos transcurridos', () => {
    expect(projectAge(8, '2030-01-10', '2031-01-11')).toBe(9) // ~366 días → 1 año
    expect(projectAge(8, '2030-01-10', '2033-06-01')).toBe(11) // ~3.4 años → floor 3
  })

  it('nunca proyecta a edad negativa (fecha destino ANTERIOR a la de referencia, caso degenerado)', () => {
    expect(projectAge(0, '2030-01-10', '2020-01-10')).toBe(0)
  })

  it('fechas inválidas devuelven la edad tal cual en vez de reventar', () => {
    expect(projectAge(8, 'no-es-fecha', '2031-01-10')).toBe(8)
  })
})

describe('projectChildrenAges', () => {
  it('proyecta cada edad del array independientemente', () => {
    expect(projectChildrenAges([1, 8, 15], '2030-01-10', '2032-02-01')).toEqual([3, 10, 17])
  })

  it('edades basura se dejan pasar tal cual (resolveChildComposition ya las ignora al clasificar)', () => {
    expect(projectChildrenAges(['abc', NaN as unknown as number], '2030-01-10', '2032-02-01')).toEqual(['abc', NaN] as any)
  })
})

describe('recoverRawAdults', () => {
  it('sin reclasificación: el crudo es igual al adults persistido', () => {
    // 2 adultos declarados, 1 niño con plaza (childrenAges.length === children) → nadie reclasificado.
    expect(recoverRawAdults({ adults: 2, children: 1, childrenAges: [8] })).toBe(2)
  })

  it('con un niño reclasificado a adulto al crear la reserva: recupera el crudo restando la diferencia', () => {
    // Reserva original: 2 adultos + edades [8, 15] con maxChildAge=12 → el de 15 se reclasifica.
    // Persistido: adults=3 (2+1 reclasificado), children=1 (solo el de 8), childrenAges=[8,15].
    expect(recoverRawAdults({ adults: 3, children: 1, childrenAges: [8, 15] })).toBe(2)
  })

  it('nunca devuelve menos de 1 (protección contra datos inconsistentes)', () => {
    expect(recoverRawAdults({ adults: 1, children: 5, childrenAges: [1, 2, 3] })).toBe(1)
  })
})

describe('composeFromPersistedReservation — con targetCheckIn (proyección al reagendar)', () => {
  const POLICY_REQ12: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

  it('sin targetCheckIn: comportamiento previo al Requerimiento 12, sin proyectar', () => {
    const c = composeFromPersistedReservation({ adults: 2, children: 1, childrenAges: [8], childrenAgesAsOf: '2030-01-10' }, POLICY_REQ12)
    expect(c.payingChildren).toBe(1)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('sin childrenAgesAsOf (reserva legacy): con targetCheckIn igual no proyecta, degrada seguro', () => {
    const c = composeFromPersistedReservation({ adults: 2, children: 1, childrenAges: [8] }, POLICY_REQ12, '2035-01-10')
    expect(c.payingChildren).toBe(1)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('reagendar dentro del mismo año: la composición no cambia', () => {
    const c = composeFromPersistedReservation(
      { adults: 2, children: 1, childrenAges: [8], childrenAgesAsOf: '2030-01-10' },
      POLICY_REQ12, '2030-11-10',
    )
    expect(c.payingChildren).toBe(1)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('niño de 3 (libre) reagendado 1 año después cruza a "con plaza" (4 > maxFreeAge=3)', () => {
    const c = composeFromPersistedReservation(
      { adults: 2, children: 1, childrenAges: [3], childrenAgesAsOf: '2030-01-10' },
      POLICY_REQ12, '2031-06-01',
    )
    expect(c.freeChildren).toBe(0)
    expect(c.payingChildren).toBe(1)
    expect(c.chargeableOccupancy).toBe(3) // antes era 2 (el niño no sumaba)
  })

  it('niño de 12 (con plaza, límite) reagendado varios años después pasa a tratarse como adulto', () => {
    const c = composeFromPersistedReservation(
      { adults: 2, children: 1, childrenAges: [12], childrenAgesAsOf: '2030-01-10' },
      POLICY_REQ12, '2034-01-10', // +4 años → 16, supera maxChildAge=12
    )
    expect(c.effectiveAdults).toBe(3)
    expect(c.payingChildren).toBe(0)
    expect(c.chargeableOccupancy).toBe(3) // mismo total, pero ahora es "adulto" para maxAdults/maxChildren
  })

  it('recompone correctamente incluso cuando la reserva original ya había reclasificado a alguien', () => {
    // Original: 2 adultos declarados + edades [8, 15] con maxChildAge=12 → el de 15 ya es "adulto".
    // Persistido: adults=3, children=1, childrenAges=[8,15], asOf='2030-01-10'.
    // Reagendar sin cruzar más umbrales (mismo año) debe devolver EXACTAMENTE la composición original.
    const c = composeFromPersistedReservation(
      { adults: 3, children: 1, childrenAges: [8, 15], childrenAgesAsOf: '2030-01-10' },
      POLICY_REQ12, '2030-08-10',
    )
    expect(c.effectiveAdults).toBe(3) // 2 crudos + el de 15 (proyectado a 15, sigue > 12)
    expect(c.payingChildren).toBe(1) // el de 8 (proyectado a 8, sigue en rango)
    expect(c.chargeableOccupancy).toBe(4)
  })
})

// ─── Requerimiento 13 (Administración | Composición de huéspedes, 2026-09-03) ──────────────────
describe('classifyAge', () => {
  const POLICY_REQ12: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

  it('clasifica los tres baldes con los mismos límites que resolveChildComposition', () => {
    expect(classifyAge(2, POLICY_REQ12)).toBe('free')
    expect(classifyAge(8, POLICY_REQ12)).toBe('paying')
    expect(classifyAge(15, POLICY_REQ12)).toBe('adult')
  })

  it('fronteras inclusive: maxFreeAge y maxChildAge', () => {
    expect(classifyAge(3, POLICY_REQ12)).toBe('free')
    expect(classifyAge(4, POLICY_REQ12)).toBe('paying')
    expect(classifyAge(12, POLICY_REQ12)).toBe('paying')
    expect(classifyAge(13, POLICY_REQ12)).toBe('adult')
  })
})

describe('describeChildrenAges', () => {
  const POLICY_REQ12: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

  it('reserva solo con adultos (sin childrenAges): array vacío', () => {
    expect(describeChildrenAges({ childrenAges: [] }, POLICY_REQ12)).toEqual([])
    expect(describeChildrenAges({}, POLICY_REQ12)).toEqual([])
  })

  it('varios niños con edades distintas: cada uno con su propia clasificación, en el orden declarado', () => {
    const d = describeChildrenAges({ childrenAges: [1, 8, 16] }, POLICY_REQ12)
    expect(d).toEqual([
      { declaredAge: 1, effectiveAge: 1, classification: 'free' },
      { declaredAge: 8, effectiveAge: 8, classification: 'paying' },
      { declaredAge: 16, effectiveAge: 16, classification: 'adult' },
    ])
  })

  it('sin childrenAgesAsOf/checkIn (reserva legacy): effectiveAge = declaredAge, sin proyectar', () => {
    const d = describeChildrenAges({ childrenAges: [15] }, POLICY_REQ12)
    expect(d).toEqual([{ declaredAge: 15, effectiveAge: 15, classification: 'adult' }])
  })

  it('con childrenAgesAsOf + checkIn: usa la edad EFECTIVA (proyectada) para clasificar, no la declarada', () => {
    // Declarado 3 (libre) en 2030-01-10; checkIn actual 2031-06-01 (+1 año) → proyecta a 4 → con plaza.
    const d = describeChildrenAges({ childrenAges: [3], childrenAgesAsOf: '2030-01-10', checkIn: '2031-06-01' }, POLICY_REQ12)
    expect(d).toEqual([{ declaredAge: 3, effectiveAge: 4, classification: 'paying' }])
  })

  it('edades basura (negativas, no numéricas) se ignoran igual que resolveChildComposition', () => {
    const d = describeChildrenAges({ childrenAges: [-1, 'abc' as unknown as number, 8] }, POLICY_REQ12)
    expect(d).toEqual([{ declaredAge: 8, effectiveAge: 8, classification: 'paying' }])
  })
})

// ─── Auditoría de integridad (cierre, 2026-09-04) — validación de capacidad en Administración ──
describe('resolveAdminCapacityComposition', () => {
  const POLICY_REQ12: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

  it('sin childrenAges (reserva de panel legacy): cada niño declarado consume plaza — conservador, nunca libre', () => {
    const c = resolveAdminCapacityComposition(2, 2, [], POLICY_REQ12)
    expect(c.effectiveAdults).toBe(2)
    expect(c.payingChildren).toBe(2)
    expect(c.freeChildren).toBe(0)
    expect(c.chargeableOccupancy).toBe(4)
  })

  it('sin childrenAges y sin niños: solo adultos', () => {
    const c = resolveAdminCapacityComposition(3, 0, undefined, POLICY_REQ12)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('con childrenAges declaradas: usa la composición REAL (resolveChildComposition), no el conservador', () => {
    // Sin edades sería 2+1=3 (conservador); con edad conocida y libre (≤3) es 2 (real).
    const c = resolveAdminCapacityComposition(2, 1, [1], POLICY_REQ12)
    expect(c.freeChildren).toBe(1)
    expect(c.payingChildren).toBe(0)
    expect(c.chargeableOccupancy).toBe(2)
  })

  it('con childrenAges declaradas, un niño mayor a maxChildAge: se reclasifica como adulto (igual que resolveChildComposition)', () => {
    const c = resolveAdminCapacityComposition(2, 1, [15], POLICY_REQ12)
    expect(c.effectiveAdults).toBe(3)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('adults inválido cae a 1 (nunca 0 huéspedes), mismo criterio que resolveChildComposition', () => {
    expect(resolveAdminCapacityComposition(0, 0, [], POLICY_REQ12).effectiveAdults).toBe(1)
  })

  it('children negativo/no numérico cae a 0, no revienta ni resta', () => {
    expect(resolveAdminCapacityComposition(2, -3, [], POLICY_REQ12).payingChildren).toBe(0)
    expect(resolveAdminCapacityComposition(2, NaN as unknown as number, [], POLICY_REQ12).payingChildren).toBe(0)
  })
})
