import type { DbClient } from '../client';
import { createSupabaseRaw, type SupabaseClient } from './client';
import { makeEmpresasRepo } from './repos/empresas.repo';
import { makeProductosRepo } from './repos/productos.repo';
import { makeCategoriasRepo } from './repos/categorias.repo';
import { makeProveedoresRepo } from './repos/proveedores.repo';
import { makeClientesRepo } from './repos/clientes.repo';
import { makeCtaCteRepo } from './repos/ctacte.repo';
import { makeEmpleadosRepo } from './repos/empleados.repo';
import { makeRolesRepo } from './repos/roles.repo';
import { makeLocalesRepo } from './repos/locales.repo';
import { makeDepositosRepo } from './repos/depositos.repo';
import { makeCajasRepo } from './repos/cajas.repo';
import { makeSesionesCajaRepo } from './repos/sesiones-caja.repo';
import { makeStockRepo } from './repos/stock.repo';
import { makeTransferenciasRepo } from './repos/transferencias.repo';
import { makeListasPrecioRepo } from './repos/listas-precio.repo';
import { makeVentasRepo } from './repos/ventas.repo';
import { makeNotasCreditoRepo } from './repos/notas-credito.repo';
import { makeConfiguracionRepo } from './repos/configuracion.repo';
import { makeAuditoriaRepo } from './repos/auditoria.repo';
import { makePedidosWebRepo } from './repos/pedidos-web.repo';

export { PRESET_IDS } from './preset-ids';

/** Ensambla un DbClient que opera contra Supabase. */
export function createSupabaseClient(url: string, anonKey: string): DbClient {
  const sb = createSupabaseRaw(url, anonKey);
  return wrapSupabase(sb);
}

/** Igual pero recibe un SupabaseClient ya construido (útil para tests). */
export function wrapSupabase(sb: SupabaseClient): DbClient {
  return {
    empresas: makeEmpresasRepo(sb),
    productos: makeProductosRepo(sb),
    categorias: makeCategoriasRepo(sb),
    proveedores: makeProveedoresRepo(sb),
    clientes: makeClientesRepo(sb),
    ctaCte: makeCtaCteRepo(sb),
    empleados: makeEmpleadosRepo(sb),
    roles: makeRolesRepo(sb),
    locales: makeLocalesRepo(sb),
    depositos: makeDepositosRepo(sb),
    cajas: makeCajasRepo(sb),
    sesionesCaja: makeSesionesCajaRepo(sb),
    stock: makeStockRepo(sb),
    transferencias: makeTransferenciasRepo(sb),
    listasPrecio: makeListasPrecioRepo(sb),
    ventas: makeVentasRepo(sb),
    notasCredito: makeNotasCreditoRepo(sb),
    configuracion: makeConfiguracionRepo(sb),
    auditoria: makeAuditoriaRepo(sb),
    pedidosWeb: makePedidosWebRepo(sb),
  };
}
