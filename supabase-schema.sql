-- ============================================
-- VELOCE TALLER - Schema de base de datos
-- ============================================
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → pegar todo → Run

-- ===== TABLAS =====

-- Clientes
create table clientes (
  id text primary key, -- cédula o identificador único
  nombre text not null,
  tel text not null,
  email text,
  created_at timestamptz default now()
);

-- Bicicletas (relacionadas a clientes)
create table bicicletas (
  id uuid primary key default gen_random_uuid(),
  cliente_id text references clientes(id) on delete cascade,
  marca text not null,
  modelo text not null,
  color text,
  serie text,
  anio int,
  created_at timestamptz default now()
);

create index idx_bicicletas_cliente on bicicletas(cliente_id);

-- Órdenes de trabajo
create table ordenes (
  id bigserial primary key,
  cliente_id text references clientes(id),
  cliente_nombre text not null,
  cliente_tel text not null,
  bici jsonb not null,
  tipos_trabajo text[] not null default array[]::text[],
  descripcion text default '',
  prioridad text default 'normal',
  mecanico text default 'Sin asignar',
  status text default 'pending',
  reparaciones jsonb default '[]'::jsonb,
  notas text default '',
  fotos text[] default array[]::text[],
  checklist jsonb default '{}'::jsonb,
  fecha_compromiso timestamptz,
  duracion_minutos int,
  fecha_terminado timestamptz,
  recordatorio_enviado boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_ordenes_status on ordenes(status);
create index idx_ordenes_cliente on ordenes(cliente_id);
create index idx_ordenes_created on ordenes(created_at desc);

-- Configuración (mecánicos, etc.)
create table settings (
  key text primary key,
  value jsonb not null
);

-- ===== DATOS INICIALES =====

-- Empieza órdenes en #1001
alter sequence ordenes_id_seq restart with 1001;

-- Lista inicial de mecánicos
insert into settings (key, value) values ('mecanicos', '["Carlos","Andrés","Juan"]'::jsonb);

-- ===== SEGURIDAD (RLS) =====
-- Cualquier usuario autenticado puede leer/escribir todo

alter table clientes enable row level security;
alter table bicicletas enable row level security;
alter table ordenes enable row level security;
alter table settings enable row level security;

create policy "auth_all_clientes" on clientes for all to authenticated using (true) with check (true);
create policy "auth_all_bicicletas" on bicicletas for all to authenticated using (true) with check (true);
create policy "auth_all_ordenes" on ordenes for all to authenticated using (true) with check (true);
create policy "auth_all_settings" on settings for all to authenticated using (true) with check (true);

-- ===== STORAGE =====
-- Políticas para el bucket 'fotos'
-- (Crea primero el bucket en: Storage → New bucket → nombre "fotos" → marca "Public")

create policy "public_read_fotos"
  on storage.objects for select
  using (bucket_id = 'fotos');

create policy "auth_upload_fotos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos');

create policy "auth_delete_fotos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'fotos');

-- ============================================
-- ✓ Listo. Siguiente paso: crear bucket "fotos" en Storage
-- ============================================
