// digitalizacion/sockets.ts — Hooks OPCIONALES hacia otros módulos.
// Los sockets son opcionales. El módulo funciona sin ellos.
//
// La interfaz se DEFINE en service.ts (es quien dispara los eventos) y acá solo se re-exporta,
// para que los connectors la importen por la ruta convencional del framework sin que queden dos
// definiciones divergentes del mismo contrato.
export type { DigitalizacionSockets } from './service'
