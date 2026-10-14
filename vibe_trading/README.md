# Vibe Trading — bancada de prova

Ferramentas para **medir uma estratégia de trading antes de arriscar dinheiro nela**.
Nada aqui negocia, pede chave de API, acessa conta ou envia ordem.

Não toca no painel de logística Suinco. É projeto separado, na mesma árvore.

---

## O que tem aqui

| Arquivo | O que faz |
|---|---|
| `backtest.py` | Puxa candles públicos e simula com taxa, stop, margem de manutenção e liquidação |
| `bateria.py` | Fase 1: todas as estratégias em vários ativos e períodos contra a moeda; `--historico` faz o histórico inteiro ano a ano; registra tudo no caderno de experimentos (`caderno.jsonl`) |
| `estrategias.py` | Os sinais de entrada: 7 estratégias, a confluência e 2 controles cegos |
| `indicadores.py` | EMA, SMA, RSI, ATR, VWAP, desvio, ruído mediano |
| `monitor.html` | **Monitor em tempo real.** Abre no navegador, lê a Binance pública, mostra as 5 confirmações nos 5 períodos e alerta no fechamento do candle |
| `testes/test_motor.py` | Guardas: vazamento de futuro, posição sobreposta, paridade Python × monitor, gatilho obrigatório, busca de candles, padrões e alinhamento, placar |
| `testes/test_monitor_navegador.js` | Abre o monitor num Chromium com a Binance simulada e prova que carrega, calcula e alerta |

Mais a calculadora de risco interativa (página separada): **Banda de Liquidação**.

---

## Rodando

Só biblioteca padrão do Python 3. Nenhuma dependência para instalar.
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
python3 testes/test_motor.py          # guardas do motor
node testes/test_monitor_navegador.js # monitor num navegador real, Binance simulada
python3 backtest.py --estrategia ema --alav 24 --stop 0.5
python3 backtest.py --par ETHUSDT --dias 60 --comparar
```

**Comece pelo `--ruido`.** Ele mede a oscilação normal do ativo no seu período.
Esse número decide se o seu stop é executável, e vai direto no campo "ruído
típico" da Banda de Liquidação. Sem ele você está chutando.

---

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

A confluência é o checklist do scalper disciplinado, com o porquê de cada item
no código (`estrategias.py`). Os dois primeiros são **obrigatórios**: a
tendência escolhe o lado, o gatilho é o momento. Os outros três são filtros.

1. **Tendência** (obrigatória): EMA 50 acima da 200 só compra; abaixo, só vende.
2. **Gatilho** (obrigatório): fechamento rompe a máxima/mínima das últimas 20 barras.
3. **Não esticado**: RSI ainda longe do extremo do movimento.
4. **Volatilidade**: ATR acima de um piso. Mercado parado não paga a taxa.
5. **Volume**: candle com volume acima da própria média.

`confl3` = tendência + gatilho + 1 filtro · `confl4` = + 2 filtros · `confl5` = tudo.

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
contam como **stop**. OHLC não revela a ordem dentro da barra.

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

## Robustez: vantagem ou sorte?

```bash
python3 backtest.py --robustez --estrategia confl4 --alav 24
```

Corta a série em 6 janelas e, em cada uma, compara a estratégia com **30 moedas
sorteadas que entram nos mesmos candles que ela** e só sorteiam o lado. A
pergunta deixa de ser "ganhou?" e passa a ser "ganhou de quantas moedas?".

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
