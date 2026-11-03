'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { PermisosConfig } from '@comercio/business';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Badge } from '@comercio/ui/badge';
import { Skeleton } from '@comercio/ui/skeleton';
import { MatrizPermisos } from '@/components/matriz-permisos';

export default function EditarRolPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const db = getDb();
  const router = useRouter();
  const qc = useQueryClient();

  const rolQ = useQuery({ queryKey: ['rol', id], queryFn: () => db.roles.get(id) });
  const empleadosQ = useQuery({
    queryKey: ['empleados'],
    queryFn: () => db.empleados.list(),
  });

  const [nombre, setNombre] = useState('');
  const [permisos, setPermisos] = useState<PermisosConfig>({});

  useEffect(() => {
    if (rolQ.data) {
      setNombre(rolQ.data.nombre);
      setPermisos(rolQ.data.permisos);
    }
  }, [rolQ.data]);

  const guardarMut = useMutation({
    mutationFn: () => db.roles.update(id, { nombre, permisos }),
    onSuccess: async () => {
      toast.success('Rol guardado');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      await qc.invalidateQueries({ queryKey: ['rol', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: () => db.roles.delete(id),
    onSuccess: async () => {
      toast.success('Rol eliminado');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      router.push('/roles');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Truco para el editor de permisos: usamos la matriz con un "rol base" vacío y los
  // permisos del rol como override editable. Cuando el override se setea, los persistimos
  // como permisos del rol. Esto evita un nuevo componente.
  function onMatrixChange(next: PermisosConfig | undefined) {
    setPermisos(next ?? {});
  }

  if (rolQ.isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!rolQ.data) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <p>Rol no encontrado.</p>
      </div>
    );
  }

  const usados = (empleadosQ.data ?? []).filter((e) => e.rol_id === id).length;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/roles">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver
        </Link>
      </Button>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold sm:text-2xl">{rolQ.data.nombre}</h1>
          {rolQ.data.preset && <Badge variant="secondary">preset del sistema</Badge>}
        </div>
        <div className="flex gap-2">
          {!rolQ.data.preset && (
            <Button
              variant="outline"
              onClick={() => {
                if (usados > 0) {
                  toast.error(
                    `No se puede eliminar: hay ${usados} empleado(s) con este rol asignado`,
                  );
                  return;
                }
                if (confirm('¿Eliminar este rol?')) eliminarMut.mutate();
              }}
              className="text-destructive"
            >
              Eliminar rol
            </Button>
          )}
          <Button onClick={() => guardarMut.mutate()} disabled={guardarMut.isPending}>
            {guardarMut.isPending ? 'Guardando…' : 'Guardar permisos'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent>
          <Label className="mb-1 block">Nombre</Label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="max-w-md" />
          {rolQ.data.preset && (
            <p className="mt-2 text-xs text-muted-foreground">
              Este es un rol preset del sistema. Podés editarlo, pero los nuevos roles custom son
              la opción recomendada.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Permisos del rol</CardTitle>
          <p className="text-sm text-muted-foreground">
            Click en cada acción para permitir/bloquear. Los empleados con este rol heredan
            todos los permisos marcados como permitidos (verde).
          </p>
        </CardHeader>
        <CardContent>
          <MatrizPermisos
            rolPerms={{}}
            override={permisos}
            onOverrideChange={onMatrixChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
