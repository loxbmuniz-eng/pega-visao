# MIGRATION-GAPS — Embarque Suinco → produto de nível global

**Data:** 21/08/2026 · **Fase 1** do plano de migração · **Nada foi instalado ainda.**

## Como ler este documento

O sistema **está em produção e é sólido**: 5 setores usando ao vivo, 260 testes
de servidor + 95 suítes de navegador verdes, trilha de auditoria por trigger de
banco, revisões de carga com restauração, sincronização em tempo real entre
terminais e fila offline. **Nada aqui pede reescrita.** Este documento mede a
distância entre o que existe e o que um produto multi-tenant, internacionalizado
e certificável exige — cada gap é uma camada a somar, não um remendo de erro.

Severidade:

| Marca | Significado |
|---|---|
| **BLOQUEIA** | Impede vender/operar para um segundo cliente ou passar em auditoria. Nenhum trabalho de produto avança de verdade antes disto. |
| **ALTO** | Não bloqueia hoje, mas cada semana sem isto aumenta o custo de fazer depois (dados acumulam no formato errado). |
| **MÉDIO** | Necessário para o alvo global; pode entrar em onda posterior sem dívida crescente. |

Toda afirmação abaixo foi verificada no código/banco nesta sessão — o comando
de verificação está citado em cada gap.

---

## G1 · Multi-tenancy — **BLOQUEIA**

**Evidência:** `grep -rn "tenant\|cliente_id\|empresa_id" backend/src` → **zero
ocorrências**. As 19 tabelas do banco (`fact_viagens`, `devolucoes`,
`dim_veiculos`, `operadores`, `log_eventos`…) não têm coluna de tenant. Toda
consulta lê o universo inteiro; o isolamento hoje é *o banco pertencer a um
cliente só*.

**O que isso significa na prática:** um segundo cliente exige uma segunda VPS,
um segundo banco, um segundo deploy — e o custo operacional multiplica por
cliente em vez de diluir. Pior: qualquer feature nova precisa ser aplicada N
vezes.

**Por que é BLOQUEIA e não ALTO:** o dado que entra hoje sem `tenant_id` vira
migração retroativa amanhã, e migração retroativa de tabela de auditoria
(`log_eventos`, `carga_revisoes`) é exatamente o tipo de mexida que um auditor
questiona. Quanto mais tarde, mais caro e mais suspeito.

**Complicador específico deste sistema:** a chave natural do dia a dia é a
**placa**, e placa é global (o mesmo caminhão atende dois embarcadores). O
modelo de tenant precisa decidir se `dim_veiculos` é por tenant ou compartilhada
com vínculo — decisão de produto, não de banco.

**Skill que endereça:** `shard` (simota) · **Fase 3**

---

## G2 · i18n / l10n — **ALTO**

**Evidência:** `America/Sao_Paulo` aparece **8 vezes** no servidor, cravado em
literal (`backend/src/rotas/cargas.js`, `dominio/resumo_bot.js`); `pt-BR`
aparece **54 vezes** no front (`toLocaleString('pt-BR')`). Não existe camada de
tradução: todo rótulo é texto literal em português dentro do HTML/JS.

**Dimensões que faltam, todas:**

| Dimensão | Hoje | Alvo |
|---|---|---|
| Idioma | pt-BR literal no código | catálogo de mensagens, pt-BR como um locale entre outros |
| Fuso | `America/Sao_Paulo` fixo | fuso por tenant (e por unidade, se o cliente tiver duas plantas) |
| Moeda | não há valores monetários hoje | frete/faturamento internacional exige |
| Peso | quilo implícito em todo lugar (`peso_kg`) | kg/lb por tenant — libra é obrigatória para EUA |
| Data | `dd/mm/aaaa` cravado em `fmtData` | formato por locale |

**Por que ALTO e não BLOQUEIA:** um cliente brasileiro a mais funciona sem isto.
Um cliente fora do Brasil, não. O custo cresce com o volume de texto que
continuamos escrevendo em português direto no HTML.

**Skill:** `polyglot` (simota) · **Fase 3**

---

## G3 · SOC 2 / ISO 27001 — **ALTO** (com um item BLOQUEIA dentro)

**O que já existe e conta a favor** (não subestimar isto numa auditoria):

- trilha de auditoria imutável por **trigger de banco** (`carga_revisoes`,
  migração 009) — captura até alteração feita por SQL manual;
- `log_eventos` com `operador_id`, `operador_nome`, `operador_verificado`,
  `ip_origem`, `data_evento`;
- autoria de negócio separada de eco de sincronização (`acao_em/por/setor`,
  migração 026) — distinção que a maioria dos sistemas não tem;
- controle de acesso por setor validado **no servidor**, não só na tela;
- senha com bcrypt; JWT com expiração configurável.

**O que falta:**

| Item | Estado | Severidade |
|---|---|---|
| **Segregação de funções** | Existe por setor, mas **não há revisão periódica de acesso** nem registro de quem concedeu/revogou permissão | ALTO |
| **MFA** | `grep -rn "mfa\|2fa\|totp"` → **0** | **BLOQUEIA** para SOC 2 Tipo II com acesso administrativo |
| **Retenção definida** | Nenhuma política: `log_eventos` e `carga_revisoes` crescem para sempre | ALTO |
| **Logging de acesso a dado** | Loga *mudança*, não *leitura* — SOC 2 quer saber quem consultou dado sensível | MÉDIO |
| **Gestão de chaves** | Segredos em `.env` no servidor, sem rotação documentada | ALTO |
| **Backup testado** | Backup existe (ver `MANUAL_DO_SERVIDOR.md`); **restauração testada e datada, não** | ALTO |

**Skills:** `soc2.skill` + `iso27001.skill` (Sushegaad), `soc2-compliance`
(BagelHole), `comply`/`attest` (simota) · **Fase 3**

---

## G4 · LGPD / GDPR — **BLOQUEIA**

**PII mapeada nesta sessão** (`information_schema.columns`):
`fact_viagens.motorista`, `dim_veiculos.motorista`, `devolucoes.motorista`,
`operadores.nome`, `operadores.email`, `dim_clientes.nome`,
`dim_representantes.nome`, `dim_supervisores.nome`, mais `operador_nome`
replicado em **6 tabelas** (`log_eventos`, `fact_statusfrota`,
`devolucao_itens`, `devolucao_divergencias`, `devolucoes`, `fact_viagens`) e
nas views do Power BI (`vw_dim_carga.Motorista`, `vw_fact_movimentacoes.Motorista`).

**O problema central:** o nome do motorista — pessoa física, frequentemente
terceiro, não empregado — está **denormalizado em 6+ lugares por design**
(decisão correta para relatório fiel: o documento histórico não pode depender do
cadastro atual). Isso torna "direito ao esquecimento" uma operação de várias
tabelas, incluindo tabelas de auditoria que **não deveriam ser editáveis**.

**Tensão real a resolver, não a ignorar:** LGPD manda apagar; SOC 2 manda não
mexer na trilha de auditoria. A saída padrão é **pseudonimização** (trocar o
nome por um identificador estável na trilha, guardando o de-para em cofre
separado com retenção própria) — não é decisão que se toma no meio de uma
migração de banco, é desenho prévio.

**Também falta:** base legal registrada por finalidade, aviso de privacidade,
prazo de retenção por categoria de dado, e procedimento de resposta a titular.

**Skills:** `lgpd.skill` + `gdpr-compliance.skill` (Sushegaad), `cloak` (simota,
detecção de PII) · **Fase 3**

---

## G5 · Observabilidade e o SLA de 3h — **ALTO**

**Resposta direta à pergunta do prompt: a meta de 3h é só exibida em dashboard.
Não é SLO.**

**Evidência:** `grep -rn "prometheus\|opentelemetry\|metrics\|slo" backend/src`
→ 1 ocorrência, e é a palavra "metrics" num comentário. O tempo de pátio é
calculado **no navegador** (`indicadoresDaCarga` em `data.js`), exibido nos
Indicadores e no Raio-X, e morre ali.

**O que falta para virar SLO de verdade:**

| Peça | Hoje | Alvo |
|---|---|---|
| Definição formal | "meta de 3h" em prosa | SLI = p95 do tempo pátio; SLO = 90% das cargas < 3h no mês |
| Janela e orçamento de erro | não existe | orçamento de erro mensal, consumido e visível |
| Alerta | nenhum | queima de orçamento avisa antes do mês fechar |
| Métrica no servidor | cálculo só no cliente | métrica exportada, independente de alguém abrir o painel |
| Tracing | nenhum | correlacionar lentidão de API com etapa de pátio |

**Consequência hoje:** ninguém sabe se a meta piorou nesta semana sem abrir a
tela e comparar no olho. Sem orçamento de erro, "3 horas" é aspiração, não
compromisso — e um comprador corporativo pergunta exatamente isso.

**Skills:** `beacon` (simota), `opentelemetry` + `prometheus-grafana`
(BagelHole) · **Fase 3**

---

## G6 · Interoperabilidade EDI / GS1 — **MÉDIO**

**Evidência:** `grep -rn "EDI\|GS1\|SSCC"` → os 18 hits são **falsos positivos**
(`CAMPOS_EDITAVEIS`, `DEDICADA`). Suporte real: **zero**.

O romaneio e o aviso de embarque hoje são **PDF para humano ler** — excelentes
nisso (auditados nesta sessão, campo a campo). Para embarcador internacional,
faltam as mensagens que máquina lê:

- **DESADV / ASN** (aviso de embarque) — o comprador precisa saber o que vem antes de chegar;
- **SSCC** por palete — identificador global de unidade logística;
- **GTIN** por produto — hoje o código é interno (`dim_produtos.codigo`);
- **GLN** por local — planta, doca, destino.

**Por que MÉDIO:** não bloqueia a operação atual nem a auditoria. Vira ALTO no
dia em que o primeiro cliente exportador entrar — e aí é trabalho de meses, não
de semanas, porque exige identificação nova em cadastro que já tem milhares de
linhas.

**Skill:** `suinco-edi-gs1` — **não existe pronta, será escrita na Fase 4**

---

## G7 · Rastreabilidade sanitária (SIF / lote / país importador) — **ALTO**

**Evidência:** nenhuma tabela tem coluna de **lote**, **SIF** ou **certificado**.
`dim_produtos` guarda `codigo`, `nome`, `peso_caixa_kg`, `ativo`. O elo entre
carga e produto existe hoje **só na devolução** (`devolucao_itens`), não na
carga que sai.

**A lacuna estrutural:** o sistema rastreia o **veículo** com precisão (6 etapas,
lacres, autoria, horário fiel) e **não rastreia o que está dentro dele**. Para
proteína animal exportada isso é o oposto da prioridade regulatória — recall
sanitário se faz por lote, não por placa.

**Falta:** lote no item da carga; SIF do estabelecimento; vínculo
lote → carga → destino → país; requisitos por país importador (China, UE e
Coreia divergem em prazo, temperatura e documento); certificado sanitário
anexável; e a consulta reversa "este lote foi para onde?" — que hoje é
impossível responder.

**Skill:** `suinco-sanitary-traceability` — **não existe pronta, Fase 4**

---

## G8 · Máquina de estados do pátio — **ALTO** *(gap não pedido, encontrado na leitura)*

Registro porque é o coração do sistema e o principal candidato a regressão.

As 6 etapas vivem em `backend/src/dominio/fluxo.js` (`STATUS_FLOW`,
`validarTransicao`) e são validadas no servidor — bom. Mas:

- a **mesma cadeia** está reescrita no front (`data.js`) e **repetida em 4
  suítes de teste** como lista literal — quatro lugares para esquecer de mudar;
- não há **diagrama executável** nem geração da máquina a partir de uma
  definição única;
- o SLA de 3h **não é parte da máquina** — é cálculo posterior, então nenhuma
  transição "sabe" que estourou o prazo;
- exceções reais (segunda carga da mesma placa no dia, encerramento
  administrativo, chegada sem programação) estão como condicionais espalhadas,
  cada uma com sua história de bug — todas documentadas em
  `docs/REGISTRO_DE_OCORRENCIAS.md`.

**Skills:** `weave` (simota) como base para a `suinco-yard-flow` da Fase 4.

---

## Quadro-resumo

| # | Gap | Severidade | Onda sugerida |
|---|---|---|---|
| G1 | Multi-tenancy | **BLOQUEIA** | 1 |
| G4 | LGPD/GDPR (PII do motorista em 6+ tabelas) | **BLOQUEIA** | 1 |
| G3 | SOC 2 / ISO 27001 (MFA bloqueia dentro) | ALTO | 1–2 |
| G5 | SLO de 3h + observabilidade | ALTO | 2 |
| G7 | Rastreabilidade sanitária | ALTO | 2–3 |
| G8 | Máquina de estados única | ALTO | 2 |
| G2 | i18n / l10n | ALTO | 3 |
| G6 | EDI / GS1 | MÉDIO | 3–4 |

---

## Duas pendências que dependem de decisão sua

1. **`ORIGEM E DESTINO DA MIGRAÇÃO` veio em branco no briefing** (`<PREENCHER>`).
   A análise de gaps acima **não depende** disso — mede estado atual contra
   alvos. Mas o `MIGRATION-PLAN.md` (entregável 4) depende: "reescrita vs.
   adaptação" muda completamente se o destino for *manter Node/Express + Postgres
   e endurecer* ou *ir para outra arquitetura*. **Minha recomendação, dado que a
   base é sólida e está em produção com 5 setores ao vivo: manter a stack e
   migrar por camadas** (tenant → privacidade → SLO → domínio), sem big bang.
   Confirme ou corrija antes da Fase 4.

2. **Multi-tenancy e placa compartilhada** (G1): decidir se a frota é por tenant
   ou global com vínculo. É decisão de produto e muda o schema.

**Próximo passo:** Fase 2 — instalar a fundação de engenharia, cada skill
amarrada a um gap desta lista. Os 8 repositórios do briefing foram testados e
**todos estão acessíveis**.
