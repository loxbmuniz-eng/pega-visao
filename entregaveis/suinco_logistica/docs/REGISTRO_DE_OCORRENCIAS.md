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
| **Trava sem o par na tela** | O servidor passa a exigir algo novo e a tela continua com o botão antigo: quem clica só descobre que não pode, e não tem por onde seguir. | #13 |
| **A mesma decisão escrita em dois lugares** | A regra é copiada em vez de consultada. As cópias divergem e o comportamento fica errado sem que nenhuma linha esteja errada. | #14, #26 |
| **Duas escritas em voo, a velha ganha** | O painel manda a carga INTEIRA a cada alteração. Duas alterações seguidas viram duas requisições simultâneas, e a primeira carrega o valor velho do campo que ainda ia mudar. | #16 |
| **A correção que outro setor desfaz sem saber** | Um setor corrige de propósito o que outro fez. A tela do segundo continua mostrando o estado como se nada tivesse sido decidido, e o gesto normal dele desfaz a correção — em silêncio, dos dois lados. | #21 |
| **A proteção escrita para um posto só** | A regra certa existe, com comentário e tudo — mas vale para um caminho e não para os irmãos dele. Não é cópia divergente: é a cópia que nunca foi escrita. | #20 |
| **A tela não oferece o que o servidor aceita** | A rota grava o campo, mas a coluna correspondente é texto. Quem precisa registrar o dado escreve no primeiro campo que aceita digitação — e ele vai parar onde ninguém procura. | #19 |
| **Dois filtros para a mesma tela** | Duas filtragens paralelas sobre os mesmos dados. Uma move os números, a outra move os gráficos, e nada avisa que discordam. | #18 |
| **O teste que carimba a leitura errada do pedido** | O teste está novo e verde, e mede exatamente o que foi escrito — só que o pedido foi entendido ao contrário. Verde prova que o código faz o que o teste diz, não que a regra está certa. Mudança que REMOVE algo da tela precisa do teste que garante que o trabalho de quem usava aquilo ainda é possível. | #23 |
| **Dois fatos com prazos diferentes tratados como um só** | Cada dado está certo no seu lugar; o defeito nasce de perguntar a um deles algo que só o outro sabe (`DB.operador` no localStorage vive para sempre; o token no sessionStorage morre com a aba). Reconhece-se assim: o mesmo relato volta com roupa nova depois de cada correção. Corrigir no nível do sintoma nunca fecha. | #25 |
| **Teste que mede o proxy, não a regra** | O teste confere um sintoma fácil de medir ("a aba aparece?", "quantas linhas?") em vez da garantia real, ou monta um cenário que deixou de corresponder ao sistema. Quando o sintoma muda por um motivo legítimo, ele fica vermelho sem que nada tenha quebrado — e aponta para o lugar errado. | #15, #22 |

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
