import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Caja, Empleado, SesionCaja } from '@comercio/db';

type SesionState = {
  empleado: Empleado | null;
  caja: Caja | null;
  sesionCaja: SesionCaja | null;
  setEmpleado: (e: Empleado | null) => void;
  setCaja: (c: Caja | null) => void;
  setSesionCaja: (s: SesionCaja | null) => void;
  logout: () => void;
};

export const useSesion = create<SesionState>()(
  persist(
    (set) => ({
      empleado: null,
      caja: null,
      sesionCaja: null,
      setEmpleado: (empleado) => set({ empleado }),
      setCaja: (caja) => set({ caja }),
      setSesionCaja: (sesionCaja) => set({ sesionCaja }),
      logout: () => set({ empleado: null, caja: null, sesionCaja: null }),
    }),
    {
      // v2: invalidación masiva de sesiones cacheadas del modo mock con IDs no-UUID.
      // Cambiar el sufijo de versión cuando haga falta volver a limpiar.
      name: 'turisteando-pos-sesion-v2',
      partialize: (s) => ({ empleado: s.empleado, caja: s.caja, sesionCaja: s.sesionCaja }),
    },
  ),
);
