---
name: consulta-periodica
description: O desenho de um "vigia" que consulta outro sistema de tempos em tempos (a API do Delivery B2B, uma exportação do ERP Atak) e só reage ao que é NOVO — com marca d'água, primeira rodada sem disparo, gravação atômica e silêncio quando não há novidade. Use ao planejar ou implementar qualquer integração por consulta periódica no servidor do painel, ou um vigia avulso de terminal.
---

# Consulta periódica (vigia com marca d'água)

Adaptada de `watchers` (Hermes Agent, Nous Research, licença MIT). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`. O original traz scripts Python de terminal;
aqui fica o DESENHO, porque no painel isto vive no servidor Node, junto das
regras de integração de `.claude/agents/suinco-integrador-atak.md`.

## O modelo mental

Um vigia é só isto, a cada rodada:

1. busca os itens na fonte;
2. compara com a **marca d'água** — o conjunto de ids já vistos;
3. grava a marca nova;
4. entrega SÓ o que é novo (e nada quando não há novidade).

## As cinco regras que fazem funcionar

1. **A primeira rodada não dispara nada.** Ela só registra o que já existe.
   Senão, ligar o vigia abre de uma vez todo o histórico da fonte — por
   exemplo, cem checklists de devolução de ocorrências antigas.
2. **A chave é de negócio e estável.** Id da ocorrência na fonte, chave da
   NF-e + item, número do documento DEV. Nunca a posição na lista nem a hora.
3. **Gravação atômica.** Escreva a marca num arquivo/linha temporária e troque
   de uma vez (no banco: uma transação). Vigia que cai no meio não pode deixar
   marca pela metade — é assim que um item é processado duas vezes, ou nunca.
4. **Silêncio quando não há novidade.** Nada de "0 itens novos" a cada rodada:
   quem consome trata saída vazia como "nada a fazer".
5. **Marca limitada.** Guarde os últimos N ids (500 por padrão), não para
   sempre. Fonte de muito volume: aumente; e confira que a janela cobre o
   intervalo entre rodadas.

## Aplicado ao painel (regras da casa por cima)

- **Idempotência no destino também.** Além da marca d'água, a gravação no
  painel usa a chave de negócio (`ON CONFLICT` / "já está no checklist"):
  reprocessar não pode duplicar, mesmo se a marca se perder.
- **Recusa nunca é silenciosa.** Falha de busca sai com código ≠ 0 e fica em
  `log_eventos` (quem, quando, resposta da fonte). Item que o painel recusa
  (setor, formato) aparece na tela, não some.
- **O painel funciona sem o vigia.** Se a fonte cair, o pátio não para; o
  checklist volta a ser aberto à mão.
- **Credencial** da fonte vai no `.env` do servidor pela mão da TI — nunca no
  repositório, nem em exemplo.
- **"Reprocessar" é um botão, não um chamado**: apagar a marca de um vigia
  (ou rodar com "reprocessar desde X") tem de ser uma ação registrada.
- **Intervalo** combinado com o limite da fonte (confirme com a ATAK: quantas
  consultas por minuto?). Sem esse número, não escolha um.

## Teste que prova (antes de ligar)

- primeira rodada com 10 itens na fonte → 0 disparos, marca com 10 ids;
- segunda rodada com 2 novos → exatamente 2 disparos;
- vigia morto no meio da gravação → próxima rodada não duplica nem perde;
- fonte fora do ar → erro registrado, painel segue operando.
