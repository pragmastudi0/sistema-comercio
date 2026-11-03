import { describe, it, expect } from 'vitest';
import {
  evaluarPermisos,
  tienePermiso,
  makePuede,
  PERMISOS_PRESET,
  type PermisosConfig,
} from './permisos';

describe('PERMISOS_PRESET', () => {
  it('admin tiene todos los módulos en true', () => {
    expect(PERMISOS_PRESET.admin.ventas?.crear).toBe(true);
    expect(PERMISOS_PRESET.admin.empleados?.eliminar).toBe(true);
    expect(PERMISOS_PRESET.admin.configuracion?.gestionar_empresa).toBe(true);
    expect(PERMISOS_PRESET.admin.reportes?.ver_global).toBe(true);
  });

  it('cajero solo puede operar caja y ventas básicas', () => {
    expect(PERMISOS_PRESET.cajero.ventas?.crear).toBe(true);
    expect(PERMISOS_PRESET.cajero.caja?.abrir).toBe(true);
    expect(PERMISOS_PRESET.cajero.empleados).toBeUndefined();
    expect(PERMISOS_PRESET.cajero.roles).toBeUndefined();
  });

  it('encargado tiene permisos extendidos pero no de configuración', () => {
    expect(PERMISOS_PRESET.encargado.ventas?.anular_ajena_del_dia).toBe(true);
    expect(PERMISOS_PRESET.encargado.productos?.crear).toBe(true);
    expect(PERMISOS_PRESET.encargado.configuracion).toBeUndefined();
  });

  it('catálogo se enfoca en productos y categorías (con acceso a Cobrar desde toolbar admin)', () => {
    expect(PERMISOS_PRESET.catalogo.productos?.crear).toBe(true);
    expect(PERMISOS_PRESET.catalogo.productos?.gestionar_atributos).toBe(true);
    // Ventas.crear + caja.abrir habilitados para poder usar el PoS via toolbar admin
    // (agregado post go-live iteración 1). Reportes/configuración siguen bloqueados.
    expect(PERMISOS_PRESET.catalogo.ventas?.crear).toBe(true);
    expect(PERMISOS_PRESET.catalogo.caja?.abrir).toBe(true);
    expect(PERMISOS_PRESET.catalogo.reportes).toBeUndefined();
    expect(PERMISOS_PRESET.catalogo.configuracion).toBeUndefined();
  });
});

describe('evaluarPermisos', () => {
  const ROL_CAJERO: PermisosConfig = {
    ventas: { crear: true, descuento_manual: false },
    caja: { abrir: true, cerrar: true },
  };

  it('sin override devuelve los mismos permisos del rol', () => {
    expect(evaluarPermisos(ROL_CAJERO)).toEqual(ROL_CAJERO);
  });

  it('override agrega o cambia acciones de un módulo existente', () => {
    const override: PermisosConfig = {
      ventas: { descuento_manual: true, modificar_precio_unitario: true },
    };
    const efectivo = evaluarPermisos(ROL_CAJERO, override);
    expect(efectivo.ventas?.crear).toBe(true);
    expect(efectivo.ventas?.descuento_manual).toBe(true);
    expect(efectivo.ventas?.modificar_precio_unitario).toBe(true);
    expect(efectivo.caja?.abrir).toBe(true);
  });

  it('override agrega un módulo nuevo sin pisar los existentes', () => {
    const override: PermisosConfig = { reportes: { ver_caja_propia: true } };
    const efectivo = evaluarPermisos(ROL_CAJERO, override);
    expect(efectivo.reportes?.ver_caja_propia).toBe(true);
    expect(efectivo.ventas?.crear).toBe(true);
  });

  it('override puede bloquear (false) algo que el rol permitía', () => {
    const override: PermisosConfig = { ventas: { crear: false } };
    const efectivo = evaluarPermisos(ROL_CAJERO, override);
    expect(efectivo.ventas?.crear).toBe(false);
  });
});

describe('tienePermiso', () => {
  const p: PermisosConfig = {
    ventas: { crear: true, anular_propia_del_dia: false },
  };

  it('devuelve true solo cuando la acción es exactamente true', () => {
    expect(tienePermiso(p, 'ventas', 'crear')).toBe(true);
  });

  it('devuelve false cuando es false', () => {
    expect(tienePermiso(p, 'ventas', 'anular_propia_del_dia')).toBe(false);
  });

  it('devuelve false cuando la acción no está definida', () => {
    expect(tienePermiso(p, 'ventas', 'vender_sin_stock')).toBe(false);
    expect(tienePermiso(p, 'empleados', 'crear')).toBe(false);
  });
});

describe('makePuede', () => {
  it('crea un helper cerrado sobre los permisos', () => {
    const puede = makePuede({ ventas: { crear: true } });
    expect(puede('ventas', 'crear')).toBe(true);
    expect(puede('ventas', 'descuento_manual')).toBe(false);
    expect(puede('empleados', 'crear')).toBe(false);
  });
});
