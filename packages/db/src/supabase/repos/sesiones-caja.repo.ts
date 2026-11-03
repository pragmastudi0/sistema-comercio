import type { SupabaseClient } from '@supabase/supabase-js';
import type { SesionesCajaRepo } from '../../repos/sesiones-caja.repo';
import type { MovimientoCaja, SesionCaja } from '../../types';
import { ok, okList, okMaybe } from '../helpers';
import { esDemoMode, logDemo, randomUuid } from '../../demo-mode';

function mockSesion(
  caja_id: string,
  empleado_id: string,
  saldo_inicial: number,
): SesionCaja {
  return {
    id: randomUuid(),
    caja_id,
    empleado_id,
    empleado_actual_id: empleado_id,
    estado: 'abierta',
    abierta_en: new Date().toISOString(),
    saldo_inicial,
  } as SesionCaja;
}

export function makeSesionesCajaRepo(sb: SupabaseClient): SesionesCajaRepo {
  return {
    async abrir({ caja_id, empleado_id, saldo_inicial }) {
      if (esDemoMode()) {
        logDemo('sesiones_caja.abrir', { caja_id });
        return mockSesion(caja_id, empleado_id, saldo_inicial);
      }
      // Política Turisteando: permitimos múltiples sesiones abiertas en
      // la misma caja con DISTINTOS empleados (típico: dueño entra a
      // testear o cobrar mientras el cajero también está en la caja, o
      // turnos solapados). El warning amarillo de AbrirCaja avisa al
      // segundo entrante para que coordinen el arqueo. Cada venta queda
      // asociada a la sesión de QUIEN cobró (empleado_id propio), así
      // las cuentas no se mezclan al cierre.
      //
      // Lo único que sí bloqueamos es que el MISMO empleado abra dos
      // sesiones en la misma caja — eso es siempre un error operativo.
      const { data: yaMia } = await sb
        .from('sesiones_caja')
        .select('id')
        .eq('caja_id', caja_id)
        .eq('empleado_id', empleado_id)
        .eq('estado', 'abierta')
        .maybeSingle();
      if (yaMia) throw new Error('Ya tenés una sesión abierta en esta caja');

      return ok<SesionCaja>(
        await sb
          .from('sesiones_caja')
          .insert({ caja_id, empleado_id, saldo_inicial, estado: 'abierta' })
          .select('*')
          .single(),
        'sesiones_caja.abrir',
      );
    },
    async cerrar(id, saldoFinalDeclarado) {
      if (esDemoMode()) {
        logDemo('sesiones_caja.cerrar', { id });
        return {
          id,
          caja_id: randomUuid(),
          empleado_id: randomUuid(),
          empleado_actual_id: randomUuid(),
          estado: 'cerrada',
          abierta_en: new Date(Date.now() - 3600_000).toISOString(),
          cerrada_en: new Date().toISOString(),
          saldo_inicial: 0,
          saldo_final_declarado: saldoFinalDeclarado,
        } as SesionCaja;
      }
      // Filtramos por estado=abierta para prevenir doble cierre silencioso
      // (caso típico: el admin cierra la sesión desde /admin/caja y el
      // cajero la cierra desde el PoS simultáneamente — sin este filtro,
      // el segundo update pasaba sin error pero no afectaba nada).
      //
      // Usamos .select() que devuelve array (no .maybeSingle): así
      // distinguimos "0 filas afectadas → ya estaba cerrada" sin caer en
      // los quirks de PostgREST que a veces tira "Cannot coerce to single
      // JSON object" cuando maybeSingle recibe 0 rows con ciertos headers.
      const { data: filas, error } = await sb
        .from('sesiones_caja')
        .update({
          estado: 'cerrada',
          cerrada_en: new Date().toISOString(),
          saldo_final_declarado: saldoFinalDeclarado,
        })
        .eq('id', id)
        .eq('estado', 'abierta')
        .select('*');
      if (error) throw new Error(`sesiones_caja.cerrar: ${error.message}`);
      if (!filas || filas.length === 0) {
        // No es un error de bug — es una condición esperada (admin y cajero
        // cerraron la misma sesión "en simultáneo"). El UI distingue este
        // caso por el `name` para mostrarlo como info amigable, no rojo.
        const err = new Error(
          'Esta caja ya había sido cerrada (alguien la cerró antes).',
        );
        err.name = 'SesionYaCerrada';
        throw err;
      }
      return filas[0] as SesionCaja;
    },
    async sesionActivaDe(empleadoId, cajaId) {
      return okMaybe<SesionCaja>(
        await sb
          .from('sesiones_caja')
          .select('*')
          .eq('empleado_id', empleadoId)
          .eq('caja_id', cajaId)
          .eq('estado', 'abierta')
          .maybeSingle(),
        'sesiones_caja.sesionActivaDe',
      );
    },
    async list(filtro = {}) {
      let q = sb.from('sesiones_caja').select('*').order('abierta_en', { ascending: false });
      if (filtro.caja_id) q = q.eq('caja_id', filtro.caja_id);
      if (filtro.empleado_id) q = q.eq('empleado_id', filtro.empleado_id);
      if (filtro.desde) q = q.gte('abierta_en', filtro.desde);
      if (filtro.hasta) q = q.lte('abierta_en', filtro.hasta);
      let rows = okList<SesionCaja>(await q, 'sesiones_caja.list');
      if (filtro.local_id) {
        const { data: cajas } = await sb
          .from('cajas')
          .select('id')
          .eq('local_id', filtro.local_id);
        const ids = new Set((cajas ?? []).map((c) => c.id));
        rows = rows.filter((s) => ids.has(s.caja_id));
      }
      return rows;
    },
    async get(id) {
      return okMaybe<SesionCaja>(
        await sb.from('sesiones_caja').select('*').eq('id', id).maybeSingle(),
        'sesiones_caja.get',
      );
    },
    async movimientos(sesionId) {
      return okList<MovimientoCaja>(
        await sb
          .from('movimientos_caja')
          .select('*')
          .eq('sesion_caja_id', sesionId)
          .order('fecha'),
        'sesiones_caja.movimientos',
      );
    },
    async registrarMovimiento(input) {
      if (esDemoMode()) {
        logDemo('sesiones_caja.registrarMovimiento', input);
        return {
          id: randomUuid(),
          ...input,
          fecha: new Date().toISOString(),
        } as MovimientoCaja;
      }
      return ok<MovimientoCaja>(
        await sb.from('movimientos_caja').insert(input).select('*').single(),
        'sesiones_caja.registrarMovimiento',
      );
    },
    async actualizarSaldoInicial(id, nuevoSaldoInicial) {
      if (esDemoMode()) {
        logDemo('sesiones_caja.actualizarSaldoInicial', { id, nuevoSaldoInicial });
        return {
          id,
          caja_id: randomUuid(),
          empleado_id: randomUuid(),
          empleado_actual_id: randomUuid(),
          estado: 'abierta',
          abierta_en: new Date().toISOString(),
          saldo_inicial: nuevoSaldoInicial,
        } as SesionCaja;
      }
      // maybeSingle + validación explícita: si otra sesión cerró la
      // caja entre que el cajero abrió la pantalla y apretó guardar,
      // el UPDATE afecta 0 filas y .single() explotaba con
      // "Cannot coerce the result to a single JSON object" — mensaje
      // críptico que no le dice a nadie qué hacer. Ahora tira un error
      // legible.
      const res = await sb
        .from('sesiones_caja')
        .update({ saldo_inicial: nuevoSaldoInicial })
        .eq('id', id)
        .eq('estado', 'abierta')
        .select('*')
        .maybeSingle();
      const sesion = okMaybe<SesionCaja>(res, 'sesiones_caja.actualizarSaldoInicial');
      if (!sesion) {
        throw new Error(
          'La caja ya no está abierta. Recargá la pantalla y volvé a intentar.',
        );
      }
      return sesion;
    },
    async cambiarResponsable(id, nuevoEmpleadoId) {
      if (esDemoMode()) {
        logDemo('sesiones_caja.cambiarResponsable', { id, nuevoEmpleadoId });
        return {
          id,
          caja_id: randomUuid(),
          empleado_id: randomUuid(),
          empleado_actual_id: nuevoEmpleadoId,
          estado: 'abierta',
          abierta_en: new Date().toISOString(),
          saldo_inicial: 0,
        } as SesionCaja;
      }
      // Mismo motivo que actualizarSaldoInicial: la sesión pudo haber
      // sido cerrada (o forzada) entre que se vio "Tomar posta" y el
      // click. maybeSingle + mensaje legible.
      const res = await sb
        .from('sesiones_caja')
        .update({ empleado_actual_id: nuevoEmpleadoId })
        .eq('id', id)
        .eq('estado', 'abierta')
        .select('*')
        .maybeSingle();
      const sesion = okMaybe<SesionCaja>(res, 'sesiones_caja.cambiarResponsable');
      if (!sesion) {
        throw new Error(
          'La caja ya no está abierta. Recargá la pantalla y volvé a intentar.',
        );
      }
      return sesion;
    },
    async cerrarOtrasSesionesEnCaja(cajaId, exceptoSesionId) {
      if (esDemoMode()) {
        logDemo('sesiones_caja.cerrarOtrasSesionesEnCaja', { cajaId, exceptoSesionId });
        return 0;
      }
      const { data: filas, error } = await sb
        .from('sesiones_caja')
        .update({
          estado: 'cerrada',
          cerrada_en: new Date().toISOString(),
        })
        .eq('caja_id', cajaId)
        .eq('estado', 'abierta')
        .neq('id', exceptoSesionId)
        .select('id');
      if (error) {
        throw new Error(
          `sesiones_caja.cerrarOtrasSesionesEnCaja: ${error.message}`,
        );
      }
      return filas?.length ?? 0;
    },
    async editarSesion(id, patch) {
      // Solo incluir en el UPDATE las llaves que vinieron en el patch
      // para no pisar nada por accidente.
      const update: Record<string, unknown> = {};
      if (patch.empleado_id !== undefined) update.empleado_id = patch.empleado_id;
      if (patch.empleado_actual_id !== undefined) {
        update.empleado_actual_id = patch.empleado_actual_id;
      }
      if (patch.caja_id !== undefined) update.caja_id = patch.caja_id;
      if (patch.saldo_inicial !== undefined) update.saldo_inicial = patch.saldo_inicial;
      if (patch.saldo_final_declarado !== undefined) {
        update.saldo_final_declarado = patch.saldo_final_declarado;
      }
      return ok<SesionCaja>(
        await sb
          .from('sesiones_caja')
          .update(update)
          .eq('id', id)
          .select('*')
          .single(),
        'sesiones_caja.editarSesion',
      );
    },
    async forzarCierre(id, cerradaEn) {
      return ok<SesionCaja>(
        await sb
          .from('sesiones_caja')
          .update({
            estado: 'cerrada',
            cerrada_en: cerradaEn ?? new Date().toISOString(),
          })
          .eq('id', id)
          .eq('estado', 'abierta')
          .select('*')
          .single(),
        'sesiones_caja.forzarCierre',
      );
    },
    async eliminar(id) {
      // Cascade manual: borrar antes las dependencias que apuntan a la
      // sesión (o a las ventas de la sesión) y después la sesión misma.
      // Orden importa por las FK. Si algún paso falla se aborta.
      //
      // NO ES ATÓMICO. Si algún paso falla la sesión puede quedar
      // parcialmente borrada. En la práctica lo usa solo el dev de
      // Pragma para limpiar pruebas — vale la simplicidad.

      // 1) IDs de las ventas de esta sesión (para el paso 2).
      const { data: ventasFilas, error: errVentas } = await sb
        .from('ventas')
        .select('id')
        .eq('sesion_caja_id', id);
      if (errVentas) {
        throw new Error(`sesiones_caja.eliminar (ventas ids): ${errVentas.message}`);
      }
      const ventasIds = (ventasFilas ?? []).map((r) => r.id as string);

      // 2) Movimientos de stock que refieren a ventas de esta sesión.
      if (ventasIds.length > 0) {
        const { error } = await sb
          .from('movimientos_stock')
          .delete()
          .in('referencia_id', ventasIds);
        if (error) {
          throw new Error(
            `sesiones_caja.eliminar (movimientos_stock): ${error.message}`,
          );
        }
      }

      // 3) Movimientos de caja de la sesión.
      const { data: movsCajaData, error: errMovsC } = await sb
        .from('movimientos_caja')
        .delete()
        .eq('sesion_caja_id', id)
        .select('id');
      if (errMovsC) {
        throw new Error(
          `sesiones_caja.eliminar (movimientos_caja): ${errMovsC.message}`,
        );
      }

      // 4) Ventas de la sesión (todos sus estados: completadas, anuladas,
      //    canceladas, presupuestos).
      if (ventasIds.length > 0) {
        const { error } = await sb.from('ventas').delete().eq('sesion_caja_id', id);
        if (error) {
          throw new Error(`sesiones_caja.eliminar (ventas): ${error.message}`);
        }
      }

      // 5) La sesión.
      const { error: errSes } = await sb.from('sesiones_caja').delete().eq('id', id);
      if (errSes) {
        throw new Error(`sesiones_caja.eliminar (sesion): ${errSes.message}`);
      }

      return {
        ventas: ventasIds.length,
        movimientos_caja: movsCajaData?.length ?? 0,
      };
    },
  };
}
