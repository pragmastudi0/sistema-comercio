'use client';

import { useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@comercio/ui/table';
import { Button } from '@comercio/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Skeleton } from '@comercio/ui/skeleton';

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

/**
 * ABM genérico: lista + dialog de crear/editar + eliminar con confirmación.
 * Útil para CRUDs simples (categorías, listas de precios, proveedores, etc.).
 */
export function AbmSimple<T extends { id: string }>({
  titulo,
  descripcion,
  rows,
  loading,
  columns,
  buildCreate,
  buildEdit,
  canDelete,
  onDelete,
  emptyMessage = 'No hay registros todavía.',
  newButtonLabel = 'Nuevo',
}: {
  titulo: string;
  descripcion?: string;
  rows: T[];
  loading?: boolean;
  columns: Column<T>[];
  /** Renderiza el contenido del dialog para CREAR. Recibe close(). */
  buildCreate: (close: () => void) => ReactNode;
  /** Renderiza el contenido del dialog para EDITAR. Recibe row y close(). */
  buildEdit: (row: T, close: () => void) => ReactNode;
  canDelete?: (row: T) => boolean | string; // true para permitir, string para mensaje de error
  onDelete?: (row: T) => Promise<void> | void;
  emptyMessage?: string;
  newButtonLabel?: string;
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);

  async function eliminar(row: T) {
    if (canDelete) {
      const r = canDelete(row);
      if (r !== true) {
        alert(typeof r === 'string' ? r : 'No se puede eliminar');
        return;
      }
    }
    if (!confirm('¿Eliminar este registro?')) return;
    await onDelete?.(row);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">{titulo}</CardTitle>
            {descripcion && <p className="text-sm text-muted-foreground">{descripcion}</p>}
          </div>
          <Button onClick={() => setOpenCreate(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {newButtonLabel}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c, i) => (
                    <TableHead key={i} className={c.className}>
                      {c.header}
                    </TableHead>
                  ))}
                  {onDelete && <TableHead className="w-12 text-right" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  // Toda la fila es clickeable → abre el dialog de editar.
                  // Antes había una columna "Acciones" con dos iconos
                  // (Editar / Eliminar) que en tablas anchas forzaba a
                  // scrollear horizontal para llegar a ellos. Ahora click
                  // en cualquier celda abre la edición; el eliminar queda
                  // como icono chico al final con stopPropagation.
                  <TableRow
                    key={row.id}
                    onClick={() => setEditing(row)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    {columns.map((c, i) => (
                      <TableCell key={i} className={c.className}>
                        {c.cell(row)}
                      </TableCell>
                    ))}
                    {onDelete && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            eliminar(row);
                          }}
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogHeader>
          <DialogTitle>{newButtonLabel}</DialogTitle>
        </DialogHeader>
        {buildCreate(() => setOpenCreate(false))}
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogHeader>
          <DialogTitle>Editar</DialogTitle>
        </DialogHeader>
        {editing && buildEdit(editing, () => setEditing(null))}
      </Dialog>
    </>
  );
}

export function AbmDialogFooter({
  onCancel,
  onSubmit,
  submitLabel = 'Guardar',
  submitting,
  disabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitting?: boolean;
  disabled?: boolean;
}) {
  return (
    <DialogFooter>
      <Button variant="ghost" onClick={onCancel} disabled={submitting}>
        Cancelar
      </Button>
      <Button onClick={onSubmit} disabled={submitting || disabled}>
        {submitting ? 'Guardando…' : submitLabel}
      </Button>
    </DialogFooter>
  );
}
