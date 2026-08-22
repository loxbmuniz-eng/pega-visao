# Capability Map — Onda 1 (multi-tenancy + privacidade)

**Gate:** este mapa é revisado ANTES de qualquer spec de módulo ser escrita.
Rever 12 linhas é barato; errar fronteira de módulo é caro.

## Assunções que estou fazendo — corrija agora ou sigo com elas

1. **Stack mantida e endurecida** (confirmado por você): Node/Express +
   PostgreSQL 16 + painel de arquivo único. Nenhuma troca de framework.
2. **Multi-tenant no MESMO banco**, isolado por Row-Level Security do
   PostgreSQL — não um banco por cliente. Um banco por cliente resolveria
   isolamento e destruiria a economia do produto (backup, migração e deploy
   multiplicados por cliente).
3. **Suinco vira `tenant_id = 1`** no backfill. Nada da operação atual muda de
   comportamento no dia da migração.
4. **"Power BI plug and play"** eu li como: (a) o modelo que já existe continua
   funcionando **sem refazer medida nenhuma** — mesmas views, mesmos nomes de
   coluna, mesma URL; e (b) **tenant novo liga o Power BI sozinho**, com token
   próprio, sem ninguém escrever SQL nem criar view. Se você quis dizer outra
   coisa, é aqui que muda.
5. **`dim_veiculos` fica GLOBAL com vínculo por tenant** — a placa é chave
   natural compartilhada (o mesmo caminhão atende vários embarcadores) e há 2
   anos de histórico carregado. Você não escolheu explicitamente entre as duas
   opções; assumo esta, que era minha recomendação, porque é a única que
   preserva o histórico sem duplicar frota.
6. **Sem janela de parada.** Toda migração é reversível e aplicada com o sistema
   no ar.

## Os módulos

| Módulo id | Responsabilidade | Depende de |
|---|---|---|
| `tenant-core` | `tenant_id` nas tabelas, RLS, contexto de sessão, provisionamento de tenant, backfill do tenant 1 | — |
| `bi-tenant-token` | Power BI plug and play: token por tenant, views que se filtram sozinhas, colunas inalteradas | `tenant-core` |
| `pii-vault` | Pseudonimização do motorista na trilha, cofre de-para, retenção, resposta a titular | `tenant-core` |

**Ordem de construção:** `tenant-core` → depois `bi-tenant-token` e `pii-vault`
**em paralelo** (tocam áreas diferentes: um a borda de leitura, outro a trilha).

## Por que três e não um

Cada um é testável e cortável sozinho:

- `tenant-core` sem os outros: dois tenants operam isolados no painel. Testável.
- `bi-tenant-token`: "token A no Power BI enxerga só as linhas do tenant A, com
  os mesmos nomes de coluna de hoje". Testável sem tocar em PII.
- `pii-vault`: "esquecer o motorista X não corrompe a trilha de auditoria".
  Testável com um tenant só.

Spec única para os três forçaria toda tarefa a raciocinar sobre o contrato
inteiro — e a de PII tem um conflito próprio (LGPD manda apagar, SOC 2 manda não
mexer na trilha) que merece documento dedicado.

## Por que `bi-tenant-token` é módulo, e não detalhe do `tenant-core`

Porque tem **consumidor próprio** (o analista de BI, não o operador) e um
requisito que pode falhar sozinho: *"o modelo atual continua funcionando sem
refazer medida"*. É exatamente onde RLS costuma quebrar integração — a conexão
do BI não tem sessão de usuário, então ou vê tudo (vazamento entre clientes) ou
vê nada (relatório vazio). Módulo separado força esse caso a ter aceite próprio.
