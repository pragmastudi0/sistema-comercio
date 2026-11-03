// Config pública del sitio. Estos valores se setean en Vercel como env vars
// (NEXT_PUBLIC_*) y se leen en build/runtime. Cualquier env var sin valor
// queda con el default acá.

import { PRESET_IDS } from '@comercio/db';

export const SITE = {
  /** Nombre visible del comercio. */
  nombre: process.env.NEXT_PUBLIC_SITE_NOMBRE ?? 'turisteando',

  /** Número de WhatsApp en formato internacional sin '+' ni espacios.
   *  Ej: 5493515551234 (Argentina, Córdoba, 351 555-1234). */
  whatsappNumero: process.env.NEXT_PUBLIC_WHATSAPP_NUMERO ?? '5493510000000',

  /** ID de la lista de precios a usar para mostrar y armar el pedido. */
  listaPrecioId: process.env.NEXT_PUBLIC_LISTA_PRECIO_ID ?? PRESET_IDS.listas.mayorista,

  /** Email de contacto (opcional, footer). */
  email: process.env.NEXT_PUBLIC_EMAIL ?? '',

  /** Dirección visible del local (opcional, footer). */
  direccion:
    process.env.NEXT_PUBLIC_DIRECCION ?? 'Estación Terminal de Ómnibus, Córdoba',
};
