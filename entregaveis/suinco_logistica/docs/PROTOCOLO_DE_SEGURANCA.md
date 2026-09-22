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

## O achado mais grave, e ele não estava na lista

**A API fala com o Postgres como SUPERUSUÁRIO.**

```
role  suinco   superuser = true   dono das 28 tabelas
```

Duas consequências:

1. **RLS ali seria decorativa.** Dono de tabela e superusuário passam por cima
   de política de linha. Ligar RLS sem trocar o usuário dá trabalho e não
   protege nada — pior, dá a sensação de que protege.
2. **Se a string de conexão vazar, o atacante leva o cluster**, não só os
   dados do painel: pode criar usuário, ler qualquer banco, escrever arquivo.

**A aplicação não precisa disso.** Conferido: as migrações só fazem
`CREATE/ALTER TABLE`, `INDEX`, `TRIGGER` e `FUNCTION` nos próprios objetos —
nenhuma `CREATE EXTENSION`, nenhum `COPY FROM` de arquivo, nenhum `ALTER
SYSTEM`. Tirar o superusuário não muda comportamento nenhum.

---

## Etapa 2 — o que depende do servidor

Nada abaixo foi aplicado. Cada item tem o comando, a conferência e a volta
atrás. **Ordem recomendada: 1 → 2 → 3.** O item 1 é o de maior retorno.

### 1. Tirar o superusuário da aplicação

Risco à operação: **nenhum**, se a conferência passar. É um atributo do
usuário, não uma mudança de esquema, e a aplicação não usa privilégio de
superusuário em lugar nenhum.

```bash
ssh root@2.25.95.253
su - postgres -c "psql -c 'ALTER ROLE suinco NOSUPERUSER;'"

# CONFERIR na hora (tem de responder 'f' e depois um número):
su - postgres -c "psql -At -c \"SELECT rolsuper FROM pg_roles WHERE rolname='suinco'\""
su - postgres -c "psql -At -d embarque_suinco -c 'SELECT count(*) FROM fact_viagens'"

# E o painel: abrir a Torre e criar uma carga de teste.
```

**Volta atrás**, se algo recusar:

```bash
su - postgres -c "psql -c 'ALTER ROLE suinco SUPERUSER;'"
```

Depois disso o dono das tabelas continua sendo `suinco`, o que ainda faz RLS
ser ignorada por ele. **RLS de verdade exige um segundo usuário, só de
aplicação, que não seja dono** — é mudança de arquitetura de acesso, precisa
de janela fora de operação e troca do `PGUSER` no `.env`. Fica proposto, não
aplicado.

### 2. Redirect 80 → 443 no Nginx

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
