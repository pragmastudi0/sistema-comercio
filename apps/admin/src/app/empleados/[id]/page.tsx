'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { evaluarPermisos, type PermisosConfig } from '@comercio/business';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@comercio/ui/tabs';
import { Skeleton } from '@comercio/ui/skeleton';
import { MatrizPermisos } from '@/components/matriz-permisos';

export default function EditarEmpleadoPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const db = getDb();
  const router = useRouter();
  const qc = useQueryClient();

  const empQ = useQuery({ queryKey: ['empleado', id], queryFn: () => db.empleados.get(id) });
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: () => db.roles.list() });
  const localesQ = useQuery({ queryKey: ['locales'], queryFn: () => db.locales.list() });
  const depositosQ = useQuery({ queryKey: ['depositos'], queryFn: () => db.depositos.list() });

  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [rolId, setRolId] = useState('');
  const [localId, setLocalId] = useState('');
  const [depositoId, setDepositoId] = useState('');
  const [activo, setActivo] = useState(true);
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [override, setOverride] = useState<PermisosConfig | undefined>(undefined);

  useEffect(() => {
    if (empQ.data) {
      setNombre(empQ.data.nombre);
      setApellido(empQ.data.apellido);
      setEmail(empQ.data.email);
      setRolId(empQ.data.rol_id);
      setLocalId(empQ.data.local_id ?? '');
      setDepositoId(empQ.data.deposito_id ?? '');
      setActivo(empQ.data.activo);
      setOverride(empQ.data.permisos_override);
    }
  }, [empQ.data]);

  const rolActual = (rolesQ.data ?? []).find((r) => r.id === rolId);
  const permisosEfectivos = rolActual
    ? evaluarPermisos(rolActual.permisos, override)
    : ({} as PermisosConfig);

  const guardarMut = useMutation({
    mutationFn: async () => {
      await db.empleados.update(id, {
        nombre,
        apellido,
        email,
        rol_id: rolId,
        local_id: localId || undefined,
        deposito_id: depositoId || undefined,
        activo,
      });
      await db.empleados.setOverridePermisos(id, override);
      // Solo cambiar password si el usuario realmente escribió algo (no usar
      // valores autocompletados por el navegador con espacios o vacíos).
      const passLimpia = nuevaPassword.trim();
      if (passLimpia.length >= 6) {
        await db.empleados.setPassword(id, passLimpia);
      }
    },
    onSuccess: async () => {
      toast.success('Cambios guardados');
      setNuevaPassword('');
      await qc.invalidateQueries({ queryKey: ['empleados'] });
      await qc.invalidateQueries({ queryKey: ['empleado', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: () => db.empleados.delete(id),
    onSuccess: async () => {
      toast.success(
        'Empleado desactivado. Ya no puede ingresar pero su historial queda intacto.',
      );
      await qc.invalidateQueries({ queryKey: ['empleados'] });
      router.push('/empleados');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (empQ.isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!empQ.data) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <p>Empleado no encontrado.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/empleados">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver
        </Link>
      </Button>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            {nombre} {apellido}
          </h1>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
        <div className="flex gap-2">
          {/* Soft delete: el empleado queda inactivo (no puede loguearse)
              pero se preserva el historial. Si después vuelve, se reactiva
              cambiando el switch "Activo" en el tab Datos. */}
          {activo && (
            <Button
              variant="outline"
              onClick={() => {
                if (
                  confirm(
                    '¿Desactivar este empleado?\n\n' +
                      'Ya no va a poder iniciar sesión, pero su historial ' +
                      '(ventas, movimientos, cajas) queda intacto. Si vuelve ' +
                      'más adelante podés reactivarlo desde acá mismo.',
                  )
                )
                  eliminarMut.mutate();
              }}
              className="text-destructive"
            >
              Desactivar
            </Button>
          )}
          <Button onClick={() => guardarMut.mutate()} disabled={guardarMut.isPending}>
            {guardarMut.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="datos">
        <TabsList>
          <TabsTrigger value="datos">Datos personales</TabsTrigger>
          <TabsTrigger value="permisos">Permisos</TabsTrigger>
        </TabsList>

        <TabsContent value="datos">
          <Card>
            <CardHeader>
              <CardTitle>Datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block">Nombre</Label>
                  <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1 block">Apellido</Label>
                  <Input value={apellido} onChange={(e) => setApellido(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="mb-1 block">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block">Nueva contraseña (opcional)</Label>
                <Input
                  type="password"
                  // Evita que Chrome/Safari autocompleten con la contraseña
                  // del admin logueado y disparen un cambio que no quisimos.
                  autoComplete="new-password"
                  name="nuevaPasswordEmpleadoEdit"
                  value={nuevaPassword}
                  onChange={(e) => setNuevaPassword(e.target.value)}
                  placeholder="Dejar vacío para no cambiarla"
                  minLength={6}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Solo se cambia si escribís una nueva (mínimo 6 caracteres).
                </p>
              </div>
              <div>
                <Label className="mb-1 block">Rol</Label>
                <select
                  value={rolId}
                  onChange={(e) => setRolId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {(rolesQ.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block">Local</Label>
                  <select
                    value={localId}
                    onChange={(e) => setLocalId(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Sin asignar —</option>
                    {(localesQ.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="mb-1 block">Local de stock</Label>
                  <select
                    value={depositoId}
                    onChange={(e) => setDepositoId(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Sin asignar —</option>
                    {(depositosQ.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <input
                  id="activo"
                  type="checkbox"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                  className="h-4 w-4"
                />
                <Label htmlFor="activo">Empleado activo (puede iniciar sesión)</Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permisos">
          <Card>
            <CardHeader>
              <CardTitle>Permisos efectivos</CardTitle>
              <p className="text-sm text-muted-foreground">
                Permisos del rol <strong>{rolActual?.nombre ?? '—'}</strong> + overrides
                puntuales para este empleado. Los cambios se guardan al hacer "Guardar cambios"
                arriba.
              </p>
            </CardHeader>
            <CardContent>
              {rolActual ? (
                <MatrizPermisos
                  rolPerms={rolActual.permisos}
                  override={override}
                  onOverrideChange={setOverride}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Elegí un rol primero.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
