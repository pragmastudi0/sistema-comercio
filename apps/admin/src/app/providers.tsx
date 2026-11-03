'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { useEffect, useState, type ReactNode } from 'react';
import { createSupabaseRaw } from '@comercio/db';
import { useSesion } from '@/stores/sesion';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cuando el usuario vuelve a la pestaña después de un rato,
            // re-fetchamos: dispara el refresh automático del JWT y mantiene
            // los datos al día. Antes estaba en false y la sesión "moría
            // silenciosamente" cuando el token expiraba.
            refetchOnWindowFocus: true,
            staleTime: 30_000,
            // Reintentar 1 vez tras error de red (más es ruidoso).
            retry: 1,
          },
        },
      }),
  );

  const setEmpleado = useSesion((s) => s.setEmpleado);

  // Escuchar eventos de Supabase Auth para que si la sesión muere de verdad
  // (token revocado / refresh fallido / signOut explícito), avisemos al
  // usuario en vez de que las queries empiecen a fallar en silencio.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const sb = createSupabaseRaw(url, key);
    const { data: sub } = sb.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        // Doble check: supabase-js a veces dispara SIGNED_OUT por
        // errores 401 transitorios (ej. al pegar contra una tabla con
        // RLS restrictiva). Si la sesión sigue viva en el SDK,
        // ignoramos el evento para no kickear al usuario por error.
        // Pasó con encargado entrando a /configuracion: el RPC fallaba
        // por policy y arrastraba al user al login.
        const { data } = await sb.auth.getSession();
        if (data.session) return;
        setEmpleado(null);
        toast.info('Tu sesión expiró. Iniciá sesión de nuevo.');
      }
      // TOKEN_REFRESHED / SIGNED_IN / USER_UPDATED no requieren acción.
    });
    return () => sub.subscription.unsubscribe();
  }, [setEmpleado]);

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
