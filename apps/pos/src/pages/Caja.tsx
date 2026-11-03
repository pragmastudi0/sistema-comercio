import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { LogOut, Lock, Wallet, Ban, ArrowLeftRight, Settings } from 'lucide-react';
import { BRAND } from '@comercio/business';
import { PRESET_IDS } from '@comercio/db';
import { useSesion } from '@/stores/sesion';
import { useVenta } from '@/stores/venta';
import { useDepositoActivo } from '@/lib/deposito-activo';
import { getDb } from '@/lib/db';
import { BuscadorProducto } from '@/components/BuscadorProducto';
import { TabsCarritos } from '@/components/TabsCarritos';
import { Carrito } from '@/components/Carrito';
import { ResumenVenta } from '@/components/ResumenVenta';
import { ModalCobro } from '@/components/ModalCobro';
import { ModalAjustarCaja } from '@/components/ModalAjustarCaja';
import { ModalTransferenciaStock } from '@/components/ModalTransferenciaStock';
import { ModalSalirCaja } from '@/components/ModalSalirCaja';
import { SHORTCUTS, SHORTCUT_LABELS } from '@/lib/shortcuts';
import { Button } from '@comercio/ui/button';
import type { MetodoPago } from '@comercio/db';

export function Caja() {
  const navigate = useNavigate();
  const db = getDb();
  const empleado = useSesion((s) => s.empleado);
  const caja = useSesion((s) => s.caja);
  const sesion = useSesion((s) => s.sesionCaja);
  const { depositoId } = useDepositoActivo();
  const items = useVenta((s) => s.items);
  const limpiar = useVenta((s) => s.limpiar);

  const [modalCobro, setModalCobro] = useState<{ open: boolean; metodo?: MetodoPago }>({
    open: false,
  });
  const [ajustarCajaOpen, setAjustarCajaOpen] = useState(false);
  const [transferenciaOpen, setTransferenciaOpen] = useState(false);
  // Un solo modal para "estoy por irme": la caja queda abierta y le
  // ofrezco al cajero cerrar-y-arqueo o solo-cambiar-usuario. Reemplaza
  // los confirm() nativos que la gente terminaba clickeando sin leer.
  const [salirOpen, setSalirOpen] = useState(false);

  function abrirCobro(metodo?: MetodoPago) {
    if (items.length === 0) {
      toast.error('Carrito vacío');
      return;
    }
    setModalCobro({ open: true, metodo });
  }

  async function cancelarVenta() {
    if (items.length === 0) return;
    if (!confirm('¿Cancelar la venta actual? Se vaciará el carrito.')) return;
    // Si el carrito tenía items y hay sesión activa, registramos la venta
    // como "cancelada" para que el dueño pueda auditarla desde /admin/ventas.
    // No descuenta stock ni afecta caja.
    if (empleado && caja && sesion) {
      try {
        const subtotal = items.reduce(
          (acc, it) => acc + it.cantidad * it.precio_unitario,
          0,
        );
        await db.ventas.cancelar({
          caja_id: caja.id,
          sesion_caja_id: sesion.id,
          local_id: caja.local_id,
          deposito_id: depositoId,
          empleado_id: empleado.id,
          items: items.map((it) => ({
            producto_id: it.producto.id,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            descuento_pct: it.descuento_pct,
            subtotal: it.cantidad * it.precio_unitario,
          })),
          subtotal,
          descuento_total: 0,
          recargo_total: 0,
          total: subtotal,
        });
      } catch (e) {
        // No bloquear el cancel si el registro falla — el cajero debe
        // poder limpiar el carrito sí o sí. Logueamos para diagnóstico.
        // eslint-disable-next-line no-console
        console.error('No se pudo registrar venta cancelada:', e);
      }
    }
    limpiar();
    toast.info('Venta cancelada');
  }

  useHotkeys(
    SHORTCUTS.nuevaVenta,
    (e) => {
      e.preventDefault();
      if (items.length > 0 && !confirm('Hay items en el carrito. ¿Vaciar e iniciar nueva venta?')) {
        return;
      }
      limpiar();
    },
    { enableOnFormTags: true },
  );
  useHotkeys(SHORTCUTS.cobrarEfectivo, (e) => { e.preventDefault(); abrirCobro('efectivo'); }, { enableOnFormTags: true });
  useHotkeys(SHORTCUTS.cobrarTarjeta, (e) => { e.preventDefault(); abrirCobro('credito'); }, { enableOnFormTags: true });
  useHotkeys(SHORTCUTS.cobrarQR, (e) => { e.preventDefault(); abrirCobro('qr'); }, { enableOnFormTags: true });
  // F8: abrir Pago mixto (modal sin método pre-seleccionado).
  useHotkeys(SHORTCUTS.pagoMixto, (e) => { e.preventDefault(); abrirCobro(); }, { enableOnFormTags: true });
  useHotkeys(SHORTCUTS.cancelar, () => cancelarVenta(), { enableOnFormTags: true });

  // Tecla "+" global = abrir Cobrar efectivo. enableOnFormTags: true
  // porque el buscador SIEMPRE tiene el foco (re-foco automático), así
  // que sin esto el atajo no dispararía nunca. El preventDefault evita
  // que el "+" se inserte en el texto del input. Códigos de producto son
  // numéricos y los nombres no llevan "+", así que reservar esa tecla
  // para el cobro no rompe el flujo de búsqueda.
  useHotkeys(
    '+, numpadadd',
    (e) => {
      if (items.length === 0) return;
      e.preventDefault();
      abrirCobro('efectivo');
    },
    { enableOnFormTags: true },
    [items],
  );

  // Supr / Backspace fuera del buscador: borra el último ítem agregado.
  // Si volvés a apretar, borra el penúltimo (que ahora es el último), etc.
  // enableOnFormTags: false → NO dispara si el foco está en input/textarea
  // (el buscador ya tiene su propio handler que cubre el caso "input vacío").
  const borrarUltimo = useVenta((s) => s.quitar);
  useHotkeys(
    'delete, backspace',
    (e) => {
      if (items.length === 0) return;
      e.preventDefault();
      const ultimo = items[items.length - 1];
      if (ultimo) borrarUltimo(ultimo.producto.id);
    },
    { enableOnFormTags: false },
    [items],
  );

  if (!empleado || !caja) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="border-b">
        <div className="flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold tracking-tight">{BRAND.nombreCorto}</span>
            <span className="text-xs text-muted-foreground">· {caja.nombre}</span>
            <span className="text-xs text-muted-foreground">
              · {empleado.nombre} {empleado.apellido}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* "Anular" reemplaza al botón "Historial" — los cajeros
                lo usaban así en el sistema anterior. Misma destino, abre
                el historial donde pueden ver/anular/cambiar ventas. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/historial')}
              title="Anular venta · ver historial 48hs · cambios"
            >
              <Ban className="mr-1 h-3 w-3" />
              Anular
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAjustarCajaOpen(true)}
              title="Cargar o sacar efectivo de caja, corregir saldo"
            >
              <Wallet className="mr-1 h-3 w-3" />
              Ajustar caja
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTransferenciaOpen(true)}
              title="Asentar movimiento de stock entre locales/depósitos"
            >
              <ArrowLeftRight className="mr-1 h-3 w-3" />
              Stock
            </Button>
            {/* Botón Admin: sólo para admin y encargado. Abre el panel
                admin en pestaña nueva. Los cajeros no lo ven (no tienen
                acceso a /admin, se los kickea al login con toast).
                Catálogo tampoco (no es un rol que trabaje en el PoS). */}
            {(empleado.rol_id === PRESET_IDS.roles.admin ||
              empleado.rol_id === PRESET_IDS.roles.encargado) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const url =
                    import.meta.env.VITE_ADMIN_URL ??
                    'https://turisteando-admin.vercel.app';
                  window.open(url, '_blank', 'noopener');
                }}
                title="Abrir el panel de administración en una pestaña nueva"
              >
                <Settings className="mr-1 h-3 w-3" />
                Admin
              </Button>
            )}
            {/* Cerrar caja directo — atajo visible para el arqueo
                (el flujo más común). Los cajeros no encontraban esta
                acción cuando estaba escondida detrás del modal Salir. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/cerrar-caja')}
              title="Cerrar caja y hacer el arqueo"
            >
              <Lock className="mr-1 h-3 w-3" />
              Cerrar caja
            </Button>
            {/* Salir — modal con "Cerrar caja" + "Solo cambiar usuario".
                Sirve especialmente para el relevo (Diego → Franco): dejás
                la caja abierta y el otro toma la posta al loguear. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSalirOpen(true)}
              title="Salir del PoS (cambiar usuario o cerrar caja)"
            >
              <LogOut className="mr-1 h-3 w-3" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_340px]">
        <div className="flex flex-col overflow-hidden">
          <TabsCarritos />
          <div className="border-b p-4">
            <BuscadorProducto />
          </div>
          <div className="flex-1 overflow-y-auto">
            <Carrito />
          </div>
          <div className="border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono shadow-sm">
                  {SHORTCUT_LABELS.nuevaVenta}
                </kbd>{' '}
                Nueva venta
              </span>
              <span>
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono shadow-sm">
                  {SHORTCUT_LABELS.cancelar}
                </kbd>{' '}
                Cancelar
              </span>
              <span className="text-muted-foreground/70">
                Cobro: <kbd className="rounded bg-background px-1 py-0.5 font-mono shadow-sm">+</kbd> Efectivo · F5/F6/F7 Efectivo/Tarjeta/QR · F8 Pago mixto
              </span>
              <span className="text-muted-foreground/70">
                Buscador: Enter suma cantidad · ↑↓ navega · Supr borra ítem
              </span>
            </div>
          </div>
        </div>

        {/* overflow-hidden + min-h-0: sin esto, cuando se expande el panel
            de descuento el aside crece y el scroll interno del ResumenVenta
            deja de funcionar (no se llega a los botones de cobro). */}
        <aside className="flex min-h-0 flex-col overflow-hidden border-l">
          <ResumenVenta
            onCobrar={(m) => abrirCobro(m)}
            onCancelar={cancelarVenta}
          />
        </aside>
      </div>

      <ModalAjustarCaja open={ajustarCajaOpen} onOpenChange={setAjustarCajaOpen} />
      <ModalTransferenciaStock open={transferenciaOpen} onOpenChange={setTransferenciaOpen} />
      <ModalSalirCaja open={salirOpen} onOpenChange={setSalirOpen} />

      <ModalCobro
        open={modalCobro.open}
        onOpenChange={(v) => setModalCobro((m) => ({ ...m, open: v }))}
        metodoInicial={modalCobro.metodo}
        onCobrado={() => {
          // El dueño imprime el ticket por otro lado — no le sirve la
          // pantalla del ticket. Cerramos el modal y volvemos al buscador
          // para la próxima venta sin un click extra.
          setModalCobro((m) => ({ ...m, open: false }));
          toast.success('Venta registrada');
        }}
      />
    </div>
  );
}
