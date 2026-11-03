// Acceso del OPERADOR del SaaS (no es un rol del cliente). Whitelist por email
// para entrar a corregir datos rotos (sesiones de caja con empleado/caja
// equivocados, cajas abiertas por olvido) en cualquier empresa.
//
// CERO HARDCODE: los emails salen de env var, nunca del código.
//   NEXT_PUBLIC_SUPER_ADMIN_EMAILS / NEXT_PUBLIC_PRAGMA_DEV_EMAILS  → apps Next.js
//   VITE_SUPER_ADMIN_EMAILS       / VITE_PRAGMA_DEV_EMAILS          → app Vite (setter)
// Formato: lista separada por comas. Ej: "ops@agencia.com, dev@agencia.com".
//
// MULTI-EMPRESA: esto es acceso cross-tenant del operador. El "dueño" de cada
// empresa NO va acá: su super-admin por-empresa se resuelve por su rol
// (`preset_key = 'admin'`) en su propia empresa.

declare const process: { env: Record<string, string | undefined> } | undefined;

function parseLista(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function readNextEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
}

// Mutable para permitir el setter de Vite al boot. Se inicializa con lo que
// haya en process.env (Next inlinea NEXT_PUBLIC_*; en Vite queda vacío hasta
// que main.tsx llama setDevAccessEmails con import.meta.env).
let superAdminEmails: string[] = parseLista(readNextEnv('NEXT_PUBLIC_SUPER_ADMIN_EMAILS'));
let pragmaDevEmails: string[] = parseLista(readNextEnv('NEXT_PUBLIC_PRAGMA_DEV_EMAILS'));

/** Setter para Vite (pos): llamar al arrancar con los valores de import.meta.env. */
export function setDevAccessEmails(opts: {
  superAdmin?: string;
  pragmaDev?: string;
}): void {
  if (opts.superAdmin) superAdminEmails = parseLista(opts.superAdmin);
  if (opts.pragmaDev) pragmaDevEmails = parseLista(opts.pragmaDev);
}

function emailEnLista(
  empleado: { email?: string } | null | undefined,
  lista: readonly string[],
): boolean {
  if (!empleado?.email) return false;
  const norm = empleado.email.trim().toLowerCase();
  return lista.some((e) => e === norm);
}

/** true si el empleado logueado es un dev del operador (correcciones de datos). */
export function esPragmaDev(empleado: { email?: string } | null | undefined): boolean {
  return emailEnLista(empleado, pragmaDevEmails);
}

/** true si el empleado es super-admin del operador (bypass total de permisos). */
export function esSuperAdmin(empleado: { email?: string } | null | undefined): boolean {
  return emailEnLista(empleado, superAdminEmails);
}
