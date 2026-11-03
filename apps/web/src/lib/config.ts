// Config pública del sitio. Valores por env var (NEXT_PUBLIC_*). Sin defaults
// específicos de cliente: si falta un valor, queda vacío/genérico.
//
// MULTI-EMPRESA (pendiente, slice web subdominio): estos datos deberían salir
// de `configuracion_empresa` de la empresa resuelta por subdominio, no de env.

import { BRAND } from '@comercio/business';

export const SITE = {
  /** Nombre visible del comercio. */
  nombre: process.env.NEXT_PUBLIC_SITE_NOMBRE ?? BRAND.nombreCorto,

  /** Número de WhatsApp en formato internacional sin '+' ni espacios.
   *  Ej: 5493515551234. Vacío = sin WhatsApp configurado. */
  whatsappNumero: process.env.NEXT_PUBLIC_WHATSAPP_NUMERO ?? '',

  /** ID de la lista de precios a usar para mostrar y armar el pedido.
   *  Vacío = se resuelve dinámicamente (lista default de la empresa). */
  listaPrecioId: process.env.NEXT_PUBLIC_LISTA_PRECIO_ID ?? '',

  /** Email de contacto (opcional, footer). */
  email: process.env.NEXT_PUBLIC_EMAIL ?? '',

  /** Dirección visible del local (opcional, footer). */
  direccion: process.env.NEXT_PUBLIC_DIRECCION ?? '',
};
