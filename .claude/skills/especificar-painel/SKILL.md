---
name: especificar-painel
description: Especificação de painel ou aba de indicadores da Suinco ANTES de construir — a pergunta que ele responde, para quem, quais números (no máximo 10–12), em que ordem na tela, que filtros, de onde vem cada dado e como se sabe que deu certo. Use ao planejar aba nova de indicadores, ao refazer uma aba que ninguém usa, ou quando setores diferentes querem coisas diferentes da mesma tela. A saída vira o PROMPT para o Luis aprovar.
---

# Especificar painel

Adaptada de `dashboard-specification` (nimrodfisher/data-analytics-skills,
licença MIT, Copyright (c) 2026 Nimrod Fisher). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`. A especificação É o PROMPT da regra 1 do
CLAUDE.md: nenhum código antes de ela ser aprovada.

## Passos

1. **Uma frase**: "Esta tela responde [pergunta] para [setor] que precisa
   [decidir/agir]". Se não cabe numa frase, são duas telas.
2. **Quem usa**: para cada setor (Logística, Portaria, Expedição,
   Faturamento, Administração…), quantas vezes por dia abre, a pergunta
   que traz, se usa no celular no pátio. Setores com perguntas diferentes
   ganham telas diferentes, não mais filtros na mesma.
3. **Hierarquia dos números**: os principais no topo (poucos, grandes),
   os de apoio abaixo, o detalhe por último. Mais de 10–12 números é tela
   tentando fazer tudo.
4. **Arquitetura**: principais → tendência → quebra por dimensão →
   detalhe. O mais importante em cima à esquerda. No celular, a mesma
   ordem em coluna, sem rolagem lateral.
5. **Interação**: filtro de período (padrão da casa: hoje / 7 dias / 30
   dias / mês), filtros por dimensão numa linha só acima dos gráficos,
   o que acontece ao tocar num número. Cada filtro novo precisa de motivo.
6. **Dado de cada número**: rota do backend ou função do `app/`, regra de
   cálculo, frequência de atualização, e o que aparece quando falta dado
   ("sem dado" declarado, nunca zero inventado).
7. **Como saber que deu certo**: o setor parou de pedir planilha à parte?
   abriu a tela todo dia?

## Saída

O PROMPT no formato da casa: o que muda, onde, o que NÃO muda, a pergunta
que falta. Depois da aprovação: teste que reprova → construção com as
skills `dataviz` e `ui-ux-pro-max` → portão.
