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
  assert.match(sql, /grant update \(name, brand, category, price, image_path, active\)/)
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
  assert.match(source, /\.select\('id,name,brand,category,price,quantity,image_path'\)/)
  assert.match(source, /\.select\('id'\)/)
  assert.doesNotMatch(source, /\balert\s*\(/)
})

test('headers bloqueiam framing e scripts inline', async () => {
  const headers = await read('public/_headers')

  assert.match(headers, /frame-ancestors 'none'/)
  assert.match(headers, /object-src 'none'/)
  assert.match(headers, /X-Content-Type-Options: nosniff/)
  assert.doesNotMatch(headers, /unsafe-inline/)
})
