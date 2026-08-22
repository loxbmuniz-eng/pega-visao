# MIGRATION-PLAN — Embarque Suinco → produto global, em ondas

**Data:** 21/08/2026 · Fundamentado em `MIGRATION-GAPS.md` e `SKILLS-AUDIT.md`.

## Premissa que governa o plano inteiro

**O sistema está em produção, é sólido e não será reescrito.** Cinco setores ao
vivo, 260 testes de servidor e 95 suítes de navegador verdes, trilha de auditoria
por trigger, revisões com restauração, sincronia em tempo real com fila offline,
relatórios auditados campo a campo. Isso é ativo, não legado.

Portanto o padrão de migração é **Strangler Fig**: cada onda adiciona uma camada
ao redor do que existe, com o antigo funcionando até a nova camada provar
equivalência. Nenhuma onda tem janela de parada. Nenhuma onda exige que a
operação mude de hábito no mesmo dia.

> **Campo `ORIGEM E DESTINO DA MIGRAÇÃO` veio em branco no briefing.** Assumo,
> e recomendo: **destino = mesma stack (Node/Express + PostgreSQL + painel de
> arquivo único), endurecida e ampliada.** Trocar de stack agora jogaria fora
> justamente o que dá vantagem — a trilha de auditoria por trigger, a sincronia
> testada em campo e o conhecimento operacional embutido em cada exceção.
> **Corrija-me antes da Onda 1 se o destino for outro**; o restante do plano
> muda pouco, mas o "reescrita vs. adaptação" de cada item muda muito.

## Como ler cada onda

Cada onda: **gap que a justifica** · **skills que a conduzem** · **o que é
adaptação vs. reescrita** · **como se sabe que terminou**. As ondas 1 e 2 são
sequenciais entre si; da 3 em diante há paralelismo possível.

---

## ONDA 0 — Fundação de verdade (1 a 2 semanas)

**Gap:** nenhum diretamente. É o que torna as outras ondas seguras.

**Skills:** `spec-driven-development`, `writing-plans`, `deprecation-and-migration`

Antes de tocar em schema, três coisas precisam existir:

1. **Spec escrita para G1 e G4** — multi-tenancy e pseudonimização de PII são
   decisões que, erradas, exigem migração retroativa de tabela de auditoria.
   Spec antes de migração, sempre.
2. **Restauração de backup testada e datada.** Existe backup; não existe prova
   de que restaura. Toda onda seguinte mexe em schema de produção — sem
   restauração provada, não se começa. *(Também é item de SOC 2.)*
3. **Ambiente de homologação com cópia anonimizada** do banco. Hoje o teste
   local usa banco descartável com dados sintéticos; migração de tenant precisa
   ensaiar contra volume real.

**Terminou quando:** existe spec revisada de G1 e G4, um restore completo
executado e cronometrado, e um ambiente de homologação de pé.

**Reescrita vs. adaptação:** nada de produção é tocado. 100% adição.

---

## ONDA 1 — Multi-tenancy e privacidade (G1 + G4, os dois BLOQUEIA)

**Por que juntas:** as duas mexem em **todas** as tabelas. Fazer separadamente
significa migrar `fact_viagens`, `log_eventos` e `carga_revisoes` duas vezes — e
cada migração de tabela de auditoria é uma pergunta a mais do auditor.

**Skills:** `schema` (RLS, roteamento por tenant), `cloak` (mapa de PII),
`lgpd` + `gdpr-compliance`, `spec-driven-development`, `security-and-hardening`

### 1a. Tenant (G1 · BLOQUEIA)

- `tenant_id` em todas as tabelas de dado e de auditoria, com **RLS do
  PostgreSQL** — não filtro na aplicação. Filtro em aplicação esquece uma
  consulta; RLS não esquece.
- Backfill: tudo que existe hoje vira **tenant 1 = Suinco**. Migração de uma
  linha por tabela, reversível.
- **Decisão de produto pendente (sua):** `dim_veiculos` é por tenant ou global
  com vínculo? A placa é a chave natural do dia a dia e o mesmo caminhão atende
  vários embarcadores. **Recomendo global com vínculo por tenant** — evita
  duplicar frota e preserva o histórico de 2 anos já carregado.
- `ledger` entra aqui: custo por tenant desde o primeiro dia, senão o preço do
  produto sai do chute.

### 1b. Privacidade (G4 · BLOQUEIA)

- **Pseudonimizar o motorista na trilha.** O nome está denormalizado em 6+
  tabelas — por decisão correta de relatório fiel. A saída é identificador
  estável na trilha + de-para em cofre com retenção própria. Resolve a tensão
  LGPD (apagar) × SOC 2 (não mexer na auditoria) sem sacrificar nenhum dos dois.
- Base legal por finalidade, prazo de retenção por categoria, procedimento de
  resposta a titular. **Documento, não código** — e é o que o auditor lê primeiro.

**Terminou quando:** um segundo tenant de teste opera no mesmo banco sem
enxergar uma linha do primeiro (provado por teste, não por inspeção); e existe
um caminho executável de "esquecer este motorista" que não corrompe a trilha.

**Reescrita vs. adaptação:** **adaptação profunda.** O schema ganha coluna e
política; a lógica de negócio permanece. As rotas mudam pouco — RLS trabalha
por baixo. Reescrita real: nenhuma.

---

## ONDA 2 — O SLA de 3h vira compromisso (G5) + máquina única (G8)

**Por que juntas:** o SLO precisa de eventos confiáveis de transição, e a
definição única da máquina é o que garante que "entrou no pátio" significa a
mesma coisa em todo lugar.

**Skills:** `beacon`, `opentelemetry`, `prometheus-grafana`,
`observability-and-instrumentation`, `weave`, **`suinco-yard-flow`**

- **SLI/SLO formais:** p95 do tempo entre entrada e saída, por tenant e unidade;
  90% abaixo de 3h no mês; orçamento de erro visível e alerta por queima.
- **Métrica emitida pelo servidor** — hoje o cálculo mora no navegador
  (`indicadoresDaCarga`) e morre quando ninguém abre a tela.
- **Definição única da máquina de estados**, gerando servidor, cliente e
  diagrama. Hoje a cadeia está em `fluxo.js`, em `data.js` e **repetida em 4
  suítes de teste** — quatro lugares para esquecer.
- **O SLA entra na máquina**: a transição sabe que estourou o prazo, em vez de
  alguém descobrir depois no relatório.

**Terminou quando:** o gestor recebe alerta de queima de orçamento **antes** do
mês fechar, sem abrir o painel; e adicionar uma etapa exige mudar **um** lugar.

**Reescrita vs. adaptação:** instrumentação é **adição pura**. A máquina de
estados é a **única reescrita real do plano** — e é reescrita de ~200 linhas
bem testadas, com a suíte atual servindo de rede.

---

## ONDA 3 — Domínio: o que está dentro do caminhão (G7)

**Skills:** **`suinco-sanitary-traceability`**, `schema`, `spec-driven-development`

O sistema rastreia o veículo e não rastreia o produto. Para proteína animal isso
é o inverso da prioridade regulatória — recall se faz por lote.

- **Lote no item da carga**, N:N com a carga (um caminhão leva vários lotes; um
  lote vai em vários caminhões).
- SIF, validade e faixa de temperatura gravados **junto** (snapshot), pela mesma
  lição de `produto_nome`/`cliente_nome`.
- Imutabilidade após `Seguiu Viagem`, com caminho de correção auditável.
- Habilitação por país **com vigência** — bloquear embarque não habilitado.

**Terminou quando** as três perguntas respondem por consulta, em minutos:
*este lote foi para onde?* · *esta carga levou quais lotes?* · *quais lotes
estão em trânsito agora?*

**Reescrita vs. adaptação:** **adição.** O elo produto↔carga já existe do lado
da devolução (`devolucao_itens`); falta do lado da saída.

---

## ONDA 4 — Certificação (G3)

**Skills:** `soc2`, `iso27001`, `security-and-hardening`, `attest`

Muita coisa já está pronta e conta a favor: trilha imutável por trigger, autoria
de pessoa separada de eco, controle por setor validado no servidor, bcrypt, JWT
com expiração. O que falta:

- **MFA para acesso administrativo** — o único item BLOQUEIA dentro de G3;
- revisão periódica de acesso, com registro de quem concedeu e revogou;
- política de retenção (hoje `log_eventos` e `carga_revisoes` crescem para
  sempre);
- rotação de segredo documentada;
- logging de **acesso a dado**, não só de mudança.

**Terminou quando:** existe SoA preenchida, evidência coletada por controle, e
um auditor externo consegue percorrer a lista sem depender de explicação verbal.

**Reescrita vs. adaptação:** **adição + documento.** MFA é feature nova; o resto
é política e coleta de evidência.

---

## ONDA 5 — Internacionalização (G2)

**Skills:** `polyglot`

- Extrair as ~54 formatações `pt-BR` e os literais de tela para catálogo;
- fuso **por tenant** (hoje `America/Sao_Paulo` cravado em 8 pontos do servidor);
- unidade de peso por tenant (kg/lb — libra é obrigatória para EUA);
- moeda, quando houver faturamento internacional.

**Terminou quando:** trocar o locale do tenant muda data, número, peso e rótulo
sem tocar em código.

**Reescrita vs. adaptação:** **adaptação mecânica e ampla** — muitos arquivos,
baixo risco por arquivo. Boa candidata a codemod (`shift`).

---

## ONDA 6 — Interoperabilidade (G6)

**Skills:** **`suinco-edi-gs1`**, `api-and-interface-design`, `gateway`

- GTIN/GLN no cadastro, com dígito verificador validado;
- **SSCC por palete** — o mesmo elo da Onda 3, motivo pelo qual as duas
  compartilham modelagem;
- DESADV/ASN primeiro (o dado já existe quase todo), depois RECADV, depois
  INVOIC.

**Terminou quando:** um parceiro real recebe o aviso de embarque sem ninguém
redigitar.

**Reescrita vs. adaptação:** **adição.** O PDF continua — duas saídas da mesma
fonte, nunca duas montagens paralelas.

---

## Ordem e paralelismo

```
Onda 0 ──▶ Onda 1 (G1+G4) ──▶ Onda 2 (G5+G8) ──┬──▶ Onda 3 (G7) ──▶ Onda 6 (G6)
                                                ├──▶ Onda 4 (G3)
                                                └──▶ Onda 5 (G2)
```

- **0 → 1 → 2 é sequencial e inegociável.** Tenant antes de tudo (dado que entra
  sem `tenant_id` vira migração retroativa); SLO depois de eventos confiáveis.
- **3, 4 e 5 correm em paralelo** depois da 2 — tocam áreas diferentes.
- **6 depende da 3**: SSCC e lote modelam o mesmo palete.

## O que NÃO está no plano, de propósito

Kubernetes, GitOps, troca de stack, microsserviços, reescrita de front. Nenhum
resolve um gap da Fase 1. O sistema roda em uma VPS com systemd e atende 5
setores com folga; trocar isso agora é substituir problema conhecido por
problema desconhecido, no meio de uma migração que já mexe em todas as tabelas.

---

# Ranking final das skills por impacto esperado

Critério: **quanto cada skill move o ponteiro** em SLA de 3h no pátio,
confiabilidade do faturamento e prontidão para auditoria. Escala: ●●● alto ·
●● médio · ● baixo/indireto.

| # | Skill | SLA 3h | Faturamento | Auditoria | Por quê |
|---|---|:---:|:---:|:---:|---|
| 1 | **`suinco-yard-flow`** | ●●● | ●●● | ●●● | única que carrega as 5 exceções que já causaram incidente e a regra dos "três pontos". Toca as três frentes porque **é** o fluxo |
| 2 | **`beacon`** | ●●● | ● | ●● | transforma a meta de 3h de aspiração em compromisso com orçamento de erro. Sem ela, ninguém sabe que piorou |
| 3 | **`schema`** | ● | ●● | ●●● | destrava multi-tenancy (G1 BLOQUEIA). RLS é o que um auditor aceita como isolamento |
| 4 | **`cloak` + `lgpd` + `gdpr-compliance`** | — | ● | ●●● | G4 BLOQUEIA. Resolve a tensão apagar × não mexer na trilha |
| 5 | **`suinco-sanitary-traceability`** | ● | ●●● | ●●● | recall por lote. Hoje a pergunta do fiscal não tem resposta |
| 6 | **`spec-driven-development`** | ●● | ●● | ●● | multiplicador: erro de spec em schema custa migração retroativa |
| 7 | **`opentelemetry` + `prometheus-grafana`** | ●●● | ● | ●● | a métrica que sai do navegador e passa a existir sem ninguém olhando |
| 8 | **`soc2` + `iso27001`** | — | ● | ●●● | certificação é o produto desta linha; MFA é o bloqueio a remover |
| 9 | **`weave`** | ●● | ●● | ●● | base da #1; sozinha é genérica, com a #1 é cirúrgica |
| 10 | **`deprecation-and-migration`** | ● | ●● | ●● | Strangler Fig — é o que mantém a operação de pé durante as ondas |
| 11 | **`security-and-hardening`** | — | ●● | ●●● | MFA, segredos, rotação |
| 12 | **`suinco-edi-gs1`** | ● | ●●● | ●● | mata a redigitação, que é onde nasce divergência de nota |
| 13 | **`shift`** | ● | ● | ● | codemods e verificação de equivalência — acelera 5 e 2 |
| 14 | **`observability-and-instrumentation`** | ●● | ●● | ●● | complementa 2 e 7 no nível de código |
| 15 | **`api-and-interface-design`** | — | ●● | ●● | contrato estável quando entra parceiro externo |
| 16 | **`code-review-and-quality`** | ● | ●● | ●● | rede de proteção em código de produção |
| 17 | **`polyglot`** | — | ● | ● | G2 é ALTO por acúmulo de dívida, não por urgência |
| 18 | **`trail`** | ● | ● | ●● | arqueologia — útil quando a Onda 2 encostar em regressão antiga |
| 19 | **`ledger`** | — | ●● | ● | custo por tenant: define preço, não operação |
| 20 | **`attest`** | — | ● | ●● | verificação adversarial de conformidade a spec |

**As três de maior impacto imediato no que você mede hoje:**
`suinco-yard-flow` (protege o fluxo em produção), `beacon` (o SLA vira
compromisso) e `schema` (destrava o produto multi-tenant). As três de maior
impacto na venda futura: `lgpd`/`gdpr`, `soc2`/`iso27001` e
`suinco-sanitary-traceability`.

## Duas decisões suas antes da Onda 1

1. **Confirmar o destino da migração** (o campo em branco do briefing). Minha
   recomendação está no topo: mesma stack, endurecida.
2. **`dim_veiculos` por tenant ou global com vínculo?** Recomendo global com
   vínculo — preserva 2 anos de histórico de frota e não duplica placa.
