export interface PricingSockets {
  onSeasonsUpdated?: (hotelId: string, count: number) => Promise<void>
  /** `channels` = canales con override entre las filas guardadas; vacío/undefined = solo tarifas base. */
  onRatesUpdated?: (hotelId: string, count: number, channels?: string[]) => Promise<void>
  onRatesCopied?: (hotelId: string, copied: number) => Promise<void>
  onBlockCreated?: (data: any) => Promise<void>
  onBlockDeleted?: (id: string) => Promise<void>
  onRateRestrictionsUpdated?: (hotelId: string, count: number) => Promise<void>
}
