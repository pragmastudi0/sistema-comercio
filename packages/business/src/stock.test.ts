import { describe, it, expect } from 'vitest';
import { aplicarMovimiento, puedeDescontar } from './stock';

describe('aplicarMovimiento', () => {
  it('descuenta stock en venta', () => {
    expect(aplicarMovimiento(100, { tipo: 'venta', cantidad: 30 })).toBe(70);
  });

  it('suma stock en devolución', () => {
    expect(aplicarMovimiento(50, { tipo: 'devolucion', cantidad: 5 })).toBe(55);
  });

  it('ajuste puede ser positivo o negativo', () => {
    expect(aplicarMovimiento(100, { tipo: 'ajuste', cantidad: 10, motivo: 'ingreso' })).toBe(110);
    expect(aplicarMovimiento(100, { tipo: 'ajuste', cantidad: -5, motivo: 'recuento' })).toBe(95);
  });

  it('merma descuenta', () => {
    expect(aplicarMovimiento(100, { tipo: 'merma', cantidad: 3, motivo: 'rotura' })).toBe(97);
  });

  it('transferencia_salida descuenta del origen', () => {
    expect(
      aplicarMovimiento(100, {
        tipo: 'transferencia_salida',
        cantidad: 25,
        depositoDestino: 'dep_b',
      }),
    ).toBe(75);
  });

  it('transferencia_entrada suma al destino', () => {
    expect(
      aplicarMovimiento(50, {
        tipo: 'transferencia_entrada',
        cantidad: 25,
        depositoOrigen: 'dep_a',
      }),
    ).toBe(75);
  });
});

describe('puedeDescontar', () => {
  it('permite descontar si hay stock suficiente', () => {
    expect(puedeDescontar(10, 3, false)).toBe(true);
    expect(puedeDescontar(10, 10, false)).toBe(true);
  });

  it('rechaza si el stock es insuficiente y no se permite sin stock', () => {
    expect(puedeDescontar(5, 10, false)).toBe(false);
  });

  it('permite descontar sin stock si está habilitado', () => {
    expect(puedeDescontar(0, 5, true)).toBe(true);
    expect(puedeDescontar(-3, 5, true)).toBe(true);
  });

  it('rechaza cantidades inválidas', () => {
    expect(puedeDescontar(100, 0, false)).toBe(false);
    expect(puedeDescontar(100, -1, false)).toBe(false);
    expect(puedeDescontar(100, 0, true)).toBe(false);
  });
});
