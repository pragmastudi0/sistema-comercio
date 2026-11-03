-- =============================================================
-- Agrega el estado 'cancelada' al enum estado_venta.
--
-- Sirve para registrar cuando el cajero arma un carrito en el PoS
-- pero cancela la venta antes de cobrarla (típicamente: el cliente
-- pregunta el precio y se va, o se equivocó). NO descuenta stock,
-- NO afecta caja. Es solo auditoría para que el dueño vea qué
-- carritos se arman y nunca se cobran.
--
-- Distinción semántica:
--   completada → se cobró
--   anulada    → estaba cobrada y se revirtió (devuelve stock + caja)
--   cancelada  → nunca se llegó a cobrar (no hay efecto contable)
--   presupuesto → cotización, sin compromiso
-- =============================================================

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'cancelada'
      and enumtypid = (select oid from pg_type where typname = 'estado_venta')
  ) then
    alter type estado_venta add value 'cancelada';
  end if;
end $$;
