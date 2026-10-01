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
| ⬜ R5 | confirmar no diagnóstico que http → https já redireciona |

Nenhum deles altera dado da operação.

## 3. Propostas, por ordem de valor

| # | Item | Por que | Medido em 01/10 |
|---|---|---|---|
| ⬜ 1 | **Painel mais leve** — tirar os comentários do código no build (o código-fonte continua comentado; só o arquivo publicado sai sem) | abre mais rápido no celular do pátio, em rede ruim | 708 KB comprimido, teto 760 KB; estimativa anterior: ~389 KB (medir antes de prometer) |
| ⬜ 2 | Pátio #4 — quem carregar primeiro | sugestão de ordem pela fila e pelo tempo de cada um | precisa de revisão do dono (mexe em decisão de operação) |
| ⬜ 3 | Pátio #6 — previsão das próximas horas | quantos caminhões no pátio daqui a 1–3 h | idem |
| ⬜ 4 | Limpeza de código morto | funções sem chamador, `fmtHora` repetida (data.js e app/), classes CSS sem uso | levantar a lista medida antes |
| ⬜ 5 | Arquivo morto da documentação | 39 documentos em `docs/`, mais HTMLs soltos na pasta do painel | — |
| ⬜ 6 | Crescimento do repositório | `index.html` gerado entra em todo commit | 182 MB de histórico |
| ⬜ 7 | Node 24 | o Node 22 do servidor sai de suporte em abril/2027 | planejar no 1º semestre de 2027 |

## 4. Guardado a pedido do dono

- Transferência de titularidade para a Suinco (GitHub, Vercel, Registro.br,
  Hostinger) — `docs/TRANSFERENCIA_PARA_SUINCO.md`. Inclui o **R7**: o
  repositório é público e expõe o cadastro de clientes.
- Alerta de queda e backup externo — o dono informou em 30/09 que já estão
  configurados e testados.
