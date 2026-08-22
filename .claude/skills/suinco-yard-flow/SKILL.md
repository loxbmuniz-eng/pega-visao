---
name: suinco-yard-flow
description: "A máquina de estados do pátio Suinco — as 6 etapas da carga, transições válidas por setor, o SLA de 3 horas e as regras de auditoria de mudança de status. Use ao mexer em qualquer coisa que crie carga, mude status, calcule tempo de pátio, escreva na trilha de auditoria, ou ao investigar 'a carga travou/sumiu/voltou'. Também ao adicionar etapa, setor ou exceção ao fluxo."
---

# Fluxo de pátio — Embarque Suinco

Base: skill `weave` (máquinas de estado). Aqui ela vira concreta: as entidades
são **carga**, **veículo (placa)**, **etapa de pátio**, **setor**, **romaneio**,
**devolução**, **nota fiscal**, **lote**, **SIF** e **tenant**.

## A máquina, em uma tela

```
Aguardando Veículo → Aguardando Embarque → Embarque Iniciado
                   → Embarque Finalizado → Faturado → Seguiu Viagem
```

| Etapa | Quem move | Fato do mundo real |
|---|---|---|
| Aguardando Veículo | Logística (programa) | carga existe no papel, caminhão não chegou |
| Aguardando Embarque | Portaria ("Chegou") | veículo **entrou no pátio** — início do relógio de 3h |
| Embarque Iniciado | Expedição | carregamento começou na doca |
| Embarque Finalizado | Expedição | carregamento terminou |
| Faturado | Faturamento | nota fiscal emitida |
| Seguiu Viagem | Portaria ("Saiu") | veículo **saiu** — fim do relógio, lacres registrados |

**Fonte da verdade:** `backend/src/dominio/fluxo.js` (`STATUS_FLOW`,
`validarTransicao`, `camposEditaveisPor`). A validação é **do servidor**. A tela
é otimista e pode estar adiantada — nunca conclua nada a partir do que o painel
mostra; consulte `fact_viagens.status_atual`.

## Regras que não se negociam

1. **Transição só avança.** Voltar etapa não é transição — é `corrigir-etapa`,
   rota separada, com motivo obrigatório e registro de quem corrigiu.
2. **Setor decide, e o servidor confere.** Expedição não fatura; Faturamento
   não dá saída. Esconder o botão na tela não é controle — a rota valida.
3. **Toda mudança real vira revisão**, por trigger de banco
   (`carga_revisoes`, migração 009) — inclusive SQL manual. Nunca contorne o
   trigger com escrita direta.
4. **Autoria de pessoa ≠ carimbo de sistema.** `acao_em/acao_por/acao_setor`
   (migração 026) só mudam quando um campo de negócio muda; `atualizado_em` e
   `versao` sobem em todo eco de sincronização. Usar `atualizado_em` como "quem
   mexeu" foi bug real: a Torre inteira aparecia com o mesmo horário.
5. **Eco não apaga.** Campo que o painel reenvia vazio usa
   `COALESCE(NULLIF($n,''), coluna)`. Lacre gravado pela Portaria já foi apagado
   por eco uma vez.
6. **Excluída ≠ inexistente.** `excluida_em` marca; a linha permanece. Toda
   consulta de operação filtra `excluida_em IS NULL`; toda consulta de
   **controle** (Controle da Programação) inclui as canceladas de propósito.

## O SLA de 3 horas

**Estado atual: é métrica exibida, não SLO.** Hoje `indicadoresDaCarga()`
(`data.js`) calcula no navegador; ninguém é alertado quando estoura.

Ao trabalhar no SLA, o alvo é (ver `MIGRATION-GAPS.md` G5, skill `beacon`):

- **SLI**: p95 do tempo entre `Aguardando Embarque` (entrada) e `Seguiu Viagem`
  (saída), por tenant e por unidade;
- **SLO**: 90% das cargas abaixo de 3h no mês corrente;
- **orçamento de erro** consumido e visível, com alerta por queima;
- métrica emitida **pelo servidor**, não dependente de alguém abrir a tela.

**Não confunda os três relógios** — errar isso já produziu bug em produção:

| Relógio | Começa | Não é |
|---|---|---|
| Tempo de pátio (SLA) | entrada real do veículo | criação do registro |
| Lead time | criação da carga | tempo de pátio |
| Data de programação | dia para o qual foi programada | dia em que foi digitada |

`entradaNoPatioDe(c)` (app.js) é a função que sabe a diferença: lê o evento
'Aguardando Embarque' da trilha; sem chegada registrada devolve `null` — e
`null` é resposta legítima ("o caminhão não chegou"), nunca preencher com a
data de criação.

## Exceções que já custaram incidente

Cada uma tem teste de guarda. Antes de mexer, leia
`docs/REGISTRO_DE_OCORRENCIAS.md`.

- **Segunda carga da mesma placa no mesmo dia** — legítima (caminhão faz duas
  viagens). A trava de reentrada compara o **dia da programação**, não a
  existência de carga aberta. Regressão real relatada pelo programador de
  embarque.
- **Chegada sem programação** — a Portaria registra veículo que apareceu sem
  carga programada (`aguardando_carga = TRUE`), por **rota própria**
  (`POST /api/portaria/chegada`). Não entra em consulta de programação: nunca
  foi programado.
- **Encerramento administrativo** — Logística fecha pendências de dias
  anteriores com motivo obrigatório; nunca cargas do dia corrente.
- **Retenção de lacre** — fato da inspeção com quatro elementos em campos
  próprios: número, motivo, autor, hora (migração 027). Nunca frase dentro de
  `observacoes`.
- **Até 3 lacres na saída** — `lacre`, `lacre_2`, `lacre_3`.

## Antes de dar por pronto

- [ ] O campo novo existe nos **três pontos**: ida (`data.js sincronizarCarga`),
      volta (`suinco-api.js daApiParaLinha`) e conversão
      (`data.js cargaDeLinhaRemota`). Faltando um, o dado **some sem erro**.
- [ ] A transição foi validada no servidor, não só na tela.
- [ ] O eco de sincronização não apaga o que foi gravado (teste explícito).
- [ ] A trilha registra autoria de **pessoa**, não carimbo de sistema.
- [ ] Teste dirigido pelo **estado do servidor** (SQL), com re-tentativa —
      nunca por lista cega de cliques: a fila de sincronização gera corrida.
- [ ] `excluida_em IS NULL` em toda consulta de operação.

## Ao evoluir o fluxo (multi-tenant, etapa nova)

A cadeia está **replicada**: servidor (`fluxo.js`), front (`data.js`) e 4 suítes
de teste como lista literal. Adicionar etapa exige tocar em todos — é o gap G8.
Alvo: definição única, gerando servidor, cliente e diagrama. Ao chegar em
multi-tenant, a cadeia passa a ser **por tenant** (nem todo cliente tem 6
etapas), o que reforça a definição única como pré-requisito, não luxo.
