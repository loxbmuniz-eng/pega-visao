# Vibe Trading — bancada de prova

Ferramentas para **medir uma estratégia de trading antes de arriscar dinheiro nela**.
Nada aqui negocia, pede chave de API, acessa conta ou envia ordem.

Não toca no painel de logística Suinco. É projeto separado, na mesma árvore.

---

## O que tem aqui

| Arquivo | O que faz |
|---|---|
| `backtest.py` | Puxa candles públicos e simula com taxa, stop, margem de manutenção e liquidação |
| `estrategias.py` | Os sinais de entrada: 7 estratégias, a confluência e 2 controles cegos |
| `indicadores.py` | EMA, SMA, RSI, ATR, VWAP, desvio, ruído mediano |
| `monitor.html` | **Monitor em tempo real.** Abre no navegador, lê a Binance pública, mostra as 5 confirmações nos 5 períodos e alerta no fechamento do candle |
| `testes/test_motor.py` | Guardas: vazamento de futuro, posição sobreposta, paridade Python × monitor, gatilho obrigatório |
| `testes/test_monitor_navegador.js` | Abre o monitor num Chromium com a Binance simulada e prova que carrega, calcula e alerta |

Mais a calculadora de risco interativa (página separada): **Banda de Liquidação**.

---

## Rodando

Só biblioteca padrão do Python 3. Nenhuma dependência para instalar.
Precisa de internet aberta (endpoint público de candles) — rode na sua máquina.

```bash
python3 backtest.py --listar          # ver as estratégias
python3 backtest.py --ruido           # medir o ruído real do ativo
python3 backtest.py --comparar        # TODAS as estratégias contra o controle
python3 backtest.py --robustez --estrategia confl4 --alav 24   # vantagem ou sorte?
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

## Três garantias do motor, todas testadas

**1. Nenhuma estratégia olha o futuro.** O sinal do candle `i` só usa dados até
`i`. Verificado por truncamento: sinais gerados na série inteira e em cortes
têm de ser idênticos antes do corte. As dez estratégias passaram.

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
