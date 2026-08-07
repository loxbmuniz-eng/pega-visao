# Mapa Completo do Sistema — Programação de Embarque Suinco

**Manual técnico e de processos — versão consolidada de 07/08/2026**

Este documento substitui, para fins de consulta, os relatórios fragmentados
produzidos ao longo do projeto (`ARQUITETURA_E_OPERACAO.md`,
`RELATORIO_TI_HOSPEDAGEM.md`, `RELATORIO_TECNICO_SINCRONIA.md` e outros) —
eles continuam no repositório como registro histórico de decisão, mas
descrevem, em parte, uma arquitetura anterior (SharePoint/MSAL) que **saiu do
sistema em 05/08/2026**. Este mapa descreve **só o que está no ar hoje**, sem
nenhuma seção "quando tivermos X". Onde algo mudou nesta sessão (07/08/2026),
está marcado.

Todo dado técnico aqui (IP, caminhos, comandos, nomes de tabela, rotas) foi
conferido diretamente no código e no `MANUAL_DO_SERVIDOR.md` no momento da
escrita — não é resumo de memória.

---

## Índice

1. [Visão geral em uma página](#1-visão-geral-em-uma-página)
2. [Arquitetura — as três camadas](#2-arquitetura--as-três-camadas)
3. [Domínio, hospedagem e infraestrutura](#3-domínio-hospedagem-e-infraestrutura)
4. [Modelo de dados](#4-modelo-de-dados)
5. [Referência da API](#5-referência-da-api)
6. [Segurança e controle de acesso](#6-segurança-e-controle-de-acesso)
7. [Sincronização: tempo real e modo offline](#7-sincronização-tempo-real-e-modo-offline)
8. [A máquina de estados — os 6 status](#8-a-máquina-de-estados--os-6-status)
9. [Manual operacional por setor](#9-manual-operacional-por-setor)
10. [Relatórios e exportação](#10-relatórios-e-exportação)
11. [Operar o servidor — resumo de comandos](#11-operar-o-servidor--resumo-de-comandos)
12. [Backup, restauração e emergências](#12-backup-restauração-e-emergências)
13. [Testes — o que garante que funciona](#13-testes--o-que-garante-que-funciona)
14. [Auditoria de 07/08/2026 — o que foi corrigido hoje](#14-auditoria-de-07082026--o-que-foi-corrigido-hoje)
15. [Pendências conhecidas e próximos passos](#15-pendências-conhecidas-e-próximos-passos)
16. [Glossário](#16-glossário)

---

## 1. Visão geral em uma página

O **Painel de Programação de Embarque Suinco** é o sistema que substituiu o
controle de pátio por planilha Excel/VBA. Cinco setores — Logística,
Portaria, Expedição, Faturamento e Administração — compartilham a mesma
tela em tempo real, cada um vendo só o que precisa para o seu trabalho.

```
┌─────────────┐        HTTPS         ┌──────────────────────┐
│  NAVEGADOR  │◄────────────────────►│   VERCEL (estático)   │
│  (operador) │   embarquesuinco.    │   index.html único     │
│             │   com.br             │   (app+dados+estilo)   │
└──────┬──────┘                      └───────────────────────┘
       │
       │ HTTPS + WebSocket
       │ api.embarquesuinco.com.br
       ▼
┌─────────────────────────────────────────────────────────────┐
│  VPS HOSTINGER — 2.25.95.253 — Ubuntu 24.04                  │
│                                                                │
│  nginx (proxy reverso + TLS/Let's Encrypt)                    │
│    │                                                          │
│    ▼                                                          │
│  Node.js / Express — serviço systemd "embarque-suinco"        │
│    • REST (login, cargas, status, cadastros, Power BI)        │
│    • Socket.IO (empurra mudança para todo mundo em tempo real)│
│    │                                                          │
│    ▼                                                          │
│  PostgreSQL 16 (só localhost — nunca exposto à internet)      │
│    fact_viagens · fact_statusfrota · dim_veiculos · dim_rotas │
│    log_eventos · operadores                                   │
└─────────────────────────────────────────────────────────────┘
```

**Duas metades publicam de forma diferente, e isso importa para quem opera:**

| Metade | Onde vive | Como atualiza |
|---|---|---|
| **Frontend** (o painel que o operador abre) | Vercel | Sozinho, a cada `git push` na branch publicada |
| **Backend** (API + banco) | VPS própria | **Só quando alguém roda o instalador no servidor** (§11) |

Um `git push` deixa o *visual* atualizado na hora, mas uma correção que
depende de uma rota nova no servidor **não vale nada até a VPS ser
atualizada**. Esse descompasso já causou bug real nesta sessão (§14) e é o
erro operacional mais fácil de cometer com este sistema.

**Números do sistema hoje** (07/08/2026):

| | |
|---|---|
| Frontend | `app.js` 3.816 linhas · `data.js` 1.878 · `suinco-api.js` 909 · `styles.css` 2.147 · empacotado num `index.html` único de ~980 KB |
| Backend | ~2.060 linhas em `backend/src/` · Node 22 · Express 4 · Socket.IO 4 |
| Banco | 6 tabelas · PostgreSQL 16 |
| Testes | 89 casos automatizados de backend (`node --test`) · 21 suítes de interface (Playwright) |
| Frota cadastrada | 749 placas |

---

## 2. Arquitetura — as três camadas

### 2.1. Frontend — três arquivos-fonte, um arquivo publicado

O painel é escrito em três arquivos JavaScript puro (sem framework, sem
build step de verdade) que `build_arquivo_unico.py` funde num `index.html`
só, com a frota embutida como CSV inline. É esse arquivo único que vai para
produção — **nunca editar `index.html` diretamente**, ele é gerado.

| Arquivo-fonte | Papel | Regra que sustenta a manutenção |
|---|---|---|
| `app.js` | Apresentação — desenha as 10 abas, formulários, relatórios em PDF | Nunca fala com a rede diretamente; só lê `DB` e chama `data.js` |
| `data.js` | Regras de negócio — máquina de 6 status, trava de frota, indicadores, mescla de estado remoto | Não conhece DOM nem rede |
| `suinco-api.js` | Integração — chama a API REST, mantém a fila offline, escuta o Socket.IO | Único módulo que sabe que existe um servidor |

Depois de editar qualquer um dos três (ou `styles.css`), o comando que
regenera o pacote publicável é:

```
python3 build_arquivo_unico.py
```

### 2.2. Backend — Node/Express, permissão decidida no servidor

```
backend/src/
├── servidor.js          # monta o Express, CORS, rate limit, rotas
├── config.js             # lê variáveis de ambiente (.env)
├── banco.js               # pool de conexão PostgreSQL + transações
├── tempo-real.js          # Socket.IO — ver §7
├── middleware/auth.js      # JWT: exigirLogin, exigirSetor
├── dominio/
│   ├── fluxo.js            # a máquina de estados (cópia autoritativa)
│   └── cargas.js           # helpers de linha (SQL → objeto do painel)
└── rotas/
    ├── auth.js              # POST /login, GET /eu, POST /renovar
    ├── cargas.js             # POST/PATCH/DELETE /cargas, /status, /portaria/saida
    ├── cadastros.js           # /frota, /rotas
    ├── estado.js               # GET /estado (leitura completa e incremental)
    ├── operadores.js           # CRUD de usuários (só Administração)
    └── bi.js                    # views de leitura para o Power BI
```

**Decisão central da migração:** a regra "de qual status pode ir para qual, e
quem tem permissão" existia **só no navegador** na versão anterior. Com uma
API pública, qualquer um com um token conseguiria pular etapa (registrar
"Faturado" num caminhão que nunca chegou) direto pela API, ignorando a tela.
Hoje `backend/src/dominio/fluxo.js` é cópia autoritativa de `STATUS_FLOW` e
das regras de permissão — se o navegador validar e deixar passar, o servidor
valida de novo e recusa se algo estiver errado. **A tela nunca é a última
palavra.**

### 2.3. Por que não SharePoint (contexto histórico)

O projeto nasceu com o backend pensado como SharePoint Online (Listas) +
login MSAL/Entra ID — ver `docs/RELATORIO_TI_HOSPEDAGEM.md` e
`docs/ARQUITETURA_E_OPERACAO.md` (histórico, não descreve o sistema atual).
Essa arquitetura foi **removida por completo em 05/08/2026** (commits
`c4730d2`, `4d7d5e5`) em favor do Node/Postgres em VPS própria descrito
acima. Motivo resumido: o SharePoint recusa consulta acima de 5.000 itens
por Lista sem índice dedicado, a regra de negócio não tinha onde morar do
lado do servidor, e o login MSAL exigia App Registration e concessão manual
de permissão (`Sites.Selected`) que travou o piloto mais de uma vez.

---

## 3. Domínio, hospedagem e infraestrutura

| O que | Valor |
|---|---|
| Painel (o que o operador abre) | `https://embarquesuinco.com.br` |
| API (dados, WebSocket) | `https://api.embarquesuinco.com.br` |
| Hospedagem do painel | Vercel — deploy automático a cada push na branch publicada |
| Hospedagem da API + banco | VPS própria, Hostinger, plano **KVM 2** |
| Sistema operacional da VPS | Ubuntu 24.04 LTS |
| IP da VPS | `2.25.95.253` |
| Usuário de acesso à VPS | `root` (via SSH ou terminal do navegador no painel Hostinger) |
| Proxy reverso / TLS | nginx + Certbot (Let's Encrypt), renovação automática |
| Processo da API | systemd, serviço `embarque-suinco`, sobe sozinho no boot |
| Usuário de sistema que roda a API | `suinco` (não root — princípio de menor privilégio) |
| Banco de dados | PostgreSQL 16, escuta **só em localhost**, nunca exposto à internet |

**Caminhos no servidor:**

| O que | Onde |
|---|---|
| Código em execução | `/opt/embarque-suinco` |
| Cópia do repositório (fonte da atualização) | `/opt/suinco-src` |
| Segredos (`.env`: senha do banco, `JWT_SECRET`, `BI_TOKEN`) | `/opt/embarque-suinco/.env` |
| Backups diários do banco | `/var/backups/embarque-suinco` (retém 14 dias) |

**Por que duas metades separadas (Vercel + VPS) em vez de tudo num lugar:**
o painel é HTML/JS estático — não precisa de servidor de aplicação para
existir, e a Vercel dá CDN e deploy automático de graça para esse caso. A
API precisa de um processo persistente (Socket.IO, pool de conexão com
banco) e de um banco de verdade — isso pede VPS. Juntar os dois na mesma
plataforma exigiria hospedagem paga mais cara sem ganho real.

**Variáveis de ambiente da API** (`/opt/embarque-suinco/.env`, nunca editado
à mão — ver §11):

```
NODE_ENV=production
PORT=3000
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=embarque_suinco
PGUSER=suinco
PGPASSWORD=***
JWT_SECRET=***                  # mínimo 32 caracteres — HS256
JWT_VALIDADE=12h                # turno de pátio é longo
ORIGENS_PERMITIDAS=https://embarquesuinco.com.br,https://www.embarquesuinco.com.br
BI_TOKEN=***                    # leitura para o Power BI, sem permissão de escrita
RATE_LIMIT=300                  # requisições/min por IP — pátio inteiro no pico usa uma fração
RATE_LIMIT_LOGIN=30             # por IP — troca de turno com várias pessoas no mesmo Wi-Fi
```

---

## 4. Modelo de dados

PostgreSQL, 6 tabelas, SQL escrito à mão (decisão registrada: um ORM
atrapalharia mais do que ajudaria com as views que espelham cabeçalhos do
Power BI e o gatilho que incrementa `versao`).

| Tabela | O que guarda | Chave / índices que importam |
|---|---|---|
| `operadores` | Login: nome, e-mail, hash de senha, setor, ativo/inativo | único por e-mail |
| `dim_veiculos` | Frota: placa → transportadora, tipo de veículo, precisa de revisão | `placa` |
| `dim_rotas` | Catálogo de rotas: código → nome, detalhe, operador responsável | `codigo` |
| `fact_viagens` | **Uma linha por carga**, atualizada no lugar (`UPDATE`), com `versao` incrementada por gatilho a cada mudança | `status_atual`, `placa`, `atualizado_em`, `criado_em`; índice parcial para "cargas abertas" |
| `fact_statusfrota` | **Uma linha por mudança de status** (append — nunca `UPDATE`) — é o histórico/linha do tempo | `carga_id`, `data_evento`, `placa` |
| `log_eventos` | Trilha de auditoria — append-only por desenho, nenhuma rota expõe `UPDATE`/`DELETE` nela | `data_evento`, `carga_id` |

**`fact_viagens` não perde linha quando uma carga é excluída** — a exclusão
marca `excluida_em` (soft delete) em vez de apagar. Isso existe porque a
leitura incremental (§7) responde "o que mudou desde X"; uma linha
fisicamente apagada não aparece em consulta nenhuma, e nenhum outro
terminal saberia que ela sumiu.

**Concorrência:** toda escrita que precisa ser atômica (criar carga +
gravar movimentação, por exemplo) roda dentro de uma transação com
`SELECT ... FOR UPDATE`, travando a linha até o fim da transação — duas
pessoas não conseguem processar a mesma carga ao mesmo tempo de forma
inconsistente. Cada carga carrega um contador `versao`, incrementado por
gatilho do Postgres a cada `UPDATE`.

---

## 5. Referência da API

Base: `https://api.embarquesuinco.com.br`. Toda rota (exceto `/login` e
`/health`) exige `Authorization: Bearer <token>`.

| Método | Rota | Quem pode | O que faz |
|---|---|---|---|
| `POST` | `/login` | Ninguém logado (é o próprio login) | E-mail + senha → token JWT válido por 12h. Limite: 30 tentativas/min por IP |
| `GET` | `/eu` | Qualquer logado | Confirma sessão e devolve dados do operador |
| `POST` | `/renovar` | Qualquer logado, terminal em uso | Renova o token sem pedir senha de novo |
| `GET` | `/estado?desde=` | Qualquer logado | Leitura completa (sem `desde`) ou incremental (com `desde`) de cargas + movimentações |
| `POST` | `/cargas` | Logística, Administração — **ou** Portaria/Logística quando `aguardandoCarga:true` (chegada sem programação, ver §14) | Cria carga |
| `PATCH` | `/cargas/:id` | Qualquer setor, mas só nos campos da sua lista (§6) | Edita campos de negócio, não muda status |
| `POST` | `/cargas/:id/status` | Conforme a etapa — ver tabela de transições em §8 | Avança a carga no fluxo |
| `DELETE` | `/cargas/:id` | Logística, Administração | Exclui (se ainda em "Aguardando Veículo") ou cancela com motivo obrigatório (se já tem histórico) |
| `POST` | `/portaria/saida` | Portaria, Logística, Administração | Saída física, em lote por placa — todas as cargas em aberto daquela placa vão para "Seguiu Viagem" de uma vez |
| `GET` | `/frota` | Qualquer logado | Lista a frota cadastrada |
| `POST` | `/frota` | **Só Logística** (não Administração — divergência conhecida, §15) | Cria/atualiza placa (`ON CONFLICT` por placa) |
| `GET` | `/rotas` | Qualquer logado | Lista o catálogo de rotas |
| `POST` | `/rotas` | **Só Logística** | Cria/atualiza rota (`ON CONFLICT` por código) |
| `GET` | `/operadores` | Só Administração | Lista usuários |
| `POST` | `/operadores` | Só Administração | Cria usuário |
| `PATCH` | `/operadores/:id` | Só Administração | Ativa/desativa, troca setor, redefine senha |
| `GET` | `/bi` , `/bi/:view` | Token de BI (`BI_TOKEN`, não é login de operador) | Views de leitura para o Power BI, sem escrita |
| `GET` | `/health` | Público, sem token (monitoramento externo) | Confirma se o banco responde |

**Códigos de erro mais comuns** (o `codigo` que vem no JSON de erro):

| Código | Situação |
|---|---|
| `SEM_TOKEN` / `TOKEN_INVALIDO` / `TOKEN_EXPIRADO` | Sessão ausente, adulterada ou vencida |
| `SETOR_SEM_PERMISSAO` | Setor certo, ação errada para ele |
| `PLACA_FORA_DA_FROTA` | Trava de frota — placa não cadastrada |
| `LIMITE_LOGIN` / `LIMITE_EXCEDIDO` | Limite de requisições por IP estourado |
| `TRANSICAO_INVALIDA` | Tentativa de pular etapa da máquina de estados |

---

## 6. Segurança e controle de acesso

**O setor do operador vem do token assinado pelo servidor, nunca do que o
navegador manda.** No login, o backend lê o setor da tabela `operadores` e
assina no JWT (`assinarToken()`, `middleware/auth.js`). Editar o
`localStorage`/`sessionStorage` do navegador não muda o que a API aceita —
essa era uma falha de MÉDIA gravidade registrada e sem solução na era
SharePoint, resolvida pela migração.

**Matriz de permissão do backend** (`backend/src/dominio/fluxo.js`):

| Setor | Cria carga | Edita (campos próprios) | Move status | Cadastros (Frota/Rotas) | Usuários |
|---|---|---|---|---|---|
| **Logística** | ✅ | número, placa, transportadora, veículo, motorista, cliente, destino, peso, rota, sequência, "pra onde", paletizada, ganchos, entregas, observações | ✅ **todas as etapas** (cobre qualquer posto) | ✅ | — |
| **Portaria** | Só chegada sem programação | motorista, observações | Aguardando Veículo → Aguardando Embarque · Faturado → Seguiu Viagem | — | — |
| **Expedição** | — | ganchos, observações | Aguardando Embarque → Embarque Iniciado → Embarque Finalizado | — | — |
| **Faturamento** | — | observações | Embarque Finalizado → Faturado | — | — |
| **Administração** | ✅ | (mesma lista da Logística) | ✅ **todas as etapas** | — *(hoje só Logística — ver §15)* | ✅ |

Administração é o "setor irrestrito" (`SETOR_IRRESTRITO` no código): existe
para destravar operação parada de madrugada sem depender de acesso direto
ao banco. Toda ação dela fica marcada `operador_verificado = true` no log —
o poder vem com rastro.

**Camadas de proteção ativas:**

| Camada | Como |
|---|---|
| Senha | `bcryptjs`, hash + salt, nunca texto puro |
| Sessão | JWT assinado (`HS256`, segredo ≥ 32 caracteres), válido 12h, guardado em `sessionStorage` (não sobrevive a fechar a aba — terminal compartilhado não herda sessão) |
| Transporte | HTTPS obrigatório (Let's Encrypt) em painel e API |
| CORS | Só as origens em `ORIGENS_PERMITIDAS` |
| Cabeçalhos | `helmet` (proteções HTTP padrão) |
| Taxa de requisição | `express-rate-limit`: 300/min geral, 30/min em login, por IP |
| Banco | Escuta só em `127.0.0.1` — inacessível pela internet mesmo que o firewall falhe |
| XSS | Toda saída de texto do usuário passa por `esc()`/`escJs()` antes de ir para o HTML (achado histórico corrigido: um `Carga_ID` com aspas quebrava atributo `onclick` e injetava script) |
| Autoria de ação | Cada gravação carrega operador e setor no log — nunca anônima |

---

## 7. Sincronização: tempo real e modo offline

Dois mecanismos, um de reserva do outro — **nenhum dado depende do que é
mais rápido estar de pé**:

### 7.1. Socket.IO — o caminho rápido

`backend/src/tempo-real.js` mantém uma conexão WebSocket autenticada por
JWT (sem token, a conexão é recusada — senão qualquer um na internet veria
o movimento do pátio em tempo real). Toda gravação confirmada no banco
dispara um evento para todo mundo conectado (`emitir()`). `emitir()` **nunca
lança exceção** — uma falha ao avisar não pode derrubar uma gravação que já
foi confirmada; o caminhão está no pátio, a gravação vale mesmo que o aviso
não saia.

### 7.2. `GET /estado?desde=` — o caminho de reserva

Se o socket cair, o painel volta a perguntar ao servidor a cada 15 segundos
"o que mudou desde a última vez que perguntei". A marca de tempo é tomada
**antes** da consulta e recua 5 segundos de margem — corrige um bug
histórico em que gravações feitas entre a consulta e a marca ficavam
perdidas para sempre nas leituras seguintes.

### 7.3. Escrita — local primeiro, sempre

```
ação do operador → regra de negócio → tela atualiza NA HORA
                                          └─ POST/PATCH em segundo plano
                                                ├─ sucesso → marca sincronizado
                                                ├─ servidor recusa (403/409/422)
                                                │     → aviso sonoro na tela (ver §14)
                                                └─ sem rede → fila offline (localStorage)
```

A Portaria registra a chegada com o caminhão parado na frente dela — travar
o botão esperando confirmação de rede degradaria a operação. A tela muda
primeiro; o servidor confirma (ou recusa, com aviso) depois.

### 7.4. Fila offline e liberação de pendência

Sem rede, a gravação entra numa fila guardada no `localStorage` inteiro do
navegador — sobrevive a fechar a aba. Quando a rede volta,
`drenarFila()` reenvia na ordem original. Enquanto uma carga tem gravação
pendente na fila, ela fica marcada (`_pendente`) para que a sincronia
periódica não sobrescreva com dado velho do servidor uma mudança que ainda
não subiu. **Corrigido nesta sessão (§14):** essa marca não era liberada
depois que a fila esvaziava com sucesso — a carga ficava bloqueada para
sempre naquele terminal específico.

### 7.5. Fusão e resolução de conflito (`fundirEstadoRemoto`)

1. Carga que só existe no servidor → entra.
2. Carga nos dois lados → vence a de `atualizado_em` mais recente.
3. **Alteração local ainda não sincronizada nunca é sobrescrita.**
4. Movimentações só se acrescentam (log), deduplicadas por id.
5. O que vem do servidor é marcado como sincronizado, para não gerar eco.

---

## 8. A máquina de estados — os 6 status

```
Aguardando        Aguardando         Embarque          Embarque
 Veículo    ───►   Embarque    ───►  Iniciado   ───►   Finalizado  ───►  Faturado  ───►  Seguiu
                                                                                            Viagem
(Logística        (Portaria:         (Expedição)       (Expedição)       (Faturamento)   (Portaria:
 cria a carga)      "Chegou")                                                              "Saiu")
```

| Transição | Quem registra | Rota da API |
|---|---|---|
| (criação) → Aguardando Veículo | Logística, Administração | `POST /cargas` |
| Aguardando Veículo → Aguardando Embarque | Portaria, Logística | `POST /cargas/:id/status` |
| Aguardando Embarque → Embarque Iniciado | Expedição, Logística | `POST /cargas/:id/status` |
| Embarque Iniciado → Embarque Finalizado | Expedição, Logística | `POST /cargas/:id/status` |
| Embarque Finalizado → Faturado | Faturamento, Logística | `POST /cargas/:id/status` |
| Faturado → Seguiu Viagem | Portaria, Logística | `POST /portaria/saida` (em lote por placa) |

Logística tem autoridade em **todas** as etapas por decisão do gestor: ela
cobre qualquer posto quando falta gente (troca de turno, almoço, ausência).
Tirar essa autoridade produziria o pior desfecho possível — o painel
recusando uma ação que a pessoa tem autoridade real para fazer, empurrando
para a saída de emprestar a senha de outro setor.

**Chegada sem programação:** se a Portaria registra "Chegou" numa placa sem
carga programada, o sistema cria automaticamente uma entrada com
`aguardandoCarga:true` — a Logística completa os dados depois. Essa é a
única forma de a Portaria "criar" uma carga, e desde 07/08/2026 tem rota
própria no servidor (§14) em vez de disputar a rota geral de criação, que é
restrita a Logística/Administração.

**Saída física** move **todas** as cargas em aberto daquela placa de uma vez
(`POST /portaria/saida`) — o caminhão sai do pátio uma vez, não carga por
carga.

---

## 9. Manual operacional por setor

### 9.1. Logística — Torre de Controle, Programação, Cadastros, Indicadores, Histórico, Relatórios

- **Programação:** cadastra a carga do dia antes do caminhão chegar (placa,
  transportadora, peso, rota, tipo de operação, paletização, ganchos,
  entregas) e define a ordem de carregamento (sequência). A placa precisa
  estar na Frota — senão o sistema recusa ("trava de frota").
- **Cadastros:** mantém Frota (placa → transportadora → tipo de veículo) e
  Rotas. Base para tudo que a Programação usa.
- **Torre de Controle:** visão de leitura de todas as cargas em aberto, de
  todos os setores, numa tela só — não altera nada.
- Também opera Portaria, Expedição e Faturamento quando precisa cobrir um
  posto — a mesma sessão dá acesso a todas as abas operacionais.

### 9.2. Portaria — Torre, Portaria, Histórico

- **"Chegou":** registra a chegada física do caminhão. Se a placa já tinha
  programação, avança o status; se não tinha, cria a entrada
  "Aguardando Carga" (§8).
- **"Saiu":** registra a saída, em lote, de todas as cargas em aberto
  daquela placa — só depois de "Faturado".

### 9.3. Expedição — Expedição, Indicadores, Histórico, Relatórios *(desde 07/08/2026)*

- Controla o carregamento do início ao fim: "Embarque Iniciado" →
  "Embarque Finalizado".
- Único setor operacional (fora Logística) com acesso a **Indicadores** —
  decisão deliberada: é quem opera as duas etapas mais longas do fluxo e
  pode agir no mesmo turno sobre o que o indicador mostra (remanejar doca,
  cobrar conferente, reordenar fila).
- Ganhou acesso à aba **Relatórios** nesta sessão (mesmo nível da
  Logística: PDF Operacional, Executivo, Administração de Fretes, CSV
  Power BI).

### 9.4. Faturamento — Faturamento, Histórico, Relatórios *(desde 07/08/2026)*

- Emite a nota da carga já carregada ("Embarque Finalizado" → "Faturado"),
  liberando o caminhão para a Portaria registrar a saída.
- Ganhou acesso à aba **Relatórios** nesta sessão, no mesmo pacote da
  Expedição.

### 9.5. Administração — todas as operacionais + Usuários

- Único setor com acesso à aba **Usuários**: criar, bloquear e redefinir
  senha de operadores de todos os setores. Vale no servidor, não só na
  tela — mesmo forçando pelo navegador, a API recusa para quem não é
  Administração.
- Mesma autoridade irrestrita da Logística nas etapas do fluxo.

### 9.6. Relatórios — quem vê o quê hoje

| Aba/cartão | Logística | Expedição | Faturamento | Administração | Portaria |
|---|---|---|---|---|---|
| PDF Operacional | ✅ | ✅ | ✅ | ✅ | — |
| PDF Executivo | ✅ | ✅ | ✅ | ✅ | — |
| Administração de Fretes (valor negociado) | ✅ | ✅ | ✅ | ✅ | — |
| Exportar CSV (Power BI) | ✅ | ✅ | ✅ | ✅ | — |

A aba é hoje tudo-ou-nada — não existe permissão por cartão dentro dela.
Abrir Relatórios para Expedição/Faturamento (pedido do usuário, 07/08/2026)
significou abrir também o cartão de Fretes e a exportação CSV, decisão
tomada de propósito depois de confirmação explícita, não efeito colateral.

---

## 10. Relatórios e exportação

| Relatório | Conteúdo | Formato |
|---|---|---|
| **PDF Operacional** | Sequenciamento do dia — todas as cargas do período, status colorido, ordenadas pela etapa na linha do tempo | A4 paisagem, 13 colunas, pensado para virar foto de WhatsApp |
| **PDF Executivo** | KPIs, gargalos, pontos críticos, linha do tempo — visão de gestão | A4 paisagem, uma "história" (o que exige ação → onde está a fila → onde o tempo se perde → histórico) |
| **Administração de Fretes** | Número da carga, rota, observações (valor negociado, instruções) | A4 paisagem, 3 colunas |
| **CSV Power BI** | 5 arquivos fato/dimensão (`Fact_Movimentacoes`, `Dim_Carga`, `Dim_Transportadora`, `Dim_Frota`, `Dim_Status`) | Uso pontual — o caminho recomendado é o Power BI ler direto de `GET /bi/:view` |

Todos os três PDFs respeitam o filtro de período ("Data da Programação") no
topo da aba Relatórios. Desde 07/08/2026, Nº da Carga e Placa têm destaque
visual (negrito + trilha de fundo dourada) nos três documentos, e a fonte
subiu para leitura mais confortável — ver §14.

---

## 11. Operar o servidor — resumo de comandos

Detalhe completo em `docs/MANUAL_DO_SERVIDOR.md`. Aqui, só o que se usa no
dia a dia.

```bash
ssh root@2.25.95.253                                          # entrar

# ATUALIZAR (depois de um push que muda o backend)
cd /opt/suinco-src
git -c core.editor=true pull --no-edit
sudo bash entregaveis/suinco_logistica/backend/instalar.sh    # seguro rodar quantas vezes quiser

# DIAGNOSTICAR (não altera nada, pode rodar com o pátio operando)
sudo bash entregaveis/suinco_logistica/backend/diagnostico.sh

# SERVIÇO
sudo systemctl status  embarque-suinco                        # está rodando?
sudo systemctl restart embarque-suinco                        # reiniciar (2-3s, gravações ficam na fila)
sudo journalctl -u embarque-suinco -n 50 --no-pager            # últimas linhas do log

# USUÁRIOS (o normal é pela tela; terminal só para o 1º operador ou recuperação)
cd /opt/embarque-suinco
sudo -u suinco node scripts/operador.js listar
sudo -u suinco node scripts/operador.js criar email@x.com "Nome" Setor
sudo -u suinco node scripts/operador.js senha email@x.com

exit
```

**Regra que evita o erro mais comum:** um `git push` no repositório deixa o
**painel** (Vercel) atualizado sozinho. A **API** só atualiza quando alguém
roda os três comandos de "ATUALIZAR" acima, no servidor. Uma correção de
backend sem esse passo continua ausente em produção mesmo com o código já
publicado no GitHub — foi exatamente o que precisou ser lembrado nesta
sessão para os dois bugs corrigidos em §14.

**Nunca fazer** (detalhado em `MANUAL_DO_SERVIDOR.md` §14): abrir a porta
5432 no firewall; mandar senha/chave/token para qualquer pessoa, inclusive
para quem desenvolve o sistema; editar `.env` na mão; `rm -rf` sem
confirmar antes; `git push`/`git commit` no servidor (ele só recebe
código).

---

## 12. Backup, restauração e emergências

- **Backup automático diário**, retém 14 dias, em
  `/var/backups/embarque-suinco` — não precisa criar nada.
- **Forçar backup antes de mexer em algo arriscado:**
  `sudo /etc/cron.daily/backup-embarque-suinco`
- **Restaurar** (só em emergência real — apaga o que está no banco hoje):
  parar o serviço → `dropdb`/`createdb` → `gunzip | psql` do arquivo do
  backup → subir o serviço de novo. Passo a passo completo em
  `MANUAL_DO_SERVIDOR.md` §9. **Avisar antes de rodar.**
- **Certificado HTTPS** renova sozinho (Certbot); o diagnóstico avisa com
  10 dias de antecedência se algo falhar.
- **Painel parado para todo mundo:** rodar o diagnóstico, mandar a saída,
  tentar `systemctl restart embarque-suinco` enquanto isso.
- **Carga excluída por engano:** fica marcada no banco, não apagada
  (`excluida_em`) — recuperável a partir do número da carga e da data.

---

## 13. Testes — o que garante que funciona

| Camada | Ferramenta | Cobertura hoje |
|---|---|---|
| Backend (regra de negócio, permissão, API) | `node --test` (`backend/testes/api.test.js`) | 89 casos — login, trava de frota, transições de status, permissão por setor, exclusão/cancelamento, cadastros de Frota/Rotas |
| Interface (fluxo real no navegador) | Playwright (`testes/*.py`) | 21 suítes — login, sincronia entre dois operadores, fila offline, layout mobile em 3 tamanhos de tela, contraste de cor (WCAG), relatórios impressos |
| Layout dos relatórios | `ferramentas/simular_relatorios.py` | Gera os 3 PDFs com dados de teste e confere: nenhuma coluna estoura a folha, nenhuma fonte abaixo de 8px, nenhuma folha em branco |

Rodar tudo antes de considerar uma mudança pronta:

```bash
cd backend && npm run teste                       # 89 casos, precisa do Postgres local
python3 ferramentas/simular_relatorios.py          # os 3 relatórios
for f in testes/*.py; do python3 "$f"; done        # bateria completa de interface
```

---

## 14. Auditoria de 07/08/2026 — o que foi corrigido hoje

Sessão de auditoria dirigida ("achar bugs do mesmo formato do que travava o
botão 'Chegou': escrita local otimista, servidor recusa, ninguém avisa"),
seguida de dois pedidos pontuais. Tudo já commitado, testado e publicado.

### Achado HIGH 1 — chegada sem programação da Portaria, recusada em silêncio

`registrarChegadaPortaria()` criava a carga localmente e subia pela rota
geral de criação (`POST /cargas`), restrita a Logística/Administração — uma
sessão de Portaria recebia 403, a recusa era engolida (`upsert()` retornava
`{recusado:true}` em vez de lançar exceção), e a tela mostrava sucesso
enquanto a carga nunca existia no banco. **Corrigido:** `POST /cargas` agora
tem caminho próprio para `aguardandoCarga:true` (Portaria ou Logística),
sem trava de frota, com o servidor ignorando qualquer campo de negócio que
o corpo tente mandar — só a placa vem do cliente.

### Achado HIGH 2 — fila offline nunca liberava a carga que passou por ela

`liberarPendencias()` existia, com comentário dizendo exatamente quando
deveria rodar, e nunca era chamada. Uma carga que caía na fila offline
ficava marcada como pendente **para sempre**, mesmo depois de a gravação
subir com sucesso — e como a marca vai para o `localStorage` inteiro, o
bloqueio sobrevivia a fechar a aba. **Corrigido:** ligada ao callback que já
roda depois de cada drenagem de fila bem-sucedida.

### Generalização — recusa ao criar/editar carga agora avisa

Qualquer recusa de `upsert()` (403/409/422) virou aviso sonoro na tela
(`aoRecusarCarga`/`receberRecusaDeCarga`), não só o caso da chegada sem
programação.

### Achados menores, mesmo ciclo

- `capacidadeKg:0` virava `null` em `POST /frota` (`Number(x)||null`,
  colapso de falsy) — corrigido para `Number.isFinite`.
- `backend/src/rotas/cadastros.js` tinha zero teste — fechado com 16 casos
  novos.
- Documentação órfã do MSAL/SharePoint corrigida nos três documentos que
  ainda descreviam um "gap de segurança" que não existe mais no código.
- Decisão sobre o cliente Socket.IO (único script externo carregado hoje):
  avaliado manter carregamento externo do próprio servidor em vez de SRI
  fixo ou cópia embutida — as duas alternativas trocam por um risco pior
  (esquecer de atualizar a cada deploy). Decisão fechada, registrada em
  `ARQUITETURA_E_OPERACAO.md` §6.4.

### Pedido — relatórios com fonte maior e destaque visual

Fonte subiu nos três PDFs (Operacional 9,2→9,8px, Executivo 9,5→10,5px,
Fretes 12→13px). Nº da Carga e Placa ganharam trilha de fundo dourada em
negrito nos três documentos e nas tabelas de análise do Executivo. No
processo, o aumento de fonte fez "AGUARDANDO EMBARQUE" quebrar em duas
linhas na largura antiga da coluna Status — corrigido rebalanceando o
orçamento de largura antes de publicar.

### Pedido — Expedição e Faturamento com acesso a Relatórios

Ver §9.6. No caminho, a auditoria mobile pegou uma regressão: o rótulo
longo escrito para o aviso "você é do setor X" estourava a tela em celular
de 320-390px (o selo é `white-space:nowrap` por design) — corrigido para um
rótulo curto antes de publicar.

**Tudo commitado na branch de trabalho, mergeado na branch publicada
(Vercel atualiza sozinho) e — para os dois achados HIGH, que dependem de
rota nova no backend — só valem de verdade em produção depois que a VPS
rodar o instalador (§11).**

---

## 15. Pendências conhecidas e próximos passos

Registradas para decisão futura, não implementadas por decisão consciente
de escopo desta sessão:

- **`POST /frota` e `POST /rotas` aceitam só Logística, não
  Administração** — diferente do padrão do resto do sistema
  (`SETOR_IRRESTRITO` cobre as outras rotas). Risco de divergência, não bug
  ativo hoje; `podeEditarCadastros()` existe em `fluxo.js` mas
  `rotas/cadastros.js` usa `exigirSetor('Logística')` direto, sem passar
  por ela.
- **Funções sem nenhuma chamada** encontradas por varredura mecânica,
  cada uma precisando de leitura antes de decidir excluir/ligar/manter:
  `blocoExtremos`, `comOverlaySync`, `corTextoSobre`, `estaFaturado`,
  `rankingDoDia`, `renderExtremosHoje`, `textoSobre` (frontend);
  `proximoStatus` (backend — possivelmente duplicada em `app.js`).
- **Sem teste de carga real** — a suíte prova que a lógica de concorrência
  está certa com 2 operadores simultâneos, não que o servidor aguenta um
  pico de tráfego real. Para o tamanho de time que o painel atende hoje,
  tende a não ser risco prático, mas é lacuna honesta.
- **Permissão por cartão dentro da aba Relatórios** não existe — é
  tudo-ou-nada (ver §9.6). Se um dia for preciso dar Operacional/Executivo
  sem dar Fretes/CSV, precisa de mecanismo novo.

---

## 16. Glossário

| Termo | Significado |
|---|---|
| **Trava de frota** | Regra que impede programar carga numa placa não cadastrada em `dim_veiculos` |
| **Setor irrestrito** | Administração — tem autoridade em todas as etapas do fluxo, marcada no log |
| **Chegada sem programação** | Caminhão que chega sem carga cadastrada — a Portaria registra e a Logística completa depois |
| **Fila offline** | Gravações feitas sem rede, guardadas no navegador até a conexão voltar |
| **`_pendente`** | Marca interna que protege uma carga com gravação ainda não confirmada de ser sobrescrita pela sincronia |
| **Fusão de estado remoto** | Processo que concilia o que o navegador tem com o que o servidor tem, a cada leitura |
| **Soft delete** | Exclusão que marca a linha (`excluida_em`) em vez de apagar — preserva histórico e permite a leitura incremental saber "isto sumiu" |
| **`versao`** | Contador por carga, incrementado a cada `UPDATE`, usado para bloqueio otimista |
| **BI_TOKEN** | Credencial separada do login de operador, só leitura, usada pelo Power BI |

---

*Documento gerado em 07/08/2026, cobrindo o sistema até o commit mais
recente publicado na branch principal naquela data. Para o estado exato do
código, ver o histórico de commits do repositório — este documento é o
mapa de leitura, não a fonte da verdade (que é sempre o código).*
