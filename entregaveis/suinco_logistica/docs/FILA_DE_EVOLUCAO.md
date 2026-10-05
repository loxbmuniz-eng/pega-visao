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

## 2. Esperando o servidor

Nada. Em 01/10/2026 o servidor chegou a `7cf0236` (bloco COPIE DAQUI colado
pelo dono): ✅ Node 24.21.0 · ✅ #97 · ✅ #98 · ✅ #103. Nenhum alterou dado
da operação.

| Item | O que falta |
|---|---|
| ✅ Ubuntu em dia | 02/10/2026: reinício + 35 de 36 atualizações de pacote (kernel 6.8.0-142 → 6.8.0-146, krb5, audit, apparmor, libxpm, netplan, docker…) e segundo reinício. Conferido depois: embarque-suinco, postgresql e nginx `active`, /health 200, node v24.21.0, kernel 6.8.0-146-generic. Nenhum pacote do painel (banco, nginx, Node) estava na lista; nada roda em Docker. Ficou só o `cloud-init` (24.1 → 26.1), liberado aos poucos pelo Ubuntu; não é usado pelo painel |
| ⬜ R5 | confirmar no diagnóstico que http → https já redireciona |

## 3. Propostas, por ordem de valor

Aprovados pelo dono em 01/10/2026 ("12345"): 4 e 7 feitos; 1 retirado do portão 33 (#105); 5 levantado (nada movido);
2 e 3 viraram perguntas, respondidas no mesmo dia ("pergunta 1 a pergunta b a").

| # | Item | Situação | Medido em 01/10 |
|---|---|---|---|
| ⬜ 1 | **Painel mais leve** — o `index.html` publicado sairia sem comentário e sem espaço (esbuild) | **retirado do portão 33** | 708 → 379 KB medidos. O portão 33 reprovou: o esbuild troca `api: '…'` por `api:"…"`, e 69 testes apontam o painel para o servidor de teste trocando esse texto EXATO — sem a troca, o painel do teste mira a produção (daqui ela nem responde; nada chegou lá). Volta só com um ajudante único nos testes que troca o endereço em qualquer formato e REPROVA se não trocou (#105) |
| ✅ 4 | **Código morto** — 12 funções sem chamador removidas; `fmtHora` em dois arquivos virou uma só, que trata vazio (#104) | ✅ no ar (portão 34, `7cf0236`) | Trava: `test_sem_codigo_morto` |
| ⬜ 5 | **Arquivo morto da documentação** | levantado, NADA movido | 10 arquivos de `docs/` sem nenhuma citação. Não movi: `AVISOS_NO_CELULAR.md` descreve recurso vivo, e os `.html`/`.pdf` são endereços públicos do site (mover quebra link enviado à TI/diretoria). Mover só com a lista conferida um a um com o dono |
| ✅ 7 | **Node 24** | ✅ no ar e no servidor (v24.21.0, 01/10) | 509/509 testes do servidor e a bateria de tela inteira no Node 24.21.0. CI roda 22 e 24. Trava: `test_servidor_vai_para_node_24` |
| ✅ 2 | **Pátio #4 — próximo a carregar** — na coluna Aguardando Embarque, um cartão ganha a marca "próximo a carregar": o de menor sequência entre os que já chegaram, dia de programação mais antigo primeiro (resposta 1-A). Sem sequência, ninguém marcado | ✅ no ar (portão 34, `7cf0236`) | Trava: `test_patio_vivo_proximo_e_saidas` |
| ✅ 3 | **Pátio #6 — saídas previstas** — faixa "Saídas previstas — próxima hora: N · de 1 a 2 h: N · de 2 a 3 h: N", pela mesma previsão do cartão; quem não tem previsão é contado à parte (resposta 2-A) | ✅ no ar (portão 34, `7cf0236`) | Trava: `test_patio_vivo_proximo_e_saidas` |
| ⬜ 6 | Crescimento do repositório | `index.html` gerado entra em todo commit | 182 MB de histórico |

## 3b. Redesenho das 12 abas (auditoria de 01/10/2026)

| ✅ | O quê | Trava |
|---|---|---|
| ✅ no ar (portão 36, `398f61f`, 02/10) | Números antes dos botões na Torre; "Fechar Programação" no fim da lista (2-b); faixa de números como régua; status como marca + nome; célula da Torre que parece texto e continua campo (linha 89 → 73 px); piso de 12 px nas 12 abas; Portaria com Chegou/Saiu grandes; sem gradiente de enfeite; 78 emojis de botão viraram ícones de traço | `test_piso_de_12px` (reprova no publicado anterior em 23 pontos) e as guardas de tema ajustadas à regra nova |

## 3c. Pagamento de Frete e o relatório de fretes (05/10/2026)

| ✅ | O quê | Trava |
|---|---|---|
| ✅ no ar e no servidor (portão 40, `3e4b157`; servidor em e6e3d7f desde 05/10, migração 058) | Aba **Pagamento de Frete**: importa os PDFs do B2B e do Atak, cruza nota a nota, monta a planilha (22 colunas, uma carga em várias linhas), tratativa por nota, pagamento por carga com pergunta, exporta o XLSX idêntico ao modelo aprovado; setor novo "Pagamento de Frete" (migração 058) | `pagamento_frete_leitura.test.js` (31), `api.test.js` bloco 49 (31), `test_pagamento_frete_aba.py` (29), 12px e contraste com a aba |
| ✅ no ar (portão 40, `3e4b157`, 05/10) | Administração de Fretes: separado por dia com cabeçalho, Data da Programação e do Faturamento, KM e Frete no PDF (ocorrência #109) | `test_fretes_ordem_por_dia_e_datas.py`, `test_fretes_km_no_relatorio.py` |
| ✅ no ar e no servidor (portão 41, `e6e3d7f`, 05/10; migração 059 aplicada) | **Canhoto original**: uma caixinha por carga (SIM/NÃO) na aba Pagamento de Frete, só acompanhamento — não entra em liberado, pago nem a pagar; carimba o dia e quem marcou (migração 059); colunas W–X na planilha, cartões no RESUMO ("Pagas sem canhoto"), caixa do topo e filtro "Sem canhoto original" | `pagamento_frete_leitura.test.js` (31), `api.test.js` bloco 49 (32), `test_pagamento_frete_aba.py` (37) |
| ✅ no ar (portão 43, `1cb3799`, 05/10) — vale no servidor depois do atualizar_tudo.sh (migração 060 + leitor do B2B) | **Rodada 2 + #112**: tratativas SEM TRATATIVA · DEVOLUÇÃO · OK · SUMIU DO B2B (OK e DEVOLUÇÃO liberam; migração 060); Status p/ pagamento = conferir / A PAGAR / PARCIAL / INTEGRAL; Data Pagamento, Data Tratativa editáveis; Transportadora só das cadastradas; vitrine avisa que não grava; 2ª linha da carga diz "nota pendente"; leitor do B2B: "103-001-118771" → 118771, blocos repetidos viram uma carga, pareamento pelo número do sistema (#112) | `pagamento_frete_leitura.test.js` (36), `api.test.js` bloco 49, `test_pagamento_frete_aba.py`, `test_vitrine_mostra_todas_as_abas.py` |

## 4. Guardado a pedido do dono

- Transferência de titularidade para a Suinco (GitHub, Vercel, Registro.br,
  Hostinger) — `docs/TRANSFERENCIA_PARA_SUINCO.md`. Inclui o **R7**: o
  repositório é público e expõe o cadastro de clientes.
- Alerta de queda e backup externo — o dono informou em 30/09 que já estão
  configurados e testados.
