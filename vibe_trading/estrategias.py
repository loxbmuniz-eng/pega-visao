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
# registro
# --------------------------------------------------------------------------- #

REGISTRO: dict[str, tuple[Callable, str]] = {
    "moeda":      (moeda,               "CONTROLE — direcao sorteada, sem vantagem"),
    "comprado":   (sempre_compra,       "CONTROLE — comprado sempre, mede a tendencia"),
    "ema":        (ema_cruzamento,      "cruzamento de EMA 9/21"),
    "canal":      (rompimento_canal,    "rompimento de canal de 20 barras"),
    "momento":    (momento_atr,         "continuacao de momento filtrada por ATR"),
    "rsi":        (rsi_reversao,        "reversao por RSI 14 (30/70)"),
    "bollinger":  (bollinger_reversao,  "reversao na banda de Bollinger 20/2"),
    "vwap":       (vwap_reversao,       "reversao a VWAP de 20 barras"),
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
