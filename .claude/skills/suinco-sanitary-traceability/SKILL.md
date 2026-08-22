---
name: suinco-sanitary-traceability
description: "Rastreabilidade de lote, registro SIF e certificação por país importador para proteína suína no Embarque Suinco. Use ao trabalhar com lote, validade, temperatura, SIF, certificado sanitário, recall, ou ao ligar produto à carga que sai. Também ao planejar exportação ou responder 'este lote foi para onde?'."
---

# Rastreabilidade sanitária — o que está dentro do caminhão

## O diagnóstico, sem rodeio

O Suinco rastreia o **veículo** com precisão rara: 6 etapas, autoria por pessoa,
horário fiel, lacres, trilha imutável por trigger. E **não rastreia o produto
que está dentro dele** — não existe coluna de lote, SIF ou certificado em
nenhuma das 19 tabelas (verificado, `MIGRATION-GAPS.md` G7).

Para proteína animal isso é o inverso da prioridade regulatória: **recall
sanitário se faz por lote, não por placa.** Hoje a pergunta "o lote X foi para
quais clientes?" é impossível de responder pelo sistema — e é a primeira
pergunta do fiscal e do comprador.

Detalhe revelador: o elo produto↔carga **já existe na devolução**
(`devolucao_itens` tem produto, quantidade, peso, cliente) e **não existe na
carga que sai**. O sistema sabe o que **voltou** e não sabe o que **foi**.

## O que precisa existir

| Elemento | Por quê |
|---|---|
| **Lote** no item da carga | unidade de recall; sem ele, recall vira "recolher tudo" |
| **SIF** do estabelecimento | número do Serviço de Inspeção Federal que abateu/processou |
| **Validade e temperatura** | congelado (−18 °C) e resfriado (0–4 °C) têm regras distintas |
| **Vínculo lote → carga → destino → país** | responde "foi para onde?" em minutos |
| **Certificado sanitário** | documento por embarque, por país, anexável e versionado |
| **Requisitos por país importador** | China, UE e Coreia divergem em prazo, planta habilitada e documento |

## Regras de projeto

1. **Lote pertence ao ITEM, não à carga.** Um caminhão leva vários lotes; um
   lote vai em vários caminhões. É N:N — resolver com tabela de ligação, nunca
   com coluna `lote` em `fact_viagens`. Errar isso inviabiliza o recall
   justamente no dia em que ele for preciso.
2. **Dado sanitário é imutável após a saída.** Depois de `Seguiu Viagem`, lote e
   certificado não se editam — corrige-se com registro de correção, autor e
   motivo, no mesmo padrão de `corrigir-etapa`. Auditoria sanitária lê o
   histórico, não o estado atual.
3. **Guardar junto, não por referência.** Mesma lição de `produto_nome` e
   `cliente_nome` (migrações 019 e 028): o certificado de agosto tem que dizer o
   que dizia em agosto, mesmo que o cadastro mude em dezembro. Snapshot no
   registro.
4. **Planta habilitada é por país e tem validade.** Habilitação para China não
   vale para UE, e habilitações caem. A regra é dado com vigência, não constante
   no código — bloquear embarque para país sem habilitação vigente é feature,
   não erro.
5. **O elo é o mesmo do SSCC.** A unidade logística que o GS1 identifica é a
   mesma que carrega o lote. Fazer lote e SSCC em projetos separados produz duas
   modelagens do mesmo palete — ver `suinco-edi-gs1`.
6. **Multi-tenant**: SIF é do estabelecimento, logo do tenant. Nasce com
   `tenant_id`.

## A consulta que justifica tudo

Qualquer desenho aqui só está pronto quando **estas três perguntas** têm
resposta em minutos, com o dado que o sistema guarda:

1. *Este lote foi para quais clientes, em quais cargas, em que datas?* (recall)
2. *Esta carga levou quais lotes, de qual SIF, com qual certificado?* (fiscal)
3. *Quais lotes ainda estão em pátio ou em trânsito agora?* (contenção)

Se a resposta exigir cruzar planilha à mão, o desenho não está pronto.

## Antes de dar por pronto

- [ ] Lote no item, relação N:N com a carga, com índice para busca reversa.
- [ ] SIF, validade e faixa de temperatura gravados junto (snapshot).
- [ ] Imutabilidade após `Seguiu Viagem`, com caminho de correção auditável.
- [ ] Habilitação por país com vigência, bloqueando embarque não habilitado.
- [ ] As três perguntas acima respondidas por consulta, testadas.
- [ ] `tenant_id` desde a primeira migração.

## Não invente exigência regulatória

Prazos, faixas e formatos de certificado mudam por país, por acordo bilateral e
por ano. **Não escreva no código regra sanitária que você não leu na norma
vigente.** Modele o dado (lote, SIF, temperatura, validade, país, habilitação,
vigência) e trate a regra como **configuração com fonte e data de verificação**
— assim, quando a China mudar a exigência, muda-se um registro, não um deploy.
Consulte a área de qualidade da cooperativa antes de fixar qualquer valor.
