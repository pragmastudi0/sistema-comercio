import { describe, it, expect } from 'vitest';
import { saldoEfectivoEsperado, totalesPorMetodo, type SesionCaja } from './caja';

function sesionBase(movimientos: SesionCaja['movimientos'] = []): SesionCaja {
  return {
    id: 'ses_1',
    cajaId: 'caja_1',
    empleadoId: 'emp_1',
    abiertaEn: '2026-01-01T08:00:00Z',
    saldoInicial: 5000,
    movimientos,
  };
}

describe('totalesPorMetodo', () => {
  it('arranca todo en 0', () => {
    const t = totalesPorMetodo(sesionBase());
    expect(t).toEqual({
      efectivo: 0,
      transferencia: 0,
      debito: 0,
      credito: 0,
      qr: 0,
      cta_cte: 0,
    });
  });

  it('suma ventas e ingresos, resta egresos / retiros / anulaciones', () => {
    const t = totalesPorMetodo(
      sesionBase([
        { tipo: 'venta', metodo: 'efectivo', monto: 1000 },
        { tipo: 'venta', metodo: 'debito', monto: 500 },
        { tipo: 'venta', metodo: 'efectivo', monto: 200 },
        { tipo: 'ingreso', metodo: 'efectivo', monto: 300 },
        { tipo: 'egreso', metodo: 'efectivo', monto: 100 },
        { tipo: 'retiro', metodo: 'efectivo', monto: 400 },
        { tipo: 'anulacion', metodo: 'debito', monto: 500 },
      ]),
    );
    expect(t.efectivo).toBe(1000 + 200 + 300 - 100 - 400);
    expect(t.debito).toBe(500 - 500);
  });

  it('agrupa correctamente por método', () => {
    const t = totalesPorMetodo(
      sesionBase([
        { tipo: 'venta', metodo: 'credito', monto: 12000 },
        { tipo: 'venta', metodo: 'qr', monto: 800 },
        { tipo: 'venta', metodo: 'cta_cte', monto: 5000 },
      ]),
    );
    expect(t.credito).toBe(12000);
    expect(t.qr).toBe(800);
    expect(t.cta_cte).toBe(5000);
    expect(t.efectivo).toBe(0);
  });
});

describe('saldoEfectivoEsperado', () => {
  it('es el saldo inicial cuando no hay movimientos', () => {
    expect(saldoEfectivoEsperado(sesionBase())).toBe(5000);
  });

  it('suma ventas y resta retiros en efectivo', () => {
    expect(
      saldoEfectivoEsperado(
        sesionBase([
          { tipo: 'venta', metodo: 'efectivo', monto: 2000 },
          { tipo: 'venta', metodo: 'efectivo', monto: 500 },
          { tipo: 'retiro', metodo: 'efectivo', monto: 1000 },
        ]),
      ),
    ).toBe(5000 + 2000 + 500 - 1000);
  });

  it('ignora pagos no efectivo en el cálculo del efectivo esperado', () => {
    expect(
      saldoEfectivoEsperado(
        sesionBase([
          { tipo: 'venta', metodo: 'efectivo', monto: 1000 },
          { tipo: 'venta', metodo: 'debito', monto: 5000 },
          { tipo: 'venta', metodo: 'qr', monto: 3000 },
        ]),
      ),
    ).toBe(5000 + 1000);
  });
});
