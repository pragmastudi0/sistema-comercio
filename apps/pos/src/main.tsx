import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { setBrandName } from '@comercio/business';
import App from './App';
import '@comercio/ui/styles';

// Permite overridear el nombre del comercio desde env de Vite, para armar
// instancias demo / multi-tenant sin tocar código. Debe correr antes del
// primer render.
const brandEnv = (import.meta.env.VITE_BRAND_NAME ?? '').trim();
if (brandEnv) setBrandName(brandEnv);

// Tamaño de fuente base del PoS un poco más grande que el default web.
// Pedido del cliente: hay cajeros con visión cansada y el sistema se usa
// muchas horas seguidas. Aumentamos a 17px (default web es 16px); como
// Tailwind usa rem, todo el árbol escala parejo.
if (typeof document !== 'undefined') {
  document.documentElement.style.fontSize = '17px';
}

// === Limpieza de assets de versiones anteriores ===
// Borrar localStorage de la vesión v1 (que tenía residuo del modo mock).
try {
  localStorage.removeItem('turisteando-pos-sesion');
} catch {
  /* navegador con storage bloqueado */
}

// === Auto-update de la PWA ===
// El SW está configurado con skipWaiting + clientsClaim para que la
// versión nueva tome control sin esperar. Pero el JS ya cargado en la
// tab sigue siendo el viejo hasta el próximo reload. Lo forzamos:
//
//  1. Al arrancar, llamamos update() en todos los SW registrados (gatilla
//     descarga del manifest nuevo si hay).
//  2. Suscribimos a `controllerchange` — se dispara cuando el SW que
//     controla la pestaña cambia (o sea: nueva versión activada). Ahí
//     hacemos location.reload() para que el bundle nuevo entre en uso.
//  3. Polling cada 60s llamando registration.update() — así si la cajera
//     deja el PoS abierto todo el día y pusheamos un fix, en ~1 minuto
//     ya está corriendo el código nuevo sin pasos manuales.
//
// Usamos un flag para no entrar en loop infinito si el SW cambia varias
// veces durante el lifecycle (ej. en dev).
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      regs.forEach((r) => r.update().catch(() => {}));
      // Polling: cada 60s pedirle al navegador que chequee si hay versión
      // nueva del SW. Si la hay → controllerchange → reload automático.
      setInterval(() => {
        regs.forEach((r) => r.update().catch(() => {}));
      }, 60_000);
    })
    .catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        {/* bottom-right: los toasts (éxito de venta, avisos, errores)
            no tapan los botones del header (Cobrar / Anular / Ajustar
            caja / Stock / Historial). duration global corto: los
            cajeros procesan ventas rápido y el confirm del toast
            estorba si se queda mucho. */}
        <Toaster richColors position="bottom-right" duration={2000} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
