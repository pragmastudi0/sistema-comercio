import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Modo demo: cuando está activado, `formatCurrency` reemplaza cada monto
 * real por un número plausible pero fake (pseudo-aleatorio consistente
 * según magnitud). Sirve para presentar el sistema a prospectos sin
 * exponer facturación real.
 *
 * Se activa/desactiva desde `<DemoGuard>` en el layout del admin según
 * el rol del usuario logueado. Usamos una var global (side effect) para
 * no tener que reemplazar los cientos de `formatCurrency(x)` que hay
 * dispersos por componentes que NO son hooks.
 */
declare global {
  // eslint-disable-next-line no-var
  var __DEMO_MODE__: boolean | undefined;
}

/** Genera un monto "plausible pero fake" a partir del real. Consistente
 *  (mismo input → mismo output) y conserva el orden de magnitud, así el
 *  UX de "acá hay venta grande vs chica" no se rompe del todo. */
function montoDemoFake(real: number): number {
  if (!real || real === 0) return 0;
  const abs = Math.abs(real);
  const magnitud = Math.floor(Math.log10(abs));
  const pools: number[][] = [
    [7, 5, 3, 9, 4],
    [42, 87, 15, 63, 91, 28],
    [234, 567, 189, 891, 412, 738],
    [1234, 5678, 8901, 2345, 3456, 7890],
    [12345, 87654, 34567, 65432, 24680, 13579],
    [123456, 456789, 234567, 876543, 345678, 987654],
    [1234567, 8765432, 3456789, 7654321, 2345678, 6789012],
    [12345678, 87654321, 23456789, 76543210],
  ];
  const pool = pools[Math.min(Math.max(0, magnitud), 7)]!;
  // Hash simple del entero — mismo input siempre da el mismo output.
  const hash = Math.abs(Math.floor(abs) * 7919 + Math.floor(abs / 1000)) % pool.length;
  const valor = pool[hash]!;
  return real < 0 ? -valor : valor;
}

export function formatCurrency(n: number): string {
  const valor = globalThis.__DEMO_MODE__ ? montoDemoFake(n) : n;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(valor);
}

export function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
