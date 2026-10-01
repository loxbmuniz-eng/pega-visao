# Fila de evolução do painel

Pedido do dono em 01/10/2026: *"precisamos manter constante evolução do
nosso painel embarquesuinco"*. Esta é a fila — o que está proposto, o que
espera resposta dele, o que espera o servidor. **Toda entrega atualiza esta
lista na mesma entrega** (regra 3: controle não depende de memória).

Marcação: ✅ no ar · 🟡 commitado, não publicado (ou esperando o servidor) ·
⬜ proposta / esperando resposta.

## 1. Esperando resposta do dono

| Item | O que é | A pergunta |
|---|---|---|
| ⬜ Pátio #8 — tela cheia | botão no canto inferior direito, como o do YouTube; tela cheia, letras maiores, tela não apaga; no iPhone cobre a tela dentro do navegador | APROVADO? |
| ⬜ Pátio #7 — máquina do tempo | régua para ver o pátio como estava em qualquer hora; botão "ao vivo" volta | (A) só hoje — recomendado · (B) últimos 30 dias |
| ⬜ E-mail titular | chamado de TI **43978** aberto | o nome é `embarquesuinco@` (título do chamado) ou `embarquelog@` (pedido original)? |

## 2. Esperando o servidor (próximo `atualizar_tudo.sh`, sem pressa)

| Item | O que muda no servidor |
|---|---|
| 🟡 #97 | o atualizar passa a rodar a versão que acabou de baixar |
| 🟡 #98 | a prova do backup confere 5 cargas antigas campo a campo |
| 🟡 #103 | o assistente do servidor: porta certa, sem prometer apagar, migração lida do banco |
| 🟡 Node 24 | o `instalar.sh` troca o Node 22 pelo 24 antes de copiar o código; se o repositório do Node não responder, avisa e segue no 22 (nada cai). O COPIE DAQUI passa a dizer a versão |
| ⬜ R5 | confirmar no diagnóstico que http → https já redireciona |

Nenhum deles altera dado da operação.

## 3. Propostas, por ordem de valor

Aprovados pelo dono em 01/10/2026 ("12345"): 1, 4 e 7 feitos; 5 levantado (nada movido);
2 e 3 viraram perguntas, respondidas no mesmo dia ("pergunta 1 a pergunta b a").

| # | Item | Situação | Medido em 01/10 |
|---|---|---|---|
| 🟡 1 | **Painel mais leve** — o `index.html` publicado sai sem comentário e sem espaço sobrando (esbuild, versão fixa, nenhum nome trocado); as fontes continuam comentadas | portão 33 | 708 → 379 KB comprimidos (−46%); as 12 abas com o mesmo texto e 0 erro. Trava: `test_painel_enxuto` |
| 🟡 4 | **Código morto** — 13 funções sem chamador removidas; `fmtHora` em dois arquivos virou uma só, que trata vazio (#104) | portão 33 | Trava: `test_sem_codigo_morto` |
| ⬜ 5 | **Arquivo morto da documentação** | levantado, NADA movido | 10 arquivos de `docs/` sem nenhuma citação. Não movi: `AVISOS_NO_CELULAR.md` descreve recurso vivo, e os `.html`/`.pdf` são endereços públicos do site (mover quebra link enviado à TI/diretoria). Mover só com a lista conferida um a um com o dono |
| 🟡 7 | **Node 24** | portão 33; vale no próximo `atualizar_tudo.sh` | 509/509 testes do servidor e a bateria de tela inteira no Node 24.21.0. CI roda 22 e 24. Trava: `test_servidor_vai_para_node_24` |
| 🟡 2 | **Pátio #4 — próximo a carregar** — na coluna Aguardando Embarque, um cartão ganha a marca "próximo a carregar": o de menor sequência entre os que já chegaram, dia de programação mais antigo primeiro (resposta 1-A). Sem sequência, ninguém marcado | portão 33 | Trava: `test_patio_vivo_proximo_e_saidas` |
| 🟡 3 | **Pátio #6 — saídas previstas** — faixa "Saídas previstas — próxima hora: N · de 1 a 2 h: N · de 2 a 3 h: N", pela mesma previsão do cartão; quem não tem previsão é contado à parte (resposta 2-A) | portão 33 | Trava: `test_patio_vivo_proximo_e_saidas` |
| ⬜ 6 | Crescimento do repositório | `index.html` gerado entra em todo commit | 182 MB de histórico |

## 4. Guardado a pedido do dono

- Transferência de titularidade para a Suinco (GitHub, Vercel, Registro.br,
  Hostinger) — `docs/TRANSFERENCIA_PARA_SUINCO.md`. Inclui o **R7**: o
  repositório é público e expõe o cadastro de clientes.
- Alerta de queda e backup externo — o dono informou em 30/09 que já estão
  configurados e testados.
