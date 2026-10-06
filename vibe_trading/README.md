# Vibe Trading — bancada de prova

Ferramentas para **medir uma estratégia de trading antes de arriscar dinheiro nela**.
Nada aqui negocia, pede chave de API, acessa conta ou envia ordem.

Não toca no painel de logística Suinco. É projeto separado, na mesma árvore.

---

## O que tem aqui

| Arquivo | O que faz |
|---|---|
| `backtest.py` | Puxa candles públicos e simula a estratégia com taxa, stop e liquidação modelados |

E a calculadora de risco interativa (página separada): **Banda de Liquidação** —
mostra onde a liquidação cai, quanto a taxa come, e qual tamanho de posição o
limite de risco permite.

---

## Rodando

Só biblioteca padrão do Python 3. Nenhuma dependência para instalar.

```bash
# o cenário original: banca 110, margem 15, 100x, stop 0,5%
python3 backtest.py

# sizing que respeita 2% de risco por operação
python3 backtest.py --alav 24 --stop 0.5

# long e short simultâneos (o modo "hedge")
python3 backtest.py --hedge

# outro ativo, outra janela
python3 backtest.py --par ETHUSDT --dias 60
```

Se a rede bloquear o endpoint de candles, o script diz quais fontes tentou e
para. Ele precisa de internet aberta — rode na sua máquina, não em container
restrito.

---

## O que o backtest mede, e o que ele NÃO mede

**Mede:** o que a *estrutura* da operação faz com a banca. Alavancagem, stop,
taxa, margem de manutenção e liquidação. Isso é aritmética e não depende de
previsão nenhuma.

**Não mede:** se a sua leitura de gráfico tem vantagem. A entrada no simulador
é deliberadamente neutra (alterna long e short). Isso é de propósito: se a
estrutura já perde dinheiro com entrada neutra, qualquer indicador colocado em
cima dela **não começa do zero — começa do prejuízo.** Ele precisa primeiro
pagar a estrutura, e só depois sobra lucro.

Para medir a sua vantagem, troque a função de sinal: é o único lugar que
precisa mudar.

---

## Resultado da verificação do motor

Rodado em série sintética de 1.200 candles, *random walk sem tendência*
(oscilação de 0,08% por candle), com entrada de valor preditivo **zero**.
Com edge zero, todos deveriam ficar perto do zero menos a taxa. Não é o que
acontece:

| Configuração | Trades até parar | Liquidações | Taxa paga | Banca: 110 → |
|---|---|---|---|---|
| 100x, stop 0,5% | 18 | **10** | 27,00 | **11,63 — quebrou** |
| 100x + hedge long&short | 20 | 8 | 30,00 | **28,70 — quebrou** |
| 24x, stop 0,5% (limite 2%) | 100 | 0 | 36,00 | 64,16 |
| 5x, stop 1,5% | 100 | 0 | 7,50 | 102,26 |

A leitura que importa: **a alavancagem não mudou a expectativa, mudou a
sobrevivência.** Nos quatro casos a entrada era igualmente cega. A 100x, a
liquidação cai em 0,50% — exatamente onde está o stop, então o stop nunca
executa: 10 das 18 operações morreram liquidadas. A 5x a mesma entrada cega
perde só o custo da taxa.

> Reproduzir: o teste usa série sintética com semente fixa (`random.seed(7)`),
> não dado de mercado. Ele valida o **motor**, não o mercado. Para o número
> real, rode `backtest.py` com rede aberta.

---

## A geometria que precisa valer

Três distâncias, em % do preço, e a ordem entre elas não é negociável:

```
ruído normal do período  <  stop  <  liquidação
```

- **Stop dentro do ruído** → você é stopado pela oscilação comum, sem estar errado.
- **Liquidação antes do stop** → você não tem stop, tem liquidação. Em 100x com
  margem de manutenção de 0,5%, a liquidação cai em 0,50%: nenhum stop curto
  cabe antes dela.

Com stop de `s` e margem de manutenção `mm`, a alavancagem que ainda deixa
folga real (liquidação a pelo menos o dobro do stop) é:

```
alav_máx = 100 / (2·s + mm)
```

---

## Ordem de trabalho

1. **Backtest** com dado real. Se perde aqui, para aqui — custo zero.
2. **Paper trading**, se o backtest passar. Dinheiro fictício, execução real,
   slippage e funding aparecendo.
3. **Dinheiro real mínimo**, só se os dois acima passarem, com sizing dentro do
   limite de risco e a mão de quem opera no botão de confirmar.

Pular etapa não acelera o resultado. Só antecipa a perda.
