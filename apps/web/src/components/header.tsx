'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCarrito } from '@/stores/carrito';
import { SITE } from '@/lib/config';
import { ShoppingBag } from 'lucide-react';
import { useHasMounted } from '@/lib/hydration';

export function Header() {
  const mounted = useHasMounted();
  const cantidad = useCarrito((s) =>
    s.items.reduce((acc, i) => acc + i.cantidad, 0),
  );
  // Hasta que hidrate, mostrar 0 para evitar mismatch con localStorage.
  const cantidadVisible = mounted ? cantidad : 0;

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4">
        <Link href="/catalogo" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt={SITE.nombre}
            width={36}
            height={36}
            priority
            className="h-9 w-9"
          />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">{SITE.nombre}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Mayorista
            </div>
          </div>
        </Link>

        <Link
          href="/carrito"
          className="relative flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm transition hover:bg-accent"
        >
          <ShoppingBag className="h-4 w-4" />
          <span className="hidden sm:inline">Carrito</span>
          {cantidadVisible > 0 && (
            <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
              {cantidadVisible}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
