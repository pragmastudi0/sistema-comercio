// Sistema de permisos granulares.
// Permiso efectivo = permisos del rol + overrides del usuario.
// Cada acción es opcional (tri-estado: true / false / undefined = hereda).

export type PermisosConfig = {
  ventas?: {
    crear?: boolean;
    anular_propia_del_dia?: boolean;
    anular_ajena_del_dia?: boolean;
    anular_otros_dias?: boolean;
    descuento_manual?: boolean;
    modificar_precio_unitario?: boolean;
    vender_sin_stock?: boolean;
    vender_cuenta_corriente?: boolean;
  };
  caja?: {
    abrir?: boolean;
    cerrar?: boolean;
    ver_propia?: boolean;
    ver_otras_del_local?: boolean;
    ver_otras_de_otros_locales?: boolean;
    ingreso_efectivo?: boolean;
    egreso_efectivo?: boolean;
    retiro_efectivo?: boolean;
  };
  productos?: {
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    eliminar?: boolean;
    modificar_precio?: boolean;
    modificar_costo?: boolean;
    aumento_masivo?: boolean;
    importar?: boolean;
    gestionar_atributos?: boolean;
    publicar_ecommerce?: boolean;
    // Visibilidad de finanzas en el admin (NO afecta al PoS). Default true.
    // Solo Agus (admin) puede tildar/destildar a otros roles desde /admin/roles
    // para esconder estos campos en la pantalla de productos y el modal de
    // cargar stock.
    ver_costo?: boolean;
    ver_margen?: boolean;
    ver_precio_venta?: boolean;
    /** Editar codigo_interno de un producto existente. Peligroso: si un
     * cajero memorizó el código viejo, deja de encontrar el producto. Default
     * true SÓLO en admin. Se puede otorgar puntualmente a un empleado desde
     * /admin/empleados (permisos override) — típicamente Pragma Soporte para
     * arreglar errores de importación. */
    modificar_codigo?: boolean;
  };
  categorias?: {
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    eliminar?: boolean;
  };
  clientes?: {
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    eliminar?: boolean;
    suspender?: boolean;
    cambiar_lista_precio?: boolean;
  };
  cuenta_corriente?: {
    ver?: boolean;
    registrar_pago?: boolean;
    modificar_limite?: boolean;
    condonar_deuda?: boolean;
  };
  stock?: {
    ver_propio_deposito?: boolean;
    ver_todos_depositos?: boolean;
    ajustar?: boolean;
    transferir?: boolean;
    aprobar_transferencia?: boolean;
    registrar_merma?: boolean;
  };
  proveedores?: {
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    eliminar?: boolean;
  };
  listas_precio?: {
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    eliminar?: boolean;
  };
  reportes?: {
    ver_caja_propia?: boolean;
    ver_local_propio?: boolean;
    ver_otros_locales?: boolean;
    ver_global?: boolean;
    ver_ganancia?: boolean;
    ver_costos?: boolean;
  };
  empleados?: {
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    eliminar?: boolean;
    cambiar_rol?: boolean;
    cambiar_permisos?: boolean;
    asignar_deposito?: boolean;
    asignar_local?: boolean;
  };
  roles?: {
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    eliminar?: boolean;
  };
  configuracion?: {
    ver?: boolean;
    modificar_recargos?: boolean;
    modificar_descuentos?: boolean;
    modificar_general?: boolean;
    gestionar_empresa?: boolean;
    backup_restore?: boolean;
  };
  auditoria?: {
    ver?: boolean;
  };
};

export type ModuloPermiso = keyof PermisosConfig;

export type AccionPermiso<M extends ModuloPermiso> = keyof NonNullable<PermisosConfig[M]>;

export type RolPreset = 'admin' | 'encargado' | 'cajero' | 'catalogo';

// Permisos en true para todos los módulos/acciones. Lo usamos para el rol Admin.
const PERMISO_ADMIN: PermisosConfig = {
  ventas: {
    crear: true,
    anular_propia_del_dia: true,
    anular_ajena_del_dia: true,
    anular_otros_dias: true,
    descuento_manual: true,
    modificar_precio_unitario: true,
    vender_sin_stock: true,
    vender_cuenta_corriente: true,
  },
  caja: {
    abrir: true,
    cerrar: true,
    ver_propia: true,
    ver_otras_del_local: true,
    ver_otras_de_otros_locales: true,
    ingreso_efectivo: true,
    egreso_efectivo: true,
    retiro_efectivo: true,
  },
  productos: {
    ver: true,
    crear: true,
    editar: true,
    eliminar: true,
    modificar_precio: true,
    modificar_costo: true,
    modificar_codigo: true,
    aumento_masivo: true,
    importar: true,
    gestionar_atributos: true,
    publicar_ecommerce: true,
    ver_costo: true,
    ver_margen: true,
    ver_precio_venta: true,
  },
  categorias: { ver: true, crear: true, editar: true, eliminar: true },
  clientes: {
    ver: true,
    crear: true,
    editar: true,
    eliminar: true,
    suspender: true,
    cambiar_lista_precio: true,
  },
  cuenta_corriente: {
    ver: true,
    registrar_pago: true,
    modificar_limite: true,
    condonar_deuda: true,
  },
  stock: {
    ver_propio_deposito: true,
    ver_todos_depositos: true,
    ajustar: true,
    transferir: true,
    aprobar_transferencia: true,
    registrar_merma: true,
  },
  proveedores: { ver: true, crear: true, editar: true, eliminar: true },
  listas_precio: { ver: true, crear: true, editar: true, eliminar: true },
  reportes: {
    ver_caja_propia: true,
    ver_local_propio: true,
    ver_otros_locales: true,
    ver_global: true,
    ver_ganancia: true,
    ver_costos: true,
  },
  empleados: {
    ver: true,
    crear: true,
    editar: true,
    eliminar: true,
    cambiar_rol: true,
    cambiar_permisos: true,
    asignar_deposito: true,
    asignar_local: true,
  },
  roles: { ver: true, crear: true, editar: true, eliminar: true },
  configuracion: {
    ver: true,
    modificar_recargos: true,
    modificar_descuentos: true,
    modificar_general: true,
    gestionar_empresa: true,
    backup_restore: true,
  },
  auditoria: { ver: true },
};

export const PERMISOS_PRESET: Record<RolPreset, PermisosConfig> = {
  admin: PERMISO_ADMIN,
  encargado: {
    ventas: {
      crear: true,
      anular_propia_del_dia: true,
      anular_ajena_del_dia: true,
      descuento_manual: true,
      modificar_precio_unitario: true,
      vender_cuenta_corriente: true,
    },
    caja: {
      // Encargado puede ABRIR y operar caja para cobrar en el PoS,
      // pero NO ve las pantallas con números (saldos, sesiones, arqueo
      // de otros). El dueño es el único que ve la plata.
      abrir: true,
      cerrar: true,
      ingreso_efectivo: true,
      egreso_efectivo: true,
    },
    productos: {
      ver: true,
      crear: true,
      editar: true,
      modificar_precio: true,
      importar: true,
      // Por default visibles — Agus puede destildar a este rol desde
      // /admin/roles si quiere esconder costos a los encargados.
      ver_costo: true,
      ver_margen: true,
      ver_precio_venta: true,
    },
    categorias: { ver: true, crear: true, editar: true },
    clientes: {
      ver: true,
      crear: true,
      editar: true,
      suspender: true,
      cambiar_lista_precio: true,
    },
    cuenta_corriente: { ver: true, registrar_pago: true },
    stock: { ver_propio_deposito: true, ajustar: true, registrar_merma: true },
    proveedores: { ver: true, crear: true, editar: true },
    listas_precio: { ver: true },
    // reportes vacío: sin dashboard, sin ganancias, sin historial de ventas.
  },
  cajero: {
    ventas: {
      crear: true,
      anular_propia_del_dia: true,
      // Los cajeros de Turisteando en la práctica operan todos sobre la
      // misma sesión del PoS (nadie hace login formal por cambio de
      // turno), así que las ventas quedan atribuidas al usuario logueado
      // aunque físicamente las haya cobrado otro. Habilitamos anular
      // ajenas del día para que ese caso no bloquee. La UI ya muestra
      // el botón Anular con esta política; la auditoría registra quién
      // hizo la anulación real.
      anular_ajena_del_dia: true,
      descuento_manual: true,
      modificar_precio_unitario: true,
      vender_cuenta_corriente: true,
    },
    caja: {
      abrir: true,
      cerrar: true,
      ver_propia: true,
      ingreso_efectivo: true,
      egreso_efectivo: true,
    },
    productos: { ver: true },
    clientes: { ver: true, crear: true },
    cuenta_corriente: { ver: true, registrar_pago: true },
    stock: { ver_propio_deposito: true },
  },
  catalogo: {
    productos: {
      ver: true,
      crear: true,
      editar: true,
      modificar_precio: true,
      importar: true,
      gestionar_atributos: true,
      publicar_ecommerce: true,
      // Mismo criterio que encargado: por default visible, Agus elige.
      ver_costo: true,
      ver_margen: true,
      ver_precio_venta: true,
    },
    categorias: { ver: true, crear: true, editar: true },
    proveedores: { ver: true, crear: true, editar: true },
    stock: { ver_propio_deposito: true, ver_todos_depositos: true, ajustar: true },
    listas_precio: { ver: true, crear: true, editar: true },
    // Catálogo también puede entrar al PoS desde el botón "Cobrar" del
    // admin (todos los roles del admin lo ven, no sólo el dueño). Para
    // que efectivamente pueda operar damos los permisos mínimos de
    // venta y caja. Sin acceso a números agregados en el admin.
    caja: { abrir: true, cerrar: true, ingreso_efectivo: true, egreso_efectivo: true },
    ventas: {
      crear: true,
      anular_propia_del_dia: true,
      descuento_manual: true,
      modificar_precio_unitario: true,
    },
    clientes: { ver: true, crear: true },
  },
};

/**
 * Combina los permisos de un rol con un override puntual del usuario.
 * El override pisa al rol acción por acción; las acciones no presentes heredan.
 */
export function evaluarPermisos(
  rolPermisos: PermisosConfig,
  override?: PermisosConfig,
): PermisosConfig {
  if (!override) return rolPermisos;

  const resultado: PermisosConfig = {};
  const todasLasClaves = new Set<ModuloPermiso>([
    ...(Object.keys(rolPermisos) as ModuloPermiso[]),
    ...(Object.keys(override) as ModuloPermiso[]),
  ]);

  for (const modulo of todasLasClaves) {
    const rolMod = rolPermisos[modulo];
    const overMod = override[modulo];
    // Mezcla solo las acciones de cada módulo, preservando el resto.
    (resultado as Record<string, unknown>)[modulo] = {
      ...(rolMod ?? {}),
      ...(overMod ?? {}),
    };
  }

  return resultado;
}

/** Devuelve true solo si la acción está explícitamente permitida. */
export function tienePermiso<M extends ModuloPermiso>(
  permisos: PermisosConfig,
  modulo: M,
  accion: AccionPermiso<M>,
): boolean {
  const mod = permisos[modulo] as Record<string, boolean | undefined> | undefined;
  return mod?.[accion as string] === true;
}

/** Helper que construye un `puede('modulo','accion')` ya cerrado sobre los permisos. */
export function makePuede(permisos: PermisosConfig) {
  return function puede<M extends ModuloPermiso>(modulo: M, accion: AccionPermiso<M>): boolean {
    return tienePermiso(permisos, modulo, accion);
  };
}
