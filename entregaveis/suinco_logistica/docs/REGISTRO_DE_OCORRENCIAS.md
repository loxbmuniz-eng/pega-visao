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
| **A mesma decisão escrita em dois lugares** | A regra é copiada em vez de consultada. As cópias divergem e o comportamento fica errado sem que nenhuma linha esteja errada. | #14 |
| **Teste que mede o proxy, não a regra** | O teste confere um sintoma fácil de medir ("a aba aparece?", "quantas linhas?") em vez da garantia real. Quando o sintoma muda por um motivo legítimo, ele fica vermelho sem que nada tenha quebrado — e some do radar. | #15 |

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
6. **Trava no servidor sem caminho na tela é bug, não segurança.** A de #13
   estava tecnicamente correta e deixou um administrador sem saída. Regra
   nova só está pronta quando existe o jeito de cumpri-la.
7. **A mesma decisão em dois lugares vira dois comportamentos.** Em #14 nenhuma
   linha estava errada; erradas estavam as três cópias da mesma lista. Quando
   uma regra precisa valer em CSS e em JS, ela mora em um dos dois e o outro
   pergunta.
8. **Teste vermelho tem três causas, não uma.** Antes de "eu quebrei",
   checar: a regra mudou de propósito (e o teste ficou para trás), o teste
   mede um proxy que mudou de forma, ou é sobra do teste anterior. Em #15 as
   três apareceram, e só uma linha de 19 era regressão de verdade. Rodar o
   caso isolado e também contra o build que está em produção responde isso
   em minutos.
9. **Intuição de layout erra; a régua não.** Duas mudanças "obviamente
   melhores" de #14 pioraram o número, e só apareceram porque foram medidas
   antes e depois, no mesmo aparelho e com os mesmos dados — sem isso, a
   comparação mede o banco de teste, não a mudança.
