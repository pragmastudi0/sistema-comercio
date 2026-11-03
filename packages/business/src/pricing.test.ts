import { describe, it, expect } from 'vitest';
import {
  precioPorCantidad,
  aplicarDescuentoEfectivo,
  aplicarRecargoCuotas,
  redondear2,
  type ListaPrecio,
  type ConfigPagos,
} from './pricing';

const LISTA_PLANA: ListaPrecio = {
  id: 'lp',
  nombre: 'Test',
  escalas: [{ desde: 1, precio: 1000 }],
};

const LISTA_ESCALONADA: ListaPrecio = {
  id: 'lp',
  nombre: 'Mayorista',
  escalas: [
    { desde: 1, precio: 1000 },
    { desde: 12, precio: 850 },
    { desde: 50, precio: 700 },
  ],
};

const CONFIG_PAGOS: ConfigPagos = {
  descuentoEfectivoPct: 10,
  cuotas: [
    { cuotas: 1, recargoPct: 0 },
    { cuotas: 3, recargoPct: 12 },
    { cuotas: 6, recargoPct: 25 },
    { cuotas: 12, recargoPct: 55 },
  ],
};

describe('precioPorCantidad', () => {
  it('devuelve 0 cuando la cantidad es 0 o negativa', () => {
    expect(precioPorCantidad(LISTA_PLANA, 0)).toBe(0);
    expect(precioPorCantidad(LISTA_PLANA, -5)).toBe(0);
  });

  it('aplica el precio base para una lista plana', () => {
    expect(precioPorCantidad(LISTA_PLANA, 1)).toBe(1000);
    expect(precioPorCantidad(LISTA_PLANA, 100)).toBe(1000);
  });

  it('aplica la escala correcta según la cantidad', () => {
    expect(precioPorCantidad(LISTA_ESCALONADA, 1)).toBe(1000);
    expect(precioPorCantidad(LISTA_ESCALONADA, 11)).toBe(1000);
    expect(precioPorCantidad(LISTA_ESCALONADA, 12)).toBe(850);
    expect(precioPorCantidad(LISTA_ESCALONADA, 49)).toBe(850);
    expect(precioPorCantidad(LISTA_ESCALONADA, 50)).toBe(700);
    expect(precioPorCantidad(LISTA_ESCALONADA, 100)).toBe(700);
  });

  it('toma la primera escala cuando la cantidad es menor al primer "desde"', () => {
    const lista: ListaPrecio = {
      id: 'lp',
      nombre: 'Custom',
      escalas: [
        { desde: 5, precio: 800 },
        { desde: 20, precio: 600 },
      ],
    };
    expect(precioPorCantidad(lista, 1)).toBe(800);
    expect(precioPorCantidad(lista, 4)).toBe(800);
    expect(precioPorCantidad(lista, 5)).toBe(800);
    expect(precioPorCantidad(lista, 20)).toBe(600);
  });

  it('retorna 0 si la lista no tiene escalas', () => {
    expect(precioPorCantidad({ id: 'x', nombre: 'X', escalas: [] }, 10)).toBe(0);
  });
});

describe('aplicarDescuentoEfectivo', () => {
  it('aplica el porcentaje configurado', () => {
    expect(aplicarDescuentoEfectivo(1000, CONFIG_PAGOS)).toBe(900);
    expect(aplicarDescuentoEfectivo(2500, CONFIG_PAGOS)).toBe(2250);
  });

  it('no aplica descuento si el porcentaje es 0', () => {
    const sinDto: ConfigPagos = { ...CONFIG_PAGOS, descuentoEfectivoPct: 0 };
    expect(aplicarDescuentoEfectivo(1000, sinDto)).toBe(1000);
  });

  it('redondea a 2 decimales', () => {
    expect(aplicarDescuentoEfectivo(333.33, CONFIG_PAGOS)).toBe(300);
    expect(aplicarDescuentoEfectivo(99.99, CONFIG_PAGOS)).toBe(89.99);
  });
});

describe('aplicarRecargoCuotas', () => {
  it('aplica el recargo de la cantidad de cuotas elegida', () => {
    expect(aplicarRecargoCuotas(1000, 1, CONFIG_PAGOS)).toEqual({
      total: 1000,
      recargoPct: 0,
    });
    expect(aplicarRecargoCuotas(1000, 3, CONFIG_PAGOS)).toEqual({
      total: 1120,
      recargoPct: 12,
    });
    expect(aplicarRecargoCuotas(1000, 12, CONFIG_PAGOS)).toEqual({
      total: 1550,
      recargoPct: 55,
    });
  });

  it('si la cantidad de cuotas no está configurada, retorna sin recargo', () => {
    expect(aplicarRecargoCuotas(1000, 99, CONFIG_PAGOS)).toEqual({
      total: 1000,
      recargoPct: 0,
    });
  });
});

describe('redondear2', () => {
  it('redondea correctamente a 2 decimales', () => {
    expect(redondear2(2.346)).toBe(2.35);
    expect(redondear2(2.344)).toBe(2.34);
    expect(redondear2(100)).toBe(100);
    expect(redondear2(0.1 + 0.2)).toBe(0.3); // evita float quirks
    expect(redondear2(99.999)).toBe(100);
  });
});
