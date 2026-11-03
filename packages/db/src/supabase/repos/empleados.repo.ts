import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmpleadosRepo } from '../../repos/empleados.repo';
import type { Empleado } from '../../types';
import { ok, okList, okMaybe } from '../helpers';
import { PRESET_IDS } from '../preset-ids';

/**
 * Empleados contra Supabase + Auth.
 * - El login (autenticar) usa supabase.auth.signInWithPassword.
 * - Al crear un empleado, NO podemos crear el usuario en Auth desde el cliente
 *   (requiere service_role). Lo que hacemos es signInUp con email/password,
 *   que crea el user en Auth y después lincamos el auth_user_id en la fila.
 *   Para producción real, conviene mover esto a una Edge Function con
 *   service_role para evitar el flujo de "verificar email" si está habilitado.
 */
export function makeEmpleadosRepo(sb: SupabaseClient): EmpleadosRepo {
  return {
    async list(filtro = {}) {
      let q = sb.from('empleados').select('*').order('apellido');
      if (filtro.activo !== undefined) q = q.eq('activo', filtro.activo);
      if (filtro.rol_id) q = q.eq('rol_id', filtro.rol_id);
      if (filtro.local_id) q = q.eq('local_id', filtro.local_id);
      if (filtro.deposito_id) q = q.eq('deposito_id', filtro.deposito_id);
      if (filtro.texto) {
        const p = `%${filtro.texto}%`;
        q = q.or(`nombre.ilike.${p},apellido.ilike.${p},email.ilike.${p}`);
      }
      return okList<Empleado>(await q, 'empleados.list');
    },
    async get(id) {
      return okMaybe<Empleado>(
        await sb.from('empleados').select('*').eq('id', id).maybeSingle(),
        'empleados.get',
      );
    },
    async create(input, password) {
      // 1) Crear el user en Supabase Auth (signUp con email confirmation deshabilitado
      //    en el proyecto si se quiere flujo directo).
      const { data: signUp, error: signErr } = await sb.auth.signUp({
        email: input.email,
        password,
      });
      if (signErr) throw new Error(`empleados.create (auth): ${signErr.message}`);

      // 2) Insertar la fila en empleados con el auth_user_id (puede ser null si
      //    Supabase no devuelve el user inmediatamente; queda para link manual).
      const auth_user_id = signUp.user?.id ?? null;
      const empresa_id = input.empresa_id ?? PRESET_IDS.empresa;
      return ok<Empleado>(
        await sb
          .from('empleados')
          .insert({ ...input, empresa_id, auth_user_id })
          .select('*')
          .single(),
        'empleados.create',
      );
    },
    async update(id, patch) {
      return ok<Empleado>(
        await sb.from('empleados').update(patch).eq('id', id).select('*').single(),
        'empleados.update',
      );
    },
    async delete(id) {
      // SOFT delete: en un sistema con historial (ventas, movimientos de
      // stock, sesiones de caja, cuentas corrientes…), el empleado está
      // referenciado por FK desde varias tablas. Un DELETE físico falla
      // con "violates foreign key constraint" apenas el empleado tiene
      // una venta a su nombre.
      //
      // Lo correcto es marcarlo como inactivo: ya no puede loguearse
      // (autenticar chequea activo=true), no aparece en los selectores
      // de cajeros, pero TODO el historial sigue intacto y consistente.
      // Se puede reactivar desde la misma pantalla de edición si el
      // empleado vuelve más adelante.
      const { error } = await sb
        .from('empleados')
        .update({ activo: false })
        .eq('id', id);
      if (error) throw new Error(`empleados.delete: ${error.message}`);
    },
    async setOverridePermisos(id, override) {
      return ok<Empleado>(
        await sb
          .from('empleados')
          .update({ permisos_override: override ?? null })
          .eq('id', id)
          .select('*')
          .single(),
        'empleados.setOverridePermisos',
      );
    },
    async cambiarRol(id, rolId) {
      return ok<Empleado>(
        await sb
          .from('empleados')
          .update({ rol_id: rolId })
          .eq('id', id)
          .select('*')
          .single(),
        'empleados.cambiarRol',
      );
    },
    async setPassword(id, password) {
      // Cambiar el password de OTRO usuario requiere service_role. Lo hace la
      // edge function `set-empleado-password` que valida que el solicitante
      // sea admin antes de tocar Supabase Auth. La función no se invoca sola:
      // hay que pasarle el JWT del usuario actual en Authorization.
      const session = (await sb.auth.getSession()).data.session;
      if (!session) {
        throw new Error('Tu sesión expiró. Iniciá sesión de nuevo.');
      }
      const { data, error } = await sb.functions.invoke(
        'set-empleado-password',
        {
          body: { empleado_id: id, nueva_password: password },
        },
      );
      if (error) {
        // El error que devuelve la edge va en el body, no en el error genérico.
        const msg =
          (data && typeof data === 'object' && 'error' in data && data.error) ||
          error.message ||
          'No se pudo cambiar la contraseña.';
        throw new Error(String(msg));
      }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }
    },
    async autenticar(email, password) {
      const { error: signErr } = await sb.auth.signInWithPassword({ email, password });
      if (signErr) return null;
      // Buscar el empleado por email (debería haber 0 o 1)
      const { data, error } = await sb
        .from('empleados')
        .select('*')
        .ilike('email', email)
        .eq('activo', true)
        .maybeSingle();
      if (error) {
        await sb.auth.signOut();
        throw new Error(`empleados.autenticar: ${error.message}`);
      }
      if (!data) {
        await sb.auth.signOut();
        return null;
      }
      return data as Empleado;
    },
    async hidratarSesion(accessToken, refreshToken) {
      // SSO admin → PoS: el admin pasa los tokens que YA tiene en su
      // localStorage al PoS por URL hash. Acá los aplicamos al cliente
      // local y resolvemos el empleado por el email del JWT.
      const { data: setRes, error: setErr } = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (setErr || !setRes?.user?.email) {
        await sb.auth.signOut().catch(() => {});
        return null;
      }
      const email = setRes.user.email;
      const { data, error } = await sb
        .from('empleados')
        .select('*')
        .ilike('email', email)
        .eq('activo', true)
        .maybeSingle();
      if (error || !data) {
        await sb.auth.signOut().catch(() => {});
        return null;
      }
      return data as Empleado;
    },
  };
}
