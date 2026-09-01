-- Estoque + Catálogo — banco e políticas de segurança
-- Execute no SQL Editor de um projeto Supabase novo.
-- Depois crie a usuária em Authentication > Users e promova-a em app_admins
-- conforme o README.

create extension if not exists pgcrypto;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  brand text,
  category text,
  price numeric(10,2) not null default 0 check (price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  image_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  type text not null check (type in ('entry', 'sale', 'adjustment')),
  delta integer not null check (delta <> 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint stock_movement_direction check (
    (type = 'entry' and delta > 0)
    or (type = 'sale' and delta < 0)
    or type = 'adjustment'
  )
);

create index if not exists products_active_created_at_idx
  on public.products (active, created_at desc);

create index if not exists stock_movements_created_at_idx
  on public.stock_movements (created_at desc);

create index if not exists stock_movements_product_id_idx
  on public.stock_movements (product_id);

alter table public.app_admins enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;

-- app_admins não é exposta pela API para anon/authenticated.
revoke all on table public.app_admins from anon, authenticated;

-- Defense in depth: além do RLS, restringimos os privilégios da Data API.
revoke all on table public.products from anon, authenticated;
grant select on table public.products to anon, authenticated;
grant insert (name, brand, category, price, quantity, image_path, active)
  on public.products to authenticated;
grant update (name, brand, category, price, image_path, active)
  on public.products to authenticated;

revoke all on table public.stock_movements from anon, authenticated;
grant select on table public.stock_movements to authenticated;

-- Confirma se a identidade foi explicitamente cadastrada como administradora.
-- Esta função é usada somente no fluxo de login, antes do desafio MFA.
create or replace function public.is_admin_identity()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admins a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin_identity() from public;
grant execute on function public.is_admin_identity() to authenticated;

-- Autorização administrativa efetiva: exige usuário permitido + sessão AAL2.
-- Assim, esconder a tela de MFA no frontend não permite contornar o segundo fator.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin_identity()
    and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Catálogo: visitantes e usuários logados podem ver somente produtos ativos.
drop policy if exists "catalog can view active products" on public.products;
create policy "catalog can view active products"
on public.products for select
to anon, authenticated
using (active = true);

-- Administradora pode ver também produtos inativos.
drop policy if exists "admin can view all products" on public.products;
create policy "admin can view all products"
on public.products for select
to authenticated
using ((select public.is_admin()));

-- Somente a administradora pode criar e editar produtos.
drop policy if exists "admin can insert products" on public.products;
create policy "admin can insert products"
on public.products for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists "admin can update products" on public.products;
create policy "admin can update products"
on public.products for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Não há DELETE pela aplicação. Produto é ocultado (active=false), preservando histórico.

drop policy if exists "admin can view movements" on public.stock_movements;
create policy "admin can view movements"
on public.stock_movements for select
to authenticated
using ((select public.is_admin()));

-- updated_at é responsabilidade do banco, não do navegador.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- Ajuste atômico de estoque + histórico. A coluna quantity não pode ser alterada
-- diretamente pela role authenticated; somente esta função consegue fazê-lo.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta integer,
  p_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_qty integer;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão administrativa';
  end if;

  if p_delta = 0 then
    raise exception 'Movimentação não pode ser zero';
  end if;

  if p_type not in ('entry', 'sale', 'adjustment') then
    raise exception 'Tipo de movimentação inválido';
  end if;

  if p_type = 'entry' and p_delta < 0 then
    raise exception 'Entrada deve aumentar o estoque';
  end if;

  if p_type = 'sale' and p_delta > 0 then
    raise exception 'Venda deve reduzir o estoque';
  end if;

  select p.quantity into current_qty
  from public.products p
  where p.id = p_product_id
  for update;

  if current_qty is null then
    raise exception 'Produto não encontrado';
  end if;

  if current_qty + p_delta < 0 then
    raise exception 'Estoque insuficiente';
  end if;

  update public.products
  set quantity = quantity + p_delta
  where id = p_product_id;

  insert into public.stock_movements(product_id, type, delta, created_by)
  values (p_product_id, p_type, p_delta, (select auth.uid()));
end;
$$;

revoke all on function public.adjust_stock(uuid, integer, text) from public;
grant execute on function public.adjust_stock(uuid, integer, text) to authenticated;

-- Registra o estoque inicial como entrada ao cadastrar um produto.
create or replace function public.log_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quantity > 0 and public.is_admin() then
    insert into public.stock_movements(product_id, type, delta, created_by)
    values (new.id, 'entry', new.quantity, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists products_initial_stock on public.products;
create trigger products_initial_stock
after insert on public.products
for each row execute function public.log_initial_stock();

-- STORAGE
-- Crie no Dashboard um bucket PUBLIC chamado product-images.
-- Recomendações: allowed MIME types = image/jpeg,image/png,image/webp e limite = 5 MB.
-- As policies abaixo restringem escrita à administradora e à sua própria pasta.

drop policy if exists "admin can upload product images" on storage.objects;
create policy "admin can upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (select public.is_admin())
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "admin can update own product images" on storage.objects;
create policy "admin can update own product images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_admin())
  and owner_id = (select auth.uid()::text)
)
with check (
  bucket_id = 'product-images'
  and (select public.is_admin())
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "admin can delete own product images" on storage.objects;
create policy "admin can delete own product images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_admin())
  and owner_id = (select auth.uid()::text)
);
