'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, X } from 'lucide-react';
import { NOVEDADES, type Novedad } from '@/lib/novedades';

const LS_KEY = 'admin-novedades-vistas';

function leerVistas(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function guardarVistas(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch {
    // localStorage lleno o deshabilitado — no crítico
  }
}

function fmtFechaCorta(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function TagBadge({ tag }: { tag: Novedad['tag'] }) {
  if (!tag) return null;
  const clase =
    tag === 'nuevo'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
      : tag === 'mejora'
        ? 'bg-blue-100 text-blue-800 border-blue-300'
        : 'bg-amber-100 text-amber-800 border-amber-300';
  const label = tag === 'nuevo' ? 'Nuevo' : tag === 'mejora' ? 'Mejora' : 'Fix';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${clase}`}
    >
      {label}
    </span>
  );
}

export function BotonNovedades() {
  const [open, setOpen] = useState(false);
  const [vistas, setVistas] = useState<string[]>([]);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const botonRef = useRef<HTMLButtonElement | null>(null);

  // Cargar vistas de localStorage al montar (evita hydration mismatch).
  useEffect(() => {
    setVistas(leerVistas());
  }, []);

  const noVistas = useMemo(() => {
    const set = new Set(vistas);
    return NOVEDADES.filter((n) => !set.has(n.id));
  }, [vistas]);

  // Al abrir el panel, marcar todas como vistas.
  function togglePanel() {
    if (!open) {
      const idsTodos = NOVEDADES.map((n) => n.id);
      setVistas(idsTodos);
      guardarVistas(idsTodos);
    }
    setOpen(!open);
  }

  // Cerrar al hacer click fuera.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        target &&
        !popoverRef.current?.contains(target) &&
        !botonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={botonRef}
        type="button"
        onClick={togglePanel}
        className="relative flex items-center gap-1 rounded border border-transparent px-2 py-0.5 hover:border-slate-500 hover:bg-slate-600"
        title={
          noVistas.length > 0
            ? `${noVistas.length} novedad${noVistas.length === 1 ? '' : 'es'} sin leer`
            : 'Novedades del sistema'
        }
      >
        <Bell className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Novedades</span>
        {noVistas.length > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white shadow"
            aria-label={`${noVistas.length} sin leer`}
          >
            {noVistas.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-50 mt-1 w-[92vw] max-w-md rounded-md border border-slate-300 bg-white text-slate-800 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Bell className="h-3.5 w-3.5" />
              Novedades del sistema
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-100"
              title="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {NOVEDADES.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              Sin novedades por ahora.
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {NOVEDADES.map((n) => (
                <NovedadItem key={n.id} novedad={n} onNavegar={() => setOpen(false)} />
              ))}
            </div>
          )}
          <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-center text-[10px] text-slate-500">
            Se agregan a medida que sumamos cosas al sistema.
          </div>
        </div>
      )}
    </div>
  );
}

function NovedadItem({
  novedad,
  onNavegar,
}: {
  novedad: Novedad;
  onNavegar: () => void;
}) {
  const inner = (
    <div className="flex items-start gap-3 border-b border-slate-100 p-3 last:border-b-0 hover:bg-slate-50">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-lg">
        <span aria-hidden>{novedad.emoji ?? '✨'}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold">{novedad.titulo}</span>
          <TagBadge tag={novedad.tag} />
          <span className="ml-auto text-[10px] text-slate-500">
            {fmtFechaCorta(novedad.fecha)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-600">{novedad.descripcion}</p>
        {novedad.href && (
          <span className="mt-1 inline-block text-[11px] font-medium text-blue-700 hover:underline">
            Ir a la sección →
          </span>
        )}
      </div>
    </div>
  );
  return novedad.href ? (
    <Link href={novedad.href} onClick={onNavegar} className="block">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}
