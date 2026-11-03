// Branding del comercio. Carpetas y DB siguen llamándose "comercio";
// el nombre visible se decide acá.
//
// El nombre se puede sobreescribir vía env var sin tocar código, útil para
// armar instancias demo / multi-tenant:
//   NEXT_PUBLIC_BRAND_NAME   → apps Next.js (admin, web)
//   VITE_BRAND_NAME          → app Vite (pos); usar setBrandName() desde main
//
// Si no hay env, queda el default "#turisteando".

// Acceso defensivo a process.env: declare local para no depender de @types/node
// en este package (que también se importa desde apps Vite).
declare const process: { env: Record<string, string | undefined> } | undefined;

function readNextBrand(): string | undefined {
  // process.env existe en Node y en builds Next.js (webpack lo inlinea).
  // En Vite no existe, por eso el typeof.
  if (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_BRAND_NAME) {
    return process.env.NEXT_PUBLIC_BRAND_NAME;
  }
  return undefined;
}

const inicial = readNextBrand() ?? '#turisteando';

export const BRAND = {
  nombreCorto: inicial,
  nombreCompleto: inicial,
  tagline: '',
};

/**
 * Reasigna el branding en tiempo de ejecución. El PoS (Vite) lo llama al
 * arrancar leyendo `import.meta.env.VITE_BRAND_NAME`, antes del primer render.
 */
export function setBrandName(name: string): void {
  if (!name) return;
  BRAND.nombreCorto = name;
  BRAND.nombreCompleto = name;
}
