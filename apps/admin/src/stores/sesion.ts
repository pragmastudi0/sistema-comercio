'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Empleado } from '@comercio/db';
import { storageKey } from '@/lib/storage';

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
      name: storageKey('admin-sesion'),
      partialize: (s) => ({ empleado: s.empleado }),
    },
  ),
);
