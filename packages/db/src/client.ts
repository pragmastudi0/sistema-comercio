import type {
  ProductosRepo,
  CategoriasRepo,
  ProveedoresRepo,
  ClientesRepo,
  CtaCteRepo,
  EmpleadosRepo,
  RolesRepo,
  LocalesRepo,
  DepositosRepo,
  CajasRepo,
  SesionesCajaRepo,
  StockRepo,
  TransferenciasRepo,
  ListasPrecioRepo,
  VentasRepo,
  NotasCreditoRepo,
  ConfiguracionRepo,
  AuditoriaRepo,
  PedidosWebRepo,
  EmpresasRepo,
} from './repos';

/**
 * Fachada única que las apps usan para acceder a datos.
 * Día 1-3: implementada por createMockClient() con datos en memoria.
 * Día 4+: implementada contra Supabase. La UI no cambia.
 */
export type DbClient = {
  empresas: EmpresasRepo;
  productos: ProductosRepo;
  categorias: CategoriasRepo;
  proveedores: ProveedoresRepo;
  clientes: ClientesRepo;
  ctaCte: CtaCteRepo;
  empleados: EmpleadosRepo;
  roles: RolesRepo;
  locales: LocalesRepo;
  depositos: DepositosRepo;
  cajas: CajasRepo;
  sesionesCaja: SesionesCajaRepo;
  stock: StockRepo;
  transferencias: TransferenciasRepo;
  listasPrecio: ListasPrecioRepo;
  ventas: VentasRepo;
  notasCredito: NotasCreditoRepo;
  configuracion: ConfiguracionRepo;
  auditoria: AuditoriaRepo;
  pedidosWeb: PedidosWebRepo;
};
