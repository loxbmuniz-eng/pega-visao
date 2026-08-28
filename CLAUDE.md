# CLAUDE.md

Guia para assistentes de IA que trabalham neste repositório. Escrito em
português porque **essa é a convenção do projeto** (código, testes, commits e
documentação em português) — ver §7.

> **Leia antes de tudo:** este repositório contém um sistema **em produção,
> usado ao vivo, todo dia, por oito setores de uma cooperativa
> agroindustrial**. Não é protótipo. Errar aqui para caminhão parado no pátio.
> As duas leituras obrigatórias antes de qualquer mudança:
>
> 1. `entregaveis/suinco_logistica/docs/PROTOCOLO_MESTRE_DE_MUDANCAS.md`
> 2. a skill `suinco-entrega-sem-ponto-solto` (`.claude/skills/`)

---

## 1. O que existe neste repositório

Duas coisas diferentes, no mesmo git:

| Onde | O que é | Estado |
|---|---|---|
| `entregaveis/suinco_logistica/` | **Painel de Programação de Embarque Suinco** — o sistema de logística de pátio. É 95% do repositório e de onde vem todo o trabalho de engenharia. | Em produção |
| `entregaveis/` (raiz) | Peças gráficas do **Pega Visão × Universo Paralello 19** — pitch deck (`build_deck.js`), planilha de provisionamento (`build_xlsx.py`), manifesto *Nodal Silence*, frames e washes. | Entregue |
| `docs/superpowers/specs/` | Specs de design de duas ondas de trabalho (4 blocos, devoluções). | Histórico |
| `.claude/skills/` | ~70 skills instaladas. **Quatro são deste projeto** — ver §9. | — |

Salvo indicação em contrário, "o projeto" abaixo significa
`entregaveis/suinco_logistica/`.

---

## 2. Arquitetura em uma tela

```
NAVEGADOR ──HTTPS──► VERCEL (estático)         embarquesuinco.com.br
   │                 index.html único, gerado
   │
   └──HTTPS + WebSocket──► VPS Hostinger (Ubuntu 24.04)
                            nginx (TLS) → Node/Express (systemd: embarque-suinco)
                                        → PostgreSQL 16 (só localhost)
                            API: api.embarquesuinco.com.br
```

**As duas metades publicam de forma diferente, e isso é a fonte de erro nº 1
do projeto:**

| Metade | Publica | Consequência |
|---|---|---|
| Frontend | sozinho, no Vercel, ao push da branch de entrega | vale em minutos |
| Backend (código + migrações) | **só quando alguém roda `atualizar.sh` por SSH** | não vale até lá |

Uma correção que depende do servidor **não está pronta — está agendada**, e
tem de ser dita como pendente, com nome e efeito, toda vez que o assunto for
relatado. O portão de publicação (§6) calcula essa lista sozinho; nunca a
escreva à mão.

### Frontend — sem framework, sem npm, um arquivo só

Fontes em `entregaveis/suinco_logistica/`:

| Arquivo | Papel | Regra |
|---|---|---|
| `index_suinco.html` | estrutura das 11 abas | Torre · Programação · Devoluções · Portaria · Expedição · Faturamento · Indicadores · Cadastros · Histórico · Relatórios · Usuários |
| `app.js` (~490 KB) | apresentação: desenha, escuta eventos | nunca fala com a rede direto |
| `data.js` (~134 KB) | regras de negócio, estado local, indicadores | não conhece DOM nem rede |
| `suinco-api.js` (~72 KB) | adaptador da API: REST, fila offline, Socket.IO | único módulo que sabe que existe servidor |
| `devolucoes.js` (~110 KB) | módulo de Devoluções, **servidor-first** (sem cópia em localStorage) | carregado depois de `app.js` |
| `qr.js` | QR do segundo fator, escrito à mão (sem CDN) | provado por decodificador independente |
| `styles.css` | design system | |
| `sw.js` | service worker: painel network-first, API nunca cacheada | carimbado pelo build |

**`index.html` é GERADO. Nunca edite à mão.** Depois de mexer em qualquer
fonte acima:

```bash
python3 entregaveis/suinco_logistica/build_arquivo_unico.py
```

O build embute CSS, JS, logo, fonte e o CSV da frota como data URI, e carimba
`sw.js` com data+commit (é o carimbo que dispara a auto-atualização da aba
aberta no pátio). Sem rodar o build, os testes de navegador medem a versão
anterior e passam quando deveriam falhar.

### Backend — `entregaveis/suinco_logistica/backend/`

```
src/servidor.js       Express, helmet, CORS, rate limit, montagem das rotas
src/config.js         .env
src/banco.js          pool PostgreSQL + transações
src/tempo-real.js     Socket.IO
src/middleware/auth.js  JWT: exigirLogin, exigirSetor
src/dominio/          fluxo.js (máquina de estados) · cargas.js · devolucoes.js
                      · programacoes.js · documentos.js · totp.js · resumo_bot.js
src/rotas/            auth · cargas (1.885 linhas, o coração) · devolucoes ·
                      cadastros · estado · operadores · programacao ·
                      modelo_semana · avisos · relatorios · bi · bot
src/servicos/         pdf.js · relatorio_headless.js (Playwright) · avisos.js
                      (web-push) · registro_leitura.js
migrations/           38 arquivos SQL, aplicados por scripts/migrar.js
testes/               api.test.js · devolucoes.test.js · avisos.test.js
instalar.sh / atualizar.sh / atualizar_tudo.sh / diagnostico.sh / assistente_servidor.sh
```

Banco: 25 tabelas (`fact_viagens` é a carga; `carga_revisoes` e `log_eventos`
são a auditoria; `dim_*` são cadastros; `devolucao*` é o checklist) e 7 views
`vw_*` para o Power BI.

---

## 3. A máquina de estados do pátio

```
Aguardando Veículo → Aguardando Embarque → Embarque Iniciado
                   → Embarque Finalizado → Faturado → Seguiu Viagem
   (Logística)          (Portaria)            (Expedição)
                        (Expedição)        (Faturamento)  (Portaria)
```

**Fonte da verdade: `backend/src/dominio/fluxo.js`** (`STATUS_FLOW`,
`validarTransicao`, `camposEditaveisPor`). A cadeia está **replicada** no
front (`data.js`) e em suítes de teste como lista literal — mexer em uma etapa
exige tocar em todas (gap G8 do `MIGRATION-GAPS.md`).

Regras que não se negociam:

1. **Transição só avança.** Voltar etapa não é transição — é
   `POST /api/cargas/:id/corrigir-etapa`, com motivo obrigatório e autor.
2. **O servidor confere.** Esconder botão na tela não é controle de acesso.
3. **Toda mudança vira revisão** por trigger de banco (`carga_revisoes`,
   migração 009) — inclusive SQL manual. Nunca contorne o trigger.
4. **Eco não apaga.** Campo reenviado vazio usa
   `COALESCE(NULLIF($n,''), coluna)`. Lacre da Portaria já foi apagado assim.
5. **Excluída ≠ inexistente.** `excluida_em` marca; a linha fica. Consulta de
   operação filtra `excluida_em IS NULL`; consulta de controle inclui as
   canceladas.
6. **Logística passa em todos os passos** por decisão do gestor (cobre posto
   vago). Administração é irrestrita, e toda ação dela fica no log.

**Três relógios diferentes — confundi-los já produziu incidente:**

| Relógio | Começa |
|---|---|
| Tempo de pátio (SLA de 3h) | entrada **real** do veículo (`Aguardando Embarque`) |
| Lead time | criação da carga |
| Data de programação | dia para o qual foi programada, não o dia digitado |

`entradaNoPatioDe(c)` (app.js) sabe a diferença e devolve `null` quando o
caminhão não chegou — `null` é resposta legítima, nunca preencha com a data de
criação.

Detalhes e exceções (segunda carga da mesma placa, chegada sem programação,
retenção de lacre, encerramento administrativo): skill `suinco-yard-flow`.

---

## 4. Rodar na sua máquina

Precisa de Node 20+ (o VPS roda 22) e PostgreSQL 14+ (produção: 16).

```bash
cd entregaveis/suinco_logistica/backend
cp .env.exemplo .env          # preencha PGPASSWORD e JWT_SECRET
npm ci                        # ci, nunca install — o lock manda
npm run migrar
npm run teste                 # bateria da API contra Postgres de verdade
npm start                     # a API sobe na porta do .env
```

```bash
cd entregaveis/suinco_logistica
python3 build_arquivo_unico.py            # regera index.html
bash testes/rodar_tudo.sh                 # 117 suítes de navegador
bash testes/rodar_tudo.sh mobile          # só as que casam com "mobile"
```

Outros geradores (todos leem o painel/banco reais, nenhum desenha à mão):

| Comando | Produz |
|---|---|
| `python3 tutoriais/gerar_guias.py [Setor]` | os 8 guias em PDF, com prints reais |
| `python3 apresentacao/gerar_apresentacao.py` | apresentação do painel |
| `python3 comite/gerar_ficha.py` | Ficha de Priorização do Comitê de Devoluções |
| `python3 ferramentas/simular_relatorios.py` | relatórios com dado de simulação |
| `node backend/scripts/preparar_demo_guias.js` | operadores de demonstração |

---

## 5. Testes

| Bateria | Comando | O que cobre |
|---|---|---|
| API | `cd backend && npm run teste` | ≈360 casos contra PostgreSQL real — sem mock de banco, de propósito: bloqueio otimista, `FOR UPDATE`, triggers e FK só aparecem com banco de verdade |
| Navegador | `bash testes/rodar_tudo.sh` | 117 suítes Playwright em Python, nomes e mensagens em português |

`rodar_tudo.sh` faz três fases: as 76 suítes que abrem `index.html` por
`file://` correm em paralelo; as que falam com a API correm uma a uma **com o
banco limpo antes de cada**; e toda suíte que reprovou volta a rodar sozinha,
com banco limpo — se passar aí, o vermelho era contaminação, e isso fica dito
na tela. Ele **recusa rodar se `PGHOST` não for local** (ele apaga tabelas).

O CI (`.github/workflows/testes.yml`) roda **só a bateria da API**, em Node 20
e 22, mais `npm audit --audit-level=high`. A bateria de tela leva ~20 min e
fica no portão de publicação, de propósito.

**Vermelho tem QUATRO causas.** Descubra qual antes de tocar em código:

1. a regra mudou de propósito → o teste é que está velho;
2. o teste mede um atalho que mudou de forma (contar `<tr>` numa tabela que
   ganhou linha de grupo é o caso clássico daqui);
3. contaminação de outra suíte → rode sozinha, com banco limpo;
4. regressão de verdade → só aqui se as três acima caírem.

`git stash && python3 build_arquivo_unico.py` separa (4) de (1)–(3) em minutos.

**Bateria começada é bateria terminada.** Nunca mate o portão no meio para
arrumar algo, nunca commite durante a corrida (o passo de árvore limpa já
passou), e nunca deixe o dono sem número: quantas rodaram, quantas faltam,
quantos vermelhos.

---

## 6. Publicar — o portão

```bash
bash entregaveis/suinco_logistica/publicar.sh > /tmp/portao.log 2>&1
```

Nada vai para a operação sem passar por ele. Oito checagens, nesta ordem:
branch de trabalho · árvore limpa · `index.html` corresponde às fontes ·
bateria da API · API de teste no ar **e capaz de gerar PDF** · bateria de tela
· toda migração pendente declara `-- SEM ESTA MIGRAÇÃO: <o que quebra>` no
cabeçalho · merge + push na branch de entrega. No fim ele imprime o bloco de
pendências (migrações **e** código de servidor mudado desde
`backend/COMMIT_EM_PRODUCAO.txt`) e os itens abertos de
`docs/O_QUE_FALTA_BLINDAR.md`. **Esse bloco é repassado ao dono na íntegra.**

Ao rodá-lo: **nunca** canalize para `tail`/`head` (o pipe segura tudo e mata a
saída), **nunca** ponha timeout curto (passa de 15 min), **nunca**
`pkill -f publicar.sh` (o padrão casa com a própria linha de comando; use
`pkill -f 'publicar[.]sh'`). Os três já aconteceram no mesmo dia.

Branches:

| Branch | Papel |
|---|---|
| `claude/suinco-logistics-migration-z0k521` | trabalho — é onde o portão exige que você esteja |
| `claude/pega-visao-up19-deliverables-6cqhjb` | entrega — o Vercel publica daqui |

Dois arquivos são **registro do que aconteceu**, não do que se pretende fazer.
O número só sobe depois que o dono colar o bloco `COPIE DAQUI` do terminal
dele: `backend/migrations/APLICADAS_EM_PRODUCAO.txt` (hoje: 037) e
`backend/COMMIT_EM_PRODUCAO.txt`.

No servidor o dono entra como root e **não tem `sudo`** — nunca mande comando
com `sudo`:

```
ssh root@<ip>
cd /opt/suinco-src && git pull && bash entregaveis/suinco_logistica/backend/atualizar.sh
```

`atualizar.sh` faz um passo (código + migrações). `atualizar_tudo.sh` faz três
(mais limpeza de duplicadas e prova de que o backup restaura). Diga qual, e o
que fica de fora se for o primeiro.

---

## 7. Convenções

- **Tudo em português** — código, nomes de função, testes, commits,
  documentação, mensagens de erro. Quem opera o pátio lê os relatórios; quem
  mantém o sistema lê o código.
- **Comentário explica POR QUE, não O QUE**, e quase sempre cita o incidente
  ou o pedido que originou a regra, com data. Siga esse tom: um comentário
  novo que só descreve a linha abaixo destoa do arquivo inteiro.
- **Mensagem de commit é uma frase em português**, no indicativo, dizendo o
  efeito — não `feat:`/`fix:`. Ex.: *"O checklist para de se apagar quando uma
  carga é atualizada"*.
- **Teste antes do código** para correção de defeito: primeiro o vermelho que
  reproduz, depois a correção. Correção sem teste de regressão não está
  pronta.
- **Reproduza antes de afirmar; meça antes de descrever.** Nunca responda
  "isso funciona assim" a partir de leitura de código. Número (rolagem,
  contraste, tamanho) é medido no navegador, nunca estimado.
- **Nunca preencha lacuna com suposição.** Se falta informação que muda o que
  será construído, marque **A CONFIRMAR** e siga com o resto. Nunca invente
  dado de negócio: código de rota, número de carga, placa, nome de cliente.
- **Três estados, sempre com o símbolo:** ✅ no ar (commit na branch de entrega
  **e**, se toca backend, `atualizar.sh` rodado) · 🟡 commitado, não publicado
  · ⬜ proposta. "Pronto" sem um dos três não é resposta.
- **Uma mudança, uma verificação.** Nunca duas mudanças em produção sem
  conseguir isolar qual resolveu o quê.
- **Nunca proponha reset, rollback ou reboot como primeira resposta.**

Padrões da casa que já custaram caro:

- **Excluir carga remove da lista local** (`DB.cargas.filter`) e registra em
  `alteracoes`. Só marcar `excluida = true` deixa fantasma na tela.
- **Quem manda é o servidor.** O painel adianta o resultado para o operador,
  mas a verdade é a do banco: toda correção de dado tem as duas metades.
- **Uma função, dois chamadores.** Mesma situação por dois caminhos vira
  função própria — a absorção da entrada no pátio ficou semanas sem tratamento
  por estar escondida dentro da troca de placa.
- **Campo novo existe em três pontos:** ida (`data.js sincronizarCarga`),
  volta (`suinco-api.js daApiParaLinha`) e conversão
  (`data.js cargaDeLinhaRemota`). Faltando um, o dado **some sem erro**.
- **Carimbo é quando aconteceu, não quando alguém digitou.**
- **Pátio não se apaga.** O que sai da operação continua no Histórico.
- **Botão desabilitado não ensina o caminho, só nega.** Se a tela vai impedir,
  ela mostra a saída.

---

## 8. Armadilhas deste contêiner

- **O PostgreSQL local cai sozinho** (o contêiner recolhe processo ocioso).
  Confira `pg_lsclusters` e suba com `pg_ctlcluster 16 main start` **antes** de
  medir qualquer coisa. Já causou "teste travado" três vezes num dia.
- **A API local é a porta 3010**, não 3000.
- **Playwright:** `executable_path='/opt/pw-browsers/chromium'`, ou
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`. Sem isso, os 6 testes
  de PDF do backend falham fora do portão — **não é regressão**.
- **`npm run seed:frota` e `npm run operador` apontam para arquivos que não
  existem** (`scripts/seed_frota.js`, `scripts/criar_operador.js`). Os reais
  são `scripts/seed.js` e `scripts/operador.js` — chame por `node` direto.
- **Números em documentação envelhecem.** Vários docs citam "346 testes", "110
  suítes", "6 tabelas". Conte antes de repetir:
  `grep -c '^\s*test(' backend/testes/*.test.js`,
  `ls testes/test_*.py | wc -l`.

---

## 9. Skills deste projeto

Quatro skills em `.claude/skills/` foram escritas **para este sistema** e valem
mais que qualquer skill genérica quando o assunto é o painel:

| Skill | Quando |
|---|---|
| `suinco-entrega-sem-ponto-solto` | **antes** de dizer que algo está pronto/publicado, antes de commit, publicação ou mensagem de status; antes de mexer em carga, pátio, montagem ou permissão |
| `suinco-yard-flow` | qualquer coisa que crie carga, mude status, calcule tempo de pátio ou escreva na trilha de auditoria |
| `suinco-sanitary-traceability` | lote, validade, temperatura, SIF, certificado sanitário, recall |
| `suinco-edi-gs1` | romaneio, aviso de embarque (DESADV/ASN), SSCC/GTIN/GLN, integração com sistema de cliente |

---

## 10. Onde ler mais

Em `entregaveis/suinco_logistica/docs/` (27 documentos). Nesta ordem, para
quem chega agora:

1. `MAPA_COMPLETO_DO_SISTEMA.md` — o manual técnico consolidado.
2. `MANUAL_DO_SERVIDOR.md` — operar a VPS: subir, reiniciar, log, backup.
3. `O_QUE_FALTA_BLINDAR.md` — o que está aberto agora, com os comandos.
4. `PROTOCOLO_MESTRE_DE_MUDANCAS.md` — como se mexe aqui sem quebrar produção.
5. `POSMORTEM_2026-08-08.md` — um incidente real, contado inteiro.
6. `REGISTRO_DE_OCORRENCIAS.md` — toda ocorrência da operação, com causa,
   correção e o teste que impede que ela volte. Ocorrência nova entra ali no
   mesmo dia.

Na raiz do projeto: `MIGRATION-GAPS.md` e `MIGRATION-PLAN.md` (distância até um
produto multi-tenant), `GO_LIVE_MASTER.md`, `SKILLS-AUDIT.md`, `specs/`.

> **Aviso que evita uma reunião perdida.** Alguns documentos falam de
> SharePoint e Microsoft 365 — inclusive o cabeçalho de `data.js`. Aquele foi o
> desenho inicial e **nunca entrou em produção**; nenhuma Lista foi
> provisionada. O backend é Node + PostgreSQL desde 05/08/2026. Não provisione
> nada com base neles.
