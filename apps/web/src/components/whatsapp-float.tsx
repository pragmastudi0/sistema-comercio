'use client';

import { useQuery } from '@tanstack/react-query';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { SITE } from '@/lib/config';

/**
 * Botón flotante de WhatsApp para consultas.
 * Lee el número del comercio desde la configuración (en Supabase) y cae al
 * default de SITE si no está cargado todavía.
 */
export function WhatsAppFloat() {
  const db = getDb();
  const configQ = useQuery({
    queryKey: ['config-wa-float'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
    staleTime: 5 * 60 * 1000,
  });
  const c = configQ.data?.comercio as { whatsapp?: string; telefono?: string } | undefined;
  const numeroRaw = c?.whatsapp ?? c?.telefono ?? SITE.whatsappNumero;
  // Normalizar: solo dígitos
  const numero = String(numeroRaw).replace(/\D/g, '');
  // Asegurar prefijo país AR si vino sin código
  const numeroFinal = numero.startsWith('54')
    ? numero
    : numero.length === 10
      ? `549${numero}`
      : numero;

  const mensaje = encodeURIComponent(
    'Hola! Te escribo desde el catálogo mayorista. Quería hacer una consulta…',
  );
  const href = `https://wa.me/${numeroFinal}?text=${mensaje}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Consultar por WhatsApp"
      title="Consultanos por WhatsApp"
      className="group fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition hover:scale-105 hover:bg-[#1ebe5d] hover:shadow-xl sm:bottom-6 sm:right-6 sm:h-16 sm:w-16"
    >
      {/* Logo oficial de WhatsApp en SVG */}
      <svg
        viewBox="0 0 32 32"
        className="h-9 w-9 sm:h-10 sm:w-10"
        fill="currentColor"
        aria-hidden
      >
        <path d="M19.11 17.205c-.372 0-1.088 1.39-1.518 1.39a.63.63 0 0 1-.315-.1c-.802-.402-1.504-.817-2.163-1.447-.545-.516-1.146-1.29-1.46-1.963a.426.426 0 0 1-.073-.215c0-.33.99-.945.99-1.49 0-.143-.73-2.09-.832-2.335-.143-.372-.214-.487-.6-.487-.187 0-.36-.043-.53-.043-.302 0-.53.115-.746.315-.688.645-1.032 1.318-1.06 2.264v.114c-.015.99.472 1.977 1.017 2.78 1.23 1.82 2.506 3.41 4.554 4.34.616.287 2.035.888 2.722.888.817 0 2.4-.515 2.667-1.39.072-.245.144-.5.144-.755 0-.602-1.59-1.105-1.875-1.18-.27-.06-.532-.092-.78-.092zm-3.039 7.738c-1.595 0-3.146-.435-4.5-1.246l-.323-.193-3.32.872.882-3.235-.21-.335a8.808 8.808 0 0 1-1.346-4.687c0-4.886 3.973-8.858 8.858-8.858 4.886 0 8.86 3.972 8.86 8.858 0 4.886-3.974 8.86-8.86 8.86zM16.07 6.13c-5.852 0-10.61 4.76-10.61 10.61 0 1.876.486 3.712 1.418 5.327L5.94 28l6.075-1.594c1.55.847 3.302 1.296 5.085 1.296 5.847 0 10.61-4.76 10.61-10.612 0-5.85-4.762-10.61-10.612-10.61z" />
      </svg>
      {/* Pulso sutil */}
      <span className="pointer-events-none absolute inset-0 rounded-full bg-[#25D366] opacity-30 transition group-hover:animate-ping" />
    </a>
  );
}
