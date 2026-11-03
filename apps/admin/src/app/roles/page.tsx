'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { PERMISOS_PRESET } from '@comercio/business';
import { getDb } from '@/lib/db';
import { PaginaProtegida, RequierePermiso } from '@/lib/permisos';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@comercio/ui/table';
import { Badge } from '@comercio/ui/badge';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Skeleton } from '@comercio/ui/skeleton';

export default function RolesPage() {
  return (
    <PaginaProtegida modulo="roles" accion="ver">
      <RolesInner />
    </PaginaProtegida>
  );
}

function RolesInner() {
  const db = getDb();
  const qc = useQueryClient();
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: () => db.roles.list() });
  const empleadosQ = useQuery({ queryKey: ['empleados'], queryFn: () => db.empleados.list() });

  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [copiarDe, setCopiarDe] = useState<string>('cajero');

  const crearMut = useMutation({
    mutationFn: () => {
      if (!nombre.trim()) throw new Error('Nombre requerido');
      const base = PERMISOS_PRESET[copiarDe as keyof typeof PERMISOS_PRESET] ?? {};
      return db.roles.create({
        nombre: nombre.trim(),
        preset: false,
        permisos: JSON.parse(JSON.stringify(base)),
      });
    },
    onSuccess: async (r) => {
      toast.success(`Rol "${r.nombre}" creado`);
      setOpen(false);
      setNombre('');
      await qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cantPorRol = (rolId: string) =>
    (empleadosQ.data ?? []).filter((e) => e.rol_id === rolId).length;

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Roles y permisos</h1>
          <p className="text-sm text-muted-foreground">
            Cada rol define qué pueden hacer los empleados que lo tienen asignado.
          </p>
        </div>
        <RequierePermiso modulo="roles" accion="crear">
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Nuevo rol
          </Button>
        </RequierePermiso>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
        </CardHeader>
        <CardContent>
          {rolesQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Empleados</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rolesQ.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.nombre}</TableCell>
                    <TableCell>
                      {r.preset ? (
                        <Badge variant="secondary">preset del sistema</Badge>
                      ) : (
                        <Badge>custom</Badge>
                      )}
                    </TableCell>
                    <TableCell>{cantPorRol(r.id)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/roles/${r.id}`}>Editar permisos</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Crear rol custom</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block">Nombre</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Encargado de local"
              autoFocus
            />
          </div>
          <div>
            <Label className="mb-1 block">Copiar permisos de</Label>
            <select
              value={copiarDe}
              onChange={(e) => setCopiarDe(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="cajero">Cajero (mínimos)</option>
              <option value="encargado">Encargado (medio)</option>
              <option value="catalogo">Carga de catálogo</option>
              <option value="admin">Admin (todos)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Después podés ajustarlos en la matriz.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={() => crearMut.mutate()} disabled={crearMut.isPending}>
            Crear rol
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
