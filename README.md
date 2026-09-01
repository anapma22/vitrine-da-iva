# Estoque + Catálogo — MVP

MVP simples para uma revendedora controlar produtos à pronta entrega e compartilhar um catálogo público com clientes.

## O que já faz

- catálogo público responsivo;
- busca e filtros por marca/categoria;
- área de promoções com preço original e promocional;
- botão de WhatsApp com o nome do produto;
- login privado da vendedora;
- **MFA TOTP obrigatório** no painel (Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords etc.);
- autorização separada: estar logado **não** basta para administrar; a sessão também precisa estar em **AAL2**;
- cadastro de produto pelo celular, inclusive usando a câmera;
- redução e conversão das fotos para economizar Storage;
- preço normal, preço promocional opcional e quantidade;
- botão **Vendi 1**;
- botão **Chegou 1**;
- ocultar/ativar produto sem apagar o histórico;
- histórico das últimas movimentações;
- produto com estoque 0 some automaticamente do catálogo público;
- estoque atualizado de forma atômica no banco.

## Stack

- Vite + JavaScript + CSS;
- Supabase (PostgreSQL, Auth e Storage);
- hospedagem estática: Cloudflare Pages (recomendado para este MVP), Netlify, Vercel ou outro host estático.

Não há backend Node próprio.

## 1. Criar o Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor** e execute todo o arquivo `supabase.sql`.
3. Em **Authentication > Users**, crie manualmente a usuária da vendedora (e-mail + senha).
4. Ainda no **SQL Editor**, promova exatamente essa usuária para administradora:

```sql
insert into public.app_admins (user_id)
select id
from auth.users
where email = 'EMAIL_DA_VENDEDORA'
on conflict (user_id) do nothing;
```

5. Em **Authentication > General Configuration**, desative **Allow new users to sign up**. Este sistema não precisa de cadastro público.
6. O TOTP MFA dos projetos hospedados do Supabase é disponibilizado por padrão. No primeiro login da administradora, o próprio painel força o cadastro do autenticador por QR Code.
7. Copie a **Project URL** e a chave pública/publishable (ou `anon`, em projetos que ainda exibem esse nome).

> A chave pública fica no frontend por design. A segurança administrativa é feita por Auth + RLS + `app_admins`. Nunca coloque `service_role`/secret key no site.

> Em um projeto que já executou uma versão anterior, rode novamente o `supabase.sql`
> **antes** de publicar o frontend atualizado. O arquivo funciona também como upgrade
> idempotente e adiciona campos e proteções que ainda não existam no projeto.

## 2. Verificar o bucket de fotos

O `supabase.sql` cria ou atualiza automaticamente o bucket:

```text
product-images
```

Configuração aplicada pelo SQL:

- **Public bucket:** ligado — as fotos fazem parte do catálogo público;
- **Allowed MIME types:** `image/jpeg`, `image/png`, `image/webp`;
- **File size limit:** `5 MB`.

As policies de escrita também ficam no `supabase.sql`: somente a administradora em
AAL2 pode enviar/alterar/remover arquivos na pasta dela.

## 3. Configurar localmente

```bash
cp .env.example .env
```

Edite `.env`:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
VITE_WHATSAPP_NUMBER=5584999999999
VITE_STORE_NAME=Pronta Entrega da Maria
```

Instale e rode:

```bash
npm install
npm test
npm run dev
```

- Catálogo: `http://localhost:5173/`
- Painel não divulgado: `http://localhost:5173/?acesso=6d91c4f2a7be`

O catálogo não exibe link para o painel e a rota administrativa solicita aos
buscadores que não a indexem. Salve o endereço nos favoritos do dispositivo da
vendedora. Esse endereço não é um segredo de segurança: a proteção real continua
sendo login, `app_admins`, MFA/AAL2 e RLS.

## 4. Checklist de teste local

Antes do deploy, valide:

1. abrir o catálogo sem estar logado;
2. tentar entrar com usuário/senha errados;
3. entrar com a administradora pela primeira vez e confirmar que o cadastro MFA é obrigatório;
4. escanear o QR Code, validar um código TOTP e confirmar que o painel abre;
5. sair e entrar novamente, confirmando que senha sem o código MFA não libera o painel;
6. cadastrar um autenticador reserva e testar o login escolhendo esse fator;
7. cadastrar produto sem foto;
8. cadastrar produto tirando foto pelo celular;
9. substituir e remover a foto de um produto;
10. clicar em **Chegou 1** e confirmar entrada no histórico;
11. clicar em **Vendi 1** e confirmar venda no histórico;
12. tentar vender quando o estoque estiver zerado;
13. confirmar que estoque 0 não aparece nem pela consulta pública da API;
14. ocultar um produto com estoque e confirmar que ele some do catálogo;
15. editar preço/nome/foto e confirmar que o estoque não é alterado;
16. cadastrar um preço promocional menor que o normal e conferir a aba **Promoções**;
17. tentar cadastrar uma promoção igual ou maior que o preço normal e confirmar que é recusada;
18. abrir o botão do WhatsApp e conferir número e mensagem;
19. executar `npm run verify:supabase` e confirmar que todas as verificações passam.

## 5. Publicar no Cloudflare Pages

Suba o projeto em um repositório Git e conecte-o no Cloudflare Pages.

Configuração:

- Framework preset: pode deixar sem preset e configurar manualmente (o projeto é **Vite + JavaScript puro**, não React);
- Build command: `npm run build`;
- Output directory: `dist`;
- Root directory: raiz do repositório.
- Node.js: o repositório fixa `22.16.0` em `.node-version`.

Cadastre no Cloudflare as quatro variáveis `VITE_*` do `.env`.

O arquivo `public/_headers` é copiado para o build e configura CSP, bloqueio de
framing e outros headers de segurança no Cloudflare Pages.

> As variáveis `VITE_*` são incorporadas ao bundle no build. A chave usada aqui deve ser somente a chave pública do Supabase.

## MFA obrigatório

O painel usa TOTP do Supabase Auth. O fluxo é:

1. e-mail + senha validam o primeiro fator (`aal1`);
2. o sistema confirma que o usuário consta em `app_admins`;
3. se ainda não existir um TOTP verificado, o painel força o cadastro por QR Code;
4. no painel é possível cadastrar um autenticador reserva;
5. nos acessos seguintes, o código de 6 dígitos é solicitado e, havendo mais de um fator, a vendedora escolhe qual usar;
6. somente uma sessão `aal2` consegue ler/escrever dados administrativos no banco e no Storage.

Isso significa que remover/ignorar a tela de MFA no navegador não libera as operações de estoque. A exigência também existe no PostgreSQL/RLS.

**Recuperação:** o Supabase Auth não fornece recovery codes para TOTP. Cadastre o
autenticador reserva oferecido pelo painel em outro dispositivo/local seguro e
documente também o reset administrativo do fator pelo responsável técnico.

## Fluxo pensado para a vendedora

**Chegou produto:** Área da vendedora → Adicionar produto → tirar foto → informar nome/preço/estoque → Salvar.

**Vendeu presencialmente ou pelo WhatsApp:** tocar em **Vendi 1**.

**Reposição:** tocar em **Chegou 1**.

O histórico registra cada entrada e venda. A quantidade não pode ser alterada
diretamente pela aplicação: o ajuste passa pela função atômica e idempotente
`adjust_stock`.

## Limitações intencionais do MVP

- um único estoque;
- um único perfil administrativo na prática (a tabela permite mais de um no futuro);
- não há carrinho ou pagamento online;
- não há reserva de produto;
- tamanho/cor são cadastrados no nome do produto;
- não há custo/lucro;
- não há importação de catálogo Natura/Boticário/Demillus;
- não há recuperação de senha dentro da interface;
- o Supabase não fornece códigos de recuperação para TOTP; se o autenticador for perdido, o acesso precisa ser recuperado administrativamente ou por um fator de backup;
- não há PWA/offline;
- não há backup/exportação pela interface;
- o botão de WhatsApp não reduz estoque automaticamente, porque conversa não significa venda.

Esses itens devem ser priorizados somente depois do teste real de uso.

## Segurança do MVP

- não existe senha padrão no código;
- `.env` é ignorado pelo Git;
- nunca versione uma `service_role`/secret key;
- cadastro público do Supabase deve ficar desabilitado;
- RLS exige que o usuário esteja também na tabela `app_admins`;
- operações administrativas exigem JWT com `aal = aal2` (senha + MFA confirmado), não apenas uma checagem visual no frontend;
- `stock_movements` não pode ser alterada diretamente pela aplicação;
- cada operação de estoque possui UUID único para impedir duplicação em retries;
- produtos não são deletados pela UI: são ocultados, preservando histórico;
- fotos são públicas apenas para leitura, pois fazem parte do catálogo;
- o deploy recomendado aplica CSP e bloqueia clickjacking pelo arquivo `_headers`.

## O que passar para o Codex depois do primeiro deploy

Antes de pedir novas funcionalidades, dê ao Codex o repositório e peça para:

1. rodar `npm install` e `npm run build`;
2. revisar erros de console e warnings;
3. testar os fluxos do checklist acima contra o Supabase real;
4. não trocar stack nem adicionar framework/backend sem necessidade;
5. preservar RLS e o fluxo atômico de estoque;
6. preservar o MFA obrigatório e a exigência `AAL2` nas policies/RPCs;
7. priorizar UX mobile da vendedora antes de features de e-commerce.
