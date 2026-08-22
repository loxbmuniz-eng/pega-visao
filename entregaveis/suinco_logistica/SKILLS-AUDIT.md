# SKILLS-AUDIT — o que foi instalado, adaptado, descartado e por quê

**Data:** 21/08/2026 · Fases 2, 3 e 4 · Destino único: `.claude/skills/` deste
projeto. **Nada instalado globalmente. Nenhum código de produção alterado.**

Regra aplicada em toda linha: **skill instalada aponta para um gap do
`MIGRATION-GAPS.md`.** Skill sem gap correspondente não entrou, por mais
interessante que fosse.

**Acesso aos repositórios:** os 8 do briefing foram testados com
`git ls-remote` antes de qualquer clone. **Todos acessíveis** — nenhum link
quebrado a reportar.

---

## Fase 2 — Fundação de engenharia

### obra/superpowers — **as 4 já estavam instaladas**

Achado que muda o trabalho: `.claude/skills/` **já continha** as quatro, e elas
também vêm pelo plugin `superpowers` v6.2.0. Diferença medida por `diff`:

| Skill | Resultado | Decisão |
|---|---|---|
| `test-driven-development` | idêntica ao upstream | mantida como está |
| `systematic-debugging` | idêntica ao upstream | mantida como está |
| `verification-before-completion` | idêntica ao upstream | mantida como está |
| `writing-plans` | **local 3 linhas menor** | **atualizada** para o upstream |

As 3 linhas novas em `writing-plans` ligam o plano ao **spec** que o origina —
exatamente o encaixe com `spec-driven-development`, instalada nesta sessão.
Atualizar foi barato e removeu incoerência entre as duas.

**Duplicata registrada:** plugin `superpowers` (global) × `.claude/skills/`
(projeto) — as mesmas 14 skills em dois lugares. Não removi as do projeto:
projeto que carrega a própria cópia sobrevive a alguém desinstalar o plugin. Vale
uma decisão futura sua; não é problema ativo.

### addyosmani/agent-skills — 6 instaladas

| Skill | Gap | Por quê |
|---|---|---|
| `deprecation-and-migration` | todos | **prioritária no briefing.** Esta é migração, não projeto novo: Strangler Fig, convivência de versões, sunset com prazo |
| `spec-driven-development` | G1, G4, G7 | **prioritária.** Multi-tenancy, pseudonimização de PII e lote N:N são decisões de schema — errar exige migração retroativa |
| `api-and-interface-design` | G1, G6 | API vira multi-tenant e ganha parceiro externo; contrato estável deixa de ser luxo |
| `security-and-hardening` | G3, G4 | MFA, gestão de segredo, rotação — trata PII/GDPR explicitamente |
| `observability-and-instrumentation` | G5 | o SLA de 3h precisa virar instrumento antes de virar SLO |
| `code-review-and-quality` | G8 | revisão multi-eixo em cima de código em produção |

**Duplicata:** `code-review-and-quality` (addyosmani) × `/code-review` (built-in
do ambiente). Mantive as duas: a built-in é comando operacional de diff; a de
addyosmani é método de revisão por eixos. Registrado.

### anthropics/skills — 1 instalada, 2 descartadas com motivo

| Skill | Decisão |
|---|---|
| `skill-creator` | **instalada** — ferramenta da Fase 4 |
| `xlsx` | **não instalada** — já disponível no ambiente. Duplicar 1,3 MB sem ganho |
| `pdf` | **não instalada** — idem. E a geração de PDF do sistema é própria (Playwright + `gerarPdf`), auditada |

---

## Fase 3 — Camada de nível global

### simota/agent-skills — 4 dos nomes do briefing não existem

O briefing avisou que a estrutura varia e mandou procurar pelo `SKILL.md`. O
repositório tem **89 skills** com nomes de uma palavra. Quatro pedidos não
existem sob aquele nome; achei o equivalente por conteúdo, **não inventei
caminho**:

| Pedido | Existe? | Instalado no lugar | Evidência |
|---|---|---|---|
| `shard` | **não** | **`schema`** | descrição própria: *"multi-tenant architecture: RLS, tenant routing, provisioning, quotas, and isolation"* |
| `fossil` | **não** | **`trail`** | *"code archaeology. Time-travels through commits"* |
| `horizon` | **não** | **`shift`** (+ `atlas` avaliada) | `shift` cobre *"migrations, upgrades, and modernization"* |
| `comply` | **não** | **`attest`** + as 4 GRC do Sushegaad | `attest` é conformidade **a spec**; regulatório vem das GRC |

Instaladas (8):

| Skill | Gap | Papel |
|---|---|---|
| `schema` | **G1 BLOQUEIA** | multi-tenancy: RLS, roteamento por tenant, isolamento, cotas |
| `cloak` | **G4 BLOQUEIA** | detecção de PII, mapa de fluxo de dado, DPIA — o motorista em 6+ tabelas |
| `polyglot` | G2 | extrair string literal, `Intl` para data/moeda/número |
| `beacon` | G5 | SLO/SLI, tracing, alerta — transforma "meta de 3h" em compromisso |
| `weave` | G8 | máquina de estados — **base da `suinco-yard-flow`**, como o briefing pediu |
| `shift` | todos | orquestração da migração, Strangler Fig, verificação de equivalência |
| `trail` | G8 | arqueologia de git — o sistema tem incidentes documentados a cruzar |
| `ledger` | G1 | FinOps: custo **por tenant**. Multi-tenancy sem custo por tenant é preço no chute |

**Não instaladas** (sem gap correspondente): `gateway` — sobreposta a
`api-and-interface-design`, que é 34% mais longa e já cobria o gap; e `stream`
(pipelines ETL) — o export para Power BI existe e funciona, não há gap aberto.
As outras ~79 do repositório não foram avaliadas: nenhum gap as pedia.

### Sushegaad/GRC — 4 instaladas de 15 disponíveis

Os arquivos `.skill` são **ZIP**; extraí e instalei o conteúdo.

| Skill | Gap |
|---|---|
| `lgpd` | **G4 BLOQUEIA** — inclui adequação mútua Brasil-UE (jan/2026) |
| `gdpr-compliance` | **G4 BLOQUEIA** — auditoria de código, DPA, base legal |
| `soc2` | G3 — os 5 Trust Services Criteria, evidência, política |
| `iso27001` | G3 — SoA, Anexo A, registro de risco |

Descartadas as outras 11 (HIPAA, PCI, CMMC, FedRAMP, NIST 800-53, DORA, NZISM,
DPDPA, CCPA, EU CRA, ISO 42001): nenhum gap as pede. PCI só entraria se o
sistema processasse cartão — não processa.

### BagelHole/DevOps — 2 instaladas de 5 pedidas

| Pedida | Decisão |
|---|---|
| `opentelemetry` | **instalada** — G5, tracing e métrica no servidor |
| `prometheus-grafana` | **instalada** — G5, PromQL e alerta de queima de orçamento |
| `kubernetes-ops` | **não instalada** — o sistema roda em **uma VPS com systemd**. Kubernetes não é gap; seria resposta a uma pergunta que ninguém fez |
| `argocd-gitops` | **não instalada** — idem: GitOps sem cluster é cerimônia |
| `soc2-compliance` | **não instalada** — duplicata da `soc2` do Sushegaad, que é mais completa (5 TSC vs. checklist). **Duplicata registrada** |

### nexu-io/open-design — avaliada, não instalada

Prioridade baixa no próprio briefing. O sistema **já tem** design system
estabelecido, auditado e em produção: paleta navy/dourado, tema claro/escuro por
token, ícones SVG próprios, contraste verificado, movimento com
`prefers-reduced-motion`. Instalar um design system genérico aqui competiria com
o que existe. **Nenhum gap de design foi levantado na Fase 1.**

### kishorkukreja/awesome-supply-chain — consultado, nada instalado

É **lista curada de links**, não coleção de skills — não há `SKILL.md` para
instalar, e o briefing já mandava "adapte só o que servir, não instale o
repositório inteiro". Consultado para VRP, wave planning e slotting: **nenhum
dos três serve ao fluxo de pátio atual** — o Suinco não roteiriza (rota vem
pronta do cadastro), não faz wave planning (a programação é por caminhão) e não
faz slotting (não há armazém endereçado no escopo). Registrado como avaliado e
descartado por não-aderência, não por inacessibilidade.

---

## Fase 4 — As 3 skills de domínio, escritas do zero

Escritas com a `skill-creator`, em português, com as entidades reais: **carga,
veículo, etapa de pátio, romaneio, devolução, nota fiscal, setor, SLA de 3h,
lote, SIF, tenant**.

| Skill | Gap | Base | O que carrega |
|---|---|---|---|
| `suinco-yard-flow` | **G8 + G5** | `weave` | as 6 etapas com o fato real de cada uma, transições por setor, os **três relógios** que não se confundem, as 5 exceções que já custaram incidente, checklist dos "três pontos" |
| `suinco-edi-gs1` | G6 | — | GTIN/SSCC/GLN contra o cadastro atual, ordem DESADV→RECADV→INVOIC, e a regra de **não inventar layout** sem a spec do parceiro |
| `suinco-sanitary-traceability` | **G7** | — | lote N:N com a carga, SIF, imutabilidade pós-saída, habilitação por país com vigência, e as **três perguntas** que validam o desenho |

Cada uma termina com checklist verificável e uma seção explícita de **não
invente** — layout EDI e regra sanitária mudam por parceiro e por país; dado bem
modelado sobrevive, mapeamento adivinhado não.

---

## Teste executado

| Teste | Resultado |
|---|---|
| Alcance dos 8 repositórios (`git ls-remote`) | **8/8 OK** |
| Caminho de cada skill pedida existe | 24 OK · **4 ausentes** (`shard`, `fossil`, `horizon`, `comply`) — substituídas com evidência |
| Frontmatter `name` + `description` nas 45 | **45/45 válidas** |
| Nome do frontmatter = nome da pasta | **45/45 batem** |
| Carregamento no ambiente | as 3 de domínio + as da Fase 3 apareceram na lista de skills disponíveis **na mesma sessão** — prova de carregamento real, não só de arquivo escrito |

**Total:** 21 skills pré-existentes + **24 instaladas/escritas** = **45**.

---

## Duplicatas registradas (nenhuma removida sem aviso)

| Duplicata | Decisão |
|---|---|
| superpowers plugin × `.claude/skills/` (14 skills) | mantidas ambas; cópia do projeto sobrevive à remoção do plugin |
| `code-review-and-quality` × `/code-review` built-in | mantidas: método × comando |
| `soc2` (Sushegaad) × `soc2-compliance` (BagelHole) | **só a do Sushegaad** — 5 TSC contra checklist |
| `gateway` × `api-and-interface-design` | **só addyosmani** — mais completa |
| `gdpr-compliance` (Sushegaad) × idem (BagelHole) | **só Sushegaad** |
| `xlsx`/`pdf` (anthropics) × built-in do ambiente | **built-in**; não duplicar 1,4 MB |

## Não instalado, por decisão consciente

`kubernetes-ops`, `argocd-gitops` (não há cluster), `stream`, `gateway`,
`soc2-compliance`, `xlsx`, `pdf`, open-design inteiro, 11 GRC de outros
regimes, ~79 skills do simota. **Motivo comum: nenhum gap da Fase 1 as pedia.**
Instalar tudo transformaria a pasta em depósito — e skill que não dispara
quando devia é pior que skill ausente, porque dá sensação de cobertura.
