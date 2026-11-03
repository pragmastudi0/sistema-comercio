// Prefijo neutro para claves de localStorage. Configurable por env
// (NEXT_PUBLIC_APP_KEY), default genérico 'sc'. Sin nombre de cliente.
const APP_KEY = (process.env.NEXT_PUBLIC_APP_KEY ?? 'sc').trim() || 'sc';

export const storageKey = (suffix: string): string => `${APP_KEY}-${suffix}`;
