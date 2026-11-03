// IDs fijos sembrados por supabase/migrations/0001_initial_schema.sql.
// Las apps los usan para referenciar sin tener que ir a buscarlos por nombre.
// Los depósitos y locales NO vienen del seed inicial; los UUIDs convencionales
// los asigna el setup del cliente (ver script de bootstrap).
export const PRESET_IDS = {
  empresa: '00000000-0000-0000-0000-000000000001',
  roles: {
    admin: '00000000-0000-0000-0000-000000000010',
    encargado: '00000000-0000-0000-0000-000000000011',
    cajero: '00000000-0000-0000-0000-000000000012',
    catalogo: '00000000-0000-0000-0000-000000000013',
  },
  listas: {
    consumidorFinal: '00000000-0000-0000-0000-000000000020',
    mayorista: '00000000-0000-0000-0000-000000000021',
  },
  // Fallback global cuando un empleado no tiene depósito asignado.
  depositoCentralFallback: '00000000-0000-0000-0000-000000000200',
} as const;
