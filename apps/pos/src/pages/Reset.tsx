import { useEffect, useState } from 'react';

/**
 * Página de limpieza total. El usuario abre /reset cuando el PoS quedó
 * trabado con bundle/sesión cacheados de versiones anteriores. Hacemos:
 *  1) localStorage.clear()
 *  2) sessionStorage.clear()
 *  3) caches API: borrar todos los caches del Service Worker
 *  4) navigator.serviceWorker.unregister() de todos los SW
 *  5) redirigir a /login con un reload forzado (sin cache)
 *
 * No requiere intervención de DevTools del navegador.
 */
export function Reset() {
  const [msg, setMsg] = useState('Limpiando cache del PoS…');

  useEffect(() => {
    (async () => {
      try {
        setMsg('Borrando datos locales…');
        try {
          localStorage.clear();
        } catch {
          /* storage bloqueado */
        }
        try {
          sessionStorage.clear();
        } catch {
          /* storage bloqueado */
        }

        setMsg('Borrando caché del navegador…');
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }

        setMsg('Desregistrando Service Workers…');
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }

        setMsg('Listo. Recargando…');
        // Esperá un toque para que el usuario lea el mensaje
        setTimeout(() => {
          // window.location.replace en lugar de assign para no dejar entry
          // en el history que vuelva a /reset.
          window.location.replace('/login?reset=1');
        }, 600);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setMsg(`Error: ${m}. Intentá borrar manualmente los datos del sitio.`);
      }
    })();
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <div
          style={{
            width: 44,
            height: 44,
            margin: '0 auto 16px',
            border: '3px solid #e5e5e5',
            borderTopColor: '#E93BA1',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <h1 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>
          Reset del PoS
        </h1>
        <p style={{ fontSize: 14, color: '#666', margin: 0 }}>{msg}</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </main>
  );
}
