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

### Corrigido no endurecimento posterior

- cadastro e edição passaram a confirmar que o banco realmente devolveu a linha alterada;
- troca e remoção de foto tratam respostas de rede ambíguas sem apagar uma imagem possivelmente referenciada;
- remoção voluntária de foto foi adicionada e falhas de limpeza deixam aviso visível;
- `adjust_stock` ganhou UUID de operação, índice único e serialização para retries idempotentes;
- a chave idempotente é preservada no navegador até a operação ser confirmada;
- a policy pública passou a ocultar também produtos ativos com estoque zero;
- limites de strings e formato de `image_path` passaram a existir no PostgreSQL;
- configuração do bucket, MIME types e limite de 5 MB passou a ser aplicada pelo SQL;
- fluxo de MFA permite cadastrar e escolher um autenticador reserva;
- CSP, bloqueio de framing e headers básicos foram adicionados ao deploy Cloudflare;
- mensagens técnicas deixaram de ser expostas no catálogo e `alert()` foi removido;
- inputs e botões foram ajustados para uso móvel e contraste básico;
- foram adicionados testes de regressão sem novas dependências e uma verificação pública do Supabase.

## Pendente antes de chamar de “pronto para uso”

### P0 — obrigatório

- executar a versão atualizada de `supabase.sql` no projeto antes do novo frontend;
- manter novos cadastros desabilitados no Auth — a verificação mais recente confirmou essa configuração;
- executar `npm run verify:supabase` depois do novo SQL e exigir resultado totalmente verde;
- executar o checklist funcional do README, incluindo enrollment e novo login com MFA, preferencialmente também em um iPhone;
- confirmar cadastro e login pelo autenticador reserva;
- publicar o novo build no Cloudflare Pages e conferir os headers de resposta.

### P1 — após o primeiro teste com a vendedora

- ajustar textos, tamanho de botões e ordem dos campos conforme uso real;
- decidir se marca/categoria continuam livres ou viram sugestões/listas;
- avaliar botão de ajuste de estoque para corrigir inventário sem fingir venda/entrada;
- adicionar recuperação de senha ou documentar o procedimento de reset;
- considerar PWA (“Adicionar à Tela de Início”) se ela usar o painel diariamente;
- considerar exportação CSV/backup simples;
- documentar o procedimento administrativo de reset de senha e de MFA.

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

Em 31/08/2026, `npm install`, `npm test`, `npm audit` e `npm run build`
concluíram com sucesso; o audit encontrou zero vulnerabilidades. As sondagens anônimas
confirmaram bloqueio de `app_admins`, histórico e RPCs administrativas no projeto
real. Os fluxos autenticados AAL1/AAL2 e as alterações do novo SQL ainda precisam ser
validados com a conta administradora depois que o arquivo for executado no Supabase.
