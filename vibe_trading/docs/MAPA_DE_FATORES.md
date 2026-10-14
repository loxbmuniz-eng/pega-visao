# Mapa de fatores do BTC

O que move o preço do BTC, de onde vem cada dado, e se dá para testar no
passado. É a base da **ficha de cada operação** (`/analisar`).

Regra da curadoria: só entra fonte **grátis e sem chave**, com endereço
conferido. Nenhuma entra na ficha antes de responder ao teste
`python3 vibe.py fontes`, rodado na máquina de quem opera (este ambiente de
desenvolvimento não alcança as fontes externas).

Legenda da verificação (pesquisa de 14/10/2026):
**[doc]** página oficial · **[src]** código-fonte oficial ·
**[código]** usado com o mesmo endereço em dois ou mais projetos independentes ·
**NÃO CONFIRMADO** ainda precisa de prova.

Testável = tem histórico grátis para entrar na bateria contra a moeda.
Só ao vivo = gravamos daqui em diante e medimos depois.

---

## Já no sistema

| Fator | Fonte | Testável |
|---|---|---|
| Preço, candle, volume | Pionex (perpétuo), Binance | sim |
| Compra e venda agressora | Binance (campo 9 do candle) | sim |
| Livro de ofertas | Pionex, Binance, Hyperliquid | só ao vivo (gravando) |
| Estrutura, SMC, montagens | calculado do candle | sim |

## Entra primeiro (grátis, sem chave)

| # | Fator | Fonte | Atualiza | Testável | Verificação |
|---|---|---|---|---|---|
| 1 | Posições abertas, proporção comprados/vendidos, agressão nos futuros | `data.binance.vision/data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-AAAA-MM-DD.zip` (CSV a cada 5 min) | diário | sim, desde ~2020–2022 | [código]; início NÃO CONFIRMADO |
| 2 | Funding (custo de manter a posição) | `fapi/v1/fundingRate`; arquivo mensal `data/futures/um/monthly/fundingRate/` | a cada 8 h | sim | [doc] + [código] |
| 3 | Volatilidade implícita das opções (DVOL) | Deribit `public/get_volatility_index_data?currency=BTC&resolution=...` | até 1 min | sim, desde 2021 | [doc] + [código] |
| 4 | Medo e Ganância | `api.alternative.me/fng/?limit=0&format=json` | diário | sim, desde 2018 | [doc]; exige citar a fonte ao exibir |
| 5 | Oferta de stablecoins (dinheiro novo entrando) | DefiLlama `stablecoins.llama.fi/stablecoincharts/all?stablecoin=1` (USDT), `=2` (USDC) | diário | sim | [código] |
| 6 | Juros 10 anos, dólar amplo, balanço do Fed, volatilidade da bolsa (VIX), reverse repo | FRED CSV sem chave `fred.stlouisfed.org/graph/fredgraph.csv?id=` DGS10, DTWEXBGS, WALCL, VIXCLS, RRPONTSYD | diário/semanal | sim, **respeitando o atraso de publicação** (o dólar amplo sai semanal) | [código]; VIXCLS e RRPONTSYD NÃO CONFIRMADOS |
| 7 | Agenda: inflação (CPI), emprego, Fed | BLS iCal `bls.gov/schedule/news_release/bls.ics` (só próximos meses); Fed: datas por reunião | evento | ao vivo; histórico precisa de tabela com fonte por linha | [doc] |
| 8 | Posição dos grandes no CME (COT) | CFTC `publicreporting.cftc.gov/resource/gpe5-46if.json?cftc_contract_market_code=133741` | semanal (sexta) | sim, desde 2017 | [código] |
| 9 | Fluxo para dentro/fora das corretoras, MVRV | Coin Metrics Community `community-api.coinmetrics.io/v4/timeseries/asset-metrics` | diário | sim, desde 2011; licença não comercial | [doc]; métricas de fluxo NÃO CONFIRMADAS no plano grátis |
| 10 | Hash rate, dificuldade, taxa da rede | `api.blockchain.info/charts/{hash-rate,difficulty}`; mempool.space `/api/v1/mining/...` | diário | sim | [doc] + [src] |
| 11 | Liquidações | Binance `!forceOrder@arr` (ao vivo, 1 por símbolo por segundo, subconta); OKX `api/v5/public/liquidation-orders` | ao vivo | só ao vivo: **gravar desde já** | [doc] + [código] |
| 12 | Notícias e regulação (só informativo, nunca abre operação) | RSS: SEC, CFTC, Fed, BCB, CVM, CoinDesk, The Block, Decrypt, Blockworks, Livecoins, Portal do Bitcoin | contínuo | não (os feeds guardam só os últimos itens) | [código]; feed de cripto da InfoMoney e o endereço do Cointelegraph Brasil NÃO CONFIRMADOS |

## Fica de fora (e por quê)

| Fonte | Motivo |
|---|---|
| CoinGlass, Whale Alert, CryptoQuant, Glassnode, SoSoValue | pagos ou exigem chave |
| DXY em tempo real | licenciado (ICE); o dólar amplo do FRED cobre o regime diário |
| Yahoo, Stooq | sem permissão de uso automatizado / exige chave por captcha |
| Google Trends, X, Reddit, LunarCrush, Santiment | sem API aberta ou exigem chave |
| CoinGecko sem chave | a própria documentação diz que não é para consulta programada |
| Farside (fluxo dos ETFs) | só página HTML atrás de proteção anti-robô; fica para quando houver fonte própria |
| Ondas de Elliott, padrões harmônicos | não viram regra exata, então não dá para testar |

## Como cada fator entra na ficha

- **Contexto** (mostra, não decide): agenda das próximas horas, notícias e
  regulação, medo e ganância, regime macro.
- **Filtro testado** (só decide depois de passar na bateria com prova contra
  sorte): funding extremo, posições abertas, volatilidade implícita,
  stablecoins, fluxo das corretoras, agenda (não entrar perto do anúncio).
- **Gravação** (só ao vivo, medido depois): livro de ofertas e liquidações.

Nenhum fator vira ordem sozinho. A decisão continua sendo a regra testada, e o
clique continua sendo de quem opera.
