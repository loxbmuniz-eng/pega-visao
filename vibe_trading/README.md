# Vibe Trading — bancada de prova

Ferramentas para **medir uma estratégia de trading antes de arriscar dinheiro nela**.
Nada aqui negocia, pede chave de API, acessa conta ou envia ordem.

Não toca no painel de logística Suinco. É projeto separado, na mesma árvore.

---

## O que tem aqui

| Arquivo | O que faz |
|---|---|
| `backtest.py` | Puxa candles públicos e simula com taxa, stop, margem de manutenção e liquidação |
| `estrategias.py` | Os sinais de entrada — 7 estratégias + 2 controles cegos |
| `indicadores.py` | EMA, SMA, RSI, ATR, VWAP, desvio, ruído mediano |

Mais a calculadora de risco interativa (página separada): **Banda de Liquidação**.

---

## Rodando

Só biblioteca padrão do Python 3. Nenhuma dependência para instalar.
Precisa de internet aberta (endpoint público de candles) — rode na sua máquina.

```bash
python3 backtest.py --listar          # ver as estratégias
python3 backtest.py --ruido           # medir o ruído real do ativo
python3 backtest.py --comparar        # TODAS as estratégias contra o controle
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
| `moeda` | **CONTROLE** — direção sorteada, valor preditivo zero |
| `comprado` | **CONTROLE** — comprado sempre, mede só a tendência da janela |
| `ema` | cruzamento de EMA 9/21 |
| `canal` | rompimento de canal de 20 barras (Donchian) |
| `momento` | continuação de momento filtrada por ATR |
| `rsi` | reversão por RSI 14 (30/70) |
| `bollinger` | reversão na banda de Bollinger 20/2 |
| `vwap` | reversão à VWAP de 20 barras |

Os dois controles são o ponto do exercício. **Estratégia que não bate a `moeda`
por margem folgada não tem vantagem — tem sorte na amostra.**

---

## Duas garantias do motor, ambas testadas

**1. Nenhuma estratégia olha o futuro.** O sinal do candle `i` só usa dados até
`i`. Verificado por truncamento: gerando sinais na série inteira e em cortes de
400, 650 e 800 candles, os sinais anteriores ao corte têm de ser idênticos. As
sete passaram sem uma única divergência. Vazamento de futuro é a causa número um
de backtest bonito que perde dinheiro no ar.

**2. O erro de modelagem cai contra a estratégia.** Quando stop e alvo cabem no
mesmo candle, conta **stop**. OHLC não revela a ordem dentro da barra; supor o
alvo inflaria o resultado. Também: uma posição de cada vez, nunca sobreposta —
duas posições abertas arriscam o dobro do que o sizing previu.

---

## Resultado da verificação

Série sintética de 900 candles, *random walk sem tendência* (0,08% de desvio por
candle), semente fixa. Nessa série **não existe vantagem para encontrar** — é
ruído puro. Então o esperado era todas empatarem menos a taxa.

### A 100x (liquidação em 0,50%, stop em 0,50%)

| Estratégia | Trades | Liquidações | Taxa paga | Banca: 110 → |
|---|---|---|---|---|
| `moeda` | 30 | 16 | 45,00 | **quebrou** |
| `comprado` | 35 | 20 | 52,50 | **quebrou** |
| `ema` | 18 | 6 | 27,00 | 61,88 |
| `canal` | 27 | 8 | 40,50 | 76,04 |
| `momento` | 20 | 4 | 30,00 | 73,65 |
| `rsi` | 13 | 5 | 19,50 | 56,29 |
| `bollinger` | 8 | 7 | 12,00 | **quebrou** |
| `vwap` | 13 | 7 | 19,50 | **quebrou** |

**Nenhuma das oito terminou no positivo. Quatro quebraram a conta.** O melhor
caso perdeu 30,9%. A liquidação cai exatamente onde está o stop, então o stop
nunca executa: de 4 a 20 operações por estratégia morreram liquidadas.

### A 24x (liquidação em 3,67%, folga de 3,17% depois do stop)

| Estratégia | Trades | Liquidações | Taxa paga | Banca: 110 → |
|---|---|---|---|---|
| `moeda` | 92 | **0** | 33,12 | **120,27** |
| `comprado` | 85 | 0 | 30,60 | quebrou |
| `ema` | 18 | 0 | 6,48 | 107,09 |
| `canal` | 27 | 0 | 9,72 | 113,37 |
| `momento` | 20 | 0 | 7,20 | 107,04 |
| `rsi` | 13 | 0 | 4,68 | 104,31 |
| `bollinger` | 32 | 0 | 11,52 | 69,32 |
| `vwap` | 32 | 0 | 11,52 | 59,50 |

**As liquidações viraram zero em todas.** Mesmas entradas, mesma série, mesmo
stop — a única mudança foi a alavancagem. A 100x o ruído normal do mercado
alcança a liquidação; a 24x não alcança.

### A lição desconfortável

**A `moeda` ganhou de todas as sete a 24x.** +9,3%, melhor que qualquer
estratégia "de verdade".

Isso não quer dizer que jogar moeda funciona. Quer dizer o contrário: **numa
amostra só, o resultado é ruído.** A série é aleatória por construção, não há
vantagem para achar, e a moeda deu sorte. Se você rodar uma estratégia uma vez,
ver +9% e concluir que ela funciona, foi exatamente isso que aconteceu com você.

Por isso o `--comparar` sempre mostra os dois controles, e por isso o teste
precisa rodar em **várias janelas e vários ativos** antes de qualquer conclusão.

> Esses números são de série sintética com semente fixa. Validam o **motor**,
> não o mercado. Para o número real, rode `backtest.py` com rede aberta.

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
2. **Backtest** com dado real, contra os controles, em várias janelas. Se não
   bate a `moeda`, para aqui — custo zero.
3. **Paper trading**, só se o passo 2 passar. Dinheiro fictício, execução real,
   slippage e funding aparecendo.
4. **Dinheiro real mínimo**, só se os dois acima passarem, com sizing dentro do
   limite de risco e a mão de quem opera no botão de confirmar.

Pular etapa não acelera o resultado. Só antecipa a perda.
