# Revisão técnica — MVP Estoque + Catálogo

## Estado após revisão

A arquitetura continua adequada para o MVP: frontend estático + Supabase, sem backend próprio.

### Corrigido nesta revisão

- autorização deixou de aceitar qualquer usuário autenticado e passou a exigir `app_admins`;
- MFA TOTP passou a ser obrigatório para o painel;
- autorização administrativa no banco exige `aal2`, impedindo bypass do MFA apenas manipulando o frontend;
- primeiro login faz enrollment por QR Code e logins seguintes fazem challenge/verify;
- recomendação explícita para desabilitar cadastro público no Supabase;
- RLS e grants foram endurecidos;
- `quantity` não pode mais ser atualizada diretamente pelo cliente;
- entrada/saída continua atômica e ganhou validação de direção (`entry` positiva, `sale` negativa);
- remoção de produto não é permitida pela aplicação, preservando histórico;
- FK do histórico passou a restringir delete de produto;
- `updated_at` passou a ser atualizado pelo banco;
- policies de Storage passaram a exigir admin e pasta do próprio usuário;
- bucket deve ser criado com limite de tamanho e MIME types;
- fotos são redimensionadas/convertidas para JPEG antes do upload;
- foto nova é removida se o cadastro falhar; foto antiga é limpa após troca bem-sucedida;
- validação de nome, preço e quantidade foi reforçada;
- botão WhatsApp deixou de usar `<button>` dentro de `<a>`;
- consultas públicas selecionam apenas os campos necessários;
- pequenos ajustes de acessibilidade e layout mobile.

## Pendente antes de chamar de “pronto para uso”

### P0 — obrigatório

- criar projeto Supabase real;
- executar `supabase.sql`;
- criar a usuária administradora e inserir seu UUID em `app_admins`;
- desabilitar novos cadastros no Auth;
- criar bucket `product-images` com as restrições do README;
- preencher `.env`;
- executar `npm install` e `npm run build` em ambiente com acesso ao registry;
- gerar e versionar o `package-lock.json` no primeiro `npm install`;
- executar `npm audit` e revisar qualquer vulnerabilidade relevante antes de uso contínuo;
- executar o checklist funcional do README, incluindo enrollment e novo login com MFA, preferencialmente também em um iPhone;
- fazer primeiro deploy no Cloudflare Pages.

### P1 — após o primeiro teste com a vendedora

- ajustar textos, tamanho de botões e ordem dos campos conforme uso real;
- decidir se marca/categoria continuam livres ou viram sugestões/listas;
- avaliar botão de ajuste de estoque para corrigir inventário sem fingir venda/entrada;
- adicionar recuperação de senha ou documentar o procedimento de reset;
- considerar PWA (“Adicionar à Tela de Início”) se ela usar o painel diariamente;
- considerar exportação CSV/backup simples;
- definir estratégia de recuperação de MFA (segundo fator de backup ou procedimento administrativo documentado).

### P2 — somente se houver demanda real

- variantes de tamanho/cor;
- custo, margem e lucro;
- pedidos/reservas;
- importação de catálogo de marcas;
- múltiplos vendedores/estoques;
- domínio próprio;
- analytics;
- carrinho/checkout/pagamento.

## Observação de validação

A revisão de código e segurança foi feita estaticamente. A instalação de dependências no ambiente de revisão não concluiu por indisponibilidade/timeout do registry, portanto o build Vite e a integração real com Supabase ainda precisam ser executados no primeiro ambiente com rede (máquina local, GitHub/Cloudflare ou Codex).
