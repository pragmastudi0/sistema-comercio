-- =============================================================
-- Migraciones SQL — iteración 10 post go-live
-- =============================================================
-- Correr en Supabase → SQL Editor antes de mergear la rama
-- feat/promo-nxm-producto. Idempotente (IF NOT EXISTS).
-- =============================================================

-- Promo NxM por producto (2x1, 3x2, etc.).
--
-- promo_tipo:
--   NULL           → sin promo (el % de descuento sigue en promo_pct, si lo hay).
--   'pct'          → promo por porcentaje, se usa promo_pct existente.
--   'nxm'          → promo tipo 2x1 / 3x2 / NxM personalizado.
--
-- promo_nxm_lleva / promo_nxm_paga: SOLO cuando promo_tipo='nxm'.
--   Ej.: 2x1 → lleva=2, paga=1
--        3x2 → lleva=3, paga=2
--   Regla: lleva > paga > 0.
--
-- El PoS aplica NxM automáticamente en el carrito:
--   packs = floor(cantidad / lleva)
--   sueltas = cantidad % lleva
--   unidadesCobradas = packs * paga + sueltas
--   subtotal_final = unidadesCobradas * precio_unitario
alter table productos
  add column if not exists promo_tipo text
    check (promo_tipo is null or promo_tipo in ('pct', 'nxm')),
  add column if not exists promo_nxm_lleva int
    check (promo_nxm_lleva is null or promo_nxm_lleva >= 2),
  add column if not exists promo_nxm_paga int
    check (promo_nxm_paga is null or promo_nxm_paga >= 1);

-- Constraint chico para evitar (lleva=2, paga=2) que no tiene sentido
-- (paga siempre menor que lleva).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'productos_promo_nxm_valido'
  ) then
    alter table productos
      add constraint productos_promo_nxm_valido
      check (
        promo_tipo <> 'nxm'
        or (promo_nxm_lleva is not null and promo_nxm_paga is not null
            and promo_nxm_lleva > promo_nxm_paga)
      );
  end if;
end $$;
