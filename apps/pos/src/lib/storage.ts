// Prefijo neutro para claves de localStorage. Nada de nombre de cliente:
// configurable por env (VITE_APP_KEY), default genérico 'sc' (sistema-comercio).
// Subdominios distintos = orígenes distintos = storage separado, así que el
// prefijo no necesita incluir la empresa.
const APP_KEY = (import.meta.env.VITE_APP_KEY ?? 'sc').trim() || 'sc';

export const storageKey = (suffix: string): string => `${APP_KEY}-${suffix}`;
