'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Image as ImageIcon, Upload, Link as LinkIcon } from 'lucide-react';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { Skeleton } from '@comercio/ui/skeleton';
import { borrarDeStorage, comprimirYSubir } from '@/lib/upload-imagen';

const MAX_IMAGENES = 3;

/**
 * Gestor de imágenes de un producto. Soporta:
 * · Subida desde la PC (Supabase Storage, comprime client-side).
 * · Pegar una URL externa (Drive, imgur, etc.) — útil si la imagen ya está
 *   alojada en otro lado.
 */
export function ImagenesProducto({ productoId }: { productoId: string }) {
  const db = getDb();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [nuevaUrl, setNuevaUrl] = useState('');
  const [arrastrando, setArrastrando] = useState(false);

  const imagenesQ = useQuery({
    queryKey: ['imagenes', productoId],
    queryFn: () => db.productos.imagenes(productoId),
  });

  const agregarMut = useMutation({
    mutationFn: (url: string) => db.productos.agregarImagen(productoId, url.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['imagenes', productoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const subirMut = useMutation({
    mutationFn: async (file: File) => {
      const url = await comprimirYSubir(productoId, file);
      return db.productos.agregarImagen(productoId, url);
    },
    onSuccess: () => {
      toast.success('Imagen subida');
      qc.invalidateQueries({ queryKey: ['imagenes', productoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: async (img: { id: string; url: string }) => {
      // Si la imagen vive en nuestro bucket, borrarla del Storage también.
      await borrarDeStorage(img.url).catch(() => {
        /* si no es nuestra, no rompemos */
      });
      await db.productos.eliminarImagen(img.id);
    },
    onSuccess: () => {
      toast.success('Imagen eliminada');
      qc.invalidateQueries({ queryKey: ['imagenes', productoId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const imagenes = imagenesQ.data ?? [];
  const lleno = imagenes.length >= MAX_IMAGENES;
  const subiendo = subirMut.isPending;

  function manejarArchivos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const cupo = MAX_IMAGENES - imagenes.length;
    if (cupo <= 0) {
      toast.error('Ya alcanzaste el máximo de imágenes');
      return;
    }
    const seleccionados = Array.from(files).slice(0, cupo);
    if (files.length > cupo) {
      toast.info(`Solo subo ${cupo} (alcanzas el máximo de ${MAX_IMAGENES})`);
    }
    // Subir en serie para que el progreso sea visible y no saturemos.
    (async () => {
      for (const f of seleccionados) {
        try {
          await subirMut.mutateAsync(f);
        } catch {
          // El onError ya muestra toast; seguimos con la próxima.
        }
      }
    })();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="h-4 w-4" />
          Imágenes del producto
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Hasta {MAX_IMAGENES} imágenes. Se muestran en el e-commerce. La primera es la
          principal.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {imagenesQ.isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {imagenes.map((img, i) => (
              <div
                key={img.id}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted/30"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`Imagen ${i + 1}`}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.opacity = '0.3';
                  }}
                />
                {i === 0 && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-foreground/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-background">
                    Principal
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('¿Eliminar esta imagen?'))
                      eliminarMut.mutate({ id: img.id, url: img.url });
                  }}
                  className="absolute right-1.5 top-1.5 rounded-full bg-background/95 p-1.5 opacity-0 shadow-sm transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                  title="Eliminar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {/* Slot vacío clickeable para subir directo desde el grid */}
            {!lleno && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setArrastrando(true);
                }}
                onDragLeave={() => setArrastrando(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setArrastrando(false);
                  manejarArchivos(e.dataTransfer.files);
                }}
                disabled={subiendo}
                className={`flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md border border-dashed bg-muted/10 text-xs text-muted-foreground transition-colors hover:border-foreground hover:bg-accent ${
                  arrastrando ? 'border-foreground bg-accent' : ''
                } ${subiendo ? 'opacity-50' : ''}`}
              >
                {subiendo ? (
                  <span>Subiendo…</span>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    <span className="px-2 text-center leading-tight">
                      Subir o arrastrar imagen
                    </span>
                  </>
                )}
              </button>
            )}
            {/* Placeholder vacíos para el resto */}
            {Array.from({
              length: Math.max(0, MAX_IMAGENES - imagenes.length - 1),
            }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="flex aspect-square items-center justify-center rounded-md border border-dashed bg-muted/10 text-muted-foreground"
              >
                <ImageIcon className="h-6 w-6 opacity-30" />
              </div>
            ))}
          </div>
        )}

        {/* File input invisible que dispara el botón */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            manejarArchivos(e.target.files);
            // Reset para que se pueda volver a subir la misma imagen
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 flex items-center gap-1.5 text-xs">
              <Upload className="h-3 w-3" />
              Desde la PC
            </Label>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={lleno || subiendo}
            >
              {subiendo ? 'Subiendo…' : 'Elegir archivo'}
            </Button>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Se redimensiona a 1200px y comprime automáticamente (~200 KB).
            </p>
          </div>

          <div>
            <Label
              htmlFor="img-url"
              className="mb-1 flex items-center gap-1.5 text-xs"
            >
              <LinkIcon className="h-3 w-3" />
              Por URL (Drive, imgur, etc)
            </Label>
            <div className="flex gap-2">
              <Input
                id="img-url"
                type="url"
                placeholder="https://..."
                value={nuevaUrl}
                onChange={(e) => setNuevaUrl(e.target.value)}
                disabled={lleno}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  if (!nuevaUrl.trim()) return;
                  if (!/^https?:\/\//i.test(nuevaUrl.trim())) {
                    toast.error('La URL debe empezar con http:// o https://');
                    return;
                  }
                  agregarMut.mutate(nuevaUrl, {
                    onSuccess: () => {
                      toast.success('Imagen agregada');
                      setNuevaUrl('');
                    },
                  });
                }}
                disabled={lleno || !nuevaUrl.trim() || agregarMut.isPending}
                title="Agregar URL"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {lleno && (
          <p className="text-xs text-muted-foreground">
            Alcanzaste el máximo de {MAX_IMAGENES} imágenes. Eliminá una para sumar otra.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
