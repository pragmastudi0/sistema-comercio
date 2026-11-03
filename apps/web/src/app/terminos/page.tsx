import type { Metadata } from 'next';
import { SITE } from '@/lib/config';

export const metadata: Metadata = { title: `Términos y Condiciones · ${SITE.nombre}` };

export default function TerminosPage() {
  return (
    <article className="container mx-auto max-w-3xl px-4 py-12">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Legal
      </div>
      <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
        Términos y Condiciones
      </h1>

      <div className="prose prose-neutral mt-8 max-w-none space-y-6 text-foreground/80">
        <section>
          <h2 className="text-lg font-semibold text-foreground">1. Naturaleza del sitio</h2>
          <p>
            Este sitio es un catálogo informativo. Los pedidos se confirman manualmente
            por WhatsApp por parte del equipo de {SITE.nombre}. La carga del carrito y el
            envío del pedido no constituyen una venta cerrada hasta que se confirma por
            chat.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">2. Precios</h2>
          <p>
            Los precios mostrados son mayoristas e incluyen IVA. Pueden modificarse sin
            previo aviso. El precio aplicable al pedido es el vigente al momento de la
            confirmación.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">3. Stock</h2>
          <p>
            El stock se verifica al confirmar el pedido. Si un producto no está disponible,
            te ofreceremos alternativas o quitaremos ese ítem antes de cerrar la venta.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">4. Pagos</h2>
          <p>
            Aceptamos transferencia bancaria, efectivo (al retirar) y cuenta corriente
            para clientes habilitados. No procesamos pagos online en este sitio.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">5. Envíos y devoluciones</h2>
          <p>
            Ver nuestra{' '}
            <a href="/envios" className="underline">
              Política de envíos
            </a>{' '}
            para detalle de modalidades, plazos y devoluciones.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">6. Privacidad</h2>
          <p>
            Los datos que ingresás en el formulario de pedido (razón social, contacto,
            teléfono, CUIT) los usamos exclusivamente para procesar y entregar tu pedido.
            No los compartimos con terceros.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">7. Jurisdicción</h2>
          <p>
            Estos términos se rigen por las leyes de la República Argentina. Cualquier
            disputa se somete a los Tribunales Ordinarios de la ciudad de Córdoba.
          </p>
        </section>
      </div>
    </article>
  );
}
