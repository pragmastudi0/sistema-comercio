'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { SITE } from '@/lib/config';

export function Footer() {
  const db = getDb();
  const configQ = useQuery({
    queryKey: ['config-footer'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });
  const c = configQ.data?.comercio;

  return (
    <footer className="mt-12 border-t bg-muted/30">
      <div className="container mx-auto px-4 py-8 text-sm text-muted-foreground">
        <div className="grid gap-6 sm:grid-cols-4">
          <div>
            <div className="mb-1 font-semibold text-foreground">{SITE.nombre}</div>
            <p>Catálogo mayorista · Pedidos por WhatsApp.</p>
          </div>
          <div>
            <div className="mb-1 font-semibold text-foreground">Contacto</div>
            <p>{c?.direccion || SITE.direccion}</p>
            {c?.telefono && <p>{c.telefono}</p>}
            {(c?.email || SITE.email) && <p>{c?.email || SITE.email}</p>}
          </div>
          <div>
            <div className="mb-1 font-semibold text-foreground">Comprar</div>
            <ul className="space-y-1">
              <li>
                <Link href="/catalogo" className="hover:underline">
                  Catálogo
                </Link>
              </li>
              <li>
                <Link href="/carrito" className="hover:underline">
                  Mi carrito
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div className="mb-1 font-semibold text-foreground">Información</div>
            <ul className="space-y-1">
              <li>
                <Link href="/quienes-somos" className="hover:underline">
                  Quiénes somos
                </Link>
              </li>
              <li>
                <Link href="/contacto" className="hover:underline">
                  Contacto
                </Link>
              </li>
              <li>
                <Link href="/envios" className="hover:underline">
                  Política de envíos
                </Link>
              </li>
              <li>
                <Link href="/terminos" className="hover:underline">
                  Términos y Condiciones
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-6 border-t pt-4 text-xs">
          © {new Date().getFullYear()} {SITE.nombre}
          {c?.cuit ? ` · CUIT ${c.cuit}` : ''}
        </div>
      </div>
    </footer>
  );
}
