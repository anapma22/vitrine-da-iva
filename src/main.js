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
const FEATURED_BRANDS = ['Natura', 'Avon', 'Demillus', 'Eudora']
const ADMIN_ACCESS_VALUE = '6d91c4f2a7be'

const app = document.querySelector('#app')
const isAdminRoute = new URLSearchParams(location.search).get('acesso') === ADMIN_ACCESS_VALUE

if (isAdminRoute) {
  const robotsMeta = document.createElement('meta')
  robotsMeta.name = 'robots'
  robotsMeta.content = 'noindex, nofollow, noarchive'
  document.head.append(robotsMeta)
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  app.innerHTML = `<div class="shell"><div class="error">Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo .env.</div></div>`
  throw new Error('Supabase não configurado')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]))
const hasPromotion = product => product?.promotional_price != null
  && Number.isFinite(Number(product.promotional_price))
  && Number(product.promotional_price) > 0
  && Number(product.promotional_price) < Number(product.price)
let pendingAdminNotice = null
let activeAdminView = 'stock'
let selectedCreditCustomerId = null

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
  'O preço promocional deve ser',
  'Estoque inicial inválido',
  'Escolha entre remover',
  'Escolha um arquivo de imagem',
  'A foto original é muito grande',
  'Não consegui ler esta foto',
  'Não foi possível preparar a foto',
  'A foto preparada ultrapassou',
  'Informe o nome do cliente',
  'O nome do cliente deve ter no máximo',
  'Informe um WhatsApp válido',
  'A observação deve ter no máximo',
  'Cliente e identificador da operação são obrigatórios',
  'Tipo de lançamento inválido',
  'Informe um valor válido',
  'A data do lançamento não pode estar no futuro',
  'A descrição deve ter no máximo',
  'Informe o que foi comprado',
  'Cliente não encontrado',
  'Este cliente não possui saldo em aberto',
  'O pagamento não pode ser maior que o saldo em aberto',
  'Identificador de lançamento já utilizado',
  'Lançamento não encontrado',
  'Este lançamento já foi cancelado',
  'Cancele primeiro os pagamentos ligados a esta compra'
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
    <div class="brand"><h1>${esc(STORE_NAME)}</h1><p>${admin ? 'Estoque e caderneta' : 'Produtos disponíveis agora'}</p></div>
    ${admin ? '<a class="admin-link" href="/">Ver catálogo</a>' : ''}
  </header>`
}

function catalogIntro() {
  return `<section class="hero">
    <div class="hero-copy">
      <span class="hero-kicker">Escolhas para você</span>
      <h2>Beleza, cuidado e presentes para todos os momentos</h2>
      <p>Perfumes, maquiagens, cuidados pessoais e lingerie à pronta entrega, com opções por encomenda e atendimento direto pelo WhatsApp.</p>
      <a class="btn btn-primary hero-cta" href="#catalog-products">Explorar produtos <span aria-hidden="true">↓</span></a>
    </div>
    <div class="hero-visual">
      <p class="hero-availability"><span aria-hidden="true"></span>Disponível agora</p>
      <ol class="showcase-list">
        <li><span>01</span><strong>Perfumaria</strong></li>
        <li><span>02</span><strong>Corpo &amp; banho</strong></li>
        <li><span>03</span><strong>Moda íntima</strong></li>
        <li><span>04</span><strong>Maquiagens</strong></li>
        <li><span>05</span><strong>Encomendas</strong></li>
      </ol>
    </div>
  </section>
  <section class="brand-showcase" aria-labelledby="featured-brands-title">
    <p id="featured-brands-title" class="brand-showcase-title">Marcas que você encontra por aqui</p>
    <ul class="brand-list">
      ${FEATURED_BRANDS.map(brand => `<li class="brand-chip"><span aria-hidden="true">${esc(brand[0])}</span><strong>${esc(brand)}</strong></li>`).join('')}
    </ul>
  </section>
  <section class="gift-highlight" aria-labelledby="gift-title">
    <div class="gift-illustration" aria-hidden="true">
      <span class="gift-spark gift-spark-one">✦</span>
      <span class="gift-spark gift-spark-two">✦</span>
      <div class="gift-box"><span class="gift-lid"></span><span class="gift-body"></span></div>
    </div>
    <div class="gift-copy">
      <span class="gift-kicker">Um carinho em forma de presente</span>
      <h2 id="gift-title">Presentes para datas especiais</h2>
      <p>Escolha algo cheio de cuidado e confirme a disponibilidade diretamente pelo WhatsApp.</p>
    </div>
    <ul class="gift-occasions" aria-label="Sugestões de ocasiões">
      <li>Aniversários</li>
      <li>Datas comemorativas</li>
      <li>Um carinho sem data</li>
    </ul>
  </section>`
}

async function renderCatalog() {
  app.innerHTML = `<main class="shell">${header(false)}${catalogIntro()}<div class="loading" role="status">Carregando produtos…</div></main>`

  const { data, error } = await supabase
    .from('products')
    .select('id,name,brand,category,price,promotional_price,quantity,image_path')
    .eq('active', true)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })

  if (error) return showCatalogError(error.message)

  const products = data || []
  const promotionCount = products.filter(hasPromotion).length
  const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  app.innerHTML = `<main class="shell">
    ${header(false)}
    ${catalogIntro()}
    <div class="catalog-tabs" role="group" aria-label="Tipo de produtos">
      <button class="catalog-tab is-active" type="button" data-catalog-view="all" aria-pressed="true">Todos</button>
      <button class="catalog-tab" type="button" data-catalog-view="promotions" aria-pressed="false">Promoções <span>${promotionCount}</span></button>
    </div>
    <section class="filters" aria-label="Filtros do catálogo">
      <input id="search" class="control" aria-label="Buscar produtos" placeholder="Buscar perfume, hidratante, lingerie…" />
      <select id="brand" class="control" aria-label="Filtrar por marca"><option value="">Todas as marcas</option>${brands.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
      <select id="category" class="control" aria-label="Filtrar por categoria"><option value="">Todas as categorias</option>${categories.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
    </section>
    <div id="catalog-products" class="catalog-heading">
      <div><span class="section-kicker">Catálogo</span><h2>Produtos disponíveis</h2></div>
      <span id="result-count" class="result-count"></span>
    </div>
    <section id="catalog" class="grid" aria-live="polite"></section>
  </main>`

  const search = document.querySelector('#search')
  const brand = document.querySelector('#brand')
  const category = document.querySelector('#category')
  const tabs = [...document.querySelectorAll('[data-catalog-view]')]
  let activeView = 'all'

  const draw = () => {
    const q = search.value.trim().toLowerCase()
    const filtered = products.filter(p => {
      const haystack = `${p.name} ${p.brand || ''} ${p.category || ''}`.toLowerCase()
      return (!q || haystack.includes(q))
        && (!brand.value || p.brand === brand.value)
        && (!category.value || p.category === category.value)
        && (activeView !== 'promotions' || hasPromotion(p))
    })
    const resultCount = document.querySelector('#result-count')
    resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'produto' : 'produtos'}`
    document.querySelector('#catalog').innerHTML = filtered.length
      ? filtered.map(productCard).join('')
      : `<div class="empty catalog-empty">${activeView === 'promotions' ? 'Nenhuma promoção encontrada com esses filtros.' : 'Nenhum produto encontrado.'}</div>`
  }

  tabs.forEach(tab => tab.addEventListener('click', () => {
    activeView = tab.dataset.catalogView
    tabs.forEach(item => {
      const selected = item === tab
      item.classList.toggle('is-active', selected)
      item.setAttribute('aria-pressed', String(selected))
    })
    draw()
  }))
  search.addEventListener('input', draw)
  brand.addEventListener('change', draw)
  category.addEventListener('change', draw)
  draw()
}

function productCard(p) {
  const photo = imageUrl(p.image_path)
  const promotion = hasPromotion(p)
  const msg = `Olá! Vi ${p.name} no catálogo ${STORE_NAME}. Ainda está disponível?`
  const link = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}` : ''
  const whatsappAction = link
    ? `<a class="btn btn-whatsapp" href="${link}" target="_blank" rel="noopener noreferrer">Quero esse no WhatsApp</a>`
    : `<button class="btn btn-whatsapp" type="button" disabled>WhatsApp não configurado</button>`

  return `<article class="card">
    <div class="product-media">${photo ? `<img class="product-image" src="${photo}" alt="${esc(p.name)}" loading="lazy" />` : `<div class="product-image placeholder" aria-hidden="true">♡</div>`}${promotion ? '<span class="promo-badge">Oferta</span>' : ''}</div>
    <div class="card-body">
      <div class="pills">${p.brand ? `<span class="pill">${esc(p.brand)}</span>` : ''}${p.category ? `<span class="pill">${esc(p.category)}</span>` : ''}</div>
      <h3>${esc(p.name)}</h3>
      <div class="price-row"><div class="price-group">${promotion ? `<span class="original-price"><span class="sr-only">De </span>${money.format(Number(p.price))}</span><span class="price promo-price"><span class="sr-only">Por </span>${money.format(Number(p.promotional_price))}</span>` : `<span class="price">${money.format(Number(p.price || 0))}</span>`}</div><span class="stock">${p.quantity} disponível${p.quantity === 1 ? '' : 'is'}</span></div>
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

function adminNavigation(activeView) {
  return `<nav class="admin-tabs" aria-label="Seções da área da vendedora">
    <button class="admin-tab${activeView === 'stock' ? ' is-active' : ''}" type="button" data-admin-view="stock" aria-pressed="${activeView === 'stock'}">Estoque</button>
    <button class="admin-tab${activeView === 'credit' ? ' is-active' : ''}" type="button" data-admin-view="credit" aria-pressed="${activeView === 'credit'}">Caderneta</button>
  </nav>`
}

function bindAdminChrome() {
  document.querySelector('#logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    renderLogin()
  })
  document.querySelector('#add-mfa-factor')?.addEventListener('click', () => renderMfaEnrollment({ backup: true }))
  document.querySelectorAll('[data-admin-view]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.adminView !== activeAdminView) renderDashboard(button.dataset.adminView)
  }))
}

async function renderDashboard(view = activeAdminView) {
  activeAdminView = view === 'credit' ? 'credit' : 'stock'
  if (activeAdminView === 'credit') return renderCreditDashboard()
  return renderStockDashboard()
}

async function renderStockDashboard() {
  app.innerHTML = `<main class="shell" data-admin-screen>${header(true)}${adminNavigation('stock')}<div class="loading" role="status">Carregando estoque…</div></main>`

  const [{ data: products, error: productError }, { data: movements, error: movementError }] = await Promise.all([
    supabase.from('products').select('*').order('created_at', { ascending: false }),
    supabase.from('stock_movements').select('id,operation_id,product_id,type,delta,created_at,products(name)').order('created_at', { ascending: false }).limit(50)
  ])

  if (productError || movementError) {
    console.error('Erro ao carregar o painel:', productError || movementError)
    app.innerHTML = `<main class="shell" data-admin-screen>${header(true)}${adminNavigation('stock')}<div class="error" role="alert">Não foi possível carregar o painel. Tente novamente em instantes.</div></main>`
    bindAdminChrome()
    return
  }

  const allProducts = products || []
  reconcilePendingStockOperations(movements || [])
  const active = allProducts.filter(p => p.active)
  const units = active.reduce((sum, p) => sum + p.quantity, 0)
  const low = active.filter(p => p.quantity <= 1).length
  const notice = pendingAdminNotice
  pendingAdminNotice = null

  app.innerHTML = `<main class="shell" data-admin-screen>
    ${header(true)}
    ${adminNavigation('stock')}
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

  bindAdminChrome()
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

function localDateValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—'
  return dateOnly.format(new Date(`${value}T12:00:00`))
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  if (digits.length < 10 || digits.length > 15) throw new Error('Informe um WhatsApp válido com DDD.')
  return digits
}

function formatPhone(value) {
  const digits = String(value || '')
  if (/^55\d{11}$/.test(digits)) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  if (/^55\d{10}$/.test(digits)) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  return digits ? `+${digits}` : ''
}

function reconcilePendingCreditOperations(transactions) {
  try {
    for (const transaction of transactions) {
      const recordKey = `credit-operation:${transaction.customer_id}:${transaction.type}`
      if (sessionStorage.getItem(recordKey) === transaction.operation_id) sessionStorage.removeItem(recordKey)
      const cancelKey = `credit-cancel:${transaction.id}`
      if (transaction.reversal_operation_id && sessionStorage.getItem(cancelKey) === transaction.reversal_operation_id) {
        sessionStorage.removeItem(cancelKey)
      }
    }
  } catch {
    // A caderneta continua utilizável quando o Storage do navegador está bloqueado.
  }
}

function creditCustomerRow(customer) {
  const balance = Number(customer.balance || 0)
  const phone = formatPhone(customer.phone)
  const searchText = `${customer.customer_name} ${phone}`.toLocaleLowerCase('pt-BR')
  return `<article class="credit-customer${selectedCreditCustomerId === customer.customer_id ? ' is-selected' : ''}" data-credit-customer data-search="${esc(searchText)}">
    <div class="credit-customer-main">
      <div>
        <h4>${esc(customer.customer_name)}</h4>
        ${phone ? `<a class="credit-phone" href="https://wa.me/${esc(customer.phone)}" target="_blank" rel="noopener noreferrer">${esc(phone)}</a>` : '<span class="credit-phone">Sem WhatsApp</span>'}
        ${customer.notes ? `<p>${esc(customer.notes)}</p>` : ''}
      </div>
      <div class="credit-balance${balance > 0 ? ' has-debt' : ' is-settled'}"><span>Saldo</span><strong>${money.format(balance)}</strong></div>
    </div>
    <div class="credit-customer-summary"><span>Comprou: ${money.format(Number(customer.total_purchases || 0))}</span><span>Pagou: ${money.format(Number(customer.total_payments || 0))}</span></div>
    <div class="credit-customer-actions" data-no-print>
      <button class="btn btn-primary" type="button" data-action="credit-purchase" data-id="${customer.customer_id}">+ Compra fiada</button>
      <button class="btn btn-secondary" type="button" data-action="credit-payment" data-id="${customer.customer_id}" ${balance <= 0 ? 'disabled' : ''}>Registrar pagamento</button>
      <button class="btn btn-secondary" type="button" data-action="credit-history" data-id="${customer.customer_id}">Ver histórico</button>
      <button class="btn btn-secondary" type="button" data-action="credit-edit-customer" data-id="${customer.customer_id}">Editar</button>
    </div>
  </article>`
}

function creditLedgerRow(transaction) {
  const isPurchase = transaction.type === 'purchase'
  const canceled = Boolean(transaction.reversed_at)
  return `<article class="ledger-row${canceled ? ' is-canceled' : ''}">
    <div class="ledger-copy">
      <div class="ledger-title"><strong>${esc(transaction.credit_customers?.name || 'Cliente')}</strong><span>${formatDateValue(transaction.occurred_on)}</span></div>
      <p>${isPurchase ? 'Compra fiada' : 'Pagamento recebido'}${transaction.description ? ` · ${esc(transaction.description)}` : ''}${canceled ? ' · Cancelado' : ''}</p>
    </div>
    <strong class="ledger-amount ${isPurchase ? 'ledger-debt' : 'ledger-payment'}">${isPurchase ? '+' : '−'} ${money.format(Number(transaction.amount || 0))}</strong>
    ${canceled ? '' : `<button class="link-button ledger-cancel" type="button" data-no-print data-action="credit-cancel" data-id="${transaction.id}">Cancelar</button>`}
  </article>`
}

async function renderCreditDashboard() {
  app.innerHTML = `<main class="shell" data-admin-screen>${header(true)}${adminNavigation('credit')}<div class="loading" role="status">Carregando caderneta…</div></main>`

  let transactionQuery = supabase
    .from('credit_transactions')
    .select('id,operation_id,customer_id,type,amount,description,occurred_on,created_at,reversed_at,reversal_operation_id,credit_customers(name,phone)')
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (selectedCreditCustomerId) transactionQuery = transactionQuery.eq('customer_id', selectedCreditCustomerId)

  const [{ data: customers, error: customerError }, { data: transactions, error: transactionError }] = await Promise.all([
    supabase.rpc('get_credit_customer_balances'),
    transactionQuery
  ])

  if (customerError || transactionError) {
    console.error('Erro ao carregar a caderneta:', customerError || transactionError)
    app.innerHTML = `<main class="shell" data-admin-screen>${header(true)}${adminNavigation('credit')}<div class="error" role="alert">Não foi possível carregar a caderneta. Confirme se o SQL atualizado foi executado no Supabase.</div></main>`
    bindAdminChrome()
    return
  }

  const allCustomers = customers || []
  const recentTransactions = transactions || []
  if (selectedCreditCustomerId && !allCustomers.some(customer => customer.customer_id === selectedCreditCustomerId)) {
    selectedCreditCustomerId = null
    return renderCreditDashboard()
  }
  reconcilePendingCreditOperations(recentTransactions)

  const totalReceivable = allCustomers.reduce((sum, customer) => sum + Number(customer.balance || 0), 0)
  const totalReceived = allCustomers.reduce((sum, customer) => sum + Number(customer.total_payments || 0), 0)
  const customersWithDebt = allCustomers.filter(customer => Number(customer.balance || 0) > 0).length
  const selectedCustomer = allCustomers.find(customer => customer.customer_id === selectedCreditCustomerId)
  const notice = pendingAdminNotice
  pendingAdminNotice = null

  app.innerHTML = `<main class="shell" data-admin-screen>
    ${header(true)}
    ${adminNavigation('credit')}
    <div class="admin-actions"><span class="security-status">✓ Dados protegidos por MFA</span><button id="add-mfa-factor" class="btn btn-secondary" type="button">+ Autenticador reserva</button><button id="logout" class="btn btn-secondary" type="button">Sair</button></div>
    <div id="admin-feedback" class="admin-feedback ${notice ? (notice.type === 'error' ? 'feedback-error' : 'notice') : 'hidden'}" role="${notice?.type === 'error' ? 'alert' : 'status'}" aria-live="polite">${notice ? esc(notice.message) : ''}</div>
    <div id="finance-report">
      <div class="print-only"><h2>Caderneta de clientes</h2><p>Relatório emitido em ${dateTime.format(new Date())}</p></div>
      <section class="stats finance-stats" aria-label="Resumo da caderneta">
        <div class="stat stat-receivable"><strong>${money.format(totalReceivable)}</strong><span>total a receber</span></div>
        <div class="stat"><strong>${money.format(totalReceived)}</strong><span>total já recebido</span></div>
        <div class="stat"><strong>${customersWithDebt}</strong><span>${customersWithDebt === 1 ? 'cliente devendo' : 'clientes devendo'}</span></div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div><h3>Clientes</h3><p class="panel-intro">Registre somente compras fiadas e o dinheiro que realmente foi recebido.</p></div>
          <div class="finance-toolbar" data-no-print><button id="export-credit" class="btn btn-secondary" type="button">Exportar Excel</button><button id="print-credit" class="btn btn-secondary" type="button">Salvar resumo em PDF</button><button id="new-credit-customer" class="btn btn-primary" type="button">+ Cliente</button></div>
        </div>
        <div id="credit-customer-form-wrap" class="hidden form-wrap" data-no-print></div>
        <div id="credit-transaction-form-wrap" class="hidden form-wrap" data-no-print></div>
        <label class="credit-search" data-no-print><span class="sr-only">Buscar cliente</span><input id="credit-search" class="control" type="search" placeholder="Buscar cliente ou WhatsApp…" /></label>
        <div class="credit-customers">${allCustomers.length ? allCustomers.map(creditCustomerRow).join('') : '<div class="empty">Nenhum cliente cadastrado.</div>'}</div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h3>${selectedCustomer ? `Histórico de ${esc(selectedCustomer.customer_name)}` : 'Lançamentos recentes'}</h3>${selectedCustomer ? '<button id="all-credit-history" class="btn btn-secondary" type="button" data-no-print>Ver todos</button>' : ''}</div>
        <div class="ledger-list">${recentTransactions.length ? recentTransactions.map(creditLedgerRow).join('') : `<div class="empty">${selectedCustomer ? 'Este cliente ainda não possui lançamentos.' : 'Nenhuma compra ou pagamento registrado.'}</div>`}</div>
      </section>
    </div>
  </main>`

  bindAdminChrome()
  document.querySelector('#new-credit-customer').addEventListener('click', () => showCreditCustomerForm())
  document.querySelector('#export-credit').addEventListener('click', event => exportCreditData(allCustomers, event.currentTarget))
  document.querySelector('#print-credit').addEventListener('click', printCreditReport)
  document.querySelector('#all-credit-history')?.addEventListener('click', () => {
    selectedCreditCustomerId = null
    renderDashboard('credit')
  })
  document.querySelector('#credit-search').addEventListener('input', event => {
    const query = event.currentTarget.value.trim().toLocaleLowerCase('pt-BR')
    document.querySelectorAll('[data-credit-customer]').forEach(row => {
      row.classList.toggle('hidden', Boolean(query) && !row.dataset.search.includes(query))
    })
  })
  document.querySelectorAll('[data-action="credit-purchase"]').forEach(button => button.addEventListener('click', () => {
    showCreditTransactionForm(allCustomers.find(customer => customer.customer_id === button.dataset.id), 'purchase')
  }))
  document.querySelectorAll('[data-action="credit-payment"]').forEach(button => button.addEventListener('click', () => {
    showCreditTransactionForm(allCustomers.find(customer => customer.customer_id === button.dataset.id), 'payment')
  }))
  document.querySelectorAll('[data-action="credit-history"]').forEach(button => button.addEventListener('click', () => {
    selectedCreditCustomerId = button.dataset.id
    renderDashboard('credit')
  }))
  document.querySelectorAll('[data-action="credit-edit-customer"]').forEach(button => button.addEventListener('click', () => {
    showCreditCustomerForm(allCustomers.find(customer => customer.customer_id === button.dataset.id))
  }))
  document.querySelectorAll('[data-action="credit-cancel"]').forEach(button => button.addEventListener('click', () => {
    const transaction = recentTransactions.find(item => item.id === button.dataset.id)
    if (!transaction || !window.confirm(`Cancelar este lançamento de ${money.format(Number(transaction.amount))}? O registro continuará visível no histórico.`)) return
    cancelCreditTransaction(transaction, button)
  }))
}

function showCreditCustomerForm(customer = null) {
  const wrap = document.querySelector('#credit-customer-form-wrap')
  if (!wrap) return
  const transactionWrap = document.querySelector('#credit-transaction-form-wrap')
  if (transactionWrap) {
    transactionWrap.innerHTML = ''
    transactionWrap.classList.add('hidden')
  }
  wrap.classList.remove('hidden')
  wrap.innerHTML = `<div class="subform-heading"><h4>${customer ? 'Editar cliente' : 'Novo cliente'}</h4><p>O WhatsApp e as anotações ficam visíveis somente nesta área protegida.</p></div>
    <form id="credit-customer-form" class="form-grid">
      <label>Nome<input class="control" name="name" required maxlength="120" value="${esc(customer?.customer_name || '')}" /></label>
      <label>WhatsApp com DDD <small class="optional-label">opcional</small><input class="control" name="phone" type="tel" inputmode="tel" maxlength="24" placeholder="(84) 99999-9999" value="${esc(formatPhone(customer?.phone || ''))}" /></label>
      <label class="span-2">Observação <small class="optional-label">opcional</small><textarea class="control" name="notes" maxlength="500" rows="3" placeholder="Ex.: prefere receber no começo do mês">${esc(customer?.notes || '')}</textarea></label>
      <div class="span-2 form-actions"><button class="btn btn-primary" type="submit">Salvar cliente</button><button class="btn btn-secondary" type="button" id="cancel-credit-customer">Cancelar</button></div>
      <div id="credit-customer-error" class="error hidden span-2" role="alert"></div>
    </form>`
  document.querySelector('#cancel-credit-customer').addEventListener('click', () => {
    wrap.innerHTML = ''
    wrap.classList.add('hidden')
  })
  document.querySelector('#credit-customer-form').addEventListener('submit', event => saveCreditCustomer(event, customer))
  wrap.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

function creditCustomerMatchesPayload(row, payload) {
  return row
    && row.name === payload.name
    && (row.phone || null) === payload.phone
    && (row.notes || null) === payload.notes
}

async function saveCreditCustomer(event, customer) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  const buttons = [...form.querySelectorAll('button')]
  const box = document.querySelector('#credit-customer-error')
  buttons.forEach(button => { button.disabled = true })
  box.classList.add('hidden')

  try {
    const name = String(data.get('name') || '').trim()
    if (!name) throw new Error('Informe o nome do cliente.')
    if (name.length > 120) throw new Error('O nome do cliente deve ter no máximo 120 caracteres.')
    const phone = normalizePhone(data.get('phone'))
    const notes = String(data.get('notes') || '').trim() || null
    if (notes && notes.length > 500) throw new Error('A observação deve ter no máximo 500 caracteres.')

    const targetId = customer?.customer_id || crypto.randomUUID()
    const payload = { name, phone, notes }
    let result
    if (customer) {
      result = await supabase.from('credit_customers').update(payload).eq('id', targetId).select('id,name,phone,notes').single()
    } else {
      result = await supabase.from('credit_customers').insert({ id: targetId, ...payload }).select('id,name,phone,notes').single()
    }

    if (result.error) {
      const probe = await supabase.from('credit_customers').select('id,name,phone,notes').eq('id', targetId).maybeSingle()
      if (!probe.error && creditCustomerMatchesPayload(probe.data, payload)) {
        result = probe
      } else if (probe.error) {
        console.error('Não foi possível confirmar o cadastro do cliente:', result.error, probe.error)
        queueAdminNotice('A conexão caiu durante o salvamento. Confira o cliente antes de tentar novamente.', 'error')
        return renderDashboard('credit')
      } else {
        throw result.error
      }
    }

    if (!result.data?.id) throw new Error('O cadastro do cliente não foi confirmado pelo banco.')
    selectedCreditCustomerId = targetId
    queueAdminNotice(customer ? 'Cliente atualizado.' : 'Cliente cadastrado.', 'notice')
    renderDashboard('credit')
  } catch (error) {
    box.textContent = friendlyError(error, 'Não foi possível salvar o cliente. Confira os dados e tente novamente.')
    box.classList.remove('hidden')
    buttons.forEach(button => { button.disabled = false })
  }
}

function showCreditTransactionForm(customer, type) {
  const wrap = document.querySelector('#credit-transaction-form-wrap')
  if (!wrap || !customer) return
  const customerWrap = document.querySelector('#credit-customer-form-wrap')
  if (customerWrap) {
    customerWrap.innerHTML = ''
    customerWrap.classList.add('hidden')
  }
  const isPurchase = type === 'purchase'
  const balance = Number(customer.balance || 0)
  wrap.classList.remove('hidden')
  wrap.innerHTML = `<div class="subform-heading"><h4>${isPurchase ? 'Registrar compra fiada' : 'Registrar pagamento'}</h4><p>Cliente: <strong>${esc(customer.customer_name)}</strong>${isPurchase ? '' : ` · Saldo atual: <strong>${money.format(balance)}</strong>`}</p></div>
    <form id="credit-transaction-form" class="form-grid">
      <label>Valor<input class="control" name="amount" inputmode="decimal" maxlength="11" required placeholder="100,00" /></label>
      <label>Data<input class="control" name="occurred_on" type="date" max="${localDateValue()}" required value="${localDateValue()}" /></label>
      <label class="span-2">${isPurchase ? 'O que foi comprado' : 'Forma de pagamento ou observação'} <small class="optional-label">${isPurchase ? 'obrigatório' : 'opcional'}</small><input class="control" name="description" maxlength="200" ${isPurchase ? 'required' : ''} placeholder="${isPurchase ? 'Ex.: perfume Natura e hidratante' : 'Ex.: Pix ou dinheiro'}" /></label>
      <div class="span-2 form-actions"><button class="btn btn-primary" type="submit">${isPurchase ? 'Registrar compra' : 'Confirmar pagamento'}</button><button class="btn btn-secondary" type="button" id="cancel-credit-transaction">Cancelar</button></div>
      <div id="credit-transaction-error" class="error hidden span-2" role="alert"></div>
    </form>`
  document.querySelector('#cancel-credit-transaction').addEventListener('click', () => {
    wrap.innerHTML = ''
    wrap.classList.add('hidden')
  })
  document.querySelector('#credit-transaction-form').addEventListener('submit', event => saveCreditTransaction(event, customer, type))
  wrap.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

async function saveCreditTransaction(event, customer, type) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  const buttons = [...form.querySelectorAll('button')]
  const box = document.querySelector('#credit-transaction-error')
  buttons.forEach(button => { button.disabled = true })
  box.classList.add('hidden')

  try {
    const rawAmount = String(data.get('amount') || '').trim()
    if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(rawAmount)) throw new Error('Informe um valor válido com até 2 casas decimais.')
    const amount = Number(rawAmount.replace(',', '.'))
    if (amount <= 0) throw new Error('Informe um valor válido maior que zero.')
    const description = String(data.get('description') || '').trim()
    if (type === 'purchase' && !description) throw new Error('Informe o que foi comprado.')
    if (description.length > 200) throw new Error('A descrição deve ter no máximo 200 caracteres.')
    const occurredOn = String(data.get('occurred_on') || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || occurredOn > localDateValue()) throw new Error('A data do lançamento não pode estar no futuro.')

    const pendingKey = `credit-operation:${customer.customer_id}:${type}`
    let operationId = form.dataset.operationId || null
    try { operationId = sessionStorage.getItem(pendingKey) || operationId } catch { /* dataset ainda protege esta tela */ }
    if (!operationId) {
      operationId = crypto.randomUUID()
      form.dataset.operationId = operationId
      try { sessionStorage.setItem(pendingKey, operationId) } catch { /* sem persistência entre recargas */ }
    }

    const { error } = await supabase.rpc('record_credit_transaction', {
      p_customer_id: customer.customer_id,
      p_type: type,
      p_amount: amount,
      p_description: description || null,
      p_occurred_on: occurredOn,
      p_operation_id: operationId
    })
    if (error) throw error

    try { sessionStorage.removeItem(pendingKey) } catch { /* nada a limpar */ }
    selectedCreditCustomerId = customer.customer_id
    queueAdminNotice(type === 'purchase' ? 'Compra fiada registrada.' : 'Pagamento registrado.', 'notice')
    renderDashboard('credit')
  } catch (error) {
    box.textContent = friendlyError(error, 'Não foi possível registrar o lançamento. Recarregue a caderneta e confira o histórico antes de tentar novamente.')
    box.classList.remove('hidden')
    buttons.forEach(button => { button.disabled = false })
  }
}

async function cancelCreditTransaction(transaction, button) {
  button.disabled = true
  const pendingKey = `credit-cancel:${transaction.id}`
  let operationId = button.dataset.operationId || null
  try { operationId = sessionStorage.getItem(pendingKey) || operationId } catch { /* dataset ainda protege esta tela */ }
  if (!operationId) {
    operationId = crypto.randomUUID()
    button.dataset.operationId = operationId
    try { sessionStorage.setItem(pendingKey, operationId) } catch { /* sem persistência entre recargas */ }
  }

  const { error } = await supabase.rpc('cancel_credit_transaction', {
    p_transaction_id: transaction.id,
    p_reversal_operation_id: operationId
  })
  if (error) {
    button.disabled = false
    showAdminNotice(friendlyError(error, 'Não foi possível cancelar o lançamento. Recarregue a caderneta e confira o histórico.'))
    return
  }
  try { sessionStorage.removeItem(pendingKey) } catch { /* nada a limpar */ }
  queueAdminNotice('Lançamento cancelado sem apagar o histórico.', 'notice')
  renderDashboard('credit')
}

async function fetchAllCreditTransactions() {
  const pageSize = 1000
  const transactions = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('id,customer_id,type,amount,description,occurred_on,created_at,reversed_at,credit_customers(name,phone)')
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    transactions.push(...(data || []))
    if ((data || []).length < pageSize) return transactions
  }
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function csvAmount(value) {
  return Number(value || 0).toFixed(2).replace('.', ',')
}

async function exportCreditData(customers, button) {
  const originalLabel = button.textContent
  button.disabled = true
  button.textContent = 'Preparando…'
  try {
    const transactions = await fetchAllCreditTransactions()
    const lines = [
      'sep=;',
      csvCell('RESUMO POR CLIENTE'),
      ['Cliente', 'WhatsApp', 'Total comprado', 'Total pago', 'Saldo atual', 'Última movimentação'].map(csvCell).join(';'),
      ...customers.map(customer => [
        customer.customer_name,
        formatPhone(customer.phone),
        csvAmount(customer.total_purchases),
        csvAmount(customer.total_payments),
        csvAmount(customer.balance),
        formatDateValue(customer.last_activity_on)
      ].map(csvCell).join(';')),
      '',
      csvCell('HISTÓRICO COMPLETO'),
      ['Data', 'Cliente', 'WhatsApp', 'Tipo', 'Descrição', 'Valor', 'Situação'].map(csvCell).join(';'),
      ...transactions.map(transaction => [
        formatDateValue(transaction.occurred_on),
        transaction.credit_customers?.name || 'Cliente',
        formatPhone(transaction.credit_customers?.phone),
        transaction.type === 'purchase' ? 'Compra fiada' : 'Pagamento',
        transaction.description || '',
        csvAmount(transaction.amount),
        transaction.reversed_at ? 'Cancelado' : 'Válido'
      ].map(csvCell).join(';'))
    ]
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `caderneta-${localDateValue()}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    showAdminNotice(friendlyError(error, 'Não foi possível exportar a caderneta. Tente novamente.'))
  } finally {
    button.disabled = false
    button.textContent = originalLabel
  }
}

function printCreditReport() {
  const previousTitle = document.title
  document.body.classList.add('finance-print')
  document.title = `Caderneta - ${STORE_NAME} - ${localDateValue()}`
  window.print()
  document.title = previousTitle
  document.body.classList.remove('finance-print')
}

function adminProductRow(p) {
  const photo = imageUrl(p.image_path)
  const priceSummary = hasPromotion(p)
    ? `<s>${money.format(Number(p.price))}</s> <strong class="admin-promo-price">${money.format(Number(p.promotional_price))}</strong>`
    : money.format(Number(p.price || 0))
  return `<div class="admin-product${p.active ? '' : ' admin-product-inactive'}">
    ${photo ? `<img class="admin-thumb" src="${photo}" alt="" loading="lazy" />` : `<div class="admin-thumb placeholder" aria-hidden="true">♡</div>`}
    <div><h4>${esc(p.name)}</h4><p>${esc(p.brand || '')}${p.category ? ` · ${esc(p.category)}` : ''} · ${priceSummary} · <strong>${p.quantity} un.</strong>${p.active ? '' : ' · inativo'}</p></div>
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
      <label><span class="label-title">Preço promocional <small class="optional-label">opcional</small></span><input class="control" name="promotional_price" inputmode="decimal" maxlength="11" value="${product?.promotional_price != null ? Number(product.promotional_price).toFixed(2).replace('.', ',') : ''}" placeholder="99,90" /><small>Deixe vazio quando o produto não estiver em promoção.</small></label>
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
    && (row.promotional_price == null ? null : Number(row.promotional_price)) === (payload.promotional_price == null ? null : Number(payload.promotional_price))
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

    const rawPromotionalPrice = String(fd.get('promotional_price') || '').trim()
    let promotionalPrice = null
    if (rawPromotionalPrice) {
      if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(rawPromotionalPrice)) throw new Error('O preço promocional deve ser um valor válido com até 2 casas decimais.')
      promotionalPrice = Number(rawPromotionalPrice.replace(',', '.'))
      if (promotionalPrice <= 0 || promotionalPrice >= price) throw new Error('O preço promocional deve ser maior que zero e menor que o preço normal.')
    }

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
      promotional_price: promotionalPrice,
      image_path: imagePath
    }

    let result
    if (product) {
      result = await supabase.from('products')
        .update(payload)
        .eq('id', targetId)
        .select('id,name,brand,category,price,promotional_price,quantity,image_path')
        .single()
    } else {
      payload.id = targetId
      payload.quantity = quantity
      result = await supabase.from('products')
        .insert(payload)
        .select('id,name,brand,category,price,promotional_price,quantity,image_path')
        .single()
    }

    if (result.error) {
      // Uma resposta perdida pode ocorrer depois do commit. Confirme o estado antes
      // de remover o upload ou oferecer uma tentativa que duplicaria o cadastro.
      const probe = await supabase.from('products')
        .select('id,name,brand,category,price,promotional_price,quantity,image_path')
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
  if (isAdminRoute && !session && document.querySelector('[data-admin-screen]')) renderLogin()
})

isAdminRoute ? renderAdmin() : renderCatalog()
