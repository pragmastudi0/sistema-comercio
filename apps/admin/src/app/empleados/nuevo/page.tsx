'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';

export default function NuevoEmpleadoPage() {
  const db = getDb();
  const router = useRouter();
  const qc = useQueryClient();

  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rolId, setRolId] = useState('');
  const [localId, setLocalId] = useState('');
  const [depositoId, setDepositoId] = useState('');

  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: () => db.roles.list() });
  const localesQ = useQuery({ queryKey: ['locales'], queryFn: () => db.locales.list() });
  const depositosQ = useQuery({ queryKey: ['depositos'], queryFn: () => db.depositos.list() });

  const crearMut = useMutation({
    mutationFn: () => {
      if (!nombre || !apellido || !email || !password || !rolId) {
        throw new Error('Completá nombre, apellido, email, contraseña y rol');
      }
      return db.empleados.create(
        {
          empresa_id: PRESET_IDS.empresa,
          nombre,
          apellido,
          email,
          rol_id: rolId,
          local_id: localId || undefined,
          deposito_id: depositoId || undefined,
          activo: true,
        },
        password,
      );
    },
    onSuccess: async () => {
      toast.success('Empleado creado');
      await qc.invalidateQueries({ queryKey: ['empleados'] });
      router.push('/empleados');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/empleados">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Nuevo empleado</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              crearMut.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Nombre</Label>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </div>
              <div>
                <Label className="mb-1 block">Apellido</Label>
                <Input value={apellido} onChange={(e) => setApellido(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label className="mb-1 block">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label className="mb-1 block">Contraseña</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                El empleado podrá cambiarla luego (no implementado en MVP).
              </p>
            </div>
            <div>
              <Label className="mb-1 block">Rol</Label>
              <select
                value={rolId}
                onChange={(e) => setRolId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                <option value="">— Elegir rol —</option>
                {(rolesQ.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block">Local (opcional)</Label>
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
                <Label className="mb-1 block">Local de stock (opcional)</Label>
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
            <div className="flex justify-end gap-2 pt-2">
              <Button asChild variant="outline">
                <Link href="/empleados">Cancelar</Link>
              </Button>
              <Button type="submit" disabled={crearMut.isPending}>
                {crearMut.isPending ? 'Creando…' : 'Crear empleado'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
