import { ShoppingBag, MessageCircle, Package } from 'lucide-react';

/**
 * "Cómo comprar" — sección con los pasos del proceso.
 * Va arriba del catálogo para que el cliente sepa cómo armar el pedido antes
 * de empezar a navegar productos.
 */
export function ProcesoCompra() {
  const pasos = [
    {
      icon: ShoppingBag,
      titulo: 'Armá el carrito',
      desc: 'Buscá productos, elegí la cantidad y agregalos al carrito mayorista.',
    },
    {
      icon: MessageCircle,
      titulo: 'Enviá por WhatsApp',
      desc: 'Confirmás el pedido con tus datos y se envía automáticamente al comercio.',
    },
    {
      icon: Package,
      titulo: 'Coordinamos pago y entrega',
      desc: 'Te contactamos para confirmar disponibilidad, forma de pago y retiro o envío.',
    },
  ];

  return (
    <section className="rounded-xl border bg-muted/30 p-4 sm:p-6">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Cómo comprar
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {pasos.map((p, i) => (
          <div key={p.titulo} className="flex items-start gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <p.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">
                <span className="text-muted-foreground">{i + 1}.</span> {p.titulo}
              </div>
              <div className="mt-1 text-xs leading-snug text-muted-foreground">{p.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
