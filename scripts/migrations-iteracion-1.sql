-- =============================================================
-- Migraciones SQL — iteración 1 post go-live
-- =============================================================
-- Correr en Supabase → SQL Editor cuando se mergee la rama
-- feat/post-go-live-iteracion-1. Idempotente: usa IF NOT EXISTS.
-- =============================================================

-- 1. Promo/descuento por producto (visible en el PoS, aplicable al cobrar)
--    promo_texto: descripción libre que ve el cajero (ej. "Promo 2x1",
--      "10% efectivo", "Saldo navideño").
--    promo_pct:   porcentaje sugerido (0-100). Si > 0, el cajero ve un
--      botón "Aplicar X%" que setea el descuento de esa línea del carrito.
alter table productos
  add column if not exists promo_texto text,
  add column if not exists promo_pct numeric;

-- check de rango razonable para promo_pct (no romper si ya hay datos
-- fuera de rango — el constraint es soft, sin NOT VALID en producción).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'productos_promo_pct_range'
  ) then
    alter table productos
      add constraint productos_promo_pct_range
      check (promo_pct is null or (promo_pct >= 0 and promo_pct <= 100));
  end if;
end $$;
