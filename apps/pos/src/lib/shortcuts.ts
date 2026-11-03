// Atajos de teclado del PoS. Documentados en un solo lugar.
export const SHORTCUTS = {
  nuevaVenta: 'f2',
  buscarCliente: 'f3',
  cobrarEfectivo: 'f5',
  cobrarTarjeta: 'f6',
  cobrarQR: 'f7',
  pagoMixto: 'f8',
  ultimaVenta: 'f12',
  cancelar: 'escape',
} as const;

export const SHORTCUT_LABELS: Record<keyof typeof SHORTCUTS, string> = {
  nuevaVenta: 'F2',
  buscarCliente: 'F3',
  cobrarEfectivo: 'F5',
  cobrarTarjeta: 'F6',
  cobrarQR: 'F7',
  pagoMixto: 'F8',
  ultimaVenta: 'F12',
  cancelar: 'Esc',
};
