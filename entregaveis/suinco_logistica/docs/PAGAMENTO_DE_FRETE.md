# Pagamento de Frete — a planilha de controle dentro do painel

Pedido da Logística (Daniela, via Alysson) em 05/10/2026, com as decisões do
dono. O frete é pago POR CARGA e só o que foi entregue de verdade. Até aqui a
Daniela exportava dois relatórios por carga, conferia num assistente, copiava
para uma planilha e anotava à mão transportadora, tratativa, pagamento e data.
Agora os dois relatórios entram no painel, o painel cruza nota a nota e monta a
planilha — no mesmo formato da dela, aprovado pelo dono.

## As decisões do dono (05/10/2026)

| Pergunta | Decisão |
|---|---|
| O que entra no painel | **Só os PDFs**: DeliveryB2B ("Relatório de Status das Entregas") e Atak (WRVDA501 — Notas por Carga). Nada de importar XLSX. |
| Exportar | O painel gera o XLSX **idêntico ao modelo aprovado** (CONTROLE_CARGAS, RESUMO, LEIA-ME). O leitor de XLSX fica no código, sem botão, "para o painel entender a linguagem" se um dia precisar. |
| Tela | **A aba é a planilha**: 22 colunas (A–P as da planilha da Daniela, na ordem dela; Q–V acréscimos), uma carga em várias linhas, o RESUMO embaixo. Nada é calculado na tela: o servidor manda a grade — a MESMA que vira o arquivo. |
| Quem entra | O **setor "Pagamento de Frete"** (mais a Administração), escolhido na tela de Usuários que já existe. Sem marca por pessoa, sem tela nova. |
| Percentual | Pela **quantidade de notas** (80 canhotos de 100 = 80%). Sem valor em R$ ("mais o checklist mesmo para controle"). |
| O que se paga | Direto, só a nota **Finalizada** no B2B. As outras precisam de consulta no sistema: só a tratativa **OK** / **OK B2B** libera. DEV, DEV NO SISTEMA, SEM TRATATIVA e SUMIU DO B2B não liberam. |
| Carga VERIFICAR | Contagem não bate, nota de um lado só, ou nada finalizado: **nada é liberado** ("conferir") até alguém olhar o B2B. Registrar pagamento assim PERGUNTA e exige confirmação. |
| Data do pagamento | Manual, pode ficar em branco. |
| Status Pendência (rodada 2) | **SEM TRATATIVA · DEVOLUÇÃO · OK · SUMIU DO B2B**. OK e DEVOLUÇÃO **liberam** a nota ("se for devolução, finalizo 100% integral" — Daniela). As palavras antigas (DEV, DEV NO SISTEMA, OK B2B) continuam entendidas e viram as atuais (migração 060). |
| Status p/ pagamento (rodada 2) | É **o que fazer**: `conferir` (VERIFICAR) · `A PAGAR` (há liberado ainda não pago) · `PARCIAL` (pagou o liberado; há nota pendente) · `INTEGRAL` (100% liberado e 100% pago). Não é "quanto foi pago" — isso é o % Pago. |
| Campos editáveis (rodada 2) | Data Pagamento (do último pagamento válido; sem pagamento, abre o Pagar), Data Tratativa (por nota), Observação, Transportadora **só das cadastradas na Frota** (servidor confere em `dim_veiculos`). |
| Vitrine | Nada grava; toda ação avisa e diz o que faria no painel. |
| Canhoto original | Uma **caixinha por carga** (SIM/NÃO) para dizer se o canhoto em papel chegou. **Só acompanhamento**: não entra no % liberado, no % pago nem em "A pagar agora" — o fechamento continua pelo digital. Marcar carimba o dia e quem marcou; desmarcar apaga. Colunas W–X da planilha, migração 059. |

## Os dois relatórios, campo a campo — o modelo que SEMPRE chega

Decisão do dono (05/10/2026): *"este é o modelo do B2B e do Sisatak, e sempre
será assim; nunca deve chegar um relatório que não siga esse modelo"*. O
leitor lê pela ESTRUTURA (títulos e colunas achados pelo nome, não pela
posição) e recusa, com explicação, o que fugir dela — nunca adivinha.

**DeliveryB2B — "RELATÓRIO DE STATUS DAS ENTREGAS"** (`lerB2B`), paisagem,
uma ou várias cargas, várias páginas:
- Rodapé reconhecido pelo conteúdo (linha só com o número da página), não
  por altura fixa (#110 do rodapé: a linha 31 caía no corte).
- **Bloco da carga**, títulos `MOTORISTA · PLACA · CARGA · CARGA EXTERNA ·
  EMBARQUE · INICIO VIAGEM · KM PERCORRIDOS · PESO TOTAL`, valores na linha
  de baixo. O bloco **se repete a cada grupo de entregas** (a 118771: 6
  páginas, 12 blocos) — blocos com o mesmo número são UMA carga.
- **CARGA** vem "118882" ou "103-001-118771" (filial-operação-carga). O
  número da carga é o **último trecho de dígitos**; o texto como veio fica
  em `identificador` e aparece na prévia. CARGA EXTERNA, quando vier, é
  guardada à parte (nunca colada ao número). Ocorrência #112.
- **Tabela**, títulos `SEQ · STATUS · TIPO · NUMERO · CLIENTE · REENTREGA …`:
  as colunas são achadas pelo título; falta de qualquer uma das cinco
  recusa o arquivo (`B2B_LAYOUT`). A nota é `NUMERO` sem o sufixo "-3"; o
  status (Finalizado, Aguardando, Não entregue…) é o que decide.
- Sem número de carga → `B2B_SEM_CARGA`; carga sem linha → `B2B_SEM_NOTAS`.

**Atak — "WRVDA501 - Relatório de Notas por Carga"** (`lerSIST`), uma ou
várias cargas:
- `Número Carga: 118771` antes da tabela de cada carga; a tabela traz
  `Data · NE · Cliente · CNPJ/CPF · Cidade · UF · Chave_de_Acesso · Valor NE ·
  Peso_Liquido · Peso_Bruto`. Entram só a nota (NE) e o cliente; CNPJ e
  chave de acesso NÃO ficam no resultado (teste garante).
- Notas antes do número → `SIST_SEM_CARGA`; carga sem nota → `SIST_SEM_NOTAS`.

**O par.** As duas leituras entram num LOTE e pareiam pelo número da carga.
Se um B2B sozinho não casar, a segunda rede (`parearPeloNumeroDoSistema`)
pareia com o Atak sozinho cujo número é a carga externa dele ou o final do
número dele — só com um candidato, e dizendo na prévia. Qualquer outro PDF
(`RELATORIO_DESCONHECIDO`), arquivo que não é PDF, vazio, truncado ou com
mais de 6 MB / 300 páginas é recusado com a razão.

**O que "jamais errar" quer dizer aqui:** o painel não grava nada que não
tenha conferido nota a nota, e tudo o que foge do modelo vira recusa ou
aviso visível na prévia — nunca número inventado, nunca dedução em
silêncio. Um formato novo de terceiro é recusado com explicação até ser
ensinado aqui, com exemplo e teste.

## Como funciona

1. **Importar relatórios (PDF)** — escolhe os PDFs (de uma ou várias cargas). O
   servidor lê cada um (`pdfjs-dist`, por posição na página) e guarda a leitura
   num LOTE (`pgfrete_leituras`, some em 1 dia). A prévia mostra, por carga, as
   contagens, a situação, as pendências e o que mudaria numa carga já no
   controle. **Confirmar** grava o que o servidor leu — a tela não manda dado.
2. **A grade** (`GET /api/pagamento-frete`) — uma linha por pendência; a
   primeira de cada carga traz as contagens. Reimportar o mesmo par não muda
   nada; a nota que vira Finalizado sai da fila (`resolvida_em`) e guarda a
   tratativa; se voltar a ficar pendente, reabre.
3. **Trabalhar a planilha** — tratativa por nota (lista de escolha; a data fica
   a do dia), transportadora / CT-e / observação por carga, **pagamento** por
   carga (percentual; acima do liberado pergunta; 100% é teto; anular exige
   motivo e não apaga), histórico (pagamentos, notas, quem mexeu).
4. **Exportar planilha** — o XLSX com as mesmas células da tela
   (`planilha_frete_export.js` lê a mesma `montarGrade()`).

## Onde está

```
backend/src/dominio/pagamento_frete.js        regras: situação, tratativas, indicadores por carga
backend/src/dominio/relatorios_frete_pdf.js   leitura dos PDFs do B2B e do Atak
backend/src/dominio/planilha_frete_grade.js   A GRADE (tela = arquivo) e o resumo
backend/src/dominio/planilha_frete_export.js  o XLSX (estilos, fórmulas, RESUMO, LEIA-ME)
backend/src/dominio/planilha_controle.js      o painel entende a planilha (original e exportada) — sem botão
backend/src/dominio/pagamento_frete_banco.js  o que entra e sai do banco
backend/src/rotas/pagamento_frete.js          as rotas (setor Pagamento de Frete ou Administração)
backend/src/servicos/pdf_texto.js             texto do PDF com posição (6 MB, 300 páginas, 20 s)
backend/src/servicos/planilha_xlsx.js / planilha_xlsx_escrita.js   ler / escrever .xlsx (fflate; sem `xlsx` do npm)
backend/migrations/058_pagamento_frete.sql    o setor na CHECK + 5 tabelas pgfrete_*
backend/migrations/059_canhoto_original.sql   a caixinha do canhoto (3 colunas em pgfrete_cargas)
backend/migrations/060_tratativas_rodada2.sql  o vocabulário das tratativas (CHECK + conversão)
app/76_pagamento_frete.js · tema2027/75_pagamento_frete.css   a aba
vitrine/frete_demonstracao.json               a demonstração (saída de montarGrade com as cargas 9008xx)
```

## As provas

- `backend/testes/pagamento_frete_leitura.test.js` — regras, PDFs de exemplo
  (inventados, inclusive 40 notas em 2 páginas e vários cargas num PDF),
  tela == arquivo célula a célula, ida e volta da planilha, escritor de xlsx.
- `backend/testes/api.test.js` bloco 49 — acesso por setor, importar (ler →
  prévia → confirmar), tratativa, pagamento (pergunta, teto, anular, dois ao
  mesmo tempo), reimportar, exportar, servidor sem a migração (503 explicado).
- `testes/test_pagamento_frete_aba.py` — o caminho da Daniela no painel inteiro
  com a API: quem vê a aba, importar os dois PDFs, a grade com as 22 colunas,
  tratativa pela lista, pagamento pelo modal, exportar, celular.
- O arquivo gerado: XML validado contra as schemas OOXML (xmllint) e as 129
  fórmulas recalculadas pelo LibreOffice sem usar os valores gravados — 0
  divergências (prova feita em 05/10/2026, fora do repositório).

## O que ainda depende de resposta

- Daniela: o sentido das tratativas como escrito no LEIA-ME; a transportadora
  (os PDFs não a trazem — hoje é preenchida à mão; pode vir da rota da carga).
- B2B/Atak em outro formato que não PDF: sem amostra, não entra.
