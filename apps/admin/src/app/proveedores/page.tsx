'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Badge } from '@comercio/ui/badge';
import { AbmDialogFooter, AbmSimple } from '@/components/abm-simple';
import type { Proveedor } from '@comercio/db';
import { PaginaProtegida } from '@/lib/permisos';

function ProveedoresPageInner() {
  const db = getDb();
  const qc = useQueryClient();
  const provQ = useQuery({ queryKey: ['proveedores-admin'], queryFn: () => db.proveedores.list() });
  const productosQ = useQuery({ queryKey: ['productos-all'], queryFn: () => db.productos.list() });

  const crearMut = useMutation({
    mutationFn: (v: Omit<Proveedor, 'id'>) => db.proveedores.create(v),
    onSuccess: () => {
      toast.success('Proveedor creado');
      qc.invalidateQueries({ queryKey: ['proveedores-admin'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const editarMut = useMutation({
    mutationFn: ({ id, ...v }: { id: string } & Partial<Proveedor>) =>
      db.proveedores.update(id, v),
    onSuccess: () => {
      toast.success('Proveedor editado');
      qc.invalidateQueries({ queryKey: ['proveedores-admin'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => db.proveedores.delete(id),
    onSuccess: () => {
      toast.success('Proveedor eliminado');
      qc.invalidateQueries({ queryKey: ['proveedores-admin'] });
      // Los productos que tenían este proveedor asignado quedan con
      // proveedor_id = null (FK ON DELETE SET NULL). Invalidamos su
      // cache para que se refleje al abrir /productos.
      qc.invalidateQueries({ queryKey: ['productos-admin'] });
      qc.invalidateQueries({ queryKey: ['productos-all'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cantProductos = (id: string) =>
    (productosQ.data ?? []).filter((p) => p.proveedor_id === id).length;

  const [texto, setTexto] = useState('');
  const filtrados = useMemo(() => {
    const all = provQ.data ?? [];
    if (!texto.trim()) return all;
    const q = texto.toLowerCase();
    return all.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        (p.cuit ?? '').toLowerCase().includes(q) ||
        (p.contacto ?? '').toLowerCase().includes(q),
    );
  }, [provQ.data, texto]);

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4">
        <h1 className="text-xl font-semibold sm:text-2xl">Proveedores</h1>
      </div>

      {/* Buscador arriba — mismo patrón que /categorias y /productos. */}
      <div className="mb-3 rounded border border-slate-300 bg-white p-2 shadow-sm">
        <Label className="mb-0.5 block text-[10px] uppercase text-slate-600">
          Filtrar por nombre, CUIT o contacto
        </Label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar proveedor"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="h-8 pl-7 text-sm"
            autoFocus
          />
        </div>
      </div>

      <AbmSimple<Proveedor>
        titulo="Proveedores"
        rows={filtrados}
        loading={provQ.isLoading}
        newButtonLabel="Nuevo proveedor"
        columns={[
          { header: 'Nombre', cell: (r) => <span className="font-medium">{r.nombre}</span> },
          { header: 'CUIT', cell: (r) => r.cuit ?? <span className="text-muted-foreground">—</span> },
          { header: 'Teléfono', cell: (r) => r.telefono ?? '—' },
          { header: 'Email', cell: (r) => r.email ?? '—' },
          {
            header: 'Productos',
            cell: (r) => {
              const cant = cantProductos(r.id);
              // Si tiene productos, link al listado filtrado. Si no, gris
              // y sin link para no confundir.
              if (cant === 0) {
                return <span className="text-muted-foreground">0</span>;
              }
              return (
                <Link
                  href={`/productos?proveedor=${r.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-primary hover:underline"
                  title="Ver productos de este proveedor"
                >
                  {cant} →
                </Link>
              );
            },
          },
          {
            header: 'Estado',
            cell: (r) =>
              r.activo ? (
                <Badge variant="secondary">Activo</Badge>
              ) : (
                <Badge variant="destructive">Inactivo</Badge>
              ),
          },
        ]}
        buildCreate={(close) => (
          <ProveedorForm
            onSubmit={(v) => {
              crearMut.mutate(v);
              close();
            }}
            onCancel={close}
          />
        )}
        buildEdit={(row, close) => (
          <ProveedorForm
            initial={row}
            onSubmit={(v) => {
              editarMut.mutate({ id: row.id, ...v });
              close();
            }}
            onCancel={close}
          />
        )}
        canDelete={() => true}
        onDelete={(r) => {
          // Warning si hay productos asignados — el borrado deja esos
          // productos con proveedor "—" (FK ON DELETE SET NULL). No
          // bloqueamos: la política del cliente es "el proveedor viejo
          // ya no existe, sáquenlo aunque haya productos asociados".
          const cant = cantProductos(r.id);
          if (cant > 0) {
            const ok = window.confirm(
              `Este proveedor tiene ${cant} producto(s) asignado(s).\n\n` +
                `Al eliminarlo, esos productos van a quedar sin proveedor ` +
                `(los podés reasignar después desde /productos si querés).\n\n` +
                `¿Continuar?`,
            );
            if (!ok) return Promise.resolve();
          }
          return eliminarMut.mutateAsync(r.id);
        }}
      />
    </div>
  );
}

function ProveedorForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Proveedor;
  onSubmit: (v: Omit<Proveedor, 'id'>) => void;
  onCancel: () => void;
}) {
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [cuit, setCuit] = useState(initial?.cuit ?? '');
  const [telefono, setTelefono] = useState(initial?.telefono ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [contacto, setContacto] = useState(initial?.contacto ?? '');
  const [activo, setActivo] = useState(initial?.activo ?? true);

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block">Nombre</Label>
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1 block">CUIT</Label>
          <Input value={cuit} onChange={(e) => setCuit(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block">Teléfono</Label>
          <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1 block">Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1 block">Contacto</Label>
          <Input value={contacto} onChange={(e) => setContacto(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
          className="h-4 w-4"
        />
        Activo
      </label>
      <AbmDialogFooter
        onCancel={onCancel}
        onSubmit={() =>
          nombre.trim() &&
          onSubmit({
            nombre: nombre.trim(),
            cuit: cuit.trim() || undefined,
            telefono: telefono.trim() || undefined,
            email: email.trim() || undefined,
            contacto: contacto.trim() || undefined,
            activo,
          })
        }
        disabled={!nombre.trim()}
      />
    </div>
  );
}

export default function ProveedoresPage() {
  return (
    <PaginaProtegida modulo="proveedores" accion="ver">
      <ProveedoresPageInner />
    </PaginaProtegida>
  );
}
