# HANDOFF — VIBE TRADING

**Projeto:** agente de pesquisa de trading — backtest, validação e debate entre analistas
**Onde:** repo `pega-visao`, branch `claude/projetos-por-nicho-39za6z`, pasta `projetos/vibe_trading/`
**Estado:** 🟡 commitado, não publicado · 36 testes passando · **nenhuma ordem real, em nenhuma corretora**
**Entregue em:** 29/08/2026

---

## 1. O QUE ESTÁ PRONTO

| Peça | Arquivo | Situação |
|---|---|---|
| Série de preços (CSV + sintética) | `vibe_trading/serie.py` | pronto |
| Indicadores (SMA, EMA, IFR, ATR, canal) | `vibe_trading/indicadores.py` | pronto |
| Motor de backtest | `vibe_trading/backtest.py` | pronto |
| Métricas (Sharpe, Sortino, DD, Calmar…) | `vibe_trading/metricas.py` | pronto |
| Três estratégias | `vibe_trading/estrategias/` | pronto |
| Debate entre analistas | `vibe_trading/debate.py` | pronto |
| CLI | `vibe_trading/__main__.py` + `./vibe` | pronto |
| Testes | `testes/` | 36 passando |

**Zero dependências.** Só Python 3.11+ da biblioteca padrão. Sem pandas, sem
numpy, sem instalar nada. É clonar e rodar.

---

## 2. COMO RODAR — copie e cole

```bash
cd projetos/vibe_trading

./vibe estrategias                         # o que existe e os parâmetros
./vibe comparar                            # todas contra comprar e segurar
./vibe backtest --estrategia rompimento    # uma, com métricas completas
./vibe validar --estrategia media_movel    # treino x validação
./vibe debate --saida dossie.md            # dossiê de evidências + placar

python3 -m unittest discover -s testes -p 'test_*.py'   # 36 testes
```

**Com dados de verdade** (CSV exportado da corretora, do Yahoo, do TradingView):

```bash
./vibe comparar --dados PETR4.csv --papel PETR4
./vibe backtest --dados PETR4.csv --estrategia rompimento --param entrada=40 --param saida=15
```

O leitor de CSV aceita cabeçalho em português ou inglês, número no formato
brasileiro (`1.234,56`) ou internacional, separador `,` ou `;`, e data em
`dd/mm/aaaa` ou `aaaa-mm-dd`. Precisa, no mínimo, das colunas **data** e
**fechamento**.

**Sem dados** ele gera uma série sintética por semente e **avisa na tela que
o dado é falso**. Serve para exercitar o motor, não para concluir nada.

---

## 3. AS TRÊS DECISÕES QUE SUSTENTAM O PROJETO

Se você mexer em uma delas, mexeu no que o projeto é.

### 3.1 O sinal da barra `i` executa na ABERTURA da barra `i+1`

Quase todo backtest caseiro compra no fechamento do mesmo dia em que o sinal
apareceu. A curva fica linda e é impossível de repetir com dinheiro: na hora
em que aquele fechamento existe, o pregão acabou.

Aqui a defesa é estrutural, não um cuidado que alguém precisa lembrar. Tem
teste: `testes/test_backtest.py::test_sinal_da_barra_i_executa_na_abertura_de_i_mais_1`
monta uma série com gap e exige que a entrada saia pelo preço de abertura da
barra seguinte.

**Se esse teste ficar vermelho, o número de todo backtest vira ficção.**

### 3.2 Custo entra sempre, e sempre contra

Corretagem por ordem (padrão 0,05%) e slippage em pontos-base (padrão 5),
**modelado contra quem executa**: comprando paga mais, vendendo recebe menos.
Modelar a favor é a segunda forma mais comum de o backtest mentir.

### 3.3 Treino e validação, com veredito escrito

`./vibe validar` corta a série em dois e roda nos dois pedaços. O veredito
distingue quatro casos — e a ordem importa:

1. **Falhou já no treino** → validar o que já falhou não acrescenta nada.
2. **Positiva no treino, negativa fora** → o que parecia sinal era memória.
3. **Cai para menos da metade do Sharpe** → desconfie do ajuste de parâmetro.
4. **Se manteve** → o único caso que autoriza continuar.

> O primeiro rascunho não tinha o caso 1 e anunciava "se manteve fora do
> treino" para uma estratégia que perdia dinheiro nos dois períodos. Era
> verdade e era inútil. Se você acrescentar veredito novo, cuide da ordem.

---

## 4. O DEBATE — como ele evita virar texto bonito e vazio

Quatro analistas (**tendência · risco · contra · custo**) argumentam sobre o
**mesmo dossiê de evidências medidas da série**. Eles não inventam número:
recebem os fatos calculados e defendem uma leitura. Um juiz pontua.

O placar é **determinístico** (regra, não modelo): roda offline e dá o mesmo
resultado duas vezes. Tem teste para isso.

Se você quiser a prosa do debate, `./vibe debate --saida dossie.md` gera o
material para colar num LLM — **com os números do lado**, para dar para
conferir se o texto que voltar corresponde ao que foi medido.

> LLM debatendo preço sem dado na mão produz texto convincente e vazio. Num
> assunto onde texto convincente custa dinheiro, isso é pior do que nada.

---

## 5. PENDÊNCIAS — o que NÃO existe

Escrito para ninguém contar com o que não foi feito:

1. **⬜ Nenhuma fonte de dados automática.** Não busca cotação de lugar
   nenhum. É CSV na mão ou série sintética. Ligar numa API (B3, Yahoo,
   corretora) é o próximo passo natural e não foi começado.
2. **⬜ Nenhuma execução real.** Não fala com corretora, não manda ordem, não
   tem credencial de nada. É ferramenta de pesquisa.
3. **⬜ Sem carteira.** Um papel por vez. Não há alocação entre ativos,
   correlação, nem risco de carteira.
4. **⬜ Sem stop nem dimensionamento por volatilidade.** As estratégias
   entram com o capital inteiro. O ATR já é calculado e está lá esperando
   para virar dimensionamento de posição — é a melhoria de maior impacto.
5. **⬜ Sem otimização de parâmetro.** De propósito, por enquanto: otimizar
   sem validação cruzada de verdade só produz sobreajuste mais rápido.
6. **⬜ Custo brasileiro real.** Corretagem é uma fração fixa. Emolumentos,
   liquidação, ISS e imposto sobre day trade não estão modelados.

---

## 6. LIMITAÇÕES CONHECIDAS — para não descobrir depois

- **A série sintética não é o mercado.** É um passeio aleatório com deriva.
  Não tem gap de notícia, não tem regime, não tem cauda gorda. Estratégia que
  vai bem nela não provou nada. Ela existe para testar o *motor*.
- **Sharpe usa 252 pregões e taxa livre de risco explícita** (padrão 10% a.a.,
  referência de CDI). No Brasil isso muda o veredito: render 12% ao ano com o
  dobro da volatilidade do CDI não é bom, e Sharpe com taxa zero diria que é.
  Ajuste `--livre-risco` para o período que você está testando.
- **Sem venda a descoberto por padrão.** `--vender` libera, mas o motor não
  modela aluguel de ação nem custo de carrego da posição vendida.
- **Rebaixamento é medido sobre o pico histórico**, barra a barra — não sobre
  o início. É o que a pessoa sente na conta.

---

## 7. PARA CONTINUAR EM OUTRA SESSÃO

Comece por aqui, nesta ordem:

1. `projetos/vibe_trading/HANDOFF.md` — este arquivo.
2. `vibe_trading/backtest.py` — o comentário do topo explica a decisão 3.1.
3. `testes/test_backtest.py` — os testes são a especificação executável.

**Antes de mexer em qualquer coisa:**

```bash
cd projetos/vibe_trading && python3 -m unittest discover -s testes -p 'test_*.py'
```

36 verdes. Se algum estiver vermelho antes de você tocar em nada, resolva
isso primeiro — não construa em cima.

**Como acrescentar uma estratégia:**

1. Crie `vibe_trading/estrategias/sua_ideia.py` herdando de `Estrategia`.
2. Implemente `iniciar(serie)` (pré-cálculo) e `sinal(serie, i)` → `-1|0|1`.
3. **Olhe apenas até `serie[i]`.** O motor não te impede de espiar `i+1`; ele
   garante o preço de execução, não a sua disciplina. Espiar aqui é o único
   jeito de furar a proteção do projeto.
4. Registre em `estrategias/__init__.py`.
5. Rode `./vibe validar --estrategia sua_ideia` antes de comemorar.

---

## 8. AVISO QUE VAI JUNTO EM TODA SAÍDA

> Backtest é o passado medido com custo — não é previsão. Nenhuma ordem é
> enviada para corretora nenhuma. Isto não é recomendação de investimento.
