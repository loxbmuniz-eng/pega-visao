---
name: tendencia-e-previsao
description: Análise de série no tempo da operação Suinco — cargas por dia, tempo de pátio, devoluções, frete — separando tendência, efeito do dia da semana e do mês, achando pontos fora da curva e fazendo previsão simples com margem de erro. Use para planejar a semana (quantos caminhões, quanta gente no embarque), para dizer se uma melhora é real ou sazonal, e para criar a linha de base de "o que teria acontecido sem a mudança".
---

# Tendência e previsão

Adaptada de `time-series-analysis` (nimrodfisher/data-analytics-skills,
licença MIT, Copyright (c) 2026 Nimrod Fisher). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`.

## Passos

1. **Montar a série** no grão natural (dia, na data de Brasília). Dia sem
   operação (domingo, feriado) é zero de verdade ou falta de dado? Decida
   e escreva — não preencha buraco sem dizer.
2. **Olhar antes de modelar**: gráfico da série inteira; valores
   impossíveis; mudança de definição no meio (ex.: dia em que o indicador
   passou a contar outra coisa) corta a série em duas.
3. **Separar as partes**: tendência, efeito do dia da semana (segunda
   costuma ser diferente de sexta), efeito do mês/safra, e o resto. Se o
   dia da semana pesa muito, comparar segunda com segunda.
4. **Pontos fora da curva**: mais de 3 desvios da mediana móvel. Os cinco
   maiores vão para o histórico de eventos (publicação, feriado, problema
   no servidor) antes de virar conclusão.
5. **Prever**: o mais simples que acerta. Média móvel do mesmo dia da
   semana costuma bastar; modelo mais complexo só se ganhar de verdade num
   período separado para teste. Sempre com faixa (mínimo–máximo), nunca
   número seco.
6. **Relatório**: direção e força da tendência, padrão semanal/mensal, o
   que foi fora da curva e por quê, a previsão com a faixa e o erro medido.

## Cuidados

- Pelo menos dois ciclos completos (duas semanas para padrão semanal, dois
  anos para safra) antes de afirmar sazonalidade.
- Previsão que vai para tela é feita no SERVIDOR e testada; a tela só
  mostra.
- Gráfico segue a skill `dataviz` (um eixo, cor por função, faixa visível).
