#!/usr/bin/env python3
"""
Convierte los Excels de inventario (ARTICULOS.xlsx para C11 y
ARTICULOS b12.xlsx para B12) al formato JSON que consume
scripts/importar-stock.mjs.

Salida:
  /tmp/articulos-c11.json
  /tmp/articulos-b12.json

Además imprime una comparación entre los dos archivos para detectar
diferencias en costo, precio y nombre antes de importar.

Uso:
  python3 scripts/excel-a-json.py
"""
import json
import os
import sys

try:
    import openpyxl
except ImportError:
    print("✗ Falta openpyxl. Instalalo con: pip3 install openpyxl", file=sys.stderr)
    sys.exit(1)


# Por default usamos los archivos del Downloads del dueño. Si los Excels
# están en otra ruta, pasarlos por env vars EXCEL_C11 / EXCEL_B12.
ARCHIVOS = [
    (os.environ.get('EXCEL_C11', os.path.expanduser('~/Downloads/ARTICULOS.xlsx')), 'c11'),
    (os.environ.get('EXCEL_B12', os.path.expanduser('~/Downloads/ARTICULOS b12.xlsx')), 'b12'),
]


def num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(',', '.').strip())
    except Exception:
        return None


def cargar(path: str) -> dict:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    col = {name: i for i, name in enumerate(header)}
    productos = []
    cats = set()
    provs = set()
    descartados = {'sin_codigo': 0, 'sin_nombre': 0, 'precio_cero': 0}
    for row in rows[1:]:
        codigo = row[col['Codigo_interno']]
        nombre = row[col['Nombre']]
        if not codigo:
            descartados['sin_codigo'] += 1
            continue
        if not nombre:
            descartados['sin_nombre'] += 1
            continue
        codigo = str(codigo).strip()
        grupo = (row[col['Grupo']] or '').strip() or 'Sin categoría'
        prov = (row[col['Proveedor_1']] or '').strip() or None
        costo = num(row[col['Costo_unidad']]) or 0
        precio = num(row[col['Precio_VTA1']])
        if precio is None or precio == 0:
            descartados['precio_cero'] += 1
            precio = 0  # se importa igual; el cajero puede arreglarlo
        stock = num(row[col['Stock_Actual']]) or 0
        stock_min = num(row[col['Stock_min']])
        estado = row[col['Estado']]
        activo = bool(estado) if estado is not None else True
        descripcion = row[col['Descripcion']]
        productos.append({
            'codigo_interno': codigo,
            'nombre': str(nombre).strip(),
            'categoria': grupo,
            'proveedor': prov,
            'costo': costo,
            'precio_cf': precio,
            'stock': stock,
            'stock_min': stock_min if stock_min is not None else None,
            'activo': activo,
            'descripcion': str(descripcion).strip() if descripcion else None,
        })
        cats.add(grupo)
        if prov:
            provs.add(prov)
    wb.close()
    return {
        'productos': productos,
        'categorias': sorted(cats),
        'proveedores': sorted(provs),
        'descartados': descartados,
    }


def comparar(c11: dict, b12: dict):
    c11_map = {p['codigo_interno']: p for p in c11['productos']}
    b12_map = {p['codigo_interno']: p for p in b12['productos']}
    compartidos = set(c11_map) & set(b12_map)
    solo_c11 = sorted(set(c11_map) - set(b12_map), key=lambda x: int(x) if x.isdigit() else 9_999_999)
    solo_b12 = sorted(set(b12_map) - set(c11_map), key=lambda x: int(x) if x.isdigit() else 9_999_999)
    dif_nombre = sum(1 for c in compartidos if c11_map[c]['nombre'] != b12_map[c]['nombre'])
    dif_costo = sum(1 for c in compartidos if abs(c11_map[c]['costo'] - b12_map[c]['costo']) > 0.01)
    dif_precio = sum(1 for c in compartidos if abs(c11_map[c]['precio_cf'] - b12_map[c]['precio_cf']) > 0.01)
    print("\n━━━ Comparación entre archivos ━━━")
    print(f"Total códigos únicos: {len(set(c11_map) | set(b12_map))}")
    print(f"En ambos: {len(compartidos)}")
    print(f"Solo en C11: {len(solo_c11)}  → {', '.join(solo_c11[:10])}")
    print(f"Solo en B12: {len(solo_b12)}  → {', '.join(solo_b12[:10])}")
    print(f"Diferencias en compartidos: nombre={dif_nombre}, costo={dif_costo}, precio={dif_precio}")


def main():
    datos = {}
    for path, local in ARCHIVOS:
        if not os.path.exists(path):
            print(f"✗ No existe {path}", file=sys.stderr)
            sys.exit(1)
        d = cargar(path)
        datos[local] = d
        print(f"\n{local.upper()}: {len(d['productos'])} productos | {len(d['categorias'])} categorías | {len(d['proveedores'])} proveedores")
        print(f"  - descartados: {d['descartados']}")

    if 'c11' in datos and 'b12' in datos:
        comparar(datos['c11'], datos['b12'])

    for local, d in datos.items():
        out = f'/tmp/articulos-{local}.json'
        # No incluimos 'descartados' en el JSON de salida (solo es info de log)
        out_data = {k: v for k, v in d.items() if k != 'descartados'}
        with open(out, 'w') as f:
            json.dump(out_data, f, ensure_ascii=False)
        print(f"\n✓ {out} ({len(d['productos'])} productos)")


if __name__ == '__main__':
    main()
