'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@comercio/ui/table';
import { Badge } from '@comercio/ui/badge';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Skeleton } from '@comercio/ui/skeleton';
import { PaginaProtegida, RequierePermiso } from '@/lib/permisos';

export default function EmpleadosPage() {
  return (
    <PaginaProtegida modulo="empleados" accion="ver">
      <EmpleadosInner />
    </PaginaProtegida>
  );
}

function EmpleadosInner() {
  const db = getDb();
  const [q, setQ] = useState('');

  const empleadosQ = useQuery({
    queryKey: ['empleados', q],
    queryFn: () => db.empleados.list({ texto: q || undefined }),
  });
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: () => db.roles.list() });
  const localesQ = useQuery({ queryKey: ['locales'], queryFn: () => db.locales.list() });

  const rolNombre = (id: string) => rolesQ.data?.find((r) => r.id === id)?.nombre ?? '—';
  const localNombre = (id?: string) =>
    id ? localesQ.data?.find((l) => l.id === id)?.nombre ?? '—' : '—';

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Empleados</h1>
          <p className="text-sm text-muted-foreground">
            Cajeros, encargados y otros usuarios del sistema.
          </p>
        </div>
        <RequierePermiso modulo="empleados" accion="crear">
          <Button asChild>
            <Link href="/empleados/nuevo">
              <Plus className="mr-1 h-4 w-4" />
              Nuevo empleado
            </Link>
          </Button>
        </RequierePermiso>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Listado</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          {empleadosQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Override</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(empleadosQ.data ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {e.nombre} {e.apellido}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.email}</TableCell>
                    <TableCell>{rolNombre(e.rol_id)}</TableCell>
                    <TableCell>{localNombre(e.local_id)}</TableCell>
                    <TableCell>
                      {e.permisos_override ? (
                        <Badge>con override</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.activo ? (
                        <Badge variant="secondary">Activo</Badge>
                      ) : (
                        <Badge variant="destructive">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/empleados/${e.id}`}>Editar</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
