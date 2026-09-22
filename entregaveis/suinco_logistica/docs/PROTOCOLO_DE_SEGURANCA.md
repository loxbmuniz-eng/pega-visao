# Protocolo de Segurança — Embarque Suinco

**Auditoria de 22/09/2026**, feita contra uma lista de 20 itens que o dono
mandou. Cada linha aqui tem evidência de código ou de banco — nada por
impressão.

> **O que está travado por teste:** `backend/testes/seguranca.test.js`, 21
> verificações que entram na bateria da API (490 testes). Se alguém desfizer
> qualquer propriedade abaixo marcada com 🔒, a bateria reprova e o portão não
> publica. Conferido injetando três defeitos de propósito: HSTS desligado,
> `trust proxy true` e `ORDER BY ${req.query.ordem}` — os três foram pegos.

---

## Resultado dos 20 itens

| # | Item | Estado | Onde se confere |
|---|---|---|---|
| 1 | Esconder API keys | 🔒 ok | `.env` ignorado; `JWT_SECRET` obrigatório com 32+; servidor recusa subir sem ele |
| 2 | Limpar secrets do git | 🔒 ok | nenhum `.env` real no histórico; `.env.exemplo` só com placeholder |
| 3 | Public key DB | n/a | o navegador nunca fala com o banco, só com a API |
| 4 | RLS | ⚠️ **aberto** | ver *Etapa 2* — hoje a proteção é só na aplicação |
| 5 | Criptografia de dados | ok | zero coluna de CPF/CNPJ/cartão no banco; senha em bcrypt |
| 6 | Auth server side | 🔒 ok | toda rota exige `exigirLogin` ou token de integração |
| 7 | Restringir acessos | 🔒 ok | `fluxo.js`, allowlist por setor — fora da lista é negado |
| 8 | Mass assignment | 🔒 ok | PATCH declara campo por campo; sem `...req.body` |
| 9 | Proteger cookies | n/a | não usa cookie; JWT no header `Authorization` |
| 10 | Hash nas senhas | 🔒 ok | bcrypt, com hash de fachada contra ataque de tempo |
| 11 | Rate limit | 🔒 ok | três limitadores: geral, login, bot |
| 12 | Bot protection | ⚠️ **decisão** | ver *Etapa 2* |
| 13 | Queries parametrizadas | 🔒 ok | 518 placeholders; nenhuma interpolação vem de `req` |
| 14 | Validação de input | 🟡 artesanal | cada campo com conversor próprio, sem biblioteca |
| 15 | Vazar conteúdo | 🔒 ok | e-mail inexistente e senha errada respondem igual |
| 16 | Restringir uploads | n/a | o sistema não recebe arquivo |
| 17 | Trim de resposta | 🔒 ok | `senha_hash` nunca entra em `res.json` |
| 18 | Security headers | 🔒 ok | helmet na API + 6 cabeçalhos no `vercel.json` |
| 19 | Forçar HTTPS | ⚠️ **verificar** | HSTS ok; falta confirmar o redirect no Nginx |
| 20 | Scan de dependências | ✅ no portão | `npm audit --audit-level=high` barra a publicação |

---

## Um achado meu que estava ERRADO — e o registro fica

Eu reportei ao dono: *"a API fala com o Postgres como superusuário"*. Ele foi
ao servidor conferir, em 22/09/2026, e a resposta foi:

```
SELECT rolsuper FROM pg_roles WHERE rolname='suinco'   ->  f
SELECT count(*) FROM fact_viagens                      ->  933
```

**Em produção o usuário nunca foi superusuário.** Eu medi neste container de
desenvolvimento, onde ele é, e extrapolei para a produção sem confirmar. O
dono quase rodou um `ALTER ROLE` que não precisava.

A razão está no `instalar.sh`, linha 114:

```bash
psql -qc "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
```

`LOGIN` e senha, nada mais. **A produção está certa por construção**, e o
superusuário deste container é sujeira local — ambiente descartável, não
importa.

**O que ficou travado por teste:** não o estado do banco de produção (esta
suíte não o alcança, e teste que mede o ambiente errado ensina a ignorar
vermelho) — e sim o **instalador**, que é quem constrói a produção. Se alguém
acrescentar `SUPERUSER`, `CREATEROLE` ou `BYPASSRLS` ali, a bateria reprova
antes de a próxima instalação nascer errada.

**Lição para mim, escrita onde não se perde:** achado medido em ambiente de
desenvolvimento é hipótese sobre produção, não fato. Só o servidor responde
sobre o servidor.

---

## Por que RLS aqui não é um interruptor

Com o superusuário fora da conta, sobra o que realmente faz RLS ser ignorada:
**`suinco` é DONO das tabelas** — ele as criou rodando as migrações. Dono de
tabela passa por cima de política de linha, a não ser com `FORCE ROW LEVEL
SECURITY`.

E aí vem a pergunta que ninguém faz antes de marcar o item: **RLS protegeria
de quê, aqui?**

No Supabase, onde essa lista nasceu, o navegador fala direto com o banco: um
usuário só de banco para milhares de pessoas, e a política separa os dados de
cada uma pelo token. **Aqui não existe essa situação** — o navegador nunca
alcança o Postgres, só a API, e é a API que decide setor e filial.

Para RLS significar algo, a sessão do banco teria de carregar quem é o
operador (`SET LOCAL app.setor = ...` em cada requisição) e as políticas
lerem isso. É defesa em profundidade de verdade: se uma injeção de SQL
escapasse, ela limitaria o estrago. Mas:

- todo o SQL é parametrizado, e isso agora é **travado por teste** (nenhuma
  expressão interpolada menciona `req`);
- é mudança de arquitetura de acesso, não configuração.

**Recomendação honesta:** RLS aqui é projeto próprio, com janela e teste, e
está atrás de outras coisas na fila. Marcar o item hoje ligando RLS numa
tabela cujo dono a ignora seria relatório verde protegendo nada — o oposto de
alto nível.

## Etapa 2 — o que depende do servidor

Nada abaixo foi aplicado. Cada item tem o comando, a conferência e a volta
atrás. **Ordem recomendada: 1 → 2.**

### 1. ~~Tirar o superusuário da aplicação~~ — JÁ ESTAVA CERTO

Conferido em produção em 22/09/2026: `rolsuper = f`. O `ALTER ROLE ...
NOSUPERUSER` foi rodado de todo modo (é idempotente) e a leitura seguiu
respondendo — 933 cargas. Nada a fazer aqui.

### 2. Redirect 80 → 443 no Nginx  ← **o único que ainda falta no servidor**

O HSTS já está na resposta, mas ele só vale **depois** da primeira visita em
HTTPS. Sem redirect, a primeira requisição de um aparelho novo pode sair em
texto claro — e é nela que o token não deveria trafegar.

```bash
ssh root@2.25.95.253
grep -rn "listen 80" /etc/nginx/sites-enabled/
# Se não houver um bloco com `return 301 https://$host$request_uri;`, acrescentar:
#
#   server {
#     listen 80;
#     server_name api.embarquesuinco.com.br;
#     return 301 https://$host$request_uri;
#   }
#
nginx -t && systemctl reload nginx     # `nginx -t` ANTES do reload, sempre
```

**Volta atrás:** `systemctl reload nginx` depois de desfazer o arquivo.
`nginx -t` reprovando significa que nada foi aplicado — o reload não roda.

### 3. Duas decisões que são do dono

**Bot protection (item 12).** Minha recomendação é **não colocar captcha no
login.** O terminal do pátio é compartilhado e usado com pressa; captcha ali
troca um risco que hoje é baixo (não há cadastro público, e há bloqueio por
conta) por atrito em cima da operação. Se você quiser cobrir o item de outra
forma, o caminho sem atrito é limitar por conta além do IP e registrar
tentativa de login em endpoint que não existe.

**O limitador de login conta por IP, e o pátio sai por um IP só.** 30 senhas
erradas num minuto barram o login de **todos** por aquele minuto. É
disponibilidade, não vazamento. Chavear por e-mail resolveria isso e
enfraqueceria a defesa contra força bruta distribuída — por isso não mexi. As
opções, para você escolher:

- deixar como está (o bloqueio por conta já cobre o essencial);
- chavear por `e-mail + IP`, que pune a conta atacada e não o pátio;
- subir `RATE_LIMIT_LOGIN` e confiar no bloqueio por conta.

---

## O que este documento não resolve

Item **14** (validação artesanal). Funciona e está coberto por 490 testes, mas
campo novo pode nascer sem conversor e ninguém notar. A correção certa é um
validador central na borda da rota — é refatoração de superfície grande, e
fazer isso junto com outra entrega é como se publica defeito. Fica registrado
para virar entrega própria.
