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
| **Duas escritas em voo, a velha ganha** | O painel manda a carga INTEIRA a cada alteração. Duas alterações seguidas viram duas requisições simultâneas, e a primeira carrega o valor velho do campo que ainda ia mudar. | #16 |
| **A correção que outro setor desfaz sem saber** | Um setor corrige de propósito o que outro fez. A tela do segundo continua mostrando o estado como se nada tivesse sido decidido, e o gesto normal dele desfaz a correção — em silêncio, dos dois lados. | #21 |
| **A proteção escrita para um posto só** | A regra certa existe, com comentário e tudo — mas vale para um caminho e não para os irmãos dele. Não é cópia divergente: é a cópia que nunca foi escrita. | #20 |
| **A tela não oferece o que o servidor aceita** | A rota grava o campo, mas a coluna correspondente é texto. Quem precisa registrar o dado escreve no primeiro campo que aceita digitação — e ele vai parar onde ninguém procura. | #19 |
| **Dois filtros para a mesma tela** | Duas filtragens paralelas sobre os mesmos dados. Uma move os números, a outra move os gráficos, e nada avisa que discordam. | #18 |
| **O teste que carimba a leitura errada do pedido** | O teste está novo e verde, e mede exatamente o que foi escrito — só que o pedido foi entendido ao contrário. Verde prova que o código faz o que o teste diz, não que a regra está certa. Mudança que REMOVE algo da tela precisa do teste que garante que o trabalho de quem usava aquilo ainda é possível. | #23 |
| **Dois fatos com prazos diferentes tratados como um só** | Cada dado está certo no seu lugar; o defeito nasce de perguntar a um deles algo que só o outro sabe (`DB.operador` no localStorage vive para sempre; o token no sessionStorage morre com a aba). Reconhece-se assim: o mesmo relato volta com roupa nova depois de cada correção. Corrigir no nível do sintoma nunca fecha. | #25 |
| **Teste que mede o proxy, não a regra** | O teste confere um sintoma fácil de medir ("a aba aparece?", "quantas linhas?") em vez da garantia real, ou monta um cenário que deixou de corresponder ao sistema. Quando o sintoma muda por um motivo legítimo, ele fica vermelho sem que nada tenha quebrado — e aponta para o lugar errado. | #15, #22 |

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
