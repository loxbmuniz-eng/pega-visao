#!/usr/bin/env python3
"""
Sinais de entrada. Cada estrategia le os candles e devolve, para cada candle,
a direcao da entrada: +1 compra, -1 venda, 0 nao opera.

REGRA QUE NAO SE QUEBRA — o sinal do indice i so pode usar dados ATE o candle i.
Olhar o candle i+1 para decidir a entrada em i e "vazamento de futuro", e e a
causa numero um de backtest bonito que perde dinheiro no ar. Toda estrategia
aqui decide no FECHAMENTO do candle i e entra nesse preco.

A estrategia 'moeda' existe como controle: ela e deliberadamente cega. Qualquer
estrategia que nao bata a 'moeda' por margem folgada nao tem vantagem nenhuma —
tem sorte na amostra.
"""

from __future__ import annotations

import random
from typing import Callable

import indicadores as ind


# --------------------------------------------------------------------------- #
# controles (sem vantagem nenhuma, de proposito)
# --------------------------------------------------------------------------- #

def moeda(c, semente: int = 7) -> list[int]:
    """Controle: direcao sorteada. Valor preditivo zero, por construcao."""
    r = random.Random(semente)
    return [r.choice([1, -1]) for _ in c.fechamento]


def sempre_compra(c) -> list[int]:
    """Controle: comprado sempre. Mede so a tendencia da janela."""
    return [1] * len(c.fechamento)


# --------------------------------------------------------------------------- #
# estrategias de seguir movimento
# --------------------------------------------------------------------------- #

def ema_cruzamento(c, rapida: int = 9, lenta: int = 21) -> list[int]:
    """Cruzamento de medias: entra na direcao do cruzamento, no candle dele."""
    er = ind.ema(c.fechamento, rapida)
    el = ind.ema(c.fechamento, lenta)
    s = [0] * len(c.fechamento)
    for i in range(1, len(c.fechamento)):
        if None in (er[i], el[i], er[i - 1], el[i - 1]):
            continue
        antes = er[i - 1] - el[i - 1]
        agora = er[i] - el[i]
        if antes <= 0 < agora:
            s[i] = 1
        elif antes >= 0 > agora:
            s[i] = -1
    return s


def rompimento_canal(c, n: int = 20) -> list[int]:
    """Rompimento de maxima/minima das ultimas n barras (estilo Donchian)."""
    s = [0] * len(c.fechamento)
    for i in range(n, len(c.fechamento)):
        topo = max(c.maxima[i - n : i])
        fundo = min(c.minima[i - n : i])
        if c.fechamento[i] > topo:
            s[i] = 1
        elif c.fechamento[i] < fundo:
            s[i] = -1
    return s


def momento_atr(c, n: int = 14, mult: float = 1.0) -> list[int]:
    """
    Continuacao de momento filtrada por ATR: entra quando o candle fecha
    deslocado mais de `mult` ATR em relacao a abertura.
    """
    a = ind.atr(c.maxima, c.minima, c.fechamento, n)
    s = [0] * len(c.fechamento)
    for i in range(len(c.fechamento)):
        if a[i] is None or a[i] == 0:
            continue
        corpo = c.fechamento[i] - c.abertura[i]
        if corpo > mult * a[i]:
            s[i] = 1
        elif corpo < -mult * a[i]:
            s[i] = -1
    return s


# --------------------------------------------------------------------------- #
# estrategias de reversao
# --------------------------------------------------------------------------- #

def rsi_reversao(c, n: int = 14, baixo: float = 30.0, alto: float = 70.0) -> list[int]:
    """RSI em extremo: compra no sobrevendido, vende no sobrecomprado."""
    r = ind.rsi(c.fechamento, n)
    s = [0] * len(c.fechamento)
    for i in range(1, len(c.fechamento)):
        if r[i] is None or r[i - 1] is None:
            continue
        if r[i - 1] <= baixo < r[i]:
            s[i] = 1
        elif r[i - 1] >= alto > r[i]:
            s[i] = -1
    return s


def bollinger_reversao(c, n: int = 20, k: float = 2.0) -> list[int]:
    """Toque na banda e volta: compra na banda inferior, vende na superior."""
    m = ind.sma(c.fechamento, n)
    d = ind.desvio(c.fechamento, n)
    s = [0] * len(c.fechamento)
    for i in range(len(c.fechamento)):
        if m[i] is None or d[i] is None or d[i] == 0:
            continue
        if c.fechamento[i] < m[i] - k * d[i]:
            s[i] = 1
        elif c.fechamento[i] > m[i] + k * d[i]:
            s[i] = -1
    return s


def vwap_reversao(c, n: int = 20, desvio_pct: float = 0.3) -> list[int]:
    """Desvio da VWAP: aposta no retorno a media ponderada por volume."""
    v = ind.vwap_janela(c.maxima, c.minima, c.fechamento, c.volume, n)
    s = [0] * len(c.fechamento)
    for i in range(len(c.fechamento)):
        if v[i] is None or v[i] == 0:
            continue
        dist = (c.fechamento[i] - v[i]) / v[i] * 100.0
        if dist < -desvio_pct:
            s[i] = 1
        elif dist > desvio_pct:
            s[i] = -1
    return s


# --------------------------------------------------------------------------- #
# confluencia — o checklist do scalper disciplinado
# --------------------------------------------------------------------------- #

def confluencia(c, minimo: int = 4, n_tend: int = 50, n_tend_longa: int = 200,
                n_canal: int = 20, n_rsi: int = 14, n_atr: int = 14,
                n_vol: int = 20, atr_piso_pct: float = 0.05) -> list[int]:
    """
    Exige varias confirmacoes na MESMA direcao antes de entrar.

    As cinco checagens, e por que cada uma existe:

    1. TENDENCIA   EMA 50 acima da EMA 200 -> so compra; abaixo -> so vende.
                   Operar contra a tendencia maior e o erro mais caro do
                   scalping: voce acerta a direcao do minuto e perde na hora.

    2. GATILHO     fechamento rompe a maxima (ou minima) das ultimas n_canal
                   barras. E o evento que justifica entrar AGORA e nao antes.

    3. NAO ESTICADO  RSI ainda nao esta no extremo oposto do movimento.
                   Comprar o que ja subiu 70 de RSI e pagar o topo.

    4. VOLATILIDADE  ATR em % do preco acima de um piso. Em mercado parado o
                   movimento nao cobre a taxa — a melhor operacao e nenhuma.
                   Este filtro e o que mais protege banca pequena.

    5. VOLUME      volume do candle acima da sua propria media. Rompimento sem
                   volume costuma ser armadilha.

    TENDENCIA e GATILHO sao obrigatorios: a tendencia escolhe o lado, o gatilho
    e o momento. Os outros tres sao filtros. `minimo` conta os votos incluindo
    os dois obrigatorios, entao:
        confl3 = tendencia + gatilho + 1 filtro
        confl4 = tendencia + gatilho + 2 filtros
        confl5 = tudo
    (Versao anterior nao exigia o gatilho: tendencia + RSI + ATR + volume, que
    sao verdade quase sempre ao mesmo tempo, bastavam para 4/5 e o "sinal"
    ficava ligado em ~44% dos candles — um estado, nao um evento.)

    Qual nivel presta e pergunta empirica, nao de opiniao — rode --robustez
    com confl3, confl4 e confl5 e compare.
    """
    n = len(c.fechamento)
    s = [0] * n

    e_curta = ind.ema(c.fechamento, n_tend)
    e_longa = ind.ema(c.fechamento, n_tend_longa)
    r = ind.rsi(c.fechamento, n_rsi)
    a = ind.atr(c.maxima, c.minima, c.fechamento, n_atr)
    vol_media = ind.sma(c.volume, n_vol)

    for i in range(n):
        if i < max(n_canal, n_atr, n_rsi) + 1:
            continue

        # ---- 1. tendencia maior define o lado permitido ----
        lado = 0
        if e_curta[i] is not None and e_longa[i] is not None:
            lado = 1 if e_curta[i] > e_longa[i] else -1
        if lado == 0:
            continue

        votos = 1  # a tendencia e o primeiro voto

        # ---- 2. gatilho de rompimento, no lado da tendencia (OBRIGATORIO) ----
        topo = max(c.maxima[i - n_canal : i])
        fundo = min(c.minima[i - n_canal : i])
        gatilho = (lado > 0 and c.fechamento[i] > topo) or (lado < 0 and c.fechamento[i] < fundo)
        if gatilho:
            votos += 1

        # ---- 3. nao entrar esticado ----
        if r[i] is not None:
            if (lado > 0 and r[i] < 70.0) or (lado < 0 and r[i] > 30.0):
                votos += 1

        # ---- 4. volatilidade paga a taxa? ----
        if a[i] is not None and c.fechamento[i] > 0:
            if (a[i] / c.fechamento[i] * 100.0) >= atr_piso_pct:
                votos += 1

        # ---- 5. volume confirma ----
        if vol_media[i] is not None and vol_media[i] > 0:
            if c.volume[i] > vol_media[i]:
                votos += 1

        if dispara(gatilho, votos, minimo):
            s[i] = lado

    return s


def dispara(gatilho: bool, votos: int, minimo: int) -> bool:
    """A decisao de entrar. Mesma regra que Motor.dispara no monitor.html."""
    return gatilho and votos >= minimo


def confluencia_3(c) -> list[int]:
    return confluencia(c, minimo=3)


def confluencia_5(c) -> list[int]:
    return confluencia(c, minimo=5)


# --------------------------------------------------------------------------- #
# padroes
# --------------------------------------------------------------------------- #

def engolfo(c) -> list[int]:
    """
    Engolfo: o corpo do candle i engole o corpo do anterior, de cor oposta.

    Alta: anterior de baixa, atual de alta, abre ate o fechamento anterior,
    fecha acima da abertura anterior e tem corpo maior. Baixa: o espelho.
    Decide no fechamento de i usando so i e i-1.
    """
    n = len(c.fechamento)
    s = [0] * n
    for i in range(1, n):
        o0, f0 = c.abertura[i - 1], c.fechamento[i - 1]
        o1, f1 = c.abertura[i], c.fechamento[i]
        if abs(f1 - o1) <= abs(f0 - o0):
            continue
        if f0 < o0 and f1 > o1 and o1 <= f0 and f1 >= o0:
            s[i] = 1
        elif f0 > o0 and f1 < o1 and o1 >= f0 and f1 <= o0:
            s[i] = -1
    return s


def divergencia_rsi(c, k: int = 3, n_rsi: int = 14,
                    dist_min: int = 5, dist_max: int = 60) -> list[int]:
    """
    Divergencia entre preco e RSI.

    Alta: o preco faz um fundo MAIS BAIXO que o fundo anterior, mas o RSI faz um
    fundo MAIS ALTO. A queda perdeu forca. Baixa: topo mais alto no preco, topo
    mais baixo no RSI.

    O ponto que mais engana em backtest: um fundo so e fundo depois que o preco
    sobe nos k candles seguintes. Entao o pivo em j so e CONFIRMADO no candle
    i = j + k, e e em i que o sinal sai e a entrada acontece. Marcar o sinal em
    j seria comprar no fundo exato sabendo o futuro.

    Pivo de fundo em j: minima[j] menor que as k anteriores e menor ou igual as
    k seguintes. Os dois pivos comparados precisam estar entre dist_min e
    dist_max candles um do outro. Se fundo e topo divergirem no mesmo candle,
    nao opera.
    """
    r = ind.rsi(c.fechamento, n_rsi)
    n = len(c.fechamento)
    s = [0] * n
    ult_fundo = None
    ult_topo = None
    for i in range(2 * k, n):
        j = i - k
        if r[j] is None:
            continue
        alta = baixa = False

        if c.minima[j] < min(c.minima[j - k:j]) and c.minima[j] <= min(c.minima[j + 1:i + 1]):
            if (ult_fundo is not None and dist_min <= j - ult_fundo <= dist_max
                    and c.minima[j] < c.minima[ult_fundo] and r[j] > r[ult_fundo]):
                alta = True
            ult_fundo = j

        if c.maxima[j] > max(c.maxima[j - k:j]) and c.maxima[j] >= max(c.maxima[j + 1:i + 1]):
            if (ult_topo is not None and dist_min <= j - ult_topo <= dist_max
                    and c.maxima[j] > c.maxima[ult_topo] and r[j] < r[ult_topo]):
                baixa = True
            ult_topo = j

        if alta and not baixa:
            s[i] = 1
        elif baixa and not alta:
            s[i] = -1
    return s


# --------------------------------------------------------------------------- #
# alinhamento entre periodos
# --------------------------------------------------------------------------- #

MIN15, H1, H4, H12, D1 = 900_000, 3_600_000, 14_400_000, 43_200_000, 86_400_000

# os dois periodos acima de cada um; 24 h nao tem periodo acima
ACIMA: dict[int, tuple[int, ...]] = {
    MIN15: (H1, H4),
    H1: (H4, H12),
    H4: (H12, D1),
    H12: (D1,),
}


def ms_base(c) -> int | None:
    """Duracao do candle da serie, pela mediana do intervalo entre aberturas."""
    t = getattr(c, "t", None) or []
    if len(t) < 2:
        return None
    difs = sorted(t[i] - t[i - 1] for i in range(1, min(len(t), 400)))
    return difs[len(difs) // 2]


def reamostrar(c, ms_alvo: int, base: int) -> tuple[list[int], list[float]]:
    """
    Monta candles de um periodo maior a partir dos menores: (aberturas, fechamentos).

    Agrupa pela fronteira de relogio em UTC (abertura // ms_alvo), igual a
    Binance. Grupo incompleto — comeco da serie no meio de uma hora, ou candle
    faltando — e descartado: um candle de 1 h montado com 3 de 4 pedacos e um
    candle que nao existiu.
    """
    por_grupo = ms_alvo // base
    aberturas: list[int] = []
    fechamentos: list[float] = []
    grupo, conta, ultimo = None, 0, 0.0
    for i, t in enumerate(c.t):
        g = t // ms_alvo
        if g != grupo:
            if grupo is not None and conta == por_grupo:
                aberturas.append(grupo * ms_alvo)
                fechamentos.append(ultimo)
            grupo, conta = g, 0
        conta += 1
        ultimo = c.fechamento[i]
    if grupo is not None and conta == por_grupo:
        aberturas.append(grupo * ms_alvo)
        fechamentos.append(ultimo)
    return aberturas, fechamentos


def tendencia_em(t_htf: list[int], e_curta: list, e_longa: list, ms_htf: int,
                 t_limite: int, desde: int = 0) -> tuple[int, int]:
    """
    Tendencia (+1 alta, -1 baixa, 0 sem dado) do ultimo candle do periodo maior
    que FECHOU ate t_limite. Devolve (tendencia, indice) para o chamador
    continuar a busca de onde parou.

    Regra conservadora: o candle maior so vale se fechou ate a ABERTURA do candle
    menor (t_limite). As 10:00 o candle de 15 min das 9:45 usa o de 1 h das 8:00,
    nao o das 9:00, que fecha junto com ele. Assim o monitor nunca depende de
    qual mensagem chegou primeiro da Binance, e o backtest decide igual.
    """
    k = desde
    while k + 1 < len(t_htf) and t_htf[k + 1] + ms_htf <= t_limite:
        k += 1
    if not t_htf or t_htf[k] + ms_htf > t_limite:
        return 0, k
    if e_curta[k] is None or e_longa[k] is None:
        return 0, k
    return (1 if e_curta[k] > e_longa[k] else -1), k


def alinhamento(c, n_curta: int = 50, n_longa: int = 200) -> list[int]:
    """
    Para cada candle: +1 se TODOS os periodos acima estao em alta, -1 se todos
    em baixa, 0 se misto, sem dado ou sem periodo acima (24 h).
    """
    n = len(c.fechamento)
    base = ms_base(c)
    if base not in ACIMA:
        return [0] * n
    por_htf = []
    for ms_htf in ACIMA[base]:
        t_htf, f_htf = reamostrar(c, ms_htf, base)
        ec, el = ind.ema(f_htf, n_curta), ind.ema(f_htf, n_longa)
        tend, k = [0] * n, 0
        for i in range(n):
            tend[i], k = tendencia_em(t_htf, ec, el, ms_htf, c.t[i], k)
        por_htf.append(tend)
    saida = [0] * n
    for i in range(n):
        vals = {t[i] for t in por_htf}
        if vals == {1}:
            saida[i] = 1
        elif vals == {-1}:
            saida[i] = -1
    return saida


def filtrar(c, sinais: list[int], lado: str = "ambos", alinhar: bool = False) -> list[int]:
    """
    Os dois filtros que o usuario liga sob demanda.
      lado: "compra" so deixa long, "venda" so short, "ambos" deixa tudo.
      alinhar: so deixa o sinal que vai na mesma direcao dos periodos acima.
    """
    if lado not in ("ambos", "compra", "venda"):
        raise ValueError(f"lado invalido: {lado}")
    al = alinhamento(c) if alinhar else None
    saida = []
    for i, x in enumerate(sinais):
        if x == 0 or (lado == "compra" and x < 0) or (lado == "venda" and x > 0):
            saida.append(0)
        elif al is not None and al[i] != x:
            saida.append(0)
        else:
            saida.append(x)
    return saida


def sinais(nome: str, c, lado: str = "ambos", alinhar: bool = False) -> list[int]:
    """Sinais da estrategia ja com os filtros. E por aqui que o backtest pede."""
    return filtrar(c, gerar(nome, c), lado, alinhar)


# --------------------------------------------------------------------------- #
# registro
# --------------------------------------------------------------------------- #

def com_fluxo(c, sinais: list[int], n: int = 3) -> list[int]:
    """Mantem so o sinal em que a agressao dos ultimos n candles (o do sinal incluido,
    ja fechado) vai a favor: compra com mais compra agressora, venda com mais venda.
    Sem a coluna de agressao, nenhum sinal: a estrategia nao roda sem o dado."""
    d = ind.delta_agressao(c.volume, c.agressora)
    out = []
    for i, s in enumerate(sinais):
        janela = d[max(0, i - n + 1):i + 1]
        if s == 0 or len(janela) < n or any(x is None for x in janela):
            out.append(0)
            continue
        media = sum(janela) / n
        out.append(s if (s > 0 and media > 0) or (s < 0 and media < 0) else 0)
    return out


def confl3_fluxo(c) -> list[int]:
    return com_fluxo(c, confluencia_3(c))


def canal_fluxo(c) -> list[int]:
    return com_fluxo(c, rompimento_canal(c))


# Estrategias que precisam da coluna de compra agressora (so a Binance informa).
PRECISA_AGRESSORA = {"confl3_fluxo", "canal_fluxo"}


REGISTRO: dict[str, tuple[Callable, str]] = {
    "moeda":      (moeda,               "CONTROLE — direcao sorteada, sem vantagem"),
    "comprado":   (sempre_compra,       "CONTROLE — comprado sempre, mede a tendencia"),
    "ema":        (ema_cruzamento,      "cruzamento de EMA 9/21"),
    "canal":      (rompimento_canal,    "rompimento de canal de 20 barras"),
    "momento":    (momento_atr,         "continuacao de momento filtrada por ATR"),
    "rsi":        (rsi_reversao,        "reversao por RSI 14 (30/70)"),
    "bollinger":  (bollinger_reversao,  "reversao na banda de Bollinger 20/2"),
    "vwap":       (vwap_reversao,       "reversao a VWAP de 20 barras"),
    "confl3":     (confluencia_3,       "confluencia — 3 das 5 confirmacoes"),
    "confl4":     (confluencia,         "confluencia — 4 das 5 (recomendado)"),
    "confl5":     (confluencia_5,       "confluencia — 5 das 5, so o livro-texto"),
    "engolfo":    (engolfo,             "padrao: engolfo de alta e de baixa"),
    "divergencia": (divergencia_rsi,    "padrao: divergencia entre preco e RSI 14"),
    "confl3_fluxo": (confl3_fluxo,      "confluencia 3/5 so com a agressao a favor (Binance)"),
    "canal_fluxo": (canal_fluxo,        "rompimento do canal so com a agressao a favor (Binance)"),
}


def gerar(nome: str, candles) -> list[int]:
    """Gera os sinais da estrategia pelo nome registrado."""
    if nome not in REGISTRO:
        raise KeyError(
            f"estrategia '{nome}' nao existe. Disponiveis: {', '.join(REGISTRO)}"
        )
    return REGISTRO[nome][0](candles)


def listar() -> str:
    largura = max(len(k) for k in REGISTRO)
    return "\n".join(
        f"  {nome.ljust(largura)}  {desc}" for nome, (_, desc) in REGISTRO.items()
    )
