'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Minus,
  Plus,
  Trash2,
  ShoppingBag,
  MessageCircle,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  precioPorCantidad,
  resolverCarrito,
  useCarrito,
} from '@/stores/carrito';
import {
  buildMensaje,
  buildWhatsappUrl,
  type DatosPedido,
  type FormaEntrega,
} from '@/lib/whatsapp';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { formatCurrency } from '@comercio/ui/utils';
import { emojiProducto } from '@/lib/imagenes';
import { PROVINCIAS_AR } from '@/lib/provincias';

export default function CarritoPage() {
  const db = getDb();
  const items = useCarrito((s) => s.items);
  const setCantidad = useCarrito((s) => s.setCantidad);
  const quitar = useCarrito((s) => s.quitar);
  const vaciar = useCarrito((s) => s.vaciar);

  // Config del comercio (pedido mínimo, template WA, datos)
  const configQ = useQuery({
    queryKey: ['config-web'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });

  // Producto detail para validar reglas (solo_por_bulto, incremento)
  const productosQ = useQuery({
    queryKey: ['productos-carrito', items.map((i) => i.productoId).join(',')],
    queryFn: async () => {
      const out = new Map<
        string,
        { solo_por_bulto?: boolean; cantidad_minima_web?: number; incremento_web?: number }
      >();
      for (const it of items) {
        const p = await db.productos.get(it.productoId);
        if (p) {
          out.set(p.id, {
            solo_por_bulto: p.solo_por_bulto,
            cantidad_minima_web: p.cantidad_minima_web,
            incremento_web: p.incremento_web,
          });
        }
      }
      return out;
    },
    enabled: items.length > 0,
  });

  const [datos, setDatos] = useState<DatosPedido>({
    razonSocial: '',
    contacto: '',
    telefono: '',
    cuit: '',
    email: '',
    direccion: '',
    metodoPago: 'transferencia',
    formaEntrega: 'retiro',
    provincia: '',
    localidad: '',
    zonaEnvio: '',
    transporte: '',
    urgencia: 'normal',
    notas: '',
  });

  const resuelto = resolverCarrito(items, configQ.data?.mayorista_desde_monto ?? 0);
  const total = resuelto.subtotal;
  const totalUnidades = items.reduce((acc, i) => acc + i.cantidad, 0);
  const pedidoMinimo = configQ.data?.pedido_minimo_web ?? 0;
  const cumpleMinimo = pedidoMinimo === 0 || total >= pedidoMinimo;

  // Detectar items que no cumplen reglas (mínimo o incremento)
  const itemsConProblema = items.flatMap((it) => {
    const reglas = productosQ.data?.get(it.productoId);
    if (!reglas) return [];
    const problemas: string[] = [];
    const min = reglas.cantidad_minima_web ?? 0;
    const inc = reglas.incremento_web ?? 1;
    if (min > 0 && it.cantidad < min) {
      problemas.push(`Mínimo ${min}u`);
    }
    if (inc > 1 && it.cantidad % inc !== 0) {
      problemas.push(`Vendido de a ${inc}u`);
    }
    if (reglas.solo_por_bulto && inc > 1 && it.cantidad % inc !== 0) {
      problemas.push('Solo por bulto');
    }
    return problemas.length ? [{ productoId: it.productoId, nombre: it.nombre, problemas }] : [];
  });

  function camposValidos(): string | null {
    if (items.length === 0) return 'El carrito está vacío.';
    if (!datos.razonSocial.trim()) return 'Falta la razón social.';
    if (!datos.contacto.trim()) return 'Falta el nombre de contacto.';
    if (!datos.telefono.trim()) return 'Falta el teléfono.';
    if (datos.formaEntrega !== 'retiro' && !datos.provincia?.trim()) {
      return 'Elegí la provincia de entrega.';
    }
    if (datos.formaEntrega !== 'retiro' && !datos.localidad?.trim()) {
      return 'Indicá la localidad.';
    }
    if (datos.formaEntrega === 'envio_local' && !datos.zonaEnvio?.trim()) {
      return 'Indicá la dirección de envío.';
    }
    if (datos.formaEntrega === 'transporte_externo' && !datos.transporte?.trim()) {
      return 'Indicá el transporte externo (empresa/persona).';
    }
    if (!cumpleMinimo) {
      return `El pedido mínimo es ${formatCurrency(pedidoMinimo)}. Te faltan ${formatCurrency(pedidoMinimo - total)}.`;
    }
    if (itemsConProblema.length > 0) {
      return 'Hay productos que no cumplen reglas de venta (mínimo o bulto). Ajustá las cantidades.';
    }
    return null;
  }

  function enviarWhatsapp() {
    const err = camposValidos();
    if (err) {
      toast.error(err);
      return;
    }
    // Guardamos el pedido en BD como 'pendiente' antes de mandar el
    // WhatsApp. Así queda registro en /admin/ventas-mayoristas para
    // que Agus lo apruebe/rechace.
    //
    // Estrategia de errores:
    //   - Insert OK   → toast "pedido registrado" + abre WhatsApp
    //   - Insert falla → toast warning "no se pudo registrar, mandalo por
    //                    WhatsApp igual" + abre WhatsApp igual. No
    //                    bloqueamos porque es peor no poder pedir.
    //
    // Antes usábamos `console.warn` silencioso. Cambiamos a `toast` +
    // `console.error` para que el problema sea visible durante el
    // rollout del feature.
    (async () => {
      try {
        await db.pedidosWeb.crear({
          cliente_datos: {
            razon_social: datos.razonSocial,
            contacto: datos.contacto,
            telefono: datos.telefono,
            cuit: datos.cuit,
            email: datos.email,
            direccion: datos.direccion,
          },
          items: resuelto.items.map((it) => ({
            producto_id: it.productoId,
            codigo: it.codigo,
            nombre: it.nombre,
            cantidad: it.cantidad,
            precio_unitario: it.precioUnitarioEfectivo,
            subtotal: it.subtotalEfectivo,
          })),
          subtotal: total,
          descuento_total: 0,
          total,
          metodo_pago: datos.metodoPago,
          forma_entrega: datos.formaEntrega,
          notas: datos.notas,
        });
        toast.success('Pedido registrado en el sistema.');
      } catch (e) {
        // No bloqueamos el WhatsApp — el pedido queda "solo por WA".
        // eslint-disable-next-line no-console
        console.error('[pedidosWeb.crear] falló:', e);
        toast.warning(
          'No pudimos registrar el pedido en el sistema, pero podés mandarlo por WhatsApp igual.',
        );
      }
    })();

    const mensaje = buildMensaje(resuelto.items, datos, configQ.data);
    const url = buildWhatsappUrl(mensaje);
    window.open(url, '_blank', 'noopener');
    toast.success('Abriendo WhatsApp…');
  }

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link href="/catalogo">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver al catálogo
          </Link>
        </Button>
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ShoppingBag className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p className="text-lg">Tu carrito está vacío.</p>
            <Button asChild className="mt-4">
              <Link href="/catalogo">Ver catálogo</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/catalogo">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Seguir comprando
        </Link>
      </Button>

      <h1 className="mb-1 text-2xl font-semibold sm:text-3xl">Tu pedido</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Revisá los productos, completá tus datos y enviá el pedido por WhatsApp.
      </p>

      {pedidoMinimo > 0 && !cumpleMinimo && (
        <div className="mb-4 rounded-md border border-orange-400 bg-orange-50 p-3 text-sm text-orange-800">
          <strong>Pedido mínimo:</strong> {formatCurrency(pedidoMinimo)}. Te faltan{' '}
          {formatCurrency(pedidoMinimo - total)} para poder enviar el pedido.
        </div>
      )}

      {!resuelto.aplicaMayorista && resuelto.umbralMayorista > 0 && (
        <div className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Precio mayorista desde {formatCurrency(resuelto.umbralMayorista)}.</strong>{' '}
          Te faltan {formatCurrency(resuelto.faltaParaMayorista)} para acceder al
          descuento. Mientras tanto se cobra al precio del local.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {items.map((item) => {
            const resueltoItem = resuelto.items.find((x) => x.productoId === item.productoId);
            const precio = resueltoItem?.precioUnitarioEfectivo ?? precioPorCantidad(item.escalas, item.cantidad);
            const sub = resueltoItem?.subtotalEfectivo ?? item.cantidad * precio;
            const proxima = item.escalas.find((e) => e.desde > item.cantidad);
            const reglas = productosQ.data?.get(item.productoId);
            const problemas = itemsConProblema.find((x) => x.productoId === item.productoId);
            return (
              <Card
                key={item.productoId}
                className={problemas ? 'border-orange-400 bg-orange-50/40' : ''}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-muted/40 text-3xl">
                    <span aria-hidden>{emojiProducto(item.nombre)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-muted-foreground">
                      Cód {item.codigo}
                    </div>
                    <Link
                      href={`/catalogo/${item.productoId}`}
                      className="block font-medium hover:underline"
                    >
                      {item.nombre}
                    </Link>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatCurrency(precio)} c/u
                    </div>
                    {reglas?.solo_por_bulto && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Solo por bulto · de a {reglas.incremento_web ?? 1}u
                      </div>
                    )}
                    {(reglas?.cantidad_minima_web ?? 0) > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Mínimo: {reglas?.cantidad_minima_web}u
                      </div>
                    )}
                    {proxima && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Llevá {proxima.desde - item.cantidad}u más y baja a{' '}
                        {formatCurrency(proxima.precio)} c/u
                      </div>
                    )}
                    {problemas && (
                      <div className="mt-1 flex items-center gap-1 text-xs font-medium text-orange-700">
                        <AlertTriangle className="h-3 w-3" />
                        {problemas.problemas.join(' · ')}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          const inc = reglas?.incremento_web ?? 1;
                          setCantidad(item.productoId, item.cantidad - inc);
                        }}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        value={item.cantidad}
                        onChange={(e) =>
                          setCantidad(
                            item.productoId,
                            Math.max(1, parseInt(e.target.value) || 1),
                          )
                        }
                        className="h-8 w-16 text-center"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          const inc = reglas?.incremento_web ?? 1;
                          setCantidad(item.productoId, item.cantidad + inc);
                        }}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <div className="ml-auto flex items-center gap-2">
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Subtotal</div>
                          <div className="font-semibold tabular-nums">
                            {formatCurrency(sub)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => quitar(item.productoId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <div className="flex justify-end pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                if (confirm('¿Vaciar el carrito?')) {
                  vaciar();
                  toast.info('Carrito vaciado');
                }
              }}
            >
              Vaciar carrito
            </Button>
          </div>
        </div>

        <div>
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle className="text-base">Datos para el pedido</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="mb-1 block text-xs">Razón social / Empresa *</Label>
                <Input
                  value={datos.razonSocial}
                  onChange={(e) => setDatos({ ...datos, razonSocial: e.target.value })}
                  placeholder="Mi negocio SA"
                  required
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Contacto *</Label>
                <Input
                  value={datos.contacto}
                  onChange={(e) => setDatos({ ...datos, contacto: e.target.value })}
                  placeholder="Nombre y apellido"
                  required
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Teléfono *</Label>
                <Input
                  value={datos.telefono}
                  onChange={(e) => setDatos({ ...datos, telefono: e.target.value })}
                  placeholder="+54 9 351..."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 block text-xs">CUIT</Label>
                  <Input
                    value={datos.cuit}
                    onChange={(e) => setDatos({ ...datos, cuit: e.target.value })}
                    placeholder="opcional"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Email</Label>
                  <Input
                    type="email"
                    value={datos.email}
                    onChange={(e) => setDatos({ ...datos, email: e.target.value })}
                    placeholder="opcional"
                  />
                </div>
              </div>

              <div>
                <Label className="mb-1 block text-xs">Método de pago preferido</Label>
                <select
                  value={datos.metodoPago}
                  onChange={(e) =>
                    setDatos({ ...datos, metodoPago: e.target.value as DatosPedido['metodoPago'] })
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="transferencia">Transferencia bancaria</option>
                  <option value="efectivo">Efectivo (al retirar)</option>
                  <option value="cta_cte">Cuenta corriente</option>
                  <option value="a_definir">A definir</option>
                </select>
              </div>

              <div>
                <Label className="mb-1 block text-xs">Forma de entrega</Label>
                <select
                  value={datos.formaEntrega}
                  onChange={(e) =>
                    setDatos({ ...datos, formaEntrega: e.target.value as FormaEntrega })
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="retiro">Retiro en local</option>
                  <option value="envio_local">Envío local a domicilio</option>
                  <option value="transporte_externo">Transporte externo</option>
                </select>
              </div>

              {datos.formaEntrega !== 'retiro' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="mb-1 block text-xs">Provincia *</Label>
                      <select
                        value={datos.provincia}
                        onChange={(e) => setDatos({ ...datos, provincia: e.target.value })}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">— Elegir —</option>
                        {PROVINCIAS_AR.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs">Localidad *</Label>
                      <Input
                        value={datos.localidad}
                        onChange={(e) => setDatos({ ...datos, localidad: e.target.value })}
                        placeholder="Ej: Villa Carlos Paz"
                      />
                    </div>
                  </div>

                  {datos.formaEntrega === 'envio_local' && (
                    <div>
                      <Label className="mb-1 block text-xs">Dirección de envío *</Label>
                      <Input
                        value={datos.zonaEnvio}
                        onChange={(e) => setDatos({ ...datos, zonaEnvio: e.target.value })}
                        placeholder="Calle, número, piso/depto"
                      />
                    </div>
                  )}

                  {datos.formaEntrega === 'transporte_externo' && (
                    <div>
                      <Label className="mb-1 block text-xs">
                        Transporte externo (empresa / agencia) *
                      </Label>
                      <Input
                        value={datos.transporte}
                        onChange={(e) => setDatos({ ...datos, transporte: e.target.value })}
                        placeholder="Ej: Andreani, OCA, transporte propio"
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <Label className="mb-1 block text-xs">Urgencia</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={datos.urgencia === 'normal' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDatos({ ...datos, urgencia: 'normal' })}
                    className="flex-1"
                  >
                    Normal
                  </Button>
                  <Button
                    type="button"
                    variant={datos.urgencia === 'urgente' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDatos({ ...datos, urgencia: 'urgente' })}
                    className="flex-1"
                  >
                    Urgente
                  </Button>
                </div>
              </div>

              <div>
                <Label className="mb-1 block text-xs">Notas (opcional)</Label>
                <textarea
                  value={datos.notas}
                  onChange={(e) => setDatos({ ...datos, notas: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Aclaraciones, fecha de retiro, comentarios..."
                />
              </div>

              <div className="border-t pt-3">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Unidades</span>
                  <span>{totalUnidades}</span>
                </div>
                {pedidoMinimo > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Pedido mínimo</span>
                    <span>{formatCurrency(pedidoMinimo)}</span>
                  </div>
                )}
                <div className="mt-2 flex items-end justify-between">
                  <div className="text-xs uppercase text-muted-foreground">Total</div>
                  <div className="text-2xl font-bold tabular-nums">
                    {formatCurrency(total)}
                  </div>
                </div>
              </div>

              <Button
                className="h-12 w-full text-base"
                onClick={enviarWhatsapp}
                disabled={!cumpleMinimo || itemsConProblema.length > 0}
              >
                <MessageCircle className="mr-2 h-5 w-5" />
                Enviar pedido por WhatsApp
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                Se abre WhatsApp con el pedido pre-armado. Confirmamos por ese mismo chat.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
