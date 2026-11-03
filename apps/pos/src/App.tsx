import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { Login } from './pages/Login';
import { AbrirCaja } from './pages/AbrirCaja';
import { Caja } from './pages/Caja';
import { CerrarCaja } from './pages/CerrarCaja';
import { Historial } from './pages/Historial';
import { Ticket } from './pages/Ticket';
import { Reset } from './pages/Reset';
import { RequireEmpleado, RequireSesionAbierta } from './components/RequireSesion';
import { DemoGuard } from './components/DemoGuard';
import { getDb } from './lib/db';
import { useSesion } from './stores/sesion';

export default function App() {
  return (
    <SSOGate>
      <DemoGuard />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/abrir-caja"
          element={
            <RequireEmpleado>
              <AbrirCaja />
            </RequireEmpleado>
          }
        />
        <Route
          path="/caja"
          element={
            <RequireSesionAbierta>
              <Caja />
            </RequireSesionAbierta>
          }
        />
        <Route
          path="/cerrar-caja"
          element={
            <RequireSesionAbierta>
              <CerrarCaja />
            </RequireSesionAbierta>
          }
        />
        <Route
          path="/historial"
          element={
            <RequireSesionAbierta>
              <Historial />
            </RequireSesionAbierta>
          }
        />
        <Route path="/ticket/:id" element={<Ticket />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </SSOGate>
  );
}

/**
 * SSO admin → PoS. Si el admin abrió el PoS pasando `#sso=AT|RT` en la URL,
 * tomamos esos tokens, hidratamos la sesión de Supabase, cargamos el empleado
 * y vamos directo a /abrir-caja. Limpia el hash al instante para que los
 * tokens no queden en la barra de direcciones ni en el history.
 *
 * Si no hay hash SSO, este wrapper es transparente.
 */
function SSOGate({ children }: { children: React.ReactNode }) {
  const [procesando, setProcesando] = useState(() => /^#sso=/.test(window.location.hash));

  useEffect(() => {
    const match = /^#sso=([^|]+)\|(.+)$/.exec(window.location.hash);
    if (!match) return;
    const [, at, rt] = match;
    // Borrar el hash ANTES del await para no dejar tokens visibles ni en
    // el address bar ni en el history del navegador.
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
    (async () => {
      try {
        const db = getDb();
        if (!db.empleados.hidratarSesion) {
          toast.error('Auto-login no soportado en este modo');
          window.location.replace('/login');
          return;
        }
        const empleado = await db.empleados.hidratarSesion(at!, rt!);
        if (!empleado) {
          toast.error('Sesión expirada. Iniciá sesión normalmente.');
          window.location.replace('/login');
          return;
        }
        // Pisamos toda la sesión en un único setState atómico (si veníamos
        // logueados con otro empleado, su caja/sesion no debe arrastrarse).
        // Zustand persist guarda en localStorage sincrónicamente, así que
        // el siguiente reload va a leer al empleado SSO ya hidratado.
        useSesion.setState({ empleado, caja: null, sesionCaja: null });
        toast.success(`Hola ${empleado.nombre}`);
        // Full reload en vez de navigate: el routing interno de React
        // a veces no se entera del cambio de URL mientras estamos en el
        // gate (el componente Routes está oculto detrás de "Iniciando
        // sesión…"). location.replace garantiza que el router monte
        // limpio en /abrir-caja con la sesión ya en localStorage.
        window.location.replace('/abrir-caja');
      } catch (e) {
        toast.error(`No pudimos iniciar tu sesión: ${(e as Error).message}`);
        window.location.replace('/login');
      } finally {
        setProcesando(false);
      }
    })();
  }, []);

  if (procesando) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Iniciando sesión…
      </main>
    );
  }
  return <>{children}</>;
}
