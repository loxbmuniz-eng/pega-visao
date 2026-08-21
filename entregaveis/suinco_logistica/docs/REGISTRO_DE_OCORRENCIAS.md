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
