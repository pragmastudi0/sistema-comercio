import type { ID, ListaPrecio } from '../types';

export type ListasPrecioRepo = {
  list(): Promise<ListaPrecio[]>;
  get(id: ID): Promise<ListaPrecio | null>;
  /** Lista de precios default (Consumidor Final) de una empresa.
   *  Reemplaza al UUID fijo `PRESET_IDS.listas.consumidorFinal` + el hack `'lp_cf'`:
   *  en multi-empresa cada empresa tiene su propia lista default (es_default=true). */
  listaDefaultDe(empresaId: ID): Promise<ListaPrecio | null>;
  create(input: Omit<ListaPrecio, 'id'>): Promise<ListaPrecio>;
  update(id: ID, patch: Partial<ListaPrecio>): Promise<ListaPrecio>;
  delete(id: ID): Promise<void>;
};
