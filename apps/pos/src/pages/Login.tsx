import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LogIn } from 'lucide-react';
import { BRAND } from '@comercio/business';
import { useSesion } from '@/stores/sesion';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Input } from '@comercio/ui/input';
import { PasswordInput } from '@comercio/ui/password-input';
import { Label } from '@comercio/ui/label';
import { Button } from '@comercio/ui/button';

export function Login() {
  const db = getDb();
  const navigate = useNavigate();
  const setEmpleado = useSesion((s) => s.setEmpleado);
  // Si el cajero hizo "Salir" sin cerrar caja, el store conserva la
  // sesionCaja en localStorage. Al re-loguearse con el mismo email lo
  // mandamos directo a /caja, no a /abrir-caja (no debe abrir una nueva).
  // Si entra con otro email (cambio de turno) → /abrir-caja como siempre.
  const sesionCaja = useSesion((s) => s.sesionCaja);
  const setSesionCaja = useSesion((s) => s.setSesionCaja);
  const setCaja = useSesion((s) => s.setCaja);
  // Cuando el SSO desde admin falla y caemos al login manual, el admin
  // nos pasa ?email=... para que el dueño/encargado no tenga que tipear
  // el email también — sólo la contraseña.
  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return '';
    const param = new URLSearchParams(window.location.search).get('email');
    return param ?? '';
  });
  const [password, setPassword] = useState('');

  const loginMut = useMutation({
    mutationFn: async () => {
      const emp = await db.empleados.autenticar(email.trim(), password);
      if (!emp) throw new Error('Email o contraseña incorrectos');
      return emp;
    },
    onSuccess: async (emp) => {
      setEmpleado(emp);
      toast.success(`Hola ${emp.nombre}`);
      // Sanidad: si el store tiene sesionCaja persistido de un turno
      // anterior, primero refrescamos contra BD. Si la sesión ya fue
      // cerrada desde otro lado (Agus la forzó, otro dispositivo la
      // cerró), limpiamos el store y llevamos al empleado a /abrir-caja
      // limpio — sino quedaba con el "Cannot coerce" ambiguo o entraba
      // a /caja con una sesión fantasma.
      let sesionVigente = sesionCaja;
      if (sesionCaja) {
        try {
          const real = await db.sesionesCaja.get(sesionCaja.id);
          if (!real || real.estado === 'cerrada') {
            setSesionCaja(null);
            setCaja(null);
            sesionVigente = null;
          } else {
            sesionVigente = real;
          }
        } catch {
          // Si el fetch falla no bloqueamos: seguimos con lo del store y
          // dejamos que las guardas de /caja resuelvan.
        }
      }
      // Si hay una caja activa en el store (la dejó abierta el usuario
      // anterior via "Cambiar usuario") y el que entra ES OTRO empleado,
      // marcamos el traspaso: actualizamos empleado_actual_id de la sesión
      // y logueamos el cambio en auditoría para que el admin lo vea después.
      if (sesionVigente && sesionVigente.estado === 'abierta') {
        const responsableAnterior =
          sesionVigente.empleado_actual_id ?? sesionVigente.empleado_id;
        if (responsableAnterior !== emp.id && db.sesionesCaja.cambiarResponsable) {
          try {
            const actualizada = await db.sesionesCaja.cambiarResponsable(
              sesionVigente.id,
              emp.id,
            );
            setSesionCaja(actualizada);
            db.auditoria
              .log({
                accion: 'cambio_responsable_caja',
                entidad: 'sesion_caja',
                entidad_id: sesionVigente.id,
                empleado_id: emp.id,
                detalle: {
                  empleado_anterior_id: responsableAnterior,
                  empleado_nuevo_id: emp.id,
                  empleado_nuevo_nombre: `${emp.nombre} ${emp.apellido ?? ''}`.trim(),
                },
              })
              .catch(() => {});
          } catch (e) {
            // No bloquear el login si falla el traspaso — la sesión sigue
            // funcionando, solo queda con el responsable anterior en admin.
            // eslint-disable-next-line no-console
            console.error('No se pudo cambiar responsable de la caja:', e);
          }
        }
      }
      navigate(sesionVigente ? '/caja' : '/abrir-caja');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">{BRAND.nombreCorto}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5" />
            Iniciar turno
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loginMut.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="email" className="mb-1 block">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoFocus={email === ''}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cajero@comercio.local"
                required
              />
            </div>
            <div>
              <Label htmlFor="password" className="mb-1 block">
                Contraseña
              </Label>
              <PasswordInput
                id="password"
                autoFocus={email !== ''}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loginMut.isPending}>
              {loginMut.isPending ? 'Verificando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>

    </main>
  );
}
