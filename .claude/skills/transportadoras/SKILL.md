---
name: transportadoras
description: Gestão das transportadoras da Suinco — nota de desempenho (scorecard), quando concentrar ou espalhar carga, quando renegociar, quando tirar uma transportadora da lista, e a conferência de documentação (RNTRC, seguro, CT-e/MDF-e). Use ao montar indicador por transportadora, ao preparar conversa de frete com transportadora, ao decidir quem leva uma rota nova, ou quando a mesma transportadora aparece de novo em atraso, avaria ou devolução.
---

# Transportadoras

Adaptada de `carrier-relationship-management` (affaan-m/ECC, licença MIT,
Copyright (c) 2026 Affaan Mustafa). Ver `ORIGEM_DAS_SKILLS_DE_DESIGN.md`.
O original é americano (FMCSA, DAT, LTL). Aqui ficou o MÉTODO; as regras de
lá foram trocadas pelas daqui, e os limiares viraram ponto de partida a ser
calibrado com o dado medido da Suinco — nunca número para publicar.

## A regra que vem antes de tudo

**Indicador por transportadora só sai do dado que o painel já registra.**
Se a pergunta exige um dado que não existe (ex.: hora de entrega no
cliente), a resposta é "não medimos isso", não uma estimativa. Nunca invente
nome de transportadora, placa ou número de carga (CLAUDE.md, "Nunca").

## O que o painel já sabe de cada transportadora

| Pergunta | De onde vem |
|---|---|
| quantas cargas levou, em que dias | cargas programadas (Torre/Histórico) com a placa → Frota → transportadora |
| quanto tempo ficou no pátio | eventos de status da carga (`suinco-yard-flow`, SLA de 3 h) |
| quantas devoluções e por quê | ciclo de devolução (`devolucoes.js`, 6 etapas) |
| frete pago, a pagar, nota pendente, canhoto | aba Pagamento de Frete (`pgfrete_*`) |
| frete tabela × combinado | observação do frete (migração 061) |

A ligação placa → transportadora é da Frota. Placa sem transportadora na
Frota entra como "sem transportadora", em linha separada — não some da
conta (regra "null ≠ zero").

## Nota de desempenho: poucos números, que alguém usa

Cinco medidas, cada uma com numerador e denominador escritos:

1. **Pontualidade na chegada** — cargas que chegaram ao pátio até a hora
   programada ÷ cargas com hora programada.
2. **Tempo de pátio** — mediana (não média: um caminhão esquecido puxa a
   média) da entrada até a saída, pela MESMA função que o Pátio ao vivo usa
   ("uma função, dois chamadores").
3. **Devolução** — cargas com devolução ÷ cargas entregues, separando motivo
   da transportadora (avaria, temperatura, atraso) de motivo comercial.
4. **Pendência de documento** — notas com CT-e ou canhoto faltando há mais
   de N dias ÷ notas da transportadora.
5. **Frete fora da tabela** — cargas COMBINADO ÷ cargas, e a diferença média
   contra a tabela.

Referência de mercado (EUA), só para orientar a primeira calibragem:
pontualidade ≥ 95% boa, < 90% alerta; recusa de carga > 20% indica preço
abaixo do mercado. Os limiares da Suinco saem de 60 dias de dado real.

## Decisões

**Rota nova.** Primeiro as transportadoras que já rodam a região — trazer
uma nova custa cadastro, conferência e risco. Período de experiência com
meta escrita (pontualidade, devolução, documento) antes de qualquer
compromisso.

**Concentrar × espalhar.** Concentrar quando há transportadoras demais com
pouca carga cada (ninguém se importa com quem manda pouco). Espalhar quando
uma só leva mais de ~40% de uma rota crítica, ou quando começa a recusar.

**Renegociar.** Quando o COMBINADO vira regra numa rota que tem TABELA, a
tabela está fora do mercado — ou para cima ou para baixo. O número que
abre a conversa é a diferença medida, não impressão.

**Tirar da lista** (depois de aviso documentado que não resolveu):
pontualidade ruim por 60 dias seguidos; devolução por avaria/temperatura
recorrente; documento irregular (RNTRC, seguro); frete repassado a
terceiro sem acordo.

## Documentação (Brasil)

Conferir na fonte oficial, não de memória: RNTRC ativo na ANTT, seguro de
carga obrigatório, CT-e e MDF-e emitidos, piso mínimo de frete da ANTT (Lei
13.703/2018) quando aplicável. Carga refrigerada: registro de temperatura
do baú — sem ele, avaria por temperatura vira palavra contra palavra.

## Como falar com a transportadora

Dado na mesa, tom de parceria: "a pontualidade de vocês na rota X caiu de A
para B em 30 dias; o que mudou?". Quando o mercado aperta, quem cobre a
carga é quem foi bem tratado quando estava folgado.

## O que NÃO fazer

- Ranking com uma medida só (pune quem pega as rotas difíceis).
- Média de tempo de pátio sem tirar o caminhão esquecido.
- Juntar devolução comercial com devolução por culpa do transporte.
- Publicar indicador sem passar pela skill `checklist-antes-do-numero`.
