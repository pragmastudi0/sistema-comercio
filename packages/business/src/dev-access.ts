// Backdoor de acceso para el operador del SaaS (Pragma). NO es un rol
// del cliente — es un fallback fijo por email para poder entrar a
// corregir datos rotos (sesiones de caja con empleado/caja equivocados,
// cajas que quedaron abiertas por olvido) sin depender de que el cliente
// toque roles ni permisos.
//
// La lista es HARDCODEADA a propósito: es más seguro que un rol editable,
// porque nadie del cliente puede sumar mails acá sin abrir un PR. Si entra
// otro dev del operador, sumar su email a la constante y deployar.
//
// MULTI-EMPRESA: estos emails son del OPERADOR del SaaS (acceso cross-tenant).
// El "dueño" de cada empresa NO va acá — su super-admin por-empresa se
// resuelve por su rol/flag en la BD de su propia empresa (ver Fase 5 del plan).
export const PRAGMA_DEV_EMAILS: readonly string[] = [
  'pragmasolucionesdigitales@gmail.com',
];

/**
 * Super-admins del OPERADOR del SaaS. Tienen bypass total de permisos en el
 * admin — cualquier `puede(...)` devuelve true — para poder entrar a corregir
 * cualquier empresa. El super-admin por-empresa (dueño del cliente) se maneja
 * por rol en su propia empresa, no acá.
 *
 * NO se puede editar desde el cliente: cambios acá van por PR.
 */
export const SUPER_ADMIN_EMAILS: readonly string[] = [
  'pragmasolucionesdigitales@gmail.com',
];

function emailEnLista(
  empleado: { email?: string } | null | undefined,
  lista: readonly string[],
): boolean {
  if (!empleado?.email) return false;
  const norm = empleado.email.trim().toLowerCase();
  return lista.some((e) => e.toLowerCase() === norm);
}

/**
 * true si el empleado logueado es un dev con acceso a las acciones de
 * corrección (editar sesión de caja, forzar cierre). Se matchea por
 * email exacto, case-insensitive. Devuelve false si el empleado es
 * null/undefined o si el email no está en la whitelist.
 */
export function esPragmaDev(empleado: { email?: string } | null | undefined): boolean {
  return emailEnLista(empleado, PRAGMA_DEV_EMAILS);
}

/**
 * true si el empleado es super-admin (dueño o dev). En el hook de
 * permisos del admin, cualquier `puede(...)` devuelve true si esto es
 * true, sin importar el rol ni el override guardado en BD.
 */
export function esSuperAdmin(empleado: { email?: string } | null | undefined): boolean {
  return emailEnLista(empleado, SUPER_ADMIN_EMAILS);
}
