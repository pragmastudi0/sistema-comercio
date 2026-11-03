// Helpers locales para los mocks. No depende del runtime de Node.
let counter = 0;
export function makeId(prefix = 'id'): string {
  counter += 1;
  // No usamos crypto.randomUUID para mantener el mock estable y determinista.
  return `${prefix}_${counter.toString(36)}_${Date.now().toString(36)}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function delay<T>(value: T, ms = 0): Promise<T> {
  if (ms <= 0) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function notFound(entidad: string, id: string): Error {
  return new Error(`${entidad} no encontrado: ${id}`);
}
