import { z } from 'zod';

export const productoSchema = z.object({
  codigo_interno: z
    .string()
    .regex(/^\d{1,5}$/, 'Código interno: 1 a 5 dígitos')
    .min(1),
  nombre: z.string().min(1, 'Nombre requerido').max(200),
  descripcion: z.string().max(500).optional(),
  descripcion_larga: z.string().max(5000).optional(),
  categoria_id: z.string().uuid().or(z.string().min(1)),
  proveedor_id: z.string().uuid().or(z.string().min(1)).optional(),
  costo: z.number().nonnegative().default(0),
  publicado_web: z.boolean().default(false),
  activo: z.boolean().default(true),
});

export const clienteSchema = z.object({
  nombre: z.string().min(1),
  apellido: z.string().min(1),
  dni: z
    .string()
    .regex(/^\d{6,9}$/, 'DNI: 6 a 9 dígitos')
    .optional()
    .or(z.literal('')),
  direccion: z.string().max(200).optional(),
  codigo_postal: z.string().max(10).optional(),
  telefono: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  lista_precio_id: z.string().min(1),
});

export const empleadoSchema = z.object({
  nombre: z.string().min(1),
  apellido: z.string().min(1),
  email: z.string().email(),
  rol_id: z.string().min(1),
  local_id: z.string().min(1).optional(),
  deposito_id: z.string().min(1).optional(),
  activo: z.boolean().default(true),
});

export type ProductoInput = z.infer<typeof productoSchema>;
export type ClienteInput = z.infer<typeof clienteSchema>;
export type EmpleadoInput = z.infer<typeof empleadoSchema>;
