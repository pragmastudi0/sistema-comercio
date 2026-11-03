-- Rol "Demo (solo lectura)" para presentar el sistema a prospectos.
--
-- Se puede ver todo el catálogo, stock, clientes, config, etc., pero
-- NO hay acciones (crear, editar, eliminar) y NO ve datos sensibles
-- como facturación, ganancia, movimientos de caja ni costos.
--
-- Después de correr esto, ir a /admin/empleados y crear un empleado
-- nuevo asignándole este rol. El empleado no puede hacer daño al
-- sistema y sirve perfecto para demostrar la potencia a un prospecto.
--
-- Idempotente: usa ON CONFLICT (nombre) para no duplicar si ya existe.

INSERT INTO roles (nombre, preset, permisos)
VALUES (
  'Demo (solo lectura)',
  false,
  '{
    "productos": {
      "ver": true,
      "ver_precio_venta": true
    },
    "categorias": { "ver": true },
    "clientes": { "ver": true },
    "stock": {
      "ver_propio_deposito": true,
      "ver_todos_depositos": true
    },
    "proveedores": { "ver": true },
    "listas_precio": { "ver": true },
    "empleados": { "ver": true },
    "roles": { "ver": true },
    "configuracion": { "ver": true }
  }'::jsonb
)
ON CONFLICT DO NOTHING;

-- Verificación (opcional):
--   SELECT id, nombre, preset, permisos
--   FROM roles
--   WHERE nombre = 'Demo (solo lectura)';
