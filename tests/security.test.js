import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

test('RLS exige admin AAL2 e não publica produtos sem estoque', async () => {
  const sql = await read('supabase.sql')

  assert.match(sql, /auth\.jwt\(\) ->> 'aal'\), ''\) = 'aal2'/)
  assert.match(sql, /using \(active = true and quantity > 0\)/)
  assert.match(sql, /revoke all on table public\.app_admins from anon, authenticated/)
  assert.match(sql, /grant update \(name, brand, category, price, promotional_price, image_path, active\)/)
  assert.match(sql, /promotional_price is null or \(promotional_price > 0 and promotional_price < price\)/)
  assert.doesNotMatch(sql, /grant update \([^)]*quantity[^)]*\)/s)
})

test('movimentação de estoque é atômica, histórica e idempotente', async () => {
  const sql = await read('supabase.sql')

  assert.match(sql, /create unique index if not exists stock_movements_operation_id_idx/)
  assert.match(sql, /p_operation_id uuid/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /for update/)
  assert.match(sql, /current_qty \+ p_delta < 0/)
  assert.match(sql, /insert into public\.stock_movements\(operation_id, product_id, type, delta, created_by\)/)
  assert.match(sql, /drop function if exists public\.adjust_stock\(uuid, integer, text\)/)
})

test('caderneta exige AAL2 e não permite alterar o histórico diretamente', async () => {
  const sql = await read('supabase.sql')

  assert.match(sql, /alter table public\.credit_customers enable row level security/)
  assert.match(sql, /alter table public\.credit_transactions enable row level security/)
  assert.match(sql, /revoke all on table public\.credit_customers from anon, authenticated/)
  assert.match(sql, /revoke all on table public\.credit_transactions from anon, authenticated/)
  assert.match(sql, /grant select on table public\.credit_transactions to authenticated/)
  assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*public\.credit_transactions/s)
  assert.match(sql, /create policy "admin can view credit transactions"[\s\S]*?public\.is_admin\(\)/)
})

test('lançamentos da caderneta são atômicos, idempotentes e mantêm saldo válido', async () => {
  const sql = await read('supabase.sql')

  assert.match(sql, /create unique index if not exists credit_transactions_operation_id_idx/)
  assert.match(sql, /create or replace function public\.record_credit_transaction/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /A linha do cliente funciona como mutex/)
  assert.match(sql, /for update/)
  assert.match(sql, /p_amount > current_balance/)
  assert.match(sql, /create or replace function public\.cancel_credit_transaction/)
  assert.match(sql, /set\s+reversed_at = now\(\)/)
  assert.match(sql, /current_balance - target_transaction\.amount < 0/)
  assert.doesNotMatch(sql, /delete from public\.credit_transactions/)
})

test('bucket e policies de imagem permanecem restritos', async () => {
  const sql = await read('supabase.sql')

  assert.match(sql, /file_size_limit, allowed_mime_types/)
  assert.match(sql, /5242880/)
  assert.match(sql, /bucket_id = 'product-images'/)
  assert.match(sql, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)::text\)/)
  assert.match(sql, /owner_id = \(select auth\.uid\(\)::text\)/)
})

test('frontend envia chave idempotente e confirma linhas alteradas', async () => {
  const source = await read('src/main.js')

  assert.match(source, /p_operation_id: operationId/)
  assert.match(source, /sessionStorage\.setItem\(pendingKey, operationId\)/)
  assert.match(source, /\.select\('id,name,brand,category,price,promotional_price,quantity,image_path'\)/)
  assert.match(source, /promotionalPrice <= 0 \|\| promotionalPrice >= price/)
  assert.match(source, /\.select\('id'\)/)
  assert.doesNotMatch(source, /\balert\s*\(/)
})

test('frontend da caderneta protege retries e exportação para planilha', async () => {
  const source = await read('src/main.js')

  assert.match(source, /credit-operation:\$\{customer\.customer_id\}:\$\{type\}/)
  assert.match(source, /p_operation_id: operationId/)
  assert.match(source, /record_credit_transaction/)
  assert.match(source, /cancel_credit_transaction/)
  assert.match(source, /fetchAllCreditTransactions/)
  assert.match(source, /if \(\/\^\[=\+\\-@\]\//)
  assert.match(source, /application\/vnd|text\/csv/)
})

test('headers bloqueiam framing e scripts inline', async () => {
  const headers = await read('public/_headers')

  assert.match(headers, /frame-ancestors 'none'/)
  assert.match(headers, /object-src 'none'/)
  assert.match(headers, /X-Content-Type-Options: nosniff/)
  assert.doesNotMatch(headers, /unsafe-inline/)
})
