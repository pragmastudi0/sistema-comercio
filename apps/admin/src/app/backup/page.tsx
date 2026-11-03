'use client';

import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Download, Lock, Database, FileSpreadsheet, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { toast } from 'sonner';
import { useSesion } from '@/stores/sesion';
import { getDb } from '@/lib/db';
import { PRESET_IDS } from '@comercio/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@comercio/ui/card';
import { Button } from '@comercio/ui/button';
import { Input } from '@comercio/ui/input';
import { Label } from '@comercio/ui/label';
import { PaginaProtegida } from '@/lib/permisos';

/**
 * Limpia un nombre para que sea válido en sistemas de archivos (Windows
 * es el más restrictivo). Quita / \ : * ? " < > | y comas/puntos al final.
 * También trunca a 100 chars.
 */
function sanitizarParaFS(nombre: string): string {
  return nombre
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/[.,\s]+$/, '')
    .trim()
    .slice(0, 100) || 'sin-nombre';
}

const ADMIN_ROLE_ID = PRESET_IDS.roles.admin;

const LABEL_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR',
  cta_cte: 'Cta corriente',
};

const LABEL_ESTADO: Record<string, string> = {
  completada: 'Completada',
  anulada: 'Anulada',
  presupuesto: 'Presupuesto',
};

const LABEL_TIPO_MOV_CAJA: Record<string, string> = {
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  retiro: 'Retiro',
  cobro: 'Cobro',
  anulacion: 'Anulación',
};

const LABEL_TIPO_MOV_STOCK: Record<string, string> = {
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  ajuste: 'Ajuste',
  merma: 'Merma',
  venta: 'Venta',
  anulacion_venta: 'Anulación de venta',
  nota_credito: 'Nota de crédito',
  transferencia_salida: 'Transf. salida',
  transferencia_entrada: 'Transf. entrada',
};

function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function BackupPageInner() {
  const db = getDb();
  const empleado = useSesion((s) => s.empleado);
  const esAdmin = empleado?.rol_id === ADMIN_ROLE_ID;

  const hoy = format(new Date(), 'yyyy-MM-dd');
  const haceMes = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const [desde, setDesde] = useState(haceMes);
  const [hasta, setHasta] = useState(hoy);
  const [generando, setGenerando] = useState(false);
  const [progreso, setProgreso] = useState<string>('');
  const [incluirImagenes, setIncluirImagenes] = useState(false);

  async function generarBackup() {
    if (!esAdmin) {
      toast.error('Solo el rol Admin puede generar backups');
      return;
    }
    if (!desde || !hasta) {
      toast.error('Indicá un rango de fechas');
      return;
    }
    if (desde > hasta) {
      toast.error('La fecha "Desde" no puede ser mayor a "Hasta"');
      return;
    }

    setGenerando(true);
    setProgreso('Preparando…');

    try {
      const desdeISO = new Date(`${desde}T00:00:00`).toISOString();
      const hastaISO = new Date(`${hasta}T23:59:59`).toISOString();

      // 1) Cargar diccionarios (productos / empleados / locales / cajas /
      //    depósitos / clientes) — para resolver UUIDs a nombres en las
      //    columnas del XLSX. Se hace una sola vez.
      setProgreso('Cargando catálogos…');
      const [productos, empleados, locales, cajas, depositos, clientes] =
        await Promise.all([
          db.productos.list(),
          db.empleados.list(),
          db.locales.list(),
          db.cajas.list(),
          db.depositos.list(),
          db.clientes.list(),
        ]);

      const prodPorId = new Map(productos.map((p) => [p.id, p]));
      const empPorId = new Map(empleados.map((e) => [e.id, e]));
      const locPorId = new Map(locales.map((l) => [l.id, l]));
      const cajaPorId = new Map(cajas.map((c) => [c.id, c]));
      const depPorId = new Map(depositos.map((d) => [d.id, d]));
      const cliPorId = new Map(clientes.map((c) => [c.id, c]));

      const productoLabel = (id: string) => {
        const p = prodPorId.get(id);
        return p ? `${p.codigo_interno} · ${p.nombre}` : id;
      };
      const productoCodigo = (id: string) => prodPorId.get(id)?.codigo_interno ?? '';
      const productoNombre = (id: string) => prodPorId.get(id)?.nombre ?? '';
      const empleadoNombre = (id?: string | null) => {
        if (!id) return '';
        const e = empPorId.get(id);
        return e ? `${e.nombre} ${e.apellido}` : id;
      };
      const localNombre = (id?: string | null) => (id ? locPorId.get(id)?.nombre ?? id : '');
      const cajaNombre = (id?: string | null) => (id ? cajaPorId.get(id)?.nombre ?? id : '');
      const depositoNombre = (id?: string | null) =>
        id ? depPorId.get(id)?.nombre ?? id : '';
      const clienteNombre = (id?: string | null) => {
        if (!id) return 'Consumidor final';
        const c = cliPorId.get(id);
        if (!c) return id;
        return `${c.nombre} ${c.apellido}`.trim() || c.id;
      };

      // 2) Cargar datos transaccionales del rango + snapshot de stock.
      //    Stock NO depende del rango — es la foto al momento del backup,
      //    para que Agus pueda saber exactamente qué tenía en cada local
      //    si después necesita reconstruir o auditar.
      setProgreso('Descargando ventas, sesiones, movimientos, stock…');
      const [ventas, sesiones, movsStock, notasCredito, stockActual] = await Promise.all([
        db.ventas.list({ desde: desdeISO, hasta: hastaISO }),
        db.sesionesCaja.list({ desde: desdeISO, hasta: hastaISO }),
        db.stock.movimientos({ desde: desdeISO, hasta: hastaISO }),
        db.notasCredito.list({ desde: desdeISO, hasta: hastaISO }),
        db.stock.consolidado({}),
      ]);

      setProgreso('Descargando movimientos de caja…');
      const movsCajaPorSesion = await Promise.all(
        sesiones.map((s) => db.sesionesCaja.movimientos(s.id)),
      );
      const movsCaja = movsCajaPorSesion.flat();

      // 3) Armar las hojas del workbook con columnas humanas.
      setProgreso('Generando hojas Excel…');

      const ventasRows = ventas.map((v) => ({
        'N°': v.numero,
        Fecha: fmtFecha(v.fecha),
        Estado: LABEL_ESTADO[v.estado] ?? v.estado,
        Local: localNombre(v.local_id),
        Caja: cajaNombre(v.caja_id),
        Cajero: empleadoNombre(v.empleado_id),
        Cliente: clienteNombre(v.cliente_id),
        Items: v.items.reduce((a, i) => a + i.cantidad, 0),
        Subtotal: v.subtotal,
        Descuento: v.descuento_total,
        Recargo: v.recargo_total,
        Total: v.total,
        'Anulada por': empleadoNombre(v.anulada_por),
        'Anulada en': fmtFecha(v.anulada_en),
        'Motivo anulación': v.motivo_anulacion ?? '',
      }));

      const itemsRows = ventas.flatMap((v) =>
        v.items.map((it) => ({
          'Venta N°': v.numero,
          Fecha: fmtFecha(v.fecha),
          Código: productoCodigo(it.producto_id),
          Producto: productoNombre(it.producto_id),
          Cantidad: it.cantidad,
          'Precio unitario': it.precio_unitario,
          'Descuento %': it.descuento_pct ?? 0,
          Subtotal: it.subtotal,
        })),
      );

      const pagosRows = ventas.flatMap((v) =>
        v.pagos.map((p) => ({
          'Venta N°': v.numero,
          Fecha: fmtFecha(v.fecha),
          Método: LABEL_METODO[p.metodo] ?? p.metodo,
          Monto: p.monto,
          Cuotas: p.cuotas ?? '',
          'Recargo %': p.recargo_pct ?? 0,
        })),
      );

      const sesionesRows = sesiones.map((s) => {
        const cerrada = (s as { cerrada_en?: string }).cerrada_en;
        return {
          Caja: cajaNombre(s.caja_id),
          Cajero: empleadoNombre(s.empleado_id),
          'Saldo inicial': s.saldo_inicial,
          'Saldo declarado': s.saldo_final_declarado ?? '',
          Apertura: fmtFecha(s.abierta_en),
          Cierre: fmtFecha(cerrada ?? null),
          Estado: cerrada ? 'Cerrada' : 'Abierta',
        };
      });

      // Para movimientos de caja necesitamos saber a qué sesión pertenecen
      // para mostrar Caja/Cajero en cada fila — los buscamos por id.
      const sesionPorId = new Map(sesiones.map((s) => [s.id, s]));
      const movsCajaRows = movsCaja.map((m) => {
        const sesion = sesionPorId.get(m.sesion_caja_id);
        return {
          Fecha: fmtFecha(m.fecha),
          Caja: cajaNombre(sesion?.caja_id),
          Cajero: empleadoNombre(m.empleado_id),
          Tipo: LABEL_TIPO_MOV_CAJA[m.tipo] ?? m.tipo,
          Método: LABEL_METODO[m.metodo] ?? m.metodo,
          Monto: m.monto,
          'Motivo / Ref': (m as { motivo?: string }).motivo ?? '',
        };
      });

      const movsStockRows = movsStock.map((m) => ({
        Fecha: fmtFecha(m.fecha),
        Código: productoCodigo(m.producto_id),
        Producto: productoNombre(m.producto_id),
        Local: depositoNombre(m.deposito_id),
        Tipo: LABEL_TIPO_MOV_STOCK[m.tipo] ?? m.tipo,
        Cantidad: m.cantidad,
        Empleado: empleadoNombre(m.empleado_id),
        Motivo: (m as { motivo?: string }).motivo ?? '',
      }));

      // Snapshot del stock al momento del backup — una fila por
       // (producto × depósito), con cantidad actual y mínimo configurado.
       // Filtramos productos que no existen más en el catálogo (huérfanos
       // por borrado) para no tener filas sin código/nombre.
      const stockRows = stockActual
        .filter((s) => prodPorId.has(s.producto_id))
        .map((s) => {
          const cant = Number(s.cantidad);
          return {
            Código: productoCodigo(s.producto_id),
            Producto: productoNombre(s.producto_id),
            Local: depositoNombre(s.deposito_id),
            Cantidad: cant,
            Mínimo: s.minimo ?? 0,
            'Bajo mínimo': cant <= (s.minimo ?? 0) ? 'SÍ' : '',
            'Sin stock': cant <= 0 ? 'SÍ' : '',
          };
        })
        .sort((a, b) => {
          const c = a.Local.localeCompare(b.Local);
          return c !== 0 ? c : a.Producto.localeCompare(b.Producto);
        });

      const ncRows = notasCredito.map((n) => ({
        'N°': n.numero,
        Fecha: fmtFecha(n.fecha),
        'Venta original': ventas.find((v) => v.id === n.venta_id)?.numero ?? n.venta_id,
        Empleado: empleadoNombre(n.empleado_id),
        Motivo: n.motivo,
        Total: n.monto_total,
      }));

      const ncItemsRows = notasCredito.flatMap((n) =>
        n.items.map((it) => ({
          'NC N°': n.numero,
          Fecha: fmtFecha(n.fecha),
          Código: productoCodigo(it.producto_id),
          Producto: productoNombre(it.producto_id),
          Cantidad: it.cantidad,
          'Precio unitario': it.precio_unitario,
          Subtotal: it.subtotal,
        })),
      );

      const clientesRows = clientes.map((c) => ({
        Nombre: `${c.nombre} ${c.apellido}`.trim(),
        DNI: c.dni ?? '',
        CUIT: c.cuit ?? '',
        Teléfono: c.telefono ?? '',
        Email: c.email ?? '',
        Dirección: c.direccion ?? '',
        'C. Postal': c.codigo_postal ?? '',
        'Límite crédito': c.limite_credito ?? '',
        Saldo: c.saldo,
        Suspendido: c.suspendido ? 'Sí' : 'No',
        Activo: c.activo ? 'Sí' : 'No',
        'Alta del cliente': fmtFecha(c.creado_en),
      }));

      const resumenRows = [
        { Concepto: '#Turisteando — Backup transaccional', Valor: '' },
        { Concepto: 'Rango', Valor: `${desde} → ${hasta}` },
        { Concepto: 'Generado', Valor: new Date().toLocaleString('es-AR') },
        {
          Concepto: 'Generado por',
          Valor: `${empleado?.nombre ?? ''} ${empleado?.apellido ?? ''}`.trim(),
        },
        { Concepto: '', Valor: '' },
        { Concepto: 'Ventas totales', Valor: ventas.length },
        {
          Concepto: '  · completadas',
          Valor: ventas.filter((v) => v.estado === 'completada').length,
        },
        {
          Concepto: '  · anuladas',
          Valor: ventas.filter((v) => v.estado === 'anulada').length,
        },
        {
          Concepto: '  · presupuestos',
          Valor: ventas.filter((v) => v.estado === 'presupuesto').length,
        },
        {
          Concepto: 'Total facturado (completadas)',
          Valor: ventas
            .filter((v) => v.estado === 'completada')
            .reduce((a, v) => a + v.total, 0),
        },
        {
          Concepto: 'Total descuentos (completadas)',
          Valor: ventas
            .filter((v) => v.estado === 'completada')
            .reduce((a, v) => a + (v.descuento_total ?? 0), 0),
        },
        { Concepto: 'Sesiones de caja', Valor: sesiones.length },
        { Concepto: 'Movimientos de caja', Valor: movsCaja.length },
        { Concepto: 'Movimientos de stock', Valor: movsStock.length },
        { Concepto: 'Stock — filas (producto × local)', Valor: stockRows.length },
        {
          Concepto: 'Stock — productos bajo mínimo',
          Valor: stockRows.filter((r) => r['Bajo mínimo'] === 'SÍ').length,
        },
        {
          Concepto: 'Stock — productos sin stock',
          Valor: stockRows.filter((r) => r['Sin stock'] === 'SÍ').length,
        },
        { Concepto: 'Notas de crédito', Valor: notasCredito.length },
        { Concepto: 'Clientes (snapshot)', Valor: clientes.length },
      ];

      // 4) Construir el workbook.
      setProgreso('Comprimiendo Excel…');
      const wb = XLSX.utils.book_new();

      const append = (sheetName: string, rows: Record<string, unknown>[]) => {
        // Si la hoja está vacía meto una sola fila con texto explicativo
        // para que la pestaña no quede vacía y confunda.
        const data =
          rows.length > 0
            ? rows
            : [{ '(sin datos)': 'No hubo registros en el rango seleccionado' }];
        const ws = XLSX.utils.json_to_sheet(data);
        // Ajustar ancho de columnas según contenido (heurística simple).
        const cols = Object.keys(data[0]!);
        ws['!cols'] = cols.map((k) => {
          const maxLen = Math.max(
            k.length,
            ...data.map((r) => String(r[k] ?? '').length),
          );
          return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
        });
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      };

      append('Resumen', resumenRows);
      append('Ventas', ventasRows);
      append('Items vendidos', itemsRows);
      append('Pagos', pagosRows);
      append('Cajas', sesionesRows);
      append('Movimientos caja', movsCajaRows);
      append('Movimientos stock', movsStockRows);
      append('Stock al momento', stockRows);
      append('Notas crédito', ncRows);
      append('NC - items', ncItemsRows);
      append('Clientes', clientesRows);

      // 5) Empaquetar.
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const xlsxBlob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      let downloadBlob: Blob;
      let downloadName: string;

      if (incluirImagenes) {
        // Backup completo: ZIP con XLSX + carpeta imagenes/ organizada por
        // producto. Descargamos las imágenes una por una de Supabase Storage
        // (URL pública), informando progreso.
        setProgreso('Descargando imágenes…');
        const zip = new JSZip();
        zip.file(`turisteando-backup_${desde}_${hasta}.xlsx`, xlsxBlob);
        const imgsFolder = zip.folder('imagenes')!;

        // Para no saturar: solo productos ACTIVOS. Si bajáramos los borrados
        // o publicados=false al final no aportan.
        const productosActivos = productos.filter((p) => p.activo);
        let descargadas = 0;
        let omitidas = 0;
        const errores: string[] = [];
        for (let i = 0; i < productosActivos.length; i++) {
          const p = productosActivos[i]!;
          if (i % 25 === 0) {
            setProgreso(
              `Descargando imágenes · ${i}/${productosActivos.length} productos`,
            );
          }
          try {
            const imgs = await db.productos.imagenes(p.id);
            if (imgs.length === 0) {
              omitidas++;
              continue;
            }
            const subdir =
              `${sanitizarParaFS(p.codigo_interno)} - ${sanitizarParaFS(p.nombre)}`;
            const prodFolder = imgsFolder.folder(subdir)!;
            for (let j = 0; j < imgs.length; j++) {
              const img = imgs[j]!;
              try {
                const res = await fetch(img.url);
                if (!res.ok) {
                  errores.push(`${subdir}/img-${j + 1}: HTTP ${res.status}`);
                  continue;
                }
                const blob = await res.blob();
                // Tomamos la extensión del Content-Type, default jpg.
                const ext = blob.type.split('/')[1]?.split(';')[0] || 'jpg';
                prodFolder.file(`img-${j + 1}.${ext}`, blob);
                descargadas++;
              } catch (e) {
                errores.push(`${subdir}/img-${j + 1}: ${(e as Error).message}`);
              }
            }
          } catch (e) {
            errores.push(`${p.nombre}: ${(e as Error).message}`);
          }
        }

        // Sumamos un README.txt con resumen y errores.
        const readme = [
          'TURISTEANDO — BACKUP COMPLETO',
          '================================',
          '',
          `Generado: ${new Date().toLocaleString('es-AR')}`,
          `Rango de datos: ${desde} → ${hasta}`,
          '',
          'CONTENIDO',
          `· turisteando-backup_${desde}_${hasta}.xlsx — todas las operaciones del rango`,
          `· imagenes/ — fotos de productos activos`,
          '',
          'IMÁGENES',
          `· ${descargadas} archivos descargados`,
          `· ${omitidas} productos sin imágenes cargadas`,
          `· ${errores.length} errores (ver lista abajo)`,
          '',
          errores.length > 0 ? 'ERRORES' : '',
          ...errores.slice(0, 50),
          errores.length > 50 ? `… y ${errores.length - 50} más` : '',
        ]
          .filter(Boolean)
          .join('\n');
        zip.file('LEEME.txt', readme);

        setProgreso('Comprimiendo ZIP…');
        downloadBlob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        });
        downloadName = `turisteando-backup-completo_${desde}_${hasta}.zip`;

        toast.success(
          `Backup completo · ${ventas.length} ventas + ${descargadas} imágenes`,
        );
      } else {
        downloadBlob = xlsxBlob;
        downloadName = `turisteando-backup_${desde}_${hasta}.xlsx`;
        toast.success(
          `Backup generado · ${ventas.length} ventas, ${sesiones.length} sesiones`,
        );
      }

      // Disparar la descarga.
      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      setProgreso('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      toast.error(`Error generando backup: ${msg}`);
      setProgreso('');
    } finally {
      setGenerando(false);
    }
  }

  if (!esAdmin) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Acceso restringido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Esta sección solo está disponible para el rol <b>Admin</b>. Pedile al dueño que
              te genere el backup, o que te cambie el rol si necesitás acceso permanente.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Backup de datos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Descargá un archivo <code>.xlsx</code> que se abre directo en Excel o Google Sheets.
          Sirve como respaldo, para auditoría o para pasar al contador.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Generar backup transaccional
          </CardTitle>
          <CardDescription>
            Incluye: ventas (cabeceras, items y pagos), movimientos de caja, movimientos de
            stock, notas de crédito y snapshot de clientes. Cada sección es una hoja del
            Excel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bk-desde" className="mb-1 block">
                Desde
              </Label>
              <Input
                id="bk-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                disabled={generando}
              />
            </div>
            <div>
              <Label htmlFor="bk-hasta" className="mb-1 block">
                Hasta
              </Label>
              <Input
                id="bk-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                disabled={generando}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDesde(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
                setHasta(hoy);
              }}
              disabled={generando}
            >
              Últimos 7 días
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDesde(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
                setHasta(hoy);
              }}
              disabled={generando}
            >
              Últimos 30 días
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDesde(format(subDays(new Date(), 90), 'yyyy-MM-dd'));
                setHasta(hoy);
              }}
              disabled={generando}
            >
              Últimos 90 días
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDesde('2024-01-01');
                setHasta(hoy);
              }}
              disabled={generando}
            >
              Todo
            </Button>
          </div>

          <label
            htmlFor="incluir-imgs"
            className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm transition hover:border-foreground/30"
          >
            <input
              id="incluir-imgs"
              type="checkbox"
              checked={incluirImagenes}
              onChange={(e) => setIncluirImagenes(e.target.checked)}
              disabled={generando}
              className="mt-0.5 h-4 w-4"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 font-medium">
                <ImageIcon className="h-4 w-4" />
                Incluir imágenes de productos
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Descarga las fotos de Supabase Storage y las empaqueta en una
                carpeta <code>imagenes/</code> con subcarpetas por producto
                (código + nombre). Tarda más (~5–10 min con 1900 productos)
                pero te queda un backup 100% offline.
              </div>
            </div>
          </label>

          <Button
            type="button"
            onClick={generarBackup}
            disabled={generando}
            className="w-full sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />
            {generando
              ? progreso || 'Generando…'
              : incluirImagenes
                ? 'Descargar backup completo (.zip)'
                : 'Descargar backup (.xlsx)'}
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" />
            Hojas que incluye el Excel
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="space-y-1.5 text-muted-foreground">
            <li>
              <b className="text-foreground">Resumen</b> — totales del período (ventas,
              facturado, descuentos, anulaciones, etc.)
            </li>
            <li>
              <b className="text-foreground">Ventas</b> — N°, fecha, cajero, cliente, total y
              estado
            </li>
            <li>
              <b className="text-foreground">Items vendidos</b> — código + nombre del
              producto, cantidad, precio
            </li>
            <li>
              <b className="text-foreground">Pagos</b> — método y monto por venta
            </li>
            <li>
              <b className="text-foreground">Cajas</b> — apertura/cierre por cajero
            </li>
            <li>
              <b className="text-foreground">Movimientos caja</b> — ingresos / egresos /
              retiros / cobros
            </li>
            <li>
              <b className="text-foreground">Movimientos stock</b> — entradas, salidas,
              ajustes, mermas
            </li>
            <li>
              <b className="text-foreground">Notas crédito</b> + <b className="text-foreground">NC - items</b> — devoluciones
            </li>
            <li>
              <b className="text-foreground">Clientes</b> — listado completo (snapshot al
              momento)
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="mt-4 border-amber-200 bg-amber-50">
        <CardContent className="flex gap-3 pt-6 text-sm">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-700" />
          <div className="text-amber-900">
            <b>Guardá los backups en un lugar seguro</b> (Google Drive, Dropbox, disco
            externo). Te recomendamos generar uno al cierre de cada mes y antes de cualquier
            cambio importante (alta masiva de productos, importación de catálogo, etc.).
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default function BackupPage() {
  return (
    <PaginaProtegida modulo="configuracion" accion="backup_restore">
      <BackupPageInner />
    </PaginaProtegida>
  );
}
