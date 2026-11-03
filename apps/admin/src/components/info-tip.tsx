'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/**
 * Ícono ℹ con tooltip que se renderiza vía portal a `document.body` con
 * `position: fixed` y posición calculada desde `getBoundingClientRect`.
 *
 * Por qué portal + fixed y no simple CSS absolute:
 *   Los InfoTip viven en labels dentro del panel derecho de /admin/web,
 *   que es un contenedor con `overflow-y: auto` para hacer scroll. Un
 *   tooltip con `absolute` queda clipeado por el overflow del padre y
 *   se corta por el borde. Con portal + fixed sale de cualquier
 *   contenedor y siempre queda sobre todo lo demás.
 *
 * La posición se auto-ajusta para no salirse de la ventana: si el
 * tooltip se saldría por la derecha, se corre a la izquierda; si se
 * saldría por abajo (poco espacio bajo el ícono), se muestra arriba.
 */
export function InfoTip({ text, className = '' }: { text: string; className?: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const TOOLTIP_WIDTH = 240;
  const MARGIN = 8;
  const GAP = 6;
  const ESTIMATED_HEIGHT = 100; // conservador para el flip vertical

  const abrir = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: preferir alineado al ícono. Si se sale por la derecha,
    // pegarlo al borde derecho con margen.
    let left = rect.left;
    if (left + TOOLTIP_WIDTH > vw - MARGIN) {
      left = vw - TOOLTIP_WIDTH - MARGIN;
    }
    if (left < MARGIN) left = MARGIN;

    // Vertical: debajo del ícono si entra, sino arriba.
    const espacioAbajo = vh - rect.bottom;
    const top =
      espacioAbajo >= ESTIMATED_HEIGHT + MARGIN
        ? rect.bottom + GAP
        : rect.top - ESTIMATED_HEIGHT - GAP;

    setPos({ top: Math.max(MARGIN, top), left });
    setShow(true);
  };

  const cerrar = () => setShow(false);

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={abrir}
        onMouseLeave={cerrar}
        onFocus={abrir}
        onBlur={cerrar}
        tabIndex={0}
        className={`inline-flex cursor-help items-center align-middle text-slate-500 hover:text-slate-800 focus:text-slate-800 focus:outline-none ${className}`}
        aria-label={text}
      >
        <Info className="h-3.5 w-3.5" />
      </span>
      {mounted &&
        show &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: TOOLTIP_WIDTH,
              zIndex: 9999,
            }}
            className="pointer-events-none rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
