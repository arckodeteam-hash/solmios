// crm/usecases/segment-export.ts — CSV de los miembros de un segmento (spec crm-segments).
// Puro: recibe los miembros ya resueltos por SegmentUseCase.guestsIn y arma el texto.
// RFC 4180 mínimo: comillas dobles escapadas, campos con separador/salto entre comillas.

export interface SegmentCsvMember {
  name?: string | null
  email?: string | null
  phone?: string | null
  tier?: string | null
  totalStays?: number | null
  loyaltyPoints?: number | null
}

const esc = (v: unknown): string => {
  const str = String(v ?? '').replace(/"/g, '""')
  return /[",\r\n]/.test(str) ? `"${str}"` : str
}

export function segmentCsv(members: SegmentCsvMember[]): string {
  const header = ['nombre', 'email', 'telefono', 'tier', 'estadias', 'puntos']
  const rows = members.map((g) => [
    esc(g.name), esc(g.email), esc(g.phone ?? ''), esc(g.tier ?? 'bronze'),
    Number(g.totalStays ?? 0), Number(g.loyaltyPoints ?? 0),
  ].join(','))
  return [header.join(','), ...rows].join('\r\n')
}

export function segmentFilename(segmentName: string): string {
  const slug = String(segmentName ?? 'segmento').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'segmento'
  return `segmento-${slug}-${new Date().toISOString().slice(0, 10)}.csv`
}
