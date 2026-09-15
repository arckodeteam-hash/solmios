import { describe, it, expect } from 'vitest'
import { tierSummary, anticipationLabel } from './cancellation-tier-summary'
import { PRESET_TIERS } from '@/types/cancellation'

describe('tierSummary — describe lo que aplica el backend', () => {
  it('moderada: el 50% cubre todo el tramo por debajo de 72 h, no solo después del check-in', () => {
    expect(tierSummary([
      { deadlineHours: 0, penaltyPercent: 50, refundable: true },
      { deadlineHours: 72, penaltyPercent: 0, refundable: true },
    ])).toEqual([
      'Con 3 días o más de anticipación: reembolso total',
      'Con menos de 3 días de anticipación o después del check-in: retiene el 50% y devuelve el 50%',
    ])
  })

  it('tres niveles: el del medio es un rango', () => {
    expect(tierSummary([
      { deadlineHours: 168, penaltyPercent: 0, refundable: true },
      { deadlineHours: 48, penaltyPercent: 30, refundable: true },
      { deadlineHours: 0, penaltyPercent: 100, refundable: true },
    ])).toEqual([
      'Con 7 días o más de anticipación: reembolso total',
      'Entre 2 días y 7 días antes: retiene el 30% y devuelve el 70%',
      'Con menos de 2 días de anticipación o después del check-in: retiene el 100%, sin reembolso',
    ])
  })

  it('flexible: hasta el check-in', () => {
    expect(tierSummary(PRESET_TIERS.flexible)).toEqual(['Hasta el check-in: reembolso total'])
  })

  it('no reembolsable: en cualquier momento, sin reembolso', () => {
    expect(tierSummary(PRESET_TIERS.non_refundable)).toEqual(['En cualquier momento: sin reembolso'])
  })

  it('horas que no son días enteros', () => {
    expect(anticipationLabel(36)).toBe('36 h')
    expect(anticipationLabel(24)).toBe('1 día')
  })
})
