-- =============================================================
-- Migraciones SQL — iteración 5 post go-live
-- =============================================================
-- Correr en Supabase → SQL Editor antes de mergear la rama
-- feat/post-go-live-iteracion-5. Idempotente: usa IF NOT EXISTS.
-- =============================================================

-- 1. Flag "cuotas sin recargo" por producto.
--    Cuando true, el ModalCobro del PoS NO aplica el recargo por cuotas
--    sobre este ítem (los recargos siguen aplicando al resto del carrito
--    que NO tenga la marca). Sirve para valijas, electrodomésticos, y
--    cualquier producto con promo "cuotas sin interés" del cliente.
alter table productos
  add column if not exists cuotas_sin_recargo boolean not null default false;
