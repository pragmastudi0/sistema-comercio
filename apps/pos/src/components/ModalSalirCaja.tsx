import { useNavigate } from 'react-router-dom';
import { Lock, UserCog } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle } from '@comercio/ui/dialog';
import { Button } from '@comercio/ui/button';
import { useSesion } from '@/stores/sesion';

/**
 * Modal común para "estoy por salir del PoS con caja abierta".
 * Fuerza al cajero a elegir entre:
 *   - Cerrar caja: navega a /cerrar-caja (arqueo completo).
 *   - Solo cambiar usuario: mantiene sesion + caja en BD, sale al login.
 *     El próximo cajero, al loguear, toma la posta desde /abrir-caja.
 *
 * Aparece cuando el cajero aprieta "Cambiar usuario" o "Salir" del
 * header de Caja.tsx. Se evita el patrón viejo (confirm() nativo con
 * copy poco claro) que dejaba cajas abiertas por olvido.
 */
export function ModalSalirCaja({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const setEmpleado = useSesion((s) => s.setEmpleado);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Salir de la caja</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        La caja sigue <span className="font-medium text-foreground">abierta</span>.
        ¿Qué querés hacer?
      </p>
      <div className="mt-3 space-y-2">
        <Button
          variant="outline"
          className="h-auto w-full justify-start whitespace-normal py-3 text-left"
          onClick={() => {
            onOpenChange(false);
            navigate('/cerrar-caja');
          }}
        >
          <Lock className="mr-3 h-4 w-4 flex-shrink-0" />
          <span>
            <span className="block font-semibold">Cerrar caja</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Vas al arqueo. Se cuenta el efectivo y queda cerrada.
            </span>
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-auto w-full justify-start whitespace-normal py-3 text-left"
          onClick={() => {
            // Solo limpiamos el empleado; sesionCaja y caja siguen vivas
            // en el store y en BD. El próximo empleado que loguee toma
            // la posta desde AbrirCaja.
            setEmpleado(null);
            onOpenChange(false);
            navigate('/login');
          }}
        >
          <UserCog className="mr-3 h-4 w-4 flex-shrink-0" />
          <span>
            <span className="block font-semibold">
              Solo cambiar usuario
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              La caja queda abierta. El próximo cajero toma la posta al entrar.
            </span>
          </span>
        </Button>
      </div>
      <div className="mt-3 flex justify-end border-t pt-3">
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
      </div>
    </Dialog>
  );
}
