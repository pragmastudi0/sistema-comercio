import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfiguracionRepo } from '../../repos/configuracion.repo';
import type { ConfiguracionEmpresa } from '../../types';
import { ok } from '../helpers';

export function makeConfiguracionRepo(sb: SupabaseClient): ConfiguracionRepo {
  return {
    async get(empresaId) {
      const { data, error } = await sb
        .from('configuracion_empresa')
        .select('*')
        .eq('empresa_id', empresaId)
        .maybeSingle();
      if (error) throw new Error(`configuracion.get: ${error.message}`);
      if (!data) {
        // Defaults razonables si no hay fila
        return {
          empresa_id: empresaId,
          descuento_efectivo_pct: 0,
          cuotas: [],
          validez_presupuesto_dias: 7,
          permitir_venta_sin_stock_default: false,
        };
      }
      return data as ConfiguracionEmpresa;
    },
    async update(empresaId, patch) {
      return ok<ConfiguracionEmpresa>(
        await sb
          .from('configuracion_empresa')
          .upsert({ empresa_id: empresaId, ...patch })
          .select('*')
          .single(),
        'configuracion.update',
      );
    },
  };
}
