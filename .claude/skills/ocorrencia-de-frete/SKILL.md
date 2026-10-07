---
name: ocorrencia-de-frete
description: Tratamento de ocorrência de frete na Suinco — atraso, avaria visível ou oculta, falha de temperatura do baú, falta, sobra, recusa no cliente, entrega no lugar errado, extravio. Como classificar a gravidade, o que guardar de prova, a ordem de prioridade quando várias acontecem juntas, e quando absorver o custo ou cobrar da transportadora. Use ao desenhar ou mexer no ciclo de devolução, ao tratar uma ocorrência relatada, ou ao montar indicador de ocorrências por transportadora.
---

# Ocorrência de frete

Adaptada de `logistics-exception-management` (affaan-m/ECC, licença MIT,
Copyright (c) 2026 Affaan Mustafa). Ver `ORIGEM_DAS_SKILLS_DE_DESIGN.md`.
Valores em dólar e prazos americanos foram tirados: os limites da Suinco
são decisão do dono, escritos aqui quando ele decidir — até lá, a skill
pergunta em vez de supor.

## Onde isto vive no painel

O ciclo de devolução (`devolucoes.js`, 6 etapas) é o registro oficial de
ocorrência que volta mercadoria. O Pagamento de Frete é onde a ocorrência
vira dinheiro (nota pendente, pagamento parcial). Mudança em qualquer um
dos dois passa pelo fluxo da casa: PROMPT → aprovação → teste que reprova.

## Tipos (cada um tem prova diferente)

| Tipo | A prova que decide | Quando se perde a prova |
|---|---|---|
| Atraso | hora programada × hora real (eventos da carga) | nunca, se o evento foi gravado na hora — "fidelidade ao momento exato" |
| Avaria visível | anotação no canhoto + foto na entrega | canhoto assinado "sem ressalva" |
| Avaria oculta | foto + embalagem + prazo curto de aviso | quanto mais tempo, mais a culpa volta para quem embarcou |
| Temperatura | registro de temperatura do baú, temperatura na expedição | sem registro, vira palavra contra palavra |
| Falta | contagem conferida na saída (romaneio) × na entrega | canhoto assinado com a contagem errada |
| Sobra | idem — e alguém do outro lado está com falta | — |
| Recusa no cliente | motivo escrito pelo cliente | motivo verbal |
| Entrega errada / extravio | trilha da carga | — |

Proteína suína é perecível e tem regra sanitária: lote, SIF e temperatura
seguem a skill `suinco-sanitary-traceability`. Ocorrência com risco
sanitário é sempre a primeira da fila.

## Gravidade: três eixos, vale o mais alto

1. **Valor** da mercadoria envolvida (faixas: decisão do dono).
2. **Cliente**: contrato com multa ou cliente-chave sobe um nível.
3. **Tempo**: perecível com pouca validade restante, ou cliente parado,
   sobe direto para o topo.

## Ordem quando várias acontecem juntas

1. risco sanitário ou de segurança;
2. cliente que para operação por falta do produto;
3. perecível com validade curta;
4. maior valor ajustado pelo cliente;
5. a mais antiga em aberto (ocorrência velha não se resolve sozinha).

## Absorver ou cobrar

A conta é: custo de cobrar (tempo de gente, desgaste com a transportadora)
× valor recuperável. Valor pequeno com transportadora boa: absorver e
REGISTRAR — o registro alimenta a nota de desempenho (skill
`transportadoras`). **Padrão vence valor:** terceira ocorrência da mesma
transportadora em 30 dias é problema de desempenho, seja qual for o valor.

## Indicadores (calibrar com dado da Suinco)

Tempo médio até resolver; ocorrências por 1.000 cargas; percentual
recuperado; repetição na mesma transportadora/rota; ocorrências abertas há
mais de 30 dias.

## O que NÃO fazer

- Tratar devolução comercial (cliente desistiu) como ocorrência de transporte.
- Carimbar a hora da edição como hora da ocorrência.
- Apagar ocorrência resolvida: sai da fila, fica no Histórico.
