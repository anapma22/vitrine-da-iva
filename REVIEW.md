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

### Caderneta mínima adicionada

- clientes, WhatsApp opcional e observações ficam somente no painel privado;
- compras fiadas e pagamentos parciais passam por uma RPC atômica e idempotente;
- o saldo é calculado pelo histórico e não possui campo editável;
- pagamento acima do saldo é recusado pelo PostgreSQL;
- lançamentos não podem ser inseridos, alterados ou apagados diretamente pelo frontend;
- correções cancelam o lançamento sem removê-lo e preservam a auditoria;
- RLS, grants e RPCs da caderneta exigem administradora em AAL2;
- exportação CSV compatível com Excel/Google Planilhas neutraliza fórmulas em textos;
- impressão fornece um resumo que pode ser salvo em PDF, sem nova dependência.

## Pendente para a entrega à vendedora

### P0 — obrigatório

- executar o checklist funcional do README, incluindo enrollment e novo login com MFA, preferencialmente também em um iPhone;
- testar compra de R$ 100,00, pagamento parcial de R$ 80,00, recusa de pagamento acima do saldo e cancelamento na caderneta;
- confirmar cadastro e login pelo autenticador reserva;

### P1 — após o primeiro teste com a vendedora

- ajustar textos, tamanho de botões e ordem dos campos conforme uso real;
- decidir se marca/categoria continuam livres ou viram sugestões/listas;
- avaliar botão de ajuste de estoque para corrigir inventário sem fingir venda/entrada;
- adicionar recuperação de senha ou documentar o procedimento de reset;
- considerar PWA (“Adicionar à Tela de Início”) se ela usar o painel diariamente;
- definir uma rotina mensal para guardar a exportação da caderneta em pasta privada;
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

Em 01/09/2026, `npm install`, `npm test`, `npm audit`, `npm run build` e
`npm run verify:supabase` concluíram com sucesso; os 8 testes passaram e o audit
encontrou zero vulnerabilidades. No projeto real, as sondagens anônimas confirmaram
o bloqueio de `app_admins`, históricos, tabelas e RPCs da caderneta, além de produtos
inativos ou sem estoque. O build atual está publicado no Cloudflare Pages com CSP,
bloqueio de framing e demais headers previstos. Restam somente os testes funcionais
autenticados com a conta da vendedora e os dois autenticadores.
