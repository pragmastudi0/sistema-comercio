'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X, Minus } from 'lucide-react';
import type { PermisosConfig, ModuloPermiso } from '@comercio/business';
import { cn } from '@comercio/ui/utils';
import { Button } from '@comercio/ui/button';

// Etiquetas amigables para módulos y acciones.
const MODULO_LABELS: Record<ModuloPermiso, string> = {
  ventas: 'Ventas',
  caja: 'Caja',
  productos: 'Productos',
  categorias: 'Categorías',
  clientes: 'Clientes',
  cuenta_corriente: 'Cuenta corriente',
  stock: 'Stock',
  proveedores: 'Proveedores',
  listas_precio: 'Listas de precio',
  reportes: 'Reportes',
  empleados: 'Empleados',
  roles: 'Roles',
  configuracion: 'Configuración',
  auditoria: 'Auditoría',
};

const ACCION_LABELS: Record<string, string> = {
  crear: 'Crear',
  editar: 'Editar',
  eliminar: 'Eliminar',
  ver: 'Ver',
  // Ventas
  anular_propia_del_dia: 'Anular venta propia del día',
  anular_ajena_del_dia: 'Anular venta ajena del día',
  anular_otros_dias: 'Anular ventas de días anteriores',
  descuento_manual: 'Aplicar descuento manual',
  modificar_precio_unitario: 'Modificar precio unitario',
  vender_sin_stock: 'Vender sin stock disponible',
  vender_cuenta_corriente: 'Vender por cuenta corriente',
  // Caja
  abrir: 'Abrir caja',
  cerrar: 'Cerrar caja',
  ver_propia: 'Ver caja propia',
  ver_otras_del_local: 'Ver cajas del local',
  ver_otras_de_otros_locales: 'Ver cajas de otros locales',
  ingreso_efectivo: 'Registrar ingreso',
  egreso_efectivo: 'Registrar egreso',
  retiro_efectivo: 'Retirar efectivo',
  // Productos
  modificar_precio: 'Modificar precio',
  modificar_costo: 'Modificar costo',
  aumento_masivo: 'Aumento masivo',
  importar: 'Importar',
  gestionar_atributos: 'Gestionar atributos',
  publicar_ecommerce: 'Publicar en e-commerce',
  // Clientes
  suspender: 'Suspender',
  cambiar_lista_precio: 'Cambiar lista de precio',
  // Cta cte
  registrar_pago: 'Registrar pago',
  modificar_limite: 'Modificar límite',
  condonar_deuda: 'Condonar deuda',
  // Stock
  ver_propio_deposito: 'Ver mi local',
  ver_todos_depositos: 'Ver todos los locales',
  ajustar: 'Ajustar stock',
  transferir: 'Transferir',
  aprobar_transferencia: 'Aprobar transferencia',
  registrar_merma: 'Registrar merma',
  // Reportes
  ver_caja_propia: 'Ver caja propia',
  ver_local_propio: 'Ver mi local',
  ver_otros_locales: 'Ver otros locales',
  ver_global: 'Ver global',
  ver_ganancia: 'Ver ganancia',
  ver_costos: 'Ver costos',
  // Empleados
  cambiar_rol: 'Cambiar rol',
  cambiar_permisos: 'Cambiar permisos',
  asignar_deposito: 'Asignar stock por local (legacy)',
  asignar_local: 'Asignar local',
  // Config
  modificar_recargos: 'Modificar recargos',
  modificar_descuentos: 'Modificar descuentos',
  modificar_general: 'Modificar parámetros generales',
  gestionar_empresa: 'Gestionar datos del comercio',
  backup_restore: 'Backup / restore',
};

// Acciones disponibles por módulo (debe coincidir con el tipo PermisosConfig).
const ESTRUCTURA: Record<ModuloPermiso, string[]> = {
  ventas: [
    'crear',
    'anular_propia_del_dia',
    'anular_ajena_del_dia',
    'anular_otros_dias',
    'descuento_manual',
    'modificar_precio_unitario',
    'vender_sin_stock',
    'vender_cuenta_corriente',
  ],
  caja: [
    'abrir',
    'cerrar',
    'ver_propia',
    'ver_otras_del_local',
    'ver_otras_de_otros_locales',
    'ingreso_efectivo',
    'egreso_efectivo',
    'retiro_efectivo',
  ],
  productos: [
    'ver',
    'crear',
    'editar',
    'eliminar',
    'modificar_precio',
    'modificar_costo',
    'aumento_masivo',
    'importar',
    'gestionar_atributos',
    'publicar_ecommerce',
  ],
  categorias: ['ver', 'crear', 'editar', 'eliminar'],
  clientes: ['ver', 'crear', 'editar', 'eliminar', 'suspender', 'cambiar_lista_precio'],
  cuenta_corriente: ['ver', 'registrar_pago', 'modificar_limite', 'condonar_deuda'],
  stock: [
    'ver_propio_deposito',
    'ver_todos_depositos',
    'ajustar',
    'transferir',
    'aprobar_transferencia',
    'registrar_merma',
  ],
  proveedores: ['ver', 'crear', 'editar', 'eliminar'],
  listas_precio: ['ver', 'crear', 'editar', 'eliminar'],
  reportes: [
    'ver_caja_propia',
    'ver_local_propio',
    'ver_otros_locales',
    'ver_global',
    'ver_ganancia',
    'ver_costos',
  ],
  empleados: [
    'ver',
    'crear',
    'editar',
    'eliminar',
    'cambiar_rol',
    'cambiar_permisos',
    'asignar_deposito',
    'asignar_local',
  ],
  roles: ['ver', 'crear', 'editar', 'eliminar'],
  configuracion: [
    'ver',
    'modificar_recargos',
    'modificar_descuentos',
    'modificar_general',
    'gestionar_empresa',
    'backup_restore',
  ],
  auditoria: ['ver'],
};

type EstadoAccion = 'rol_si' | 'rol_no' | 'over_si' | 'over_no';

function getEstado(
  modulo: ModuloPermiso,
  accion: string,
  rolPerms: PermisosConfig,
  override?: PermisosConfig,
): EstadoAccion {
  const o = override?.[modulo] as Record<string, boolean | undefined> | undefined;
  const r = rolPerms[modulo] as Record<string, boolean | undefined> | undefined;
  if (o && accion in o) {
    return o[accion] ? 'over_si' : 'over_no';
  }
  return r?.[accion] ? 'rol_si' : 'rol_no';
}

export function MatrizPermisos({
  rolPerms,
  override,
  onOverrideChange,
  soloVisualizar,
}: {
  rolPerms: PermisosConfig;
  override?: PermisosConfig;
  onOverrideChange?: (next: PermisosConfig | undefined) => void;
  soloVisualizar?: boolean;
}) {
  const [expandido, setExpandido] = useState<Set<ModuloPermiso>>(
    new Set(Object.keys(ESTRUCTURA) as ModuloPermiso[]),
  );

  function toggleExpand(modulo: ModuloPermiso) {
    const next = new Set(expandido);
    if (next.has(modulo)) next.delete(modulo);
    else next.add(modulo);
    setExpandido(next);
  }

  function ciclar(modulo: ModuloPermiso, accion: string) {
    if (!onOverrideChange) return;
    const estado = getEstado(modulo, accion, rolPerms, override);
    let nextEstado: EstadoAccion;
    if (estado === 'rol_si') nextEstado = 'over_no';
    else if (estado === 'over_no') nextEstado = 'over_si';
    else if (estado === 'over_si') nextEstado = 'rol_no';
    else nextEstado = 'over_si';

    const nuevo: PermisosConfig = override ? JSON.parse(JSON.stringify(override)) : {};
    const mod = (nuevo[modulo] as Record<string, boolean | undefined> | undefined) ?? {};
    if (nextEstado === 'rol_no') {
      // Volver a heredar del rol (rol_si nunca aparece como next porque viene de un override)
      delete mod[accion];
    } else {
      mod[accion] = nextEstado === 'over_si';
    }
    if (Object.keys(mod).length === 0) {
      delete (nuevo as Record<string, unknown>)[modulo];
    } else {
      (nuevo as Record<string, Record<string, boolean | undefined>>)[modulo] = mod;
    }
    onOverrideChange(Object.keys(nuevo).length === 0 ? undefined : nuevo);
  }

  return (
    <div className="space-y-3">
      {!soloVisualizar && (
        <p className="rounded bg-muted/30 p-2 text-xs text-muted-foreground">
          Click en una acción para cambiar entre: heredar del rol → override permitir →
          override bloquear → heredar.
        </p>
      )}
      <div className="overflow-hidden rounded-md border">
        {(Object.keys(ESTRUCTURA) as ModuloPermiso[]).map((modulo) => {
          const isOpen = expandido.has(modulo);
          return (
            <div key={modulo} className="border-b last:border-0">
              <button
                type="button"
                onClick={() => toggleExpand(modulo)}
                className="flex w-full items-center justify-between bg-muted/30 px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted/50"
              >
                <span className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {MODULO_LABELS[modulo]}
                </span>
              </button>
              {isOpen && (
                <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-2">
                  {ESTRUCTURA[modulo].map((accion) => {
                    const estado = getEstado(modulo, accion, rolPerms, override);
                    return (
                      <button
                        key={accion}
                        type="button"
                        onClick={() => ciclar(modulo, accion)}
                        disabled={soloVisualizar}
                        className={cn(
                          'flex items-center justify-between rounded px-2 py-1.5 text-left text-sm transition',
                          soloVisualizar
                            ? 'cursor-default'
                            : 'cursor-pointer hover:bg-accent',
                          estado === 'over_si' && 'border border-green-500 bg-green-50',
                          estado === 'over_no' && 'border border-red-500 bg-red-50',
                        )}
                      >
                        <span>{ACCION_LABELS[accion] ?? accion}</span>
                        <span
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded text-xs',
                            estado === 'rol_si' && 'bg-green-100 text-green-700',
                            estado === 'rol_no' && 'bg-red-50 text-red-400',
                            estado === 'over_si' && 'bg-green-500 text-white',
                            estado === 'over_no' && 'bg-red-500 text-white',
                          )}
                          title={
                            estado === 'rol_si'
                              ? 'Permitido por el rol'
                              : estado === 'rol_no'
                                ? 'Bloqueado por el rol'
                                : estado === 'over_si'
                                  ? 'Override permitido'
                                  : 'Override bloqueado'
                          }
                        >
                          {estado === 'rol_si' || estado === 'over_si' ? (
                            <Check className="h-3 w-3" />
                          ) : estado === 'rol_no' ? (
                            <Minus className="h-3 w-3" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {override && Object.keys(override).length > 0 && onOverrideChange && (
        <Button variant="outline" size="sm" onClick={() => onOverrideChange(undefined)}>
          Quitar todos los overrides
        </Button>
      )}
    </div>
  );
}
