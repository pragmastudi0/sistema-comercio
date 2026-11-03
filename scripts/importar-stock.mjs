#!/usr/bin/env node
// =============================================================
// Importador genérico de inventario para Turisteando
// =============================================================
// Uso:
//   node scripts/importar-stock.mjs <deposito>
//
//   <deposito>: "b12" o "c11" (o el substring del nombre del depósito).
//
// Lee /tmp/articulos-<deposito>.json (generado por Python) y:
//   1. Crea categorías y proveedores que no existen.
//   2. UPSERT productos por codigo_interno (sobreescribe nombre,
//      costo, categoría, proveedor, activo, descripción).
//   3. Setea stock del depósito indicado (MANTIENE negativos).
//   4. Setea precio en la lista Consumidor Final.
//
// Idempotente. No borra huérfanos (a diferencia del primer script);
// el catálogo ya está alineado con los Excels.
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

const DEPOSITO_ARG = (process.argv[2] ?? '').toLowerCase().trim();
if (!DEPOSITO_ARG) {
  console.error('✗ Falta argumento. Uso: node scripts/importar-stock.mjs <b12|c11>');
  process.exit(1);
}

// ── env / config ────────────────────────────────────────────────
function cargarEnvLocal() {
  const candidato = resolve(__here, '..', 'apps', 'admin', '.env.local');
  if (!existsSync(candidato)) return;
  const raw = readFileSync(candidato, 'utf8');
  for (const linea of raw.split('\n')) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    process.env[k] = vRaw.replace(/^["']|["']$/g, '');
  }
}
cargarEnvLocal();

const SUPABASE_URL = (
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
).replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('✗ Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const LISTA_CF = '00000000-0000-0000-0000-000000000020';

// ── Cargar JSON ─────────────────────────────────────────────────
const JSON_PATH = `/tmp/articulos-${DEPOSITO_ARG}.json`;
if (!existsSync(JSON_PATH)) {
  console.error(`✗ No existe ${JSON_PATH}. Generalo con el script Python.`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
console.log(`✓ Cargados ${data.productos.length} productos del Excel.\n`);

// ── Resolver depósito por nombre ────────────────────────────────
async function resolverDeposito() {
  const { data: deps, error } = await admin
    .from('depositos')
    .select('id, nombre');
  if (error) throw new Error(`depositos.list: ${error.message}`);
  const match = deps.find((d) =>
    (d.nombre ?? '').toLowerCase().includes(DEPOSITO_ARG),
  );
  if (!match) {
    throw new Error(
      `No encontré un depósito con "${DEPOSITO_ARG}" en el nombre. ` +
        `Depósitos: ${deps.map((d) => d.nombre).join(', ')}`,
    );
  }
  console.log(`✓ Depósito resuelto: "${match.nombre}" (${match.id})\n`);
  return match.id;
}

// ── Categorías ──────────────────────────────────────────────────
async function upsertCategorias() {
  const { data: existentes, error } = await admin
    .from('categorias')
    .select('id, nombre');
  if (error) throw new Error(`categorias.list: ${error.message}`);
  const porNombre = new Map(existentes.map((c) => [c.nombre.toLowerCase(), c]));
  let creadas = 0;
  const map = new Map();
  for (const nombre of data.categorias) {
    const ya = porNombre.get(nombre.toLowerCase());
    if (ya) {
      map.set(nombre, ya.id);
    } else {
      const { data: nueva, error: insErr } = await admin
        .from('categorias')
        .insert({ nombre })
        .select('id')
        .single();
      if (insErr) throw new Error(`categorias.insert ${nombre}: ${insErr.message}`);
      map.set(nombre, nueva.id);
      creadas++;
    }
  }
  console.log(`✓ Categorías: ${data.categorias.length} (${creadas} nuevas).`);
  return map;
}

// ── Proveedores ─────────────────────────────────────────────────
async function upsertProveedores() {
  const { data: existentes, error } = await admin
    .from('proveedores')
    .select('id, nombre');
  if (error) throw new Error(`proveedores.list: ${error.message}`);
  const porNombre = new Map(existentes.map((p) => [p.nombre.toLowerCase(), p]));
  let creados = 0;
  const map = new Map();
  for (const nombre of data.proveedores) {
    const ya = porNombre.get(nombre.toLowerCase());
    if (ya) {
      map.set(nombre, ya.id);
    } else {
      const { data: nuevo, error: insErr } = await admin
        .from('proveedores')
        .insert({ nombre, activo: true })
        .select('id')
        .single();
      if (insErr) throw new Error(`proveedores.insert ${nombre}: ${insErr.message}`);
      map.set(nombre, nuevo.id);
      creados++;
    }
  }
  console.log(`✓ Proveedores: ${data.proveedores.length} (${creados} nuevos).`);
  return map;
}

// ── Productos ───────────────────────────────────────────────────
async function upsertProductos(catMap, provMap) {
  const PAGE = 1000;
  const existentes = [];
  let from = 0;
  while (true) {
    const { data: chunk, error } = await admin
      .from('productos')
      .select('id, codigo_interno')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`productos.list: ${error.message}`);
    existentes.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  const porCodigo = new Map(existentes.map((p) => [p.codigo_interno, p.id]));

  let actualizados = 0;
  let creados = 0;
  const mapCodigoId = new Map();

  for (const p of data.productos) {
    const yaId = porCodigo.get(p.codigo_interno);
    const payload = {
      codigo_interno: p.codigo_interno,
      nombre: p.nombre,
      categoria_id: catMap.get(p.categoria),
      proveedor_id: p.proveedor ? provMap.get(p.proveedor) : null,
      costo: p.costo,
      activo: p.activo,
      descripcion: p.descripcion ?? null,
      publicado_web: false,
    };
    if (yaId) {
      const { error } = await admin.from('productos').update(payload).eq('id', yaId);
      if (error) throw new Error(`productos.update ${p.codigo_interno}: ${error.message}`);
      mapCodigoId.set(p.codigo_interno, yaId);
      actualizados++;
    } else {
      const { data: nuevo, error } = await admin
        .from('productos')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw new Error(`productos.insert ${p.codigo_interno}: ${error.message}`);
      mapCodigoId.set(p.codigo_interno, nuevo.id);
      creados++;
    }
    if ((actualizados + creados) % 200 === 0) {
      process.stdout.write(`  ...productos: ${actualizados + creados}/${data.productos.length}\r`);
    }
  }
  console.log(`✓ Productos: ${data.productos.length} (${creados} nuevos, ${actualizados} actualizados).      `);
  return mapCodigoId;
}

// ── Stock del depósito ──────────────────────────────────────────
async function importarStock(mapCodigoId, depositoId) {
  const PAGE = 1000;
  const existentes = [];
  let from = 0;
  while (true) {
    const { data: chunk, error } = await admin
      .from('stock_items')
      .select('producto_id')
      .eq('deposito_id', depositoId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`stock_items.list: ${error.message}`);
    existentes.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  const existsByProd = new Set(existentes.map((s) => s.producto_id));

  let upd = 0;
  let ins = 0;

  for (const p of data.productos) {
    const prodId = mapCodigoId.get(p.codigo_interno);
    if (!prodId) continue;
    if (existsByProd.has(prodId)) {
      const { error } = await admin
        .from('stock_items')
        .update({ cantidad: p.stock, minimo: p.stock_min ?? null })
        .eq('producto_id', prodId)
        .eq('deposito_id', depositoId)
        .is('variante_id', null);
      if (error) throw new Error(`stock.update ${p.codigo_interno}: ${error.message}`);
      upd++;
    } else {
      const { error } = await admin.from('stock_items').insert({
        producto_id: prodId,
        variante_id: null,
        deposito_id: depositoId,
        cantidad: p.stock,
        minimo: p.stock_min ?? null,
      });
      if (error) throw new Error(`stock.insert ${p.codigo_interno}: ${error.message}`);
      ins++;
    }
    if ((upd + ins) % 200 === 0) {
      process.stdout.write(`  ...stock ${DEPOSITO_ARG.toUpperCase()}: ${upd + ins}/${data.productos.length}\r`);
    }
  }
  console.log(`✓ Stock ${DEPOSITO_ARG.toUpperCase()}: ${ins} nuevos, ${upd} actualizados.       `);
}

// ── Precios CF ──────────────────────────────────────────────────
async function importarPrecios(mapCodigoId) {
  const PAGE = 1000;
  const existentes = [];
  let from = 0;
  while (true) {
    const { data: chunk, error } = await admin
      .from('producto_lista_precio')
      .select('producto_id')
      .eq('lista_precio_id', LISTA_CF)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`precios.list: ${error.message}`);
    existentes.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  const existsByProd = new Set(existentes.map((p) => p.producto_id));

  let upd = 0;
  let ins = 0;
  for (const p of data.productos) {
    const prodId = mapCodigoId.get(p.codigo_interno);
    if (!prodId) continue;
    const escalas = [{ desde: 1, precio: p.precio_cf }];
    if (existsByProd.has(prodId)) {
      const { error } = await admin
        .from('producto_lista_precio')
        .update({ escalas })
        .eq('producto_id', prodId)
        .eq('lista_precio_id', LISTA_CF);
      if (error) throw new Error(`precios.update ${p.codigo_interno}: ${error.message}`);
      upd++;
    } else {
      const { error } = await admin.from('producto_lista_precio').insert({
        producto_id: prodId,
        lista_precio_id: LISTA_CF,
        escalas,
      });
      if (error) throw new Error(`precios.insert ${p.codigo_interno}: ${error.message}`);
      ins++;
    }
    if ((upd + ins) % 200 === 0) {
      process.stdout.write(`  ...precios CF: ${upd + ins}/${data.productos.length}\r`);
    }
  }
  console.log(`✓ Precios CF: ${ins} nuevos, ${upd} actualizados.       `);
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`━━━ Importación inventario ${DEPOSITO_ARG.toUpperCase()} ━━━\n`);
  const depositoId = await resolverDeposito();
  const catMap = await upsertCategorias();
  const provMap = await upsertProveedores();
  const mapCodigoId = await upsertProductos(catMap, provMap);
  await importarStock(mapCodigoId, depositoId);
  await importarPrecios(mapCodigoId);
  console.log(`\n━━━ Listo ━━━ ${data.productos.length} productos cargados en ${DEPOSITO_ARG.toUpperCase()}.`);
}

main().catch((e) => {
  console.error(`\n✗ Falla: ${e.message}`);
  process.exit(1);
});
