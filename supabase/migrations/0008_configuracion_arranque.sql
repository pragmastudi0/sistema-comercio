-- Agrega el campo `arranque` a la configuración de empresa.
--
-- Permite cargar manualmente la facturación + cantidad de ventas que el
-- comercio acumuló ANTES de empezar a usar el sistema, junto con la
-- fecha desde la cual contar esos acumulados. El dashboard del admin los
-- suma a los reportes cuando el rango seleccionado empieza igual o antes
-- de `arranque.desde_fecha`, así no parte los reportes mensuales cuando
-- se arranca a mitad de mes.
--
-- Estructura esperada del JSON:
--   {
--     "facturacion_acumulada": 1234567.89,
--     "ventas_acumuladas": 42,
--     "desde_fecha": "2026-06-01"
--   }
-- Cualquier campo puede ser null si todavía no se cargó.

alter table configuracion_empresa
  add column if not exists arranque jsonb;
