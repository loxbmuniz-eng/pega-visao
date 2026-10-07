---
name: checklist-antes-do-numero
description: Conferência obrigatória antes de mostrar qualquer número, análise, relatório ou indicador ao Luis, à diretoria ou a um setor da Suinco — pergunta certa, fonte certa, cálculo conferido, premissas escritas, conclusão que sai do dado, ressalvas ditas. Use toda vez, não só nas entregas grandes: corrigir depois de mostrado custa sempre mais.
---

# Checklist antes do número

Adaptada de `analysis-qa-checklist` (nimrodfisher/data-analytics-skills,
licença MIT, Copyright (c) 2026 Nimrod Fisher). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`. É a regra 2 do CLAUDE.md ("nada é dado
como pronto sem prova") aplicada a número.

## A conferência

**Pergunta**
- [ ] O número responde a pergunta que foi feita, e não uma parecida?
- [ ] Período e fuso (Brasília) estão escritos junto do número?

**Fonte**
- [ ] Vem de dado real da base, com a consulta ou função citada?
- [ ] Nada inventado — rota, placa, cliente, carga, transportadora?
- [ ] Carga de teste, anulada ou excluída ficou fora (ou dentro) de
      propósito, e isso está dito?

**Cálculo**
- [ ] Refiz a conta por um segundo caminho e bateu?
- [ ] O mesmo conceito tem o mesmo valor em todo lugar onde aparece
      (skill `conciliar-indicador`)?
- [ ] Vazio tratado como vazio, não como zero?
- [ ] Média só onde a média não engana; senão mediana.

**Conclusão**
- [ ] A conclusão sai do dado — e não do que se esperava ver?
- [ ] O N está dito (porcentagem de 3 cargas não é tendência)?
- [ ] As ressalvas estão escritas, inclusive o que NÃO foi medido?

**Apresentação**
- [ ] Gráfico conferido com a skill `dataviz` (eixo único, rótulo, cor)?
- [ ] Português de operação, sem jargão (agente `suinco-voz-do-dono`)?
- [ ] Estado marcado: ✅ no ar · 🟡 commitado · ⬜ proposta.

## Saída

A lista acima preenchida. Item que não passou é corrigido antes — ou o
número sai com a ressalva escrita ao lado.
