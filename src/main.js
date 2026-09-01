import { createClient } from '@supabase/supabase-js'
import './style.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER || '').replace(/\D/g, '')
const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'Pronta Entrega'
const PRODUCT_IMAGE_BUCKET = 'product-images'
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024
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
  app.innerHTML = `<main class="shell">${header(false)}<section class="hero"><h2>Pronta entrega</h2><p>Escolha um produto e fale diretamente pelo WhatsApp.</p></section><div class="loading">Carregando produtos…</div></main>`

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
      : `<div class="empty" style="grid-column:1/-1">Nenhum produto encontrado.</div>`
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
  app.innerHTML = `<main class="shell">${header(false)}<div class="error">Não foi possível carregar o catálogo.<br><small>${esc(message)}</small></div></main>`
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
    return renderMfaError(aalError?.message || factorsError?.message || 'Não foi possível verificar o MFA.')
  }

  const verifiedTotp = (factors?.totp || []).filter(factor => factor.status === 'verified')

  if (aal?.currentLevel === 'aal2' && aal?.nextLevel === 'aal2') {
    return renderDashboard()
  }

  if (verifiedTotp.length) {
    return renderMfaChallenge(verifiedTotp[0])
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

async function renderMfaEnrollment() {
  app.innerHTML = mfaShell(
    'Ative o autenticador',
    'Este primeiro cadastro é obrigatório para acessar o estoque.',
    '<div class="loading">Preparando seu QR Code…</div>'
  )
  bindMfaLogout()

  // Um refresh durante o cadastro pode deixar um fator não verificado no Supabase.
  // Removemos apenas fatores TOTP ainda não verificados e iniciamos um cadastro limpo.
  const { data: existingFactors } = await supabase.auth.mfa.listFactors()
  for (const factor of (existingFactors?.totp || []).filter(item => item.status !== 'verified')) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    if (error) console.warn('Fator MFA incompleto não pôde ser removido:', error.message)
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `${STORE_NAME} - painel`
  })

  if (error || !data?.id || !data?.totp) {
    return renderMfaError(error?.message || 'Não foi possível iniciar o cadastro do autenticador.')
  }

  const qr = data.totp.qr_code
  const secret = data.totp.secret

  app.innerHTML = mfaShell(
    'Ative o autenticador',
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

function renderMfaChallenge(factor) {
  app.innerHTML = mfaShell(
    'Confirme seu código',
    'Abra o aplicativo autenticador e digite o código atual para entrar no painel.',
    `<form id="mfa-challenge-form" class="form-grid">
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
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
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
    <p style="margin-bottom:0"><a class="admin-link" href="/">← Voltar ao catálogo</a></p>
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
  app.innerHTML = `<main class="shell">${header(true)}<div class="loading">Carregando estoque…</div></main>`

  const [{ data: products, error: productError }, { data: movements, error: movementError }] = await Promise.all([
    supabase.from('products').select('*').order('created_at', { ascending: false }),
    supabase.from('stock_movements').select('id,type,delta,created_at,products(name)').order('created_at', { ascending: false }).limit(50)
  ])

  if (productError || movementError) {
    app.innerHTML = `<main class="shell">${header(true)}<div class="error">Erro ao carregar o painel: ${esc(productError?.message || movementError?.message)}</div></main>`
    return
  }

  const allProducts = products || []
  const active = allProducts.filter(p => p.active)
  const units = active.reduce((sum, p) => sum + p.quantity, 0)
  const low = active.filter(p => p.quantity <= 1).length

  app.innerHTML = `<main class="shell">
    ${header(true)}
    <div class="admin-actions"><span class="security-status">✓ MFA ativo</span><button id="logout" class="btn btn-secondary">Sair</button></div>
    <section class="stats">
      <div class="stat"><strong>${active.length}</strong><span>produtos ativos</span></div>
      <div class="stat"><strong>${units}</strong><span>unidades em estoque</span></div>
      <div class="stat"><strong>${low}</strong><span>com 1 un. ou menos</span></div>
    </section>
    <section class="panel">
      <div class="panel-heading"><h3>Produtos</h3><button id="new-product" class="btn btn-primary">+ Adicionar produto</button></div>
      <div id="product-form-wrap" class="hidden form-wrap"></div>
      <div class="admin-products">${allProducts.length ? allProducts.map(adminProductRow).join('') : `<div class="empty">Nenhum produto cadastrado.</div>`}</div>
    </section>
    <section class="panel">
      <h3>Últimas movimentações</h3>
      <div class="table-wrap"><table><thead><tr><th>Quando</th><th>Produto</th><th>Movimento</th><th>Qtd.</th></tr></thead><tbody>
        ${(movements || []).length ? movements.map(m => `<tr><td>${dateTime.format(new Date(m.created_at))}</td><td>${esc(m.products?.name || 'Produto')}</td><td>${m.type === 'sale' ? 'Venda' : m.type === 'entry' ? 'Entrada' : 'Ajuste'}</td><td>${m.delta > 0 ? '+' : ''}${m.delta}</td></tr>`).join('') : `<tr><td colspan="4">Sem movimentações ainda.</td></tr>`}
      </tbody></table></div>
    </section>
  </main>`

  document.querySelector('#logout').addEventListener('click', async () => {
    await supabase.auth.signOut()
    renderLogin()
  })
  document.querySelector('#new-product').addEventListener('click', () => showProductForm())
  document.querySelectorAll('[data-action="sell"]').forEach(btn => btn.addEventListener('click', () => adjust(btn.dataset.id, -1, 'sale', btn)))
  document.querySelectorAll('[data-action="add"]').forEach(btn => btn.addEventListener('click', () => adjust(btn.dataset.id, 1, 'entry', btn)))
  document.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => showProductForm(allProducts.find(p => p.id === btn.dataset.id))))
  document.querySelectorAll('[data-action="toggle"]').forEach(btn => btn.addEventListener('click', () => toggleProduct(allProducts.find(p => p.id === btn.dataset.id), btn)))
}

function adminProductRow(p) {
  const photo = imageUrl(p.image_path)
  return `<div class="admin-product" style="opacity:${p.active ? 1 : .55}">
    ${photo ? `<img class="admin-thumb" src="${photo}" alt="" loading="lazy" />` : `<div class="admin-thumb placeholder" aria-hidden="true">♡</div>`}
    <div><h4>${esc(p.name)}</h4><p>${esc(p.brand || '')}${p.category ? ` · ${esc(p.category)}` : ''} · ${money.format(Number(p.price || 0))} · <strong>${p.quantity} un.</strong>${p.active ? '' : ' · inativo'}</p></div>
    <div class="stock-actions">
      <button class="btn btn-secondary" data-action="add" data-id="${p.id}">+ Chegou 1</button>
      <button class="btn btn-primary" data-action="sell" data-id="${p.id}" ${p.quantity < 1 ? 'disabled' : ''}>− Vendi 1</button>
      <button class="btn btn-secondary" data-action="edit" data-id="${p.id}">Editar</button>
      <button class="btn ${p.active ? 'btn-danger' : 'btn-secondary'}" data-action="toggle" data-id="${p.id}">${p.active ? 'Ocultar' : 'Ativar'}</button>
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
      <label>Preço<input class="control" name="price" inputmode="decimal" required value="${product ? Number(product.price).toFixed(2).replace('.', ',') : ''}" placeholder="119,90" /></label>
      <label>Estoque inicial<input class="control" name="quantity" type="number" min="0" step="1" required value="${product?.quantity ?? 1}" ${product ? 'disabled' : ''} /></label>
      <label class="span-2">Foto<input class="control" name="photo" type="file" accept="image/*" capture="environment" /><small>A imagem será reduzida antes do envio para economizar espaço.</small></label>
      <div class="span-2 form-actions"><button class="btn btn-primary" type="submit">Salvar</button><button class="btn btn-secondary" type="button" id="cancel-form">Cancelar</button></div>
      <div id="form-error" class="error hidden span-2" role="alert"></div>
    </form>`

  document.querySelector('#cancel-form').addEventListener('click', () => {
    wrap.innerHTML = ''
    wrap.classList.add('hidden')
  })
  document.querySelector('#product-form').addEventListener('submit', e => saveProduct(e, product))
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
  ctx.drawImage(image, 0, 0, width, height)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('Não foi possível preparar a foto para envio.')
  return blob
}

async function saveProduct(e, product) {
  e.preventDefault()
  const form = e.currentTarget
  const fd = new FormData(form)
  const button = form.querySelector('button[type="submit"]')
  const box = document.querySelector('#form-error')
  button.disabled = true
  box.classList.add('hidden')

  let uploadedPath = null

  try {
    const name = String(fd.get('name') || '').trim()
    if (!name) throw new Error('Informe o nome do produto.')

    const priceText = String(fd.get('price') || '').trim().replace(',', '.')
    const price = Number(priceText)
    if (!Number.isFinite(price) || price < 0) throw new Error('Preço inválido.')

    let quantity = null
    if (!product) {
      quantity = Number(fd.get('quantity'))
      if (!Number.isInteger(quantity) || quantity < 0) throw new Error('Estoque inicial inválido.')
    }

    let imagePath = product?.image_path || null
    const photo = fd.get('photo')
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
      imagePath = path
    }

    const payload = {
      name,
      brand: String(fd.get('brand') || '').trim() || null,
      category: String(fd.get('category') || '').trim() || null,
      price,
      image_path: imagePath
    }

    let result
    if (product) {
      result = await supabase.from('products').update(payload).eq('id', product.id)
    } else {
      payload.quantity = quantity
      result = await supabase.from('products').insert(payload)
    }

    if (result.error) throw result.error

    if (product?.image_path && uploadedPath && product.image_path !== uploadedPath) {
      const { error: cleanupError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([product.image_path])
      if (cleanupError) console.warn('Foto antiga não pôde ser removida:', cleanupError.message)
    }

    await renderAdmin()
  } catch (err) {
    if (uploadedPath) {
      const { error: cleanupError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([uploadedPath])
      if (cleanupError) console.warn('Upload órfão não pôde ser removido:', cleanupError.message)
    }
    box.textContent = err.message || 'Não foi possível salvar.'
    box.classList.remove('hidden')
    button.disabled = false
  }
}

async function adjust(id, delta, type, button) {
  button.disabled = true
  const { error } = await supabase.rpc('adjust_stock', { p_product_id: id, p_delta: delta, p_type: type })
  if (error) {
    button.disabled = false
    alert(error.message)
    return
  }
  renderAdmin()
}

async function toggleProduct(product, button) {
  if (!product) return
  button.disabled = true
  const { error } = await supabase.from('products').update({ active: !product.active }).eq('id', product.id)
  if (error) {
    button.disabled = false
    alert(error.message)
    return
  }
  renderAdmin()
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (isAdminRoute && !session && document.querySelector('.admin-products')) renderLogin()
})

isAdminRoute ? renderAdmin() : renderCatalog()
