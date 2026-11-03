import type { Metadata } from 'next';
import { SITE } from '@/lib/config';

export const metadata: Metadata = { title: `Quiénes somos · ${SITE.nombre}` };

export default function QuienesSomosPage() {
  return (
    <article className="container mx-auto max-w-3xl px-4 py-12">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Sobre nosotros
      </div>
      <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">Quiénes somos</h1>

      <div className="prose prose-neutral mt-8 max-w-none space-y-4 text-foreground/80">
        <p>
          {SITE.nombre} es un comercio mayorista dedicado a la venta de productos para
          viajeros y comerciantes en la Estación Terminal de Ómnibus de Córdoba. Trabajamos
          con tecnología, bazar, belleza, papelería y artículos de viaje.
        </p>
        <p>
          Atendemos directamente a comercios y revendedores con precios mayoristas y
          escalas por cantidad. Nuestro foco es la rotación rápida y el contacto cercano
          con cada cliente.
        </p>
        <p>
          Este sitio sirve como catálogo: armás tu pedido y lo enviás por WhatsApp.
          Confirmamos disponibilidad, formas de entrega y pago por ese mismo chat.
        </p>
      </div>
    </article>
  );
}
