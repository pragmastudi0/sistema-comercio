'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, X } from 'lucide-react';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { PaginaProtegida, RequierePermiso } from '@/lib/permisos';
import { comprimirImagen, subirAStorage } from '@/lib/upload-imagen';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';

const EMPRESA_ID = PRESET_IDS.empresa;

export default function ConfiguracionPage() {
  return (
    <PaginaProtegida modulo="configuracion" accion="ver">
      <ConfiguracionInner />
    </PaginaProtegida>
  );
}

function ConfiguracionInner() {
  const db = getDb();
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['config'], queryFn: () => db.configuracion.get(EMPRESA_ID) });

  const [descuentoEfPct, setDescuentoEfPct] = useState(0);
  const [validezPresup, setValidezPresup] = useState(7);
  const [permitirSinStock, setPermitirSinStock] = useState(false);
  const [cuotas, setCuotas] = useState<{ cuotas: number; recargo_pct: number }[]>([]);
  const [razonSocial, setRazonSocial] = useState('');
  const [cuit, setCuit] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [emailComercio, setEmailComercio] = useState('');
  const [horario, setHorario] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [pedidoMinimo, setPedidoMinimo] = useState(0);
  const [waTemplate, setWaTemplate] = useState('');
  // Saldo inicial del comercio (lo que ya facturó antes de arrancar el
  // sistema). Se carga manualmente para que arrancar a mitad de mes no
  // parta los reportes mensuales del dashboard.
  const [arranqueFacturacion, setArranqueFacturacion] = useState(0);
  const [arranqueVentas, setArranqueVentas] = useState(0);
  const [arranqueGanancia, setArranqueGanancia] = useState(0);
  const [arranqueEfectivo, setArranqueEfectivo] = useState(0);
  const [arranqueOtros, setArranqueOtros] = useState(0);
  const [arranqueDesde, setArranqueDesde] = useState('');

  // Clamp helper: el HTML min/max se respeta al enviar el form, pero el
  // state interno puede tener valores fuera de rango si el usuario los
  // escribe a mano. Esto los corta al guardar en state. Si NaN o no es
  // finito, fallback al valor anterior.
  function clamp(n: number, min: number, max: number, fallback: number) {
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  useEffect(() => {
    if (configQ.data) {
      setDescuentoEfPct(configQ.data.descuento_efectivo_pct);
      setValidezPresup(configQ.data.validez_presupuesto_dias);
      setPermitirSinStock(configQ.data.permitir_venta_sin_stock_default);
      setCuotas(configQ.data.cuotas);
      setRazonSocial(configQ.data.comercio?.razon_social ?? '');
      setCuit(configQ.data.comercio?.cuit ?? '');
      setDireccion(configQ.data.comercio?.direccion ?? '');
      setTelefono(configQ.data.comercio?.telefono ?? '');
      setEmailComercio(configQ.data.comercio?.email ?? '');
      setHorario(configQ.data.comercio?.horario ?? '');
      setLogoUrl(configQ.data.comercio?.logo_url ?? '');
      setPedidoMinimo(configQ.data.pedido_minimo_web ?? 0);
      setWaTemplate(configQ.data.mensaje_wa_template ?? '');
      setArranqueFacturacion(configQ.data.arranque?.facturacion_acumulada ?? 0);
      setArranqueVentas(configQ.data.arranque?.ventas_acumuladas ?? 0);
      setArranqueGanancia(configQ.data.arranque?.ganancia_acumulada ?? 0);
      setArranqueEfectivo(configQ.data.arranque?.cobrado_efectivo_acumulado ?? 0);
      setArranqueOtros(configQ.data.arranque?.cobrado_otros_acumulado ?? 0);
      setArranqueDesde(configQ.data.arranque?.desde_fecha ?? '');
    }
  }, [configQ.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      db.configuracion.update(EMPRESA_ID, {
        descuento_efectivo_pct: descuentoEfPct,
        validez_presupuesto_dias: validezPresup,
        permitir_venta_sin_stock_default: permitirSinStock,
        cuotas: [...cuotas].sort((a, b) => a.cuotas - b.cuotas),
        comercio: {
          razon_social: razonSocial,
          cuit,
          direccion,
          telefono,
          email: emailComercio,
          horario,
          logo_url: logoUrl,
        },
        pedido_minimo_web: pedidoMinimo,
        mensaje_wa_template: waTemplate,
        arranque: {
          facturacion_acumulada: arranqueFacturacion || 0,
          ventas_acumuladas: arranqueVentas || 0,
          ganancia_acumulada: arranqueGanancia || 0,
          cobrado_efectivo_acumulado: arranqueEfectivo || 0,
          cobrado_otros_acumulado: arranqueOtros || 0,
          desde_fecha: arranqueDesde || undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Configuración guardada');
      qc.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function agregarCuota() {
    const ultima = cuotas[cuotas.length - 1];
    const nuevasCuotas = ultima ? ultima.cuotas + 3 : 1;
    setCuotas([...cuotas, { cuotas: nuevasCuotas, recargo_pct: 0 }]);
  }

  function editarCuota(idx: number, patch: Partial<{ cuotas: number; recargo_pct: number }>) {
    setCuotas(cuotas.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function quitarCuota(idx: number) {
    setCuotas(cuotas.filter((_, i) => i !== idx));
  }

  if (configQ.isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold sm:text-2xl">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Recargos, descuentos y parámetros que afectan a toda la operación.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Descuentos por método</CardTitle>
            <CardDescription>
              Descuento aplicado automáticamente cuando el cliente paga en efectivo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="dto-ef" className="mb-1 block">
              Descuento por efectivo (%)
            </Label>
            <Input
              id="dto-ef"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={descuentoEfPct}
              onChange={(e) =>
                setDescuentoEfPct(
                  clamp(parseFloat(e.target.value), 0, 100, descuentoEfPct),
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="val" className="mb-1 block">
                Validez del presupuesto (días)
              </Label>
              <Input
                id="val"
                type="number"
                min="1"
                max="365"
                value={validezPresup}
                onChange={(e) =>
                  setValidezPresup(
                    clamp(parseInt(e.target.value), 1, 365, validezPresup),
                  )
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="sin-stock"
                type="checkbox"
                checked={permitirSinStock}
                onChange={(e) => setPermitirSinStock(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="sin-stock">
                Permitir venta sin stock por defecto (también requiere permiso del rol)
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cuotas y recargos</CardTitle>
            <CardDescription>
              Define cuántas cuotas se ofrecen al cobrar con tarjeta de crédito y el recargo
              correspondiente. El recargo se le aplica al cliente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 grid grid-cols-[1fr_1fr_auto] gap-3 text-xs uppercase text-muted-foreground">
              <span>Cuotas</span>
              <span>Recargo %</span>
              <span />
            </div>
            <div className="space-y-2">
              {cuotas.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3">
                  <Input
                    type="number"
                    min="1"
                    max="36"
                    value={c.cuotas}
                    onChange={(e) =>
                      editarCuota(i, {
                        cuotas: clamp(parseInt(e.target.value), 1, 36, c.cuotas),
                      })
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    max="200"
                    step="0.5"
                    value={c.recargo_pct}
                    onChange={(e) =>
                      editarCuota(i, {
                        recargo_pct: clamp(
                          parseFloat(e.target.value),
                          0,
                          200,
                          c.recargo_pct,
                        ),
                      })
                    }
                  />
                  <Button variant="ghost" size="icon" onClick={() => quitarCuota(i)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={agregarCuota}
            >
              <Plus className="mr-1 h-3 w-3" />
              Agregar opción de cuota
            </Button>
          </CardContent>
        </Card>

        {/* Saldo inicial — para arrancar a mitad de mes sin partir reportes. */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Saldo inicial del comercio</CardTitle>
            <CardDescription>
              Si arrancás a usar el sistema a mitad de mes y querés que el
              dashboard muestre los totales reales del período, cargá acá lo
              que ya hiciste antes de empezar (facturación, ganancia, tickets,
              cobros). Cada valor se suma al KPI correspondiente del dashboard
              cuando el rango seleccionado arranca igual o antes de la fecha
              indicada. Podés actualizarlo cuando quieras.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Fila 1: facturación + ganancia + tickets */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-sm">Facturación acumulada ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={arranqueFacturacion}
                  onChange={(e) =>
                    setArranqueFacturacion(
                      clamp(parseFloat(e.target.value), 0, 9_999_999_999, arranqueFacturacion),
                    )
                  }
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Total facturado fuera del sistema.
                </p>
              </div>
              <div>
                <Label className="text-sm">Ganancia bruta acumulada ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={arranqueGanancia}
                  onChange={(e) =>
                    setArranqueGanancia(
                      clamp(parseFloat(e.target.value), 0, 9_999_999_999, arranqueGanancia),
                    )
                  }
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Ganancia (precio − costo) acumulada. Opcional.
                </p>
              </div>
              <div>
                <Label className="text-sm">Cantidad de ventas (tickets)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={arranqueVentas}
                  onChange={(e) =>
                    setArranqueVentas(
                      clamp(parseInt(e.target.value, 10), 0, 1_000_000, arranqueVentas),
                    )
                  }
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Cantidad de operaciones (no unidades).
                </p>
              </div>
            </div>

            {/* Fila 2: cobrado efectivo + otros + desde fecha */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-sm">Cobrado en efectivo ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={arranqueEfectivo}
                  onChange={(e) =>
                    setArranqueEfectivo(
                      clamp(parseFloat(e.target.value), 0, 9_999_999_999, arranqueEfectivo),
                    )
                  }
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Total cobrado en efectivo previo al sistema.
                </p>
              </div>
              <div>
                <Label className="text-sm">Cobrado en otros métodos ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={arranqueOtros}
                  onChange={(e) =>
                    setArranqueOtros(
                      clamp(parseFloat(e.target.value), 0, 9_999_999_999, arranqueOtros),
                    )
                  }
                  placeholder="0"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Tarjeta · QR · Transferencia · Cta. cte.
                </p>
              </div>
              <div>
                <Label className="text-sm">Desde qué fecha cuenta</Label>
                <Input
                  type="date"
                  value={arranqueDesde}
                  onChange={(e) => setArranqueDesde(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Típicamente el 1ro del mes en curso.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Datos del comercio (aparecen en ticket y página de contacto) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Datos del comercio</CardTitle>
            <CardDescription>
              Se muestran en el ticket impreso y en la página de contacto del sitio web.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1 block">Razón social / Nombre</Label>
              <Input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block">CUIT</Label>
              <Input value={cuit} onChange={(e) => setCuit(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 block">Dirección</Label>
              <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block">Teléfono</Label>
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block">Email</Label>
              <Input
                type="email"
                value={emailComercio}
                onChange={(e) => setEmailComercio(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 block">Horario</Label>
              <Input
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                placeholder="Lun a Sáb 8:00 a 22:00"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 block">Logo del comercio</Label>
              <LogoUploader logoUrl={logoUrl} setLogoUrl={setLogoUrl} />
              <p className="mt-1 text-xs text-muted-foreground">
                Aparece en el header del ticket. PNG cuadrado funciona mejor.
                Se redimensiona y comprime automáticamente al subirlo.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* E-commerce: mínimo de pedido + template WhatsApp */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>E-commerce mayorista</CardTitle>
            <CardDescription>
              Reglas que aplica el sitio web cuando el cliente arma su pedido.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-1 block">Pedido mínimo (en $)</Label>
              <Input
                type="number"
                min={0}
                step={1000}
                value={pedidoMinimo}
                onChange={(e) =>
                  setPedidoMinimo(
                    clamp(parseFloat(e.target.value), 0, 9_999_999, pedidoMinimo),
                  )
                }
                className="max-w-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                0 = sin mínimo. Por debajo de este monto la web no deja enviar el pedido.
              </p>
            </div>
            <div>
              <Label className="mb-1 block">
                Plantilla del mensaje de WhatsApp (opcional)
              </Label>
              <textarea
                value={waTemplate}
                onChange={(e) => setWaTemplate(e.target.value)}
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                placeholder="Dejar vacío para usar el formato por defecto. Variables disponibles: {fecha}, {cliente.razonSocial}, {cliente.contacto}, {cliente.telefono}, {items}, {total}, {metodoPago}, {entrega}, {notas}"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Si querés controlar exactamente el mensaje que se manda, escribilo acá usando
                las variables entre llaves. Si lo dejás vacío, se usa un formato razonable
                por defecto.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <RequierePermiso
          modulo="configuracion"
          accion="modificar_general"
          fallback={
            <p className="text-sm text-muted-foreground">
              No tenés permiso para modificar la configuración.
            </p>
          }
        >
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </RequierePermiso>
      </div>
    </div>
  );
}

function LogoUploader({
  logoUrl,
  setLogoUrl,
}: {
  logoUrl: string;
  setLogoUrl: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  async function manejarArchivo(file: File) {
    setSubiendo(true);
    try {
      const { blob } = await comprimirImagen(file);
      // Subimos al mismo bucket que las imágenes de producto, en una carpeta
      // dedicada "_config". No es un productoId pero la firma del helper
      // acepta cualquier prefijo de path.
      const url = await subirAStorage('_config', blob);
      setLogoUrl(url);
      toast.success('Logo subido. No olvides guardar la configuración.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        {logoUrl ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt="logo"
              className="h-20 w-20 rounded border bg-white object-contain p-1"
            />
            <button
              type="button"
              onClick={() => setLogoUrl('')}
              className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-white shadow hover:bg-destructive/90"
              title="Quitar logo"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
            sin logo
          </div>
        )}

        <div className="flex-1 space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void manejarArchivo(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
          >
            <Upload className="mr-1 h-4 w-4" />
            {subiendo ? 'Subiendo…' : 'Subir desde mi PC'}
          </Button>
          <p className="text-xs text-muted-foreground">o pegá una URL pública:</p>
          <Input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
      </div>
    </div>
  );
}
