import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'

function parseEnv(source) {
  return Object.fromEntries(source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=')
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
      return [key, value]
    }))
}

const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY

if (!url || !key || /SEU-|SUA_/i.test(`${url}${key}`)) {
  throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env antes da verificação.')
}

const failures = []
const pass = message => console.log(`✓ ${message}`)
const fail = message => {
  failures.push(message)
  console.error(`✗ ${message}`)
}

const settingsResponse = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})

if (!settingsResponse.ok) {
  fail(`Configuração do Auth não pôde ser consultada (HTTP ${settingsResponse.status}).`)
} else {
  const settings = await settingsResponse.json()
  if (settings.disable_signup === true) pass('Cadastro público está desabilitado.')
  else fail('Cadastro público ainda está habilitado no Supabase Auth.')
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})

async function expectDenied(label, request) {
  const { error } = await request()
  if (error?.code === '42501') pass(`${label} bloqueado para anon.`)
  else if (error) fail(`${label} retornou erro inesperado (${error.code || 'sem código'}).`)
  else fail(`${label} foi acessível para anon.`)
}

await expectDenied('app_admins', () => supabase.from('app_admins').select('user_id').limit(1))
await expectDenied('stock_movements', () => supabase.from('stock_movements').select('id').limit(1))
await expectDenied('is_admin_identity', () => supabase.rpc('is_admin_identity'))
await expectDenied('adjust_stock', () => supabase.rpc('adjust_stock', {
  p_product_id: '00000000-0000-0000-0000-000000000000',
  p_delta: 1,
  p_type: 'entry',
  p_operation_id: crypto.randomUUID()
}))

for (const [label, filter] of [
  ['Produtos inativos', query => query.eq('active', false)],
  ['Produtos ativos sem estoque', query => query.eq('active', true).lte('quantity', 0)]
]) {
  const { data, error } = await filter(supabase.from('products').select('id').limit(1))
  if (error) fail(`${label}: consulta pública falhou inesperadamente.`)
  else if (data.length === 0) pass(`${label} não são expostos para anon.`)
  else fail(`${label} foram expostos para anon.`)
}

if (failures.length) {
  console.error(`\n${failures.length} verificação(ões) falharam.`)
  process.exitCode = 1
} else {
  console.log('\nTodas as verificações públicas do Supabase passaram.')
}
