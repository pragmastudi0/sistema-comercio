import type { ConfiguracionEmpresa } from '@comercio/db';
import type { ItemResuelto } from '@/stores/carrito';
import { SITE } from './config';

export type FormaEntrega = 'retiro' | 'envio_local' | 'transporte_externo';
export type MetodoPagoWeb = 'transferencia' | 'efectivo' | 'cta_cte' | 'a_definir';

export type DatosPedido = {
  razonSocial: string;
  contacto: string;
  telefono: string;
  cuit?: string;
  email?: string;
  direccion?: string;
  metodoPago: MetodoPagoWeb;
  formaEntrega: FormaEntrega;
  /** Provincia (para envío local o transporte externo). */
  provincia?: string;
  /** Localidad / Ciudad. */
  localidad?: string;
  /** Dirección completa para envío local. */
  zonaEnvio?: string;
  /** Empresa de transporte externo. */
  transporte?: string;
  urgencia?: 'normal' | 'urgente';
  notas?: string;
};

const LABEL_PAGO: Record<MetodoPagoWeb, string> = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo (al retirar)',
  cta_cte: 'Cuenta corriente',
  a_definir: 'A definir',
};

const LABEL_ENTREGA: Record<FormaEntrega, string> = {
  retiro: 'Retiro en local',
  envio_local: 'Envío a domicilio',
  transporte_externo: 'Transporte externo',
};

function ars(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);
}

/** Template por defecto si el admin no configuró uno custom. */
function defaultTemplate(): string {
  return [
    '*Pedido mayorista — {comercio}*',
    '📅 {fecha}',
    '',
    '*Datos del cliente*',
    '{cliente}',
    '',
    '*Productos*',
    '{items}',
    '',
    '*TOTAL: {total}*',
    '',
    '*Forma de pago*',
    '{metodoPago}',
    '',
    '*Entrega*',
    '{entrega}',
    '{notas}',
  ].join('\n');
}

function renderCliente(d: DatosPedido): string {
  const lineas: string[] = [];
  lineas.push(`• Razón social: ${d.razonSocial}`);
  lineas.push(`• Contacto: ${d.contacto}`);
  lineas.push(`• Teléfono: ${d.telefono}`);
  if (d.cuit) lineas.push(`• CUIT: ${d.cuit}`);
  if (d.email) lineas.push(`• Email: ${d.email}`);
  if (d.direccion) lineas.push(`• Dirección: ${d.direccion}`);
  return lineas.join('\n');
}

function renderItems(items: ItemResuelto[]): string {
  return items
    .map((item, i) => {
      return `${i + 1}. ${item.nombre} (cód ${item.codigo})\n   ${item.cantidad}u × ${ars(item.precioUnitarioEfectivo)} = ${ars(item.subtotalEfectivo)}`;
    })
    .join('\n');
}

function renderEntrega(d: DatosPedido): string {
  const lineas: string[] = [`• ${LABEL_ENTREGA[d.formaEntrega]}`];
  if (d.provincia) lineas.push(`• Provincia: ${d.provincia}`);
  if (d.localidad) lineas.push(`• Localidad: ${d.localidad}`);
  if (d.formaEntrega === 'envio_local' && d.zonaEnvio) {
    lineas.push(`• Dirección: ${d.zonaEnvio}`);
  }
  if (d.formaEntrega === 'transporte_externo' && d.transporte) {
    lineas.push(`• Transporte: ${d.transporte}`);
  }
  if (d.urgencia === 'urgente') lineas.push('• ⚡ Urgente');
  return lineas.join('\n');
}

function renderNotas(d: DatosPedido): string {
  return d.notas?.trim() ? `\n*Notas*\n${d.notas.trim()}` : '';
}

/** Construye el mensaje de WhatsApp. Si la config trae un template custom, lo usa. */
export function buildMensaje(
  items: ItemResuelto[],
  datos: DatosPedido,
  config?: ConfiguracionEmpresa | null,
): string {
  const template = config?.mensaje_wa_template?.trim() || defaultTemplate();
  const comercioNombre = config?.comercio?.razon_social || SITE.nombre;
  const total = items.reduce((acc, i) => acc + i.subtotalEfectivo, 0);
  const fecha = new Date().toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return template
    .replaceAll('{comercio}', comercioNombre)
    .replaceAll('{fecha}', fecha)
    .replaceAll('{cliente}', renderCliente(datos))
    .replaceAll('{cliente.razonSocial}', datos.razonSocial)
    .replaceAll('{cliente.contacto}', datos.contacto)
    .replaceAll('{cliente.telefono}', datos.telefono)
    .replaceAll('{cliente.cuit}', datos.cuit ?? '')
    .replaceAll('{cliente.email}', datos.email ?? '')
    .replaceAll('{cliente.direccion}', datos.direccion ?? '')
    .replaceAll('{items}', renderItems(items))
    .replaceAll('{total}', ars(total))
    .replaceAll('{metodoPago}', `• ${LABEL_PAGO[datos.metodoPago]}`)
    .replaceAll('{entrega}', renderEntrega(datos))
    .replaceAll('{notas}', renderNotas(datos));
}

/** Construye la URL `wa.me` con el mensaje encoded. */
export function buildWhatsappUrl(mensaje: string): string {
  return `https://wa.me/${SITE.whatsappNumero}?text=${encodeURIComponent(mensaje)}`;
}
