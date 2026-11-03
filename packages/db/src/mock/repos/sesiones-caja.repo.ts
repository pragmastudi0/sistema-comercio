import type { SesionesCajaRepo } from '../../repos/sesiones-caja.repo';
import type { MovimientoCaja, SesionCaja } from '../../types';
import type { Store } from '../store';
import { clone, makeId, notFound, now } from '../utils';

export function makeSesionesCajaRepo(store: Store): SesionesCajaRepo {
  return {
    async abrir({ caja_id, empleado_id, saldo_inicial }) {
      // Permitimos múltiples sesiones abiertas en la misma caja con
      // empleados distintos (ver supabase repo). Solo bloqueamos si el
      // MISMO empleado intenta abrir dos veces en la misma caja.
      const yaMia = store.sesionesCaja.find(
        (s) =>
          s.caja_id === caja_id &&
          s.empleado_id === empleado_id &&
          s.estado === 'abierta',
      );
      if (yaMia) throw new Error('Ya tenés una sesión abierta en esta caja');
      const s: SesionCaja = {
        id: makeId('ses'),
        caja_id,
        empleado_id,
        saldo_inicial,
        abierta_en: now(),
        estado: 'abierta',
      };
      store.sesionesCaja.push(s);
      return clone(s);
    },
    async cerrar(id, saldoFinalDeclarado) {
      const idx = store.sesionesCaja.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Sesión de caja', id);
      const ses = store.sesionesCaja[idx]!;
      if (ses.estado === 'cerrada') throw new Error('Sesión ya cerrada');
      store.sesionesCaja[idx] = {
        ...ses,
        estado: 'cerrada',
        cerrada_en: now(),
        saldo_final_declarado: saldoFinalDeclarado,
      };
      return clone(store.sesionesCaja[idx]!);
    },
    async sesionActivaDe(empleadoId, cajaId) {
      const s = store.sesionesCaja.find(
        (x) => x.empleado_id === empleadoId && x.caja_id === cajaId && x.estado === 'abierta',
      );
      return s ? clone(s) : null;
    },
    async list(filtro) {
      let res = store.sesionesCaja.slice();
      if (filtro?.caja_id) res = res.filter((s) => s.caja_id === filtro.caja_id);
      if (filtro?.empleado_id) res = res.filter((s) => s.empleado_id === filtro.empleado_id);
      if (filtro?.local_id) {
        const cajasDelLocal = new Set(
          store.cajas.filter((c) => c.local_id === filtro.local_id).map((c) => c.id),
        );
        res = res.filter((s) => cajasDelLocal.has(s.caja_id));
      }
      if (filtro?.desde) res = res.filter((s) => s.abierta_en >= filtro.desde!);
      if (filtro?.hasta) res = res.filter((s) => s.abierta_en <= filtro.hasta!);
      return clone(res);
    },
    async get(id) {
      const s = store.sesionesCaja.find((x) => x.id === id);
      return s ? clone(s) : null;
    },
    async movimientos(sesionId) {
      return clone(store.movimientosCaja.filter((m) => m.sesion_caja_id === sesionId));
    },
    async registrarMovimiento(input) {
      const m: MovimientoCaja = { ...input, id: makeId('mc'), fecha: now() };
      store.movimientosCaja.push(m);
      return clone(m);
    },
    async actualizarSaldoInicial(id, nuevoSaldoInicial) {
      const idx = store.sesionesCaja.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Sesión de caja', id);
      const ses = store.sesionesCaja[idx]!;
      if (ses.estado === 'cerrada') {
        throw new Error('No se puede modificar el saldo inicial de una sesión cerrada');
      }
      store.sesionesCaja[idx] = { ...ses, saldo_inicial: nuevoSaldoInicial };
      return clone(store.sesionesCaja[idx]!);
    },
    async cambiarResponsable(id, nuevoEmpleadoId) {
      const idx = store.sesionesCaja.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Sesión de caja', id);
      const ses = store.sesionesCaja[idx]!;
      if (ses.estado === 'cerrada') {
        throw new Error('No se puede cambiar el responsable de una sesión cerrada');
      }
      store.sesionesCaja[idx] = { ...ses, empleado_actual_id: nuevoEmpleadoId };
      return clone(store.sesionesCaja[idx]!);
    },
    async cerrarOtrasSesionesEnCaja(cajaId, exceptoSesionId) {
      const ahora = now();
      let cerradas = 0;
      for (let i = 0; i < store.sesionesCaja.length; i++) {
        const s = store.sesionesCaja[i]!;
        if (
          s.caja_id === cajaId &&
          s.estado === 'abierta' &&
          s.id !== exceptoSesionId
        ) {
          store.sesionesCaja[i] = { ...s, estado: 'cerrada', cerrada_en: ahora };
          cerradas++;
        }
      }
      return cerradas;
    },
    async editarSesion(id, patch) {
      const idx = store.sesionesCaja.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Sesión de caja', id);
      const ses = store.sesionesCaja[idx]!;
      store.sesionesCaja[idx] = {
        ...ses,
        ...(patch.empleado_id !== undefined && { empleado_id: patch.empleado_id }),
        ...(patch.empleado_actual_id !== undefined && {
          empleado_actual_id: patch.empleado_actual_id,
        }),
        ...(patch.caja_id !== undefined && { caja_id: patch.caja_id }),
        ...(patch.saldo_inicial !== undefined && { saldo_inicial: patch.saldo_inicial }),
        ...(patch.saldo_final_declarado !== undefined && {
          saldo_final_declarado: patch.saldo_final_declarado ?? undefined,
        }),
      };
      return clone(store.sesionesCaja[idx]!);
    },
    async forzarCierre(id, cerradaEn) {
      const idx = store.sesionesCaja.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Sesión de caja', id);
      const ses = store.sesionesCaja[idx]!;
      if (ses.estado === 'cerrada') return clone(ses);
      store.sesionesCaja[idx] = {
        ...ses,
        estado: 'cerrada',
        cerrada_en: cerradaEn ?? now(),
      };
      return clone(store.sesionesCaja[idx]!);
    },
    async eliminar(id) {
      const idx = store.sesionesCaja.findIndex((x) => x.id === id);
      if (idx === -1) throw notFound('Sesión de caja', id);
      // Borrar ventas + movimientos_caja de la sesión. En el mock los
      // movimientos_stock de las ventas no se tocan porque el mock no
      // los tiene indexados por sesion_caja_id.
      const ventasIds = store.ventas
        .filter((v) => v.sesion_caja_id === id)
        .map((v) => v.id);
      const ventasBorradas = ventasIds.length;
      store.ventas = store.ventas.filter((v) => v.sesion_caja_id !== id);
      const movsBorrados = store.movimientosCaja.filter(
        (m) => m.sesion_caja_id === id,
      ).length;
      store.movimientosCaja = store.movimientosCaja.filter(
        (m) => m.sesion_caja_id !== id,
      );
      store.sesionesCaja.splice(idx, 1);
      return { ventas: ventasBorradas, movimientos_caja: movsBorrados };
    },
  };
}
