---
name: causa-de-variacao
description: Investigação de por que um indicador da operação Suinco mudou — tempo de pátio subiu, saídas caíram, devoluções dispararam, frete combinado aumentou. Confirma se a mudança é real ou ruído, acha quando começou, decompõe o número nas partes, desce por dimensão (transportadora, rota, setor, turno, cliente) e testa hipóteses com evidência. Use quando alguém perguntar "por que isso aconteceu?" sobre um número da operação.
---

# Causa de variação

Adaptada de `root-cause-investigation` (nimrodfisher/data-analytics-skills,
licença MIT, Copyright (c) 2026 Nimrod Fisher). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`.

Não confundir com o agente `suinco-investigador`: ele investiga DEFEITO do
painel ("sumiu", "zerou"). Esta skill investiga a OPERAÇÃO ("o pátio ficou
mais lento"). Às vezes a resposta desta é "é defeito" — aí passa para ele.

## Passos

1. **É real?** Compare com a faixa normal dos últimos 30+ dias (média
   móvel e desvio). Dentro da faixa normal, a resposta honesta é "variação
   normal" — e acaba aí.
2. **Quando começou?** Degrau súbito aponta um evento (publicação do
   painel, mudança de turno, feriado, safra, cliente novo); deriva lenta
   aponta mudança estrutural.
3. **Decompor o número.** Tempo de pátio = espera para entrar no
   embarque + embarque + faturamento + liberação. Saídas = cargas
   programadas × taxa de saída no dia. Ache QUAL parte mexeu antes de
   descer por dimensão.
4. **Descer por dimensão**: transportadora, rota, cliente, setor que
   demorou na etapa, turno, dia da semana. Ordene por contribuição
   absoluta para a mudança.
5. **Testar hipóteses explícitas**, uma por uma, aceitando ou rejeitando
   com dado: volume, mistura de rotas, gargalo num setor, problema de dado
   (registro atrasado, evento faltando). Cruze com o histórico de
   publicações (`docs/FILA_DE_EVOLUCAO.md`): mudança de tela também muda
   comportamento.
6. **Relatório**: o que mudou, quando, a causa principal com a parte que
   ela explica (em %), as hipóteses rejeitadas, e o que fazer agora /
   em seguida / depois.

## Cuidados

- Correlação no mesmo dia não é causa: mostre o mecanismo.
- Volume pequeno (poucas cargas num dia) gera porcentagem que assusta e
  não significa nada — diga o N.
- Indicador que mudou porque a DEFINIÇÃO mudou não é variação da operação
  (ver skill `conciliar-indicador`).
