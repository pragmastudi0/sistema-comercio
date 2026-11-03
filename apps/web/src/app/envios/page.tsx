import type { Metadata } from 'next';
import { SITE } from '@/lib/config';

export const metadata: Metadata = { title: `Política de envíos · ${SITE.nombre}` };

export default function EnviosPage() {
  return (
    <article className="container mx-auto max-w-3xl px-4 py-12">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Información
      </div>
      <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
        Política de envíos
      </h1>

      <div className="prose prose-neutral mt-8 max-w-none space-y-6 text-foreground/80">
        <section>
          <h2 className="text-lg font-semibold text-foreground">Formas de entrega</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>Retiro en local:</strong> sin costo. Te avisamos por WhatsApp cuando
              el pedido esté listo.
            </li>
            <li>
              <strong>Envío local (Córdoba Capital):</strong> coordinamos por WhatsApp.
              El costo depende de la zona y se confirma antes de despachar.
            </li>
            <li>
              <strong>Transporte externo (envíos al interior y otras provincias):</strong>{' '}
              despachamos por la empresa de transporte que elijas. El costo del flete corre
              por cuenta del comprador y se abona al recibir.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Plazos</h2>
          <p>
            Una vez confirmado el pago, preparamos el pedido en <strong>24 a 48 horas hábiles</strong>.
            El plazo de entrega al destino depende de la modalidad elegida y del transporte.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Confirmación del pedido</h2>
          <p>
            Todos los pedidos se confirman manualmente por WhatsApp. Verificamos stock y
            te indicamos los datos para abonar (transferencia bancaria, efectivo al retirar
            o cuenta corriente para clientes habilitados).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">Devoluciones</h2>
          <p>
            No aceptamos devoluciones. Si llega un producto con falla de fábrica, lo
            cambiamos por uno igual o emitimos nota de crédito por su valor para tu próxima
            compra.
          </p>
        </section>
      </div>
    </article>
  );
}
