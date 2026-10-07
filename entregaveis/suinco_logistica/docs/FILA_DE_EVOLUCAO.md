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
| ✅ no ar e no servidor (portão 43, `1cb3799`, 05/10; migração 060 aplicada às 15h50) | **Rodada 2 + #112**: tratativas SEM TRATATIVA · DEVOLUÇÃO · OK · SUMIU DO B2B (OK e DEVOLUÇÃO liberam; migração 060); Status p/ pagamento = conferir / A PAGAR / PARCIAL / INTEGRAL; Data Pagamento, Data Tratativa editáveis; Transportadora só das cadastradas; vitrine avisa que não grava; 2ª linha da carga diz "nota pendente"; leitor do B2B: "103-001-118771" → 118771, blocos repetidos viram uma carga, pareamento pelo número do sistema (#112) | `pagamento_frete_leitura.test.js` (36), `api.test.js` bloco 49, `test_pagamento_frete_aba.py`, `test_vitrine_mostra_todas_as_abas.py` |
| ✅ no ar (portão 44, `0588db8`, 05/10; só painel) | Pagamento de Frete: carga **fechada por padrão**, abre e fecha pelo número (como o Histórico); busca pela nota abre a carga | `test_pagamento_frete_aba.py` (fechada → aberta → fechada → busca) |
| ✅ no ar (portão 45, `0b65369`, 05/10; o código do servidor só vale depois do próximo `atualizar_tudo.sh` — sem migração nova) | **Rodada 45**: nota não localizada não trava a carga; selos de estado; topo "O que fazer hoje"; ordem por prioridade; idade das pendências; pagamento em lote; Fechamento (tela e aba do .xlsx); filtros amplos e exportação do recorte; governança (trilha do antes, pagamento repetido pergunta, vigia de integridade) | `pagamento_frete_leitura.test.js`, `api.test.js` bloco 49 (+3), `test_pagamento_frete_aba.py` (+8) |
| ✅ no ar (portão 46, `cd3f021`, 06/10; o documento e as bibliotecas só valem no servidor depois do próximo `atualizar_tudo.sh` — sem migração) | **PDF detalhado do Pagamento de Frete** (pedido do dono, 06/10): botão Exportar PDF na aba; o recorte do filtro, uma linha por carga e as notas pendentes de cada uma com tratativa; folha deitada; só o setor Pagamento de Frete e a Administração geram. Depende do `atualizar_tudo.sh` (documento novo no mapa do servidor; sem migração). Junto: `compression` 1.8.2 e `proxy-addr` 2.0.8 — dois avisos de segurança publicados em 06/10 (um crítico: endereço de quem acessa falsificável) barraram o portão 46 no passo 4b; o `npm ci` do atualizar_tudo.sh instala as versões corrigidas | `api.test.js` bloco 49 (+1), `test_pagamento_frete_aba.py` seção 6b (+12) |
| ✅ no ar (portão 47, `b44947c`, 06/10; só painel e documentos) | **Nome da empresa = o do CNPJ** (pedido do dono, 06/10): "SUINCO - COOPERATIVA DE SUINOCULTORES LTDA" · CNPJ 06.067.949/0001-95 (matriz, Patos de Minas/MG; conferido em cadastros públicos e igual ao que o DeliveryB2B imprime) no cabeçalho e na ficha de todo PDF do painel (fonte única `EMPRESA`), no login, na apresentação, na ficha do comitê, no manual, nos 8 guias por setor (regerados com prints novos; o roteiro de demonstração passou a seguir a etapa Peso Final Registrado de 16/09), no mapa do arquivo e no README. Só painel e documentos: sem servidor | `test_nome_oficial_da_empresa.py` (fontes, texto de dentro dos PDFs, tela de login) |
| ✅ no ar (portão 48, `7ed0fcf`, 06/10; só painel) | **#114 — carga da Montagem de outro dia nasce no dia certo** (relato do dono, 06/10): a carga criada na Montagem de amanhã nascia com o dia de hoje e não aparecia na Fila de programados de amanhã; agora nasce com o dia da Montagem (meio-dia de Brasília, como a correção do Histórico). Só painel | `test_montagem_de_outro_dia_vai_para_o_dia_certo.py` (9 pontos, pela tela) |
| ✅ painel no ar (portão 49, `1f817dd`, 06/10); 🟡 servidor depende do `atualizar_tudo.sh` (migração 061) | **#115 — frete obrigatório para contratar** (decisão do dono, 06/10): valor do frete não editável (KM × tarifa), só o KM; toda contratação pergunta TABELA ou COMBINADO com o valor; troca de transportadora pergunta de novo; selo "frete a definir" nas cargas antigas; relatório da Administração de Fretes com "Obs. do frete" e a diferença | `test_frete_obrigatorio_para_contratar.py`, bloco 50 do `api.test.js` |
| ✅ publicado (portão 49, `1f817dd`, 06/10); 🟡 só vale no servidor depois do `atualizar_tudo.sh` (Nginx reescrito pelo `instalar.sh`) | **Auditoria da API** (pedido do dono, 06/10): login com recusa única e espera de 15 min; PDF com login antes do limite e corpo de 5 MB; erros do banco com código (409/422); filial fora da sala do pátio no tempo real; sincronia de 30 dias; /health sem detalhe de erro; Nginx sem consulta no log e 10 MB | bloco 51 do `api.test.js`, `test_filial_nao_recebe_patio_pelo_tempo_real.py` |
| ✅ painel no ar (portão 49, `1f817dd`, 06/10); 🟡 servidor depende do `atualizar_tudo.sh` (migrações 062 e 063) | **Pagamento de Frete: Excluir, Editar e campos por nota** (pedido do dono, 06/10): Excluir sai da lista e fica em "Excluídas" com motivo (Restaurar desfaz); Editar num formulário só; cada nota com Pagar nota (soma 1 nota no % pago), data, transportadora e CT-E próprios | bloco 52 do `api.test.js`, `test_pagamento_frete_editar_excluir_por_nota.py` |
| ✅ no ar — portão 52 (dc374f0, 07/10; o 50 e o 51 cancelaram pela #116) | **Reorganizar a tela da aba Pagamento de Frete** (auditoria visual, 06/10, aprovada "tudo"): linha da carga sem rolar para o lado, notas em lista própria, topo enxuto, filtros numa linha, cartão no celular. Regras, Excel e PDF não mudam. Cabe sem rolar de lado em 1280/1366/1440px; no notebook Editar/Histórico/Excluir viram ícone | `test_pagamento_frete_aba` (reescrito para a tela nova), `test_pagamento_frete_editar_excluir_por_nota` |

## 4. Guardado a pedido do dono

- Transferência de titularidade para a Suinco (GitHub, Vercel, Registro.br,
  Hostinger) — `docs/TRANSFERENCIA_PARA_SUINCO.md`. Inclui o **R7**: o
  repositório é público e expõe o cadastro de clientes.
- Alerta de queda e backup externo — o dono informou em 30/09 que já estão
  configurados e testados.
