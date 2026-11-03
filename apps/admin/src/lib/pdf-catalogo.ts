import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calcularPrecioMayorista } from '@comercio/business';
import type { EscalaMayorista, Producto } from '@comercio/db';

export type ProductoParaPdf = Producto & { precio_cf?: number };

/** Qué precio(s) mostrar en el PDF. */
export type ColumnasPrecio = 'local' | 'mayorista' | 'ambos';

export type GenerarCatalogoInput = {
  productos: ProductoParaPdf[];
  categoriaNombrePorId: (id: string | null | undefined) => string;
  descuentoGlobalPct: number;
  escalasGlobales: EscalaMayorista[];
  empresa?: { nombre?: string; direccion?: string; telefono?: string };
  /** Título arriba del PDF. Default: "Catálogo mayorista". */
  titulo?: string;
  /** Columnas de precio a mostrar. Default: 'mayorista' (compat). */
  columnasPrecio?: ColumnasPrecio;
  /** Filtrar por publicado_web = true. Default: true (compat). */
  soloPublicados?: boolean;
};

const SIN_CATEGORIA = 'Sin categoría';

function precioMayorista(
  producto: ProductoParaPdf,
  descuentoGlobalPct: number,
  escalasGlobales: EscalaMayorista[],
): number {
  const r = calcularPrecioMayorista({
    precioCF: producto.precio_cf ?? 0,
    descuentoOverridePct: producto.descuento_mayorista_pct_override ?? null,
    descuentoGlobalPct,
    escalas: escalasGlobales,
    cantidad: 1,
  });
  return r.precio;
}

function formatearPrecio(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function generarCatalogoPdf({
  productos,
  categoriaNombrePorId,
  descuentoGlobalPct,
  escalasGlobales,
  empresa,
  titulo,
  columnasPrecio = 'mayorista',
  soloPublicados = true,
}: GenerarCatalogoInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const anchoPagina = doc.internal.pageSize.getWidth();
  const margenLateral = 40;

  const publicados = soloPublicados
    ? productos.filter((p) => p.publicado_web)
    : productos;

  // Agrupar por categoría (nombre)
  const porCategoria = new Map<string, ProductoParaPdf[]>();
  for (const p of publicados) {
    const cat = categoriaNombrePorId(p.categoria_id) || SIN_CATEGORIA;
    const arr = porCategoria.get(cat) ?? [];
    arr.push(p);
    porCategoria.set(cat, arr);
  }
  // Orden: alfabético por categoría, "Sin categoría" al final.
  const categoriasOrdenadas = [...porCategoria.entries()].sort((a, b) => {
    if (a[0] === SIN_CATEGORIA) return 1;
    if (b[0] === SIN_CATEGORIA) return -1;
    return a[0].localeCompare(b[0], 'es');
  });

  // ─── Encabezado del PDF ──────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(titulo ?? 'Catálogo mayorista', margenLateral, 50);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const fecha = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  doc.setTextColor(120);
  doc.text(
    `${empresa?.nombre ?? 'Turisteando'} — actualizado ${fecha}`,
    margenLateral,
    68,
  );
  doc.text(
    `${publicados.length} productos publicados en ${categoriasOrdenadas.length} categoría(s)`,
    margenLateral,
    82,
  );
  doc.setTextColor(0);

  // ─── Una tabla por categoría, con encabezado propio ─────────────────
  let cursorY = 105;

  for (const [nombreCat, items] of categoriasOrdenadas) {
    // Sub-encabezado de categoría
    if (cursorY > 720) {
      doc.addPage();
      cursorY = 50;
    }
    doc.setFillColor(30, 41, 59); // slate-800
    doc.rect(margenLateral, cursorY, anchoPagina - margenLateral * 2, 20, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255);
    doc.text(
      `${nombreCat}   ·   ${items.length} producto${items.length === 1 ? '' : 's'}`,
      margenLateral + 8,
      cursorY + 14,
    );
    doc.setTextColor(0);
    cursorY += 22;

    // Ordenar items por nombre dentro de cada categoría.
    const ordenados = [...items].sort((a, b) =>
      (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'),
    );
    const filas = ordenados.map((p) => {
      const codigo = p.codigo_interno;
      const nombre = p.nombre_web?.trim() || p.nombre;
      const local = formatearPrecio(p.precio_cf ?? 0);
      const mayorista = formatearPrecio(
        precioMayorista(p, descuentoGlobalPct, escalasGlobales),
      );
      if (columnasPrecio === 'local') return [codigo, nombre, local];
      if (columnasPrecio === 'ambos') return [codigo, nombre, local, mayorista];
      return [codigo, nombre, mayorista];
    });

    const head =
      columnasPrecio === 'ambos'
        ? [['Código', 'Producto', 'Precio local', 'Precio mayorista']]
        : columnasPrecio === 'local'
          ? [['Código', 'Producto', 'Precio local']]
          : [['Código', 'Producto', 'Precio mayorista']];

    const columnStyles: Record<string, Record<string, unknown>> =
      columnasPrecio === 'ambos'
        ? {
            0: { cellWidth: 55, halign: 'center' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 90, halign: 'right' },
            3: { cellWidth: 100, halign: 'right', fontStyle: 'bold' },
          }
        : {
            0: { cellWidth: 60, halign: 'center' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 110, halign: 'right', fontStyle: 'bold' },
          };

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margenLateral, right: margenLateral },
      head,
      body: filas,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4, textColor: 20 },
      headStyles: {
        fillColor: [241, 245, 249], // slate-100
        textColor: 30,
        fontStyle: 'bold',
      },
      columnStyles,
      didDrawPage: (data) => {
        // Numeración de página en el pie.
        const alto = doc.internal.pageSize.getHeight();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          `Página ${data.pageNumber}`,
          anchoPagina - margenLateral,
          alto - 20,
          { align: 'right' },
        );
        doc.setTextColor(0);
      },
    });

    // Continuar debajo de la tabla que acaba de dibujarse.
    // @ts-expect-error jspdf-autotable extiende doc con `lastAutoTable`
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 18;
  }

  return doc;
}
