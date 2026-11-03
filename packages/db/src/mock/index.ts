import type { DbClient } from '../client';
import { buildSeed } from './seed';
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

/**
 * DB cliente in-memory.
 * Día 4+ se reemplaza por la implementación contra Supabase.
 */
export function createMockClient(): DbClient {
  const store = buildSeed();
  return {
    empresas: makeEmpresasRepo(store),
    productos: makeProductosRepo(store),
    categorias: makeCategoriasRepo(store),
    proveedores: makeProveedoresRepo(store),
    clientes: makeClientesRepo(store),
    ctaCte: makeCtaCteRepo(store),
    empleados: makeEmpleadosRepo(store),
    roles: makeRolesRepo(store),
    locales: makeLocalesRepo(store),
    depositos: makeDepositosRepo(store),
    cajas: makeCajasRepo(store),
    sesionesCaja: makeSesionesCajaRepo(store),
    stock: makeStockRepo(store),
    transferencias: makeTransferenciasRepo(store),
    listasPrecio: makeListasPrecioRepo(store),
    ventas: makeVentasRepo(store),
    notasCredito: makeNotasCreditoRepo(store),
    configuracion: makeConfiguracionRepo(store),
    auditoria: makeAuditoriaRepo(store),
    pedidosWeb: makePedidosWebRepo(store),
  };
}
