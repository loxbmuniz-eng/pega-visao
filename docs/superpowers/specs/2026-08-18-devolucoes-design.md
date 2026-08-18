# Aba DEVOLUÇÕES — checklist digital de devoluções

Data: 18/08/2026 · Aprovado pelo dono do projeto (Luis) após relato da Carol,
foto do checklist em papel e reunião com Alysson e Bruna. Decisão de entrada:
**lançamento direto no painel** (sem importar/ancorar arquivo Excel — o painel
é a fonte única; importar planilha pode virar conveniência futura, fora deste
escopo).

## O problema

O processo de devoluções roda em papel: as operadoras da Logística redigem um
checklist, imprimem e levam à Portaria. Faltas e produtos que chegam fora do
checklist são anotados à caneta na folha. O ciclo passa por Portaria →
balança do Faturamento → descarga na Expedição → Controles Internos
(destinação) → Central de Notas (finaliza a NF), cada etapa assinando o papel.
Retrabalho, extravio e zero rastreabilidade.

## O processo (validado passo a passo com o usuário)

1. NF devolvida fica ~4 dias na planilha de revenda; não revendida, a
   Logística **gera a devolução** — a transportadora traz a mercadoria.
   (A espera de 4 dias fica FORA do painel nesta fase; o painel entra quando
   a devolução é gerada.)
2. Cada operadora cria o SEU checklist; autoria sempre discriminada.
3. Caminhão chega: Portaria marca Recebido, imputa **lacre(s) e nº da carga**;
   nome do porteiro sai automático (operador logado).
4. Balança do Faturamento: devolução aparece na fila deles como tipo distinto
   da programação de embarque; **peso final é opcional** (às vezes a pesagem é
   só conferência visual de que a mercadoria está lá).
5. Expedição descarrega e confere item a item: lança a **quantidade
   recebida**; o sistema aponta a falta sozinho (checklist 5 cx, chegou 3 →
   falta 2). O que chega fora do checklist entra em **divergentes**;
   substituição NÃO cancela a falta.
6. Controles Internos (setor novo): destinação por item — ESTOQUE, DESCARTE
   ou REPROCESSO — e observações que saem no relatório.
7. Central de Notas finaliza a nota fiscal e encerra o ciclo.

## Modelo de dados (espelho do checklist em papel)

**devolucoes** (cabeçalho): id, numero (sequencial gerado), data_dev,
rota (obrigatória — identifica o checklist na conferência), regiao,
transportadora, nota_transferencia, placa, motorista, carga_numero (Portaria),
lacre1, lacre2 (Portaria), peso_final (Faturamento, opcional), status,
criada_por/criada_setor, carimbos por etapa (operador + timestamp de
portaria, faturamento, expedicao, controles, notas), obs_controles,
criado_em/atualizado_em/excluida_em/versao.

**devolucao_itens**: nota, parcial (bool), supervisor, vendedor, cod_cliente,
cx, peso, cod_produto, produto_nome, num_dev, data, motivo,
qtd_recebida (Expedição; NULL = não conferido), destinacao
(Estoque/Descarte/Reprocesso, Controles Internos).
Falta = cx − qtd_recebida, sempre CALCULADA, nunca gravada.

**devolucao_divergencias**: cod_produto, cx, observacao — produtos recebidos
fora do checklist.

**Cadastros**: dim_supervisores, dim_produtos (codigo + nome, ex.:
30110-LINGUIÇA), dim_motivos_devolucao — mantidos por Logística/Administração
na aba Cadastros, para escolher em vez de digitar.

**Revisões**: devolucao_revisoes por trigger (mesmo motor de carga_revisoes);
restauração admin-only (mesmo padrão das cargas).

## Máquina de estados

Lançada → Recebida na Portaria → Conferida no Faturamento →
Descarga conferida (Expedição) → Destinada (Controles Internos) →
Nota finalizada (Central de Notas). Sentido único; as "assinaturas" do papel
viram carimbos automáticos (operador logado + hora) a cada transição.

## Permissões e fases

- **Fase 1 (esta entrega)**: a aba DEVOLUÇÕES aparece SÓ para Logística e
  Administração. Eles criam, editam tudo (controle total, como a Fila de
  Programados), executam TODAS as etapas (para alimentar e auditar o processo,
  como definido na reunião) e geram o relatório. O servidor confere setor em
  toda rota.
- **Fase 2 (só com autorização futura do usuário)**: Portaria vê os checklists
  do dia em tempo real e recebe com um clique; Faturamento ganha fila
  "Devoluções chegadas"; Expedição confere na aba dela; nascem os setores
  Controles Internos e Central de Notas com login próprio. O modelo de dados e
  a máquina de estados desta fase 1 já suportam isso — fase 2 é abrir portas,
  não reconstruir.

## Arquitetura

- Backend: migração nova (tabelas acima + trigger de revisões), domínio
  `devolucoes.js`, rotas `/api/devolucoes` (CRUD + transições de etapa +
  divergências + revisões) e `/api/cadastros` estendido (supervisores,
  produtos, motivos). Socket: eventos `devolucao:atualizada` para tempo real.
  Log em log_eventos.
- Frontend: módulo novo `devolucoes.js` (arquivo separado, inlined pelo
  build_arquivo_unico.py — app.js já está grande demais). **Servidor-first**:
  a aba busca do servidor ao abrir e grava direto na API (com aviso claro
  quando sem conexão). NÃO entra na máquina de sincronização offline das
  cargas — decisão deliberada: as operadoras trabalham em mesa com rede, e o
  custo/risco de estender o motor de eco/fila offline não se paga aqui.
  No modo "Entrar sem servidor" a aba explica que devoluções exigem conexão.
- Relatório de Devoluções do dia: mesmo padrão dos existentes (cabeçalho,
  PDF A4, fuso America/Sao_Paulo, filtro por data), com checklist completo,
  faltas e divergentes destacados, destinação + observações dos Controles
  Internos e autoria de cada checklist.

## Testes

- Backend (node --test): CRUD com permissão por setor; transições de etapa em
  sentido único com carimbos; qtd_recebida/divergências; revisões + restauração
  admin-only; cadastros novos.
- Playwright: fluxo completo fase 1 (criar → receber → pesar → conferir com
  falta automática → divergente → destinar → finalizar), aba invisível para
  outros setores, relatório do dia com autoria, tempo real entre dois
  navegadores.

## Fora de escopo (registrado para não perder)

- Importação/anexo do Excel das operadoras (conveniência futura).
- Controle do prazo de 4 dias da planilha de revenda.
- Fase 2 (aberturas por setor + setores novos) — aguardando autorização.

## Adendos aprovados na mesma data (18/08/2026)

1. **Setores criados já na fase 1** (pedido direto: "na verdade já pode
   criar"): CONTROLES INTERNOS e CENTRAL DE NOTAS existem como setores de
   login (migração 011). Veem só a aba Devoluções + Histórico; cada um
   executa exatamente o próprio passo do checklist (Controles Internos:
   destinação por item + observações + etapa "Destinada"; Central de
   Notas: etapa "Nota Finalizada"). A Expedição já pode conferir
   quantidade quando a aba abrir para ela.
2. **Produto com quilo**: dim_produtos ganha peso_caixa_kg (migração 011).
   O lançamento sugere o peso da linha (caixas × kg/caixa) quando a
   operadora não digita peso; número digitado nunca é sobrescrito.
3. **Checklist com VÁRIAS rotas** (pedido: "tem checklist que tem mais de
   uma rota — utilizar nome da região e código de rota"): tabela
   devolucao_rotas (migração 012), cada código validado contra dim_rotas.
   A identificação do checklist passa a ser REGIÃO + rotas, no cartão e
   no relatório. Troca de rotas fica no log de eventos.
4. **Campos de cada posto no cabeçalho** (teste do usuário com login de
   Portaria): a Portaria edita placa, transportadora, motorista, nº da
   carga, lacres e nota de transferência direto no cabeçalho; o
   Faturamento edita o peso final; os Controles Internos, o RDC. Todo o
   resto continua sendo da Logística. A regra é do SERVIDOR (allowlist por
   setor no PATCH); o painel só espelha.
5. **SOBRAS** (migração 021): checklist do que só ENTRA — sem carga e sem
   rota, itens com caixa, peso, produto e motivo (652 — Sobras, semeado no
   cadastro). Ciclo curto: Portaria OK → Faturamento OK → Expedição OK, e
   acabou. Destinada e Nota Finalizada não existem para sobra — nem para a
   Administração (409 ETAPA_NAO_EXISTE_PARA_SOBRA).
6. **Relatório de devoluções nas outras abas**: o mesmo relatório do dia
   ganhou um cartão na aba Relatórios, com escolha de data (abre no dia de
   hoje). A lista é SEMPRE re-buscada do servidor no clique — o PDF sai com
   o status atual de cada checklist, não com o retrato de quando a tela
   abriu.
7. **RDC / Romaneio** (migração 022, pedido: "na destinação o controle
   interno precisa ter um campo para informar se gerou RDC"): campo do
   cabeçalho com três estados — não informado, gerou, não gerou. Informado
   junto com a etapa Destinada ou direto no cabeçalho; escopo exclusivo dos
   Controles Internos (Logística/Administração cobrem). Sai no relatório.
8. **A mesma nota em duas parciais** (migração 023). Caso real relatado: o
   cliente recebe duas caixas do mesmo produto, uma fora de temperatura e
   outra avariada, e emite DUAS parciais na mesma nota fiscal — cada uma
   com seu motivo e seu Nº DEV. Duas mudanças: (a) o item ganha o NÚMERO DA
   PARCIAL (coluna PARCIAL da capa de papel, confirmada em foto), que é o
   que amarra cada Nº DEV à caixa certa; (b) o botão "➕ mesma nota" repete
   nota, cliente, RCA, supervisor e produto numa linha nova, deixando em
   branco só o que muda entre as caixas. O motivo passa a aparecer por
   extenso embaixo da caixa de seleção, porque a coluna é estreita e o
   código sozinho não diz nada a quem confere.
