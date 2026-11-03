import { describe, it, expect } from 'vitest';
import { calcularPrecioMayorista, previewPrecioMayorista } from './mayorista';

describe('calcularPrecioMayorista', () => {
  it('sin ningún % → devuelve precio CF crudo, fuente ninguno', () => {
    const r = calcularPrecioMayorista({ precioCF: 1000 });
    expect(r.precio).toBe(1000);
    expect(r.pctAplicado).toBe(0);
    expect(r.fuente).toBe('ninguno');
    expect(r.ahorroUnitario).toBe(0);
  });

  it('usa el global cuando no hay override', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoGlobalPct: 30,
    });
    expect(r.precio).toBe(700);
    expect(r.pctAplicado).toBe(30);
    expect(r.fuente).toBe('global');
    expect(r.ahorroUnitario).toBe(300);
  });

  it('override > 0 gana sobre global', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoOverridePct: 45,
      descuentoGlobalPct: 30,
    });
    expect(r.precio).toBe(550);
    expect(r.pctAplicado).toBe(45);
    expect(r.fuente).toBe('override');
  });

  it('override = 0 se considera "no seteado" y cae al global', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoOverridePct: 0,
      descuentoGlobalPct: 30,
    });
    expect(r.pctAplicado).toBe(30);
    expect(r.fuente).toBe('global');
  });

  it('override null cae al global', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoOverridePct: null,
      descuentoGlobalPct: 25,
    });
    expect(r.pctAplicado).toBe(25);
    expect(r.fuente).toBe('global');
  });

  it('clampea % negativos a 0 y > 100 a 100', () => {
    const r1 = calcularPrecioMayorista({ precioCF: 1000, descuentoGlobalPct: -10 });
    expect(r1.pctAplicado).toBe(0);

    const r2 = calcularPrecioMayorista({ precioCF: 1000, descuentoGlobalPct: 150 });
    expect(r2.pctAplicado).toBe(100);
    expect(r2.precio).toBe(0);
  });

  it('aplica escala por cantidad cuando supera el pct base', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoGlobalPct: 30,
      escalas: [
        { desde: 10, pct: 35 },
        { desde: 30, pct: 40 },
      ],
      cantidad: 12,
    });
    expect(r.pctAplicado).toBe(35);
    expect(r.fuente).toBe('escala');
    expect(r.precio).toBe(650);
  });

  it('usa la escala con mayor `desde` <= cantidad', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoGlobalPct: 30,
      escalas: [
        { desde: 10, pct: 35 },
        { desde: 30, pct: 40 },
      ],
      cantidad: 50,
    });
    expect(r.pctAplicado).toBe(40);
    expect(r.fuente).toBe('escala');
  });

  it('escala no aplica si su pct es menor que el base', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoGlobalPct: 50,
      escalas: [{ desde: 10, pct: 20 }],
      cantidad: 20,
    });
    expect(r.pctAplicado).toBe(50);
    expect(r.fuente).toBe('global');
  });

  it('cantidad < menor `desde` → sin escala', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoGlobalPct: 30,
      escalas: [{ desde: 10, pct: 40 }],
      cantidad: 5,
    });
    expect(r.pctAplicado).toBe(30);
    expect(r.fuente).toBe('global');
  });

  it('tolera escalas desordenadas', () => {
    const r = calcularPrecioMayorista({
      precioCF: 1000,
      descuentoGlobalPct: 30,
      escalas: [
        { desde: 30, pct: 40 },
        { desde: 10, pct: 35 },
      ],
      cantidad: 12,
    });
    expect(r.pctAplicado).toBe(35);
  });

  it('redondeo entero', () => {
    const r = calcularPrecioMayorista({
      precioCF: 999,
      descuentoGlobalPct: 33,
      redondeo: 'entero',
    });
    expect(Number.isInteger(r.precio)).toBe(true);
    expect(r.precio).toBe(669);
  });

  it('previewPrecioMayorista devuelve la misma info core', () => {
    const p = previewPrecioMayorista(1000, null, 30);
    expect(p.precio).toBe(700);
    expect(p.pctAplicado).toBe(30);
  });
});
