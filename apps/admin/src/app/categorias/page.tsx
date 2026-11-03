'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { AbmDialogFooter, AbmSimple } from '@/components/abm-simple';
import type { Categoria } from '@comercio/db';
import { PaginaProtegida } from '@/lib/permisos';

function CategoriasPageInner() {
  const db = getDb();
  const qc = useQueryClient();
  const categoriasQ = useQuery({ queryKey: ['categorias'], queryFn: () => db.categorias.list() });
  const productosQ = useQuery({ queryKey: ['productos-all'], queryFn: () => db.productos.list() });

  const [texto, setTexto] = useState('');

  const crearMut = useMutation({
    mutationFn: (input: { nombre: string; descripcion?: string }) =>
      // Casting porque el tipo Categoria no incluye descripcion todavía
      // (campo opcional agregado a la tabla por SQL; ver mensaje al cliente).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.categorias.create(input as any),
    onSuccess: () => {
      toast.success('Categoría creada');
      qc.invalidateQueries({ queryKey: ['categorias'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const editarMut = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; nombre?: string; descripcion?: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.categorias.update(id, patch as any),
    onSuccess: () => {
      toast.success('Categoría editada');
      qc.invalidateQueries({ queryKey: ['categorias'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => db.categorias.delete(id),
    onSuccess: () => {
      toast.success('Categoría eliminada');
      qc.invalidateQueries({ queryKey: ['categorias'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cantPorCat = (id: string) =>
    (productosQ.data ?? []).filter((p) => p.categoria_id === id).length;

  // Filtro por nombre — case insensitive, parcial.
  const filtradas = useMemo(() => {
    const all = categoriasQ.data ?? [];
    if (!texto.trim()) return all;
    const q = texto.toLowerCase();
    return all.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [categoriasQ.data, texto]);

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4">
        <h1 className="text-xl font-semibold sm:text-2xl">Categorías</h1>
        <p className="text-sm text-muted-foreground">
          Agrupan productos para organizarlos y filtrarlos en el catálogo.
        </p>
      </div>

      {/* Buscador arriba de la tabla — sigue el patrón del cuadro de productos */}
      <div className="mb-3 rounded border border-slate-300 bg-white p-2 shadow-sm">
        <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
          Filtrar por nombre
        </Label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Nombre de la categoría"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="h-8 pl-7 text-sm"
            autoFocus
          />
        </div>
      </div>

      <AbmSimple<Categoria>
        titulo="Categorías"
        rows={filtradas}
        loading={categoriasQ.isLoading}
        newButtonLabel="Nueva categoría"
        columns={[
          { header: 'Nombre', cell: (r) => <span className="font-medium">{r.nombre}</span> },
          {
            header: 'Descripción',
            cell: (r) => {
              // Casting porque el tipo Categoria todavía no incluye descripcion.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const desc = (r as any).descripcion as string | null | undefined;
              return desc ? (
                <span className="text-sm text-slate-700">{desc}</span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              );
            },
          },
          {
            header: 'Productos',
            cell: (r) => {
              const cant = cantPorCat(r.id);
              if (cant === 0) {
                return <span className="text-sm text-muted-foreground">0</span>;
              }
              return (
                <Link
                  href={`/productos?categoria=${r.id}`}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                  title="Ver los productos de esta categoría"
                >
                  {cant} →
                </Link>
              );
            },
          },
        ]}
        buildCreate={(close) => (
          <CategoriaForm
            onSubmit={(v) => {
              crearMut.mutate(v);
              close();
            }}
            onCancel={close}
          />
        )}
        buildEdit={(row, close) => (
          <CategoriaForm
            initialNombre={row.nombre}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            initialDescripcion={(row as any).descripcion ?? ''}
            onSubmit={(v) => {
              editarMut.mutate({ id: row.id, ...v });
              close();
            }}
            onCancel={close}
          />
        )}
        canDelete={(r) => {
          const cant = cantPorCat(r.id);
          if (cant > 0) return `No se puede eliminar: ${cant} producto(s) usan esta categoría`;
          return true;
        }}
        onDelete={(r) => eliminarMut.mutateAsync(r.id)}
        emptyMessage={
          texto.trim()
            ? 'No se encontraron categorías con ese nombre.'
            : 'No hay categorías. Creá la primera con el botón de arriba.'
        }
      />
    </div>
  );
}

function CategoriaForm({
  initialNombre = '',
  initialDescripcion = '',
  onSubmit,
  onCancel,
}: {
  initialNombre?: string;
  initialDescripcion?: string;
  onSubmit: (v: { nombre: string; descripcion?: string }) => void;
  onCancel: () => void;
}) {
  const [nombre, setNombre] = useState(initialNombre);
  const [descripcion, setDescripcion] = useState(initialDescripcion);

  function submit() {
    if (!nombre.trim()) return;
    onSubmit({
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || undefined,
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block">Nombre</Label>
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Jugueteria"
          autoFocus
        />
      </div>
      <div>
        <Label className="mb-1 block">Descripción (opcional)</Label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción breve de la categoría"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <AbmDialogFooter onCancel={onCancel} onSubmit={submit} disabled={!nombre.trim()} />
    </div>
  );
}

export default function CategoriasPage() {
  return (
    <PaginaProtegida modulo="categorias" accion="ver">
      <CategoriasPageInner />
    </PaginaProtegida>
  );
}
