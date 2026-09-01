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
  name text not null constraint products_name_length_check
    check (length(btrim(name)) between 1 and 120),
  brand text constraint products_brand_length_check
    check (brand is null or length(brand) <= 80),
  category text constraint products_category_length_check
    check (category is null or length(category) <= 80),
  price numeric(10,2) not null default 0 check (price >= 0),
  promotional_price numeric(10,2) constraint products_promotional_price_check
    check (promotional_price is null or (promotional_price > 0 and promotional_price < price)),
  quantity integer not null default 0 check (quantity >= 0),
  image_path text constraint products_image_path_format_check check (
    image_path is null
    or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  operation_id uuid not null default gen_random_uuid(),
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

-- Caderneta mínima: clientes e lançamentos imutáveis de compras/pagamentos.
-- O saldo é sempre calculado pelo histórico; não existe coluna de saldo editável.
create table if not exists public.credit_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint credit_customers_name_length_check
    check (length(btrim(name)) between 1 and 120),
  phone text constraint credit_customers_phone_format_check
    check (phone is null or phone ~ '^[0-9]{10,15}$'),
  notes text constraint credit_customers_notes_length_check
    check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  customer_id uuid not null references public.credit_customers(id) on delete restrict,
  type text not null check (type in ('purchase', 'payment')),
  amount numeric(12,2) not null check (amount > 0 and amount <= 99999999.99),
  description text constraint credit_transactions_description_length_check
    check (description is null or length(description) <= 200),
  occurred_on date not null default current_date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reversal_operation_id uuid,
  constraint credit_transactions_reversal_check check (
    (reversed_at is null and reversal_operation_id is null)
    or (reversed_at is not null and reversal_operation_id is not null)
  )
);

-- Compatibilidade com projetos que já executaram uma versão anterior do arquivo.
-- Os blocos abaixo transformam o bootstrap também em um upgrade idempotente.
alter table public.stock_movements
  add column if not exists operation_id uuid not null default gen_random_uuid();

alter table public.products
  add column if not exists promotional_price numeric(10,2);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_name_length_check'
  ) then
    alter table public.products
      add constraint products_name_length_check
      check (length(btrim(name)) between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_brand_length_check'
  ) then
    alter table public.products
      add constraint products_brand_length_check
      check (brand is null or length(brand) <= 80);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_category_length_check'
  ) then
    alter table public.products
      add constraint products_category_length_check
      check (category is null or length(category) <= 80);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_promotional_price_check'
  ) then
    alter table public.products
      add constraint products_promotional_price_check
      check (promotional_price is null or (promotional_price > 0 and promotional_price < price));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_image_path_format_check'
  ) then
    alter table public.products
      add constraint products_image_path_format_check
      check (
        image_path is null
        or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
      );
  end if;
end;
$$;

create index if not exists products_active_created_at_idx
  on public.products (active, created_at desc);

create index if not exists stock_movements_created_at_idx
  on public.stock_movements (created_at desc);

create index if not exists stock_movements_product_id_idx
  on public.stock_movements (product_id);

create unique index if not exists stock_movements_operation_id_idx
  on public.stock_movements (operation_id);

create index if not exists credit_customers_name_idx
  on public.credit_customers (name);

create index if not exists credit_transactions_customer_date_idx
  on public.credit_transactions (customer_id, occurred_on desc, created_at desc);

create unique index if not exists credit_transactions_operation_id_idx
  on public.credit_transactions (operation_id);

create unique index if not exists credit_transactions_reversal_operation_id_idx
  on public.credit_transactions (reversal_operation_id)
  where reversal_operation_id is not null;

alter table public.app_admins enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.credit_customers enable row level security;
alter table public.credit_transactions enable row level security;

-- app_admins não é exposta pela API para anon/authenticated.
revoke all on table public.app_admins from anon, authenticated;

-- Defense in depth: além do RLS, restringimos os privilégios da Data API.
revoke all on table public.products from anon, authenticated;
grant select on table public.products to anon, authenticated;
grant insert (id, name, brand, category, price, promotional_price, quantity, image_path, active)
  on public.products to authenticated;
grant update (name, brand, category, price, promotional_price, image_path, active)
  on public.products to authenticated;

revoke all on table public.stock_movements from anon, authenticated;
grant select on table public.stock_movements to authenticated;

-- Dados de clientes nunca são públicos. A administradora só escreve o cadastro;
-- lançamentos financeiros entram exclusivamente pelas funções atômicas abaixo.
revoke all on table public.credit_customers from anon, authenticated;
grant select on table public.credit_customers to authenticated;
grant insert (id, name, phone, notes) on public.credit_customers to authenticated;
grant update (name, phone, notes) on public.credit_customers to authenticated;

revoke all on table public.credit_transactions from anon, authenticated;
grant select on table public.credit_transactions to authenticated;

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

-- Catálogo: visitantes e usuários comuns veem somente itens ativos e disponíveis.
-- A policy administrativa abaixo continua permitindo estoque zero e inativos em AAL2.
drop policy if exists "catalog can view active products" on public.products;
create policy "catalog can view active products"
on public.products for select
to anon, authenticated
using (active = true and quantity > 0);

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

drop policy if exists "admin can view credit customers" on public.credit_customers;
create policy "admin can view credit customers"
on public.credit_customers for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "admin can insert credit customers" on public.credit_customers;
create policy "admin can insert credit customers"
on public.credit_customers for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists "admin can update credit customers" on public.credit_customers;
create policy "admin can update credit customers"
on public.credit_customers for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "admin can view credit transactions" on public.credit_transactions;
create policy "admin can view credit transactions"
on public.credit_transactions for select
to authenticated
using ((select public.is_admin()));

-- Não há INSERT/UPDATE/DELETE direto em credit_transactions pela aplicação.

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

drop trigger if exists credit_customers_set_updated_at on public.credit_customers;
create trigger credit_customers_set_updated_at
before update on public.credit_customers
for each row execute function public.set_updated_at();

revoke all on function public.set_updated_at() from public;

-- Remove a assinatura antiga, que não possuía chave de idempotência.
drop function if exists public.adjust_stock(uuid, integer, text);

-- Ajuste atômico e idempotente de estoque + histórico. A coluna quantity não pode
-- ser alterada diretamente pela role authenticated; somente esta função o faz.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta integer,
  p_type text,
  p_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_qty integer;
  previous_movement public.stock_movements%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão administrativa';
  end if;

  if p_product_id is null or p_operation_id is null then
    raise exception 'Produto e identificador da operação são obrigatórios';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Movimentação não pode ser zero';
  end if;

  if p_type is null or p_type not in ('entry', 'sale', 'adjustment') then
    raise exception 'Tipo de movimentação inválido';
  end if;

  if p_type = 'entry' and p_delta < 0 then
    raise exception 'Entrada deve aumentar o estoque';
  end if;

  if p_type = 'sale' and p_delta > 0 then
    raise exception 'Venda deve reduzir o estoque';
  end if;

  -- Serializa tentativas com a mesma chave antes de consultar o histórico.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select m.* into previous_movement
  from public.stock_movements m
  where m.operation_id = p_operation_id;

  if found then
    if previous_movement.product_id = p_product_id
      and previous_movement.delta = p_delta
      and previous_movement.type = p_type
      and previous_movement.created_by is not distinct from (select auth.uid()) then
      return;
    end if;

    raise exception 'Identificador de operação já utilizado com outros dados';
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

  insert into public.stock_movements(operation_id, product_id, type, delta, created_by)
  values (p_operation_id, p_product_id, p_type, p_delta, (select auth.uid()));
end;
$$;

revoke all on function public.adjust_stock(uuid, integer, text, uuid) from public;
grant execute on function public.adjust_stock(uuid, integer, text, uuid) to authenticated;

-- Registra o estoque inicial como entrada ao cadastrar um produto.
create or replace function public.log_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quantity > 0 and public.is_admin() then
    insert into public.stock_movements(operation_id, product_id, type, delta, created_by)
    values (gen_random_uuid(), new.id, 'entry', new.quantity, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists products_initial_stock on public.products;
create trigger products_initial_stock
after insert on public.products
for each row execute function public.log_initial_stock();

revoke all on function public.log_initial_stock() from public;

-- Resumo calculado da caderneta. Lançamentos cancelados continuam no histórico,
-- mas deixam de participar dos totais.
create or replace function public.get_credit_customer_balances()
returns table (
  customer_id uuid,
  customer_name text,
  phone text,
  notes text,
  total_purchases numeric,
  total_payments numeric,
  balance numeric,
  last_activity_on date,
  customer_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Sem permissão administrativa';
  end if;

  return query
  select
    c.id,
    c.name,
    c.phone,
    c.notes,
    coalesce(sum(t.amount) filter (where t.type = 'purchase' and t.reversed_at is null), 0),
    coalesce(sum(t.amount) filter (where t.type = 'payment' and t.reversed_at is null), 0),
    coalesce(sum(
      case
        when t.reversed_at is not null then 0
        when t.type = 'purchase' then t.amount
        else -t.amount
      end
    ), 0),
    max(t.occurred_on) filter (where t.reversed_at is null),
    c.created_at
  from public.credit_customers c
  left join public.credit_transactions t on t.customer_id = c.id
  group by c.id, c.name, c.phone, c.notes, c.created_at
  order by 7 desc, c.name;
end;
$$;

revoke all on function public.get_credit_customer_balances() from public;
grant execute on function public.get_credit_customer_balances() to authenticated;

-- Compra fiada ou pagamento parcial: valida, serializa por cliente e grava uma
-- única vez mesmo se o navegador repetir a requisição após uma falha de rede.
create or replace function public.record_credit_transaction(
  p_customer_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_occurred_on date,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_transaction public.credit_transactions%rowtype;
  target_customer_id uuid;
  normalized_description text := nullif(btrim(coalesce(p_description, '')), '');
  transaction_day date := coalesce(p_occurred_on, current_date);
  current_balance numeric := 0;
  new_transaction_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão administrativa';
  end if;

  if p_customer_id is null or p_operation_id is null then
    raise exception 'Cliente e identificador da operação são obrigatórios';
  end if;

  if p_type is null or p_type not in ('purchase', 'payment') then
    raise exception 'Tipo de lançamento inválido';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 99999999.99
    or round(p_amount, 2) <> p_amount then
    raise exception 'Informe um valor válido com até 2 casas decimais';
  end if;

  if transaction_day > current_date then
    raise exception 'A data do lançamento não pode estar no futuro';
  end if;

  if normalized_description is not null and length(normalized_description) > 200 then
    raise exception 'A descrição deve ter no máximo 200 caracteres';
  end if;

  if p_type = 'purchase' and normalized_description is null then
    raise exception 'Informe o que foi comprado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select t.* into previous_transaction
  from public.credit_transactions t
  where t.operation_id = p_operation_id;

  if found then
    if previous_transaction.customer_id = p_customer_id
      and previous_transaction.type = p_type
      and previous_transaction.amount = p_amount
      and previous_transaction.description is not distinct from normalized_description
      and previous_transaction.occurred_on = transaction_day
      and previous_transaction.created_by is not distinct from (select auth.uid()) then
      return previous_transaction.id;
    end if;

    raise exception 'Identificador de lançamento já utilizado com outros dados';
  end if;

  -- A linha do cliente funciona como mutex para lançamentos e cancelamentos.
  select c.id into target_customer_id
  from public.credit_customers c
  where c.id = p_customer_id
  for update;

  if not found then
    raise exception 'Cliente não encontrado';
  end if;

  if p_type = 'payment' then
    select coalesce(sum(
      case when t.type = 'purchase' then t.amount else -t.amount end
    ), 0)
    into current_balance
    from public.credit_transactions t
    where t.customer_id = p_customer_id
      and t.reversed_at is null;

    if current_balance <= 0 then
      raise exception 'Este cliente não possui saldo em aberto';
    end if;

    if p_amount > current_balance then
      raise exception 'O pagamento não pode ser maior que o saldo em aberto';
    end if;
  end if;

  insert into public.credit_transactions (
    operation_id,
    customer_id,
    type,
    amount,
    description,
    occurred_on,
    created_by
  ) values (
    p_operation_id,
    p_customer_id,
    p_type,
    p_amount,
    normalized_description,
    transaction_day,
    (select auth.uid())
  )
  returning id into new_transaction_id;

  return new_transaction_id;
end;
$$;

revoke all on function public.record_credit_transaction(uuid, text, numeric, text, date, uuid) from public;
grant execute on function public.record_credit_transaction(uuid, text, numeric, text, date, uuid) to authenticated;

-- Corrige erros sem apagar o histórico. Uma compra só pode ser cancelada se isso
-- não fizer os pagamentos já registrados ultrapassarem o total das compras.
create or replace function public.cancel_credit_transaction(
  p_transaction_id uuid,
  p_reversal_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_transaction public.credit_transactions%rowtype;
  target_customer_id uuid;
  current_balance numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'Sem permissão administrativa';
  end if;

  if p_transaction_id is null or p_reversal_operation_id is null then
    raise exception 'Lançamento e identificador do cancelamento são obrigatórios';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_reversal_operation_id::text, 0)
  );

  select t.* into target_transaction
  from public.credit_transactions t
  where t.id = p_transaction_id
  for update;

  if not found then
    raise exception 'Lançamento não encontrado';
  end if;

  if target_transaction.reversed_at is not null then
    if target_transaction.reversal_operation_id = p_reversal_operation_id
      and target_transaction.reversed_by is not distinct from (select auth.uid()) then
      return target_transaction.id;
    end if;

    raise exception 'Este lançamento já foi cancelado';
  end if;

  select c.id into target_customer_id
  from public.credit_customers c
  where c.id = target_transaction.customer_id
  for update;

  if not found then
    raise exception 'Cliente não encontrado';
  end if;

  if target_transaction.type = 'purchase' then
    select coalesce(sum(
      case when t.type = 'purchase' then t.amount else -t.amount end
    ), 0)
    into current_balance
    from public.credit_transactions t
    where t.customer_id = target_transaction.customer_id
      and t.reversed_at is null;

    if current_balance - target_transaction.amount < 0 then
      raise exception 'Cancele primeiro os pagamentos ligados a esta compra';
    end if;
  end if;

  update public.credit_transactions
  set
    reversed_at = now(),
    reversed_by = (select auth.uid()),
    reversal_operation_id = p_reversal_operation_id
  where id = target_transaction.id;

  return target_transaction.id;
end;
$$;

revoke all on function public.cancel_credit_transaction(uuid, uuid) from public;
grant execute on function public.cancel_credit_transaction(uuid, uuid) to authenticated;

-- STORAGE
-- Configuração versionada do bucket público usado pelo catálogo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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
