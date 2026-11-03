#!/usr/bin/env node
// =============================================================
// Crea el rol "Demo (solo lectura)" y un usuario Invitado con ese rol.
// =============================================================
//
// Uso:
//   node scripts/crear-usuario-demo.mjs
//
// Lee SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY desde apps/admin/.env.local.
//
// Idempotente:
//   - Si el rol "Demo (solo lectura)" ya existe, no lo duplica.
//   - Si el usuario invitado@turisteando.local ya existe en Auth, le
//     resetea la password a "Invitado2026" y lo reactiva.
//   - Si ya existe la fila en `empleados`, la actualiza (rol y activo).
//
// Después de correrlo, se puede loguear en el admin con:
//   Email:    invitado@turisteando.local
//   Password: Invitado2026
// =============================================================

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __here = dirname(fileURLToPath(import.meta.url));
const requireFromDb = createRequire(
  resolve(__here, '..', 'packages', 'db', 'package.json'),
);
const supabaseModulePath = requireFromDb.resolve('@supabase/supabase-js');
const { createClient } = await import(supabaseModulePath);

// ---------- Cargar env vars desde apps/admin/.env.local ----------
function cargarEnvLocal() {
  const candidato = resolve(__here, '..', 'apps', 'admin', '.env.local');
  if (!existsSync(candidato)) return;
  const raw = readFileSync(candidato, 'utf8');
  for (const linea of raw.split('\n')) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    const v = vRaw.replace(/^["']|["']$/g, '');
    process.env[k] = v;
  }
}
cargarEnvLocal();

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Ponelas en apps/admin/.env.local.',
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ROL_NOMBRE = 'Demo (solo lectura)';
// Permisos amplios de LECTURA + los mínimos de ACCIÓN para que pueda
// probar el PoS end-to-end. Todas las mutations críticas (crear venta,
// abrir/cerrar caja, ajustar stock, transferir, anular) están
// interceptadas en los repos Supabase por el flag __DEMO_MODE__:
// devuelven mocks sin tocar BD. Ver packages/db/src/demo-mode.ts.
//
// Los montos también se enmascaran globalmente en formatCurrency.
const ROL_PERMISOS = {
  productos: {
    ver: true,
    ver_precio_venta: true,
    ver_costo: true,
    ver_margen: true,
  },
  categorias: { ver: true },
  clientes: { ver: true, crear: true },
  cuenta_corriente: { ver: true },
  stock: {
    ver_propio_deposito: true,
    ver_todos_depositos: true,
    ajustar: true,
    transferir: true,
    registrar_merma: true,
  },
  proveedores: { ver: true },
  listas_precio: { ver: true },
  // Acciones de caja + ventas necesarias para operar el PoS.
  // Interceptadas por el modo demo — no persisten en BD.
  ventas: {
    crear: true,
    anular_propia_del_dia: true,
    anular_ajena_del_dia: true,
    descuento_manual: true,
    modificar_precio_unitario: true,
  },
  caja: {
    abrir: true,
    cerrar: true,
    ver_propia: true,
    ver_otras_del_local: true,
    ver_otras_de_otros_locales: true,
    ingreso_efectivo: true,
    egreso_efectivo: true,
    retiro_efectivo: true,
  },
  reportes: {
    ver_caja_propia: true,
    ver_local_propio: true,
    ver_otros_locales: true,
    ver_global: true,
    ver_ganancia: true,
    ver_costos: true,
  },
  empleados: { ver: true },
  roles: { ver: true },
  configuracion: { ver: true },
  auditoria: { ver: true },
};

const USER_EMAIL = 'invitado@turisteando.local';
const USER_PASSWORD = 'Invitado2026';
const USER_NOMBRE = 'Invitado';
const USER_APELLIDO = 'Demo';

// -------------------- Paso 1: rol --------------------
async function asegurarRol() {
  console.log(`\n[1/3] Rol "${ROL_NOMBRE}"...`);
  const { data: existentes, error: e1 } = await sb
    .from('roles')
    .select('id, nombre')
    .eq('nombre', ROL_NOMBRE);
  if (e1) throw new Error(`Buscar rol: ${e1.message}`);

  if (existentes && existentes.length > 0) {
    const rol = existentes[0];
    // Actualizar permisos por si el rol quedó viejo.
    const { error: eUpd } = await sb
      .from('roles')
      .update({ permisos: ROL_PERMISOS, preset: false })
      .eq('id', rol.id);
    if (eUpd) throw new Error(`Actualizar rol: ${eUpd.message}`);
    console.log(`  ✓ Ya existía (id ${rol.id}). Permisos actualizados.`);
    return rol.id;
  }

  const { data: creado, error: eIns } = await sb
    .from('roles')
    .insert({ nombre: ROL_NOMBRE, preset: false, permisos: ROL_PERMISOS })
    .select('id')
    .single();
  if (eIns) throw new Error(`Insertar rol: ${eIns.message}`);
  console.log(`  ✓ Creado (id ${creado.id}).`);
  return creado.id;
}

// -------------------- Paso 2: auth user --------------------
async function asegurarAuthUser() {
  console.log(`\n[2/3] Auth user (${USER_EMAIL})...`);
  // Buscar por email en Auth
  const { data: list, error: eList } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (eList) throw new Error(`Listar usuarios Auth: ${eList.message}`);

  const existente = list.users?.find(
    (u) => (u.email ?? '').toLowerCase() === USER_EMAIL.toLowerCase(),
  );

  if (existente) {
    const { error: eUpd } = await sb.auth.admin.updateUserById(existente.id, {
      password: USER_PASSWORD,
      email_confirm: true,
      ban_duration: 'none',
    });
    if (eUpd) throw new Error(`Actualizar Auth user: ${eUpd.message}`);
    console.log(`  ✓ Ya existía (id ${existente.id}). Password reseteada.`);
    return existente.id;
  }

  const { data: nuevo, error: eIns } = await sb.auth.admin.createUser({
    email: USER_EMAIL,
    password: USER_PASSWORD,
    email_confirm: true,
    user_metadata: { nombre: USER_NOMBRE, apellido: USER_APELLIDO },
  });
  if (eIns) throw new Error(`Crear Auth user: ${eIns.message}`);
  console.log(`  ✓ Creado (id ${nuevo.user.id}).`);
  return nuevo.user.id;
}

// -------------------- Paso 3: empleado --------------------
async function asegurarEmpleado(rolId, authUserId) {
  console.log(`\n[3/3] Fila en empleados...`);
  // Necesitamos empresa_id — usamos el PRESET conocido.
  const empresaId = '00000000-0000-0000-0000-000000000001';

  const { data: existentes, error: eBuscar } = await sb
    .from('empleados')
    .select('id, email')
    .eq('email', USER_EMAIL);
  if (eBuscar) throw new Error(`Buscar empleado: ${eBuscar.message}`);

  if (existentes && existentes.length > 0) {
    const emp = existentes[0];
    const { error: eUpd } = await sb
      .from('empleados')
      .update({
        rol_id: rolId,
        auth_user_id: authUserId,
        nombre: USER_NOMBRE,
        apellido: USER_APELLIDO,
        activo: true,
      })
      .eq('id', emp.id);
    if (eUpd) throw new Error(`Actualizar empleado: ${eUpd.message}`);
    console.log(`  ✓ Ya existía (id ${emp.id}). Actualizado.`);
    return emp.id;
  }

  const { data: creado, error: eIns } = await sb
    .from('empleados')
    .insert({
      empresa_id: empresaId,
      auth_user_id: authUserId,
      nombre: USER_NOMBRE,
      apellido: USER_APELLIDO,
      email: USER_EMAIL,
      rol_id: rolId,
      activo: true,
    })
    .select('id')
    .single();
  if (eIns) throw new Error(`Insertar empleado: ${eIns.message}`);
  console.log(`  ✓ Creado (id ${creado.id}).`);
  return creado.id;
}

// -------------------- MAIN --------------------
try {
  const rolId = await asegurarRol();
  const authUserId = await asegurarAuthUser();
  const empId = await asegurarEmpleado(rolId, authUserId);

  console.log('\n─────────────────────────────────────────');
  console.log('  ✅  LISTO — usuario invitado configurado');
  console.log('─────────────────────────────────────────');
  console.log(`  Email:    ${USER_EMAIL}`);
  console.log(`  Password: ${USER_PASSWORD}`);
  console.log(`  Rol:      ${ROL_NOMBRE}`);
  console.log(`  Rol id:   ${rolId}`);
  console.log(`  Emp id:   ${empId}`);
  console.log('─────────────────────────────────────────\n');
} catch (err) {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
}
