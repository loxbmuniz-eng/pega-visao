# Registro de ocorrências — Programação de Embarque Suinco

Toda ocorrência relatada pela operação, o que a causou de verdade, o que foi
feito, e **qual teste impede que ela volte**. Uma ocorrência só é dada por
encerrada quando tem essa última coluna preenchida — correção sem guarda é
correção que volta.

Ordem: mais recente primeiro. Pedido do gestor em 21/08/2026: *"salve no
backend os issues completos de tudo que tem acontecido e resolva pra sempre
os problemas"*.

**Como ler:** o "Relato" é a frase de quem viu o problema, não a minha
interpretação dele. A "Causa" é o que estava errado no sistema — não é a
mesma coisa que o sintoma, e várias vezes nesta lista o sintoma apontava
para o lugar errado.

---

## Índice por família

As ocorrências se repetem em quatro famílias. Reconhecer a família é o que
faz achar a próxima em minutos em vez de horas:

| Família | O que é | Ocorrências |
|---|---|---|
| **Campo esquecido em um dos três pontos** | Carga tem três lugares onde um campo precisa existir: ida (`data.js`), volta (`suinco-api.js`) e conversão (`cargaDeLinhaRemota`). Faltando em um, o dado some sem erro em tela. | #02, #09 |
| **Eco de sincronização** | Todo painel reenvia o que tem em memória. Cópia velha sobrescreve dado novo — inclusive com campo vazio. | #01, #03, #08, #10 |
| **Rótulo que mente** | O dado está certo no banco; o nome dado a ele na tela descreve outra coisa. | #04, #12 |
| **Regra larga demais** | Trava criada para um caso real barra também o caso legítimo mais comum. | #05 |
| **Trava sem o par na tela** | O servidor passa a exigir algo novo e a tela continua com o botão antigo: quem clica só descobre que não pode, e não tem por onde seguir. | #13, #73 |
| **A mesma decisão escrita em dois lugares** | A regra é copiada em vez de consultada. As cópias divergem e o comportamento fica errado sem que nenhuma linha esteja errada. | #14, #26, #73 |
| **Duas escritas em voo, a velha ganha** | O painel manda a carga INTEIRA a cada alteração. Duas alterações seguidas viram duas requisições simultâneas, e a primeira carrega o valor velho do campo que ainda ia mudar. | #16 |
| **A correção que outro setor desfaz sem saber** | Um setor corrige de propósito o que outro fez. A tela do segundo continua mostrando o estado como se nada tivesse sido decidido, e o gesto normal dele desfaz a correção — em silêncio, dos dois lados. | #21 |
| **A proteção escrita para um posto só** | A regra certa existe, com comentário e tudo — mas vale para um caminho e não para os irmãos dele. Não é cópia divergente: é a cópia que nunca foi escrita. | #20 |
| **A tela não oferece o que o servidor aceita** | A rota grava o campo, mas a coluna correspondente é texto. Quem precisa registrar o dado escreve no primeiro campo que aceita digitação — e ele vai parar onde ninguém procura. | #19 |
| **Dois filtros para a mesma tela** | Duas filtragens paralelas sobre os mesmos dados. Uma move os números, a outra move os gráficos, e nada avisa que discordam. | #18 |
| **O teste que carimba a leitura errada do pedido** | O teste está novo e verde, e mede exatamente o que foi escrito — só que o pedido foi entendido ao contrário. Verde prova que o código faz o que o teste diz, não que a regra está certa. Mudança que REMOVE algo da tela precisa do teste que garante que o trabalho de quem usava aquilo ainda é possível. | #23 |
| **Dois fatos com prazos diferentes tratados como um só** | Cada dado está certo no seu lugar; o defeito nasce de perguntar a um deles algo que só o outro sabe (`DB.operador` no localStorage vive para sempre; o token no sessionStorage morre com a aba). Reconhece-se assim: o mesmo relato volta com roupa nova depois de cada correção. Corrigir no nível do sintoma nunca fecha. | #25 |
| **Teste que mede o proxy, não a regra** | O teste confere um sintoma fácil de medir ("a aba aparece?", "quantas linhas?") em vez da garantia real, ou monta um cenário que deixou de corresponder ao sistema. Quando o sintoma muda por um motivo legítimo, ele fica vermelho sem que nada tenha quebrado — e aponta para o lugar errado. | #15, #22 |
| **Decisão aplicada no nível errado** | A intenção está certa e o alvo não. Proibir quebra na TABELA quando bastava na linha; gravar por LINHA quando bastava por lote; desligar `animation` quando o que apagava o conteúdo no papel era o estado de repouso. Reconhece-se assim: o sintoma aparece longe da causa, e a correção não é remover a regra — é descê-la um nível. | #71, #72, #74 |
| **Enfeite no caminho crítico** | A animação espera, e o trabalho espera atrás dela. Nada fica errado: fica mais lento, e o teste reprova numa conferência de DADO ("a rota aparece na tabela?") que aponta para o lugar errado. Movimento anda ao lado do trabalho, nunca na frente. | #74 |

---

## #34 — Arrastar na Torre, sem repetir a #27 (09/09/2026)

**Pedido do dono:** "quero conseguir arrastar a ordem do sequenciamento de
carga na torre de controle". Perguntado se o campo de número deveria virar
posição (A) ou continuar livre (B): *"a e b, se mudar o numero reordena se
arrastar reordena, os 2 precisam funcionar, mantendo a logica e a sequencia"*.

**Por que isso exigia cuidado.** De manhã, a #27: a Torre e a Fila
compartilhavam `atualizarSequenciaUI`, mandei todo inteiro para a cascata, e
a Torre parou de guardar o número digitado — o defeito de 14/08 de volta.
Fazer os dois caminhos reordenarem na Torre é justamente reabrir aquela
porta, se for feito do mesmo jeito.

**A diferença que resolve.** Na #27 quem decidia era a TELA (Torre × Fila) e
a pessoa não tinha como saber qual comportamento ia acontecer. Aqui quem
decide é o **STATUS DA LINHA**, que está visível: a alça só aparece onde
arrastar funciona, e o `title` do campo diz qual é a regra daquela linha.

    ainda vai carregar  → digitar = posição, cascata no servidor
                          (mesmo caminho do arrastar: uma conta só)
                          arrasto com alça
    já carregou         → o número é registro: guarda o valor, carimba para
                          subir, e NÃO reordena ninguém · sem alça

`definirSequenciaTorreUI` só delega — `definirPosicaoNaFilaUI` para a fila,
`atualizarSequenciaUI` para o registro. Nenhuma conta nova, nenhuma rota
nova: o servidor já fazia a cascata desde 08/09.

**A guarda.** `testes/test_torre_arrasta_sequencia.py` — quem ainda carrega
tem alça e arrasta; quem já carregou não tem e não arrasta; digitar 9 numa
carga carregada guarda 9, carimba e não mexe em ninguém; sem servidor a fila
não anda sozinha. Reprovava contra o publicado.

**A correção do meu próprio teste, no meio do caminho.** Uma checagem lia o
carimbo DENTRO de `definirSequenciaTorreUI` — mas ela delega, e o carimbo
mora na função de destino. Era a causa nº 2 das quatro (o teste mede um
atalho que mudou de forma), não regressão: a checagem de comportamento
logo abaixo, com carga de verdade, já provava o carimbo.

---

## #33 — O painel ia encher o navegador sozinho, e podar sem buscar seria perder acesso (09/09/2026)

**Não é defeito relatado: é defeito medido antes de acontecer.** A auditoria
de arquitetura mediu, em Chromium: o painel nunca esquecia carga concluída.

    300 cargas    → Indicadores 468 ms
    1.500 cargas  → 5.073 ms A CADA SINCRONIA (6–8 semanas de operação)
    5.000 cargas  → 10.927 ms, e o localStorage estoura a cota (9,4 MB)
                    com o save() falhando SÓ NO CONSOLE

O `catch` do `save()` era `console.error` e nada mais: a cópia local pararia
de atualizar sem ninguém perceber, e depois de um F5 voltaria uma versão
velha até a primeira leitura terminar.

**A conversa que definiu a correção.** Proposta a poda, o dono respondeu
*"nao da pra ter acesso a tudo no navegador"* e, em seguida, *"pode ser de
30 dias mas se eu quiser buscar mais ele vai aparecer né?"*. É a regra da
casa dita por ele: podar sem caminho de volta não é economia, é perda de
acesso.

**Correção.** `JANELA_LOCAL_DIAS = 30`. `podarLocal()` roda na fusão e tira
da memória a carga **concluída** cuja saída passou da janela, com as
movimentações dela — nunca carga aberta, nunca carga com gravação em voo
(`_pendente`/`_statusPendentes`). O servidor ganhou
`GET /api/historico?de=&ate=` (concluídas do período + linha do tempo, teto
de 90 dias por consulta, filial barrada, leitura registrada em
`log_leitura`). Na tela, `garantirPeriodoNoPainel()` — uma função, três
chamadores (Histórico, Indicadores, Relatórios): pediu período anterior à
janela, busca e funde **em memória**, marcado `_doServidor`. Com isso
nenhum cálculo mudou — Raio-X, Gargalos, comparação por período e o PDF
passaram a enxergar o passado sem saber de onde ele veio.

**Os dois vazamentos que o teste pegou.** (1) O que vem do servidor não
pode ser gravado nem reenviado: `save()` filtra e `sincronizarCargasAlteradas`
ignora `_doServidor`. (2) Faltava filtrar `_sincronizado` — a MARCA de
sincronização guarda id de carga, e sozinha ela traria de volta o
crescimento que a poda fecha. O teste reprovou exatamente nisso antes da
segunda correção.

**A guarda.** `testes/test_poda_com_acesso_a_tudo.py` — a de 60 dias sai, a
de 10 fica, a aberta de 90 nunca sai, sem servidor a tela DIZ que só tem 30
dias, e com servidor a carga antiga volta com a linha do tempo, sem ser
gravada nem reenviada.

**A lição.** Toda economia de memória precisa vir com o caminho de volta, e
o caminho de volta precisa ser *silencioso quando funciona e explícito
quando não funciona*. Mostrar 30 dias calado para quem pediu 90 seria a
família "número errado com cara de certo" — pior que a lentidão que a poda
resolve.

---

## #32 — A carga dizia "Rodosousa", a Frota dizia "Denia" (09/09/2026)

**Relato do dono (fotos):** carga 118675, placa JJB8946 — a Torre mostrava
"Rodosousa / Truck"; o cadastro da Frota, "Denia Transportes / Truck".

**A causa.** A transportadora da carga é uma CÓPIA feita quando a placa
entra (`atualizarPlacaUI`, criação) e o campo continua editável à mão na
expansão ("da Frota — dá para trocar"). Depois disso as duas podem
divergir por dois caminhos, ambos silenciosos: alguém troca à mão na carga
(sem nota no Histórico — a trilha por gatilho guarda, mas ninguém lê ali),
ou a placa muda de transportadora na Frota (`POST /frota`, `ON CONFLICT DO
UPDATE`) sem propagar às cargas abertas e sem registrar no log. E nenhuma
tela mostrava a diferença: a Torre e a Fila mostram a cópia; o Cadastro
mostra a Frota. Duas fontes da verdade, cada uma certa sozinha. As notas da
base dizem que 85 placas mudaram de transportadora em 2 anos — é rotina.

**Decisão do dono: opção A.** Quando a placa muda de transportadora na
Frota, as cargas ABERTAS daquela placa acompanham, com log; as concluídas
ficam como registro; trocar à mão na carga continua permitido, mas marcado
e registrado.

**Correção.** `POST /frota` numa transação: grava a Frota, atualiza a
transportadora das cargas da placa que ainda não saíram, escreve uma nota
no Histórico por carga e uma da troca em si (mesmo sem carga aberta), emite
`carga:atualizada`; regravar a mesma transportadora não escreve nada.
`PATCH /cargas/:id` que troca a transportadora escreve a nota "trocada à
mão: de → para (Frota: X)". Na tela, `marcaTransportadoraHtml`: quando a
carga ≠ Frota, o marcador "≠ Frota: X" na Torre e na Fila, com um clique
"usar a da Frota". `gravarNota` (só log_eventos) é uma função exportada de
cargas.js e usada por cadastros.js.

**As guardas.** `api.test.js` bloco 41 (aberta acompanha, concluída fica,
log da troca, eco não escreve, troca à mão registrada com o que a Frota
diz) e `testes/test_transportadora_divergente.py` (marcador na Fila e na
Torre; clique alinha; carga alinhada sem marcador). Ambos reprovando antes.

**A lição.** Cópia de cadastro dentro do registro da viagem é decisão
legítima (a viagem pode ter transportadora própria) — mas cópia sem
marcador e sem rastro vira duas verdades. Quem copia precisa (1) mostrar
quando divergiu, (2) registrar quem divergiu, e (3) decidir com o dono o
que acontece quando a origem muda.

---

## #30 — A carga programada ontem sem veículo "sumia" da Fila (09/09/2026)

**Relato do dono:** "A carga criada ontem, mas não contratada na programação
de ontem (...) ela some da programação. Ela começou a ser montada, mas a
placa não foi contratada, então vai sumir da programação. Isso não pode
acontecer." E, em seguida: "seria bom conseguir acessar a fila de
programados de cada dia."

**Reproduzido em modo local:** a carga estava GRAVADA — servidor,
observações digitadas, tudo — e aparecia na Torre em "Programação
anterior". A Fila de Programados listava só o dia de hoje (`doDia`, decisão
de 28/08 para a fila "ter a cara da Torre") e transformava as outras numa
linha: "veja na Torre de Controle". Para quem programa — que trabalha na
Fila — isso é sumir.

**Correção.** A Fila ganhou o dia (`◀ [data] ▶ Hoje`, padrão hoje; a mesma
linha editável e o mesmo arrasto, que o servidor já sequencia por dia) e um
bloco fixo abaixo, "Ainda sem veículo — programadas em dias anteriores",
que aparece independente do dia escolhido, com a data de cada carga,
editável (placa e número — dá para contratar ali), sem arrasto (a sequência
é do dia de cada uma). A linha da fila virou UMA função (`linhaFilaHtml`)
usada pelas duas listas. Nada mudou no servidor: o dado sempre esteve lá.

**A guarda.** `testes/test_fila_por_dia.py` — 7 checagens reprovando contra
o painel publicado.

**A lição.** "Está salvo" e "está onde a pessoa trabalha" são coisas
diferentes. Um aviso apontando para outra aba não substitui a linha no
lugar certo — quem programa não vai procurar na Torre o que sumiu da Fila.

---

## #31 — Trava de versão nunca acionada, reentrada com duas réguas, painel que congela (09/09/2026)

**Onde apareceu:** auditoria de arquitetura pedida pelo dono. Três altos,
todos medidos ou reproduzidos:

1. **O servidor tinha bloqueio otimista por `versao` e o painel nunca a
   mandava** — nos três pontos de sincronia (ida, volta, conversão) o campo
   não existia. Dois terminais online editando a mesma carga era "o último
   grava por cima", sem aviso: a Expedição põe 33 ganchos, a Logística com
   cópia de 20 s atrás altera o peso, e o PATCH dela leva ganchos = 0.
   Família da #16, entre terminais diferentes.
2. **A regra de reentrada estava escrita duas vezes, diferente.** O servidor
   compara com o dia de programação da carga que CHEGA; a tela comparava com
   HOJE no relógio do aparelho — e nem chamava o servidor. Duas cargas
   programadas ontem à noite para hoje (rotina, #07): a tela barrava a
   segunda entrada num caso em que o servidor aceitaria. A #06 de volta.
3. **O painel nunca esquecia carga concluída e redesenhava
   O(cargas × movimentações)** — `historicoDaCarga` filtrava e ordenava tudo
   a cada chamada, 5× por carga por render. Medido aqui: 1.500 cargas,
   **11,3 s** para desenhar Indicadores (o agente mediu 5,1 s; a base
   embaralhada piora). Ia chegar sozinho em ~6 semanas.

**Correções.** `Versao` nos três pontos; o PATCH leva a versão lida; 409
`CONFLITO_DE_VERSAO` recarrega a carga com o que está no servidor e avisa
("confira e refaça"); a versão nova volta da resposta e substitui a local
(sem isso a PRÓXIMA edição do mesmo terminal levaria 409). Reentrada: a
régua da tela passa a ser o dia da carga que chega, como no servidor.
Índice `cargaId → movimentações` reconstruído quando a lista muda, com
invalidação explícita no caminho da sincronia (splice + push mantém o
tamanho — o índice não perceberia). No mesmo lote, os médios de esforço P:
"hoje" do Modelo/Montagem em São Paulo e não em UTC; sessão revogada cai
do socket (mesma conferência do HTTP, e o bloqueio derruba as conexões);
`|| null` apagando capacidade zero na ida da Frota; o botão de reset de 2º
fator que tinha rota e função mas não tinha onde clicar.

**As guardas.** `testes/test_trava_de_versao.py` (PATCH leva versão; cópia
velha é recusada, recarregada e avisada; nada gravado por cima; com a
versão certa grava), `testes/test_reentrada_mesma_programacao.py`,
`testes/test_indicadores_nao_travam.py` (1.500 cargas: 11.368 ms → abaixo
de 2.500 ms), `api.test.js` bloco 40 (socket recusa sessão revogada;
`hojeISO` é o dia de São Paulo). Todas reprovando contra o publicado.

**A lição.** Uma proteção que existe só de um lado não protege: a trava de
versão estava no servidor havia semanas e nunca foi acionada porque o
painel não mandava o campo. E a regra que precisa existir nos dois lados
(a tela avisa sem esperar a rede) tem que ser a MESMA regra, com o mesmo
dia de referência — senão a tela nega o que o servidor permitiria.

---

## #29 — O Relatório Executivo dizia "0 paradas" com um caminhão parado 17h47 (09/09/2026)

**Onde apareceu:** na auditoria de fidelidade dos indicadores pedida pelo
dono — 17 KPIs lidos da tela real e conferidos contra o SQL no mesmo
instante. A aritmética acertou ao minuto em todos. O que mentia era a
**guarda de entrada** e o **rótulo de recorte**. Cinco achados altos, todos
reproduzidos em cenário controlado:

    Parada há 17h47min  →  (uma observação escrita)  →  Parada há 0 min
    PDF Executivo: "0 Paradas Além da Meta" duas linhas acima de "Aguardando Embarque 06:00"
    Tempo Médio de Pátio — histórico: −243.504 min (a conta certa: 3h00min)

**As causas.**
1. `pendentesAntigas.paradaHaMin` (data.js) e `paradasAlemDaMeta` (PDF, app.js)
   contavam por `atualizadoEm` — a hora da GRAVAÇÃO. Abrir o painel regrava
   as cargas (eco de sincronização: 12 de 12 regravadas 6 s depois de abrir),
   então o indicador lia zero justamente com o painel em uso. É a **#08** de
   novo: a correção (`acao_em`, migração 026) nunca alcançou esses dois
   pontos, e `entradaNoPatioDe()` — a definição certa — morava em `app.js`,
   onde `data.js` não alcança.
2. `minutosEntre` não tinha guarda de sinal; uma chegada carimbada em 2029
   virava −243.504 min e entrava em toda média, sem contagem à parte. O "%
   acima da meta" até *melhorava*, porque a carga impossível inflava o
   denominador.
3. `renderComparacaoPeriodos` chamava `indicadoresPorPeriodo(p.key)` sem o
   filtro — a nota "só este recorte" era falsa para a maior tabela da aba
   (família da **#18**).
4. `renderGargalos` usava `DB.cargas` inteiro sob um subtítulo que prometia
   "o período selecionado acima".
5. Evento no futuro entrava nos cartões e sumia das tabelas de período —
   a mesma tela dizia "5 cargas" num bloco e "sem dados" no outro.

**Correções.** `entradaNoPatioDe` movida para `data.js` (uma definição para
Torre, PDF e reconciliação da Portaria); `minutosNoPatioAgora(c)` e
`paradasAlemDaMeta(cargas)` — uma função, dois chamadores; `minutosEntre`
devolve null para duração negativa; `dataDeEventoPlausivel` + `carimbosDaCarga`
+ `cargasComDataInconsistente` — o que sai da conta **fica na tela** ("N
carga(s) fora da conta por data inconsistente: …"); `indicadoresPorPeriodo`
recebe o filtro; Gargalos = concluídas no período + abertas de agora;
"sem registro de chegada" no lugar de zero. No mesmo lote, dois achados de
UX da mesma auditoria: as 11 abas ganharam `role="tab"`/`tabindex`/Enter
(teclado não as alcançava) e o `--gold-text` do tema claro subiu de 4,33:1
para 4,83:1 na página e 6,79:1 no card.

**A guarda.** `testes/test_indicadores_dizem_a_verdade.py` — 19 checagens,
13 reprovando contra o build publicado (paradaHaMin=0 com 17h47; média
−303.876; tabela idêntica com filtro; VELHA LTDA nos gargalos de "Semana";
abas sem role; dourado 3,98 na página).

**A lição.** Número errado com cara de certo é pior que número nenhum. A
correção de um defeito (#08) precisa procurar TODOS os lugares que faziam
a mesma conta errada — e a conta certa precisa morar onde todo mundo
alcança. E: o que sai de uma média tem que aparecer na tela como
"fora da conta", com o número da carga; esconder o descarte é trocar um
número errado por um número sem explicação.

---

## #28 — A filial enxergava o pátio inteiro por fora da tela (09/09/2026)

**Onde apareceu:** na auditoria de segurança pedida pelo dono para o
refinamento geral — não na operação. Com o crachá de `filial@teste.local`,
rota por rota:

    GET /api/estado                          200 — 12 cargas, cliente, destino, motorista, placa
    GET /api/montagem                        200
    GET /api/modelo-semana                   200
    GET /api/programacoes                    200
    GET /api/devolucoes-cadastros/clientes-csv   200 — 77.099 linhas, sem registro

A regra do dono (02/09/2026) é literal: filial "so vai ter acesso a aba
devolucoes e escopo de devolucoes (...) as permissoes da filial sao restritas
a isso". O painel escondia os botões; o servidor entregava tudo a quem
pedisse pelo endereço.

**A causa.** As rotas de LEITURA nasceram para os cinco setores operacionais,
todas com `exigirLogin` e nada mais — um comentário em `dominio/documentos.js`
até registra que "GET /estado devolve o pátio inteiro a todo mundo, e isso é
FEATURE". Era, para cinco setores. As filiais entraram em 02/09 como exceção,
e a exceção chegou às rotas de devolução (IDOR, listagem, etapa — tudo
correto, conferido ao vivo) mas nunca às rotas de leitura geral. Família da
#26: um setor novo precisa entrar em N lugares, e um deles ficou de fora.

**Correção.**
- `recusarFilial` (middleware, `auth.js`) em `/montagem`, `/modelo-semana` e
  `/programacoes` — 403 com explicação.
- `/estado` para filial devolve a **mesma forma** com o pátio vazio e
  `escopo: 'devolucoes'`. Não é 403 de propósito: o painel chama essa rota
  no sincronismo de todo setor, e um 403 viraria faixa de "recusado" na tela
  da filial a cada poucos segundos.
- `clientes-csv` passa a ser `exigirSetor('Logística')` e registra a
  exportação em `log_leitura` (tipo `clientes-csv`). A busca por nome com
  teto de 30 continua aberta — é o que o checklist precisa.
- `/frota` e `/rotas` continuam abertas à filial: placa e rota são campos
  do checklist.
- No mesmo lote: `jwt.verify` com `algorithms:['HS256']` nos três lugares
  (o script `token_de_login.mjs` reprovava HS512 → 200) e o Chromium do PDF
  com rede bloqueada (`pagina.route('**/*', abort)`) — o relatório é
  autossuficiente e o `networkidle` esperava por qualquer endereço que o
  HTML pedisse.

**A guarda.** `api.test.js` bloco 39 — oito casos, seis reprovando antes da
correção (o pátio vazio para filial, os três 403, o CSV com registro, o
HS512 recusado) e dois que travam o que NÃO pode mudar (Logística segue vendo
tudo; filial segue lendo frota e rotas).

**A lição.** Esconder botão não é permissão. Toda regra de "quem vê o quê"
tem que existir no servidor, e o teste tem que bater no endereço, não na
tela. A #26 ensinou que setor novo entra em N lugares; esta ensina que um
desses lugares é a lista de rotas de LEITURA, que ninguém lembra porque
"todo mundo pode ler".

---

## #27 — A Torre parou de guardar a sequência digitada (08/09/2026)

**Onde apareceu:** no portão, não na operação. `test_edicao_marca_alterada`
reprovou, foi rodado sozinho com banco limpo, reprovou de novo — vermelho de
verdade, não contaminação. A publicação foi **cancelada pelo próprio portão**;
nada disso chegou a subir.

    [FALHA] a sequência mudou na tela de quem editou — {'seq': 1, 'ganchos': 33}
    [FALHA] a SEQUÊNCIA chegou ao outro terminal — esperado 7, veio 1
    [FALHA] a sequência continua 7 depois do sincronismo — {'seq': 1, ...}

**A causa.** `atualizarSequenciaUI` tinha **dois chamadores querendo coisas
diferentes**, e a implementação do sequenciamento novo só enxergou um:

| Tela | Título do campo | O que significa |
|---|---|---|
| Torre de Controle (`app.js:3038`) | "Sequência livre." | o número que o programador escreve — 7 vale 7, mesmo numa lista de 2 |
| Fila de Programados (`app.js:3437`) | "Digite a posição..." | posição na fila — o servidor renumera de 1 a N e as outras descem |

Todo inteiro foi roteado para `moverNaFilaUI()`. Na Torre, digitar 7 numa
fila de 1 carga virava "posição 7 não existe" → o servidor recusava (com
aviso na tela, isso funcionou) e a sequência ficava no valor antigo. Ou
seja: **o defeito de 14/08 de volta** — *"já alterei três vezes e ela não se
mantém na torre de controle"*.

**Correção.** Separar as duas perguntas: a Fila passou a chamar
`definirPosicaoNaFilaUI()`, e `atualizarSequenciaUI()` voltou a ser só o
editor de número livre da Torre, com o carimbo `atualizadoEm` intacto.

**A guarda.** Em `testes/test_fila_reordena_em_cascata.py`, duas checagens
novas que reprovam contra a versão quebrada (conferido no `git show`):
`a Torre NÃO passa pela fila` e `a Torre continua carimbando a carga como
alterada`. `test_edicao_marca_alterada` continua sendo a rede de baixo.

**A lição, que é o inverso da #14.** "Uma função, dois chamadores" existe
para impedir que a MESMA decisão seja copiada em dois lugares. Aqui foram
duas decisões DIFERENTES forçadas na mesma função porque compartilhavam o
nome do campo. Antes de unificar, a pergunta não é "é o mesmo campo?" — é
"é a mesma pergunta?". Neste caso o próprio `title=` das duas telas já
respondia que não.

---

## #26 — "Setor inválido" no cadastro do usuário de filial (02/09/2026)

**Relato, do dono, tentando criar o usuário da filial depois de a entrega
estar publicada:**

    "nao apareceu a filial pra cadastrar usuarios"
    "precisa ter esse setor pra eu poder cadastrar nao aparece"
    "ta dando setor invaldio ainda"

Três tentativas, três recusas — e a terceira **depois** de eu ter dito que
estava corrigido. É a parte que mais importa aqui: a primeira correção
resolveu o que eu tinha olhado, e eu afirmei "resolvido" sem ter feito o
cadastro passar do início ao fim uma única vez.

**A causa.** A lista de setores estava escrita em **seis lugares**:

| # | Onde | Tinha as filiais? |
|---|---|---|
| 1 | `backend/src/dominio/fluxo.js` | sim (entrei nele) |
| 2 | `backend/src/config.js` | **não** ← a recusa saía daqui |
| 3 | `data.js` (`SETOR_PERMISSOES`) | sim |
| 4 | `index_suinco.html`, cadastro de usuário | não (à mão) |
| 5 | `index_suinco.html`, filtro do Histórico | não (à mão) |
| 6 | `index_suinco.html`, login local | não (à mão) |

Mais a `CHECK` da tabela `operadores`, no banco.

A primeira correção fechou 4, 5 e 6 — os `<select>` passaram a ser montados
por código a partir de `data.js`. O setor apareceu na tela, o banco aceitava
(migração 043), e `POST /api/operadores` continuou recusando: ele valida
contra `SETORES` de **`config.js`**, que é um arquivo cujo assunto é `.env`
— host, senha, limite de requisição — e que ninguém pensa em abrir quando o
assunto é permissão de setor.

**O que eu fiz de errado, e não é o esquecimento.** No commit da primeira
correção eu escrevi, com todas as letras: *"eram CINCO cópias da mesma
lista. Criar um setor exigia lembrar das cinco, e eu lembrei de duas."*
Nomeei o risco e mesmo assim não fui procurar a sexta — e entreguei sem
executar o cadastro de ponta a ponta. A recusa que o dono levou é a que um
único `POST` teria mostrado.

**A correção.**

- `dominio/fluxo.js` passa a ser a **única** lista do servidor, com os onze
  setores e os comentários de cada um;
- `config.js` virou `export { SETORES } from './dominio/fluxo.js'` — quem já
  importava de lá não muda nada, e a cópia deixou de existir;
- restam duas listas — servidor e painel — porque o painel é build de
  arquivo único e não importa do backend. As duas ficaram travadas uma na
  outra por teste.

**O teste que trava.** Dois, e nenhum deles pergunta "a lista bate?":

1. `backend/testes/api.test.js` → *"todo setor oferecido aceita cadastro e
   login"*. Percorre `SETORES` e, para cada setor, **cria o operador pela
   mesma rota que a tela usa e faz ele entrar**. É o percurso inteiro: rota
   → validação → `CHECK` do banco → login. Contra o código com a lista velha
   ele reprova com a frase exata do relato: `setor "Filial 105 BSB" recusado
   no cadastro: {"erro":"Setor inválido..."}`.
2. `testes/test_setor_novo_aparece_nas_telas.py`, bloco 6 → a lista do
   painel tem que ser **idêntica** à do servidor, lida de `fluxo.js`.

Setor acrescentado em um lugar só reprova antes de chegar em quem cadastra.

**A lição, que é diferente da de #14.** Em #14 a lição foi "uma fonte, os
outros perguntam". Aqui a fonte foi criada e ainda assim quebrou, porque a
sexta cópia estava num arquivo cujo nome não tem nada a ver com o assunto.
O que fecha esse tipo de furo não é lembrar melhor: é o teste percorrer a
lista inteira pelo caminho de verdade. Enquanto o teste conferia se o setor
**aparecia na tela**, ele mediu o proxy — e o proxy estava verde enquanto o
dono levava "Setor inválido" na cara.

---

## #25 — CAUSA RAIZ: "já entrou uma vez" tratado como "está conectado agora" (31/08/2026)

**Esta ocorrência é a mãe das #24, e das quatro correções de emergência do
dia.** As outras descrevem sintomas; esta descreve por que eles existiam.

**Relato final, o que fez o dono parar tudo.** No meio da operação: *"acabei
de abrir aqui o painel e zerou tudo (...) zerou a programação que estava em
andamento, a torre de controle"*. E, logo em seguida, o dado que resolveu:
*"no celular tá aparecendo"*.

Essa segunda frase é o que provou que nada tinha se perdido. O celular tinha
sessão e lia do servidor; o desktop não tinha, e mostrava a cópia local —
vazia.

**A causa, em uma linha** (`app.js`, o revelar do painel):

```js
if(DB.operador && document.body.classList.contains('pre-login')){
  revelarPainel();
}
```

Dois fatos diferentes, guardados em lugares com PRAZOS diferentes, tratados
como um só:

| o que | onde mora | quanto dura |
|---|---|---|
| `DB.operador` (nome, setor, e-mail) | `localStorage` | para sempre |
| o token (a sessão de verdade) | `sessionStorage` | morre quando a aba fecha |

Quem entrou uma vez ficava "logado" para sempre aos olhos da tela. E no
celular a aba morre sozinha o tempo todo: o Android descarta aba em segundo
plano, e o 401 de sessão vencida chega ao mesmo lugar por outro caminho.

**A cascata que isso produziu, toda em 31/08:**

1. o painel revelava a tela de trabalho INTEIRA sem sessão nenhuma;
2. sem sessão ele não lê o servidor → Torre e programação mostravam a cópia
   local, ZERO num navegador limpo. O "zerou tudo";
3. nada do que se digitasse subia — e até a manhã daquele dia, calado
   (ocorrência #24);
4. não havia login na tela para sair do estado, porque aos olhos do painel a
   pessoa já estava logada;
5. e a faixa de offline que eu tinha acabado de criar ficava no topo, por
   cima da única saída — engolindo o toque no formulário.

**O erro de método, meu, e é o que interessa para a próxima vez.** Corrigi
os cinco itens acima um por um, ao longo do dia, cada um com teste. Todas as
correções estavam certas. Nenhuma era suficiente: enquanto a decisão de
revelar o painel olhasse um dado que sobrevive à sessão, o defeito voltava
com outra cara. Voltou quatro vezes, cada uma delas com a operação parada.

Quando o mesmo relato reaparece com roupa diferente no mesmo dia, o que está
errado não é a correção — é o nível em que ela foi feita.

**Correção.** `temSessaoParaOPainel()`: uma pergunta só, "esta pessoa pode
ver a tela de trabalho AGORA?". Quem entrou pelo servidor precisa de token;
quem escolheu "Entrar sem servidor" não tem e-mail e não depende de nenhum —
é decisão de quem usa, não acidente. Sem sessão, o painel não revela nada:
pede o login.

**E um achado que veio junto, medido ao travar o teste.** No celular
deitado (740x360), que é como o pátio segura o aparelho:

```
tela 360px · o bloco da marca ocupava 161px — 45% da tela
caixa do login: 91px visíveis, precisando de 296
botão "Entrar" em 388–440 → FORA DA TELA
```

O botão existia e era inalcançável. Abaixo de 480px de altura a marca sai e
a caixa usa a tela inteira: entre mostrar o logotipo e conseguir entrar,
entrar ganha.

**Testes que travam.** `testes/test_sem_sessao_nao_mostra_painel.py` (sem
sessão o painel não aparece; a Torre não fica visível zerada por trás; modo
local continua entrando; e QUEM TEM SESSÃO ENTRA NORMAL — a trava não pode
barrar quem está certo) e `testes/test_faixa_no_rodape_e_login_abre.py`, que
passou a exigir o botão DENTRO da tela, não só existindo.

**Família.** Nova, e é a mais cara da lista: **dois fatos com prazos
diferentes tratados como um só**. Não é cópia divergente (#14) nem proteção
escrita para um posto só (#20): os dois dados estão certos, cada um no seu
lugar, e o defeito nasce de perguntar a um deles uma coisa que só o outro
sabe. O sinal de reconhecimento é o relato voltar com roupa nova depois de
cada correção.

---

## #24 — Sessão vencida gravava no vácuo, e a tela dizia "offline" (31/08/2026)

**Relato.** Print do celular do Rene da Expedição, mandado pelo dono. Na
tela: a faixa vermelha "VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL", os botões
"Iniciar Embarque" e "Finalizar Embarque", a carga 118495 da placa MMJ9E91 —
e, no alto do aparelho, o indicador de **5G**. Ele não estava offline.

No rodapé, em letra pequena, o texto que denunciava o que era de verdade:
*"Sem conexão com o servidor — entre de novo para voltar a compartilhar"*.
Esse é o texto do estado `local`. A sessão dele tinha vencido.

**Causa.** O token mora em `sessionStorage` — morre quando a aba fecha. No
celular isso não é caso raro: o Android descarta aba em segundo plano o
tempo todo, e o 401 de sessão vencida chega ao mesmo lugar por outro
caminho. `DB.operador` fica no `localStorage` e sobrevive, então o painel
reabre parecendo logado, no estado `local`.

Sem token, `estaConfigurado()` responde não — e os CINCO caminhos de
escrita (`upsert`, `excluir`, `gravarFrota`, `gravarRota`, `mudarStatus`)
saíam com a mesma linha copiada cinco vezes: `return { enfileirado: false }`.
Sem recusa, sem fila, sem aviso.

Medido antes de mexer:

```
configurado: False        estado: local
respostaDoUpsert: {'enfileirado': False}    <- nenhuma recusa
cargaFicouNaTela: True    cargasDepois: 1
filaOffline: 0            avisoNaTela: False
```

Carga criada, guardada só no aparelho, nada enviado, nada enfileirado, nada
dito. O operador trabalha a tarde inteira gravando no vácuo.

**Por que a trava de offline não pegou.** Ela foi escrita para "a rede
caiu" e olhava o resultado da chamada de rede. "A sessão venceu" nunca chega
a fazer chamada nenhuma — sai antes, na guarda. E no pátio a sessão vencida
é o caso MUITO mais comum, porque o telefone fica com a aba aberta o dia
inteiro. A trava cobria o caso raro e deixava passar o frequente.

É o mesmo mecanismo do incidente do Alysson em 31/08 pela manhã ("alterei no
computador e ao acessar pelo celular o sistema reverteu todas as
alterações"): um aparelho com cópia local que ninguém sabia que estava
isolado.

**Correção.**

- `semServidor()` em `suinco-api.js`: uma função para a decisão que estava
  copiada em cinco lugares. Com a sessão perdida ela devolve
  `{recusado:true, sessaoExpirada:true}` com o texto certo; em modo local
  de propósito devolve o `{enfileirado:false}` de sempre.
- `sessaoPerdida()` = entrou pelo servidor neste aparelho E não tem token.
  A marca vive no `localStorage` porque precisa sobreviver ao token — é
  justamente quando o token some que a pergunta importa. Marcada dentro de
  `guardarToken` (ponto único do login E da renovação), apagada em `sair()`,
  porque sair é decisão de quem usa e não pode virar bloqueio.
- A faixa passa a dizer **SUA SESSÃO EXPIROU**, com a frase que faltava: *"o
  aparelho tem internet; foi o acesso que venceu"*.
- E ganha o botão **"Entrar de novo"** dentro dela, alvo de toque de 44px.
  O caminho de volta existia só numa linha pequena no rodapé. Botão que só
  nega não ensina o caminho.

**Teste que trava.** `testes/test_sessao_vencida.py`: a recusa acontece e
diz que foi a sessão; a fila continua vazia; a faixa não diz "offline" e
afirma que há internet; o botão existe, tem 44px e ABRE o login; e o modo
local escolhido de propósito continua funcionando — decisão de quem usa não
pode ser confundida com acidente.

**Família.** *Trava sem o par na tela* (#13), invertida: aqui a trava
existia e estava certa, mas cobria um caminho e não o irmão dele — a mesma
assinatura de #20, "a proteção escrita para um posto só". Cinco cópias da
mesma linha de guarda são cinco lugares onde a regra nova precisa ser
lembrada, e a memória falha. Vira uma função.

---

## #23 — Expedição, Controles Internos e Central de Notas sumiram do checklist (31/08/2026)

**Relato.** A Bruna, testando logo depois da publicação, pelo Luis: *"sumiu a
parte da expedição, controles internos e central de notas"*. No print, o
cabeçalho da tabela de itens termina em "Pesagem" — as quatro colunas
seguintes não existem mais.

**Causa.** Leitura errada do pedido, minha, carimbada por um teste que eu
mesmo escrevi para exigir o comportamento errado.

O dono pediu, em duas mensagens: *"a parte da expedicao e da destinacao
precisam ter so o campo para dar o OK: CHECK e um campo para escrever
observacoes"* e *"central de notas tambem só dar o ok check tambem e
observacoes"*.

Isso é sobre o que o OK **exige**: avançar a etapa não pode depender de
preencher item nenhum. Eu li como "apague a conferência item a item" e tirei
de `renderDevolucaoAberta` as quatro colunas — quantidade recebida
(Expedição), falta, destinação E/D/R (Controles Internos) e o tique da nota
final (Central de Notas).

Pior que tirar: eu as troquei por colunas que só apareciam **se já houvesse
dado** (`temAlgum`), e apaguei os campos de digitação junto. Como o único
jeito de o dado existir era digitando, ele nunca podia existir. Armadilha
fechada: a coluna só nasce com o dado, e o dado só nasce pela coluna.

O código já dizia o contrário desde 28/08, no comentário da própria etapa da
Expedição: a conferência e a destinação *"nunca travaram o OK, e tirá-las
apagaria a falta, que é o que o checklist existe para apontar"*. Eu escrevi
esse comentário e passei por cima dele três dias depois.

**O sinal que estava na mão.** `podeConferirQtdDev()`, `podeDestinarDev()` e
`podeNotaFinalDev()` ficaram com **zero chamadores**. Três funções de
permissão sem ninguém que as consulte é a assinatura exata de tela sem o
caminho — o mesmo padrão de `mudarStatus`, `liberarPendencias` e da trava de
versão nesta mesma semana. Uma varredura de "permissão sem chamador" teria
pego isto antes do portão.

**Por que o portão deixou passar.** Ele não deixou: ele fez o que mandei. O
teste `test_tres_etapas_so_check_e_recado.py` exigia, em dois blocos, que os
campos SUMISSEM. Ficou verde porque o código fazia exatamente o que o teste
pedia. Portão só barra o que alguém escreveu que é errado.

**Correção.** As quatro colunas voltaram, com os campos editáveis para quem
tem permissão — a tabela de itens ficou byte a byte igual à versão que estava
funcionando. O que o dono pediu de verdade continua: as três etapas avançam
com o checklist vazio, e cada posto tem seu campo de observações no cabeçalho,
que chega na etapa seguinte e sai no relatório.

**Teste que trava.** `testes/test_tres_etapas_so_check_e_recado.py`, blocos 2
e 3, invertidos: num checklist RECÉM-CRIADO (o estado em que a Bruna abriu),
os campos de conferência, destinação e nota final precisam estar na tela, com
cabeçalho. O bloco 1 continua exigindo que as etapas avancem com o checklist
vazio — os dois juntos impedem tanto a volta do defeito quanto a volta da
exigência que o dono mandou tirar.

**Família.** Nova: **o teste que carimba a leitura errada do pedido**. Não é
"teste velho" (#15) nem "teste que mede o proxy": o teste estava novo, verde e
media exatamente o que eu tinha escrito — só que eu tinha entendido o pedido
ao contrário. Verde não prova que a regra está certa; prova que o código faz o
que o teste diz. Quando a mudança REMOVE algo da tela, o teste que garante a
remoção precisa vir acompanhado do teste que garante que o trabalho de quem
usava aquilo ainda é possível.

---

## #22 — Carga lançada sem sinal sumia da tela acusando "o servidor recusou" (31/08/2026)

**Relato.** Não veio da operação — veio da bateria. Ao isolar
`test_contador_torre`, 18 das 20 cargas criadas em um bloco tinham
desaparecido no bloco seguinte, e o teste reprovava acusando a animação do
contador da Torre.

**Causa.** Duas coisas separadas, e só uma era defeito.

A primeira NÃO era defeito. A trava de offline (31/08, pedido do dono:
*"Off Line não tem conversa não!"*) fez `enfileirar()` deixar de responder
"guardei na fila" e passar a responder `{recusado:true, offline:true}`.
Criação nunca confirmada que é recusada sai da tela de propósito — é a
correção da ocorrência de carga-fantasma de 07/08. Sem sinal, portanto, a
carga é recusada e a linha sai. Isso está certo e é o que o dono pediu.

O que fazia o teste reprovar era o CENÁRIO dele: o arquivo plantava um
`suinco_token` falso no sessionStorage e depois entrava por "Entrar sem
servidor". O token fazia `estaConfigurado()` responder SIM, e aí cada carga
tentava subir para uma API que não existe naquele ambiente. O teste estava
medindo a trava de offline sem saber, e culpando o contador.

A segunda era defeito de verdade, e de honestidade: o aviso dizia
*"o servidor recusou a criação desta carga (...) placa cadastrada na Frota?
setor com permissão?"*. Quem está sem sinal ia procurar um problema de
cadastro que não existe. Offline não é recusa do servidor — é ausência
dele, e o conserto é reconectar e refazer.

**Correção.**

- `sincronizarCarga` (`data.js`) passa `r.offline` adiante;
  `receberRecusaDeCarga` (`app.js`) escreve o texto de offline quando a
  causa é falta de conexão, e mantém o texto de recusa quando o servidor
  realmente respondeu não.
- `test_contador_torre` deixou de plantar token falso. Ele roda em
  `file://`, sem servidor, e é isso que sempre quis medir.

**Teste que trava.** `testes/test_offline_nao_grava.py`, bloco 2b: a carga
lançada offline não fica fantasma na tela E o aviso não diz que o servidor
recusou. `testes/test_aviso_recusa_carga.py` continua exigindo o texto de
recusa no caso em que o servidor de fato recusou — os dois juntos impedem
que consertar um texto estrague o outro.

**Família.** *Teste que mede o proxy, não a regra* (#15) — com um agravante
novo: aqui o cenário do teste é que estava desatualizado, não a asserção. Um
token falso plantado por conveniência transformou um teste de animação num
teste de sincronização, e o vermelho apontou para o lugar errado por horas.

---

## #21 — A etapa corrigida voltava sozinha para "Aguardando Embarque" (29/08/2026)

**Relato:** *"TO TENTANDO MUDAR O STATUS DE UMA CARGA QUE TA ERRADA EU TENTO
COLOCAR AGUARDANDO VEICULO AO INVES DE AGUARDANDO EMBARQUE E NAO CONSIGO
PPOIS FICA VOLTANDO PRA AGUARDANDO EMBARQUE FTZ2138"*

**O que o sintoma sugeria, e não era.** "Volta sozinha" é a assinatura da
ocorrência **#01** (eco de sincronização) e do defeito do botão "Chegou" que
o comentário de `sincronizarCarga` descreve. Fui atrás disso primeiro e
**descartei os três, com evidência**:

- o servidor recusando a volta — **não**: `POST /cargas/:id/corrigir-etapa`
  grava certo (conferido no banco: `versao 4, Aguardando Veículo`);
- `_pendente` / fila travando a tela — **não**: `pendente=False`,
  `statusPendentes=[]` em todos os ciclos de sincronia;
- a absorção de entrada solta do pátio empurrando a carga — **não**: com a
  linha órfã na mesma placa, a carga ficou em "Aguardando Veículo".

**Causa:** ao voltar para "Aguardando Veículo", a carga **reaparece na fila
da Portaria como "não chegou"** — com o botão "Chegou" ativo e nenhum sinal
de que aquilo tinha sido uma correção deliberada. O porteiro vê um caminhão
que ele mesmo deixou entrar listado como se não tivesse chegado, clica
"Chegou" de boa-fé, e a carga volta para "Aguardando Embarque" na hora. Quem
corrigiu não é avisado, tenta de novo, e o laço se fecha.

Reprodução que fechou o diagnóstico, com dois painéis abertos ao mesmo tempo:

```
depois da correção, ADM vê:  Aguardando Veículo
PORTARIA vê:                 Aguardando Veículo
aviso de que foi correção:   []            <- nenhum
porteiro clicou "Chegou":    atualizadas=1, bloqueada=False
ADM vê agora:                Aguardando Embarque   <- voltou
```

**O que estava faltando não era permissão — era informação.** Os dois lados
agiam certo com o que viam. O sistema é que não contava a nenhum dos dois o
que o outro tinha feito.

**Feito** — três pontos, todos lendo o MESMO fato (a movimentação que andou
para trás na `STATUS_FLOW`), via `etapaDevolvida()`. Sem coluna nova, sem
migração: a devolução já estava escrita, faltava alguém ler.

1. **Marca visível** `↩ etapa devolvida` ao lado da placa, na Visão do Pátio,
   na fila de programados e na lista da Portaria — some sozinha quando
   alguém legitimamente move a carga.
2. **O "Chegou" pergunta antes**, dizendo quem devolveu, quando e de onde
   para onde. **Pergunta, não bloqueia**: a Portaria tem autoridade e o
   caminhão pode ter chegado de novo — botão desabilitado não ensina o
   caminho, só nega.
3. **Quem corrigiu é avisado** quando a carga volta a andar, alto e com som.

**Sem janela de tempo, de propósito.** A marca vale enquanto ninguém tirou a
carga do lugar para onde ela foi devolvida — prazo mágico é controle que
depende da memória de quem escreveu.

**Guarda:** `testes/test_etapa_devolvida_nao_volta_sozinha.py` — devolve a
etapa, confere que a Portaria VÊ a marca antes de clicar, que o "Chegou"
pergunta, que **recusando a carga não anda (nem na tela nem no servidor)**,
que **confirmando ela anda** (a autoridade da Portaria fica de pé) e que o
painel de quem corrigiu avisa. Reprovou em 6 pontos contra o código
publicado antes da correção.

---

## #20 — Avançar a etapa apagava o que outro setor tinha preenchido (28/08/2026)

**Relato:** *"quando se está realizando um processo de devolução e alguém de
outro setor atualiza a carga ou alguma informação, isso apaga o que estava
sendo feito na devolução. Precisamos entender onde está o problema, onde ele
é registrado no servidor e por que esse caminho não está sendo executado
corretamente."*

**A primeira investigação não achou nada — e isso era informação.** As duas
defesas da TELA, feitas em 27/08 (não rebuscar a lista a cada redesenho;
devolver o que estava digitado depois de um redesenho), estavam no lugar e
com teste verde (`test_checklist_nao_apaga`). O relato continuava. Logo o
apagamento não era da tela: alguma coisa estava gravando o vazio.

**Causa:** o botão que avança a etapa manda, junto com o status novo, o campo
daquela etapa — e cinco das seis mandavam `v('campo') || ''`. A string vazia
ia junto e `POST /devolucoes/:id/etapa` gravava por cima. Não é a tela que
perde o dado: é o servidor que o apaga, a pedido.

O campo fica vazio em duas situações que acontecem todo dia:

- a tela de quem avança foi desenhada **antes** de o outro setor preencher
  aquele campo pelo cabeçalho — ela carrega um retrato velho. É a ocorrência
  **#16** ("duas escritas em voo, a velha ganha") aparecendo nas devoluções;
- quem avança não é quem preenche: a Logística cobre todos os postos e
  avança etapa dos outros o tempo todo.

**O detalhe que dói:** a regra já existia. A etapa da Portaria tinha, escrita
no código: *"Só manda o que foi PREENCHIDO: campo vazio do porteiro não pode
apagar um valor que a Logística já tenha posto no cabeçalho."* A proteção
foi escrita para um posto e não valeu para os outros cinco — é a família "a
mesma decisão em dois lugares", só que aqui a segunda cópia simplesmente
não foi escrita.

**Feito:** a regra passou a valer para as seis etapas, em um lugar só. Para
apagar de propósito existe o campo do cabeçalho, que grava o vazio
explicitamente; o botão de avançar serve para carimbar a etapa, não para
limpar o trabalho de outro setor.

**Guarda:** `testes/test_etapa_nao_apaga_de_outro_setor.py` — leva um
checklist até cada etapa, grava o campo pelo cabeçalho (o "outro setor"),
avança a etapa com o campo VAZIO na tela e confere **no banco** que o valor
continua lá. Mais o contrapeso: o que é escrito no campo da etapa continua
sendo gravado, para a proteção não virar "a etapa não grava mais nada".

---

## #19 — A coluna que mostra um traço e não aceita o dado (28/08/2026)

**Relato:** *"porra ficou faltando os campos rota peso numero de carga,
veiculo ta aparecendo sem placa, porque nao estao editaveis??? editaveis, as
placas que estao neles nao estao puxando direto as infos da placa como
veiculo"* — com foto da Montagem do Dia, 39 linhas montadas.

**Causa:** na linha de rascunho da Montagem, três das nove colunas eram
TEXTO: Nº Carga, Veículo e Peso exibiam `—` e não recebiam digitação. O
servidor aceitava `numeroCarga`, `peso`, `placa` e `rotaCodigo` no PATCH
desde sempre — faltava a TELA oferecer.

**O detalhe que dói:** o único campo editável da linha era o de Motorista, e
era exatamente ali que as placas do dia estavam escritas (RNT5J03, RNV2A77,
RNW7J57…). Ninguém digitou no campo errado por distração: **digitaram no
único campo que aceitava**. Coluna que mostra um traço e não recebe o dado
não é neutra — ela empurra o dado para onde couber, e ele vai parar onde
ninguém vai procurar.

**Um bug maior atrás do relato:** ao investigar "a placa não puxa as infos",
apareceu que `suinco-api.js` recebia a frota do servidor e **descartava o
motorista** no mapeamento (copiava só Placa, Transportadora, Tipo e
Revisão). Ou seja, o autopreenchimento "digitou a placa, veio o motorista"
funcionava apenas para quem tinha cadastrado aquela placa NAQUELE navegador.
Para todo mundo que recebe a frota do servidor — todo mundo, todo dia — o
campo chegava vazio. O relato era sobre a Montagem; o defeito era da camada
de dados e atingia todas as telas.

**Feito:** as quatro colunas viraram campos na própria linha, com as MESMAS
classes da Fila e da Torre; a placa ganhou sugestão da Frota e passa a
trazer transportadora, tipo e motorista; trocar a rota limpa o apelido do
modelo (que descrevia a rota antiga) — para isso o PATCH passou a aceitar
`apelidoRota`; e o mapeamento da frota deixou de jogar fora motorista,
capacidade e UF.

**Guarda:** `testes/test_montagem_linha_editavel.py` — confere que as
colunas são campos, que o que se digita chega ao BANCO (não à tela), que a
placa puxa os três dados da Frota, que o motorista escrito à mão sobrevive à
troca de placa, e que no celular os quatro campos aparecem sem precisar
abrir o cartão. Contra o build publicado, reprova em 4 pontos.

---

## #18 — O filtro que movia os números e não movia os gráficos (28/08/2026)

**Relato:** *"quando usa o filtro os graficos somem voce precisa resolver
isso, os indicadores de qual regional transportadora enfim"* e *"quando
clica nos graficos e filtra por transportadora ele precisa interagir com
aquele dado filtrado ou clicado"*.

**Causa:** a aba Indicadores tinha DOIS conjuntos de filtros independentes.
O de cima movia cartões e tabelas; um segundo, dentro do card de Gráficos,
movia só os gráficos — e os dois não se falavam. Medido antes de mexer:
filtrar uma transportadora no filtro de cima deixava os três gráficos com
exatamente os mesmos pixels (3.321 / 1.057 / 15.590 antes e depois). As
listas também discordavam: 7 transportadoras num filtro, 1 no outro, porque
cada um olhava um universo de cargas diferente.

Duas verdades sobre o mesmo dia, na mesma tela, sem nada avisando qual era
qual. E `renderGargalos` e o tempo médio de pátio liam `DB.cargas` cru: não
obedeciam a nenhum dos dois.

**Feito:** um filtro só para a aba inteira. A regra passou a morar em uma
função de `data.js` (`aplicarFiltrosCargas`) que as tabelas e os gráficos
chamam — uma função, dois chamadores, de propósito: enquanto forem duas,
voltam a divergir. Gargalos e tempo de pátio passaram a obedecê-la, o
período virou único, e clicar numa transportadora, rota ou operação nas
tabelas de Gargalos filtra a aba inteira (clicar de novo limpa).

**Guarda:** `testes/test_filtro_indicadores_move_graficos.py` — conta os
PIXELS pintados de cada gráfico antes e depois de filtrar. Um teste que só
olhasse o valor do `<select>` passaria com o defeito intacto, que foi
exatamente o que aconteceu por semanas. Contra o build publicado, reprova em
11 pontos.

---

## #17 — Os gráficos do Custo de Frete sumindo ao serem clicados (28/08/2026)

**Relato:** *"os graficos somem quando tento interagir com eles"*, com foto
do painel de Custo de Frete aberto no Mac: cabeçalho com os números certos
(10.856 linhas · 3.926 cargas · R$ 44.867.593,86) e os painéis dos gráficos
em branco.

**Causa, pela pilha do erro:**

```
TypeError: this._fn is not a function
    at Cs.tick            (animador)
    at Cs.cancel
    at bt.stop
    at An.stop / An._stop  (destroy do gráfico)
```

Cada filtro redesenha os oito gráficos, e redesenhar ali é destruir e
recriar. Quando o `destroy()` pegava uma ANIMAÇÃO em curso, o Chart.js
cancelava um quadro que já tinha perdido a função dele e quebrava no meio —
o painel ficava em branco. Havia um segundo defeito na mesma linha: o
`onClick` chamava `render()` na hora, ou seja, o gráfico se destruía DENTRO
do evento de clique que o próprio Chart.js ainda estava despachando.

**Feito:** animação desligada na raiz (oito gráficos que se refazem inteiros
a cada clique não ganham nada com meio segundo de animação; ganham um erro),
`destroy()` protegido, e os quatro `onClick` passaram por uma função só que
devolve o controle ao Chart.js antes de redesenhar.

**Guarda:** `testes/test_custo_frete_clique_nao_apaga_grafico.py` — conta os
pixels de cada canvas antes e depois de clicar em cada gráfico clicável, e
reprova em qualquer erro de JavaScript. Gráfico que "some" é um canvas em
branco, e branco é um número.

---

## #16 — O campo que o operador digita e o servidor não guarda (23/08/2026)

**Relato:** nenhum — de novo, e de novo é isso que assusta. Apareceu porque a
bateria inteira passou a ser rodada: `test_edicao_marca_alterada` falhava 3
em 3 vezes com *"os GANCHOS chegaram ao outro terminal — esperado 33, veio
0"*. Estava vermelho havia dias.

**A primeira hipótese estava errada.** Parecia atraso de sincronia — o outro
terminal ainda não teria recebido. Conferido no banco, não era:

```
sequencia = 7 | qtd_ganchos = 0
```

As duas foram alteradas na MESMA ação. O dado não demorou: ele não chegou.

**Causa**, capturada no tráfego HTTP:

```
PATCH {"qtdGanchos": 0,  "sequencia": 7}   <- estado ANTES dos ganchos
PATCH {"qtdGanchos": 33, "sequencia": 7}   <- estado depois
banco: sequencia = 7, qtd_ganchos = 0
```

Cada `save()` monta o corpo **inteiro** da carga com o estado daquele
instante, e `sincronizarCargasAlteradas` disparava sem esperar. Duas
alterações seguidas na mesma carga viravam duas requisições em voo ao mesmo
tempo — e a primeira levava o valor velho do campo que ainda ia mudar. Quem
chegou por último ao banco foi a primeira.

O operador vê 33 na tela dele e o servidor guarda 0. **Sem erro nenhum na
tela** — o pior jeito de perder dado.

É primo do eco de sincronização (#01): lá era cópia velha de OUTRO terminal
sobrescrevendo; aqui é cópia velha do PRÓPRIO terminal, criada
milissegundos antes.

**Correção:** não é esperar mais, é não ter duas em voo. Enquanto uma carga
sobe, outra alteração dela só marca "refazer" — e o refazer relê o estado
ATUAL, que já tem as duas mudanças. Duas edições rápidas viram uma
requisição com o valor final.

Detalhe que importa: quando a subida é adiada, a carga **não** é marcada como
sincronizada. Marcar ali faria a alteração sumir para sempre — trocaria uma
perda de dado por outra, pior.

**Alcance:** qualquer campo, não só ganchos. Basta duas alterações na mesma
carga em sequência rápida — que é o que a Torre faz o tempo todo, porque seus
campos são editáveis lado a lado.

**Guarda:** `testes/test_edicao_marca_alterada.py`, que já existia e já
apontava para cá. Faltava alguém rodar.

---

## #15 — Vinte testes vermelhos que ninguém estava vendo (23/08/2026)

**Relato:** nenhum. Foi o problema. A bateria completa das 97 suítes só foi
rodada inteira ao publicar o lote do cartão do celular — e voltou com 19
vermelhos, a maioria deles de dias antes.

**O que estava por trás,** depois de rodar cada um isolado e também contra o
build que estava em produção:

1. **Três testes com a mesma regra vencida.** `test_setor_comercial`,
   `test_comercial_e_excluir_aguardando` e `test_login_api` exigiam que a aba
   Usuários NÃO aparecesse para certos setores. A aba abriu para todos em
   22/08 junto com o segundo fator — deixou de ser a tela de administrar
   gente e passou a ser onde cada pessoa protege a própria conta. A mudança
   estava certa; os três testes ficaram para trás juntos, porque os três
   mediam a mesma coisa fácil ("a aba aparece?") em vez da garantia de
   verdade ("o que ele encontra lá dentro?"). Agora conferem o conteúdo: sem
   lista de operadores, sem pedidos de aprovação, só "Minha segurança".

2. **Um teste contando errado.** `test_listas_grandes_mobile` contava `<tr>`
   para checar o teto de 40 registros do Histórico no celular. Desde 20/08
   cada registro rende DUAS linhas (a que se lê e a do detalhe, que abre ao
   clicar): 40 registros davam 80 linhas, e o teste acusava um limite
   quebrado que nunca quebrou.

3. **Uma trava sem o par na tela** — é a ocorrência #13, e foi
   `test_admin_historico` falhando em silêncio que a denunciou.

4. **Contaminação entre testes.** A suíte inteira compartilha um Postgres só
   e não limpa entre um teste e outro. `test_admin_historico` falhava na
   bateria e passava verde sozinho depois de limpar a base. Parte dos
   vermelhos era sobra do teste anterior, não defeito do painel.

**O que fica:** rodar a bateria inteira antes de publicar, e não só as
suítes próximas do que se mexeu — foi o que revelou tudo isto. E quando um
teste ficar vermelho, perguntar antes de "o que quebrei?": *este teste ainda
mede a regra, ou passou a medir um sintoma que mudou de forma legítima?*

---

## #14 — Cartão do celular grande de novo depois de já ter encolhido (23/08/2026)

**Relato:** *"eu to achando os cards na torre de controle muito grandes no
mobile, enquanto o desktop já está super bem distribuído, compacto... não só
na torre mas nas outras abas também"*. E, depois da primeira tentativa de
correção: *"otimize isso, seja coerente e lógico"*.

**Causa:** a mesma lista de rótulos estava escrita **três vezes**, cada uma
como seletor de CSS à mão — quem ocupa a linha inteira, quem some no cartão
fechado, quem lê em linha. Elas divergiram: a terceira tinha seis rótulos e a
primeira tinha dez. O Histórico, que já havia chegado a 94px por cartão,
voltou para 147px sem que nenhuma regra estivesse errada — só desalinhada com
as outras duas.

Junto vieram dois defeitos da mesma família: o limiar do celular era 560px no
bloco que transforma tabela em cartão e 820px em todo o resto (entre 561 e
820 as colunas sumiam de uma tabela normal, com cabeçalho visível e nada para
tocar), e o botão "Chegou" da Portaria passava por cima do rodapé porque uma
regra com `#id` sobrescrevia o espaço reservado para ele.

**Correção:** a decisão passou a morar num lugar só — `ROTULOS_LARGURA_CHEIA`
e `ROTULOS_SECUNDARIOS`, em `app.js`. `prepararTabelasMobile()` carimba
`data-larg="cheia"` e `data-sec="1"` na célula, e o CSS pergunta pelo carimbo
em vez de repetir a lista. Um limiar só, 820px, o mesmo que `ehTelaEstreita()`
responde ao JS.

**Medido, no mesmo aparelho e com os mesmos dados** (390×844, 12 cargas em
placas distintas): Torre de 748px para 255px por cartão (de 1,1 para 3,3
cartões por tela); Histórico de 197px para 132px; a faixa de indicadores de
385px para 189px, e a tabela passou a começar em 469px em vez de 664px.

**Guarda:** `testes/test_cartao_mobile_uma_lista.py` confere que todo carimbo
bate com o Set do JS — se alguém voltar a escrever a lista no CSS, a
divergência aparece como falha, não como cartão gordo.

**Duas coisas que a medição corrigiu na minha intuição:**

- *"Ler em linha é mais compacto"* é falso em meia coluna. Medido: numa
  célula de largura inteira o Histórico caiu de 147px para 94px; na meia
  coluna da Torre o mesmo tratamento SUBIU de 370px para 495px, porque o par
  rótulo+valor quebra em duas linhas e fica mais alto que empilhado.
- *"Encolher o botão dá densidade"* também é falso. Buttons de 38px/34px
  economizaram menos do que pô-los lado a lado (três botões de 44px numa
  linha ocupam 44px; empilhados, 155px) e derrubaram o mínimo de toque em
  cinco abas de uma vez. Densidade vem do arranjo, não do alvo menor.

---

## #13 — Botão que só sabe dizer não (23/08/2026)

**Relato:** o Alysson, administrador, clicou em "Restaurar esta versão" no
painel dele e recebeu *"Esta ação precisa do aval de outro administrador"* —
sem nenhum lugar para pedir esse aval.

**Causa:** a segunda assinatura foi implementada no servidor sem o par na
tela. A trava estava certa; o caminho para cumpri-la não existia. E não era
um botão só: `corrigir-etapa` e `desfazer-exclusão` estavam no mesmo estado,
e ninguém tinha percebido porque o teste que os cobria falhava em silêncio
desde então.

**Correção:** `pedirAprovacaoUI()` / `aprovacaoDisponivel()` nos três botões —
o primeiro clique abre o pedido com o motivo, e o segundo, depois do aval,
conclui. Quem aprova vê os pedidos na aba Usuários, e quem pediu não vê botão
de aprovar no próprio pedido (o servidor recusa de todo jeito; a tela explica
em vez de oferecer).

**Guarda:** `testes/test_segunda_assinatura_ui.py` faz o caminho inteiro com
dois administradores em duas sessões. E `test_admin_historico.py`, que estava
vermelho sem ninguém olhar, foi atualizado para a regra nova em vez de para a
antiga.

---

## #12 — "Entrada no pátio" mostrando a hora errada (21/08/2026)

**Relato:** *"que estranho essa data de entrada no pátio dessa placa, o que
está acontecendo?"* — carga 118292, placa OPM7C45: o Histórico dizia
"Entrada no pátio 20/08 19:57" e a movimentação logo acima mostrava a
Portaria registrando a chegada em 21/08 09:06. Quatorze horas de diferença.

**Causa:** o rótulo. A tela mostrava `criadoEm`, que significa coisas
diferentes conforme quem criou a linha:

- carga **programada** pela Logística → quando ela foi lançada (o caminhão
  nem tinha chegado);
- entrada registrada pela **Portaria** → aí sim é a chegada, porque a linha
  nasce quando o caminhão encosta.

A entrada real sempre existiu num registro próprio e inequívoco: o evento de
mudança para "Aguardando Embarque", na trilha.

**Correção:** `entradaNoPatioDe(carga)` — uma definição só, lida da trilha,
usada no Histórico e na Visão do Pátio. Quando o caminhão não chegou, a tela
**diz isso** em vez de oferecer uma data qualquer. O Histórico passou a
mostrar as duas linhas separadas: "Entrada no pátio" e "Registro criado em".

**As três datas de uma carga, para não se misturarem de novo:**

| Campo | O que significa |
|---|---|
| `criadoEm` | quando o REGISTRO nasceu |
| `programadoEm` | quando a CARGA foi lançada/programada |
| entrada no pátio | quando o CAMINHÃO encostou (evento na trilha) |

**Guarda:** `testes/test_datas_da_carga.py` — cria a carga ontem, faz o
caminhão chegar hoje e exige que as duas datas apareçam diferentes na tela.

---

## #11 — Nº da carga de devolução e nome do cliente no relatório (20/08/2026)

**Relato:** *"o código do cliente no relatório não está puxando o nome do
cliente, está puxando só o código"* e *"número da carga da dev não precisa no
relatório antes da Portaria gerar o número que o SIS ATAK gera"*.

**Causa:** o item guardava só `cod_cliente` — na tela não incomoda (quem
digita acabou de ver o nome na sugestão), no relatório incomoda muito, porque
ele vai para quem não digitou nada. E a coluna da carga de devolução era
sempre desenhada, mesmo no documento impresso ANTES de o caminhão chegar na
Portaria, virando uma fileira de traços.

**Correção:** migração 028 (`cliente_nome` no item, preenchido pelo servidor
a partir do cadastro, com apelido tendo preferência — é o que as capas usam);
a coluna da carga de devolução só entra no documento quando alguém já
preencheu, com os somatórios se ajustando junto.

**Por que gravar o nome em vez de cruzar na hora de imprimir:** relatório é
documento histórico (se o cadastro mudar em dezembro, o checklist de agosto
tem que continuar dizendo o que dizia) e o painel não carrega a base inteira
de clientes.

**Guarda:** bloco 13 de `backend/testes/devolucoes.test.js` (inclusive o caso
do código fora do cadastro, que **não pode** inventar nome) e a exigência da
coluna ausente em `testes/test_sobras_parciais_relatorio.py`.

---

## #10 — Rota cadastrada aparecendo só como número (20/08/2026)

**Relato:** *"não entendo por que a rota 011 está aparecendo sem nada
escrito, para mim só o número"* — duas vezes no mesmo dia, em máquinas
diferentes.

**Causa:** a rota existia; tinha sido cadastrada naquele dia. A lista de
rotas só era buscada **na carga inicial da página**. Quem cadastrou via o
nome; todo painel aberto desde antes via só o código. Painel de pátio fica
aberto o dia inteiro.

**Correção:** a lista volta a ser conferida a cada 5 minutos também na
sincronização incremental e — principalmente — **carga que chega com rota
fora do catálogo dispara a rebusca na hora**, porque essa carga é a própria
evidência de que a lista está velha. A frota continua só na carga inicial:
ali são milhares de placas.

**Guarda:** `testes/test_rota_cadastrada_aparece.py`.

---

## #09 — Lacres somindo sozinhos (20/08/2026)

**Relato:** achado por mim medindo o tráfego do painel enquanto testava outra
coisa. A Portaria registrava dois lacres na saída, o banco guardava os dois,
e minutos depois o segundo estava vazio.

**Causa:** duas, somadas.

1. **Eco com campo vazio:** um terminal que ainda não recebeu os lacres
   reenvia a carga com `lacre:'' , lacre2:'', lacre3:''` — e isso apagava o
   que estava gravado. Mesma família do sumiço das observações (#03).
2. **Campo esquecido na volta:** o mapeamento de `lacre2`/`lacre3` existia na
   ida e na conversão, mas não na volta do servidor — o painel mandava os
   três, o banco guardava os três, e o terminal mostrava um só.

**Correção:** `COALESCE/NULLIF` nos quatro campos de lacre (vazio não apaga;
para trocar, digita-se o outro número) e o mapeamento completo nos três
pontos.

**Guarda:** bloco 26 de `api.test.js` (o caso do eco que apagava) e
`testes/test_carga_dev_e_lacres.py`, que confere **num terminal novo** — a
aba que criou a carga tem cópia local e mascararia exatamente esse defeito.

---

## #08 — Torre com todas as cargas no mesmo horário (20/08/2026)

**Relato:** *"todos estão marcando o mesmo horário, no mesmo dia... quero que
seja informada a última vez que foi atualizada por um operador"*.

**Causa:** `atualizado_em` sobe a cada UPDATE, por causa do gatilho do banco.
E UPDATE acontece muito além de edição humana: todo painel reenvia o que tem
em memória ao reconectar. Quando o serviço reinicia, meia programação é
regravada idêntica a si mesma e recebe o mesmo carimbo. Já tinha sido
observado em 14/08 (109 cargas nos mesmos dois instantes) sem ter sido
resolvido na raiz.

**Correção:** migração 026 — duas verdades, duas colunas. `atualizado_em`
(quando a linha foi gravada, para a sincronia) e `acao_em` + `acao_por` +
`acao_setor` (quando uma **pessoa** mudou algo). O gatilho compara os campos
de negócio antes e depois; gravação que não muda nada não carimba ação nova e
**não rouba a autoria** de quem mexeu de verdade.

Depois disso, a pedido do gestor, a coluna da Torre passou a mostrar a
**última mudança de etapa lida da própria trilha** — o mesmo registro que o
Histórico desenha, então as duas telas não têm como discordar.

**Guarda:** blocos 27 e 28 de `api.test.js` e
`testes/test_torre_acao_e_encerramento.py`.

---

## #07 — Programação puxando o dia errado (19/08/2026)

**Relato:** *"PROGRAMAÇÃO PRECISA PUXAR A DATA DO DIA PROGRAMADO! NÃO É PRA
SER O DIA QUE O CARRO DEU ENTRADA"* — a programação do dia saiu com 11 cargas
e o relatório trouxe 9. As duas que faltaram eram caminhões que entraram
ontem e tiveram a carga lançada hoje.

**Causa:** quatro elos, todos apontando para o mesmo erro — tratar a entrada
do caminhão como se fosse a programação da carga. O último elo era o
servidor devolvendo `programado_em || criado_em` na leitura, o que fazia o
painel regravar a data errada na sincronização seguinte: o erro voltava
sozinho depois de corrigido.

**Correção:** entrada sem carga nasce sem data de programação; enquanto
aguardando, o campo é ignorado; no lançamento é atribuído `now()` por cima; e
a leitura devolve `null` em vez de inventar. Junto veio a separação, na
Torre, entre a programação de hoje e as pendências de programações
anteriores, com botão para encerrá-las.

**Guarda:** bloco 25 de `api.test.js` e `testes/test_data_programacao.py` (com
a entrada envelhecida no banco, reproduzindo o caso real).

---

## #06 — Segunda carga da mesma placa não conseguia entrar (20/08/2026)

**Relato do programador de embarque:** *"na segunda carga a placa está dando
que o veículo não chegou, só que o veículo está no pátio... aí você dá a
entrada nele e não dá. É isso que está dando interferência."*

**Causa:** regressão introduzida por mim no dia anterior. A trava de
reentrada (#05) barrava **qualquer** carga da placa que já estivesse no
pátio — e caminhão com duas cargas no mesmo dia é rotina: carrega, pesa,
carrega de novo, pesa.

**Correção:** a trava passou a comparar o **dia de programação**. Só barra
quando a carga já no pátio é de uma programação anterior. E, como a outra
metade do relato ("está constando que o veículo não está no pátio? está
errado"), a carga que ainda espera passou a mostrar a situação do CAMINHÃO ao
lado do status DA CARGA.

**Guarda:** bloco 26b de `api.test.js` e
`testes/test_segunda_carga_com_veiculo_no_patio.py`. O teste antigo de
multi-carga passou a conferir **no servidor** — ele olhava só a tela, e por
isso não pegou a regressão.

---

## #05 — Caminhão "chegando" duas vezes sem ter saído (19/08/2026)

**Relato:** *"a placa RNT5J03 eu já tinha saído e a portaria não tinha dado
saída... eu coloquei a placa dele, cliquei chegou, e ele aceitou e agora ele
sumiu"*.

**Causa:** nada impedia registrar a chegada de um caminhão cuja carga
anterior seguia em aberto. Nascia uma segunda carga e a primeira ficava
órfã.

**Correção:** trava em dois caminhos (criação e promoção), no servidor —
porque o painel do porteiro pode estar com a lista velha, e foi o que
aconteceu. Junto veio o painel de correções da Administração: voltar etapa,
corrigir data de programação, desfazer exclusão e a tela de cargas
excluídas.

**Guarda:** blocos 20 a 24 de `api.test.js`,
`testes/test_reentrada_portaria.py` e `testes/test_admin_historico.py`.

---

## #04 — Relatório considerando a data de entrada (14/08/2026)

**Relato:** *"se a portaria dá entrada no veículo ontem e a gente lança a
carga dela hoje, o relatório considera a data de entrada e não a data que ela
foi programada"*.

**Causa:** só existia `criadoEm`, que para um caminhão chegado sem
programação é a hora em que ele entrou no pátio.

**Correção:** migração 007 (`programado_em`) e, no dia seguinte, a 008
corrigindo o preenchimento retroativo que eu mesmo tinha feito errado —
preencher `programado_em = criado_em` para todo mundo cimentou a data de
chegada justamente nas linhas que a coluna nova existia para tratar.

**Lição que ficou:** preenchimento retroativo é escrita em produção. Merece a
mesma desconfiança de qualquer outra.

---

## #03 — Observações sumindo do relatório de Fretes (14/08/2026)

**Relato:** *"a Administração de Fretes não está puxando as observações, nem
de ontem nem de hoje"*.

**Causa:** dupla — o campo faltava no pacote de ida e na tradução de volta
(o servidor sempre soube guardá-lo), e o eco de sincronização com texto
vazio apagava o que outro setor tinha escrito.

**Correção:** o campo nos três pontos + `COALESCE(NULLIF(...))` no servidor:
texto vazio não apaga texto existente.

**Esta é a ocorrência mais importante da lista**, porque as famílias que ela
inaugurou reapareceram em #01, #08, #09 e #10.

---

## #02 — Cadastro de frota zerando capacidade e UF (14/08/2026)

**Causa:** o painel mandava só três campos no upsert; os demais eram
sobrescritos com vazio.

**Correção:** envio completo + preservação por omissão no servidor.

**Guarda:** bloco 9 de `api.test.js` (inclusive `capacidadeKg: 0`, que o
código antigo transformava em `null` porque `Number(0)` é falso).

---

## #01 — Cargas voltando para "Aguardando Carga" sozinhas (15/08/2026)

**Relato:** cinco cargas já lançadas — com peso, rota, e status até "Seguiu
Viagem" e "Faturado" — voltaram para a lista de aguardando carga e sumiram do
relatório. 62 toneladas a menos entre duas emissões com poucas horas de
diferença.

**Causa:** eco de sincronização. Nenhum fluxo do painel liga essa marca de
volta; quem religava era um terminal com cópia do dia em que o caminhão
chegou, reenviando o estado antigo.

**Correção:** `aguardando_carga` anda em um sentido só (`AND` no SQL: já
lançada com eco `true` continua lançada) e a migração 009 passou a guardar o
**estado anterior de toda mudança real** — foi ela que, cinco dias depois,
permitiu recuperar os lacres apagados de #09.

---

## O que aprendi com a lista inteira

1. **Sintoma e causa quase nunca moram no mesmo lugar.** "A rota está sem
   nome" era sincronização de dimensão; "o horário está errado" era um
   rótulo; "não consigo dar entrada" era uma trava minha do dia anterior.
2. **Teste que olha só a tela não é teste.** Três ocorrências desta lista
   passaram por testes verdes porque o painel mostrava o certo enquanto o
   servidor recusava. Todo teste novo confere **no servidor**, e quando o
   caso envolve dois terminais, confere **num terminal que não fez a ação**.
3. **Campo vazio não é ordem de apagar.** Em sistema onde todo mundo reenvia
   o que tem, vazio é quase sempre ignorância, não decisão.
4. **Correção retroativa em produção erra igual.** A migração 008 existe
   para consertar a 007.
5. **Toda trava nova precisa da pergunta "e o caso normal?"** A de #05
   estava certa para o incidente e errada para a rotina — e a rotina é o que
   acontece todo dia.
6. **Teste vermelho é um relato de produção que ninguém abriu ainda.** #16
   estava escrito, reproduzível e ignorado havia dias: um campo que o
   operador digita e o servidor não guarda, sem erro na tela. Não apareceu
   como reclamação porque quem digita não confere depois — confia. A bateria
   completa é o que transforma esse relato mudo em achado.
7. **Trava no servidor sem caminho na tela é bug, não segurança.** A de #13
   estava tecnicamente correta e deixou um administrador sem saída. Regra
   nova só está pronta quando existe o jeito de cumpri-la.
8. **A mesma decisão em dois lugares vira dois comportamentos.** Em #14 nenhuma
   linha estava errada; erradas estavam as três cópias da mesma lista. Quando
   uma regra precisa valer em CSS e em JS, ela mora em um dos dois e o outro
   pergunta.
9. **Teste vermelho tem três causas, não uma.** Antes de "eu quebrei",
   checar: a regra mudou de propósito (e o teste ficou para trás), o teste
   mede um proxy que mudou de forma, ou é sobra do teste anterior. Em #15 as
   três apareceram, e só uma linha de 19 era regressão de verdade. Rodar o
   caso isolado e também contra o build que está em produção responde isso
   em minutos.
10. **Intuição de layout erra; a régua não.** Duas mudanças "obviamente
   melhores" de #14 pioraram o número, e só apareceram porque foram medidas
   antes e depois, no mesmo aparelho e com os mesmos dados — sem isso, a
   comparação mede o banco de teste, não a mudança.
11. **Nomear o risco não é fechá-lo.** O commit da primeira correção de #26
   dizia "eram cinco cópias e eu lembrei de duas" — e a sexta derrubou o
   cadastro no dia seguinte. Escrever o risco no comentário deixa registro;
   só o teste que percorre o caminho inteiro impede a repetição.
12. **Entrega de cadastro só está pronta depois de cadastrar.** Em #26 a
   tela mostrava o setor, o banco aceitava, e a rota recusava. Nenhuma
   inspeção de código pegaria os três ao mesmo tempo; um `POST` pegaria.
13. **Antes de unificar, pergunte se é a mesma PERGUNTA — não se é o mesmo
   campo.** Em #27 duas telas escreviam em `sequencia` querendo coisas
   opostas, e juntá-las numa função só quebrou tanto quanto copiar teria
   quebrado. O `title=` de cada campo já dizia que eram perguntas
   diferentes.

---

## #35 — "A Logística não vê o ciclo encerrado": era o limite de requisições (09/09/2026)

**Sintoma.** `test_login_api` reprovou em TRÊS baterias seguidas, sempre na
mesma linha: *"a Logística vê o ciclo encerrado sem recarregar a página —
Aguardando Veículo"*. A carga andava os seis status com sucesso (cada
`mudarStatus` respondia OK), mas o terminal da Logística ficava parado no
primeiro. Tinha cara de regressão na propagação por socket — e eu havia
mexido exatamente ali no mesmo dia, criando duas salas para esconder valor de
frete do Comercial.

**A armadilha.** Três sinais apontavam para mim: a suíte começou a falhar com
o frete, eu tinha mexido no socket, e o sintoma é de propagação. Três sinais
na mesma direção convencem.

**A causa, medida.** Instrumentei o contador de requisições por chave e
caminho. O que apareceu:

```
op:3548 /api/cargas   297        ← um operador, num limite de 300/minuto
[429] op:3548 · POST /api/cargas  (11x)
```

O painel **reenvia toda carga aberta ao logar** — é o eco normal de
sincronização. O banco de teste tinha 99 cargas acumuladas das rodadas do
dia; três leituras completas × 99 = 297 POSTs. O limite é 300 por minuto.
O resto da suíte tomava 429, a sincronização entrava em recuo exponencial, e
a propagação parava. Nada a ver com socket.

Com o banco limpo e a janela de 60s vazia, a suíte passa com o limite de
produção (300). Reproduzido nos dois sentidos.

**Por que a segunda chance não pegou.** `rodar_tudo.sh` já roda toda suíte
reprovada de novo, sozinha e com o banco limpo — justamente para separar
contaminação de regressão. Mas `limpar_banco` zera o BANCO e não zera o
contador do limite, que vive na memória do servidor com janela de 60
segundos. As suítes rodam encostadas e compartilham os mesmos operadores de
teste: a segunda chance herdava o orçamento gasto pela anterior e dizia
"vermelho de verdade" para contaminação — o contrário do que foi escrita para
fazer, e a conclusão mais cara possível.

**Correção.** A segunda chance passou a esperar a janela
(`esperar_limite_de_requisicoes`). Custa um minuto por suíte reprovada, e só
nelas.

**A família.** É parente da #15 (sobra de uma suíte virando falha da
seguinte), com uma diferença que importa: ali o estado compartilhado era o
BANCO, que o script sabia limpar. Aqui é um contador **na memória do
servidor**, que limpar banco não alcança. Ao caçar contaminação, a pergunta
não é "o banco está limpo?" — é **"que estado compartilhado sobrou, e ele está
dentro ou fora do banco?"**.

**O que isto revelou de produção, e não é defeito meu.** Um login da Logística
com 70 cargas abertas gasta 70 das 300 requisições do minuto dela. Está longe
de estourar hoje, mas cresce com o movimento do dia e não está medido em lugar
nenhum. Fica anotado como dívida, não corrigido nesta entrega: mexer em limite
de requisição sem o dono pedir é mexer numa trava de segurança.

**Teste que trava.** Nenhum teste novo — a guarda é no próprio harness, e ela
é estrutural: a segunda chance agora só conclui "regressão" quando o estado
compartilhado foi de fato esvaziado. Um teste que simulasse o 429 provaria
menos do que o script passar a dizer a verdade.

---

## #36 — "3/4 aparece como 3 de abril": o Excel adivinha tipo (10/09/2026)

**Relato do dono**, em produção, horas depois da planilha de fretes entrar no
ar: *"a coluna h do relatorio de fretes esta saindo em modo data entao caminhao
3/4 fica aparecendo 3 de abril"*.

**Reproduzido.** A coluna H é Tipo de Veículo, e `3/4` é um dos cinco tipos da
tabela oficial de frete. No arquivo ele saía cru:

```
Sequência;Nº da Carga;Data do Faturamento;…;Tipo de Veículo;…
1;118900;10/09/2026;…;3/4;…
```

**A causa.** O Excel aplica detecção de tipo ao conteúdo **inteiro** da célula.
`3/4` tem forma de data e vira 3 de abril. Aspas de CSV não impedem: elas são
sintaxe do arquivo, não declaração de tipo — e foi por isso que o escapamento
existente, que está correto como CSV, não protegia nada aqui.

**Era família, não caso isolado.** Quatro exportações emitem tipo de veículo, e
`3/4` é um deles em todas: planilha de fretes, Tabela de Frete (onde ele é uma
LINHA), programação do dia (coluna "Perfil") e cadastro de Frota.

**E a causa de fundo era uma função escrita duas vezes.** `baixarCsvCadastro` e
`baixarCsvDoDia` tinham o mesmo escapamento copiado palavra por palavra.
Consertar numa e não na outra era garantir que o defeito voltasse pela outra
porta — a regra da casa ("uma função, dois chamadores") existe exatamente para
isto, e aqui ela estava violada desde que o segundo CSV nasceu.

**Correção.** Uma função de célula (`celulaCsv`) e um montador de corpo
(`corpoCsv`), usados pelas duas. Valor cujo conteúdo inteiro o Excel leria como
data ou número, **numa coluna declarada de texto**, sai como `="3/4"` — que o
Excel, o LibreOffice e o Google Planilhas resolvem como texto.

**Duas coisas que a correção NÃO faz, de propósito:**

- **Não protege a coluna de data.** A data do faturamento tem de chegar como
  data, senão a Administração não ordena nem filtra por ela. O chamador declara
  quais colunas são texto; a data fica fora, junto de peso, KM e valor — que são
  números que ela soma.
- **Não protege o que não precisa.** `Truck` sai limpo. Marcar toda célula como
  texto deixaria o arquivo cheio de `="..."` sem motivo e é o tipo de defesa
  que vira sujeira.

`combinado 1/2 carga` também fica limpo, e é o caso que mostra por que a regra é
"conteúdo inteiro": o Excel não converte essa célula porque ela não tem forma de
data — só o `1/2` sozinho teria.

**Teste que trava.** Blocos 5b e 5c de `testes/test_frete_tabela_e_planilha.py`:
a coluna H protegida, a coluna C ainda data, `Truck` intocado, as outras três
exportações protegidas, e a existência de UMA função de célula — esta última é a
guarda contra a terceira cópia aparecer.

---

## #37 — "No computador do Wemerson está dando umas travadas" (10/09/2026)

**O relato.** Duas mensagens do dono no mesmo dia: *"eu quero conseguir arrumar
e arrastar na montagem do dia"* e *"no computador do wemerson ta dando umas
travadas sera que ta muito epsado ???"*.

**Não era peso, e isso foi MEDIDO antes de tocar em código.** Com 39 linhas (uma
sexta cheia) e o processador 4x mais lento para imitar a máquina dele: desenhar a
tabela leva 187 ms, o DOM fica com 5.494 nós, o JS ocupa 10 MB. Nada disso trava.
Computador novo não resolveria — e essa era a conclusão que a pergunta convidava
a dar.

**A causa.** `renderMontagem` era chamada DIRETO por `carregarMontagemUI`,
passando por fora da proteção de digitação que `renderAll` já tinha. Reproduzido:
digitar `215` no campo de peso e redesenhar deixava o campo VAZIO, com o elemento
trocado e o foco perdido — e a tabela era refeita a cada campo alterado. A pessoa
via o que acabou de escrever sumir, e chamou isso de travada. É o nome certo para
o que ela viu.

**A família.** É a mesma de sempre: *uma função, dois chamadores*. A proteção
existia num caminho e não no outro. Quando a mesma tela tem duas portas de
entrada, a que ninguém olhou é a que quebra.

**Correção.** `renderMontagem` passou a capturar e restaurar a digitação como o
`renderAll` faz — a mesma função, chamada pelos dois. E o campo de sequência
passou a usar a cascata do servidor (`filaReordenada`, a MESMA conta da Torre):
digitar 3 move a linha para a 3 e as outras descem uma casa, em vez de escrever
3 cru e deixar duas linhas com o mesmo número sem aviso.

**O que isso custou num teste antigo, e por que não foi regressão.**
`test_montagem_expansivel` digitava `77` numa fila de 12 e exigia `77` no banco.
Com a cascata, número fora da fila é recusado NOMEANDO as posições válidas
(decisão de 08/09, com teste próprio). Era a **causa 1** das quatro: a regra
mudou de propósito, e o teste media o mecanismo velho. O ponto continua medindo
o que sempre quis — digitar na linha chega ao banco — com uma casa que a fila
tem.

**Teste que trava.** `testes/test_montagem_cascata_e_digitacao.py`, 16 pontos.

**Dois erros meus no caminho, ambos de teste medindo o nada:** o primeiro bloco
media o cartão da Montagem ESCONDIDO, e `focus()` não pega em elemento oculto —
o teste concluía "a digitação some" e acusava um defeito inexistente; e rodei o
teste contra um servidor de 1h31 antes, sem a rota nova, e li 404 como defeito.
O servidor novo tinha morrido em silêncio porque a porta estava ocupada.

---

## #38 — A mesma placa em duas linhas do dia era recusada pelo banco (10/09/2026)

**O relato, do dono.** *"Uma carga em Ribeirão Preto e uma em Marília. Não deixa
duplicar as placas. Precisamos que sejam placas duplicadas, porque são duas
placas: uma na carreta e uma em Marília, na mesma rota. Então o mesmo veículo vai
carregar as duas cargas."*

**A causa.** O índice `ux_prog_montagem_placa_dia`, criado na migração 031, era
**UNIQUE**. A intenção era certa — pegar o acidente de duas pessoas montando o
dia ao mesmo tempo e pondo a mesma placa em duas rotas, que só aparece na doca. A
força era errada: UNIQUE não distingue o acidente do caso legítimo, e o caso
legítimo é rotina.

**A família: a mesma decisão escrita em dois lugares, e só um foi corrigido.** A
Programação já havia abrandado a trava dela em **11/08/2026** — avisa, diz onde a
placa já está, e deixa passar com um clique (regra da casa: *"botão desabilitado
não ensina o caminho, só nega"*). A Montagem ficou com a recusa de banco por um
mês, porque a decisão estava escrita duas vezes. É a ocorrência #06 voltando pela
outra porta.

**Correção.** Migração **050**: o índice continua (é ele que faz a busca de "onde
mais esta placa está hoje" não varrer a tabela), sem o UNIQUE. E a tela passou a
avisar com a **mesma frase** da Programação — `fraseDePlacaRepetida()`, uma
função, dois chamadores. O 409 `PLACA_DUPLICADA` ficou no servidor de propósito:
o código novo roda ANTES da migração, e nessa janela o índice antigo ainda
recusa; sem a frase seria um 500 na cara de quem está montando o dia.

**O que a Montagem NÃO passou a fazer.** Não herdou o botão "➕ Outra carga" da
Programação nem a trava com escape dela. Lá a trava com saída foi pedido
explícito de 11/08; aqui o movimento é pôr placa numa linha que já existe, e
avisar depois de gravar é o que informa sem interromper.

**Enquanto a migração não roda no servidor**, o caminho que desbloqueia quem está
montando — e que foi verificado, 409 antes e 200 depois: pôr a placa na primeira
linha, efetivar essa carga, e então a mesma placa é aceita na segunda linha.
Linha já efetivada sai da fila de placas abertas.

**Teste que trava.** `testes/test_placa_repetida_na_montagem.py`, 18 pontos — e o
ponto 0 mede a CAUSA, não o sintoma: o índice existe e `indisunique = f`. Sem
isso, alguém recria o UNIQUE amanhã e só a operação descobre.

---

## #39 — `pkill -f` matando o próprio terminal (10/09/2026)

Não é defeito do painel, é defeito de quem o opera — e custou uma bateria.

`pkill -f "node src/servidor"` casa com a **própria linha de comando** do shell
que o executa: o padrão está escrito ali. O shell se mata, sai com 144, e o
servidor que acabou de subir morre junto porque era filho dele. O sintoma
seguinte foi um teste lendo 404 numa rota que existia.

A armadilha já estava escrita para `publicar.sh` na regra da casa, e eu a repeti
com outro alvo — o que mostra que a regra estava anotada como caso, não como
família.

**A forma certa, e são duas coisas:** colchete no padrão, para ele não casar
consigo mesmo (`pkill -f "node src/[s]ervidor"`), e **matar numa chamada e subir
noutra** — no mesmo comando, o que sobe morre com o que mata.

---

## #40 — "Page Unresponsive": a fusão do estado remoto crescia ao quadrado (11/09/2026)

**O relato.** Print do dono com o aviso do Chrome, *"a página está aparecendo
muito isso"*, depois *"ta demorando muito pra entrar no site"* e, quando
perguntei se era só a máquina do Wemerson: *"travou no meu também"*.

**A causa.** `fundirEstadoRemoto` fazia, para CADA movimentação que chegava do
servidor, um `findIndex` sobre TODAS as movimentações locais, procurando a
provisória do mesmo evento. Na leitura COMPLETA — a que roda ao entrar no
painel — isso é M²/2 comparações. Medido, processador 4x mais lento:

| movimentações | antes | depois |
|---|---|---|
| 600 | 43 ms | 36 ms |
| 2.400 | 173 ms | 81 ms |
| 4.800 | 553 ms | 141 ms |
| 7.200 | 1.143 ms | 215 ms |

Dobrar o volume quadruplicava o tempo. Extrapolando, 20 mil movimentações
passam de 9 segundos de aba congelada — e é exatamente na entrada do painel.

**A correção.** As provisórias entram num índice montado UMA vez, por chave
`(carga, de → para)`, e a remoção acontece de uma vez no fim. `splice` dentro
do laço traria a mesma conta de volta pela outra porta, porque splice é O(n)
por chamada. O casamento — o que não podia mudar — continua idêntico: uma
provisória por movimentação que chega, e o horário que fica é o do servidor.

**DUAS HIPÓTESES MINHAS, ERRADAS ANTES DESTA, e é por isso que elas estão
escritas aqui.**

A primeira: acúmulo de carga em aberto na Torre. A Torre desenha uma linha por
carga em aberto e com 600 delas leva 10,3 s — a cara do sintoma. Eu já ia
propor publicar uma mudança de tela quando pedi o número ao dono: **18 cargas
em aberto**. A hipótese morreu com o print dele, não com a minha medição.

A segunda veio do buraco que isso revelou: **todas as minhas medições semeavam
`DB.cargas` direto na memória**. O painel do dono não recebe dado assim — ele
recebe pela fusão, que eu nunca tinha medido. Reconstrução que pula um
componente não mede o sistema, mede a reconstrução.

**O que destravou:** em vez de continuar adivinhando, o painel passou a medir
sozinho (ocorrência #41). E a busca pela causa voltou ao componente que a
reconstrução tinha pulado.

**Teste que trava.** `testes/test_fusao_nao_e_quadratica.py`. Ele mede as duas
metades, e a primeira importa mais: o casamento não mudou (três blocos), e a
curva é de reta. O ponto da curva compara FORMA, não tempo absoluto — tempo em
máquina ocupada é ruidoso. Vermelho-verde provado nas duas versões do painel:
código antigo fator 9,1 (reprova), código novo fator 3,7 (passa).

---

## #41 — Quando não dá para reproduzir, o painel passa a medir (11/09/2026)

Não é defeito: é o que se faz quando a investigação não fecha.

Depois de descartar no código o vazamento de escuta, a lista de sugestão por
linha, o redesenho ao arrastar e o redesenho a cada tique — e de duas
hipóteses minhas caírem — a conclusão honesta era: **a causa está numa máquina
que eu não enxergo daqui**. Meu contêiner é bloqueado para o domínio da
operação; HTTP 000 daqui nunca é prova de nada.

Então o painel registra sozinho toda tarefa que segura a tela por mais de meio
segundo, com hora, duração, aba, qual desenho estava em curso, o volume do
momento (cargas, em aberto, movimentações, linhas de montagem, elementos na
tela) e a versão. Vinte e cinco últimos, por navegador, em chave própria do
armazenamento local — apagar travamento nunca pode encostar em carga.

O aviso no rodapé **só existe quando há travamento registrado**: alarme que
sempre aparece deixa de ser alarme.

**A lição, que vale para a próxima.** Eu gastei três hipóteses reconstruindo o
ambiente do dono em vez de instrumentar o ambiente dele. A ordem certa, quando
o sintoma não reproduz, é medir onde ele acontece — e só então formar
hipótese. O medidor custou uma bateria; as três hipóteses custaram mais.

**Teste que trava.** `testes/test_medidor_de_travamento.py`, 15 pontos —
inclusive que o registro sobrevive a recarregar (a pessoa fecha a aba
assustada e só mostra no dia seguinte), que o alarme não aparece sem
travamento, e que medir nunca derruba a tela: com o armazenamento local
bloqueado, o painel segue desenhando.

---

## #42 — O teste mentia para o painel, e o painel obedecia (11/09/2026)

`test_libera_pendencias` reprovava na bateria e passava sozinho. Classifiquei
como contaminação, culpei a sincronia periódica de 15 s, desliguei ela — e o
vermelho voltou na bateria seguinte.

**Rastreado com um observador em `DB.cargas`**, a pilha entregou o culpado:

```
DB.cargas trocada: 1 -> 0
    at Object.sincronizarCarga (data.js)
```

O `window.fetch` de mentira do teste respondia `{}` a qualquer endereço que
não fosse `/api/estado` ou `/api/frota` — **inclusive ao envio da carga**. O
`upsert()` lê isso como recusa do servidor, e carga recusada na CRIAÇÃO é
apagada do painel de propósito (proteção de 07/08/2026 contra carga fantasma).
O painel estava certo; o teste é que mentia.

**A raiz era a fixture contradizendo a própria história.** O comentário dela
diz *"a gravação desta carga já foi enviada com sucesso"* — e carga enviada
com sucesso não fica marcada como `_nuncaConfirmada`. Era a marca que
transformava a recusa simulada em exclusão. Uma linha: `delete c._nuncaConfirmada`.

**A lição:** "passa sozinha, falha na bateria" é conclusão preguiçosa. A
segunda chance do portão existe para separar contaminação de regressão, não
para arquivar o caso. Quando a correção baseada nessa conclusão falha, é
porque a conclusão estava errada — e aí se volta à fase 1, não se tenta a
segunda correção em cima da primeira.

---

## #43 — Os dois caminhos por onde número de sequência repetido ainda entrava (11/09/2026)

Pedido do dono: *"fecha dois buracos de numero repedido"*, depois de
*"SEM DEIXAR QUE REPITA NUMEROS DA SEQUENCIA"*.

A cascata de 10/09 fechou o caminho do meio: digitar o número numa linha que
ainda vai carregar passa por `POST /montagem/:id/sequenciar`, e lá a fila do
dia é renumerada inteira, numa transação só. **Sobravam os dois caminhos de
fora, e os dois foram medidos antes de corrigir:**

**Buraco 1 — `PATCH /montagem/:id` gravava `sequencia` crua.** Quem chega aqui
é a linha CANCELADA (a tela manda o campo direto para cá quando a linha não
vai mais carregar) e qualquer valor que não seja inteiro. Medido: três linhas
em 1, 2 e 3; `PATCH` da primeira para 3 respondia **200** e o dia ficava
`[2, 3, 3]`. E número de linha cancelada é *reservado*: ao virar o mesmo de
uma linha viva, `numerosDaFila()` entende que o número é de quem saiu, tira a
linha viva do pool e a renumera na cascata seguinte — a ordem do dia muda
sozinha, sem ninguém ter pedido.

**Buraco 2 — `POST /montagem` aceitava o número que o painel mandasse**, e o
painel mandava `montagens.length + 1`. Contar linhas não é achar casa livre:
dia com linha cancelada ou já reordenada tem buraco. Medido: com 1, 2 e 3 no
dia, criar pedindo 2 nascia **2** e o dia ficava `[1, 2, 2, 3]`.

**Um terceiro defeito apareceu ao medir, no mesmo campo:** `Number('')` é
ZERO. O campo apagado na tela não limpava a coluna — gravava `sequencia = 0`.

**A correção, toda no servidor:** a criação acha casa livre ACIMA da maior
(honrando o número pedido quando está livre, que é o caso do "puxar rotas");
a edição RECUSA com 409 `SEQUENCIA_EM_USO` e a mensagem diz em qual linha o
número está e por onde se muda a ordem — recusa que ensina o caminho, não só
nega. O painel parou de inventar número: não manda mais `sequencia` na
criação.

**Por que NÃO um índice único no banco:** é a lição da placa, da véspera
(#38). O índice recusa no lugar mais fundo e mais cedo, sem saber do caso de
uso, e o dia que ele torna impossível de montar só aparece na operação, com
caminhão no portão. A regra mora na rota, que sabe o que fazer com o pedido.

**A trava é o nó.** Ler os números ocupados e gravar o novo são duas coisas, e
entre uma e outra o segundo computador lê o mesmo "livre". Medido com seis
criações simultâneas pedindo a MESMA casa: as seis nasciam com `sequencia = 1`.
`pg_advisory_xact_lock` por dia põe as duas pessoas na fila e solta no fim da
transação — sem tabela de controle e sem índice. A mesma trava passou a valer
para a cascata, que também lê a fila antes de gravá-la.

**Teste que trava.** `testes/test_numero_de_sequencia_nao_repete.py`, 24
pontos — inclusive que o caminho legítimo (`/sequenciar`) não foi fechado
junto, que apagar o número continua apagando, que reenviar o PRÓPRIO número
junto com outro campo não é conflito, e as seis criações simultâneas. Reprovou
em 21 dos 24 contra o publicado antes da correção.

**Adendo, mesmo dia, achado pela revisão de código — a trava tinha um furo, e
era meu.** A criação trancava a chave `'2026-09-11'`; a edição e a cascata
liam `data_prog` do banco, que o driver devolve como `Date`, e `String(Date)` é
`Fri Sep 11 2026 00:00:00 GMT…`. Medido: `hashtext` das duas dá **-1453919943**
e **-435495344** — chaves diferentes, travas que **não se excluíam**. Meu
teste de concorrência só disparou criação contra criação (mesma chave) e
passou. Correção: `chaveDoDia()` formata sempre em ISO, e as consultas pedem
`data_prog::text`. Guarda: bloco 6 do mesmo teste segura a trava com a chave
ISO e prova que edição e cascata **esperam** (antes: respondiam 200 na hora).

---

## #44 — A lista de Destino da Montagem mostrava "[object Object]" (11/09/2026)

Achado pela revisão de código dos commits de 09–11/09, reproduzido no
navegador antes de mexer: `['—', 'MARÍLIA', '[object Object]', '[object Object]']`.

`DESTINOS_FRETE` guarda **objetos** `{destino, km}` — é assim que
`receberTabelaDeFrete()` a preenche e que a Programação (datalist) e o cálculo
de KM a leem. A célula da Montagem tratava a lista como **texto**:
`lista.includes(atual)` nunca achava o destino atual e `esc(d)` de um objeto
imprime "[object Object]". Quem monta não escolhia destino pela lista; se
escolhesse, gravava "[object Object]" no servidor, o KM ficava nulo e a carga
nascia sem frete. É provavelmente o *"quando adiciona a linha ela não aparece
o destino"* de 10/09 — corrigido "pela metade": as colunas entraram, a lista
não funcionava.

**Por que nenhum teste pegou:** `test_destino_frete_na_montagem.py` prova a
rota (POST/PATCH gravam destino e KM) e nunca abre a célula. É a família do
#42 e do "verde falso" da regra 7: a asserção media a camada errada.

**Correção:** `destinosFreteOrdenados()` — uma função, dois chamadores: o
datalist da Programação e a célula da Montagem leem a mesma lista pela mesma
ordenação; a célula mapeia para nomes. **Guarda:**
`testes/test_lista_de_destino_na_montagem.py`, 9 pontos — nomes ordenados,
atual marcado, ordem igual ao datalist, o `change` manda o NOME, destino que
saiu do cadastro continua na linha. Reprovou em 4 contra o publicado.

---

## #45 — O único botão que a Qualidade vê respondia 403 (11/09/2026)

Achado pela revisão. O setor Qualidade nasceu em 09/09 com a decisão do dono
*"qualidade so acompanha e exporta relatorio"*: a aba Relatórios mostra a ela
só o card do checklist. Mas `DONOS_DO_DOCUMENTO` (documentos.js) não recebeu
a Qualidade em `devolucoes-do-dia` nem em `devolucao-operador` — e é o
servidor quem decide. Ela clicava, e voltava *"O setor Qualidade não gera este
documento"*.

**Por que nenhum teste pegou:** `test_setor_qualidade.py` provava que o card
**aparece**; ninguém pedia o PDF em nome dela. Botão visível que sempre dá
erro ensina o operador a ignorar mensagem — o próprio comentário de
documentos.js diz isso.

**Correção:** a Qualidade entra nos dois documentos do checklist, e só neles.
**Guarda:** bloco 7 do mesmo teste — `podeGerar('Qualidade', …)` verdadeiro
para os dois do checklist, falso para pátio e frete.

---

## #46 — No celular, a coluna Seq. nunca aparecia na Montagem nem na Fila (11/09/2026)

Achado pela auditoria de paridade mobile, medida com **toque real** em 390px
(o `.click()` sintético mascarava o defeito). Reproduzido em teste próprio antes
de mexer: a linha abre (`mont-linha-aberta` / `prog-linha-aberta`), mas a Seq.
segue `display:none` e o rodapé do cartão continua dizendo "toque para ver
tudo". Na Torre funciona.

**O mecanismo.** No cartão do celular os campos secundários (`data-sec`) só
aparecem quando a linha tem `cartao-aberto`, ligada por um ouvinte de toque no
`document`. Montagem e Fila têm `onclick` na própria linha que **redesenha o
tbody inteiro** — ele roda antes do ouvinte do document, que então liga a
classe num `<tr>` já destacado do DOM. A Torre não redesenha ao abrir, por
isso lá o toggle sobrevive.

**O que custava.** *"Digite ou arraste para reordenar, os dois precisam
funcionar"* (pedido do dono, 09/09) valia só no computador. De celular, no
pátio, a Logística não conseguia dar posição a caminhão nenhum nas duas telas
onde passa a manhã — e a recusa nova de hoje (*"digite o número na coluna
Seq."*) apontava para um campo invisível: trava sem o par na tela, família
#13/#20. Junto: o botão ⏱ do rodapé tinha **18px** de altura — o único jeito
de alguém reportar um travamento não cabia num dedo.

**A correção é "o estado desenha a classe":** a linha aberta nasce com
`cartao-aberto` no redesenho (`aberta` já era o estado), e o ouvinte do
document deixa em paz as linhas que se abrem sozinhas. Mesma decisão na
Montagem e na Fila. O ⏱ entra na regra de 44px de `pointer:coarse`.

**A lição:** toggle de classe em cima de DOM que outra função reconstrói é
promessa que não se cumpre. Quem sabe se o cartão está aberto é o estado —
ele desenha. **Guarda:** `testes/test_sequencia_no_celular.py`, 15 pontos,
com toque de `touchscreen` e rolagem até a linha (fora da tela o toque cai
no vazio — meu primeiro vermelho foi esse, e não era o defeito).

---

## #47 — O portão mediu um servidor de outro commit (11/09/2026)

Portão de `d5caf49` reprovou em UMA suíte: o bloco 6 de
`test_numero_de_sequencia_nao_repete` (a trava por dia). Segunda chance,
banco limpo: reprovou de novo — "vermelho de verdade", disse o portão.

Não era. A API da porta 3010 estava no ar, com Chromium, `pronto:true` — e
rodando **`c57f166`**, o commit anterior, sem a `chaveDoDia()` que o bloco
medía. `/health` dizia isso desde o começo (`versao: "11/09 02:27 · c57f166"`);
o portão só perguntava "responde e gera PDF?" e reaproveitou. Vinte e cinco
minutos de bateria contra código velho, e um vermelho que parecia regressão.

**É a terceira lição da mesma etapa 5**, e está escrita em cima das outras
duas no `publicar.sh`: "no ar" não bastava (1ª), "inteira" tinha que incluir
o Chromium (2ª) — e agora tem que incluir **o commit**. `api_inteira()` exige
que o hash de `git rev-parse --short HEAD` apareça no `/health`; se não
aparecer, o portão derruba e sobe o certo, sozinho. Controle que dependia de
eu lembrar de reiniciar o servidor deixou de depender (regra 3 do dono).

**Causa do vermelho, pelas quatro:** nenhuma das quatro — era o **ambiente**
do portão. Fica registrado porque a segunda chance do portão não distingue
"servidor velho" de "regressão", e por isso o portão agora impede o servidor
velho de existir.

---

## #48 — "NADA FOI GRAVADO" era mentira: a demora apagava carga que o servidor tinha (11/09/2026)

Incidente em produção, relato do dono com prints, placa **RYV8G03**: *"criamos a
carga, ficou offline, voltou, ela apareceu em Aguardando Carga sem carga, o
histórico tá completamente bugado"*. O Histórico mostrava **quatro cargas**
criadas para a mesma placa em meia hora (12:04, 12:14, 12:23, 12:31), todas
"não está mais no painel". O rodapé registrava **16 travamentos, pior 46,5 s**
numa máquina e 25 na outra. A tela alternava "Modo Offline" e "Conectado".

**A cadeia, lida no código e reproduzida em teste:**

1. a tela congela (46 s — o medidor ⏱ de ontem gravou; é dele a prova);
2. o painel espera **20 s** por resposta; a resposta que chega durante o
   congelamento vira `AbortError` → `motivo: 'timeout'`;
3. `upsert()` tratava timeout igual a "sem rede" (`eFalhaDeRede`) e devolvia
   `{recusado, offline}`;
4. `sincronizarCarga` apagava a carga nunca-confirmada e a tela dizia
   **"VOCÊ ESTÁ OFFLINE — NADA FOI GRAVADO e a linha saiu da tela"**;
5. mas o POST **tinha chegado**: o servidor gravou. O operador, obedecendo ao
   aviso, relançou — e a placa multiplicou. Cada relançamento, uma carga nova.

**O painel mentiu com convicção.** A regra de 31/08 ("offline: a linha sai e a
pessoa refaz") está certa quando não há servidor. Demora não é ausência de
servidor — é o caso em que o painel **menos** sabe o que aconteceu, e era
exatamente aí que ele afirmava com mais certeza.

**Correção:** numa CRIAÇÃO que caiu por falha de rede, `upsert()` **pergunta**
ao servidor (`/api/estado`, a rota que todo servidor em produção já tem) se a
carga existe. Existe → fica, vira confirmada, com a versão do servidor. Não
existe, ou o servidor não responde → aí vale a regra de 31/08. Só a criação
pergunta: edição recusada nunca apagou nada. Recusa de verdade (422/409/403)
continua removendo (#07/08, `test_carga_recusada_nao_fica_fantasma`).

**O que esta correção NÃO faz:** não cura o congelamento de 46 s. Ela impede
que o congelamento vire carga duplicada. A causa do congelamento está no
registro do ⏱ (tela, desenho, volume) — pedido ao dono.

**A hipótese do dono ("migrações e arrasto pesando o servidor")** foi
respondida com a evidência dos próprios prints: o medidor mede o navegador; as
migrações 049/050 criam colunas e trocam um índice; o arrasto no servidor é
uma transação de até 40 linhas. Voltar o painel para antes do arrasto
reintroduziria a fusão quadrática (#40), que congelava mais. Pedidas a ele as
duas saídas que provam ou derrubam a hipótese do servidor (`uptime`, `free`,
`journalctl`).

**Guarda:** `testes/test_demora_nao_apaga_carga.py`, 4 cenários / 12 pontos —
5 vermelhos contra o publicado, todos no cenário do incidente.

---

## #49 — Limite que dispara atrasado não é o servidor, é a página (11/09/2026)

Mesmo incidente da RYV8G03 (#48), segunda metade. Provado em teste próprio:
uma caixa de diálogo do navegador (`confirm`) ou um congelamento param o
relógio da página inteira. A resposta do servidor que chegou em 0,3s só é
processada quando a página volta — DEPOIS do temporizador de 20s, que
dispara junto. `upsert()` já parava de culpar demora como recusa (#48); mas
o `chamar()` de base ainda tratava esse `AbortError` como "servidor não
respondeu", e isso valia para TODA chamada — inclusive as de leitura
(`/api/estado`), que é o que fazia o painel piscar "Modo Offline" e
"Conectado" com internet e servidor de pé.

**A regra:** o temporizador sabe a que hora devia disparar. Se disparou 2s
ou mais depois da hora certa, quem travou foi a PÁGINA — e a leitura é
repetida uma vez, agora, em vez de virar offline. Se disparou na hora certa
(sem atraso), o servidor demorou de verdade, e vale o comportamento de
sempre. Gravação não repete às cegas (mudar status duas vezes não é
idempotente) — sai etiquetada como `motivo: 'pagina-bloqueada'`.

**Guarda:** `testes/test_limite_atrasado_nao_e_offline.py` — dois cenários,
o atrasado (repete, fica online) e o normal (não repete, fica offline).

## #50 — O medidor de travamento passa a nomear o suspeito (11/09/2026)

Depois de #48/#49, ainda falta responder à pergunta do dono: *"me explica o
que realmente pode ser o fato isolado que tá causando esse travamento"*. O
registro v1 (ocorrência #41) media duração, aba, volume de dados e o
desenho que encostou — e isso não bastava: os travamentos de 21s/46s do
Alysson tinham desenho de só 0,25s dentro. Sobraram três suspeitos que só o
PRÓXIMO congelamento pode nomear:

1. coletor de lixo do navegador parando a página (mais provável — a máquina
   mais fraca teve 46s contra 6s da mais forte, com o MESMO código);
2. rajada de eventos de socket (30 avisos → 30 sincronias em fila);
3. aba em segundo plano.

**O que o registro passou a guardar:** memória usada e limite
(`performance.memory`, quando o navegador expõe), quantos eventos de socket
chegaram nos 30s antes (`eventosNosUltimos` no adaptador — um carimbo por
evento, janela de 60s, nunca cresce), quantos desenhos aconteceram nos 30s
antes, se a aba estava visível ou em segundo plano, e o peso (elementos) de
CADA aba guardada na memória — não só a ativa, porque o painel mantém todas
as abas desenhadas ao trocar (achado do dia: 57 mil elementos na tela).

**Guarda:** `testes/test_medidor_v2_contexto.py` — confirma as chaves novas
no registro, que `eventosNosUltimos` existe no adaptador sem quebrar nada
sem socket real, e que o texto do diálogo (o que se manda por print) inclui
o contexto. `test_medidor_de_travamento.py` (v1) segue verde — nada do que
já existia mudou de forma.

**Ainda em aberto:** qual dos três é. Só o próximo travamento registrado
nomeia — e a resposta chega sozinha, sem precisar reproduzir nada.

---

## #51 — O Histórico emagreceu: o detalhe nasce vazio, não mais pré-construído (11/09/2026)

Resposta à pergunta do dono, direto: *"me explica o que realmente pode ser
o fato isolado"*. Medido com o volume exato do relato (500 cargas, 2.813
movimentações, 30 linhas de montagem), o peso da página inteira ficou assim
por aba:

```
historico       47.469   <- 83% do total
cadastros        3.717
torre            1.629
(demais 8 abas)  ~4.400
TOTAL           57.196   (bate com o "57001 elementos na tela" do registro)
```

**A causa:** `detalheHistoricoHtml(m)` — a grade de campos, lacres, datas e
dois botões que aparece ao abrir uma linha — era construída para as 500
linhas do teto de desktop DE UMA VEZ, escondida (`hidden`), mesmo que quase
nenhuma seja aberta. ~95 nós por linha × 500 = a conta bate.
`alternarDetalheHistoricoUI` só alternava `hidden`; nunca construiu nada —
o trabalho já tinha sido feito, à toa, no redesenho.

**Correção:** o `<td>` do detalhe nasce vazio. `alternarDetalheHistoricoUI`
constrói na primeira abertura (a mesma `detalheHistoricoHtml`, o mesmo
conteúdo) e marca `dataset.construido` — fechar e abrir de novo reaproveita
o nó, não reconstrói. Nada muda para quem usa a tela.

**Medido, no teste:** 300 linhas fechadas = 6.050 elementos; as mesmas 300
todas abertas = 30.890 — a diferença (24.840) é o que a tela deixa de
carregar à toa quando ninguém abre a maioria das linhas, que é o caso
normal de uso.

**O que isto NÃO resolve sozinho:** não é a causa provada do travamento de
21–46s (essa segue em aberto — ver #50, o medidor que vai nomear o
suspeito no próximo registro). É garantidamente menos trabalho para o
coletor de lixo fazer, e o Histórico deixa de ser 83% do peso da página.

**Guarda:** `testes/test_historico_detalhe_preguicoso.py`, 5 blocos —
nasce vazio, primeiro clique constrói com o conteúdo de sempre, fechar/abrir
não reconstrói, o peso cai de forma mensurável, carga sumida continua
avisando. Sete suítes correlatas (Histórico, cartão mobile, datas, lacres,
esteira de devolução) seguem verdes — nenhuma dependia do detalhe vir
pré-construído.

---

## #52 — Apagar da vista os lançamentos de uma placa, sem apagar a prova (11/09/2026)

Pedido do dono em emergência (RYV8G03, ocorrência #48): *"EXCLUA TODOS OS
LANÇAMENTOS PRA ESSA PLACA AGORA (...) eu preciso conseguir apagar do
histórico e essa autorização é somente para o meu token"*.

**Não é DELETE.** `fact_statusfrota` é append-only desde a migração 001 — é
a base de todo indicador de tempo e do Power BI, e apagar de verdade
destruiria a própria prova do defeito que a ocorrência #48 documenta.
Migração 051 acrescenta `apagada_em/apagada_por/apagada_motivo`: a linha
fica, marcada; toda leitura (`/api/estado`, `/api/historico`, entrada no
pátio) passa a ignorar o que está marcado.

**Só a Administração** (`POST /api/movimentacoes/apagar`, `exigirSetor()`
sem argumento) apaga, com motivo obrigatório — sem motivo é 400, sem ser
Administração é 403. O botão só aparece no Histórico com uma placa
filtrada — apagar "tudo" sem filtro é o tipo de clique acidental que a tela
não pode oferecer.

**Guarda:** `testes/test_apagar_historico_da_placa.py` — Administração
apaga e a linha continua na tabela (marcada); Logística é recusada; a
leitura para de devolver a placa; apagar de novo não conta nada; o botão
só existe para quem pode e só quando há placa no filtro.

**Nota da pressa:** enquanto o código ainda não estava publicado, o dono
pediu a via mais rápida — apagar a RYV8G03 direto por SQL no servidor
(`DELETE FROM fact_viagens`). Foi orientado como a exceção explícita e já
autorizada por ele (ele mesmo pediu "essa autorização é somente para o meu
token" na emergência), separada desta função — que existe para as
próximas vezes, sem precisar de mim nem de SSH.

---

## #53 — Incerteza de rede nunca mais apaga carga: só recusa de verdade apaga (11/09/2026)

Segunda volta do mesmo defeito, no mesmo dia. Relato do dono, ao vivo, testando
a correção da ocorrência #48: *"deu o mesmo problema quando insiro a placa ryv
na programação — ele fica offline e online e dá erro"*, e depois: *"ela não
entra na fila de programados, ela some"*.

**A CAUSA — a #48 tinha uma brecha estreita.** `upsert()` já conferia com o
servidor uma vez antes de dizer "não gravou" numa criação. Mas essa ÚNICA
conferência também podia falhar (servidor lento, não necessariamente rede
caída) — e quando falhava, o código tratava "não consegui perguntar" como se
fosse "a resposta é não", e apagava a carga mesmo assim. Era o defeito
original, um degrau mais fundo.

**A DISTINÇÃO CERTA não é sobre timeout × transporte** (cheguei a tentar essa
via primeiro e reverti — os dois tipos de falha de rede podem, de fato, cobrir
um servidor lento). **É sobre a conferência ter respondido de verdade ou ter
falhado ao tentar:**

- a conferência RESPONDEU e a carga não estava na lista → o servidor disse que
  não tem, e aí vale a regra de 31/08: remove, avisa, refaça;
- a conferência NEM CONSEGUIU responder (ela mesma caiu) → "não sei" nunca é
  "não existe": a carga fica, marcada como incerta, e a sincronia seguinte
  confirma sozinha.

**O SEGUNDO BURACO, achado ao escrever o teste:** o motor de sincronia
(`sincronizarCargasAlteradas`) marcava a carga como "já tentei" ANTES de saber
se a tentativa deu certo. Uma carga incerta, sem ninguém mexer nela de novo,
nunca teria `atualizadoEm` mudado — e por isso NUNCA seria reenviada. A
mensagem "vou tentar de novo sozinho" seria mentira sem corrigir isso também:
agora, enquanto `_nuncaConfirmada` for true, toda sincronia (inclusive a que
roda a cada leitura do servidor — `fundirEstadoRemoto` chama `save()` sempre
que chega algo novo, o que acontece o tempo todo num pátio ativo) tenta de
novo, ignorando a marca.

**A MENSAGEM também mentia.** Todo aviso de offline dizia "a linha saiu da
tela" — mesmo quando não saía (edição, e agora a criação incerta). Passou a
ter um texto próprio para a incerteza: "NÃO CONSEGUI CONFIRMAR COM O SERVIDOR
(...) não relance nem exclua, ou pode duplicar".

**DUAS SUÍTES ANTIGAS ficaram vermelhas contra a correção, e eram cause nº 1
das quatro — a regra tinha mudado de propósito, eram elas que estavam
desatualizadas, não regressão.** `test_demora_nao_apaga_carga` (bloco 3) e
`test_offline_nao_grava` (bloco 2b) exigiam que a carga saísse da tela quando
a conferência também falhava — exatamente a decisão que causou este incidente.
Atualizadas com a explicação de por que a decisão mudou, e `test_offline_nao_grava`
ganhou um bloco novo (4b) provando que a carga incerta vira real sozinha
assim que a rede volta, sem o operador redigitar nada.

**Teste novo:** `test_incerteza_nao_apaga_carga.py` — prova os três
comportamentos juntos: incerteza nunca remove, a mensagem diz a verdade,
recusa de verdade continua removendo (guarda de 07/08), e a sincronia
seguinte confirma sozinha.

**A lição, escrita para não se repeter uma terceira vez:** o custo de uma
linha incerta ficando visível um pouco mais é sempre menor que o de uma carga
real desaparecer calada. Toda vez que a dúvida for "remover ou manter", a
resposta é manter — a sincronia converge para a verdade sozinha; a remoção
não tem volta.

---

## #54 — A correção da #53 podia virar rajada infinita numa carga antiga (11/09/2026)

Minutos depois de publicada a #53, relato do dono: *"118684 sistema offline"*.
118684 é o número da carga do **incidente original desta manhã** — uma carga
que ficou presa como `_nuncaConfirmada` no navegador dele desde ANTES de
qualquer correção de hoje existir.

**A CAUSA:** a #53 fez a sincronia tentar de novo enquanto uma carga não
confirmar (certo, é o que fecha a #53). Mas sem limite de frequência:
`fundirEstadoRemoto` chama `save()` toda vez que chega qualquer dado novo do
servidor — o que num pátio ativo é o tempo todo. Uma carga velha, presa e sem
jeito de confirmar (o servidor genuinamente não tem mais aquele carga_id, ou
o motivo pelo qual ela nunca confirmou continua valendo), virou dezenas de
tentativas por minuto — mais carga num servidor que já estava sendo apontado
como lento, e um aviso repetindo sem parar para o dono.

**A CORREÇÃO:** recuo entre tentativas para cada carga, crescendo a cada
falha (5s, 10s, 20s... até 60s — a mesma régua do backoff da fila offline em
suinco-api.js). E o AVISO parou de repetir a cada tentativa: notifica na
primeira vez, depois só a cada 6ª (de longe em longe, uma vez o recuo no
teto), com o texto mudando de tom depois de muitas tentativas — de "vou
tentar de novo" para "confira à mão". A carga nunca some sozinha por isto;
só a frequência do aviso e da tentativa mudam.

**Teste que trava:** `testes/test_recuo_carga_incerta.py` — simula a própria
carga "118684": recuo segura a próxima tentativa, cresce a cada nova falha,
o aviso não repete até a 6ª tentativa (e muda de tom quando repete), e
confirmando de verdade os contadores somem.

**A lição, novamente:** cada correção de hoje revelou o próximo degrau do
mesmo poço. A #48 corrigiu apagar sem confirmar; a #53 corrigiu remover por
incerteza; a #54 corrige a retentativa virar rajada. As três eram
necessárias — nenhuma sozinha bastava.

## #55 — O login de um setor ecoava gravação e recusava a dos outros (12/09/2026)

Relato do dono, com três prints: *"vamos lá acontecendo problemas de
instabilidade e preciso da sua resolucao"*. No print do Faturamento, **41
avisos de "conflito de versão"** empilhados. Transcrição do áudio do Alysson,
no mesmo dia: *"o pessoal do faturamento também reclama. Eles precisam fazer
login quase o tempo todo e recebem a mesma mensagem, **impossibilitando a
inserção de informações**."*

**O carimbo enganou primeiro.** O rodapé do print dizia `11/09 20:23 ·
ac31f4f`, um commit ANTES da correção da #54 — e a primeira leitura foi
"navegador com cache velho". Errado: `build_arquivo_unico.py` grava o carimbo
ANTES do commit que o carrega, então o `index.html` do commit publicado
`f275714` carrega exatamente `ac31f4f`. **O navegador estava na versão mais
nova.** O defeito era real e estava no ar. *Carimbo de build não é prova de
versão carregada — é prova da versão anterior.*

**A CAUSA:** em `fundirEstadoRemoto`, o bloco que marca `_ultimoSync` (a
proteção contra eco) rodava **no fim da função, depois** das mesclagens de
frota e de rotas. E `upsertFrota`/`upsertRota` chamam `save()` sem condição.
Nessa janela `_ultimoSync` ainda estava vazio para as cargas que a PRÓPRIA
fusão acabara de empurrar, então o guard de `sincronizarCargasAlteradas` não
reconhecia nenhuma e **toda carga levava um PATCH espontâneo**. O gatilho
`tg_viagem_update` (001_schema.sql:181-191) incrementa `versao` em todo
UPDATE, mesmo gravando valor idêntico — então os outros terminais, que tinham
lido antes do eco, levavam **409 CONFLITO_DE_VERSAO** ao gravar edição
legítima.

**Medido:** 20 cargas na tela, login do Faturamento **sem editar nada** → 20
PATCH enviados, versão de todas passando de 1 para 2. No cenário fiel ao
relato: `{200: 69, 429: 157, 409: 45}` e a pílula "+43 aviso(s) aguardando". A
Expedição, gravando em cargas **recém-criadas que ninguém havia tocado**, foi
recusada em **45 de 45**.

Por que o Faturamento e não os outros: ele loga mais vezes que todo mundo
(família #24/#25) e mantém muitas cargas abertas. **Quem loga mais, ecoa
mais — mas quem perde a gravação são os outros setores.**

**A CORREÇÃO:** a estampagem passou para ANTES das mesclagens de frota e
rotas, com o `save()` final ficando onde estava.

**Teste que trava:** `testes/test_login_nao_regrava_carga_que_ninguem_editou.py`
— leitura completa com cargas + frota + rotas tem que produzir **zero**
POST/PATCH de carga.

**A lição:** ordem dentro de uma função é contrato. Um `save()` no meio do
caminho lê estado pela metade, e estado pela metade virou escrita que ninguém
pediu.

## #56 — Edição local dada como enviada sem nunca ter subido (12/09/2026)

Achado investigando os mesmos prints da #55, e é o mais grave do dia: **não
dá erro, não pisca vermelho, não some da tela.** O operador vê o que digitou,
acha que gravou, e o servidor nunca recebeu.

**A CAUSA, em dois lugares:**

1. `fundirEstadoRemoto` estampava `_ultimoSync`/`DB._sincronizado` em **TODAS**
   as cargas locais, inclusive as com gravação pendente. A própria fusão, uma
   linha acima, **se recusa a sobrescrever** carga `_pendente` (regra 3) — e
   em seguida a marcava como sincronizada. Contradição dentro da mesma função.
2. `sincronizarCargasAlteradas` marca `_ultimoSync` **ANTES** de saber se a
   subida deu certo. O código já conhecia o perigo: o ramo `_emVoo` se recusa
   a marcar, com a frase *"marcar aqui faria a mudança sumir para sempre"*. O
   que faltava era aplicar o mesmo raciocínio quando a pendência vinha de uma
   gravação ANTERIOR que não confirmou.

Com as duas juntas: edição de lacre na Portaria que não subiu + **uma
atualização remota de qualquer OUTRA carga** (coisa de todo minuto num pátio
ativo) = marca posta, e a sincronia seguinte **não tenta mais**. Dado preso
naquele aparelho, para sempre, sem aviso.

**A CORREÇÃO:** `temGravacaoLocalPendente(c)` — uma função, três chamadores
(`podarLocal`, a estampagem da fusão, a estampagem da sincronia). Nenhum dos
três marca como sincronizada uma carga cuja gravação não chegou. Tenta subir
de qualquer forma; o que não pode é **dar por feito**.

**Teste que trava:** `testes/test_pendencia_local_nao_e_dada_por_sincronizada.py`
— carga pendente + atualização remota de OUTRA carga: a marca não pode ser
posta, e a sincronia seguinte tem que tentar enviar.

**A lição:** escrita otimista sem confirmação é como se perde dado — está
escrito nas regras da casa, e aqui estava escrito duas vezes no próprio
arquivo, nos comentários, enquanto o código fazia o contrário.

## #57 — Rota não cadastrada virava "sistema offline" (12/09/2026)

Encontrado no **log do VPS do dono**, treze vezes em 11/09 (15:09, 15:17,
15:19, 15:27, 15:33, 19:07, 19:09, 20:18, 20:19, 20:23, 20:24, 20:26, 20:29):

```
[erro] POST /api/cargas — violates foreign key constraint "fact_viagens_rota_codigo_fkey"
```

**A CAUSA:** criar carga com código de rota fora de `dim_rotas` viola a chave
estrangeira e saía como **500**. `eFalhaDeRede()` em `suinco-api.js` trata
todo status ≥ 500 como rede fora do ar — correto para a maioria dos 500, e
errado para este, que é recusa **permanente**. A conferência da #48/#53
respondia (servidor de pé, rápido) que a carga não existe, e o painel
enfileirava para tentar **para sempre** um erro que nunca vai ser aceito,
mostrando *"VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL... CONECTE-SE PARA
CONTINUAR"*. O operador obedecia o aviso e refazia com o mesmo código de
rota. São as treze tentativas do log.

O servidor **já conhecia esta armadilha**: o tratamento de
`entity.too.large`, logo acima no mesmo arquivo, tem o raciocínio escrito por
inteiro — *"diz 'erro interno no servidor' para uma requisição que o servidor
recusou de propósito, e manda o painel tratar como falha de rede"*. Faltava
aplicá-lo à chave estrangeira.

**A CORREÇÃO:** `servidor.js` mapeia o código `23503` do Postgres para **422
`CADASTRO_INEXISTENTE`**, com o nome do cadastro e o valor recusado na
mensagem: *"A rota "011" não está cadastrada. Cadastre antes de gravar."* 422
já cai no ramo de recusa legítima do `upsert()` — não enfileira, não insiste,
e o operador lê o motivo verdadeiro. Vale para toda chave estrangeira, não só
a da rota.

**Teste que trava:** `testes/test_recusa_permanente_nao_e_offline.py` — bate
no servidor de verdade; exige 4xx (não 500), proíbe a palavra "OFFLINE" e o
"CONECTE-SE" no aviso, e confere que não ficou linha fantasma em
`fact_viagens`.

**A lição:** o status HTTP é a etiqueta com que o painel decide insistir ou
desistir. Errar a etiqueta no servidor faz o painel mentir para o operador —
e mandá-lo repetir o que nunca vai dar certo.

## #58 — O teto da fila de avisos estava escrito e nunca foi implementado (12/09/2026)

Print do dono com **"+41 aviso(s) aguardando"** no Faturamento e outro com
**67** no celular do Alysson, em cargas diferentes (`PLI2A86`, `118021`,
`117993`).

**A CAUSA:** `NOTIF_MAX_FILA = 4` existe em `app.js:55` desde 25/08/2026, com
um bloco de comentário de 35 linhas explicando as três regras da fila — e a
regra 1 (*"Além de MAX_FILA, o mais antigo cai"*) **nunca foi escrita em
código**. A constante era declarada e não era lida em lugar nenhum do
arquivo. Avisos de recusa de carga não são perecíveis de propósito (são
resposta a uma ação de quem está na frente da tela), então nada os
descartava: cada carga aguardando confirmação abria o seu próprio aviso, sem
fim. **Medido:** 15 cargas + 13 leituras remotas = 45 avisos, 42 ainda na
fila.

**A CORREÇÃO:** `_apararFila()` aplica o teto de verdade, descartando o mais
antigo. Aviso com som (`forte`) nunca cai — troca de placa é segurança, o
caminhão errado entra na doca por causa dele; se só sobrarem avisos de
segurança, a fila passa do teto de propósito.

**Teste que trava:** `testes/test_fila_de_avisos_tem_teto.py` — as duas
famílias (incerteza e conflito de versão), separadas e juntas, não passam do
teto declarado.

**A lição, e é a que dói:** comentário não é controle. Havia 35 linhas
explicando uma regra que o programa não cumpria, e a explicação sobreviveu
quatro semanas lida por quem confiava nela. **Regra descrita e não
implementada é pior que regra ausente** — ela engana quem revisa.

## #59 — Achados do mesmo dia que NÃO foram corrigidos (12/09/2026)

Escritos aqui para não dependerem da memória de ninguém.

**a) A conferência de sessão falha FECHADA.** `middleware/auth.js:50-68`
roda uma consulta ao banco **por requisição autenticada** e o `catch`
genérico devolve `SESSAO_NAO_VERIFICAVEL` para **qualquer** falha — inclusive
timeout de pool. Reproduzido em laboratório: token válido, `sessao_versao`
batendo, `ativo=true`, e **401 em 5,004s** (exatamente o
`connectionTimeoutMillis`). `chamar()` em `suinco-api.js:363-365` apaga o
token sem olhar o `codigo`. Alcança **74 rotas**. **MAS: não há evidência de
que tenha disparado em produção** — sete dias de `journalctl` não trazem
nenhuma linha de falha da conferência. É risco provado, causa não provada.
Não foi corrigido para não publicar mudança de autenticação sem o defeito
estar demonstrado no ambiente real.

**b) Por que o Faturamento é forçado a logar — EM ABERTO.** A #55 explica a
rajada de avisos e a recusa de gravação, não o logout. Pendente: medir.

**c) `/health` de produção responde `"versao": "desconhecida"`.**
→ **CORRIGIDO no mesmo dia: ver #60.**

**d) `"pdf": {"pronto": false}` em produção — e a primeira leitura disto foi
ERRADA.** Foi relatado ao dono como *"o gerador de PDF está desligado"*. Não
está. O indicador mede `PLAYWRIGHT_CHROMIUM_PATH`, que é a variável de
DESENVOLVIMENTO; o serviço systemd define `PLAYWRIGHT_BROWSERS_PATH` (ver
instalar.sh) e o `gerarPdf` passa `executablePath: undefined`, deixando o
Playwright achar o navegador — **que é o caminho de código da produção, e ele
funciona**: medido em 12/09, PDF gerado sem a variável, 6118 bytes, assinatura
`%PDF-` válida. O que existe é um **indicador que acusa defeito onde não
tem** — e isso custa tempo de quem vai investigar.

**Decisão do dono, 12/09: "deixa o pdf do jeito que tava".** Nada no PDF foi
alterado. Fica registrado porque a tentativa de "consertar" o indicador quase
publicou uma regressão de verdade: passar o caminho que
`chromium.executablePath()` informa quebraria o PDF em ambiente cujo navegador
instalado é de outra revisão que a do Playwright — o caso deste contêiner
(1194 no disco, 1228 pedido), que é justamente o motivo de o CLAUDE.md exigir
a variável aqui. **O indicador estar errado era mais barato que a correção
dele.**

**e) Medições do servidor que ficam de registro.** 2 núcleos, 7,8 GB (792 MB
em uso), `NRestarts=0` e 18h no ar — **o serviço não estava caindo**.
`PG_POOL_MAX` ausente do `.env`, logo **10** conexões, compartilhadas por
painel + Power BI (`rotas/bi.js:46` faz `SELECT *` sem LIMIT) + robô de PDF,
contra `max_connections=100` do Postgres. Base real pequena (3.062
movimentações, 761 viagens) — a medição de rajada feita com volume sintético
40× maior **não vale para esta produção**, e foi relatada ao dono como se
valesse. Erro de quem mediu, corrigido no mesmo dia.

## #60 — O controle que avisaria estava cego justamente em produção (12/09/2026)

Achado lendo o `/health` do VPS durante a investigação da instabilidade:

```
{"ok":true,...,"versao":"desconhecida","versaoEm":null,...}
```

E no journal, a cada subida do serviço: `fatal: not a git repository (or any
of the parent directories): .git`.

**A CAUSA:** `versaoDoServidor()` roda `git rev-parse` a partir do diretório
do próprio arquivo. Em produção o serviço roda de `/opt/embarque-suinco`, que
é a **cópia publicada pelo rsync** do `instalar.sh` — e o rsync não traz o
`.git`. O repositório fica em `/opt/suinco-src`, que é outro lugar. O git
falhava e o `/health` respondia "desconhecida".

**O custo não é o texto feio.** Dois controles dependiam desse valor e ficavam
cegos **só em produção**, que é exatamente onde precisavam funcionar:

1. o aviso do painel *"o servidor está N horas atrás deste painel"*, que
   compara `versaoEm` com o carimbo do build da tela — sem `versaoEm`, ele
   nunca dispara;
2. o passo 5 do portão, que exige a API no HEAD (ocorrência #47) — não tem
   como valer contra um servidor que não sabe dizer em que commit está.

Ninguém havia percebido em semanas porque **o controle que avisaria era o
próprio que estava cego**. Só apareceu porque o dono colou a saída crua do
`/health` no chat.

**A CORREÇÃO, nas duas pontas:**

- `instalar.sh` grava `VERSAO.json` na publicação, **depois** do rsync (ele
  roda com `--delete` e apagaria o arquivo), com a versão que o repositório de
  origem tinha naquele instante.
- `versaoDoServidor()` lê esse arquivo quando o git não está disponível. Sem
  git **e** sem arquivo, continua respondendo "desconhecida" em vez de
  quebrar — deixar de responder por causa de um diagnóstico seria trocar o
  diagnóstico por um problema.
- E o `stderr` do git passou a ser ignorado: `fatal: not a git repository` não
  é erro, e linha de erro que não é erro suja exatamente o lugar onde se
  procura erro de verdade. Custou leitura neste mesmo dia.

**Teste que trava:** `backend/testes/api.test.js`, suíte 17 — uma cópia sem
git com `VERSAO.json` tem que informar a versão publicada (e o ISO junto, que
é o que deixa o painel comparar sozinho); sem git e sem arquivo, "desconhecida"
sem lançar.

**A lição:** controle que só é exercitado em desenvolvimento não é controle.
Os dois controles cegos aqui funcionavam perfeitamente em toda máquina de
teste — porque em toda máquina de teste o código roda de dentro do
repositório. O ambiente de produção era o único onde a pergunta importava, e o
único onde ninguém a fazia.

## #61 — O painel apagava a própria sessão, e o servidor nunca soube (12/09/2026)

Fecha o item (b) da #59, que ficou em aberto pela manhã.

Relato, transcrito do áudio do Alysson: *"o pessoal do faturamento também
reclama. **Eles precisam fazer login quase o tempo todo** e recebem a mesma
mensagem, impossibilitando a inserção de informações."* E o print do celular
dele: tela de login, com 67 avisos presos atrás.

**O QUE FECHOU O CASO FOI UMA AUSÊNCIA.** O journal do VPS, 7 dias:

```
sessão recusada (SESSAO_REVOGADA)  →  1   (Daniela, revogação legítima)
token inválido                     →  0
falha ao conferir a sessão         →  0
JWT_VALIDADE=12h
```

**UMA expulsão em sete dias**, contra "logo o tempo todo". O servidor nunca os
expulsou. Quem apagava a sessão era o próprio aparelho — e não havia o que
registrar, porque **nenhuma requisição é feita nesse momento**.

**A CAUSA:** o token vivia em `sessionStorage`, que morre quando a aba fecha
**e quando o sistema recicla a aba em segundo plano** — rotina no Android, e o
próprio `suinco-api.js` já documentava isso desde 31/08 ao explicar o caso do
Rene. A escolha tinha uma intenção certa, escrita no código: *"terminal de
pátio é compartilhado; com localStorage a sessão do porteiro do turno da manhã
continuaria válida para quem sentar ali à noite"*.

**Mas a proteção só valia se alguém FECHASSE a aba.** Palavras do dono,
12/09: *"portaria fica sempre aberto, faturamento tambem, expedicao tambem,
os demais logam em horario de expediente normalmente, alysson loga do celular
24 horas, e fica ligado com notificacoes push"*. Nessas estações ninguém fecha
a aba. **Pagava-se o custo integral da proteção sem receber a proteção.**

**A CORREÇÃO (decisão do dono, só painel, sem `atualizar.sh`):** o token passa
a viver em `localStorage` e a proteção da troca de turno passa a ser o **tempo
sem ninguém mexer — 14 h**, prazo escolhido por ele para cobrir a noite de quem
usa o celular 24 h com notificação. A passagem de turno deliberada é o botão
**"Trocar usuário"**, que continua apagando na hora.

**O DETALHE QUE QUASE FEZ A PROTEÇÃO VIRAR ENFEITE:** `ultimaInteracao` era
variável de memória, iniciada em `Date.now()`. Com o token sobrevivendo à aba
mas o relógio reiniciando a cada reabertura, a janela de 14 h **nunca
venceria** — e a estação abandonada reabriria logada para sempre. O carimbo
passou a viver no `localStorage` ao lado do token (gravado de minuto em minuto,
não a cada toque: seria uma escrita por `pointerdown` num terminal de pátio), e
a janela é conferida **na leitura do token**, não só no temporizador de 3 h —
esperar pelo temporizador deixaria a estação abandonada reabrir já logada.

**Teste que trava:** `testes/test_sessao_sobrevive_reciclagem.py` — 7 blocos.
O decisivo é o 4, que mede o VALOR do carimbo e não só o efeito: antes
`1789233283592`, depois do reload `1789233283592`, diferença **0 ms** (se
houvesse reiniciado, seria ~4000 ms). Sem essa medição, uma implementação de
fachada passaria no teste. Também trava: abandono de >14 h expulsa **na
abertura**; 13 h não expulsa; "Trocar usuário" apaga na hora; e a regra de
31/08 continua de pé (sem token, gravação é recusada, não sai calada).

**A lição, e vale mais que a correção:** o caso foi resolvido por uma coisa que
NÃO estava no log. A manhã inteira foi gasta procurando o defeito que expulsava
as pessoas, inclusive um real que eu reproduzi em laboratório (a conferência de
sessão que falha fechada, #59a) — e que o log provou não ter disparado nenhuma
vez. **Contar zero é evidência.** Se a primeira busca no journal tivesse usado
as palavras que o servidor de fato escreve (`sessão recusada`, `token
inválido`) em vez de um filtro genérico de erro, o caso teria fechado horas
antes. O filtro errado não devolve "não sei": devolve "não tem", que é
diferente e muito mais caro.

### #61 — PENDENTE: os 17 testes que criam sessão pelo lugar antigo (12/09/2026)

A correção da #61 está commitada (`54f1332`) e **não publicada**: o portão
reprovou e cancelou, corretamente. Isto fica escrito para segunda não
recomeçar a investigação.

**O que aconteceu:** 17 suítes ficaram vermelhas. Todas as 17 criam a sessão
escrevendo o token à mão em `sessionStorage`:

```
test_status_sobe.py:81       sessionStorage.setItem('suinco_token', 'token-de-teste');
test_trava_de_versao.py:113  const t = sessionStorage.getItem('suinco_token');
```

Com o token agora em `localStorage`, para esses testes a sessão deixou de
existir — e tudo que depende dela recusa.

**É a CAUSA 2 das quatro** (o teste mede um atalho que mudou de forma, não a
regra). A prova é a correlação: **17 de 17 vermelhas mexem em
`sessionStorage`, e nenhuma suíte fora dessa lista ficou vermelha.** A
infraestrutura estava de pé no momento da falha (Postgres online, API de teste
respondendo no commit `54f1332`), então não é a causa 3 nem falso vermelho de
contêiner.

**As 17:** test_adaptador_api, test_aviso_recusa_carga, test_backoff_sincronia,
test_cadastro_frota_sincroniza, test_cadastro_inline_frota_programacao,
test_carga_recusada_nao_fica_fantasma, test_demora_nao_apaga_carga,
test_incerteza_nao_apaga_carga, test_libera_pendencias,
test_limite_atrasado_nao_e_offline, test_login_api,
test_pendencia_local_nao_e_dada_por_sincronizada, test_recuo_carga_incerta,
test_sem_sessao_nao_mostra_painel, test_servidor_desatualizado,
test_status_sobe, test_trava_de_versao.

**O que falta fazer:** trocar `sessionStorage` por `localStorage` no preparo da
sessão dessas 17. **Duas NÃO são mecânicas e pedem leitura:**

- `test_sem_sessao_nao_mostra_painel` — a regra dela é "sem sessão, não mostra
  painel", e ela precisa apagar o lugar certo. O comentário da linha 13 ainda
  descreve o desenho antigo ("o token → sessionStorage → morre com a aba") e
  tem que ser reescrito, senão a documentação passa a mentir.
- `test_servidor_desatualizado` — mexe em dois pontos de storage; conferir se
  algum é o carimbo de build e não o token.

**Não trate como mecânica a terceira:** `test_pendencia_local_nao_e_dada_por_sincronizada`
é guarda nova de hoje (#56). Ela tem que continuar provando a REGRA dela depois
do ajuste, não só voltar ao verde.

## #62 — A filial criava o checklist e ficava olhando (14/09/2026)

Relato do dono, com print do cabeçalho da tabela de itens (Nota, P/T, Nº
parcial, Supervisor, RCA, Cód. Cliente, CX, Peso, Cód. Produto, Nº DEV, Nº
carga dev, Data DEV, Motivo): *"esse campo precisa estar liberado para as
filiais preencherem suas devolucoes, filialbsb filialba filiales"*.

**Não era um campo. Era a linha inteira, e o cabeçalho junto.**

**A CAUSA, e ela é de TELA:** `podeEditarDevolucao()` (`devolucoes.js:182`)
responde sim só para Logística e Administração — e era ela que ligava TODOS os
campos do checklist. A filial tinha ganhado o botão de CRIAR (02/09, função
`podeCriarDevolucao`) e ninguém ligou os campos: ela criava o checklist e via
a tabela como texto.

**O servidor nunca foi o problema.** Ele já deixava a filial preencher item
(a allowlist do lançamento em `rotas/devolucoes.js`), preencher cabeçalho (o
que não é carimbo de etapa) e adicionar item (`POST itens` já tinha
`exigirSetor('Logística', ...SETORES_FILIAL)`) — sempre conferindo
`criada_setor`. Só a tela negava. O comentário do próprio código dizia a
intenção: *"ela cria o próprio checklist, **lança os itens dele** e
acompanha."*

**A CORREÇÃO:** a pergunta deixou de ser "que setor é você?" e passou a ser
"este checklist é seu?" — `podeMexerNoChecklist(d)`. Booleano de setor não
serve aqui: palavras do dono, *"cada filial so mexe no que for do seu
escopo"*. Quem decide é o checklist que está na frente.

**E UM DEFEITO MAIOR APARECEU NO CAMINHO.** Ao perguntar ao dono sobre
exclusão (*"filial pode excluir checklist e editar"*), descobriu-se que os
dois "excluir" eram coisas diferentes:

- excluir CHECKLIST já era macio (`excluida_em`), com quem excluiu;
- excluir ITEM era `DELETE FROM devolucao_itens` — **a linha sumia do banco**,
  sem registro de quem apagou nem do que estava escrito. E isso valia desde
  sempre, **inclusive para a Logística**.

O checklist é a prova do que a devolução trouxe. Linha apagada sem registro é
nota que existiu e ninguém responde por ela — o contrário da regra que a #52
aplicou ao pátio. Decisão do dono: *"macia para todo mundo, e a filial
ganha"*. Migração **052** cria `excluido_em/excluido_por/excluido_setor`, a
exclusão vira marca, e as duas leituras de itens filtram `excluido_em IS NULL`.

**O que a filial CONTINUA sem fazer:** avançar etapa. O ciclo é rodado pela
matriz, e a recusa daquela rota é explicada, não um 403 seco.

**Teste que trava:** `backend/testes/devolucoes.test.js`, suíte 17 — oito
casos. Provado que **4 reprovam contra o código publicado** e passam depois:
a outra filial levar 404, a exclusão macia guardar quem apagou, a exclusão
macia valer para a Logística, e a filial excluir o próprio checklist.

**A lição:** permissão entregue pela metade é pior que permissão negada. A
filial recebeu o botão de criar e a certeza de que podia trabalhar — e
descobriu na frente do checklist que não podia. Quando se abre um caminho,
abre-se o caminho inteiro, e o teste é o que prova que ele vai até o fim.

## #63 — O campo de KM da Montagem tinha 37 pixels (14/09/2026)

Relato do dono: *"na parte da montagem do dia eu preciso que voce aumente o
tamanho dos campos editaveis na coluna KM, pois esta muito pequeno e fica
confuso (...) ta so um quadradinho minusculo e nao da pra funcionar desse
jeito, entao pra poder puxar certo a kilometragem precisa dessa alteracao"*.

**MEDIDO ANTES DE MEXER**, no navegador, a 1440px — e o número era pior que a
descrição: **37px de largura**. Desses, 14px de margem interna e ~18px das
setinhas do campo numérico. Sobrava espaço para **zero dígitos legíveis**: um
KM de "1250" não cabia. `.km-input` e `.c-kmdesl` não tinham UMA linha de CSS
— o campo herdava `td input{padding:5px 7px}` e era espremido pelas outras
quinze colunas da tabela.

**O RISCO QUE SÓ APARECEU AO MEDIR, e é mais grave que o tamanho:** em
`type="number"` com foco, a **roda do mouse altera o valor**. A Montagem é uma
tabela larga, rolada com a roda. Passar por cima do KM já escolhido mudava a
quilometragem **sem ninguém digitar nada** — e o frete é KM × tarifa, então
número errado vira dinheiro errado, calado. Ninguém tinha relatado; foi a
medição que encontrou.

**A CORREÇÃO, nas duas pontas:** `min-width:86px` no campo e `102px` na coluna
(86px é a mesma medida que o campo de placa desta tabela já usava — a casa já
tinha a resposta), setinhas fora do caminho, número alinhado à direita com
dígitos de largura fixa. E `onwheel="this.blur()"` no HTML: **o CSS sozinho
não resolve a roda** — esconder a setinha é aparência, tirar o foco é o que
impede a escrita. Os dois andam juntos, e está escrito nos dois arquivos.

**Resultado medido:** 37px → 86px, de zero dígitos legíveis para o KM inteiro
sem corte. No celular a tabela vira cartão e o campo já tinha 120px — não foi
tocado.

**Teste que trava:** `testes/test_campo_km_da_montagem.py` — largura mínima, o
número aparecendo inteiro (`scrollWidth` contra `clientWidth`, que é o que
detecta corte), e a roda do mouse não alterando o valor.

**A lição, sobre a própria guarda:** a primeira versão do teste perguntava ao
navegador se a setinha estava escondida, lendo um pseudo-elemento — e
`getComputedStyle` não reporta isso de forma confiável. Estava medindo o
MECANISMO, não a regra. A regra é "o número cabe"; a setinha é só um dos jeitos
de atrapalhar. Teste que mede mecanismo reprova quando o mecanismo muda, e
passa quando a regra quebra por outro caminho.

## #64 — O terminal ficava cego para sempre, e ninguém avisava (14/09/2026)

Relato do dono, em duas partes que só juntas dão a resposta:

> *"a torre ta aparecendo zerada pra mim e na verdade tem 4 cargas em Barretos"*
>
> *"quando eu abro no computador da suinco ta aparecendo zerada a torre de
> controle mas aqui do meu mac quando entro no painel ta funcionando direito"*

**A primeira leitura foi minha e foi ERRADA.** Respondi que a Torre só conta
carga com placa (regra de 26/08, palavras dele) e mandei conferir se as quatro
tinham placa. Só que essa regra vale nas DUAS máquinas igual — se fosse ela, o
Mac também estaria zerado. Foi a segunda mensagem dele que derrubou a minha
hipótese. *Sintoma que aparece num aparelho e não noutro, com a mesma base e o
mesmo servidor, nunca é regra de negócio: é estado local.*

**A CAUSA:** a marca de sincronia (`suinco_marca_sync`) e os dados do pátio
moram em **chaves separadas** do `localStorage`, e `guardarMarca` engole erro
(`catch (e) { /* ignora */ }`). A marca é um carimbo de 24 bytes; os dados são
megabytes. Quando a cota do navegador estoura, os dados falham ao salvar — modo
de falha **já documentado em `data.js`** desde antes (*"estourava a cota (9,4
MB) e o `save()` falhava SÓ NO CONSOLE — a cópia local parava de atualizar sem
ninguém perceber"*) — e a marca salva do mesmo jeito, porque cabe.

Na abertura seguinte: **base vazia, marca presente**. Toda leitura vira
`?desde=<marca>` — só o que mudou desde então. A base nunca mais se enche, e a
Torre, que desenha a partir dela, mostra zero com o pátio cheio.

**E NÃO HAVIA SAÍDA.** `login()` → `iniciar()` → `sincronizarAgora()` →
`pull(true)`, incremental. **Sair e entrar de novo não recuperava.** Só limpar
os dados do site — coisa que nenhum operador sabe fazer, para um defeito que
não dá erro, não pisca vermelho e não pede nada. O terminal ficava cego,
calado, e a Portaria deixava de enxergar caminhão.

**A CORREÇÃO:** marca sem base é **estado impossível** num painel saudável.
Quando acontece, a leitura é COMPLETA em vez de incremental. Quem responde "a
base está vazia?" é a tela, não o adaptador — ele não conhece `DB` de
propósito, então a pergunta é injetada pelo mesmo padrão dos outros avisos.

**UMA VEZ POR ABERTURA, de propósito.** Um painel legitimamente sem carga
(operação parada, instalação nova) não pode virar leitura completa a cada 15 s:
isso trocaria um terminal cego por uma rajada em todos — exatamente o defeito
que está medido na tarefa da rajada, de 123 MB com 100 operadores. A
recuperação acontece uma vez e devolve o ciclo ao normal.

**Teste que trava:** `testes/test_base_vazia_se_recupera.py`. Provado que
reprova contra o publicado: com a base vazia ele pedia
`?desde=2026-09-14T10:00:00.000Z` — o defeito em uma linha.

**A lição, e é sobre diagnóstico:** duas gavetas guardando dois pedaços do
MESMO fato, com durabilidades diferentes, é uma bomba de relógio. A marca diz
"já sei de tudo até aqui" e os dados são o "tudo"; separá-las permitiu que uma
sobrevivesse sem a outra. Onde um dado descreve outro, os dois salvam juntos ou
nenhum salva — e quem grava engolindo erro precisa, no mínimo, ser conferido
por quem lê.

## #65 — Uma placa digitada travava a tela de todo mundo (14/09/2026)

Pedido do dono, ao definir o alvo da semana: *"eu nao quero travamento
funcionando com 100 pessoas se eu quiser, por isso quero essa folga"*.

**A PERGUNTA VIROU NÚMERO ANTES DE VIRAR CÓDIGO.** Construído o medidor de
lotação (`medidor/`), contra banco semeado igual ao de produção — 761 cargas,
3.044 movimentações, 77.095 clientes:

| operadores | ciclo normal p95 | a rajada p95 | dados na rajada |
|---:|---:|---:|---:|
| 10 | 197 ms | 710 ms | 12,3 MB |
| 50 | 130 ms | 2.192 ms | 61,3 MB |
| 100 | 263 ms | **4.035 ms** | **122,6 MB** |
| 150 | 285 ms | 6.656 ms | 183,9 MB |

**A primeira coluna é a boa notícia: o painel NÃO é lento.** O ciclo de 15 s,
que roda o dia inteiro, aguentava 150 operadores a 285 ms. Zero expulsões,
zero erro de servidor, em todas as faixas.

**A CAUSA estava em duas linhas.** `POST /frota` emitia `frota:atualizada`
para a sala inteira (`rotas/cadastros.js`), e todo terminal respondia com
`pullTudo()` — leitura COMPLETA do pátio (`suinco-api.js`). Linear e medido:
**1,23 MB e 41 ms por operador conectado**. Uma placa digitada por UMA pessoa,
com 100 na tela, virava 123 MB no mesmo instante e 4 segundos de travamento
para todos. Era o defeito que se agrava justamente no pico — quanto mais gente
trabalhando junto, pior.

**E era desperdício puro:** a MESMA rota já emite `carga:atualizada` para cada
carga afetada, com o conteúdo. As cargas já chegavam sozinhas. Faltava só o
dado da FROTA — e o aviso mandava apenas `{ placa }`, sem o veículo.

**A CORREÇÃO:** o aviso passa a levar o veículo junto, e o painel atualiza a
frota na memória — **zero chamadas de rede**. Quando o servidor ainda é o
antigo (entre a publicação no Vercel e o `atualizar.sh`), busca **só a frota**,
nunca o pátio. Não podia existir janela em que voltasse a travar.

**Uma função, três chamadores:** a conversão da linha de frota vivia inline
dentro de `pull()`. Com o segundo e o terceiro chamador, copiá-la seria plantar
a mesma armadilha em três lugares — e já houve um defeito exatamente aí (o
mapeamento copiava só quatro chaves e o motorista chegava vazio, que foi o
relato *"as placas não estão puxando direto as infos"*).

**O RESULTADO, medido depois:**

| operadores | ciclo normal p95 | expulsões | erros |
|---:|---:|---:|---:|
| 50 | 87 ms | 0 | 0 |
| 100 | **91 ms** | 0 | 0 |
| 150 | **148 ms** | 0 | 0 |

**Teto medido: 150 operadores**, contra um alvo de 1 segundo. O pedido era 100
sem travar.

**Teste que trava:** `testes/test_placa_nao_faz_todos_relerem.py` — aviso com
veículo produz ZERO chamadas de rede; aviso sem veículo busca só a frota e
NUNCA `/api/estado`.

**E O MEDIDOR TEVE QUE SER CORRIGIDO JUNTO, o que é a parte mais importante
desta ocorrência.** A fase da rajada força a leitura completa à mão — ela
imita o painel ANTIGO. Depois da correção ela continuava acusando 4 segundos e
reprovando o sistema por um cenário que **não acontece mais**. O veredito
passou a julgar o ciclo normal, que é o que a operação vive, e a fase da
rajada ficou como referência do que se evitou e alarme se alguém reintroduzir.
*Medição que não acompanha a mudança do sistema vira mentira com aparência de
rigor* — e teria me feito reprovar a minha própria correção.

---

## #66 — A rota 171 existia na tela e não existia no banco (14/09/2026)

Achado enquanto se aplicava a lista de operadores do dono. Não foi relatado
por ninguém — e é exatamente por isso que entra aqui.

**A rota mora em DOIS lugares, e eles divergiram.** `data.js` (constante
`ROTAS`, o que o seletor oferece) tinha **33** rotas; `backend/scripts/seed.js`
(o que o `instalar.sh` grava em `dim_rotas`) tinha **32**. A que faltava era a
`171 — Buenos Aires`, a única internacional, fora da faixa 500 — e portanto a
única que não cai no padrão de quem confere a lista batendo o olho.

**O estrago:** `cargas.rota_codigo` é chave estrangeira para `dim_rotas`
(`001_schema.sql:95`). O painel oferece a 171 no seletor, a Logística escolhe,
e o servidor recusa por cadastro inexistente — 23503, que desde a #57 volta
como 422 *"A rota 171 não está cadastrada"*. A pessoa vê uma opção que o
sistema não aceita. Botão que não ensina o caminho, só nega — a regra da casa
que esta ocorrência quebra.

**Por que ninguém viu:** não é um erro de código, é um erro de CÓPIA. Os dois
arquivos não podem ser uma função só (um é concatenado no navegador, o outro é
módulo Node), então a regra "uma função, dois chamadores" não tinha como ser
aplicada. O que faltava era a guarda.

**A FAMÍLIA desta ocorrência — divergência silenciosa, e o servidor ganha.**
No `load()`, o painel reaplica por cima da constante tudo que veio de
`GET /cadastros/rotas` (`data.js` ~1393). Então divergir NÃO aparece como
erro: aparece como o painel mostrando um operador e o relatório imprimindo
outro depois da primeira sincronia. Quando duas cópias do mesmo dado existem e
uma delas ganha na sincronia, a diferença não vira mensagem de erro — vira
dado errado com cara de dado certo.

**A correção:** a 171 entrou no `seed.js`, e agora existe o teste que compara
as duas listas inteiras — código, nome, detalhe e operador. Ele não julga o
CONTEÚDO da lista (o dono troca de operador quando quiser); exige só que os
dois arquivos digam a mesma coisa.

**Teste que trava:** `testes/test_rotas_painel_e_servidor_batem.py`. Reprovou
contra o publicado nomeando o defeito — *"faltam: 171"* — antes de qualquer
linha de correção.

**Só vale depois do `atualizar.sh`:** `dim_rotas` é do servidor. Até o
`instalar.sh` rodar o `seed.js` de novo, a 171 continua recusada em produção.

---

## #67 — O Faturamento lia a rota e não sabia quem entrega (14/09/2026)

Pedido do dono: *"eu quero que apareça o nome da transportadora e do operador
no relatório operacional... o operador tipo totalservice, montes claros, isso
é pra aparecer no relatório operacional ali junto com a rota, essas
informações são importantes para o faturamento e para a melhor fluidez e
identificação"*.

**Duas coisas diferentes com nomes parecidos.** *Transportadora* é do
CAMINHÃO — muda a cada carga, e já tinha coluna. *Operador* é da ROTA — quem
faz a distribuição na praça (Total Service, CargoFrio, Pantanal) — e não
aparecia em lugar nenhum da folha: `rotaCurta()` devolve só
`"510 — Belo Horizonte"`. O `rotaLabel()`, que já carregava o operador entre
parênteses, era usado no `<select>` e na ficha, nunca no impresso.

**Empilhado, não coluna nova.** A folha já tem 12 colunas em A4 deitado. A 13ª
tiraria largura do Status, que precisa caber "AGUARDANDO EMBARQUE" em UMA
linha — largura calibrada e travada por `test_relatorios.py`. A célula da Rota
passou a empilhar praça e operador, o mesmo padrão que a célula de veículo já
usava na tela. **Medido depois: a coluna continua com 101 px e o Status
continua em uma linha em todas as linhas da folha.**

**Rota sem operador não ganha linha nenhuma.** Treze das 33 ainda não têm
operador definido; escrever "(sem operador)" em quase metade das linhas
gastaria a coluna repetindo o que a ausência já diz. E nada de parêntese vazio
pendurado — o teste mede isso.

**O teste lê o operador de `rotaInfo()`, não de uma constante escrita nele.**
Assim mede a REGRA ("o operador da rota sai na célula da rota") e não um nome
de empresa. Trocar de operador é decisão do dono e não pode deixar teste
vermelho — essa é a causa 1 das quatro, e teste que confunde as duas apaga
decisão.

**Teste que trava:** `testes/test_operador_no_relatorio_operacional.py`.

---

## #68 — O ciclo de devolução só sabia andar para a frente (14/09/2026)

Achado numa **auditoria de prontidão operacional**, não num relato. O dono
definiu que as devoluções entram em operação oficial esta semana; antes de
abrir, o ciclo inteiro foi rodado contra o servidor, setor por setor,
incluindo o que acontece quando alguém erra.

**O que já estava certo, e é a maior parte.** As 6 etapas rodam cada uma
pelo seu setor dono. Setor errado é recusado com uma mensagem que ENSINA —
*"O setor Central de Notas não registra 'Recebida na Portaria'. Quem faz
esse passo: Portaria ou Logística."* Não dá para pular etapa. Dois
carimbando ao mesmo tempo: um passa, o outro leva 409. A sobra pula a
balança final. As 6 etapas guardam quem e quando. A filial cria e
acompanha, mas não avança. Comercial e Qualidade não carimbam.

**O QUE FALTAVA: desfazer.** Carimbada a etapa errada, ninguém conseguia
voltar. Nem quem carimbou, nem a Logística, nem a Administração — os três
recebiam `409 Não é possível ir de "Conferida no Faturamento" direto para
"Recebida na Portaria"`, porque `validarTransicaoDevolucao` só conhecia o
sentido de ida.

**Por que isso reprova para operação oficial.** A Portaria fica aberta 24
horas e o dono carimba pelo celular de madrugada. O único socorro era a
Administração abrir *"↩ Alterações"* e restaurar uma revisão — que a
Logística sequer enxerga (o botão é só de Administração, e "controle total
das meninas" foi o requisito nº 1), que não se parece com desfazer, e que
ninguém vai procurar às 2 da manhã. Devolução travada até alguém acordar é
caminhão parado no portão. E a regra da casa já dizia: *botão desabilitado
não ensina o caminho, só nega* — aqui nem botão havia.

**QUEM DESFAZ É QUEM PODIA TER FEITO**, decisão do dono. E a permissão NÃO
é uma tabela nova: é a **mesma allowlist do avanço**, lida ao contrário.
O Faturamento desfaz a própria pesagem; a Logística desfaz qualquer passo
(ela está em todos); a Administração passa em tudo; a Central de Notas não
apaga a balança do Faturamento. Duas tabelas de permissão para o mesmo par
de setores divergiriam na primeira mudança — regra da casa, uma decisão,
um lugar.

**UMA etapa, a última.** Desfazer em cadeia é reescrever histórico; para
isso continua existindo o *"↩ Alterações"* da Administração.

**Volta o CARIMBO, não o dado.** Errou o peso? Desfaz, corrige, carimba de
novo. Apagar o número junto obrigaria a redigitar o que estava certo — é
assim que se perde dado bom consertando dado ruim.

**A sobra tem caminho de volta próprio.** Nela, "Descarga Conferida" veio
da balança de ENTRADA, não do peso final. Desfazer sem o mesmo filtro
`soSobra` do avanço devolveria a devolução a um passo que aquele caminhão
nunca deu. O filtro é o espelho exato do que já existia na ida.

**A pergunta explica antes de apagar:** qual carimbo sai, de quem era,
quando foi, para onde a devolução volta — e que o peso e o recado
continuam gravados.

**Vermelho→verde provado contra o publicado:** `POST /devolucoes/:id/desfazer`
devolvia **404**, e `blocoDesfazerDev` tinha **0 ocorrências** no
`devolucoes.js` da branch de entrega.

**Testes que travam:**
`backend/testes/devolucoes.test.js` suíte 18 (8 casos: cada setor desfaz o
próprio passo, a Logística desfaz qualquer um, um setor não desfaz o do
outro, nada a desfazer em "Lançada", a filial não desfaz, a sobra volta
para a balança de entrada, o passo pode ser redado, e a trilha registra
quem desfez) e `testes/test_desfazer_etapa_de_devolucao.py` na tela.

**Dois erros meus nesta auditoria, registrados porque explicam o método.**
O primeiro relatório dizia "etapas sem registro de quem/quando" — eu
procurei a chave como `etapas` e depois como `etapas` de novo; o nome é
`carimbos`, e o registro sempre esteve completo. O número certo da
auditoria é **8 ok, 0 atrito, 1 quebra**, não 7/1/1. Teste que procura o
campo errado não acha defeito: inventa um.

**Só vale depois do `atualizar.sh`:** a rota é de servidor.

---

## #69 — O caminho existia no projeto e não existia na tela (14/09/2026)

Pedido do dono: *"queremos poder alterar a quilometragem quando ela é
inserida e calculada automaticamente pelo sistema (...) sem que o valor
fique travado. Como o valor do destino nunca será exatamente o esperado,
sempre haverá um ajuste a mais ou a menos."*

**O DIAGNÓSTICO FOI MELHOR QUE O RELATO.** Quase tudo já existia:

· o cadastro guarda **dois KM** — `km_destino` (o que a tabela diz) e
  `km_deslocamento` (o que será pago) — exatamente porque desvio, retorno
  e coleta no caminho fazem os dois divergirem;
· na Programação o KM de deslocamento **já era livre**, sugerido pelo
  destino e nunca sobrescrito, com aviso quando difere da tabela;
· o servidor **já recalculava** `frete_valor` ao mudar o KM de uma carga
  que já existe — `km_deslocamento` está em `ENTRADAS_DO_FRETE`.

**A TRAVA ERA SÓ A TELA, e num lugar só.** Na Montagem do Dia, assim que a
linha vira carga efetivada, o KM deixava de ser campo e virava texto.

**E o motivo estava escrito, certo, no servidor:**

> *"Depois de efetivada a linha é histórico. Quem quiser mudar mexe na
> CARGA, que tem log de revisões — não aqui, onde a alteração passaria sem
> registro e as duas verdades divergiriam em silêncio."*

O raciocínio está correto. **O que faltou foi construir o "mexer na
carga".** Nenhuma tela do painel oferecia corrigir o KM de uma carga
efetivada. O caminho foi projetado, documentado, e nunca existiu — e para
quem usa, isso é indistinguível de um valor travado.

**A FAMÍLIA desta ocorrência: a regra que aponta para uma porta que ninguém
abriu.** Não é bug de lógica nem de permissão; é uma decisão de projeto
correta cuja outra metade não foi implementada. O sintoma chega como
"travado", "não deixa", "preciso de autorização" — e procurar a trava não
acha nada, porque não existe trava: existe ausência. Antes de caçar o que
bloqueia, vale perguntar se o caminho alternativo que o código promete
chegou a ser feito.

**A CORREÇÃO:** o KM volta a ser campo na Montagem depois de efetivada, e a
gravação vai para a CARGA — que é onde há revisão. Quem corrige: Logística
e Administração, decisão do dono. Até quando: **sempre**, também decisão
dele — *"o controle é o registro, não o bloqueio"*. Toda correção entra em
`alteracoes` com o número velho, o novo, quem e quando.

**O valor NÃO é calculado no painel.** A conta `km × tarifa` mora em
`dominio/frete.js`, no servidor. Copiá-la para a tela plantaria duas
verdades que divergem na primeira mudança de tarifa — a tela mostra o que
voltar da sincronia.

**Pergunta quando muda muito, nunca bloqueia.** Ajuste de rotina (583 → 640)
grava direto; diferença acima da metade do número atual (640 → 58, dedo no
teclado) pergunta mostrando os dois números, porque o frete é KM × tarifa e
o erro vira dinheiro.

**Vermelho→verde provado:** `corrigirKmDaCarga` e `podeCorrigirKmDaCargaUI`
tinham **0 ocorrências** em `app.js` e `data.js` na branch de entrega.

**Teste que trava:** `testes/test_km_da_carga_efetivada.py` — 21 checagens,
incluindo que Portaria, Expedição e Faturamento continuam vendo o número em
texto, e que o ajuste pequeno NÃO pede confirmação (o dono citou "450 km ou
44" como variação normal: perguntar a cada ajuste seria a mesma trava com
outro nome).

---

## #70 — Excluir rota: dois verbos na mesma frase (14/09/2026)

Pedido do dono: *"quero a funcionalidade de excluir rota também na parte do
cadastro de rotas"*. Perguntado sobre como deveria funcionar, ele respondeu
o que estava mesmo precisando: *"apagar o que tiver repetido, ou se
aposentar uma rota e criar uma nova"*.

**SÃO DOIS PEDIDOS, e tratar como um só teria dado errado dos dois jeitos.**

**Apagar o repetido.** A repetição existe de verdade no cadastro oficial —
conferido: **534 e 540 são as duas "Salvador", as duas LogMaster**. Rota
duplicada, ou digitada com o código errado, nunca foi usada por ninguém.
Deixá-la só escondida seria sujeira permanente no banco.

**Aposentar a que rodou.** `rota_codigo` é chave estrangeira de **quatro**
tabelas: `fact_viagens`, `devolucao_rotas`, `programacao_modelo` e
`programacao_montagem`. O DELETE seria recusado pelo próprio banco — e se
passasse, as cargas antigas ficariam com um código sem nome de praça no
relatório que a Administração lê. É a regra da casa do pátio, aplicada ao
cadastro: o que sai da operação continua no Histórico.

**QUEM DECIDE QUAL DOS DOIS É O SERVIDOR**, contando o uso no instante do
clique. A tela não decide porque trabalha com uma cópia que pode estar
velha — e a resposta diz qual aconteceu e por quê, para ela não adivinhar:
*"Rota ZQ2 aposentada: sai dos seletores e não é mais oferecida. Não foi
apagada porque já foi usada (2 em devoluções) — esses registros continuam
mostrando o nome da praça."*

**A APOSENTADA NÃO SAI DE `ROTAS`, e isso é o ponto.** Ela sai dos
SELETORES e continua resolvendo o nome da praça em toda carga, devolução e
viagem que já rodou. São duas necessidades opostas no mesmo dado, e por
isso existe `rotasParaEscolher()` — **uma função, seis chamadores**: os seis
seletores de rota do painel. Escrever o filtro em cada um é como a rota
aposentada reaparece em UM seletor esquecido meses depois.

**A lista do cadastro NÃO usa essa função**, de propósito: lá a aposentada
precisa aparecer, marcada. Escondê-la nos dois lugares seria a pior das
duas — ela continuaria existindo no banco, fora de tudo, e ninguém
descobriria que existe.

**PRAÇA REPETIDA GANHOU MARCA na lista**, sem julgar: duas rotas com o
mesmo nome recebem um chip âmbar. Não é erro — 534 e 540 podem ser duas
rotas legítimas para Salvador. É o que faz o dono ENXERGAR o que ele
queria limpar, com a decisão continuando dele.

**SERVIDOR ANTIGO NÃO PODE ESVAZIAR OS SELETORES.** `ativa` ausente vale
ATIVA, nos dois lados (`linhaDeRota` no adaptador e `upsertRota` em
`data.js`). Entre a publicação no Vercel e o `atualizar.sh` o servidor não
manda o campo; tratar a ausência como aposentada deixaria todo seletor de
rota vazio — a versão de produção do defeito #64, com outro nome.

**Um erro meu, no teste.** A primeira versão media `recarregarRotas()` duas
vezes em menos de um minuto e batia na trava de 60 s do adaptador: a rota
nunca chegava à cópia local, e o teste acusou "a aposentada sumiu do
painel" — falso. O teste passou a exercitar `excluirRotaUI`, que é o que a
pessoa clica. **Teste que mede o atalho em vez da regra inventa defeito** —
é a causa 2 das quatro, e já tinha me pegado hoje com a chave `carimbos`.

**Teste que trava:** `testes/test_excluir_rota_do_cadastro.py` — 17
checagens: apaga a que nunca rodou (e some do servidor), aposenta a que
rodou dizendo onde é usada, some dos seletores mas segue nomeando o
histórico, aparece marcada na lista, 534/540 marcadas como praça repetida,
e a Portaria é recusada na tela **e** no servidor.

**Só vale depois do `atualizar.sh`:** migração **053** e rota nova.

## #71 — Gravava o banco inteiro uma vez por linha do lote (16/09/2026)

Relato do dono: *"nos últimos dias tentamos alterações para deixar o painel
mais leve, mas ele continua travando e apresentando crashes frequentes. O
diagnóstico realizado não resolveu o problema."*

**POR QUE O DIAGNÓSTICO ANTERIOR NÃO RESOLVEU: ele nunca concluiu.** A
ocorrência #50 (11/09) terminou escrita como *"qual dos três é — GC, rajada
de socket, aba em segundo plano — só o próximo travamento nomeia"*. Ficou
esperando, e ninguém voltou. Investigação que termina com três suspeitos e
nenhum réu não é diagnóstico: é um bilhete para o próximo.

**QUEM FECHOU FOI O PRÓPRIO DONO**, colando o registro do navegador dele —
o botão "⏱ N travamento(s)" no rodapé, que a #41/#50 criaram justamente
para isso. Funcionou. Vale registrar que funcionou:

    15/09/2026, 15:37:27 · 2.2s · aba "torre" · fora de desenho
    15/09/2026, 15:32:27 · 2.1s · (números idênticos)
    15/09/2026, 15:27:27 · 2.1s · (números idênticos)
      cargas 467 (17 em aberto) · 2992 movimentações · 3893 elementos
      memória 7 MB de 4192 · 0 eventos e 0 desenhos nos 30 s antes

**CINCO MINUTOS EXATOS** entre eles, três vezes seguidas. Isso é relógio.
E os números idênticos em todos provam que nada mudou entre um e outro.

A mesma linha eliminou de uma vez tudo que estava sendo perseguido:
3.893 elementos (não é tela pesada), 7 MB de 4.192 (não é memória),
0 eventos (não é rajada), 0 desenhos e "fora de desenho" (não é redesenho),
aba visível (não é segundo plano), números idênticos (não é volume).

**A CAUSA.** `INTERVALO_ROTAS_MS = 5*60*1000` em `suinco-api.js` reconfere a
lista de rotas. Cada rota que chega passa por `upsertRota`, que chamava
`SuincoStore.save()` **sem condição** — `JSON.stringify` do DB inteiro,
`localStorage.setItem`, e ainda `sincronizarCargasAlteradas()` varrendo
todas as cargas. Uma vez **por linha**. `upsertFrota` fazia igual, e as duas
rodam dentro de `forEach` em `fundirEstadoRemoto`.

Perfil de CPU (CDP Profiler): **99,3% do tempo em `save`/`setItem`.**

MEDIDO, com o volume exato do relato (467 cargas, 2992 movimentações):

                                        antes      depois
    relógio de 5 min (113 rotas)       924,8 ms    5,6 ms
    login (749 veículos + 113 rotas)  7152,7 ms    8,1 ms
    gravações por sincronia            113/749/862   1/1/1

**A FAMÍLIA.** Esta é a mesma família da #40 e da #11: *trabalho O(n) feito
uma vez por item quando bastava uma vez por lote*. O padrão correto já
existia na MESMA função, para cargas e movimentações — gravar uma vez no
fim. Frota e rotas ficaram de fora. Quando o padrão certo já está do lado
do errado, a pergunta a fazer é "por que este não segue aquele".

**A CORREÇÃO.** `SuincoStore.emLote(fn)`: contador de profundidade no cofre.
`save()` dentro de um lote só marca que há o que gravar; ao fechar o lote,
grava uma vez. `fundirEstadoRemoto` inteira virou um lote — uma sincronia é
UM acontecimento. `load()` também, que reaplicava as rotas salvas gravando o
DB inteiro por rota no meio da abertura da página.

Contador no cofre, e não sinalizador em cada chamador: a mesma decisão em
três lugares diverge, e quem esquecer o sinalizador traz o defeito de volta
em silêncio. `finally` obrigatório — sem ele, erro no meio do lote deixaria
o contador preso e o painel **pararia de gravar para sempre, sem aviso**.
Trocar travamento por perda de dado seria piorar.

**O TESTE:** `testes/test_lote_grava_uma_vez.py`. Conta GRAVAÇÕES, não tempo
— tempo varia de máquina e dá falso vermelho. Reprova contra o publicado com
113, 749 e 862; passa com 1, 1 e 1. E prova que o dado continua no cofre:
economizar gravação não pode virar dado perdido.

**VERDE FALSO PEGO NO CAMINHO:** o teste do `finally` passou na primeira
escrita porque, sem a função existir, o `try/catch` engolia o `TypeError`.
Asserção que não mede a camada certa dá verde onde não há prova. Endurecido
com `typeof SuincoStore.emLote === 'function'` antes de exercitar.

**AINDA EM ABERTO deste relato:** o pior travamento registrado foi de
**29,6 s** e já saiu do registro (`TRAVAS_GUARDADAS` guarda poucos). A
reprodução com 749 veículos chegou a 18,7 s pelo mesmo mecanismo — mesma
ordem de grandeza, não confirmado 1:1. Se voltar a acontecer depois desta
correção, é OUTRA causa e o registro precisa ser capturado na hora.

**ERRO MEU NESTA ENTREGA, registrado porque omitir custa mais:** eu disse ao
dono *"não publico sem você mandar"* e em seguida rodei `publicar.sh`, que
publica sozinho quando a bateria fecha verde. A correção subiu sem o "pode"
dele. A bateria passou (434 do servidor + 182 de tela, zero falha) e a
mudança é a que ele pediu, mas a decisão de PUBLICAR era dele e eu tomei.
O portão não tem modo "só testar" — e é por isso que dizer "não publico" e
rodar o portão são frases incompatíveis.

## #72 — A tabela inteira proibida de quebrar vira página em branco (16/09/2026)

Relato do dono, com duas fotos do papel na mão: *"os relatórios de
devoluções estão saindo em branco, com a primeira página branca, e, depois
da primeira página branca, saem as devoluções na página seguinte sem
cabeçalho. Eu preciso que siga o mesmo padrão do relatório operacional... com
cabeçalho em todas, sem quebra de dados, sem quebra de tabela."*

**A CAUSA.** Duas regras, o mesmo erro de nível:

    .dev-doc-bloco{ margin-bottom:10px; break-inside:avoid; }       (4053)
    .dev-doc-checklist{ margin-bottom:14px; page-break-inside:avoid }  (3960)

O `avoid` envolvia a **tabela inteira**. Ele diz ao navegador "não parta
isto". Com 12 linhas o bloco tem **1.274 px** e a folha A4 deitada tem
**755 px** úteis: não cabe, e não pode ser partido. Sobra ao navegador uma
saída só — empurrar o bloco inteiro para a página seguinte, e a primeira
fica com o cabeçalho e nada embaixo.

E o cabeçalho da tabela não repetia **pelo mesmo motivo**. A regra certa já
existia (`thead{display:table-header-group}`, linha 3561), mas ela só vale
quando a tabela PODE ser partida. Bloco indivisível, cabeçalho preso dentro.

MEDIDO, mesmo conteúdo, mesmos 12 registros:

    com  break-inside:avoid ... 3 páginas   <- a do meio é a branca
    sem  break-inside:avoid ... 2 páginas

O Relatório Operacional nunca teve isso porque a tabela dele não está
dentro de um bloco com `avoid`. É por isso que o dono pediu "o mesmo padrão
do relatório operacional" — ele descreveu a correção sem saber.

**A CORREÇÃO.** A proteção muda de nível, não desaparece: `break-inside:
avoid` protege a **linha** (`.print-page tr`, já existente), para nenhum
registro sair cortado ao meio; a tabela volta a poder continuar na página
seguinte, com o cabeçalho repetido. `break-after:avoid` no título do bloco
prende o título à sua tabela — título sozinho no pé da página é a outra
cara do mesmo defeito.

**A FAMÍLIA.** É parente da #71: *decisão aplicada no nível errado*. Lá,
gravar por linha quando bastava por lote; aqui, proibir quebra na tabela
quando bastava na linha. Nos dois casos a intenção estava certa e o alvo
errado — e nos dois o sintoma aparece longe da causa.

**O TESTE:** `testes/test_documento_nao_sai_pagina_em_branco.py`. Mede o
RESULTADO, não a regra de CSS: gera o PDF de verdade, conta as páginas e
compara com o mínimo que o conteúdo exige. Reprova com 3 onde cabem 2, nos
dois documentos. Confere também que a tabela começa na primeira página, que
o `thead` repete e que a linha continua protegida.

**CONFERIDO QUE NÃO QUEBROU O PADRÃO:** `test_relatorios` (Operacional,
Executivo e Fretes), `test_devolucoes_checklist` e
`test_devolucoes_ordem_e_sem_filtro_de_dia` passam.

---

## #73 — A sobra pesada não tinha como ser finalizada por ninguém (16/09/2026)

**Relato do dono**, com print junto: *"E NA PARTE DEVOLUÇÃO DE SOBRA,
DEPOIS QUE PESA TEM QUE COLOCAR A OPÇÃO DE FINALIZAR A ETAPA"*.

O print: sobra, placa SIY0G41, motorista LEONARDO, chegou sem lacre.
Carimbos PORTARIA ✓ e BALANÇA (ENTRADA) ✓ (Thiago Rafael), EXPEDIÇÃO
pendente. Na tela, só o texto *"Próximo passo: Descarga Conferida — feito
por Expedição ou Logística"* e nenhum botão. Ele estava logado como
**Faturamento**.

**SÃO DOIS DEFEITOS**, e o segundo é maior que o relatado.

**DEFEITO 1 — o botão desenhado não era o que o clique mandava.** Duas
funções respondiam à mesma pergunta ("qual o próximo passo desta
devolução"): `blocoAvancoDev` perguntava a `etapaDeDev`, que CONHECE o
atalho da sobra; `avancarEtapaDevolucaoUI` fazia `DEV_ETAPAS.find(...)` por
conta própria, e `DEV_ETAPAS` só conhece o caminho da devolução normal.
Medido no navegador, sobra parada em "Conferida no Faturamento", operador
da **Expedição** — que TINHA a permissão:

    botão desenhado ... '📦 Descarga conferida (Expedição)'  → Descarga Conferida
    o clique enviou ... { para: 'Peso Final Registrado' }
    o servidor ....... 409 'Sobra encerra no OK da Expedição — não volta
                            à balança nem passa por Controles Internos e
                            Central de Notas.'

Ou seja: **a sobra não era finalizável pela tela por NINGUÉM** — nem
Expedição, nem Logística, nem Administração. O dono viu a cara do problema
que era dele (não tinha botão); quem tinha botão levava 409.

O atalho da sobra mora fora de `DEV_ETAPAS` desde 08/09 — e por um bom
motivo, registrado lá: dentro da lista ele fazia "Conferida no Faturamento"
aparecer DUAS vezes na esteira, para todo mundo. A correção de então criou
`etapaDeDev` para quem pergunta o próximo passo. Faltou o segundo chamador
perguntar.

**DEFEITO 2 — quem pesou não podia encerrar.** Para a sobra, "Descarga
Conferida" é o ÚLTIMO passo (ela não volta à balança nem passa por
Controles Internos e Central de Notas), e ele estava liberado só para
Expedição e Logística. A sobra ficava pesada e parada esperando outro setor
aparecer. **E a esteira já chamava o Faturamento para ela** — "SUA VEZ",
porque "Conferida no Faturamento" é o status onde a segunda etapa dele
começa na devolução normal. Chamar e não dar caminho é a regra da casa ao
contrário: *botão desabilitado não ensina o caminho, só nega* — aqui nem
botão havia.

**A CORREÇÃO, nos dois lados.**

- servidor (`backend/src/dominio/devolucoes.js`): o Faturamento entra na
  linha `soSobra` da transição, ao lado de Expedição e Logística. **Só
  nela** — na devolução normal o OK da descarga sai de "Peso Final
  Registrado" e continua sendo de Expedição e Logística; pular a balança
  final lá continua impossível. A Expedição segue PRIMEIRA na lista: é a
  dona do passo e o nome que aparece na recusa.
- painel (`devolucoes.js`): `avancarEtapaDevolucaoUI` passa a perguntar a
  `etapaDeDev` — uma função, dois chamadores. `DEV_ATALHO_SOBRA` espelha a
  allowlist nova e o rótulo do botão vira **"✅ Finalizar sobra — descarga
  conferida"**: é a palavra do dono, e com três setores não dá para nomear
  um só no botão.
- a frase da recusa passou a ler como gente fala. `setores.join(' ou ')`
  com três nomes produzia *"Expedição ou Faturamento ou Logística"*. Virou
  `listaDeSetores()` em `dominio/fluxo.js`, chamada pelas duas recusas da
  devolução e pela da carga: *"Expedição, Faturamento ou Logística"*.

**O CARIMBO É DE QUEM DEU O PASSO.** Fechando a sobra, o Faturamento
assina a coluna `expedicao_por` com o nome dele, e `operador_setor` guarda
"Faturamento". É o mesmo desenho que já valia para a Logística, que cobre
todos os postos — a assinatura diz quem agiu, não qual setor é o dono do
passo.

**QUEM PODE FAZER, DESFAZ.** A allowlist do desfazer é a MESMA do avanço
(decisão de 14/09, ocorrência #68), então o Faturamento passou a poder
desfazer o fecho da sobra sem que nada precisasse ser escrito para isso.
Uma decisão, um lugar — funcionou como prometido.

**Vermelho→verde provado contra o publicado.** Com a allowlist antiga, a
suíte 19 do servidor reprova em 4 casos (`node --test
testes/devolucoes.test.js` → 99/103); na tela, 6 verificações da suíte
nova reprovam contra o `index.html` da branch de entrega, incluindo *"e o
clique dela também finaliza (era 409 antes)"* com a Expedição.

**Testes que travam:**
`backend/testes/devolucoes.test.js` suíte 19 (8 casos: o Faturamento
encerra a sobra que pesou; o carimbo guarda quem finalizou e o peso de
entrada continua intacto; a Expedição continua finalizando; quem finaliza
desfaz; a devolução normal não pula a balança final; nela o OK da descarga
continua recusando o Faturamento; a recusa ENSINA com a frase nova; a
filial continua sem avançar etapa) e
`testes/test_sobra_finaliza_quem_pesou.py` na tela — que, além do botão e
do clique, **lê as duas fontes e compara a esteira inteira**: as 7
transições, o carimbo e a allowlist de cada uma, no painel e no
`dominio/devolucoes.js`. É a mesma solução da lista de SETORES (#26): a
cópia é inevitável enquanto o painel for build de arquivo único, mas ela
não pode envelhecer calada.

**O que NÃO foi feito, de propósito.** O placeholder do campo de recado da
etapa diz "Observações para a próxima etapa" mesmo quando é o último passo
(vale para a sobra e para a Central de Notas) — é anterior a isto e não
tem relação com o relato. E `exigirSetor` (middleware/auth.js) ainda tem
seu próprio `join(' ou ')`; hoje ele nunca recebe mais de um setor.

**Não precisa de migração** — a mudança é de regra, não de schema, e
nenhuma sobra em andamento precisa ser mexida.

**Só vale depois do `atualizar.sh`:** a allowlist é do servidor. O painel
publica antes pelo Vercel, e nessa janela o Faturamento vê o botão novo e
leva a recusa **explicada** do servidor antigo (*"O setor Faturamento não
registra 'Descarga Conferida'. Quem faz esse passo: Expedição ou
Logística."*). A metade que NÃO depende do servidor — o clique mandar a
transição certa — passa a valer assim que o painel publica, e já destrava a
sobra para Expedição, Logística e Administração.
## #74 — Dois defeitos que o movimento novo criou, pegos antes de subir (16/09/2026)

**Pedido do dono:** *"quero um sistema com cara nova, COM ANIMAÇÕES,
FLUIDEZ. Tudo de preview que você me mostrou seja aplicado em seu devido
lugar."* E, no meio do trabalho, o aviso que mudou a forma da entrega:
*"SEM MEXER NO RELATÓRIO. SEM ATRAPALHAR O RELATÓRIO."*

Nenhum dos dois defeitos abaixo chegou à operação. Os dois foram achados
pelo teste escrito junto com a mudança, e ficam registrados porque são de
FAMÍLIA, não de detalhe: quem for animar a próxima tela vai tropeçar nos
mesmos dois lugares.

### DEFEITO 1 — repouso invisível é faixa em branco no papel

A linha que "sai do pátio" fecha o próprio espaço: altura a zero, celas sem
espaçamento, conteúdo escondido. Na tela isso dura 90 ms e some junto com a
linha. No PAPEL não existe duração — só existe o estado.

O servidor gera os PDFs com ESTE mesmo `styles.css`
(`backend/src/servicos/pdf.js` manda `{html, css}` ao Chromium). Desligar só
`animation` e `transition` em `@media print` NÃO bastava: o que deixava a
linha com zero de altura não era a animação, eram as declarações de repouso
(`height`, `padding`, `font-size`, `display:none` nos filhos) e o `height`
escrito em linha pelo JavaScript. Medido no teste: **0 px de altura no
papel**, ou seja, uma faixa em branco no lugar de um registro.

É a **#72 por outra porta** — decisão de papel aplicada no nível errado —,
e a regra que fica é mais curta que a explicação:

> Em `@media print`, desligar o movimento NÃO é desligar `animation` e
> `transition`. É devolver TODO estado de repouso ao visível: altura,
> opacidade, deslocamento, espaçamento e conteúdo. E o estilo em linha só
> se desfaz com `!important`.

A mesma correção vale para `prefers-reduced-motion`, e pelo mesmo motivo:
sem movimento, a classe que apagava a linha continuaria apagando-a — quem
pediu menos movimento receberia menos PAINEL.

### DEFEITO 2 — animação no caminho crítico atrasa o trabalho

O botão que conta ("Salvar → Salvando… → ✓ Salvo") esperava as duas trocas
de texto — 200 ms cada — antes de devolver o controle a quem chamou. Como o
`renderAll()` do cadastro vem depois disso, a tabela de Rotas passou a ser
redesenhada **400 ms mais tarde**.

`test_cadastrar_rota` reprovou em "a rota nova aparece na tabela do card". A
rota estava certa, gravada e no servidor: a TABELA é que ainda não tinha
sido desenhada. Vermelho de **regressão de verdade** (causa 4 das quatro),
com cara de teste velho — e tratar como teste velho teria publicado um
painel quatro décimos mais lento em cada gravação.

> Animação anda AO LADO do trabalho, nunca na frente dele. A promessa que a
> função devolve resolve quando a TAREFA resolve; o botão conta por fora.

Com trocas soltas, duas podem se atropelar quando o servidor responde em
50 ms — por isso cada troca leva uma senha e só a mais recente escreve o
texto. Botão parado no texto errado é pior que botão sem animação.

### O TESTE

`testes/test_movimento_do_painel.py`, em oito seções — uma por movimento,
mais o papel e o movimento reduzido. Reprova em 32 conferências contra o
painel publicado. As que importam para esta ocorrência:

- *"no papel, a linha continua tendo altura — não sai como faixa em branco"*
  (a tabela de prova fica FORA das abas: em impressão `.tab-page` inteira é
  `display:none`, e medir lá responderia zero por outro motivo);
- *"no papel, NADA nasce transparente"* e *"o visto sai DESENHADO"*;
- *"com movimento reduzido, a linha não desliza nem some"*;
- os tetos de tempo, medidos em quadros e não no que o CSS declara.

**CONFERIDO QUE NÃO QUEBROU O PAPEL:** `test_documento_nao_sai_pagina_em_branco`,
`guarda_do_padrao_papel`, `test_relatorios`, `test_relatorio_sem_paginas_brancas`,
`test_relatorio_uma_pagina`, `test_css_do_relatorio`, `test_relatorio_fiel_ao_painel`,
`test_relatorio_na_sequencia`, `test_relatorio_manobrista`,
`test_fonte_relatorio_embutida`, `test_operador_no_relatorio_operacional` e
`test_devolucoes_checklist` passam. E os PDFs foram gerados DE VERDADE pelo
servidor, com 26 cargas: Operacional 2 páginas, Executivo 3, Fretes 2,
Manobrista 1 — o MESMO número de páginas do painel publicado, e nenhuma
página em branco nos dois.

## #75 — A Torre sempre rolou de lado no tablet da Portaria, e ninguém media (17/09/2026)

**Sintoma.** Em tablet de 1024px em paisagem — o aparelho que a Portaria usa
no pátio, com luva —, a tabela da Torre de Controle mostra **746px** e precisa
de **894px**. Faltam **148px**: a operação rola de lado para ver a coluna de
peso, todos os dias.

**Por que passou.** `guarda_do_padrao.py` tinha dois perfis: computador de
1280px SEM toque, e celular de 390px COM toque. O tablet mora exatamente entre
os dois — tem a largura de um e o dedo do outro — e não era nenhum deles. A
largura de 1280 deixava a tabela caber; a de 390 virava cartão, que não tem
coluna. O defeito existia no vão.

**Como apareceu.** Não foi investigação: foi consequência. O Tema 2027 causou
uma regressão de alvo de toque que só acontece em tela larga com toque (`.btn`
caindo de 44px para 36px), e para pegá-la foi preciso criar o terceiro perfil.
Criado o perfil, ele reprovou também nesta rolagem — que não era nova.

**Prova de que é anterior, e não da camada.** A mesma guarda, contra o
`index.html` da branch de entrega (o que está no ar agora):

```
publicado   tablet  div.table-wrap mostra 746 px e precisa de 894 (faltam 148)
Tema 2027   tablet  div.table-wrap mostra 750 px e precisa de 907 (faltam 157)
```

A camada acrescenta 9px a um buraco de 148 que já existia. Acusar a camada por
isto seria tratar causa 4 onde a causa é anterior — e deixaria o defeito de
verdade sem dono.

**Família.** "Medida que não existe não protege" — parente de #17 (bateria que
não terminava não protegia ninguém) e da razão de existir da própria guarda: as
~180 suítes provam que o painel FUNCIONA, nenhuma provava que ele está LEGÍVEL.
Aqui o mesmo buraco aparece um nível acima: o perfil de aparelho que ninguém
mede é um aparelho que ninguém protege.

**O que foi feito agora.** Terceiro perfil (`tablet`, 1024×768, sem emulação de
celular e COM toque) em `guarda_do_padrao.py`, com o porquê escrito no próprio
arquivo. `has_touch` é o que liga `pointer:coarse`; `is_mobile` fica falso
porque tablet em paisagem renderiza como tela larga, não como telefone.

**O que NÃO foi feito, e é decisão de quem manda.** As larguras das colunas da
Torre foram calibradas para caber em 1002px, que é o que sobra num monitor de
1280px. Num tablet sobram 746. Fazer a Torre caber ali é redesenho de tabela,
não ajuste — e não se muda a tela que a operação usa no meio do dia sem o dono
dizer. Fica registrado, com número, para ser decidido.

## #76 — A regra que escondia o rótulo tinha teto; a coluna que a motivou, não (17/09/2026)

**Relato do dono, com print:** *"botao de criar carga precisa ficar abaixo do
excluir nesa parte ele esta pequeno e horrivel"*. Depois, fechando a ordem:
*"criar carga acima do excluir"*.

**Sintoma.** No monitor grande, a ação principal da Montagem — o botão que
transforma a linha em carga — aparecia como um pedaço de palavra sem sentido,
cortado pela esquerda, ao lado de um "Excluir" inteiro.

**Causa, e ela é da MESMA entrega de 16/09.** Naquele dia duas coisas foram
feitas juntas:

1. a tabela virou `table-layout:fixed`, com a coluna de Ação cravada em
   **76px de 821px para cima, sem teto**;
2. uma regra passou a esconder o rótulo do botão (`.mont-rot`) **entre 821 e
   1399px**, com o comentário *"acima de 1400 px sobra espaço"*.

A premissa (2) contradiz o fato (1), e as duas foram escritas no mesmo dia,
uma perto da outra. Acima de 1400px o rótulo voltava para dentro de uma coluna
que nunca crescia. Com `justify-content:flex-end` e a célula cortando o
excesso, quem sobrava para fora era o PRIMEIRO botão — e ele era cortado pela
esquerda, a borda que ninguém espera.

**Medido no `index.html` publicado, viewport 1920:**

```
botão "Colocar placa"   largura 106px   dentro da célula: NÃO
botão "Excluir"         largura  60px   dentro da célula: sim
```

**Família.** "Duas regras do mesmo dia com premissas opostas" — parente de #26
e #14 (a mesma decisão escrita em dois lugares), mas com uma diferença que
vale registrar: aqui as duas cópias não eram do mesmo VALOR, eram de uma
SUPOSIÇÃO. Nenhuma linha estava errada isolada. O erro só existe na relação
entre elas, e por isso nenhuma leitura de arquivo o encontraria — só medir a
tela encontra.

**Correção.** A célula empilha em vez de enfileirar, de 821px para cima: cada
botão passa a ocupar a largura inteira da coluna. A ordem é a que o dono
pediu, criar em cima e excluir embaixo, que também é a mais segura — o botão
que apaga deixa de ser o primeiro que o dedo encontra ao varrer a linha. A
regra do teto de 1400px sai: não existe mais faixa onde o rótulo não caiba.

A seta `▸` sai da célula no computador. Não se perde informação: ela já era
`aria-hidden="true"`, decoração declarada que o leitor de tela nunca viu, e a
linha inteira continua clicando para abrir.

**O custo, medido, e por que não ficou maior.** Empilhar com a altura padrão
de botão levava a linha de 72px para 88px — 16px por linha, 670px de rolagem a
mais numa sexta de 42 linhas. Trocar defeito de leitura por defeito de
navegação é mudar o defeito de lugar. Com o botão em 28px **no ponteiro fino**,
a linha fica em 80px: **8px de custo**, e o rótulo legível nas duas larguras.

O `pointer:fine` ali não é enfeite: sem ele a regra venceria por
especificidade de id a régua de 44px do dedo — que foi corrigida horas antes,
neste mesmo dia, depois de a camada nova tê-la derrubado no tablet da Portaria.
No toque nada muda.

**Guarda.** `testes/test_montagem_acao_empilhada.py`. Contra o publicado
reprova em 4 conferências, incluindo a que nomeia o defeito
(*"Colocar placa tem 106px e sai da célula"*); contra o build novo, nenhuma.

## #77 — A operadora ocupou a coluna onde se confere pagamento de frete (17/09/2026)

**Relato do dono:** *"no relatorio de administracao de fretes comecou a sair a
operadora no lugar das observacoes, que deve sair ou a observacao colocada pelo
programador com o valor do frete combinado, ou o nome do destino mais valor do
frete calculado pelo painel"*.

**Duas datas, e é isso que explica o "começou".**

`app.js` colava o apelido da rota **na frente** da observação desde **25/08**,
quando a linha da Montagem vira carga. A intenção estava escrita e era boa:
*"quem lê a carga na Torre precisa saber que 517 é a Ômega"*.

Em **14/09** a lista de operadores do gestor foi aplicada às rotas. O apelido
do modelo é "Destino - Operadora". O campo existia e vivia vazio; dali em
diante quase toda rota ganhou apelido, e quase toda carga nasceu com a
operadora colada na frente do recado.

**O código é de agosto. O sintoma é de setembro. Ninguém mexeu em nada no dia
em que o defeito apareceu** — e é por isso que procurar a causa pela data do
relato não encontraria nada.

**Por que a coluna importa.** Repare no que as duas opções que o dono deu têm
em comum: as duas terminam num VALOR. Aquela coluna não é campo de recado — é
onde quem confere pagamento lê quanto a viagem custou e de onde veio o número.
Ocupá-la com o nome da operadora não é só ruído: apaga a informação que a
página existe para carregar.

**Família — e é uma variação que vale nomear.** "A mesma decisão escrita em
dois lugares" (#14, #26), mas aqui a segunda cópia não divergiu: ela **ocupou
o lugar de outro dado**. O operador já era derivável da rota — `rotaOperador()`
existe e `rotaApoio()` já o desenha no impresso. Copiá-lo para dentro de um
campo de texto livre deu ao mesmo pedaço de tela dois donos, e o que chegou
depois apagou o que estava lá.

**Correção, nas duas pontas:**

1. **Na origem** — a carga que nasce da Montagem não recebe mais o apelido
   colado. A observação volta a ser só o que a pessoa escreveu.
2. **No relatório** — a coluna passa a valer a regra do dono: observação de
   quem negociou, se houver; senão destino + valor calculado pelo painel; e,
   sem valor, destino + o MOTIVO de não haver. Célula vazia ao lado de um
   destino é lida como "o sistema não sabe" e manda alguém perguntar — mesma
   decisão já tomada em `freteMontagemHtml()`.

**O que NÃO foi feito, e é decisão do dono.** As cargas criadas entre 25/08 e
hoje têm o texto colado GRAVADO no banco. Corrigir o código para frente não
desfaz o que já está lá: nessas linhas, quem escreveu observação vai ver o
apelido antes dela. Limpar isso é migração de dado em produção, e não se
reescreve observação de operador sem ele mandar.

**Guarda.** `testes/test_fretes_observacao_e_valor.py`. Contra o painel
publicado reprova em 5 conferências; contra o build novo, nenhuma. O item que
confere a cola lê o PAINEL MEDIDO, não o `app.js` do checkout — a primeira
versão lia o arquivo local e dava OK mesmo rodando contra o publicado, que é a
mesma armadilha da ocorrência anterior deste mesmo dia.

---

## #78 — A regra estava escrita no comentário e nunca foi implementada (17/09/2026)

**Relato do dono, com a operação parada:** *"Ele está tentando mudar o 9 para
o 7, mas não funciona. **Até o 6 funciona** na sequência. Hoje não há 14
cargas, apenas o número 14. Não conseguimos alterar isso."*

**"Até o 6 funciona" foi o que deu a causa em minutos.** A fila daquele dia
era 1, 2, 3, 4, 5, 6 e uma carga no 9. `numerosDaFila()` devolvia exatamente
`[1,2,3,4,5,6,9]` — as **casas** — e `filaReordenada()` recusava qualquer
número fora dessa lista. Tudo até 6 entrava. O 7 e o 8 não existiam como casa
e eram negados. Não havia nada de errado com a operação: a trava era minha.

Reproduzido antes de tocar em qualquer linha, direto na função:

```
fila 1,2,3,4,5,6,9  → digitar 7  → RECUSADO (null)
fila 1,2,3,4,5,6,9  → digitar 6  → aceito          ("até o 6 funciona")
fila 1,2,14         → digitar 3  → RECUSADO (null) ("só o número 14")
```

E a mensagem que a operação via na tela, medida contra o servidor publicado:

> *"Posição inválida. As casas desta fila são 1, 2, 3, 4, 5, 6 e 9 — arraste a
> carga para a linha que você quer, ou digite um desses números."*

**A causa raiz não é um erro de conta: é uma regra documentada que o código
nunca cumpriu.** O comentário de `numerosDaFila()`, escrito por mim em 08/09,
descrevia **duas portas** para um número novo entrar na fila:

> *"NÚMERO NOVO SÓ ENTRA POR DUAS PORTAS, as duas explícitas: · carga da fila
> que ainda não tem número nenhum (...); · alguém DIGITA um número que não
> existe na fila (é o caso do campo da Torre). Aí a casa nova entra e a que a
> carga deixou sai."*

A segunda porta está ali em prosa, com o caso de uso e tudo. **Ela nunca foi
escrita em código.** `filaReordenada()` fazia `casas.indexOf(alvo)` e devolvia
`null` no `-1`, sem exceção. Passaram nove dias entre escrever a regra e a
operação bater nela.

**Por que a trava existia, e por que ela estava certa para o arrasto.** Ela
nasceu da ocorrência de 09/09: arrastar renumerava em silêncio números que a
Logística tinha digitado. Arrastar solta **sempre** em cima de uma linha que
já tem número — então o tabuleiro nunca atrapalha o arrasto, e continua
valendo para ele.

**Digitar é outra pergunta, e foi essa distinção que faltou.** Quem digita 7
está *dizendo* qual número quer; não há nada de silencioso nisso. A correção:
a casa digitada entra, a casa que a carga deixou sai — uma entra, uma sai, o
tamanho da fila não muda e **ninguém mais é renumerado**.

```
fila 1,2,3,4,5,6,9 · digitar 7 na carga do 9   →  1,2,3,4,5,6,7  (1 escrita)
fila 1,2,14        · digitar 3 na carga do 14  →  1,2,3          (1 escrita)
```

**Uma função, três chamadores — e desta vez a favor.** `filaReordenada()` é a
mesma na Torre, na Programação do Dia e na Montagem. A correção num lugar só
conserta as três telas, e nenhuma delas pode divergir depois.

**Família.** Não é a de "a mesma decisão em dois lugares" (#14, #26) nem a de
"duas escritas em voo" (#16). É uma nova, e ela merece nome porque vai voltar:
**regra escrita em prosa que o código não cumpre**. O comentário passa a
funcionar como documentação de algo que não existe — e o próximo a ler (eu,
nove dias depois) confia nele em vez de conferir. Ponto sem nó com aparência
de nó dado.

**O que continua recusado, e não pode mudar:** número de carga que já
carregou. Aquilo é registro do que aconteceu, e registro não é casa de fila.

**Guardas:**

- `backend/testes/api.test.js` bloco 44 — 11 testes, com os dois cenários do
  dono nos números dele. Contra o servidor publicado, os três primeiros
  reprovam com a mensagem real da tela.
- `testes/test_montagem_cascata_e_digitacao.py` seções 4 e 5 — a mesma regra
  pela porta da Montagem.
- `testes/test_sequenciamento_e_reorganizar.py` — o lado do painel.
- Força bruta, 200.000 cenários: o número digitado é sempre o que fica · nunca
  repete · a fila nunca toma o número de quem já carregou · e a porta nova não
  renumera ninguém que já tinha número.

**Dois testes meus foram atualizados, e isso é causa 1, não regressão.** O
bloco 7d (`posição fora da fila é recusada`, 999) e o bloco 43 (`número solto
CONTINUA recusado`, 5) guardavam a trava. Ordem do dono, com todas as letras:
*"Independentemente do número, você vai resolver"*. Tratar causa 1 como causa
4 teria me feito "consertar" o código para manter o defeito.

---

## #79 — O botão "Reordenar por Sequência" avisava sucesso sem fazer nada (17/09/2026)

**Pedido do dono:** *"Um botão de 'reorganizar por sequência' em todas essas
áreas, **que funcione corretamente**."*

Ele existia na Programação do Dia desde sempre. Inteiro:

```js
function reordenarPorSequenciaUI(){
  renderProgFila();
  notify('Fila reordenada por Sequência.', 'success');
}
```

Redesenhava a tela — que **já** desenhava ordenada por sequência — e anunciava
sucesso. O aviso era verdadeiro sobre a tela e mentiroso sobre a fila. Quem
clicava via 1, 2, 14 continuar 1, 2, 14 com um "pronto!" verde em cima.

Flagrado contra o painel publicado, com a fila semeada em 1, 2, 14 e sem
servidor nenhum:

```
avisou sucesso: ['Fila reordenada por Sequência.']
sequências depois do clique: [1, 2, 14, None]
```

**Por que isso é pior que um botão ausente.** Botão que não existe manda a
pessoa procurar outro caminho. Botão que afirma ter feito e não fez gasta a
confiança em **tudo o mais** que o painel diz — inclusive nos avisos que estão
certos. Foi provavelmente ele que fez o dono concluir que "não conseguimos
reorganizar" antes mesmo de chegar no defeito do 7.

**Correção.** Rota nova (`POST /api/cargas/fila/reorganizar` e
`POST /api/montagem/reorganizar`), uma transação, a fila do dia passando a
ocupar os menores números livres e desviando dos que cargas fora da fila já
seguram. Botão nas três áreas. O aviso agora diz o número, **e diz quando o
número é zero** — "a fila já estava em ordem, nada mudou" é uma resposta, não
um fracasso a ser escondido atrás de um "pronto!".

**Por que renumerar em massa é permitido aqui e proibido no arrasto.** A
objeção de 09/09 nunca foi à renumeração: foi ao **silêncio** dela. Aqui a
pessoa apertou um botão que diz exatamente isto, depois de uma pergunta que
explica o que vai acontecer. É a regra da casa: não bloqueie quem tem
autoridade — pergunte e explique.

**Um defeito pego antes de subir.** A primeira versão da rota chamava
`gravarEvento()`, que escreve também em `fact_statusfrota` — a tabela **fato**
do Power BI e base de todo indicador de tempo do pátio. Duas coisas:
`carga_id` é `NOT NULL` com FK, então a rota teria quebrado na primeira
chamada; e, se não tivesse, cada clique no botão viraria uma **movimentação de
pátio inventada** nos números que vão para a diretoria. Trocado por
`gravarNota()`, que só escreve no log. Tem teste próprio.

**Ainda de pé, e precisa de decisão do dono:** a rota `/cargas/sequenciar`
grava `posição N` como `status_novo` em `fact_statusfrota` desde 08/09. É o
mesmo defeito, com linhas já em produção — limpar exige mexer em dado
gravado, e a coluna não tem CHECK que impeça a próxima.

**Arrastar, a terceira metade do mesmo pedido.** *"O filtro de arrastar para o
local desejado deve operar sem falhas."* Soltar em cima de uma linha **sem
número** era um `return` mudo: a pessoa arrastava, soltava, não acontecia nada,
e a conclusão razoável era "o arrasto está quebrado". A regra da casa diz que
recusa do servidor nunca pode ser silenciosa; a da tela também não pode. Agora
diz o motivo e ensina o caminho.

**Guardas:** `testes/test_sequenciamento_e_reorganizar.py` (reprova em 9
conferências contra o publicado), `backend/testes/api.test.js` bloco 44,
`testes/test_montagem_cascata_e_digitacao.py` seção 5.

---

## #80 — 27.284 kg virava 27 kg, e 27,284 virava zero (17/09/2026)

**Relato do dono:** *"Não estou conseguindo inserir o valor completo, 27.284;
está aparecendo apenas 27, com duas casas decimais. Preciso colocar o valor
que quiser."*

Reproduzido no Chromium, antes de qualquer correção:

```
digitado "27.284"  →  value "27.284"  →  Number 27.284  →  guardado 27
digitado "27,284"  →  value ""        →  campo esvazia  →  guardado 0
digitado "1.250"   →  value "1.250"   →  Number 1.25    →  guardado 1
```

**`<input type="number">` fala inglês.** O **ponto** é separador decimal e a
**vírgula** é caractere inválido — e caractere inválido num campo numérico faz
o navegador devolver string vazia em `.value`, sem avisar ninguém. Quem digita
peso em quilo no Brasil escreve 27.284 querendo vinte e sete mil.

**O que torna isto grave não é o campo recusar: é ele ACEITAR e guardar outra
coisa.** Ninguém vê erro. A carga fica com 27 kg, ou com 0 kg, e segue para o
relatório de peso e para o indicador da diretoria como se fosse verdade.

**Família — e ela já tem duas entradas aqui.** `Number(0) || null`, que apagou
capacidade de veículo; e `kmValido()`, que existe porque `Number('') === 0`
faria frete de R$ 0,00. É sempre a mesma coisa: **conversão silenciosa que
troca o dado por um parente dele**. `null ≠ zero` está no CLAUDE.md por causa
desta família, e ela voltou pelo lado do navegador em vez do lado do código.

**Correção.** 40 campos: 38 viraram `type="text" inputmode="numeric"` (o
teclado do celular continua numérico no pátio) e passam por
`quantidadeDigitada()`, que lê os dígitos e ignora qualquer separador. Os dois
que são dinheiro ou fração — tarifa de frete em R$/km e kg de produto na
devolução — usam `valorDigitado()`, que entende vírgula como decimal, do jeito
que se escreve aqui. Campo apagado continua guardando `null`, nunca zero.

**O campo de sequência estava nessa lista**, e é por isso que esta correção
sobe junto com as #78 e #79: é o mesmo campo, o mesmo dia, a mesma tela.

**Guarda.** `testes/test_numero_digitado_com_ponto.py`. Contra o painel
publicado reprova em 9 conferências, incluindo a primeira — que conta quantos
`type="number"` sobraram na tela, porque enquanto o campo for `type=number`
**não existe função de leitura que conserte**: o `.value` já chega vazio ou
truncado do navegador.

---

## #81 — Três relógios, e a bateria só é confiável em 21 das 24 horas (18/09/2026)

**Como apareceu.** O portão reprovou com três suítes vermelhas de uma vez —
`test_montagem_acao_empilhada`, `test_montagem_cabe_em_colunas` e
`test_toque_responde` — todas com o mesmo sintoma: *"nenhuma linha de montagem
na tela"*. As **mesmas três** tinham passado verdes na bateria de uma hora
antes, sem nenhuma mudança de código entre as duas.

**A medição que deu a causa**, feita no navegador, no caminho que o teste usa:

```
o servidor criou a linha em   data_prog: 2026-09-17
a tela da Montagem estava em  dia:       2026-09-18
```

Eram 21h31 no Brasil, 00h31 em UTC. A data tinha virado **no meio da
bateria**.

**São TRÊS relógios, não dois** — e essa foi a parte que eu errei na primeira
leitura, antes de conferir:

1. **`hojeISO()` no servidor** — fixado em `America/Sao_Paulo` por `Intl`, de
   propósito e corretamente: o pátio fica no Brasil e o dia da programação é o
   de lá.
2. **O painel** — `isoDiaLocal(new Date())`, o relógio do **aparelho de quem
   está olhando**.
3. **O Postgres** — `now()` e `current_date`, no fuso do cluster (UTC aqui).

Em produção os três calham de concordar. Num container em UTC, não: entre 21h
e a meia-noite do Brasil o relógio 1 ainda está no dia 17 e os relógios 2 e 3
já viraram para o 18.

**O que eu tentei, e por que desfiz.** Primeiro aliinhei só o navegador
(`TZ=America/Sao_Paulo` na bateria). Não resolveu: **trocou** aquelas três
suítes por outras quatro — `test_data_programacao`,
`test_devolucoes_checklist`, `test_esteira_devolucao_duas_balancas`,
`test_montagem_linha_editavel` — porque agora eram os relógios 1 e 2 contra o
3. Depois alinhei também o Postgres do banco de teste. Ainda sobraram duas.

Desfiz as duas tentativas. Não porque a direção esteja errada — ela está
certa — mas porque **alinhar os três relógios não é um ajuste de uma linha**, e
empurrar mudança meio-entendida na malha de testes na véspera de uma entrega
urgente é trocar um problema conhecido por um desconhecido. Fica escrito aqui
em vez de ficar meio-feito no código.

**O estado real, dito sem maquiagem:** a bateria de tela é confiável em ~21 das
24 horas. Nas três horas entre 21h e a meia-noite do Brasil ela produz
vermelhos que **não são defeito**, e produz vermelhos **diferentes** conforme o
fuso em que rodar. É a causa nº 3 vestida de causa nº 4, e custa a noite de
quem for investigar sem saber disto.

**Como reconhecer, se acontecer de novo:** várias suítes reprovando de uma vez
com sintoma de "não tem linha/carga na tela", **e** as mesmas suítes tendo
passado verdes numa rodada recente sem mudança de código. Confira as horas
antes de mexer em qualquer coisa:

```bash
date -u '+UTC %F %H:%M'; TZ=America/Sao_Paulo date '+Brasil %F %H:%M'
```

Datas diferentes = é isto. Espere a meia-noite do Brasil passar e rode de novo.

**A correção certa, quando for a hora, e ela vale para os dois lados.** O dia
operacional é uma decisão do servidor, como qualquer outra. O `/health` já
devolve a hora dele; basta devolver junto o **dia operacional**, e o painel
obedecer em vez de adivinhar — a mesma regra da casa que vale para a fila:
*o servidor é quem manda; a tela adianta o resultado*. Com isso caem juntos o
vermelho de bateria E o risco de produção.

**O risco de produção, que continua de pé.** Quem abrir o painel num aparelho
com o fuso errado — um celular que voltou ao padrão de fábrica, um acesso de
fora do país — vê um "hoje" que não é o do servidor: a Montagem do Dia aparece
vazia, e a carga que ele criar cai num dia que ninguém está olhando. Não há
evidência de que já tenha acontecido, e por isso não mexi nisso hoje. Falta
também conferir em que fuso está o Postgres da produção, o que não dá para
fazer deste ambiente — a rede de produção é bloqueada daqui.

**Família.** "Duas fontes para a mesma verdade" (#14, #26, #77). Aqui são
três, e uma delas é o aparelho do usuário — a única que ninguém controla.

---

## #82 — O KM do cadastro parecia preenchido e não estava (21/09/2026)

**Relato do dono**, na Montagem do Dia:

> "o campo frete ainda nao ta editavel e o km quando é colocado nao calcula
> direto no campo frete"

São dois pedidos numa frase, e o primeiro instinto foi tratá-los como um só
defeito. São dois, com causas diferentes.

**A medição, feita ANTES de mexer em qualquer linha:**

```
escolher o destino  ->  km_destino       = 1570
                        km_deslocamento  = NULO
                        frete            = nada, "Sem KM de deslocamento"
digitar 1570 à mão  ->  frete            = R$ 18.306,20
```

**A conta nunca esteve quebrada.** `dominio/frete.js` multiplicava km × tarifa
certinho, e o resultado com 1570 digitado à mão prova isso. O que faltava era
o KM **chegar** na conta: o cadastro de destinos resolvia `km_destino`, e quem
a conta multiplica é `km_deslocamento`. Duas colunas, uma preenchida e a outra
não, e nada ligando uma à outra.

**Por que ninguém viu antes, e é aqui que está a lição.** Na tela, o número do
cadastro aparecia como **dica cinza dentro do campo vazio** (`placeholder`).
Para quem olha, campo com número dentro é campo preenchido. Para o servidor,
era `NULL`.

> **Dica cinza não é valor.** Um `placeholder` que mostra um número real ensina
> a tela a mentir: ele tem a forma do dado sem ser o dado. Se o número existe e
> vale, ele entra no campo como valor; se não vale, não se mostra número nenhum.

**O segundo pedido — frete editável — não era defeito, era ausência.** O valor
do frete nunca foi gravado na Montagem: saía calculado na leitura, de
propósito, porque "valor guardado em rascunho é valor que envelhece calado". A
regra da casa continua valendo; o que mudou é que agora existe **uma coluna
própria para o combinado à mão**, e o calculado continua calculável ao lado.
Não se escolheu uma das duas verdades — marcou-se qual é qual (migração 054).

**A decisão do dono que virou coluna.** Perguntado o que fazer quando alguém
muda o KM DEPOIS de o valor ter sido digitado, ele escolheu: o valor digitado
FICA, e a linha avisa que o KM mudou e o frete não acompanhou. É para isso que
existe `frete_manual_km` — sem guardar em que KM o combinado foi feito, não há
como saber que ele ficou para trás.

**O que trava:** bloco 45 de `backend/testes/api.test.js`, 13 testes. Sete
deles reprovam contra o servidor publicado em 05dbb0b.

**Uma armadilha que este bloco pagou duas vezes.** A primeira versão criava uma
linha de montagem por teste — onze linhas, duas requisições cada. Sozinho
passava; na bateria inteira estourava o limite de requisições por minuto (429)
e derrubava nove testes sem defeito nenhum. Foi a segunda vez seguida: o bloco
44 tinha caído nisso na véspera.

A correção definitiva **não** foi encolher o teste mais uma vez. Foi reconhecer
que o limite de 300/janela é proteção de PRODUÇÃO contra tráfego real, e que
uma bateria — um processo martelando um servidor — não é tráfego real. O
`npm run teste` agora roda com `RATE_LIMIT=20000`. Isso não apaga cobertura: o
único teste que mede o limitador de verdade sobe um servidor **isolado** com
`porJanela = 3` e restaura o valor no `finally`, sem ler a variável de
ambiente.

**Como reconhecer a família, se voltar:** vários testes de um mesmo bloco
reprovando em sequência, com 429 na resposta, e o bloco passando verde quando
rodado sozinho. É a causa nº 3 — contaminação de ambiente —, nunca a nº 4.

---

## #83 — A rota dizia a região, e o motorista precisava da cidade (22/09/2026)

**Relato do dono, em três mensagens:**

> "na torre de controle precisa aparecer o destino tambem de cada carga, ao
> inves de sair alto paranaiba por exemplpo, que saia a cidade exta que a
> carga esta indo"

> "no relatorio operacional, na coluna rota, precisa sair o destino tambem,
> além do codigo da rota, pois so a regiao deixa confuso para os motoristas e
> acabca atrapalhando a operacao"

> "na hora de pegar o template da montagem do dia ela ta puxando os nomes das
> cidades e quando sao criadas novas na montagem do dia ela os mantem a rota e
> nao pux o nome das cidades"

**Não era uma tela com defeito, eram duas fontes de verdade.** O nome da
cidade existia em dois lugares: no **modelo de semana**, digitado por quem
monta a programação, e no **cadastro da rota**, no campo de detalhe. As telas
liam um ou outro conforme quem as escreveu, e o resultado era o que o dono
descreveu: a mesma carga saía "Alto Paranaíba" num lugar e "Patos de Minas,
Carmo do Paranaíba" no outro.

> **Uma função, dois chamadores.** `destinosDaRota()` em `data.js` passou a
> ser a única resposta para "para onde esta rota vai": o modelo ganha, o
> cadastro é a reserva. Torre, Relatório Operacional e Montagem perguntam a
> ela. Antes, cada uma respondia sozinha.

**A armadilha do separador.** O detalhe do cadastro separa cidades por vírgula
e por " e " — mas **não** por barra. "Patos de Minas/MG" é UMA cidade com o
estado junto; quebrar na barra inventaria uma cidade chamada "MG". Está
escrito em `cidadesDoDetalhe()` porque não é óbvio olhando o dado.

**O defeito que a correção quase criou, e que a bateria pegou.** A primeira
versão punha `await garantirCatalogoDeDestinos()` na frente do desenho da
Montagem: uma chamada de rede ANTES de pintar a tela. `test_sequencia_no_celular`
reprovou com "sem linha". No celular do pátio, com sinal fraco, a tela ficaria
**em branco** — e ninguém relacionaria isso a um campo de destino.

> **O catálogo não segura o desenho da tela.** Dado de apoio carrega atrás; o
> que a operação precisa ver aparece primeiro. Vale para qualquer leitura de
> rede posta na frente de um `render`.

**O que trava:** `testes/test_destino_da_carga.py` e o bloco de destino em
`backend/testes/api.test.js`; e `test_sequencia_no_celular`, que já existia e
foi quem pegou a regressão.

---

## #84 — Terceira vez: o botão prometia, o servidor negava (23/09/2026)

**Relato do dono:**

> "vamos la todas as filiais precisam ter acesso a gerar relatorio para o
> operador, filiales filialbsb filialba"

E, perguntado se o outro botão do mesmo cartão entrava junto:

> "somente relacao para o operador"

**A mesma família, pela terceira vez no mesmo arquivo.** `DONOS_DO_DOCUMENTO`
em `backend/src/dominio/documentos.js` diz quem gera cada PDF. Os botões do
cartão de checklist são desenhados **sem condição de setor**. Resultado: quem
não está na tabela vê o botão, clica, e leva 403 "seu setor não gera este
documento".

| quando | quem | o que via |
|---|---|---|
| 11/09/2026 | Qualidade | o único botão que ela tinha respondia 403 |
| 23/09/2026 | as três filiais | os dois botões do cartão respondiam 403 |

**A causa não era a tabela — era o painel nunca ter recebido a resposta.** A
função `documentosDoSetor()` existe desde 22/08/2026 e o comentário dela diz,
com todas as letras: *"a lista que o PAINEL usa para decidir quais botões
mostrar"*. Ela nunca foi mandada para o painel. Cada correção anterior
acrescentou um setor na tabela e deixou o mecanismo intacto para a próxima.

> **Botão visível que sempre dá erro é problema de segurança, não de estética.**
> Está escrito no próprio arquivo desde agosto: ele ensina o operador a ignorar
> mensagem de permissão. Operador que ignora aviso passa reto pelo aviso que
> importa.

**O que mudou agora, e por que fecha a família:** as três portas de sessão —
login, `/auth/eu` e renovação — devolvem a lista **dentro** do objeto do
operador, por uma função só (`sessaoDoOperador`). O painel guarda em
`DB.operador.documentos` e esconde os botões marcados com `data-documento`.
Documento novo é um atributo no HTML, não mais uma linha de JavaScript que
alguém esquece.

**O que NÃO mudou:** o controle continua sendo `podeGerar` na rota do PDF.
Esconder botão não é permissão — é o painel parar de prometer o que o servidor
nega.

**Lista ausente não esconde nada.** Quem entra por "Entrar só neste aparelho",
ou num painel ligado a servidor ainda não atualizado, continua vendo tudo como
antes. Esconder por falta de informação tiraria da Logística um relatório que
ela sempre teve — e quem decide é o servidor, de qualquer forma.

**Como reconhecer a família, se voltar:** setor novo + botão que aparece +
403 na primeira vez que alguém clica. Antes de acrescentar o setor na tabela,
pergunte se o botão tem `data-documento` — se não tiver, a próxima ocorrência
já está escrita.

**O que trava:** `testes/test_botao_de_relatorio_por_setor.py` (17 conferências,
8 reprovam contra o publicado) e o bloco 46 de `backend/testes/api.test.js`
(6 testes, 4 reprovam contra o publicado), incluindo a prova de que a lista
sai de `SETORES_FILIAL` — filial nova entra sozinha, sem ninguém lembrar.
