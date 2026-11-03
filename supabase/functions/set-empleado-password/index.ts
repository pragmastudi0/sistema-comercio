// Edge Function — cambio de contraseña de otro empleado por un admin.
//
// Validaciones de seguridad:
//   1. La petición lleva el JWT del usuario actual (Authorization: Bearer ...).
//      Verificamos que sea válido contra Supabase Auth.
//   2. Buscamos al empleado correspondiente en la tabla `empleados` por el
//      email del JWT. Tiene que estar activo y tener rol = admin preset.
//   3. Si pasa, usamos la service_role para actualizar la contraseña del
//      empleado objetivo vía supabase.auth.admin.updateUserById.
//
// Deploy:
//   supabase functions deploy set-empleado-password --no-verify-jwt
//
// Variables esperadas (Supabase las setea solas):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// UUID del rol admin preset (alineado con migrations/0001 y preset-ids.ts).
const ROL_ADMIN_PRESET_ID = '00000000-0000-0000-0000-000000000010';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function res(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return res({ error: 'Método no permitido' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) {
    return res({ error: 'Edge function mal configurada (faltan secrets).' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/, '');
  if (!token) return res({ error: 'Falta el token del usuario solicitante.' }, 401);

  let body: { empleado_id?: string; nueva_password?: string };
  try {
    body = await req.json();
  } catch {
    return res({ error: 'Body inválido (JSON esperado).' }, 400);
  }
  const empleadoId = (body.empleado_id ?? '').trim();
  const nuevaPassword = (body.nueva_password ?? '').trim();
  if (!empleadoId) return res({ error: 'Falta empleado_id.' }, 400);
  if (nuevaPassword.length < 6) {
    return res({ error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
  }

  // Cliente service_role para todo el trabajo de admin.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Verificar token del solicitante.
  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes.user) {
    return res({ error: 'Token inválido o expirado.' }, 401);
  }
  const solicitanteEmail = userRes.user.email;
  if (!solicitanteEmail) {
    return res({ error: 'El token no trae email.' }, 401);
  }

  // 2) Buscar al solicitante en empleados y chequear que sea admin activo.
  const { data: solicitante, error: solErr } = await admin
    .from('empleados')
    .select('id, rol_id, activo')
    .ilike('email', solicitanteEmail)
    .maybeSingle();
  if (solErr) return res({ error: `empleados (solicitante): ${solErr.message}` }, 500);
  if (!solicitante || !solicitante.activo) {
    return res({ error: 'El solicitante no es un empleado activo.' }, 403);
  }
  if (solicitante.rol_id !== ROL_ADMIN_PRESET_ID) {
    return res({ error: 'Sólo un admin puede cambiar contraseñas ajenas.' }, 403);
  }
  if (solicitante.id === empleadoId) {
    return res(
      { error: 'Para cambiar tu propia contraseña usá la opción del PoS o "Olvidé mi contraseña".' },
      400,
    );
  }

  // 3) Resolver email del empleado objetivo.
  const { data: objetivo, error: objErr } = await admin
    .from('empleados')
    .select('id, email')
    .eq('id', empleadoId)
    .maybeSingle();
  if (objErr) return res({ error: `empleados (objetivo): ${objErr.message}` }, 500);
  if (!objetivo) return res({ error: 'Empleado no encontrado.' }, 404);

  // 4) Resolver el auth user por email y actualizar password.
  const { data: usuariosAuth, error: usrErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (usrErr) return res({ error: `auth.listUsers: ${usrErr.message}` }, 500);
  const target = usuariosAuth.users.find(
    (u: any) => (u.email ?? '').toLowerCase() === objetivo.email.toLowerCase(),
  );
  if (!target) {
    return res({ error: 'El empleado no tiene cuenta en Auth (sin email registrado).' }, 404);
  }
  const { error: updErr } = await admin.auth.admin.updateUserById(target.id, {
    password: nuevaPassword,
  });
  if (updErr) return res({ error: `auth.updateUserById: ${updErr.message}` }, 500);

  // 5) Log en auditoría (best effort).
  await admin.from('logs_auditoria').insert({
    empleado_id: solicitante.id,
    accion: 'cambio_password_ajeno',
    entidad: 'empleado',
    entidad_id: objetivo.id,
    detalle: { email: objetivo.email },
  });

  return res({ ok: true });
});
