# Schema de base de datos (Supabase/Postgres)

> Estado del esquema y de las migraciones. **Leer antes de tocar SQL o levantar una instancia nueva.**

## ⚠️ Problema conocido: el esquema está fragmentado

Hoy el esquema aplicado en producción vive en **dos lugares que no están unificados**:

1. **`supabase/migrations/0001`–`0014`** — migraciones numeradas, "oficiales".
2. **`scripts/migrations-*.sql`** — migraciones sueltas que se aplicaron a mano desde el
   SQL Editor de Supabase a lo largo de las iteraciones post go-live, y que **nunca se
   incorporaron** a `supabase/migrations/`.

**Consecuencia:** correr solo `supabase/migrations/` en una base limpia produce un esquema
**incompleto**. Faltan, entre otras cosas, columnas y tablas que ya están en producción:

| SQL suelto (en `scripts/`) | Qué agrega |
| --- | --- |
| `migrations-iteracion-1.sql` | `productos.promo_texto`, `productos.promo_pct` (+ check 0–100) |
| `migrations-iteracion-5.sql` | iteración 5 post go-live |
| `migrations-iteracion-7.sql` | responsable de caja por turno (`empleado_actual_id`) |
| `migrations-iteracion-10.sql` | promo NxM (`promo_tipo='nxm'`, `promo_pagas_n`, `promo_llevas_m`) |
| `migrations-iteracion-11.sql` | promo combo (`promo_tipo='combo'`, `promo_combo_cant`, `promo_combo_precio`) |
| `migrations-categoria-nullable.sql` | `productos.categoria_id` nullable + `ON DELETE SET NULL` |
| `migrations-proveedor-nullable.sql` | `productos.proveedor_id` nullable + `ON DELETE SET NULL` |
| `migrations-stock-atomico.sql` | delta de stock atómico (fix race condition) + signo real en ajustes |
| `migrations-mayorista-descuento.sql` | `descuento_mayorista_pct` (global + override por producto), `nombre_web` |
| `migrations-mayorista-desde-monto.sql` | umbral de monto para aplicar precio mayorista |
| `migrations-pedidos-web.sql` | tabla `pedidos_web` (pedidos del catálogo web mayorista) |

## Plan de consolidación (pendiente, hacer con cuidado — prod está vivo)

El objetivo para multi-cliente es que **`supabase/migrations/` sea la única fuente de verdad**
y que una base limpia quede idéntica a producción. Pasos sugeridos:

1. **Obtener el esquema real de producción** como referencia definitiva
   (`pg_dump --schema-only`, o `supabase db dump`). Lo que está en prod manda sobre lo que
   dicen los archivos.
2. Convertir cada `scripts/migrations-*.sql` en una migración numerada `0015+` dentro de
   `supabase/migrations/`, en orden cronológico real (ver fechas en los headers y en
   [`CHANGELOG.md`](./CHANGELOG.md)). Mantener idempotencia (`IF NOT EXISTS`).
3. Verificar: aplicar `supabase/migrations/` en una base limpia (branch de Supabase o local)
   y **diffear** contra el dump de prod. Debe dar vacío.
4. Una vez verificado, mover los `scripts/migrations-*.sql` a `scripts/migrations/aplicadas/`
   (archivo histórico) o borrarlos, dejando el puntero en este doc.
5. Documentar acá el número de la última migración y la fecha del último diff limpio.

## RPCs y objetos clave

- **`crear_venta`** — venta atómica (stock + movimiento de caja + cta cte). Ver migraciones
  `0003`, `0005`, `0014`. En el mock lo replica `ventas.crear()`.
- **RLS** — refinada en `0011`, `0012`, `0013`. Lección crítica: un `UPDATE`/`DELETE` sin
  `WITH CHECK`/`USING` para el role `authenticated` **falla en silencio** (el SQL Editor usa
  `service_role` y nunca lo detecta). Ver CHANGELOG, Iteración 2.
- **Storage** — bucket `producto-imagenes` con policies en `0004`.
- **Edge Function** — `supabase/functions/set-empleado-password` (reset de password vía service_role).

## Fuente de verdad de los tipos

Los tipos TypeScript de dominio viven en `packages/db/src/types.ts`. Al cambiar el schema,
mantenerlos en sync (o regenerar con `supabase gen types typescript`).
