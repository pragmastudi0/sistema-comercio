import { Plus, X } from 'lucide-react';
import { MAX_CARRITOS, useVenta } from '@/stores/venta';
import { Button } from '@comercio/ui/button';

/**
 * Tabs de carritos en paralelo. Aparecen ABAJO del header solo cuando
 * hay más de un carrito abierto (caso típico = 1, no ocupa espacio).
 *
 * Permite a la cajera atender a dos clientes a la vez: armar un carrito,
 * abrir otro con "Nueva venta paralela", atender al segundo, volver al
 * primero. Cada carrito mantiene sus items, descuento y cliente.
 */
export function TabsCarritos() {
  const items = useVenta((s) => s.items);
  const carritosParalelos = useVenta((s) => s.carritosParalelos);
  const carritoActivoId = useVenta((s) => s.carritoActivoId);
  const nuevoCarrito = useVenta((s) => s.nuevoCarrito);
  const cambiarCarrito = useVenta((s) => s.cambiarCarrito);
  const cerrarCarrito = useVenta((s) => s.cerrarCarrito);

  const idsParalelos = Object.keys(carritosParalelos);
  const totalCarritos = idsParalelos.length + 1;
  const llegoAlMax = totalCarritos >= MAX_CARRITOS;

  // El botón "Nueva venta paralela" está SIEMPRE disponible — la cajera
  // puede querer arrancar un segundo carrito antes de haber cargado nada
  // en el primero (ej: cliente pidió mostrar dos combos distintos).
  // Las tabs solo aparecen cuando hay ≥2 carritos, así una sola venta
  // no se ve "tabificada".
  const mostrarTabs = totalCarritos > 1;

  // Lista ordenada para render: activo primero, después los paralelos
  // en el orden en que están guardados (insertion order del Object).
  const tabs: Array<{ id: string; label: string; itemCount: number; activo: boolean }> = [
    {
      id: carritoActivoId,
      label: rotular(carritoActivoId),
      itemCount: items.length,
      activo: true,
    },
    ...idsParalelos.map((id) => ({
      id,
      label: rotular(id),
      itemCount: carritosParalelos[id]?.items.length ?? 0,
      activo: false,
    })),
  ];

  return (
    <div className="flex items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
      {mostrarTabs &&
        tabs.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-0.5 rounded-md border ${
              t.activo
                ? 'border-primary bg-background'
                : 'border-input bg-card hover:bg-accent'
            }`}
          >
            <button
              type="button"
              onClick={() => cambiarCarrito(t.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
              title={t.activo ? 'Carrito activo' : 'Cambiar a este carrito'}
            >
              <span>{t.label}</span>
              {t.itemCount > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    t.activo ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  }`}
                >
                  {t.itemCount}
                </span>
              )}
            </button>
            {/* Cerrar disponible en ambos: si es el activo, salta al paralelo
                o queda vacío; si es paralelo, lo borra. */}
            <button
              type="button"
              onClick={() => {
                if (t.itemCount === 0 || confirm(`¿Descartar "${t.label}" con ${t.itemCount} ítem(s)?`)) {
                  cerrarCarrito(t.id);
                }
              }}
              className="px-1 py-1 text-muted-foreground hover:text-destructive"
              title="Cerrar carrito"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={llegoAlMax}
        onClick={() => nuevoCarrito()}
        className={`${mostrarTabs ? 'ml-1' : ''} h-7 px-2 text-xs`}
        title={llegoAlMax ? `Máximo ${MAX_CARRITOS} carritos a la vez` : 'Abrir un carrito nuevo en paralelo'}
      >
        <Plus className="mr-1 h-3 w-3" />
        Nueva venta paralela
      </Button>
    </div>
  );
}

/** Etiquetas legibles: c1 → "Venta 1", c2 → "Venta 2"... */
function rotular(id: string): string {
  const n = id.replace(/^c/, '');
  return `Venta ${n}`;
}
