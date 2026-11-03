import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, CreditCard, Smartphone, ArrowLeftRight, X, Check } from 'lucide-react';
import { Dialog } from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { formatCurrency } from '@comercio/ui/utils';
import { getDb } from '@/lib/db';
import { useSesion } from '@/stores/sesion';
import {
  calcularBaseVenta,
  calcularDescuentoGlobal,
  calcularSubtotal,
  calcularSubtotalLinea,
  useVenta,
} from '@/stores/venta';
import { subtotalComboXPrecio, unidadesCobradasNxM } from '@comercio/business';
import { useDepositoActivo } from '@/lib/deposito-activo';
import { PRESET_IDS, type MetodoPago, type PagoVenta } from '@comercio/db';

// Regex UUID liberal (formato hex 8-4-4-4-12, sin restricción de versión RFC).
// Si el deposito_id de la sesión no es UUID (ej. residuo del modo mock con
// 'dep_central'), caer al fallback canónico de Supabase.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function depositoIdSeguro(id: string | undefined | null): string {
  return id && UUID_RE.test(id) ? id : PRESET_IDS.depositoCentralFallback;
}

type MetodoConfig = {
  metodo: MetodoPago;
  label: string;
  icon: typeof Banknote;
  requiereCliente?: boolean;
};

const METODOS: MetodoConfig[] = [
  { metodo: 'efectivo', label: 'Efectivo', icon: Banknote },
  { metodo: 'transferencia', label: 'Transferencia', icon: ArrowLeftRight },
  { metodo: 'debito', label: 'Débito', icon: CreditCard },
  { metodo: 'credito', label: 'Crédito (cuotas)', icon: CreditCard },
  { metodo: 'qr', label: 'QR', icon: Smartphone },
  // Cta corriente quitada del PoS: el cajero solo vende a consumidor final.
  // La lógica del repo sigue soportándola por si la habilitamos en el futuro.
];

export function ModalCobro({
  open,
  onOpenChange,
  metodoInicial,
  onCobrado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  metodoInicial?: MetodoPago;
  onCobrado: (ventaId: string) => void;
}) {
  const db = getDb();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const empleado = useSesion((s) => s.empleado);
  const caja = useSesion((s) => s.caja);
  const sesion = useSesion((s) => s.sesionCaja);
  const items = useVenta((s) => s.items);
  const clienteId = useVenta((s) => s.clienteId);
  const descuentoModo = useVenta((s) => s.descuentoModo);
  const descuentoValor = useVenta((s) => s.descuentoValor);
  const motivoDescuento = useVenta((s) => s.motivoDescuento);
  const limpiar = useVenta((s) => s.limpiar);

  const subtotal = useMemo(() => calcularSubtotal(items), [items]);
  const descuentoGlobal = useMemo(
    () => calcularDescuentoGlobal(subtotal, descuentoModo, descuentoValor),
    [subtotal, descuentoModo, descuentoValor],
  );
  const baseACubrir = useMemo(
    () => calcularBaseVenta(items, descuentoModo, descuentoValor),
    [items, descuentoModo, descuentoValor],
  );

  // Fracción del carrito que va SIN recargo por cuotas (productos con
  // promo "cuotas sin interés" del cliente). Cuando el cajero elige
  // crédito con cuotas, el % de recargo se aplica solo sobre la porción
  // "con recargo" — la otra pasa a valor nominal.
  //
  // Ej.: carrito $10.000 con $3.000 en valijas (sin recargo).
  //   pctSinRecargo = 30%. Si recargo cuotas = 20%:
  //   total con cuotas = 3000 + 7000*1.20 = $11.400 (en vez de $12.000).
  const pctSinRecargo = useMemo(() => {
    if (items.length === 0) return 0;
    let subtotalSinRecargo = 0;
    let subtotalTotal = 0;
    for (const it of items) {
      // Neto por línea = igual base que el cobro. calcularSubtotalLinea
      // ya aplica NxM y descuento por línea.
      const neto = calcularSubtotalLinea(it);
      subtotalTotal += neto;
      if (it.producto.cuotas_sin_recargo) subtotalSinRecargo += neto;
    }
    return subtotalTotal > 0 ? subtotalSinRecargo / subtotalTotal : 0;
  }, [items]);

  // Y el pill informativo — total del carrito que sí tiene la marca,
  // para mostrarlo debajo del método crédito.
  const totalSinRecargo = useMemo(() => baseACubrir * pctSinRecargo, [baseACubrir, pctSinRecargo]);

  const [pagos, setPagos] = useState<PagoVenta[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago | null>(null);
  const [cuotas, setCuotas] = useState(1);
  const [montoInput, setMontoInput] = useState<string>('');
  // Modo del flujo: 'rapido' = un solo método, Confirmar agrega y cobra
  // en un click. 'mixto' = la cajera arma varios pagos antes de confirmar.
  // Se setea según `metodoInicial`; podés cambiar de rápido a mixto desde
  // el botón "Pagar con varios métodos" adentro del modal.
  const [modo, setModo] = useState<'rapido' | 'mixto'>('rapido');

  // Depósito desde donde se descuenta el stock al confirmar la venta.
  // Es el del LOCAL de la caja activa, no el del empleado en su perfil.
  const { depositoId: depositoActivoId } = useDepositoActivo();

  const configQ = useQuery({
    queryKey: ['config-empresa'],
    queryFn: () => db.configuracion.get(PRESET_IDS.empresa),
  });

  useEffect(() => {
    if (open) {
      setPagos([]);
      // Modo: si nos abren con un método sugerido (botón Cobrar), modo
      // rápido con ese método + monto pre-llenado al base. Si nos abren
      // sin método (botón Pago mixto), modo mixto, cajera arma a mano.
      const m = metodoInicial ?? 'efectivo';
      setMetodo(metodoInicial ? m : null);
      setModo(metodoInicial ? 'rapido' : 'mixto');
      setCuotas(1);
      setMontoInput(metodoInicial ? String(baseACubrir.toFixed(2)) : '');
    }
  }, [open, metodoInicial, baseACubrir]);

  // Listener global de Enter dentro del modal. Permite confirmar la
  // venta sin tocar el botón: cuando el foco NO está en un input de
  // texto, Enter confirma directo. Si el foco está en un input, deja
  // que el handler del input se encargue (algunos tienen Enter custom).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!confirmarHabilitadoRef.current) return;
      e.preventDefault();
      if (modoRef.current === 'rapido') confirmarRapidoRef.current();
      else cobrarMutRef.current.mutate(undefined);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Para saber cuánto del "base a cubrir" queda por cubrir:
  const baseCubierta = pagos.reduce((acc, p) => {
    if (p.metodo === 'efectivo') {
      const dto = configQ.data?.descuento_efectivo_pct ?? 0;
      return acc + p.monto / (1 - dto / 100);
    }
    if (p.metodo === 'credito') {
      const rec = p.recargo_pct ?? 0;
      return acc + p.monto / (1 + rec / 100);
    }
    return acc + p.monto;
  }, 0);

  const restante = Math.max(0, baseACubrir - baseCubierta);
  const cubiertoPct = baseACubrir > 0 ? Math.min(100, (baseCubierta / baseACubrir) * 100) : 0;

  function calcularPagoFinal(
    base: number,
    met: MetodoPago | null,
    cuo: number,
    dtoEfectivoPct: number,
    cuotasConf: { cuotas: number; recargo_pct: number }[],
    pctSinRec = 0,
  ): number {
    if (!met || base <= 0) return 0;
    if (met === 'efectivo') return base * (1 - dtoEfectivoPct / 100);
    if (met === 'credito') {
      const c = cuotasConf.find((x) => x.cuotas === cuo);
      const recPct = c?.recargo_pct ?? 0;
      // Aplica recargo solo sobre la porción "con recargo" del carrito.
      // La parte sin recargo (valijas, electros con promo) va a valor
      // nominal, sin sumar el % de cuotas.
      const parteSinRec = base * pctSinRec;
      const parteConRec = base * (1 - pctSinRec);
      return parteSinRec + parteConRec * (1 + recPct / 100);
    }
    return base;
  }

  // Parser robusto: devuelve un número finito y >= 0, o el fallback.
  // Sin esto, "abc" → NaN (manejado), pero "Infinity" o "-5" pasaban
  // y rompían los cálculos posteriores.
  function montoSeguro(input: string, fallback: number): number {
    const n = parseFloat(input);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  }

  // Total que cobra el cajero (suma de pagos)
  const totalCobrado = pagos.reduce((acc, p) => acc + p.monto, 0);
  // Adelanto de cuánto sería el "pago actual" si se agregara
  const montoCubrirActual = montoSeguro(montoInput, restante);
  const proximoPagoMonto = calcularPagoFinal(
    montoCubrirActual,
    metodo,
    cuotas,
    configQ.data?.descuento_efectivo_pct ?? 0,
    configQ.data?.cuotas ?? [],
    pctSinRecargo,
  );

  function agregarPagoActual() {
    if (!metodo) return;
    if (metodo === 'cta_cte' && !clienteId) {
      toast.error('Cuenta corriente requiere cliente identificado');
      return;
    }
    const montoCubrir = montoSeguro(montoInput, restante);
    if (montoCubrir <= 0) {
      toast.error('Monto inválido');
      return;
    }
    if (montoCubrir > restante + 0.01) {
      toast.error(`No supera el restante (${formatCurrency(restante)})`);
      return;
    }

    const dtoEfectivo = configQ.data?.descuento_efectivo_pct ?? 0;
    const cuotaConf = configQ.data?.cuotas.find((c) => c.cuotas === cuotas);
    const recargoPct = metodo === 'credito' ? cuotaConf?.recargo_pct ?? 0 : 0;

    const pago: PagoVenta = {
      metodo,
      monto: calcularPagoFinal(montoCubrir, metodo, cuotas, dtoEfectivo, configQ.data?.cuotas ?? [], pctSinRecargo),
      ...(metodo === 'credito' ? { cuotas, recargo_pct: recargoPct } : {}),
    };

    setPagos((p) => [...p, pago]);
    setMontoInput('');
    setMetodo(null);
  }

  /**
   * Modo rápido: arma el pago actual y dispara cobrarMut en un click.
   * Si el carrito ya tiene pagos previos (cambió de rápido a mixto?),
   * solo agrega este pago al final y luego cobra.
   */
  function confirmarRapido() {
    if (!metodo) {
      toast.error('Elegí un método de pago');
      return;
    }
    const montoCubrir = montoSeguro(montoInput, baseACubrir);
    if (montoCubrir <= 0) {
      toast.error('Monto inválido');
      return;
    }
    const dtoEfectivo = configQ.data?.descuento_efectivo_pct ?? 0;
    const cuotaConf = configQ.data?.cuotas.find((c) => c.cuotas === cuotas);
    const recargoPct = metodo === 'credito' ? cuotaConf?.recargo_pct ?? 0 : 0;
    const pago: PagoVenta = {
      metodo,
      monto: calcularPagoFinal(montoCubrir, metodo, cuotas, dtoEfectivo, configQ.data?.cuotas ?? [], pctSinRecargo),
      ...(metodo === 'credito' ? { cuotas, recargo_pct: recargoPct } : {}),
    };
    // Pasamos los pagos directamente a la mutación (override) para no
    // tener que esperar a que setState re-renderice. El setPagos es solo
    // para que la UI refleje el estado si la mutación tarda.
    setPagos([pago]);
    cobrarMut.mutate([pago]);
  }

  const cobrarMut = useMutation({
    mutationFn: async (pagosOverride?: PagoVenta[]) => {
      if (!empleado || !caja || !sesion) throw new Error('Sesión inválida');
      // Override permite al modo rápido pasar los pagos directamente sin
      // depender de que setState haya re-renderizado primero. Si no se
      // pasa, usa los del state (modo mixto, donde la cajera arma a mano).
      const pagosUsar = pagosOverride ?? pagos;
      if (pagosUsar.length === 0) throw new Error('No hay pagos');

      // Validación: cada línea con DESCUENTO por línea debe tener motivo
      // (el descuento sí requiere justificación — es una decisión del
      // cajero de qué % aplicar). Los cambios de PRECIO en cambio ya no
      // piden motivo por pedido de Agus: solo queda auditado que hubo
      // un cambio y cuánto, pero sin motivo. Los motivos que sí hay
      // quedan en auditoría después de crear la venta (más abajo).
      for (const it of items) {
        if (it.descuento_pct && it.descuento_pct > 0 && !it.motivo_descuento_linea?.trim()) {
          throw new Error(
            `Falta motivo del descuento aplicado a "${it.producto.nombre}"`,
          );
        }
      }

      // Defensa final: validar que todos los IDs que viajan al RPC sean UUID.
      // Si algo está roto en la sesión, falla con mensaje claro antes de pegarle
      // a Supabase (evita el cryptic "invalid input syntax for type uuid").
      const idsAValidar: { campo: string; valor: string | null | undefined }[] = [
        { campo: 'empleado.id', valor: empleado.id },
        { campo: 'depositoActivo', valor: depositoActivoId },
        { campo: 'caja.id', valor: caja.id },
        { campo: 'caja.local_id', valor: caja.local_id },
        { campo: 'sesion.id', valor: sesion.id },
        ...items.map((it, i) => ({
          campo: `items[${i}].producto_id`,
          valor: it.producto.id,
        })),
      ];
      const malos = idsAValidar.filter(
        ({ valor }) => valor != null && !UUID_RE.test(valor),
      );
      if (malos.length > 0) {
        // Forzar relogin: la sesión tiene residuo del modo mock o quedó
        // desincronizada. Limpiamos el carrito + logout + nav a login en
        // el siguiente tick (para no romper el flujo de mutación).
        useSesion.getState().logout();
        setTimeout(() => navigate('/login'), 100);
        throw new Error(
          'Tu sesión quedó desincronizada. Te llevamos al login.',
        );
      }
      // ANTES de calcular el payload, refrescamos los productos del
      // carrito contra BD. Cubre el caso donde la promo (NxM / combo) se
      // activa entre que el cajero abre el PoS y cobra: sin este refresh,
      // el carrito queda con el snapshot viejo del producto (sin promo)
      // y cobra de más. Diagnosticado por ventas del 2x1 "Sobre sorpresa
      // k-po" en julio-agosto 2026 (10 tickets, $60k extra).
      // Si el fetch falla por red/latencia, caemos a los snapshots del
      // carrito — nunca bloqueamos la venta por este refresh.
      let itemsFrescos = items;
      try {
        const frescos = await Promise.all(
          items.map((it) => db.productos.get(it.producto.id)),
        );
        itemsFrescos = items.map((it, idx) => {
          const fresco = frescos[idx];
          return fresco ? { ...it, producto: fresco } : it;
        });
      } catch {
        // Red caída o lentitud excesiva — seguimos con lo que tenemos.
      }

      // items_payload: subtotal delegado a calcularSubtotalLinea para que
      // aplique NxM (2x1, 3x2…) y descuento_pct por línea de forma
      // consistente con lo que ve el cajero y con calcularSubtotal.
      const items_payload = itemsFrescos.map((it) => ({
        producto_id: it.producto.id,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        descuento_pct: it.descuento_pct,
        subtotal: calcularSubtotalLinea(it),
      }));
      const total = pagosUsar.reduce((acc, p) => acc + p.monto, 0);
      // descuentoLineas: solo el % del cajero, aplicado sobre la base ya
      // reducida por NxM/combo (así no se "cobra doble" la promo como
      // descuento y a la vez como precio-menos).
      const descuentoLineas = itemsFrescos.reduce((acc, it) => {
        if (!it.descuento_pct) return acc;
        let baseLinea: number;
        if (
          it.producto.promo_tipo === 'nxm' &&
          it.producto.promo_nxm_lleva != null &&
          it.producto.promo_nxm_paga != null
        ) {
          const cobradas = unidadesCobradasNxM(
            it.cantidad,
            it.producto.promo_nxm_lleva,
            it.producto.promo_nxm_paga,
          );
          baseLinea = cobradas * it.precio_unitario;
        } else if (
          it.producto.promo_tipo === 'combo' &&
          it.producto.promo_combo_cantidad != null &&
          it.producto.promo_combo_precio != null
        ) {
          baseLinea = subtotalComboXPrecio(
            it.cantidad,
            it.producto.promo_combo_cantidad,
            it.producto.promo_combo_precio,
            it.precio_unitario,
          );
        } else {
          baseLinea = it.cantidad * it.precio_unitario;
        }
        return acc + baseLinea * (it.descuento_pct / 100);
      }, 0);
      const descuentoMetodo = pagosUsar
        .filter((p) => p.metodo === 'efectivo')
        .reduce((acc, p) => {
          const dto = configQ.data?.descuento_efectivo_pct ?? 0;
          const base = p.monto / (1 - dto / 100);
          return acc + (base - p.monto);
        }, 0);
      const recargo_total = pagosUsar
        .filter((p) => p.metodo === 'credito')
        .reduce((acc, p) => {
          const rec = p.recargo_pct ?? 0;
          const base = p.monto / (1 + rec / 100);
          return acc + (p.monto - base);
        }, 0);
      const descuento_total = descuentoLineas + descuentoGlobal + descuentoMetodo;

      // Política Turisteando (definida con Agus): si el depósito local
      // del cajero no tiene stock suficiente, la venta procede y el
      // stock del local queda negativo. El dueño corrige después.
      //
      // Antes había un bloque "auto-transfer": si faltaba stock en el
      // local del cajero, movía unidades desde otros depósitos con dos
      // ajustes ("Auto-transfer a ..." y "Auto-transfer desde otro
      // local ..."). Esto ensuciaba el historial de movimientos con
      // filas que Agus no reconocía como propias. Ahora simplemente
      // dejamos que la RPC descuente del local (aunque quede negativo)
      // y listo — un solo movimiento tipo "venta" limpio.
      // eslint-disable-next-line no-console
      for (const it of items) {
        const depLocal = depositoIdSeguro(depositoActivoId);
        const todos = await db.stock.porProducto(it.producto.id);
        const enLocal = Number(
          todos.find((s) => s.deposito_id === depLocal)?.cantidad ?? 0,
        );
        if (it.cantidad > enLocal) {
          console.warn(
            `Stock negativo: "${it.producto.nombre}" faltan ${it.cantidad - enLocal} unidades en el local. La venta procede igual.`,
          );
        }
      }

      const venta = await db.ventas.crear({
        caja_id: caja.id,
        sesion_caja_id: sesion.id,
        local_id: caja.local_id,
        deposito_id: depositoIdSeguro(depositoActivoId),
        empleado_id: empleado.id,
        cliente_id: clienteId ?? undefined,
        items: items_payload,
        pagos: pagosUsar,
        subtotal,
        descuento_total,
        recargo_total,
        total,
      });

      // Si hubo descuento global, registrar auditoría
      if (descuentoValor > 0) {
        await db.auditoria.log({
          empleado_id: empleado.id,
          accion: 'descuento_manual',
          entidad: 'venta',
          entidad_id: venta.id,
          detalle: {
            modo: descuentoModo,
            valor: descuentoValor,
            monto: descuentoGlobal,
            motivo: motivoDescuento ?? null,
          },
        });
      }
      // Registrar auditoría por cada línea con precio editado o descuento.
      // Cada log queda atado a la venta para que el admin lo muestre en el
      // detalle. Los hacemos en paralelo (no esperan unos a otros) porque
      // no son críticos al éxito de la venta.
      const logsLinea: Promise<unknown>[] = [];
      for (const it of items) {
        if (it.precio_unitario !== it.precio_base) {
          logsLinea.push(
            db.auditoria.log({
              empleado_id: empleado.id,
              accion: 'precio_editado',
              entidad: 'venta',
              entidad_id: venta.id,
              detalle: {
                producto_id: it.producto.id,
                producto_nombre: it.producto.nombre,
                codigo_interno: it.producto.codigo_interno,
                precio_base: it.precio_base,
                precio_nuevo: it.precio_unitario,
                diferencia: it.precio_unitario - it.precio_base,
                cantidad: it.cantidad,
                motivo: it.motivo_precio ?? null,
              },
            }),
          );
        }
        if (it.descuento_pct && it.descuento_pct > 0) {
          logsLinea.push(
            db.auditoria.log({
              empleado_id: empleado.id,
              accion: 'descuento_linea',
              entidad: 'venta',
              entidad_id: venta.id,
              detalle: {
                producto_id: it.producto.id,
                producto_nombre: it.producto.nombre,
                codigo_interno: it.producto.codigo_interno,
                porcentaje: it.descuento_pct,
                precio_unitario: it.precio_unitario,
                cantidad: it.cantidad,
                motivo: it.motivo_descuento_linea ?? null,
              },
            }),
          );
        }
      }
      // No esperamos a que terminen — si alguno falla solo loguea console
      // y la venta queda registrada igual.
      Promise.all(logsLinea).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('Algunos logs de auditoría por línea fallaron:', e);
      });
      return venta;
    },
    onSuccess: (v) => {
      toast.success(`Venta ${v.numero} confirmada`);
      // Refrescar inmediato el listado del turno, sin esperar el poll de 5s.
      qc.invalidateQueries({ queryKey: ['ventas-sesion'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      limpiar();
      onOpenChange(false);
      onCobrado(v.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Refs para que el listener global de Enter (instalado una sola vez
  // al abrir el modal) lea siempre los valores actuales sin necesidad
  // de re-suscribirse en cada render.
  // CRÍTICO: declarar ANTES del early return — si los useRef quedan
  // después del `if (!open) return null`, React ve más hooks cuando el
  // modal se abre y crashea (rules of hooks).
  const confirmarHabilitadoRef = useRef(false);
  const modoRef = useRef<'rapido' | 'mixto'>('rapido');
  const confirmarRapidoRef = useRef<() => void>(() => {});
  const cobrarMutRef = useRef<typeof cobrarMut>(cobrarMut);
  // Ref al botón Confirmar venta para auto-foco al abrir el modal.
  // Sin esto, Enter después de abrir va al input del buscador (que
  // tiene el foco previo) y re-abre el modal en lugar de confirmar.
  const confirmarBtnRef = useRef<HTMLButtonElement>(null);

  // Al abrir el modal: foco al botón Confirmar venta. La cajera puede:
  // - Apretar Enter directo → confirma (caso "pago justo en efectivo").
  // - Tocar un billete → focus se mantiene en Confirmar (los billetes
  //   hacen blur() al clickearse) → Enter siguiente confirma.
  // - Tabear al input "O escribí otro monto" → Enter ahí también confirma.
  useEffect(() => {
    if (!open) return;
    // setTimeout 0 para esperar a que el botón se monte en el DOM.
    const t = setTimeout(() => confirmarBtnRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;
  const cuotasOpciones = configQ.data?.cuotas ?? [];

  // --- Cálculos para el render ---
  const aPagar = proximoPagoMonto;
  // En modo rápido, "Confirmar venta" lleva el monto del efectivo a la
  // venta (con su descuento). En modo mixto, lleva la suma de pagos.
  const totalConfirmar = modo === 'rapido' ? aPagar : totalCobrado;
  // Habilitamos confirmar en rápido apenas haya método elegido (monto
  // pre-llenado al abrir). En mixto, cuando los pagos cubren todo.
  const confirmarHabilitado =
    modo === 'rapido'
      ? !!metodo && aPagar > 0 && !cobrarMut.isPending
      : restante < 0.01 && pagos.length > 0 && !cobrarMut.isPending;

  // Mantener los refs actualizados con los valores del render actual
  // (los lee el listener global de Enter).
  confirmarHabilitadoRef.current = confirmarHabilitado;
  modoRef.current = modo;
  confirmarRapidoRef.current = confirmarRapido;
  cobrarMutRef.current = cobrarMut;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-xl">
      {/* Header inline (no DialogHeader que tiene mb-4) para máxima
          compactación en pantallas chicas — el título es lo primero
          que tiene que verse sin scroll. */}
      <h2 className="mb-2 text-base font-semibold sm:text-lg">
        {modo === 'mixto' ? 'Pago mixto · ' : 'Cobrar · '}
        {formatCurrency(baseACubrir)}
        {descuentoValor > 0 && (
          <span className="ml-2 text-xs font-normal text-green-700">
            (incluye -{formatCurrency(descuentoGlobal)})
          </span>
        )}
      </h2>

      <div className="space-y-2 pb-3">
        {/* Selector de método: 5 botones en fila, ícono + label INLINE.
            Tamaño más grande (h-14, text-sm) para que sea fácil de leer
            desde lejos en la caja. Pre-seleccionado el que vino en
            metodoInicial. */}
        <div className="grid grid-cols-5 gap-1.5">
          {METODOS.map((m) => {
            const Icon = m.icon;
            const activo = metodo === m.metodo;
            return (
              <button
                key={m.metodo}
                onClick={(e) => {
                  setMetodo(m.metodo);
                  setMontoInput(
                    String((modo === 'rapido' ? baseACubrir : restante).toFixed(2)),
                  );
                  // Sacar foco del botón para que un Enter posterior
                  // no re-clickee este mismo botón (que el listener
                  // global de Enter pueda disparar confirmar).
                  e.currentTarget.blur();
                }}
                className={`flex h-14 items-center justify-center gap-2 rounded-md border px-2 text-sm transition ${
                  activo ? 'border-primary bg-primary/10 font-semibold' : 'border-input hover:bg-accent'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{m.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Cuotas si es crédito */}
        {metodo === 'credito' && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              Cuotas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cuotasOpciones.map((c) => (
                <button
                  key={c.cuotas}
                  onClick={() => setCuotas(c.cuotas)}
                  className={`rounded border px-2 py-1.5 text-xs transition ${
                    cuotas === c.cuotas
                      ? 'border-primary bg-primary/10 font-semibold'
                      : 'border-input hover:bg-accent'
                  }`}
                >
                  {c.cuotas}x
                  {c.recargo_pct > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      +{c.recargo_pct}%
                    </span>
                  )}
                </button>
              ))}
            </div>
            {/* Aviso cuando hay items del carrito con "cuotas sin recargo".
                El % de cuotas se aplica sólo al resto. */}
            {pctSinRecargo > 0 && (
              <div className="mt-1.5 rounded border border-purple-300 bg-purple-50 px-2 py-1 text-[11px] text-purple-900">
                Hay <b>{formatCurrency(totalSinRecargo)}</b> ({Math.round(pctSinRecargo * 100)}%) en
                items con <b>cuotas sin recargo</b> — el % de cuotas se aplica solo al resto.
              </div>
            )}
          </div>
        )}

        {/* Banner "Total a cobrar" SOLO si tiene descuento/recargo (el
            monto cambia respecto al de la cabecera). Si no, sería un
            duplicado del título del modal — ahorramos altura ocultándolo. */}
        {metodo && (
          (metodo === 'efectivo' && (configQ.data?.descuento_efectivo_pct ?? 0) > 0) ||
          (metodo === 'credito' && (configQ.data?.cuotas.find((x) => x.cuotas === cuotas)?.recargo_pct ?? 0) > 0)
        ) && (
          <div className="flex items-baseline justify-between rounded-md bg-primary/10 px-3 py-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {metodo === 'efectivo'
                ? `Total (con -${configQ.data!.descuento_efectivo_pct}% efectivo)`
                : `Total (con +${configQ.data?.cuotas.find((x) => x.cuotas === cuotas)?.recargo_pct}% cuotas)`}
            </span>
            <span className="text-xl font-bold tabular-nums text-primary">
              {formatCurrency(aPagar)}
            </span>
          </div>
        )}

        {/* Modo MIXTO: input de monto + lista de pagos ya agregados */}
        {modo === 'mixto' && metodo && (
          <div>
            <Label className="mb-1 block text-xs uppercase">Monto del subtotal a cubrir</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={montoInput}
                onChange={(e) => setMontoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && agregarPagoActual()}
                className="text-right"
              />
              <Button onClick={agregarPagoActual} className="shrink-0">
                + Agregar
              </Button>
            </div>
          </div>
        )}

        {modo === 'mixto' && pagos.length > 0 && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-2">
            <div className="mb-1 flex items-center justify-between text-xs uppercase text-muted-foreground">
              <span>Pagos agregados</span>
              <span>Restante: <b className={restante < 0.01 ? 'text-green-700' : ''}>{formatCurrency(restante)}</b></span>
            </div>
            {pagos.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded bg-background px-2 py-1 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-green-600" />
                  {labelMetodo(p.metodo)}
                  {p.cuotas ? ` · ${p.cuotas} cuotas` : ''}
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-medium tabular-nums">{formatCurrency(p.monto)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setPagos((arr) => arr.filter((_, idx) => idx !== i))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Nota histórica: acá vivía la calculadora de vuelto para
            efectivo (botones de billetes + input de monto recibido +
            display de "Vuelto: $X"). Sacada por pedido de Agus:
            los cajeros hacen el cálculo mental, no necesitan que el
            sistema pida "con cuánto pagó" ni muestre el cambio. */}

      </div>

      {/* Footer sticky: el botón "Confirmar venta" siempre visible.
          Incluye el link para alternar entre rápido y mixto a la izquierda
          (antes flotaba en el contenido y el sticky lo tapaba). */}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-6 flex flex-col gap-2 border-t bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
        <button
          type="button"
          onClick={() => {
            if (modo === 'rapido') {
              setModo('mixto');
              setPagos([]);
              setMetodo(null);
              setMontoInput('');
            } else {
              setModo('rapido');
              setPagos([]);
              setMetodo('efectivo');
              setMontoInput(String(baseACubrir.toFixed(2)));
            }
          }}
          className="text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {modo === 'rapido' ? 'Necesito pagar con varios métodos →' : '← Volver a cobro rápido (un solo método)'}
        </button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={cobrarMut.isPending}>
            Cancelar
          </Button>
          <Button
            ref={confirmarBtnRef}
            disabled={!confirmarHabilitado}
            onClick={() => {
              if (modo === 'rapido') confirmarRapido();
              else cobrarMut.mutate(undefined);
            }}
            className="text-base"
          >
            {cobrarMut.isPending
              ? 'Procesando…'
              : `Confirmar venta · ${formatCurrency(totalConfirmar)}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function labelMetodo(m: MetodoPago): string {
  return METODOS.find((x) => x.metodo === m)?.label ?? m;
}

