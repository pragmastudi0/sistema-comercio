'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Empleado } from '@comercio/db';

type SesionState = {
  empleado: Empleado | null;
  setEmpleado: (e: Empleado | null) => void;
  logout: () => void;
};

export const useSesion = create<SesionState>()(
  persist(
    (set) => ({
      empleado: null,
      setEmpleado: (empleado) => set({ empleado }),
      logout: () => set({ empleado: null }),
    }),
    {
      name: 'turisteando-admin-sesion',
      partialize: (s) => ({ empleado: s.empleado }),
    },
  ),
);
