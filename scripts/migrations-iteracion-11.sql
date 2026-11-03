-- =============================================================
-- Migraciones SQL — iteración 11 post go-live
-- =============================================================
-- Correr en Supabase → SQL Editor antes de mergear la rama
-- feat/promo-combo-nporprecio. Idempotente (IF NOT EXISTS).
-- =============================================================

-- Promo COMBO por producto (N unidades por $X fijo).
--
-- Ejemplo: "3 alfajores por $1200".
--   promo_tipo='combo'
--   promo_combo_cantidad=3
--   promo_combo_precio=1200
--
-- El PoS aplica combo automáticamente en el carrito:
--   packs   = floor(cantidad / combo_cantidad)
--   sueltas = cantidad % combo_cantidad
--   subtotal = packs * combo_precio + sueltas * precio_unitario_normal
--
-- Compatible con % descuento manual por línea del cajero (se aplica
-- después del combo, sobre el subtotal ya reducido).
alter table productos
  add column if not exists promo_combo_cantidad int
    check (promo_combo_cantidad is null or promo_combo_cantidad >= 2),
  add column if not exists promo_combo_precio numeric(12, 2)
    check (promo_combo_precio is null or promo_combo_precio > 0);

-- Ampliar el check de promo_tipo para permitir 'combo'. El check anterior
-- ('pct','nxm') se dropea y se recrea con el set nuevo.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname like 'productos_promo_tipo_check%'
       or (conname = 'productos_promo_tipo_check' and conrelid = 'productos'::regclass)
  ) then
    -- Buscar el nombre real del check auto-generado. Postgres suele
    -- llamarlo productos_promo_tipo_check pero puede variar.
    alter table productos drop constraint if exists productos_promo_tipo_check;
  end if;
end $$;

alter table productos
  add constraint productos_promo_tipo_check
  check (promo_tipo is null or promo_tipo in ('pct', 'nxm', 'combo'));

-- Constraint chico para que un combo tenga ambos campos cargados.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'productos_promo_combo_valido'
  ) then
    alter table productos
      add constraint productos_promo_combo_valido
      check (
        promo_tipo <> 'combo'
        or (promo_combo_cantidad is not null and promo_combo_precio is not null)
      );
  end if;
end $$;
