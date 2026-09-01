import { createClient } from '@supabase/supabase-js'
import './style.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER || '').replace(/\D/g, '')
const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'Pronta Entrega'
const PRODUCT_IMAGE_BUCKET = 'product-images'
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY = 0.82

const app = document.querySelector('#app')
const isAdminRoute = new URLSearchParams(location.search).has('admin')

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  app.innerHTML = `<div class="shell"><div class="error">Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo .env.</div></div>`
  throw new Error('Supabase não configurado')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]))
let pendingAdminNotice = null

const SAFE_ERROR_FRAGMENTS = [
  'Estoque insuficiente',
  'Produto não encontrado',
  'Movimentação não pode ser zero',
  'Tipo de movimentação inválido',
  'Entrada deve aumentar o estoque',
  'Venda deve reduzir o estoque',
  'Identificador de operação já utilizado',
  'Sua sessão expirou',
  'Informe o nome do produto',
  'O nome deve ter no máximo',
  'A marca deve ter no máximo',
  'A categoria deve ter no máximo',
  'Informe um preço entre',
  'Estoque inicial inválido',
  'Escolha entre remover',
  'Escolha um arquivo de imagem',
  'A foto original é muito grande',
  'Não consegui ler esta foto',
  'Não foi possível preparar a foto',
  'A foto preparada ultrapassou'
]

function friendlyError(error, fallback) {
  const message = String(error?.message || '')
  if (SAFE_ERROR_FRAGMENTS.some(fragment => message.includes(fragment))) return message
  console.error(fallback, error)
  return fallback
}

function queueAdminNotice(message, type = 'notice') {
  pendingAdminNotice = { message, type }
}

function showAdminNotice(message, type = 'error') {
  const box = document.querySelector('#admin-feedback')
  if (!box) return
  box.textContent = message
  box.className = `admin-feedback ${type === 'error' ? 'feedback-error' : 'notice'}`
  box.setAttribute('role', type === 'error' ? 'alert' : 'status')
}

function reconcilePendingStockOperations(movements) {
  try {
    for (const movement of movements) {
      const key = `stock-operation:${movement.product_id}:${movement.type}`
      if (sessionStorage.getItem(key) === movement.operation_id) sessionStorage.removeItem(key)
    }
  } catch {
    // O fluxo continua normalmente quando o Storage do navegador está indisponível.
  }
}

function imageUrl(path) {
  if (!path) return ''
  return supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

function header(admin = false) {
  return `<header class="header">
    <div class="brand"><h1>${esc(STORE_NAME)}</h1><p>${admin ? 'Controle de estoque' : 'Produtos disponíveis agora'}</p></div>
    <a class="admin-link" href="${admin ? '/' : '/?admin=1'}">${admin ? 'Ver catálogo' : 'Área da vendedora'}</a>
  </header>`
}

async function renderCatalog() {
  app.innerHTML = `<main class="shell">${header(false)}<section class="hero"><h2>Pronta entrega</h2><p>Escolha um produto e fale diretamente pelo WhatsApp.</p></section><div class="loading" role="status">Carregando produtos…</div></main>`

  const { data, error } = await supabase
    .from('products')
    .select('id,name,brand,category,price,quantity,image_path')
    .eq('active', true)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })

  if (error) return showCatalogError(error.message)

  const products = data || []
  const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  app.innerHTML = `<main class="shell">
    ${header(false)}
    <section class="hero"><h2>Pronta entrega</h2><p>Escolha um produto e fale diretamente pelo WhatsApp.</p></section>
    <section class="filters" aria-label="Filtros do catálogo">
      <input id="search" class="control" aria-label="Buscar produtos" placeholder="Buscar perfume, hidratante, lingerie…" />
      <select id="brand" class="control" aria-label="Filtrar por marca"><option value="">Todas as marcas</option>${brands.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
      <select id="category" class="control" aria-label="Filtrar por categoria"><option value="">Todas as categorias</option>${categories.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
    </section>
    <section id="catalog" class="grid" aria-live="polite"></section>
  </main>`

  const search = document.querySelector('#search')
  const brand = document.querySelector('#brand')
  const category = document.querySelector('#category')

  const draw = () => {
    const q = search.value.trim().toLowerCase()
    const filtered = products.filter(p => {
      const haystack = `${p.name} ${p.brand || ''} ${p.category || ''}`.toLowerCase()
      return (!q || haystack.includes(q)) && (!brand.value || p.brand === brand.value) && (!category.value || p.category === category.value)
    })
    document.querySelector('#catalog').innerHTML = filtered.length
      ? filtered.map(productCard).join('')
      : `<div class="empty catalog-empty">Nenhum produto encontrado.</div>`
  }

  search.addEventListener('input', draw)
  brand.addEventListener('change', draw)
  category.addEventListener('change', draw)
  draw()
}

function productCard(p) {
  const photo = imageUrl(p.image_path)
  const msg = `Olá! Vi ${p.name} no catálogo ${STORE_NAME}. Ainda está disponível?`
  const link = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}` : ''
  const whatsappAction = link
    ? `<a class="btn btn-whatsapp" href="${link}" target="_blank" rel="noopener noreferrer">Quero esse no WhatsApp</a>`
    : `<button class="btn btn-whatsapp" type="button" disabled>WhatsApp não configurado</button>`

  return `<article class="card">
    ${photo ? `<img class="product-image" src="${photo}" alt="${esc(p.name)}" loading="lazy" />` : `<div class="product-image placeholder" aria-hidden="true">♡</div>`}
    <div class="card-body">
      <div class="pills">${p.brand ? `<span class="pill">${esc(p.brand)}</span>` : ''}${p.category ? `<span class="pill">${esc(p.category)}</span>` : ''}</div>
      <h3>${esc(p.name)}</h3>
      <div class="price-row"><span class="price">${money.format(Number(p.price || 0))}</span><span class="stock">${p.quantity} disponível${p.quantity === 1 ? '' : 'is'}</span></div>
      ${whatsappAction}
    </div>
  </article>`
}

function showCatalogError(message) {
  console.error('Não foi possível carregar o catálogo:', message)
  app.innerHTML = `<main class="shell">${header(false)}<div class="error" role="alert">Não foi possível carregar o catálogo. Tente novamente em instantes.</div></main>`
}

async function renderAdmin(loginMessage = '') {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return renderLogin(loginMessage)

  // Esta checagem confirma apenas se a conta foi autorizada como administradora.
  // O acesso aos dados administrativos exige também AAL2 (MFA), aplicado no banco.
  const { data: adminIdentity, error: adminError } = await supabase.rpc('is_admin_identity')
  if (adminError || !adminIdentity) {
    await supabase.auth.signOut()
    return renderLogin('Esta conta não tem permissão para administrar o estoque.')
  }

  const [{ data: aal, error: aalError }, { data: factors, error: factorsError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors()
  ])

  if (aalError || factorsError) {
    console.error('Não foi possível verificar o MFA:', aalError || factorsError)
    return renderMfaError('Não foi possível verificar o MFA. Tente novamente.')
  }

  const verifiedTotp = (factors?.totp || []).filter(factor => factor.status === 'verified')

  if (aal?.currentLevel === 'aal2' && aal?.nextLevel === 'aal2') {
    return renderDashboard()
  }

  if (verifiedTotp.length) {
    return renderMfaChallenge(verifiedTotp)
  }

  return renderMfaEnrollment()
}

function mfaShell(title, description, content) {
  return `<main class="shell"><div class="login-wrap mfa-wrap">
    <div class="security-badge">🔐 Proteção em duas etapas</div>
    <h2>${esc(title)}</h2>
    <p>${esc(description)}</p>
    ${content}
    <p class="mfa-footer"><button id="mfa-logout" class="link-button" type="button">Sair da conta</button></p>
  </div></main>`
}

function bindMfaLogout() {
  document.querySelector('#mfa-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    renderLogin()
  })
}

function renderMfaError(message) {
  app.innerHTML = mfaShell(
    'Não foi possível verificar a segurança',
    'O painel administrativo permanece bloqueado.',
    `<div class="error">${esc(message)}</div><button id="retry-mfa" class="btn btn-primary mfa-full" type="button">Tentar novamente</button>`
  )
  bindMfaLogout()
  document.querySelector('#retry-mfa')?.addEventListener('click', () => renderAdmin())
}

async function renderMfaEnrollment({ backup = false } = {}) {
  app.innerHTML = mfaShell(
    backup ? 'Adicione um autenticador reserva' : 'Ative o autenticador',
    backup
      ? 'Este fator poderá ser usado se o autenticador principal não estiver disponível.'
      : 'Este primeiro cadastro é obrigatório para acessar o estoque.',
    '<div class="loading" role="status">Preparando seu QR Code…</div>'
  )
  bindMfaLogout()

  // Um refresh durante o cadastro pode deixar um fator não verificado no Supabase.
  // Removemos apenas fatores TOTP ainda não verificados e iniciamos um cadastro limpo.
  const { data: existingFactors, error: listError } = await supabase.auth.mfa.listFactors()
  if (listError) return renderMfaError('Não foi possível consultar os autenticadores cadastrados.')

  for (const factor of (existingFactors?.totp || []).filter(item => item.status !== 'verified')) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    if (error) console.warn('Fator MFA incompleto não pôde ser removido:', error.message)
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: backup
      ? `${STORE_NAME} - reserva ${(existingFactors?.totp || []).filter(item => item.status === 'verified').length + 1}`
      : `${STORE_NAME} - painel`
  })

  if (error || !data?.id || !data?.totp) {
    console.error('Não foi possível iniciar o cadastro do autenticador:', error)
    return renderMfaError('Não foi possível iniciar o cadastro do autenticador. Tente novamente.')
  }

  const qr = data.totp.qr_code
  const secret = data.totp.secret

  app.innerHTML = mfaShell(
    backup ? 'Adicione um autenticador reserva' : 'Ative o autenticador',
    'Escaneie o QR Code em um aplicativo autenticador e informe o código de 6 dígitos.',
    `<div class="mfa-enroll">
      <img class="mfa-qr" src="${esc(qr)}" alt="QR Code para configurar o autenticador" />
      <div class="mfa-secret">
        <span>Se não conseguir escanear, use esta chave:</span>
        <code>${esc(secret)}</code>
      </div>
      <form id="mfa-enroll-form" class="form-grid">
        <label class="span-2">Código do autenticador
          <input class="control mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000" />
        </label>
        <button class="btn btn-primary span-2" type="submit">Ativar e entrar</button>
        <div id="mfa-error" class="error hidden span-2" role="alert"></div>
      </form>
      <p class="security-note">O painel só será liberado depois que este segundo fator for confirmado.</p>
    </div>`
  )
  bindMfaLogout()

  document.querySelector('#mfa-enroll-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = event.currentTarget
    const code = String(new FormData(form).get('code') || '').replace(/\D/g, '')
    const button = form.querySelector('button')
    const box = document.querySelector('#mfa-error')

    if (!/^\d{6}$/.test(code)) {
      box.textContent = 'Digite os 6 números exibidos no aplicativo autenticador.'
      box.classList.remove('hidden')
      return
    }

    button.disabled = true
    box.classList.add('hidden')
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code })
    if (verifyError) {
      button.disabled = false
      box.textContent = 'Código inválido ou expirado. Aguarde o próximo código e tente novamente.'
      box.classList.remove('hidden')
      return
    }

    renderAdmin()
  })
}

function renderMfaChallenge(factors) {
  const factorOptions = factors.length > 1
    ? `<label class="span-2">Autenticador
        <select class="control" name="factor_id" required>
          ${factors.map((factor, index) => `<option value="${esc(factor.id)}">${esc(factor.friendly_name || `Autenticador ${index + 1}`)}</option>`).join('')}
        </select>
      </label>`
    : `<input type="hidden" name="factor_id" value="${esc(factors[0].id)}" />`

  app.innerHTML = mfaShell(
    'Confirme seu código',
    'Abra o aplicativo autenticador e digite o código atual para entrar no painel.',
    `<form id="mfa-challenge-form" class="form-grid">
      ${factorOptions}
      <label class="span-2">Código de 6 dígitos
        <input class="control mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus placeholder="000000" />
      </label>
      <button class="btn btn-primary span-2" type="submit">Confirmar e entrar</button>
      <div id="mfa-error" class="error hidden span-2" role="alert"></div>
    </form>`
  )
  bindMfaLogout()

  document.querySelector('#mfa-challenge-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const code = String(formData.get('code') || '').replace(/\D/g, '')
    const factorId = String(formData.get('factor_id') || '')
    const button = form.querySelector('button')
    const box = document.querySelector('#mfa-error')

    if (!/^\d{6}$/.test(code)) {
      box.textContent = 'Digite os 6 números exibidos no aplicativo autenticador.'
      box.classList.remove('hidden')
      return
    }

    button.disabled = true
    box.classList.add('hidden')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    if (error) {
      button.disabled = false
      box.textContent = 'Código inválido ou expirado. Aguarde o próximo código e tente novamente.'
      box.classList.remove('hidden')
      return
    }

    renderAdmin()
  })
}

function renderLogin(message = '') {
  app.innerHTML = `<main class="shell"><div class="login-wrap">
    <h2>Área da vendedora</h2><p>Entre para atualizar produtos e estoque.</p>
    ${message ? `<div class="notice">${esc(message)}</div>` : ''}
    <form id="login-form" class="form-grid">
      <label class="span-2">E-mail<input class="control" name="email" type="email" required autocomplete="email" /></label>
      <label class="span-2">Senha<input class="control" name="password" type="password" required autocomplete="current-password" /></label>
      <button class="btn btn-primary span-2" type="submit">Entrar</button>
      <div id="login-error" class="error hidden span-2" role="alert"></div>
    </form>
    <p class="login-back"><a class="admin-link" href="/">← Voltar ao catálogo</a></p>
  </div></main>`

  document.querySelector('#login-form').addEventListener('submit', async e => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const button = e.currentTarget.querySelector('button')
    const box = document.querySelector('#login-error')
    button.disabled = true
    box.classList.add('hidden')

    const { error } = await supabase.auth.signInWithPassword({
      email: String(fd.get('email') || '').trim(),
      password: String(fd.get('password') || '')
    })

    button.disabled = false
    if (error) {
      box.textContent = 'E-mail ou senha incorretos.'
      box.classList.remove('hidden')
      return
    }
    renderAdmin()
  })
}

async function renderDashboard() {
  app.innerHTML = `<main class="shell">${header(true)}<div class="loading" role="status">Carregando estoque…</div></main>`

  const [{ data: products, error: productError }, { data: movements, error: movementError }] = await Promise.all([
    supabase.from('products').select('*').order('created_at', { ascending: false }),
    supabase.from('stock_movements').select('id,operation_id,product_id,type,delta,created_at,products(name)').order('created_at', { ascending: false }).limit(50)
  ])

  if (productError || movementError) {
    console.error('Erro ao carregar o painel:', productError || movementError)
    app.innerHTML = `<main class="shell">${header(true)}<div class="error" role="alert">Não foi possível carregar o painel. Tente novamente em instantes.</div></main>`
    return
  }

  const allProducts = products || []
  reconcilePendingStockOperations(movements || [])
  const active = allProducts.filter(p => p.active)
  const units = active.reduce((sum, p) => sum + p.quantity, 0)
  const low = active.filter(p => p.quantity <= 1).length
  const notice = pendingAdminNotice
  pendingAdminNotice = null

  app.innerHTML = `<main class="shell">
    ${header(true)}
    <div class="admin-actions"><span class="security-status">✓ MFA ativo</span><button id="add-mfa-factor" class="btn btn-secondary" type="button">+ Autenticador reserva</button><button id="logout" class="btn btn-secondary" type="button">Sair</button></div>
    <div id="admin-feedback" class="admin-feedback ${notice ? (notice.type === 'error' ? 'feedback-error' : 'notice') : 'hidden'}" role="${notice?.type === 'error' ? 'alert' : 'status'}" aria-live="polite">${notice ? esc(notice.message) : ''}</div>
    <section class="stats">
      <div class="stat"><strong>${active.length}</strong><span>produtos ativos</span></div>
      <div class="stat"><strong>${units}</strong><span>unidades em estoque</span></div>
      <div class="stat"><strong>${low}</strong><span>com 1 un. ou menos</span></div>
    </section>
    <section class="panel">
      <div class="panel-heading"><h3>Produtos</h3><button id="new-product" class="btn btn-primary" type="button">+ Adicionar produto</button></div>
      <div id="product-form-wrap" class="hidden form-wrap"></div>
      <div class="admin-products">${allProducts.length ? allProducts.map(adminProductRow).join('') : `<div class="empty">Nenhum produto cadastrado.</div>`}</div>
    </section>
    <section class="panel">
      <h3>Últimas movimentações</h3>
      <div class="table-wrap"><table><caption class="sr-only">Últimas movimentações de estoque</caption><thead><tr><th scope="col">Quando</th><th scope="col">Produto</th><th scope="col">Movimento</th><th scope="col">Qtd.</th></tr></thead><tbody>
        ${(movements || []).length ? movements.map(m => `<tr><td>${dateTime.format(new Date(m.created_at))}</td><td>${esc(m.products?.name || 'Produto')}</td><td>${m.type === 'sale' ? 'Venda' : m.type === 'entry' ? 'Entrada' : 'Ajuste'}</td><td>${m.delta > 0 ? '+' : ''}${m.delta}</td></tr>`).join('') : `<tr><td colspan="4">Sem movimentações ainda.</td></tr>`}
      </tbody></table></div>
    </section>
  </main>`

  document.querySelector('#logout').addEventListener('click', async () => {
    await supabase.auth.signOut()
    renderLogin()
  })
  document.querySelector('#add-mfa-factor').addEventListener('click', () => renderMfaEnrollment({ backup: true }))
  document.querySelector('#new-product').addEventListener('click', () => showProductForm())
  document.querySelectorAll('[data-action="sell"]').forEach(btn => btn.addEventListener('click', () => {
    const product = allProducts.find(item => item.id === btn.dataset.id)
    if (!product || !window.confirm(`Registrar a venda de 1 unidade de “${product.name}”?`)) return
    adjust(btn.dataset.id, -1, 'sale', btn)
  }))
  document.querySelectorAll('[data-action="add"]').forEach(btn => btn.addEventListener('click', () => adjust(btn.dataset.id, 1, 'entry', btn)))
  document.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => showProductForm(allProducts.find(p => p.id === btn.dataset.id))))
  document.querySelectorAll('[data-action="toggle"]').forEach(btn => btn.addEventListener('click', () => {
    const product = allProducts.find(item => item.id === btn.dataset.id)
    if (product?.active && !window.confirm(`Ocultar “${product.name}” do catálogo?`)) return
    toggleProduct(product, btn)
  }))
}

function adminProductRow(p) {
  const photo = imageUrl(p.image_path)
  return `<div class="admin-product${p.active ? '' : ' admin-product-inactive'}">
    ${photo ? `<img class="admin-thumb" src="${photo}" alt="" loading="lazy" />` : `<div class="admin-thumb placeholder" aria-hidden="true">♡</div>`}
    <div><h4>${esc(p.name)}</h4><p>${esc(p.brand || '')}${p.category ? ` · ${esc(p.category)}` : ''} · ${money.format(Number(p.price || 0))} · <strong>${p.quantity} un.</strong>${p.active ? '' : ' · inativo'}</p></div>
    <div class="stock-actions">
      <button class="btn btn-secondary" type="button" data-action="add" data-id="${p.id}">+ Chegou 1</button>
      <button class="btn btn-primary" type="button" data-action="sell" data-id="${p.id}" ${p.quantity < 1 ? 'disabled' : ''}>− Vendi 1</button>
      <button class="btn btn-secondary" type="button" data-action="edit" data-id="${p.id}">Editar</button>
      <button class="btn ${p.active ? 'btn-danger' : 'btn-secondary'}" type="button" data-action="toggle" data-id="${p.id}">${p.active ? 'Ocultar' : 'Ativar'}</button>
    </div>
  </div>`
}

function showProductForm(product = null) {
  const wrap = document.querySelector('#product-form-wrap')
  if (!wrap) return

  wrap.classList.remove('hidden')
  wrap.innerHTML = `<div class="notice">Para lingerie, cadastre tamanho/cor no nome neste MVP. Ex.: “Sutiã Demillus Preto 44”.</div>
    <form id="product-form" class="form-grid">
      <label class="span-2">Nome do produto<input class="control" name="name" required maxlength="120" value="${esc(product?.name || '')}" /></label>
      <label>Marca<input class="control" name="brand" maxlength="80" placeholder="Natura" value="${esc(product?.brand || '')}" /></label>
      <label>Categoria<input class="control" name="category" maxlength="80" placeholder="Perfume" value="${esc(product?.category || '')}" /></label>
      <label>Preço<input class="control" name="price" inputmode="decimal" maxlength="11" required value="${product ? Number(product.price).toFixed(2).replace('.', ',') : ''}" placeholder="119,90" /></label>
      <label>Estoque inicial<input class="control" name="quantity" type="number" min="0" max="2147483647" step="1" required value="${product?.quantity ?? 1}" ${product ? 'disabled' : ''} /></label>
      <label class="span-2">Foto<input class="control" name="photo" type="file" accept="image/*" capture="environment" /><small>A imagem será reduzida antes do envio para economizar espaço.</small></label>
      ${product?.image_path ? `<label class="span-2 checkbox-control"><input name="remove_photo" type="checkbox" /> Remover a foto atual sem substituí-la</label>` : ''}
      <div class="span-2 form-actions"><button class="btn btn-primary" type="submit">Salvar</button><button class="btn btn-secondary" type="button" id="cancel-form">Cancelar</button></div>
      <div id="form-error" class="error hidden span-2" role="alert"></div>
    </form>`

  document.querySelector('#cancel-form').addEventListener('click', () => {
    wrap.innerHTML = ''
    wrap.classList.add('hidden')
  })
  document.querySelector('#product-form').addEventListener('submit', e => saveProduct(e, product))
  wrap.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start'
  })
}

async function loadImage(file) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    await image.decode()
    return image
  } finally {
    // O objeto só pode ser revogado depois que decode() terminou.
    // O elemento Image permanece utilizável para desenhar no canvas.
    URL.revokeObjectURL(objectUrl)
  }
}

async function preparePhoto(file) {
  if (!file?.size) return null
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.')
  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('A foto original é muito grande. Escolha uma imagem de até 20 MB.')

  let image
  try {
    image = await loadImage(file)
  } catch {
    throw new Error('Não consegui ler esta foto. Tente JPG, PNG ou outra foto da câmera.')
  }

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível preparar a foto para envio.')
  ctx.drawImage(image, 0, 0, width, height)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('Não foi possível preparar a foto para envio.')
  if (blob.size > MAX_UPLOAD_IMAGE_BYTES) throw new Error('A foto preparada ultrapassou 5 MB. Escolha outra imagem.')
  return blob
}

function productMatchesPayload(row, payload) {
  return row
    && row.name === payload.name
    && (row.brand || null) === payload.brand
    && (row.category || null) === payload.category
    && Number(row.price) === Number(payload.price)
    && (row.image_path || null) === payload.image_path
    && (payload.quantity === undefined || row.quantity === payload.quantity)
}

async function removeStoredImage(path) {
  const { data, error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path])
  return { removed: !error && Array.isArray(data) && data.length > 0, error }
}

async function saveProduct(e, product) {
  e.preventDefault()
  const form = e.currentTarget
  const fd = new FormData(form)
  const buttons = [...form.querySelectorAll('button')]
  const box = document.querySelector('#form-error')
  buttons.forEach(button => { button.disabled = true })
  box.classList.add('hidden')

  let uploadedPath = null
  let shouldCleanupUpload = false

  try {
    const name = String(fd.get('name') || '').trim()
    if (!name) throw new Error('Informe o nome do produto.')
    if (name.length > 120) throw new Error('O nome deve ter no máximo 120 caracteres.')

    const brand = String(fd.get('brand') || '').trim() || null
    const category = String(fd.get('category') || '').trim() || null
    if (brand && brand.length > 80) throw new Error('A marca deve ter no máximo 80 caracteres.')
    if (category && category.length > 80) throw new Error('A categoria deve ter no máximo 80 caracteres.')

    const rawPrice = String(fd.get('price') || '').trim()
    if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(rawPrice)) throw new Error('Informe um preço entre 0 e 99.999.999,99, com até 2 casas decimais.')
    const price = Number(rawPrice.replace(',', '.'))

    let quantity = null
    if (!product) {
      quantity = Number(fd.get('quantity'))
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) throw new Error('Estoque inicial inválido.')
    }

    let imagePath = product?.image_path || null
    const photo = fd.get('photo')
    const removePhoto = Boolean(product && fd.get('remove_photo'))
    if (removePhoto && photo?.size) throw new Error('Escolha entre remover a foto atual ou enviar uma substituta.')
    if (removePhoto) imagePath = null

    if (photo?.size) {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Sua sessão expirou. Entre novamente.')

      const prepared = await preparePhoto(photo)
      const path = `${user.id}/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await supabase.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .upload(path, prepared, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError
      uploadedPath = path
      shouldCleanupUpload = true
      imagePath = path
    }

    const targetId = product?.id || crypto.randomUUID()
    const payload = {
      name,
      brand,
      category,
      price,
      image_path: imagePath
    }

    let result
    if (product) {
      result = await supabase.from('products')
        .update(payload)
        .eq('id', targetId)
        .select('id,name,brand,category,price,quantity,image_path')
        .single()
    } else {
      payload.id = targetId
      payload.quantity = quantity
      result = await supabase.from('products')
        .insert(payload)
        .select('id,name,brand,category,price,quantity,image_path')
        .single()
    }

    if (result.error) {
      // Uma resposta perdida pode ocorrer depois do commit. Confirme o estado antes
      // de remover o upload ou oferecer uma tentativa que duplicaria o cadastro.
      const probe = await supabase.from('products')
        .select('id,name,brand,category,price,quantity,image_path')
        .eq('id', targetId)
        .maybeSingle()

      if (!probe.error && productMatchesPayload(probe.data, payload)) {
        result = probe
      } else if (probe.error) {
        console.error('Não foi possível confirmar o resultado da gravação:', result.error, probe.error)
        shouldCleanupUpload = false
        queueAdminNotice('A conexão caiu durante o salvamento. Confira o produto antes de tentar novamente.', 'error')
        return renderAdmin()
      } else {
        throw result.error
      }
    }

    if (!result.data?.id) throw new Error('A gravação não foi confirmada pelo banco.')
    shouldCleanupUpload = false

    if (product?.image_path && product.image_path !== imagePath) {
      const cleanup = await removeStoredImage(product.image_path)
      if (!cleanup.removed) {
        console.warn('Foto antiga não pôde ser removida:', cleanup.error?.message || 'objeto não removido')
        queueAdminNotice('O produto foi salvo, mas a foto antiga não pôde ser removida do Storage.', 'error')
      }
    }

    await renderAdmin()
  } catch (err) {
    let cleanupWarning = ''
    if (uploadedPath && shouldCleanupUpload) {
      const cleanup = await removeStoredImage(uploadedPath)
      if (!cleanup.removed) {
        console.warn('Upload órfão não pôde ser removido:', cleanup.error?.message || 'objeto não removido')
        cleanupWarning = ' O upload temporário também não pôde ser removido; avise o responsável técnico.'
      }
    }
    box.textContent = friendlyError(err, 'Não foi possível salvar o produto. Confira os dados e tente novamente.') + cleanupWarning
    box.classList.remove('hidden')
    buttons.forEach(button => { button.disabled = false })
  }
}

async function adjust(id, delta, type, button) {
  button.disabled = true
  const pendingKey = `stock-operation:${id}:${type}`
  let operationId = button.dataset.operationId || null
  try {
    operationId = sessionStorage.getItem(pendingKey) || operationId
  } catch {
    // O dataset mantém a idempotência durante esta tela se o Storage estiver bloqueado.
  }
  if (!operationId) {
    operationId = crypto.randomUUID()
    button.dataset.operationId = operationId
    try { sessionStorage.setItem(pendingKey, operationId) } catch { /* sem persistência entre recargas */ }
  }

  const { error } = await supabase.rpc('adjust_stock', {
    p_product_id: id,
    p_delta: delta,
    p_type: type,
    p_operation_id: operationId
  })
  if (error) {
    button.disabled = false
    showAdminNotice(friendlyError(error, 'Não foi possível atualizar o estoque. Recarregue o painel e confira o histórico.'))
    return
  }
  delete button.dataset.operationId
  try { sessionStorage.removeItem(pendingKey) } catch { /* nada a limpar */ }
  renderAdmin()
}

async function toggleProduct(product, button) {
  if (!product) return
  button.disabled = true
  const { data, error } = await supabase.from('products')
    .update({ active: !product.active })
    .eq('id', product.id)
    .select('id')
    .single()
  if (error) {
    button.disabled = false
    showAdminNotice(friendlyError(error, 'Não foi possível alterar a visibilidade do produto.'))
    return
  }
  if (!data?.id) {
    button.disabled = false
    showAdminNotice('A alteração não foi confirmada pelo banco.')
    return
  }
  renderAdmin()
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (isAdminRoute && !session && document.querySelector('.admin-products')) renderLogin()
})

isAdminRoute ? renderAdmin() : renderCatalog()
