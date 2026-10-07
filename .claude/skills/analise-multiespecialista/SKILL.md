---
name: analise-multiespecialista
description: Análise profunda de uma planilha ou base da Suinco (frete, devoluções, pátio, saídas) com 3 a 5 olhares de especialistas diferentes rodando em paralelo — logística, financeiro de frete, qualidade/sanitário, operação de pátio, comercial — e um relatório único, organizado por tema, com título-conclusão. Use quando o Luis mandar uma planilha pedindo "analisa isso", "faz um relatório", ou quando a pergunta tiver várias dimensões (tempo + custo + transportadora + cliente).
---

# Análise multiespecialista

Adaptada de `data-analysis-skill` (dongzhang84, licença MIT). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`. Do original ficou o método das quatro
fases; o formato do relatório segue o da casa (agente
`suinco-entregavel-html`, skill `dataviz`).

## Quando usar — e quando não

Use quando a base tem várias dimensões, mais de ~500 linhas ou ~10
colunas, ou quando pedirem relatório. Para consulta simples ("quanto deu
o frete de setembro?") responda direto, sem esta máquina toda.

## As quatro fases

**1. Entender o dado.** Linhas × colunas, período, campos, estatística
básica, campos vazios, problemas de qualidade (skill `auditoria-do-dado`),
e uma ou duas observações imediatas.

**2. Escolher os olhares.** 3 a 5 papéis que não se sobrepõem, cada um
ligado ao dado. Para a Suinco, os candidatos naturais:
- gestor de transporte (transportadoras, rotas, pontualidade);
- analista de custo de frete (tabela × combinado, pago × a pagar);
- qualidade e sanitário (temperatura, lote, devolução por avaria);
- operação de pátio (tempo por etapa, gargalo por setor);
- comercial (cliente, recusa, devolução por motivo comercial).
Escreva o foco de cada um e mostre ao Luis antes de rodar, se a análise
for grande.

**3. Analisar em paralelo.** Um subagente por papel, cada um com: quem é,
caminho do arquivo, as perguntas, e o formato da resposta (números-chave e
conclusões). Rodam ao mesmo tempo.

**4. Juntar num relatório só.** Sem nome de papel no relatório final:
organizado por TEMA, com títulos que são conclusão ("Frete combinado já é
40% das cargas da rota X") e não descrição ("Análise do frete"). Cruze os
achados de papéis diferentes — é ali que está o valor.

## Regras que não mudam

- Dado real nunca vai para o repositório (LGPD): planilha e relatório com
  dado do cliente ficam fora do git.
- Nada inventado; gráfico que não engana; o N dito.
- Antes de entregar: skill `checklist-antes-do-numero`.
