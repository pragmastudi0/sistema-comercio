import { useEffect, useState } from 'react';

/** Devuelve true cuando el componente terminó de montar en el cliente.
 *  Útil para evitar hydration mismatch con valores que viven en
 *  localStorage / zustand persist. */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
