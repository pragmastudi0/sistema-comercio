import { describe, it, expect } from 'vitest';
import { productoSchema, clienteSchema, empleadoSchema } from './validators';

describe('productoSchema', () => {
  const valido = {
    codigo_interno: '1234',
    nombre: 'Cargador',
    categoria_id: 'cat_tec',
    costo: 100,
  };

  it('acepta un producto válido y aplica los defaults', () => {
    const r = productoSchema.parse(valido);
    expect(r.activo).toBe(true);
    expect(r.publicado_web).toBe(false);
    expect(r.costo).toBe(100);
  });

  it('rechaza código no numérico', () => {
    expect(() => productoSchema.parse({ ...valido, codigo_interno: 'ABC1' })).toThrow();
  });

  it('rechaza código de más de 5 dígitos', () => {
    expect(() => productoSchema.parse({ ...valido, codigo_interno: '123456' })).toThrow();
  });

  it('acepta código de 1 a 5 dígitos', () => {
    expect(productoSchema.parse({ ...valido, codigo_interno: '1' })).toBeTruthy();
    expect(productoSchema.parse({ ...valido, codigo_interno: '12345' })).toBeTruthy();
  });

  it('rechaza nombre vacío', () => {
    expect(() => productoSchema.parse({ ...valido, nombre: '' })).toThrow();
  });

  it('rechaza costo negativo', () => {
    expect(() => productoSchema.parse({ ...valido, costo: -10 })).toThrow();
  });
});

describe('clienteSchema', () => {
  const valido = {
    nombre: 'Juan',
    apellido: 'Pérez',
    lista_precio_id: 'lp_cf',
  };

  it('acepta un cliente válido sin DNI ni email', () => {
    const r = clienteSchema.parse(valido);
    expect(r.nombre).toBe('Juan');
  });

  it('acepta DNI numérico de 6 a 9 dígitos', () => {
    expect(clienteSchema.parse({ ...valido, dni: '12345678' })).toBeTruthy();
    expect(clienteSchema.parse({ ...valido, dni: '123456' })).toBeTruthy();
  });

  it('acepta DNI vacío', () => {
    expect(clienteSchema.parse({ ...valido, dni: '' })).toBeTruthy();
  });

  it('rechaza DNI con letras', () => {
    expect(() => clienteSchema.parse({ ...valido, dni: '12ABC678' })).toThrow();
  });

  it('rechaza email mal formado pero acepta vacío', () => {
    expect(clienteSchema.parse({ ...valido, email: '' })).toBeTruthy();
    expect(() => clienteSchema.parse({ ...valido, email: 'no-es-email' })).toThrow();
    expect(clienteSchema.parse({ ...valido, email: 'a@b.com' })).toBeTruthy();
  });
});

describe('empleadoSchema', () => {
  it('rechaza email inválido', () => {
    expect(() =>
      empleadoSchema.parse({
        nombre: 'X',
        apellido: 'Y',
        email: 'no-es-email',
        rol_id: 'rol_admin',
      }),
    ).toThrow();
  });

  it('acepta empleado mínimo válido', () => {
    const r = empleadoSchema.parse({
      nombre: 'Marta',
      apellido: 'Encargada',
      email: 'marta@comercio.com.ar',
      rol_id: 'rol_encargado',
    });
    expect(r.activo).toBe(true);
  });
});
