-- Políticas RLS para el bucket producto-imagenes
-- · INSERT/UPDATE/DELETE: solo usuarios autenticados (cualquiera del admin)
-- · SELECT: público (para que el ecommerce las pueda mostrar sin login)
--
-- El bucket en sí se crea via la REST API de Storage (file_size_limit 3 MB,
-- mime types jpeg/png/webp). Esto solo configura quién puede operar sobre
-- los objetos almacenados.

-- Limpiar políticas previas con el mismo nombre por si re-corremos
drop policy if exists "producto_imagenes_select_publico" on storage.objects;
drop policy if exists "producto_imagenes_insert_auth"    on storage.objects;
drop policy if exists "producto_imagenes_update_auth"    on storage.objects;
drop policy if exists "producto_imagenes_delete_auth"    on storage.objects;

create policy "producto_imagenes_select_publico"
on storage.objects for select to public
using (bucket_id = 'producto-imagenes');

create policy "producto_imagenes_insert_auth"
on storage.objects for insert to authenticated
with check (bucket_id = 'producto-imagenes');

create policy "producto_imagenes_update_auth"
on storage.objects for update to authenticated
using (bucket_id = 'producto-imagenes');

create policy "producto_imagenes_delete_auth"
on storage.objects for delete to authenticated
using (bucket_id = 'producto-imagenes');
