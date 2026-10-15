# Vibe Trading — bancada de prova

Ferramentas para **medir uma estratégia de trading antes de arriscar dinheiro nela**.
Nada aqui negocia, pede chave de API, acessa conta ou envia ordem.

Não toca no painel de logística Suinco. É projeto separado, na mesma árvore.

---

## O que tem aqui

| Arquivo | O que faz |
|---|---|
| `vibe.py` | **Um comando só para tudo**: `python3 vibe.py` mostra o menu (analisar, radar, fichas, fontes, bateria, histórico, vigia, placar, Telegram, arena, monitor, testes) |
| `ficha.py` | **A ficha de cada operação** (`/analisar` no Telegram): estrutura em 3 períodos, níveis, stop, alvos, tamanho pelo risco, liquidação, funding, agenda e o veredito com cada motivo; placar das fichas |
| `fatores.py` | As fontes públicas da ficha: regras da moeda, tabela de risco, marca e funding da Pionex; posições abertas e lotação da Binance; medo e ganância; DVOL; agenda do Fed e da BLS |
| `servidor/instalar_vps.sh` | Põe o vigia 24 horas num VPS, ao lado de outro sistema, sem encostar nele; atualização diária só com a bateria verde |
| `backtest.py` | Puxa candles públicos e simula com taxa, stop, margem de manutenção e liquidação |
| `vigia.py` | Fase 2: opera no papel, ao vivo, 24 horas, com a mesma regra do backtest; placar contra 20 moedas; diário; alerta no Telegram |
| `alertas.py` | Alertas de mercado do vigia: movimento brusco, topo e fundo da semana passada, mudança de faixa (só avisam) |
| `livro.py` | Lê o livro de ofertas de Pionex, Binance e Hyperliquid e grava o desequilíbrio perto do preço, a cada candle (só gravação, para medir) |
| `arena.py` | A Qwen e o Claude como competidores dentro do vigia, no papel, com as mesmas regras de saída e as mesmas moedas (desligada até você ligar) |
| `bateria.py` | Fase 1: todas as estratégias em vários ativos e períodos contra a moeda; `--historico` faz o histórico inteiro ano a ano; registra tudo no caderno de experimentos (`caderno.jsonl`) |
| `estrategias.py` | Os sinais de entrada: montagens de mesa, SMC, confluência e 2 controles cegos |
| `indicadores.py` | EMA, SMA, RSI, ATR, VWAP, desvio, ruído mediano, perfil de volume |
| `monitor.html` | **Monitor em tempo real.** Abre no navegador, lê a Binance pública, mostra as 5 confirmações nos 5 períodos e alerta no fechamento do candle |
| `testes/test_motor.py` | Guardas: vazamento de futuro, posição sobreposta, paridade Python × monitor, gatilho obrigatório, busca de candles, padrões e alinhamento, placar, bateria, replay do vigia, arena com IAs simuladas |
| `testes/test_monitor_navegador.js` | Abre o monitor num Chromium com a Binance simulada e prova que carrega, calcula e alerta |

Mais a calculadora de risco interativa (página separada): **Banda de Liquidação**.

---

## Rodando

Só biblioteca padrão do Python 3. Nenhuma dependência para instalar.
(A única exceção é opcional: o Claude na arena usa o pacote oficial da
Anthropic, instalado numa pasta separada; veja "Arena".)
Precisa de internet aberta (endpoint público de candles): rode na sua máquina.

**Primeira vez** (baixa o projeto para a pasta pessoal):

```bash
cd ~
git clone --depth 1 -b claude/vibe-trading-project-psmj6o https://github.com/loxbmuniz-eng/pega-visao.git
cd ~/pega-visao/vibe_trading
```

**Das próximas vezes** (atualiza o que já foi baixado):

```bash
cd ~/pega-visao && git pull && cd vibe_trading
```

O script pede **90 dias** por padrão e nunca menos de 500 candles por período
(a EMA 200 precisa aquecer). Ele pagina de 1.000 em 1.000, que é o máximo que a
Binance entrega por pedido, e descarta o candle que ainda está aberto. Cada
período mostra quantos candles usou e de que data a que data.

```bash
python3 backtest.py --listar          # ver as estratégias
python3 backtest.py --ruido           # medir o ruído real do ativo
python3 backtest.py --comparar        # TODAS as estratégias contra o controle
python3 bateria.py                    # FASE 1: tudo de uma vez (BTC, ETH, SOL x 15m, 1h, 4h)
python3 bateria.py --historico        # todo o historico de cada par, ano a ano (4h e 24h)
python3 backtest.py --robustez --estrategia confl4 --alav 24   # vantagem ou sorte?
python3 backtest.py --robustez --estrategia confl3 --por-ano --dias 3000 --periodos 4h
python3 backtest.py --robustez --estrategia engolfo --lado compra   # só long
python3 backtest.py --robustez --estrategia confl3 --alinhar       # só a favor dos períodos acima
python3 bateria.py --saida surfe      # a mesma bateria, saindo metade no alvo e surfando o resto
python3 testes/test_motor.py          # guardas do motor
node testes/test_monitor_navegador.js # monitor num navegador real, Binance simulada
python3 backtest.py --estrategia ema --alav 24 --stop 0.5
python3 backtest.py --par ETHUSDT --dias 60 --comparar
```

Tudo isso também sai de um comando só: `python3 vibe.py` mostra o menu
(`bateria`, `historico`, `vigia`, `placar`, `telegram`, `arena`, `monitor`,
`backtest`, `testes`).

**Comece pelo `--ruido`.** Ele mede a oscilação normal do ativo no seu período.
Esse número decide se o seu stop é executável, e vai direto no campo "ruído
típico" da Banda de Liquidação. Sem ele você está chutando.

---

## Ficha de cada operação: `/analisar`

A leitura completa de **uma moeda, agora, antes do clique**. No Telegram:

```
/analisar BTC              risco 2% da banca, intraday (até 1 dia)
/analisar SOL 1 scalp      risco 1%, scalp (minutos a 3 horas)
/analisar ETH 3 swing      risco 3%, swing (1 dia a 1 semana)
/radar                     as moedas que mais oscilam agora na Pionex (com volume)
/fichas                    o placar das fichas
```

No computador: `python3 vibe.py analisar BTC 2 swing`, `python3 vibe.py radar`,
`python3 vibe.py fichas`.

**A banca.** A ficha calcula o risco sobre a banca do `vigia.json` (o padrão é
110) mais os resultados anotados com `/resultado`. Ponha o saldo real da conta
de futuros: `python3 vibe.py banca 100`. Mudar a banca não zera o placar do
vigia (ela não muda nenhuma operação de papel).

| Horizonte | Entrada | Contexto | Maior | Prazo |
|---|---|---|---|---|
| scalp | 5m | 15m | 1h | até 3 horas |
| intraday | 15m | 1h | 4h | até 1 dia |
| swing | 1h | 4h | 1d | até 1 semana |

O que a ficha faz, nesta ordem:

1. **Direção.** O contexto e o período maior precisam concordar pela estrutura
   (topos e fundos). Se discordam, ESPERAR, e a ficha diz o que faria comprar
   ("o 4h fechar acima de X") e o que faria vender.
2. **Onde está o preço.** Na perna do último impulso do contexto: na compra, do
   ponto mais baixo entre os dois últimos topos confirmados até o último topo (na
   venda, o espelho). Ela só muda quando a estrutura faz um extremo novo; um fundo
   mais alto no meio do recuo não a encolhe. Compra só no desconto (0 a 50% da
   perna), venda só no prêmio (50 a 100%). Fora disso, ESPERAR, com a **zona
   ótima** (62% a 79% da perna) para ordem limitada. Preço além da origem do
   impulso não é desconto: é estrutura em dúvida, ESPERAR.
3. **Níveis.** Topo e fundo de ontem e da semana passada (segunda a domingo, UTC),
   abertura do dia, VWAP do dia, perfil de volume (POC e área de valor de 7 dias,
   POC de ontem), vãos e blocos de ordens ainda não tocados, topo e fundo da
   estrutura, número redondo. Níveis a menos de 1/4 de ATR um do outro viram
   uma confluência só.
4. **Stop.** Um quarto de ATR além do último fundo (ou topo) do período de
   entrada, e nunca a menos de 1 ATR (mais perto, o ruído normal bate nele).
5. **Alvos.** Só em nível **forte** para o horizonte, a mais de meio ATR, um
   décimo de ATR **antes** do nível (quem espera sair no nível enche a fila
   nele). Os níveis fracos no meio do caminho aparecem com a distância em
   múltiplos do risco. Se o 1º alvo paga menos de 1,5 vez o risco, já com as
   taxas: **espaço curto**, ESPERAR.
6. **Tamanho pelo risco que você escolheu.** Perder no stop exatamente o risco
   pedido (taxa nas duas pontas e deslizamento incluídos). A alavancagem é a
   maior que deixa a **liquidação a pelo menos 2 vezes a distância do stop**,
   com a margem de manutenção da **tabela de risco da Pionex** para aquele
   tamanho. A quantidade respeita o passo da corretora, sempre para baixo:
   nunca arrisca mais que o pedido. Abaixo do pedido mínimo, NÃO OPERAR, e a
   ficha diz qual o menor risco possível.
7. **Projeção em USDT.** Perda no stop, lucro no alvo 1, "alvo + surfe"
   (metade no 1º alvo, stop no zero, o resto no 2º), acerto mínimo para
   empatar, funding no prazo do horizonte.
8. **Contexto, que mostra e não decide.** Funding, posições abertas e lotação
   na Binance, livro de ofertas, medo e ganância, DVOL, Ichimoku do contexto,
   agenda e o regime macro do FRED (juros de 10 anos, dólar amplo e VIX, cada
   um com a data do dado: o FRED publica com atraso).
9. **Agenda.** CPI, payroll ou decisão do Fed nos próximos 30 minutos (ou nos
   últimos 15): ESPERAR no scalp e no intraday; no swing, só aviso.
   O Fed vem de uma tabela com a fonte. A BLS (CPI, payroll, PPI) recusa
   leitura automática do calendário dela (403, visto no primeiro teste real):
   a ficha tenta o calendário e, se for recusada, usa a tabela de datas
   conferidas nas páginas da própria BLS até 15/12/2026. Depois dessa data a
   ficha avisa que a tabela venceu.

| Veredito | Quando |
|---|---|
| **A FAVOR** | direção, lado da perna, espaço e agenda certos |
| **ESPERAR** | qualquer um deles falta; a ficha diz o que esperar |
| **NÃO OPERAR** | moeda inexistente ou parada, dado velho, risco fora de 0–25%, pedido abaixo do mínimo |

Cada fonte que não responde aparece em **FORA DO AR**, nunca em silêncio e
nunca com valor inventado. `python3 vibe.py fontes` chama cada fonte uma vez e
mostra o que veio: rode na sua máquina antes de confiar na ficha.

> **As regras da ficha ainda não têm prova.** São leitura de mesa escrita como
> regra exata. Por isso toda ficha com plano fica registrada e é conferida
> depois, candle a candle, pela mesma regra do backtest (stop e alvo no mesmo
> candle conta stop). O `/fichas` separa **A FAVOR** de **ESPERAR (se tivesse
> entrado)**: se o veredito vale alguma coisa, A FAVOR ganha. Antes de 100
> fichas A FAVOR conferidas, é hipótese.

### Bateria da ficha: a regra dela no histórico

`python3 vibe.py bateria-ficha` chama a própria ficha em cada candle fechado do
histórico (BTC, ETH e SOL, 90 dias, scalp, intraday e swing), só com o que
existia naquele instante. Mede três modelos contra 30 moedas sorteadas (mesmos
candles, mesmas distâncias de stop e alvo, lado sorteado):

| Modelo | Entra quando | Alvo |
|---|---|---|
| A FAVOR | o veredito da ficha é A FAVOR | o nível forte mais próximo |
| ALVO NA PERNA | a mesma entrada (maior, contexto e entrada alinhados, lado certo da perna) | o extremo da perna: a liquidez do topo ou fundo anterior |
| GATILHO | o mesmo, só no candle em que o período de entrada quebra a estrutura a favor | o extremo da perna |

Cada modelo é uma hipótese no caderno (conta na prova contra sorte). Passa com
vantagem em 2 dos 3 ativos e 95% de chance de não ser sorte. Também mostra
"ESPERAR (se tivesse entrado)" e por que a ficha mandou esperar.

> **Correção registrada (perna que encolhia).** Ao medir a ficha no histórico,
> o "lado certo da perna" aparecia em só 9% das leituras, e quando o período de
> entrada virava a favor o preço estava quase sempre no topo da perna. A perna
> ia do último fundo confirmado até a máxima desde ele: um fundo mais alto
> confirmado no recuo recomeçava a perna, e o preço sempre parecia no topo. Agora
> ela é o impulso inteiro, e preço além da origem do impulso é estrutura em
> dúvida. Guardas: o recuo com fundo mais alto (perna 99,7–120,3, preço a 40%)
> e o preço abaixo da origem (ESPERAR, não desconto).

> **Correção registrada (gap do CME).** O "gap do CME" estava aprovado, mas a
> CME passou a negociar cripto 24 horas por dia, 7 dias por semana, em
> 29/05/2026: gap novo de fim de semana não se forma mais. Os gaps antigos
> pedem o preço do futuro da CME, que não é grátis, e os números que circulam
> em notícia não batem entre si. Não entrou; nada foi inventado no lugar.

## As estratégias

| Nome | O que é |
|---|---|
| `moeda` | **CONTROLE**: direção sorteada, valor preditivo zero |
| `comprado` | **CONTROLE**: comprado sempre, mede só a tendência da janela |
| `ema` | cruzamento de EMA 9/21 |
| `canal` | rompimento de canal de 20 barras (Donchian) |
| `momento` | continuação de momento filtrada por ATR |
| `rsi` | reversão por RSI 14 (30/70) |
| `bollinger` | reversão na banda de Bollinger 20/2 |
| `vwap` | reversão à VWAP de 20 barras |
| `confl3` / `confl4` / `confl5` | **confluência**: 3, 4 ou 5 de 5 confirmações |
| `engolfo` | **padrão**: engolfo de alta e de baixa |
| `divergencia` | **padrão**: divergência entre preço e RSI 14 |
| `confl3_fluxo` / `canal_fluxo` | **fluxo**: a `confl3` ou o `canal`, só quando a agressão dos últimos 3 candles vai a favor |
| `cacada` | **mesa**: caça de stops: o pavio passa da máxima/mínima de 20 candles e fecha de volta para dentro, na cor contrária; entra contra o falso rompimento |
| `reteste` | **mesa**: rompimento com reteste: rompe o canal, volta ao nível rompido em até 10 candles, toca e segura; um sinal por rompimento |
| `compressao` | **mesa**: compressão e expansão: a Bollinger fica a mais estreita de 100 candles e abaixo de 60% da mediana; o rompimento seguinte dá a direção |
| `sessao` | **mesa**: a `confl3` só com Londres e Nova York abertas juntas (12h–17h UTC, segunda a sexta) |
| `vwap_dia` | **mesa**: preço médio do dia (desde 00:00 UTC): toca a VWAP e fecha do lado de quem já estava ganhando o dia |
| `bos` / `choch` | **SMC**: quebra de estrutura a favor da tendência / primeira quebra contra (mudança de caráter) |
| `fvg` / `ob` | **SMC**: volta ao vão de valor justo / ao bloco de ordens e segura |
| `smc` | **SMC**: bloco de ordens a favor da estrutura, só no desconto (compra) ou no prêmio (venda) |
| `ichimoku` | **Ichimoku**: tenkan cruza o kijun, com o fechamento fora da nuvem e acima (ou abaixo) do fechamento de 26 barras atrás; a nuvem do candle é a calculada 26 barras antes, sem olhar o futuro |
| `spring` | **Wyckoff**: numa faixa lateral de 40 candles, a mínima fura o fundo e o candle fecha de volta dentro, de alta (o espelho é o upthrust). Raro por natureza: poucas operações por trimestre |

A confluência é o checklist do scalper disciplinado, com o porquê de cada item
no código (`estrategias.py`). Os dois primeiros são **obrigatórios**: a
tendência escolhe o lado, o gatilho é o momento. Os outros três são filtros.

1. **Tendência** (obrigatória): EMA 50 acima da 200 só compra; abaixo, só vende.
2. **Gatilho** (obrigatório): fechamento rompe a máxima/mínima das últimas 20 barras.
3. **Não esticado**: RSI ainda longe do extremo do movimento.
4. **Volatilidade**: ATR acima de um piso. Mercado parado não paga a taxa.
5. **Volume**: candle com volume acima da própria média.

`confl3` = tendência + gatilho + 1 filtro · `confl4` = + 2 filtros · `confl5` = tudo.

**Fluxo agressor.** Cada candle da Binance diz quanto do volume foi compra
**agressora**: quem comprou batendo na oferta de venda, sem esperar. O resto é
venda agressora. O saldo, de −1 (só venda agressora) a +1 (só compra), é a
leitura de fluxo que plataformas como o Bookmap mostram, e aqui ela existe no
**histórico inteiro**, então dá para testar contra a moeda como qualquer outra
estratégia. As duas de fluxo só entram quando a média do saldo nos últimos 3
candles vai a favor do lado. A Pionex não informa essa coluna: sem ela, essas
estratégias não dão sinal nenhum (não se inventa o dado), e o vigia ainda não
as aceita. Se passarem na bateria, o vigia ganha a coluna.

---

## Padrões e filtros sob demanda

**Engolfo.** O corpo do candle engole o corpo do anterior, de cor oposta.
Decide no fechamento, usando só os dois candles.

**Divergência de RSI.** O preço faz fundo mais baixo e o RSI faz fundo mais alto
(alta), ou o contrário no topo (baixa). Um fundo só é fundo depois que o preço
sobe nos 3 candles seguintes. Então o sinal sai **3 candles depois do fundo**, no
candle que confirma. Marcar o sinal no próprio fundo é o vazamento de futuro mais
comum em backtest de padrão: daria para "comprar no fundo exato".

**Filtro de lado** (`--lado compra|venda|ambos`, e "Procurar" no monitor). Deixa
só long, só short, ou os dois. Vale para qualquer estratégia.

**Alinhamento** (`--alinhar`, e a caixa "Só na direção dos 2 períodos acima" no
monitor). Só deixa o sinal se os dois períodos acima estiverem na mesma direção
(EMA 50 contra EMA 200): 15 min olha 1 h e 4 h, 1 h olha 4 h e 12 h, 4 h olha 12 h e
24 h, 12 h olha 24 h. No 24 h não há período acima e o alinhamento não se aplica.

Regra conservadora: o candle maior só vale se **fechou até a abertura** do candle
menor. O 15 min das 9:45 usa o 1 h das 8:00, e não o das 9:00, que fecha junto com
ele. Assim o monitor não depende de qual mensagem chegou primeiro da Binance, e
o backtest decide igual. No backtest, os períodos acima são montados a partir dos
candles menores pela fronteira de relógio em UTC, como a Binance faz. Hora
incompleta, seja no começo da série ou por candle faltando, é descartada.

### Resultado em série sintética (24x, 30 moedas pareadas, 6 janelas)

| Série | Estratégia | Janelas positivas | Bateu, em média | Veredito |
|---|---|---|---|---|
| ruído puro | `engolfo` | 0 de 6 | 54% | sem vantagem |
| ruído puro | `divergencia` | 0 de 6 | 48% | sem vantagem |
| com tendência | `engolfo` | **5 de 6** | **77%** | sinal de vantagem |
| com tendência | `divergencia` | 3 de 6 | 42% | sem vantagem |
| com tendência | `confl3` sem alinhamento | 6 de 6 | 91% | sinal de vantagem |
| com tendência | `confl3` **com** alinhamento | 3 de 6 | 47% | sem vantagem |

A divergência perde na série com tendência porque é padrão de reversão: aposta
contra o movimento. **O alinhamento piorou a confluência** nesta série: a
tendência simulada dura horas, e a EMA do 4 h só enxerga dias, então o filtro
cortou as entradas boas. No dado real pode ser diferente. O que a tabela mostra é
que filtro a mais não é automaticamente melhor. Por isso o alinhamento vem
desligado no monitor, e só deve ser ligado se o `--robustez` com dado real
mostrar que ajuda.

---

## Três garantias do motor, todas testadas

**1. Nenhuma estratégia olha o futuro.** O sinal do candle `i` só usa dados até
`i`. Verificado de dois jeitos. Primeiro, cortes fixos: sinais gerados na série
inteira e na série cortada têm de ser idênticos antes do corte. Segundo, o corte
logo **depois de cada sinal**: o sinal do candle `i` tem de existir com a série
terminando em `i`. O segundo jeito entrou porque o primeiro deixou passar uma
mutação de propósito (divergência marcando o sinal no fundo em vez da
confirmação). Com sinal raro, quase nunca há sinal colado num corte fixo. As
doze estratégias passam nos dois, também com os filtros ligados.

**1b. O monitor decide igual ao backtest.** A confluência existe em Python e em
JavaScript. O teste de paridade compara as duas candle a candle, e os
indicadores bit a bit, em série com e sem tendência: zero divergências. Mudar o
limite do RSI de 70 para 71 só no monitor faz o teste reprovar.

**2. Uma posição de cada vez.** A próxima entrada só acontece depois do candle
em que a anterior fechou. Verificado com uma guarda que registra entrada e saída
de cada posição: zero entradas antes da saída anterior.

**3. O erro de modelagem cai contra a estratégia.** Stop e alvo no mesmo candle
contam como **stop**. OHLC não revela a ordem dentro da barra. A regra de saída
(stop, alvo, empate, liquidação, prazo, taxa nas duas pontas) é conferida
contra a conta feita à mão, em compra e em venda.

> **Correção registrada (guarda da regra de saída).** Backtest e vigia usam a
> mesma função de saída, então a guarda de paridade entre os dois não enxerga
> um erro *dentro* dela. Uma sabotagem de propósito, invertendo compra e venda
> no stop, passou por todas as guardas de paridade; só caiu por acaso numa
> outra checagem. Agora uma guarda própria confere a regra contra valores
> calculados à mão, e cinco sabotagens diferentes (lado invertido, empate
> contando alvo, taxa numa ponta só, liquidação ignorada, alvo errado)
> reprovam.

> **Correção registrada (garantia 2).** A primeira versão do simulador avançava
> um candle a partir da *entrada*, não da *saída*, e abria posição nova com a
> anterior ainda aberta. Isso empilhava risco na mesma direção sem aviso. Foi
> pego quando a confluência perdeu 77% a 88% numa série em que a moeda ficava
> perto do zero, uma distorção grande demais para ser da estratégia. Os números
> abaixo já são do motor corrigido.

> **Correção registrada (confluência).** A primeira versão não exigia o gatilho.
> Tendência, RSI, ATR e volume são verdade quase sempre ao mesmo tempo, então
> bastavam para 4/5 e o sinal ficava ligado em ~44% dos candles: 832 dos 920
> sinais da `confl4` não tinham rompimento nenhum. Apareceu no gráfico do
> monitor, com uma fileira de compras durante uma queda inteira. Agora o gatilho
> é obrigatório e uma guarda garante que nenhum sinal sai sem rompimento.

---

## Resultado da verificação

Série sintética de 900 candles, *random walk sem tendência*, semente fixa.
Nessa série **não existe vantagem para encontrar**: é ruído puro.

### A 100x (liquidação em 0,50%, exatamente onde está o stop de 0,50%)

| Estratégia | Trades | Liquidações | Taxa paga | Banca: 110 → |
|---|---|---|---|---|
| `moeda` | 24 | 8 | 36,00 | 44,57 |
| `comprado` | 23 | 8 | 34,50 | 32,98 |
| `ema` | 14 | 4 | 21,00 | 99,93 |
| `canal` | 18 | 5 | 27,00 | 63,03 |
| `momento` | 18 | 4 | 27,00 | 55,80 |
| `rsi` | 11 | 4 | 16,50 | 67,77 |
| `bollinger` | 17 | 5 | 25,50 | 20,60 |
| `vwap` | 14 | 5 | 21,00 | 48,74 |
| `confl3` | 9 | 4 | 13,50 | 53,82 |
| `confl4` | 9 | 4 | 13,50 | 53,67 |
| `confl5` | 3 | 1 | 4,50 | 108,16 |

**Nenhuma das onze terminou no positivo.** A pior perdeu 81%. O stop nunca
executa, porque a liquidação chega no mesmo ponto: de 1 a 8 operações por
estratégia morreram liquidadas.

### A 24x (liquidação em 3,67%, folga de 3,17% depois do stop)

| Estratégia | Trades | Liquidações | Taxa paga | Banca: 110 → |
|---|---|---|---|---|
| `moeda` | 24 | **0** | 8,64 | 105,82 |
| `comprado` | 23 | 0 | 8,28 | 103,04 |
| `ema` | 14 | 0 | 5,04 | 113,34 |
| `canal` | 18 | 0 | 6,48 | 105,93 |
| `momento` | 18 | 0 | 6,48 | 102,75 |
| `rsi` | 11 | 0 | 3,96 | 105,62 |
| `bollinger` | 17 | 0 | 6,12 | 95,74 |
| `vwap` | 14 | 0 | 5,04 | 102,50 |
| `confl3` | 9 | 0 | 3,24 | 102,28 |
| `confl4` | 9 | 0 | 3,24 | 102,24 |
| `confl5` | 3 | 0 | 1,08 | 111,00 |

**As liquidações foram a zero em todas.** Mesmas entradas, mesma série, mesmo
stop. Só a alavancagem mudou.

A `ema` terminou em +3%. **Isso é sorte, não vantagem**: a série é aleatória por
construção e não há nada para prever. Uma rodada só não prova nada. Por isso
existe o teste de robustez.

---

## Saída: alvo inteiro ou alvo + surfe

`--saida alvo` (o padrão) sai inteira no alvo. `--saida surfe` sai **metade no
alvo**; o stop do resto vai para a entrada e passa a seguir o preço à mesma
distância do stop original, puxado pelo melhor preço até o candle anterior. O
resto sai quando o preço volta até ele, ou a mercado no fim do prazo.

As suposições caem contra a estratégia, como no resto do motor:

- alvo e stop original no mesmo candle: conta **stop** (a posição inteira);
- alvo e volta à entrada no mesmo candle: a metade que ficou sai **no zero**;
- o stop puxado é conferido **antes** de o candle mover o pico.

É a mesma `checar_barra` no backtest e no vigia (guarda [30]: as mesmas
operações nos dois, inclusive com o vigia desligado e religado no meio de um
surfe). No caderno, surfe é **outra hipótese** e entra na conta da prova contra
sorte. No vigia, vale com `"saida": "surfe"` em `"params"`; trocar recomeça o
placar (o anterior fica guardado).

## Custos: taxa, deslize e funding

Toda operação paga três custos, pela mesma regra no backtest, no vigia e na
ficha (`backtest.custos` e `backtest.custo_pct_ida_volta`):

| Custo | Como entra | Padrão |
|---|---|---|
| Taxa | nas duas pontas | 0,05% por lado (`--taxa`) |
| Deslize | em cada execução **a mercado**: a entrada, o stop, o prazo, o resto do surfe. O alvo é ordem limitada e não desliza | 0,02% (`--deslize`) |
| Funding | a cada cobrança (00h, 08h e 16h UTC) com a posição aberta, contada até o **fim** do candle de saída. Com a série real, o comprado paga a taxa positiva e o vendido recebe; sem a série, cobra 0,01% **dos dois lados** | 0,01% (`--funding`) |

Com deslize, o empate de stop 0,5% e alvo 1% sobe de 40% para **42,1%** de
acerto. Os custos entram no caderno: o mesmo teste com outro custo é outra
tentativa (rodar de novo com custo menor até passar conta contra a prova).
Testes sem custo mantêm a chave antiga. No vigia, um `vigia.json` antigo ganha
`"deslize"` e `"funding"` por escrito, e o placar sem custo vai para
`arquivadas` (guarda [35]).

> **Correção registrada (deslize da entrada).** A ficha cobrava o deslize só
> na saída pelo stop, mas o plano é "se entrar a mercado agora": a entrada
> também desliza. Agora o stop paga as duas pontas (custo 0,14% em vez de
> 0,12%) e o alvo paga a da entrada. O backtest não cobrava deslize nem
> funding nenhum. Guarda [35], com 15 defeitos plantados e pegos.

## O placar: acerto não basta

Toda saída mostra o **acerto** junto com o que decide se há lucro: **ganho
médio**, **perda média** e **resultado por operação**, todos depois da taxa das
duas pontas. A conta que liga os quatro:

```
resultado por operação = acerto × ganho médio − erro × perda média
```

Acerto alto com perda grande perde dinheiro: 80% de acerto, ganhando 1 e
perdendo 5, dá −0,20 por operação. Acerto baixo com ganho grande pode ganhar:
35%, ganhando 3 e perdendo 1, dá +0,40. Melhorar a assertividade, aqui, quer
dizer subir o resultado por operação e a vitória sobre a moeda, não só o acerto.
O `--robustez` mostra o acerto e o resultado por operação de cada janela e, no
fim, o placar de todas as operações.

---

## Prova contra sorte: o Sharpe deflacionado

Quanto mais estratégias se testa, maior o melhor resultado que aparece **só por
sorte**. Com 1.000 tentativas sem vantagem nenhuma, o melhor Sharpe esperado já
é de 3,26 desvios (Bailey e López de Prado, 2014). A bateria grava o Sharpe por
operação de cada tentativa no caderno e calcula, para cada estratégia, a
**chance de o resultado não ser sorte** dado o número de tentativas já feitas.
A coluna `nao-sorte` mostra essa chance.

**Passa na fase 1** só com as duas coisas: sinal de vantagem contra a moeda em
2 dos 3 ativos **e** 95% ou mais de chance de não ser sorte. Cada estratégia
nova testada torna a prova das outras mais difícil; é de propósito.

BTC, ETH e SOL andam juntos: as operações dos três não são somadas como se
fossem independentes. Cada ativo é provado com as próprias operações, e vale a
**pior** nota. Uma tentativa é tudo que muda o resultado (estratégia, período,
lado, filtro, alavancagem, stop, alvo, taxa, margem, prazo, janela de dados e
fonte), e o `--robustez` do backtest também registra no caderno.

## Robustez: vantagem ou sorte?

```bash
python3 backtest.py --robustez --estrategia confl4 --alav 24
```

Corta a série em 6 janelas e, em cada uma, compara a estratégia com **30 moedas
que entram nos mesmos candles que ela, com a mesma mistura de compras e vendas,
embaralhada entre esses candles**. A pergunta deixa de ser "ganhou?" e passa a
ser "ganhou de quantas moedas?". Empate vale meio.

> **Correção registrada (moeda e tendência).** A moeda sorteava meio a meio,
> mesmo quando a estratégia quase só comprava. Num mercado de alta, comprar
> quase sempre ganhava da moeda sem acertar nada. Agora a moeda usa a mesma
> mistura de lados: numa caminhada aleatória com alta forte, a estratégia "só
> compra" empata com a moeda (50%) e não ganha "vantagem" em nenhuma de 12
> rodadas.

O pareamento importa. Comparada com moedas que operam em todo candle, a `confl5`
parecia ganhar de 73% delas, mas só porque opera pouco e paga menos taxa. Com a
moeda pareada caiu para 47%. Era taxa economizada, não acerto de direção.

O teste foi validado nos dois sentidos, com a confluência corrigida:

| Série | Estratégia | Janelas positivas | Bateu, em média | Veredito |
|---|---|---|---|---|
| ruído puro (sem vantagem possível) | `confl3` | 0 de 6 | 48% das moedas | sem vantagem |
| ruído puro | `confl4` | 0 de 6 | 51% | sem vantagem |
| ruído puro | `confl5` | 0 de 6 | 47% | sem vantagem |
| **com tendência persistente embutida** | `confl3` | **6 de 6** | **91%** | **sinal de vantagem** |
| com tendência persistente | `confl4` | 5 de 6 | 79% | sinal de vantagem |
| com tendência persistente | `confl5` | 4 de 6 | 61% | inconclusivo (opera pouco demais) |

Em ruído puro a confluência empata com a moeda: ela não inventa vantagem onde
não existe. Na série com tendência persistente ela captura a tendência e o teste
diz isso. As duas metades juntas são o que dá confiança no teste.

**A pergunta que sobra só o dado real responde:** o ativo, no período que você
opera, tem tendência persistente o bastante para isso aparecer? Rode o
`--robustez` com dado real antes de qualquer conclusão.

> Tudo isso é série sintética com semente fixa. Valida o **motor**, não o
> mercado. Para o número real, rode com rede aberta.

---

## Vigia (fase 2): papel ao vivo, 24 horas

```bash
cd ~/pega-visao/vibe_trading
caffeinate -i python3 vigia.py      # roda sem parar; caffeinate impede o Mac de dormir
python3 vigia.py --placar           # em outra janela do Terminal, a qualquer hora
```

A cada candle fechado, o vigia roda as estratégias do `vigia.json` (padrão:
`confl3` e `engolfo`, BTCUSDT, 15 min) e abre e fecha operações **de papel**. Ao
lado de cada estratégia rodam 20 moedas pareadas, que entram nos mesmos candles
com o lado sorteado. Toda operação fechada vai para `dados_vigia/diario.jsonl`.
Ele não envia ordem e não pede chave de corretora.

- **Mesma regra do backtest.** O teste de replay passa uma série candle a candle
  pelo vigia e exige que ele feche exatamente as mesmas operações que o backtest
  fecha. Se as regras divergissem, o placar ao vivo não provaria nada.
- **Desligou e religou?** Ele busca os candles que fecharam enquanto estava fora
  e processa na ordem. O teste confere: 30 candles de pausa, mesmo placar.
- **Primeira execução:** carrega um mês de histórico só para aquecer os
  indicadores, sem operar nele. As operações começam no candle seguinte.
- **Congelar:** durante a fase 2, não mexa no `vigia.json`. Mudou a estratégia,
  é outra hipótese e ganha trilha nova. Mudou stop, alvo, alavancagem, margem,
  taxa, fonte ou moedas: o placar inteiro recomeça do zero, e o anterior fica
  guardado em `arquivadas`, sem se misturar.
- **O placar** mostra, por estratégia: operações, acerto, ganho médio, perda
  média, resultado por operação, lucro, pior queda, de quantas moedas ganhou e
  a situação da fase 2.
- **O julgamento da fase 2** acontece **uma vez em cada ponto fixado antes**:
  100, 200 e 300 operações **ao vivo** (as fechadas com o vigia desligado não
  contam). Precisa de resultado positivo depois da taxa, vitória sobre 75% das
  moedas e a chance de não ser sorte, contando como tentativas todas as trilhas
  do vigia: **95% ou mais = APROVADA; 80% ou mais = PROMISSORA** (dinheiro real
  só com risco reduzido); abaixo disso, REPROVADA. Vale o julgamento mais
  recente. Todo alerta de entrada diz se a estratégia está EM TESTE,
  PROMISSORA ou REPROVADA, e traz o lucro no alvo e a perda no stop em USDT.

> **Correção registrada (julgamento da fase 2).** A primeira regra olhava o
> placar a cada operação, a partir de 30, e aprovava quando ficava positivo e
> acima de 75% das moedas. Medido em 150 estratégias de lado sorteado, sem
> vantagem nenhuma: **aprovava 15%**. Com a regra nova, aprovou **nenhuma**
> (nem como promissora), e uma estratégia com vantagem real modesta (50% de
> acerto onde 40% empata) é reconhecida em 49% das vezes com 100 operações, 80%
> com 200 e 93% com 300.
- **De onde vem o candle** (`"fonte"` no `vigia.json`): instalação nova usa o
  perpétuo da **Pionex** (`BTC_USDT_PERP`), o preço que dispara stop e
  liquidação na corretora onde se opera. Dado público, sem chave. Um
  `vigia.json` antigo continua na Binance: trocar a fonte no meio da fase 2
  seria outra hipótese. Cada fonte tem trilha e cache próprios
  (`BTCUSDT@pionex`), então candles de duas corretoras nunca se misturam.
- **Conferência** (`"conferir_com"`): a cada candle novo, o vigia compara o
  fechamento com a segunda fonte (padrão: Binance). Diferença acima de
  `"divergencia_max_pct"` (padrão 0,3%) vira aviso, no máximo um por hora.

### Alertas no Telegram (opcional)

1. No Telegram, procure **@BotFather**, mande `/newbot` e escolha um nome. Ele
   responde com um **token**.
2. Abra o arquivo `segredos.json` (criado na primeira execução) e cole o token
   em `"telegram_token"`.
3. Mande qualquer mensagem para o seu robô no Telegram.
4. Rode `python3 vigia.py --telegram-descobrir`. Copie o número que aparecer para
   `"telegram_chat_id"` no `segredos.json`.
5. Rode `python3 vigia.py --telegram-teste`. Se a mensagem chegar, está pronto.

O vigia avisa cada entrada (com stop, alvo e liquidação), cada saída e manda um
resumo por dia às 21 h. **Se o resumo não chegar, o vigia parou.**

O robô também responde, **só ao seu chat** (mensagem de qualquer outra pessoa
fica sem resposta):

| Comando | Resposta |
|---|---|
| `/placar` | o placar de cada estratégia e IA, agora |
| `/status` | último candle processado, posições abertas, conferência entre fontes e o **risco aberto somado** (se todas as posições batessem no stop juntas), contra o teto `"risco_total_max_pct"` (padrão 6% da banca) |
| `/analisar MOEDA [risco%] [scalp\|intraday\|swing]` | a ficha completa da operação (veja "Ficha de cada operação") |
| `/radar` | os perpétuos da Pionex que mais oscilaram em 24 h, só os com volume acima de 5 mi USDT |
| `/fichas` | o placar das fichas: A FAVOR contra ESPERAR, em múltiplos do risco |
| `/resultado -2,1` | anota o resultado em USDT de uma operação **real** já fechada (negativo = perda); avisa quando um disjuntor arma ou quando o risco muda |
| `/hoje` | o dia e a semana anotados, os dois disjuntores e o risco em uso |
| `/desempenho` | acerto, ganho e perda média, resultado por operação, fator de lucro, pior queda e maior sequência de perdas das operações **reais** |
| `/ajuda` | a lista de comandos |

O `segredos.json` fica só para o dono ler e nunca vai para o GitHub (está no
`.gitignore`). O resumo das 21 h traz também o placar das fichas, conferido na hora.

**Alertas de mercado** (no menor período do vigia, só avisam):

| Alerta | Quando |
|---|---|
| MOVIMENTO BRUSCO | a amplitude do candle passa de 3 vezes o normal (mediana dos 100 anteriores); no máximo 1 por hora |
| ROMPEU O TOPO / PERDEU O FUNDO DA SEMANA PASSADA | o fechamento atravessa o topo ou o fundo da semana anterior (segunda a domingo, UTC); uma vez por semana |
| MUDOU DE FAIXA | o fechamento atravessa um número redondo (1.000 no BTC); o mesmo nível no mesmo sentido, no máximo a cada 4 h |

Vigia voltando de uma pausa não manda alerta atrasado. Tudo ajustável em
`"alertas"` no `vigia.json`.

**Disjuntor do dia** (para a conta real). O sistema não vê a sua conta: você
anota cada operação fechada com `/resultado`. Com **3 perdas seguidas** no dia,
ou o dia em **−6% da banca**, o disjuntor arma: toda ficha até a meia-noite de
Brasília mostra a leitura inteira, mas sai **NÃO OPERAR**. É a regra que impede
a operação de vingança depois de uma sequência ruim. Ajuste em `"disjuntor"`.

**Gestão de risco da conta real** (também pelos `/resultado`, grupo `"risco"`
no `vigia.json`):

- **O risco cai sozinho quando a banca cai do pico.** Com a banca 10% abaixo
  do maior valor que ela já teve, a ficha usa **metade** do risco pedido; 20%
  abaixo, **um quarto**. Volta ao normal quando a banca volta a menos de 10%
  do pico. A ficha diz: "risco reduzido: pediu 2%, a ficha usa 1%". O pedido
  é conferido contra o teto **antes** de reduzir (pedir 30% continua recusado).
- **Disjuntor da semana.** A semana (segunda a domingo, Brasília) em **−10% da
  banca** e toda ficha até segunda sai NÃO OPERAR.
- O aviso de entrada do vigia (papel) diz quando algum disjuntor da conta real
  está armado, com a mesma regra da ficha (`vigia.gestao`, um lugar só).

Por que isso importa: `python3 vibe.py risco` sorteia 5.000 sequências de 100
operações e mostra o que cada risco por operação faz com a banca. Com alvo de
2x o risco (resultado de hoje, semente fixa):

| risco | sem vantagem (33% de acerto): chance de perder metade | banca final (mediana) | com vantagem (40%): chance de perder metade | banca final (mediana) |
|---|---|---|---|---|
| 1% | 0% | 98% | 0% | 121% |
| 2% | 2% | 94% | 0% | 143% |
| 5% | 65% (0% com o ajuste) | 75% | 24% (0% com o ajuste) | 209% (145% com o ajuste) |
| 10% | 99% (31% com o ajuste) | 35% | 91% (5% com o ajuste) | 264% (159% com o ajuste) |

Com 40% de acerto, **9 perdas seguidas** em 100 operações é o normal, não azar.
Risco profissional é 1–2% por operação; o ajuste custa um pouco do lucro quando
há vantagem e salva a banca quando não há. `python3 vibe.py risco 45 1,5` refaz
a tabela para outro acerto e outro alvo; `python3 vibe.py desempenho` mostra o
retrato das operações reais anotadas (vale a partir de 30).

### No VPS, 24 horas, ao lado do Embarque Suinco

O VPS é o mesmo do Embarque Suinco. **Só o servidor é compartilhado**: o vigia
tem usuário próprio (`vibe`), pasta própria (`/opt/vibe`), Python próprio e
serviço próprio (`vibe-vigia`), com teto de 30% de processador e 400 MB de
memória e prioridade baixa. Não abre porta e não mexe em Nginx, PostgreSQL,
firewall, certificados nem no serviço `embarque-suinco`.

```bash
curl -fsSL https://raw.githubusercontent.com/loxbmuniz-eng/pega-visao/claude/vibe-trading-project-psmj6o/vibe_trading/servidor/instalar_vps.sh -o /tmp/instalar_vibe.sh && sudo bash /tmp/instalar_vibe.sh
```

- **Antes de mexer**, o instalador tira um retrato do servidor (serviços da
  Suinco, portas abertas, firewall, configuração do Nginx). **No fim**, confere
  de novo e diz "igual a antes", ou mostra em vermelho o que mudou.
- O código vem do repositório privado `vibe-trading` por uma **chave só de
  leitura** que o instalador cria. A impressão digital do github.com é
  conferida contra a publicada pelo GitHub antes de confiar.
- Roda a **bateria inteira** antes de ligar. Reprovou, não liga.
- Pede o token do Telegram e descobre o seu chat sozinho. As chaves de IA são
  opcionais.
- **Atualização diária** às 04:10: testa a versão nova numa pasta à parte e só
  troca se a bateria passar. Se reprovar, o vigia segue na versão anterior e o
  Telegram avisa.

| No VPS | O que faz |
|---|---|
| `sudo vibe-instalar --status` | serviço, versão, última bateria, log, placar e o retrato da Suinco |
| `sudo vibe-instalar --atualizar` | o que a madrugada faz sozinha |
| `sudo vibe-instalar --desinstalar` | tira os serviços; só apaga os dados se você digitar APAGAR |

Rodar o instalador de novo é seguro: ele para o vigia, refaz o que mudou e
religa. Dois vigias juntos estragariam o placar, por isso ele nunca deixa os
dois rodando ao mesmo tempo.

O instalador tem teste próprio, `testes/instalador_em_container.sh`: instala,
reinstala, atualiza com versão boa e com versão sabotada, mostra o status e
remove, num servidor simulado, conferindo que a Suinco fica igual. Ele cria e
apaga o usuário `vibe`, então **só roda em máquina descartável** e se recusa a
rodar no VPS (systemd como processo 1, `/opt/vibe` existente ou usuário `vibe`
existente).

> **Correção registrada (atualização calada).** Quando cada versão passou a
> guardar o próprio registro da bateria, a limpeza dos registros antigos usava
> `ls`, que devolve erro quando ainda não há nenhum; com `pipefail`, a primeira
> atualização morria sem mensagem, antes da bateria, e o vigia nunca recebia
> versão nova. O teste do instalador pegou ("versão boa aplicada só depois da
> bateria verde" reprovou). Agora a limpeza usa `find`, e qualquer parada no
> meio diz a linha, avisa no Telegram e limpa a pasta de prova. Guardas: o
> teste do instalador confere que a primeira atualização termina sem parada e
> que a versão recusada e a aprovada guardam cada uma o próprio registro.

### Diário com corrente de assinaturas

Cada operação fechada vai para `dados_vigia/diario.jsonl` com a assinatura dela
**e a da anterior** (SHA-256). Editar um resultado, apagar ou inserir uma linha
depois quebra a corrente dali em diante, e o `/status` mostra a linha exata. O
placar não pode ser melhorado à mão sem que apareça, nem por quem escreve o
código. Linhas antigas, de antes da corrente, continuam aceitas no começo.

### Livro de ofertas: gravando para medir

A cada candle do menor período, o vigia lê o livro de ofertas de três fontes
públicas, sem chave: **Pionex** (o perpétuo onde se opera), **Binance** e
**Hyperliquid**. Grava uma linha em `dados_vigia/livro.jsonl` com o preço médio,
o spread e o **desequilíbrio** perto do preço: (compra − venda) ÷ (compra +
venda), em quantidade, dentro de 0,1% e de 0,5% do preço, e quanto isso vale em
USDT.

**É só gravação.** O livro não tem histórico gratuito, então não dá para testar
no passado se ele antecipa o preço. Primeiro junta-se o dado ao vivo; depois
mede-se; só se medir que ajuda, vira filtro. Fonte que falhar entra na linha
com o erro, sem derrubar as outras nem o vigia. Para desligar:
`"gravar_livro": false` no `vigia.json`.

### Arena: Qwen × Claude (opcional, no papel)

A arena põe IAs de linguagem para competir **dentro do vigia**, como mais
trilhas no placar:

| Trilha | Quem decide |
|---|---|
| `ia:qwen` | a Qwen sozinha (pela OpenRouter) |
| `ia:deepseek` | o DeepSeek sozinho (pela OpenRouter, mesma chave da Qwen) |
| `ia:claude` | o Claude sozinho (pela API oficial da Anthropic) |
| `ia:qwen+claude` | a Qwen propõe e o Claude aprova ou veta |

**O que a IA pode fazer:** dizer COMPRA, VENDA ou NADA num candle que acabou de
fechar. **O que ela não pode:** escolher tamanho, alavancagem, stop ou alvo (vêm
do `vigia.json`, iguais aos das estratégias), ler notícia ou texto de fora
(recebe só números gerados aqui, relativos ao preço atual), nem mexer em
dinheiro (não existe ferramenta nem chave de corretora). Resposta fora do
formato, recusa, erro de rede ou teto diário atingido viram **NADA**. O erro
sempre cai para o lado de não operar.

**Quando a IA é consultada:** só num candle de interesse (rompimento do canal
de 20 candles ou divergência de RSI), só ao vivo, e só se alguma IA estiver sem
posição. Um candle que fechou com o vigia desligado não é consultado: a IA não
decide o passado. A decisão de cada candle fica gravada e nunca é pedida de
novo, nem depois de religar. Cada decisão, com o motivo, vai para
`dados_vigia/arena.jsonl`.

**Nota de acerto.** Cada IA diz também a **confiança** (de 0 a 1) de que a
operação bate o alvo antes do stop. Quando a operação fecha, entra na nota
(Brier): (confiança − acertou)². **0 é perfeito; 0,25 é o que dá dizer sempre
50%.** Confiança alta que erra pesa muito (90% num stop vale 0,81). O placar
mostra a nota média de cada IA: ganhar dinheiro com confiança mal calibrada é
sorte, e a nota mostra. Confiança fora do formato não entra na nota (a decisão
continua valendo). O texto que a IA escreve vai ao Telegram limpo e marcado
como "não verificado".

**Por que só ao vivo, e não no backtest:** a IA foi treinada com textos que
incluem o histórico de preços, e pode "lembrar" o que aconteceu. Candles de
agora em diante não têm esse problema.

**O critério é o mesmo de tudo:** 30 operações, resultado positivo depois da
taxa e vitória sobre 75% das moedas pareadas. Não há prova de que IA de
linguagem tenha vantagem aqui; a arena existe para medir, não para supor.

#### Ligando

São **duas chaves de IA**, nenhuma de corretora:

1. **Anthropic** (para o Claude): no console de desenvolvedor da Anthropic
   (platform.claude.com), crie uma chave de API e **defina um limite de gasto
   mensal**. Cole a chave em `"anthropic_api_key"` no `segredos.json`.
2. **OpenRouter** (para a Qwen): em openrouter.ai, crie uma chave, ponha
   crédito e, se quiser, um limite na própria chave. Cole em `"openrouter_key"`.
3. O Claude precisa do pacote oficial da Anthropic. Instale numa pasta
   separada, sem mexer no Python do Mac:

   ```bash
   cd ~/pega-visao/vibe_trading
   python3 -m venv .venv
   .venv/bin/pip install anthropic
   ```

4. No `vigia.json`, na seção `"arena"`, troque `"ligada": false` por
   `"ligada": true`.
5. Rode o vigia com o Python dessa pasta:

   ```bash
   caffeinate -i .venv/bin/python vigia.py
   ```

Pode ligar só uma das duas: sem a chave da OpenRouter, roda só o Claude; sem a
da Anthropic, Qwen e DeepSeek. A trilha combinada precisa da Qwen e do Claude.
Na partida, o vigia confere na lista pública da OpenRouter se os nomes dos
modelos (`"qwen_modelo"`, `"deepseek_modelo"`) existem; se um não existir, ele
não gasta chamada com esse e mostra os nomes da mesma família que existem.
Nome vazio (`""`) deixa aquele competidor de fora de propósito.

#### Custo

O vigia **mede** o custo: guarda os tokens de cada resposta e multiplica pelo
preço de tabela. O `--placar` e o resumo diário mostram chamadas e dólares por IA.

- Teto padrão: **30 chamadas por IA por dia** (`"max_chamadas_dia"`). Atingiu,
  a IA fica de fora até o dia seguinte.
- Claude Opus 5.5: US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de
  saída (o raciocínio interno conta como saída). Cada consulta manda cerca de
  1.000 a 1.500 tokens; com esforço `"low"` (o padrão aqui), a estimativa é de alguns
  centavos de dólar por chamada. O número real aparece no placar.
- Qwen e DeepSeek têm o preço que a OpenRouter publica para o modelo
  escolhido; o vigia lê esse preço na partida. Cada um tem o seu teto diário.
- `"claude_esforco"` aceita `low`, `medium`, `high`, `xhigh` e `max`. Mais
  esforço é mais raciocínio por consulta, e mais custo. Só vale subir se o
  placar mostrar ganho.

A chamada ao Claude usa o **fallback do servidor** da Anthropic: se o modelo
recusar uma consulta por política, a própria API refaz com o modelo indicado
para aquele caso, na mesma chamada. Se mesmo assim recusar, vira NADA.

---

## Monitor em tempo real

`monitor.html` roda no seu navegador e lê a Binance pública **direto, sem chave
e sem conta**. Ele não envia ordem nenhuma.

**Como abrir:** baixe o arquivo e dê dois cliques. Abre no Chrome. Se o
navegador reclamar de arquivo local, rode `python3 -m http.server` nesta pasta e
abra `http://localhost:8000/monitor.html`.

O que ele mostra:

- as 5 confirmações da confluência nos 5 períodos (15 min, 1 h, 4 h, 12 h, 24 h),
  sempre no **último candle fechado**, igual ao backtest;
- engolfo e divergência de RSI em cada período, e se os períodos acima estão
  todos em alta, todos em baixa ou mistos;
- "Procurar": compra e venda, só compra (long) ou só venda (short), e a opção de
  só alertar a favor dos 2 períodos acima. Sinal barrado aparece como "filtrado";
- o ruído mediano de cada período e se o seu stop fica fora dele;
- onde fica a liquidação na alavancagem escolhida, com aviso quando ela chega
  antes do stop;
- gráfico com EMA 50/200 e os sinais marcados;
- um alerta (com som, se ativado) quando um candle fecha com confluência, com
  entrada, stop, alvo e preço de liquidação.

Se a conexão cair, ele reconecta sozinho e recarrega o histórico, para não
perder candle que fechou enquanto estava fora. O preço é o da Binance; o da
Pionex é muito próximo, mas não idêntico.

**Sinal no monitor é ponto de atenção, não ordem.** A confluência ainda não foi
testada com dado real.

---

## A geometria que precisa valer

Três distâncias em % do preço, e a ordem entre elas não é negociável:

```
ruído normal do período  <  stop  <  liquidação
```

- **Stop dentro do ruído** → você é stopado pela oscilação comum, sem estar errado.
- **Liquidação antes do stop** → você não tem stop, tem liquidação. Em 100x com
  margem de manutenção de 0,5%, a liquidação cai em 0,50%: nenhum stop curto
  cabe antes dela.

Com stop `s` e margem de manutenção `mm`, a alavancagem que ainda deixa folga
real (liquidação a pelo menos o dobro do stop):

```
alav_máx = 100 / (2·s + mm)
```

---

## Ordem de trabalho

1. **Medir o ruído** do ativo e do período (`--ruido`). Define o stop mínimo.
2. **Backtest** com dado real e `--robustez` em vários ativos e épocas. Se não
   sai "sinal de vantagem", para aqui. Custo zero.
3. **Paper trading**, só se o passo 2 passar. Dinheiro fictício, execução real,
   slippage e funding aparecendo.
4. **Dinheiro real mínimo**, só se os dois acima passarem, com sizing dentro do
   limite de risco e a mão de quem opera no botão de confirmar.

Pular etapa não acelera o resultado. Só antecipa a perda.
