/**
 * Helper para subir imágenes de productos a Supabase Storage.
 * Comprime client-side antes de subir:
 *   - Redimensiona a max 1200×1200 manteniendo proporción.
 *   - Convierte a JPEG con calidad 0.8.
 * Resultado típico: 150-300 KB con calidad excelente, vs 3-5 MB del original.
 */

import { createSupabaseRaw } from '@comercio/db';

const BUCKET = 'producto-imagenes';
const MAX_DIM = 1200;
const QUALITY = 0.82;
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024; // 20 MB para el archivo original
const MAX_FINAL_BYTES = 2 * 1024 * 1024; // 2 MB después de comprimir (paranoid)

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

function getClient() {
  if (!URL || !ANON) {
    throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createSupabaseRaw(URL, ANON);
}

export type ImagenComprimida = {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
};

/**
 * Lee el archivo, lo redimensiona en un canvas y devuelve un Blob JPEG.
 */
export async function comprimirImagen(file: File): Promise<ImagenComprimida> {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo no parece ser una imagen.');
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error(
      `La imagen original pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. Máximo permitido: 20 MB.`,
    );
  }

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > MAX_DIM || height > MAX_DIM) {
    if (width >= height) {
      height = Math.round((height * MAX_DIM) / width);
      width = MAX_DIM;
    } else {
      width = Math.round((width * MAX_DIM) / height);
      height = MAX_DIM;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto del canvas.');

  // Fondo blanco para imágenes con transparencia (PNG → JPEG)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY);
  });
  if (!blob) throw new Error('No se pudo comprimir la imagen.');
  if (blob.size > MAX_FINAL_BYTES) {
    throw new Error(
      `La imagen comprimida supera 2 MB. Probá con una más chica o menos detalle.`,
    );
  }
  return { blob, width, height, bytes: blob.size };
}

/**
 * Sube una imagen ya comprimida al bucket. Devuelve la URL pública.
 * El path interno es `{productoId}/{timestamp}.jpg` para evitar colisiones.
 */
export async function subirAStorage(productoId: string, blob: Blob): Promise<string> {
  const supa = getClient();
  const path = `${productoId}/${Date.now()}.jpg`;
  const { error } = await supa.storage.from(BUCKET).upload(path, blob, {
    cacheControl: '31536000', // 1 año
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(`Upload: ${error.message}`);
  const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Borra una imagen del bucket dado su URL pública. Extrae el path desde la URL.
 * Si la URL no apunta a nuestro bucket, no hace nada (silencioso).
 */
export async function borrarDeStorage(url: string): Promise<void> {
  const match = url.match(new RegExp(`/${BUCKET}/(.+)$`));
  if (!match || !match[1]) return; // no es nuestra, no la borramos
  const path = decodeURIComponent(match[1]);
  const supa = getClient();
  await supa.storage.from(BUCKET).remove([path]);
}

/** Wrapper: comprime + sube y devuelve URL. Útil para usar desde el form. */
export async function comprimirYSubir(productoId: string, file: File): Promise<string> {
  const { blob } = await comprimirImagen(file);
  return subirAStorage(productoId, blob);
}
