/**
 * Modo demo — cuando el flag global `__DEMO_MODE__` está activo, ciertas
 * mutations del PoS (abrir/cerrar caja, crear/anular venta, ajustar
 * stock, transferir stock) se interceptan y devuelven mocks plausibles
 * en lugar de escribir a la BD.
 *
 * Sirve para que un prospecto navegue todo el sistema sin miedo a
 * ensuciar datos reales.
 *
 * El flag se activa en:
 *   - apps/admin (DemoGuard en admin-shell.tsx)
 *   - apps/pos (DemoGuard en el shell del PoS)
 * cuando el empleado logueado tiene un rol cuyo nombre contiene "demo".
 *
 * SIEMPRE loguea a consola cuando intercepta algo. Si en producción real
 * vemos un `[DEMO]` en un tablet que NO debería ser demo, algo salió mal.
 */

declare global {
  // eslint-disable-next-line no-var
  var __DEMO_MODE__: boolean | undefined;
}

export function esDemoMode(): boolean {
  return typeof globalThis !== 'undefined' && globalThis.__DEMO_MODE__ === true;
}

/** Log de auditoría de interceptaciones. Prefijo `[DEMO]` para grep fácil. */
export function logDemo(operacion: string, detalle?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[DEMO] intercepted: ${operacion}`, detalle ?? '');
}

/** Genera un UUID válido usando crypto.randomUUID cuando existe, fallback simple. */
export function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback random (no cripto-seguro pero alcanza para mocks).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
