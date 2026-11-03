import { PERMISOS_PRESET } from '@comercio/business/permisos';
import type { Store } from './store';

const EMPRESA_ID = 'emp_demo';
const NOW = new Date('2026-05-13T08:00:00.000Z').toISOString();

const CATS: Array<{ id: string; nombre: string }> = [
  { id: 'cat_tec', nombre: 'Tecnología' },
  { id: 'cat_baz', nombre: 'Bazar' },
  { id: 'cat_bel', nombre: 'Belleza' },
  { id: 'cat_jug', nombre: 'Juguetes' },
  { id: 'cat_pap', nombre: 'Papelería' },
  { id: 'cat_via', nombre: 'Artículos de viaje' },
];

// 50 productos sintéticos con códigos internos 4-5 dígitos.
function seedProductos(): { productos: Store['productos']; precios: Store['productoListaPrecio']; stock: Store['stock'] } {
  const productos: Store['productos'] = [];
  const precios: Store['productoListaPrecio'] = [];
  const stock: Store['stock'] = [];

  const muestras: Array<{ nombre: string; cat: string; costo: number; precio: number }> = [
    { nombre: 'Auriculares bluetooth genéricos', cat: 'cat_tec', costo: 4500, precio: 8990 },
    { nombre: 'Cable USB-C 1m', cat: 'cat_tec', costo: 800, precio: 2490 },
    { nombre: 'Cargador 20W USB-C', cat: 'cat_tec', costo: 3200, precio: 6990 },
    { nombre: 'Power bank 10000mAh', cat: 'cat_tec', costo: 8500, precio: 16990 },
    { nombre: 'Soporte celular auto', cat: 'cat_tec', costo: 1500, precio: 3990 },
    { nombre: 'Manos libres con micrófono', cat: 'cat_tec', costo: 1200, precio: 2990 },
    { nombre: 'Pendrive 32GB', cat: 'cat_tec', costo: 2400, precio: 5990 },
    { nombre: 'Pendrive 64GB', cat: 'cat_tec', costo: 3600, precio: 7990 },
    { nombre: 'Auriculares con cable', cat: 'cat_tec', costo: 600, precio: 1990 },
    { nombre: 'Adaptador OTG', cat: 'cat_tec', costo: 400, precio: 1490 },
    { nombre: 'Termo acero 1L', cat: 'cat_baz', costo: 6500, precio: 13990 },
    { nombre: 'Mate de plástico', cat: 'cat_baz', costo: 800, precio: 2490 },
    { nombre: 'Bombilla acero', cat: 'cat_baz', costo: 500, precio: 1490 },
    { nombre: 'Yerba 500g', cat: 'cat_baz', costo: 1100, precio: 2290 },
    { nombre: 'Yerba 1kg', cat: 'cat_baz', costo: 2000, precio: 3990 },
    { nombre: 'Vaso térmico', cat: 'cat_baz', costo: 1800, precio: 4490 },
    { nombre: 'Encendedor recargable', cat: 'cat_baz', costo: 700, precio: 1990 },
    { nombre: 'Cuchillo viajero', cat: 'cat_baz', costo: 1200, precio: 3290 },
    { nombre: 'Cubiertos plegables', cat: 'cat_baz', costo: 900, precio: 2490 },
    { nombre: 'Lonchera térmica', cat: 'cat_baz', costo: 2500, precio: 5990 },
    { nombre: 'Crema de manos 100ml', cat: 'cat_bel', costo: 600, precio: 1690 },
    { nombre: 'Bálsamo labial', cat: 'cat_bel', costo: 250, precio: 790 },
    { nombre: 'Cepillo de cabello', cat: 'cat_bel', costo: 800, precio: 2290 },
    { nombre: 'Set de manicura', cat: 'cat_bel', costo: 1400, precio: 3490 },
    { nombre: 'Espejo de bolsillo', cat: 'cat_bel', costo: 400, precio: 1290 },
    { nombre: 'Desodorante en barra', cat: 'cat_bel', costo: 900, precio: 2390 },
    { nombre: 'Shampoo viaje 100ml', cat: 'cat_bel', costo: 700, precio: 1990 },
    { nombre: 'Acondicionador viaje 100ml', cat: 'cat_bel', costo: 700, precio: 1990 },
    { nombre: 'Toallas húmedas pack', cat: 'cat_bel', costo: 600, precio: 1690 },
    { nombre: 'Repelente de insectos', cat: 'cat_bel', costo: 1100, precio: 2890 },
    { nombre: 'Pelota antiestrés', cat: 'cat_jug', costo: 500, precio: 1490 },
    { nombre: 'Yo-yo clásico', cat: 'cat_jug', costo: 600, precio: 1790 },
    { nombre: 'Cubo Rubik', cat: 'cat_jug', costo: 1500, precio: 3990 },
    { nombre: 'Cartas españolas', cat: 'cat_jug', costo: 800, precio: 2490 },
    { nombre: 'Cartas inglesas', cat: 'cat_jug', costo: 800, precio: 2490 },
    { nombre: 'Cuaderno A5', cat: 'cat_pap', costo: 600, precio: 1690 },
    { nombre: 'Cuaderno A4', cat: 'cat_pap', costo: 900, precio: 2490 },
    { nombre: 'Bolígrafo BIC azul', cat: 'cat_pap', costo: 150, precio: 490 },
    { nombre: 'Bolígrafo BIC negro', cat: 'cat_pap', costo: 150, precio: 490 },
    { nombre: 'Lápiz HB', cat: 'cat_pap', costo: 100, precio: 290 },
    { nombre: 'Goma de borrar', cat: 'cat_pap', costo: 80, precio: 290 },
    { nombre: 'Resaltador amarillo', cat: 'cat_pap', costo: 400, precio: 990 },
    { nombre: 'Sobre A4', cat: 'cat_pap', costo: 60, precio: 190 },
    { nombre: 'Postal Córdoba', cat: 'cat_pap', costo: 100, precio: 490 },
    { nombre: 'Cargador portátil', cat: 'cat_via', costo: 5500, precio: 11990 },
    { nombre: 'Almohada de cuello', cat: 'cat_via', costo: 1800, precio: 4490 },
    { nombre: 'Antifaz para dormir', cat: 'cat_via', costo: 600, precio: 1790 },
    { nombre: 'Tapones para oídos', cat: 'cat_via', costo: 300, precio: 990 },
    { nombre: 'Manta polar viaje', cat: 'cat_via', costo: 2500, precio: 5990 },
    { nombre: 'Candado de combinación', cat: 'cat_via', costo: 1500, precio: 3490 },
  ];

  muestras.forEach((m, i) => {
    const id = `prod_${i + 1}`;
    const codigo = (1000 + i).toString(); // 4 dígitos: 1000..1049
    productos.push({
      id,
      codigo_interno: codigo,
      nombre: m.nombre,
      categoria_id: m.cat,
      costo: m.costo,
      publicado_web: true,
      activo: true,
      creado_en: NOW,
    });
    // Precio plano (escala única desde 1) en la lista "Consumidor Final"
    precios.push({
      producto_id: id,
      lista_precio_id: 'lp_cf',
      escalas: [{ desde: 1, precio: m.precio }],
    });
    // Algunos productos con precio mayorista a partir de 12 unidades
    precios.push({
      producto_id: id,
      lista_precio_id: 'lp_may',
      escalas: [
        { desde: 1, precio: m.precio },
        { desde: 12, precio: Math.round(m.precio * 0.85) },
      ],
    });
    // Stock inicial repartido: 80% al depósito Central, 20% a Local Terminal 1
    const stockInicial = 20 + ((i * 7) % 30);
    stock.push({ producto_id: id, deposito_id: 'dep_central', cantidad: Math.round(stockInicial * 0.8) });
    stock.push({ producto_id: id, deposito_id: 'dep_local_1', cantidad: Math.round(stockInicial * 0.2) });
  });

  return { productos, precios, stock };
}

export function buildSeed(): Store {
  const { productos, precios, stock } = seedProductos();

  return {
    empresa: {
      id: EMPRESA_ID,
      nombre: 'Comercio Demo',
    },
    locales: [
      { id: 'loc_1', empresa_id: EMPRESA_ID, nombre: 'Sucursal Centro', activo: true },
      { id: 'loc_2', empresa_id: EMPRESA_ID, nombre: 'Sucursal Norte', activo: true },
    ],
    depositos: [
      { id: 'dep_central', empresa_id: EMPRESA_ID, nombre: 'Depósito Central', tipo: 'central', activo: true },
      { id: 'dep_local_1', empresa_id: EMPRESA_ID, nombre: 'Sucursal Centro', tipo: 'local', local_id: 'loc_1', activo: true },
      { id: 'dep_local_2', empresa_id: EMPRESA_ID, nombre: 'Sucursal Norte', tipo: 'local', local_id: 'loc_2', activo: true },
      { id: 'dep_web', empresa_id: EMPRESA_ID, nombre: 'Web', tipo: 'web', activo: true },
    ],
    cajas: [
      { id: 'caja_1a', local_id: 'loc_1', nombre: 'Caja 1', activa: true },
      { id: 'caja_1b', local_id: 'loc_1', nombre: 'Caja 2', activa: true },
      { id: 'caja_2a', local_id: 'loc_2', nombre: 'Caja 1', activa: true },
    ],
    roles: [
      { id: 'rol_admin', nombre: 'Admin', preset: true, permisos: PERMISOS_PRESET.admin },
      { id: 'rol_encargado', nombre: 'Encargado', preset: true, permisos: PERMISOS_PRESET.encargado },
      { id: 'rol_cajero', nombre: 'Cajero', preset: true, permisos: PERMISOS_PRESET.cajero },
      { id: 'rol_catalogo', nombre: 'Carga de catálogo', preset: true, permisos: PERMISOS_PRESET.catalogo },
    ],
    empleados: [
      {
        id: 'emp_admin',
        empresa_id: EMPRESA_ID,
        nombre: 'Gonzalo',
        apellido: 'Admin',
        email: 'admin@demo.com',
        rol_id: 'rol_admin',
        activo: true,
        creado_en: NOW,
      },
      {
        id: 'emp_enc',
        empresa_id: EMPRESA_ID,
        nombre: 'Marta',
        apellido: 'Encargada',
        email: 'encargado@demo.com',
        rol_id: 'rol_encargado',
        local_id: 'loc_1',
        deposito_id: 'dep_local_1',
        activo: true,
        creado_en: NOW,
      },
      {
        id: 'emp_caj1',
        empresa_id: EMPRESA_ID,
        nombre: 'Luis',
        apellido: 'Cajero',
        email: 'cajero@demo.com',
        rol_id: 'rol_cajero',
        local_id: 'loc_1',
        deposito_id: 'dep_local_1',
        activo: true,
        creado_en: NOW,
      },
      {
        id: 'emp_cat',
        empresa_id: EMPRESA_ID,
        nombre: 'Sofía',
        apellido: 'Catálogo',
        email: 'catalogo@demo.com',
        rol_id: 'rol_catalogo',
        activo: true,
        creado_en: NOW,
      },
    ],
    categorias: CATS,
    proveedores: [
      { id: 'prov_1', nombre: 'Distribuidora Andina', telefono: '+54 351 555-0001', activo: true },
      { id: 'prov_2', nombre: 'Tech Importadora', telefono: '+54 351 555-0002', activo: true },
      { id: 'prov_3', nombre: 'Belleza Mayorista', activo: true },
    ],
    productos,
    variantes: [],
    productoImagenes: [],
    productoListaPrecio: precios,
    listasPrecio: [
      { id: 'lp_cf', nombre: 'Consumidor Final', default: true, activa: true },
      { id: 'lp_may', nombre: 'Mayorista', default: false, activa: true },
    ],
    stock,
    movimientosStock: [],
    transferencias: [],
    clientes: [
      {
        id: 'cli_1',
        nombre: 'Juan',
        apellido: 'Pérez',
        dni: '30123456',
        telefono: '+54 351 555-1001',
        lista_precio_id: 'lp_cf',
        saldo: 0,
        suspendido: false,
        activo: true,
        creado_en: NOW,
      },
      {
        id: 'cli_2',
        nombre: 'María',
        apellido: 'González',
        dni: '28987654',
        lista_precio_id: 'lp_cf',
        saldo: 12500, // tiene deuda
        suspendido: false,
        activo: true,
        creado_en: NOW,
      },
      {
        id: 'cli_3',
        nombre: 'Carlos',
        apellido: 'Rodríguez',
        lista_precio_id: 'lp_may',
        saldo: 0,
        suspendido: false,
        activo: true,
        creado_en: NOW,
      },
      {
        id: 'cli_4',
        nombre: 'Ana',
        apellido: 'Martínez',
        dni: '35111222',
        telefono: '+54 351 555-1003',
        lista_precio_id: 'lp_cf',
        saldo: 0,
        suspendido: false,
        activo: true,
        creado_en: NOW,
      },
      {
        id: 'cli_5',
        nombre: 'Roberto',
        apellido: 'Silva',
        lista_precio_id: 'lp_cf',
        saldo: -2500, // saldo a favor
        suspendido: false,
        activo: true,
        creado_en: NOW,
      },
    ],
    movimientosCtaCte: [
      {
        id: 'mov_cc_1',
        cliente_id: 'cli_2',
        tipo: 'cargo',
        monto: 12500,
        fecha: NOW,
        empleado_id: 'emp_caj1',
        nota: 'Saldo inicial migrado',
      },
      {
        id: 'mov_cc_2',
        cliente_id: 'cli_5',
        tipo: 'pago',
        monto: 2500,
        metodo_pago: 'efectivo',
        fecha: NOW,
        empleado_id: 'emp_caj1',
        nota: 'Saldo a favor inicial',
      },
    ],
    sesionesCaja: [],
    movimientosCaja: [],
    ventas: [],
    configuracion: {
      empresa_id: EMPRESA_ID,
      descuento_efectivo_pct: 10,
      cuotas: [
        { cuotas: 1, recargo_pct: 0 },
        { cuotas: 3, recargo_pct: 12 },
        { cuotas: 6, recargo_pct: 25 },
        { cuotas: 12, recargo_pct: 55 },
      ],
      validez_presupuesto_dias: 7,
      permitir_venta_sin_stock_default: false,
      comercio: {
        razon_social: 'Comercio Demo',
        cuit: '30-12345678-9',
        direccion: 'Av. Principal 1234, Ciudad',
        telefono: '+54 9 11 1234-5678',
        email: 'contacto@demo.com',
        horario: 'Lun a Sáb 8:00 a 22:00',
      },
      pedido_minimo_web: 0,
      mensaje_wa_template: '',
    },
    notasCredito: [],
    contadorNotasCredito: 0,
    auditoria: [],
    contadorVentas: 0,
    passwords: {
      emp_admin: 'admin123',
      emp_enc: 'encargado123',
      emp_caj1: 'cajero123',
      emp_cat: 'catalogo123',
    },
  };
}
