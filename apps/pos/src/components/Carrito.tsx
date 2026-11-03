import { useVenta } from '@/stores/venta';
import { ItemCarritoRow } from './ItemCarritoRow';

export function Carrito() {
  const items = useVenta((s) => s.items);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg">Carrito vacío</p>
          <p className="mt-1 text-sm">Buscá un producto arriba o tipeá el código + Enter</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-xs uppercase text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left">Código</th>
            <th className="px-3 py-2 text-left">Producto</th>
            <th className="px-3 py-2 text-center">Cantidad</th>
            <th className="px-3 py-2 text-right">Precio</th>
            <th className="px-3 py-2 text-right">% Dto</th>
            <th className="px-3 py-2 text-right">Subtotal</th>
            <th className="w-12" />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <ItemCarritoRow key={it.producto.id} item={it} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
