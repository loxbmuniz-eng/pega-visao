#!/usr/bin/env python3
"""
Indicadores tecnicos, sem dependencia externa.

Todos recebem listas de float e devolvem listas do MESMO tamanho da entrada,
com None nas posicoes em que o indicador ainda nao tem historico suficiente.

Essa regra de tamanho igual e deliberada: indice i da saida corresponde sempre
ao candle i da entrada. Indicador que encurta a lista e a origem classica de
erro de alinhamento em backtest — o sinal escorrega um candle e o resultado
fica otimista sem ninguem perceber.
"""

from __future__ import annotations


def sma(valores: list[float], n: int) -> list[float | None]:
    """Media movel simples."""
    saida: list[float | None] = [None] * len(valores)
    if n <= 0:
        return saida
    soma = 0.0
    for i, v in enumerate(valores):
        soma += v
        if i >= n:
            soma -= valores[i - n]
        if i >= n - 1:
            saida[i] = soma / n
    return saida


def ema(valores: list[float], n: int) -> list[float | None]:
    """Media movel exponencial, semeada pela SMA das primeiras n amostras."""
    saida: list[float | None] = [None] * len(valores)
    if n <= 0 or len(valores) < n:
        return saida
    k = 2.0 / (n + 1.0)
    atual = sum(valores[:n]) / n
    saida[n - 1] = atual
    for i in range(n, len(valores)):
        atual = valores[i] * k + atual * (1 - k)
        saida[i] = atual
    return saida


def desvio(valores: list[float], n: int) -> list[float | None]:
    """Desvio padrao populacional em janela movel."""
    saida: list[float | None] = [None] * len(valores)
    if n <= 1:
        return saida
    for i in range(n - 1, len(valores)):
        janela = valores[i - n + 1 : i + 1]
        m = sum(janela) / n
        var = sum((x - m) ** 2 for x in janela) / n
        saida[i] = var ** 0.5
    return saida


def rsi(fechamentos: list[float], n: int = 14) -> list[float | None]:
    """RSI de Wilder."""
    saida: list[float | None] = [None] * len(fechamentos)
    if len(fechamentos) <= n:
        return saida

    ganhos = 0.0
    perdas = 0.0
    for i in range(1, n + 1):
        d = fechamentos[i] - fechamentos[i - 1]
        ganhos += max(d, 0.0)
        perdas += max(-d, 0.0)
    mg = ganhos / n
    mp = perdas / n
    saida[n] = 100.0 if mp == 0 else 100.0 - (100.0 / (1.0 + mg / mp))

    for i in range(n + 1, len(fechamentos)):
        d = fechamentos[i] - fechamentos[i - 1]
        mg = (mg * (n - 1) + max(d, 0.0)) / n
        mp = (mp * (n - 1) + max(-d, 0.0)) / n
        saida[i] = 100.0 if mp == 0 else 100.0 - (100.0 / (1.0 + mg / mp))

    return saida


def true_range(maximas: list[float], minimas: list[float],
               fechamentos: list[float]) -> list[float | None]:
    """Amplitude verdadeira, candle a candle."""
    saida: list[float | None] = [None] * len(maximas)
    for i in range(1, len(maximas)):
        saida[i] = max(
            maximas[i] - minimas[i],
            abs(maximas[i] - fechamentos[i - 1]),
            abs(minimas[i] - fechamentos[i - 1]),
        )
    return saida


def atr(maximas: list[float], minimas: list[float],
        fechamentos: list[float], n: int = 14) -> list[float | None]:
    """ATR de Wilder."""
    tr = true_range(maximas, minimas, fechamentos)
    saida: list[float | None] = [None] * len(maximas)
    validos = [x for x in tr if x is not None]
    if len(validos) < n:
        return saida

    atual = sum(tr[1 : n + 1]) / n  # type: ignore[arg-type]
    saida[n] = atual
    for i in range(n + 1, len(maximas)):
        atual = (atual * (n - 1) + tr[i]) / n  # type: ignore[operator]
        saida[i] = atual
    return saida


def vwap_janela(maximas: list[float], minimas: list[float],
                fechamentos: list[float], volumes: list[float],
                n: int = 20) -> list[float | None]:
    """VWAP em janela movel, usando preco tipico (max+min+fech)/3."""
    saida: list[float | None] = [None] * len(fechamentos)
    if n <= 0:
        return saida
    tipico = [(maximas[i] + minimas[i] + fechamentos[i]) / 3.0
              for i in range(len(fechamentos))]
    for i in range(n - 1, len(fechamentos)):
        pv = 0.0
        vol = 0.0
        for j in range(i - n + 1, i + 1):
            pv += tipico[j] * volumes[j]
            vol += volumes[j]
        saida[i] = (pv / vol) if vol > 0 else None
    return saida


def ruido_tipico(maximas: list[float], minimas: list[float],
                 fechamentos: list[float]) -> float:
    """
    Oscilacao normal de um candle, em % do preco: a MEDIANA de (max-min)/fech.

    Esse e o numero que decide se um stop e executavel. Mediana e nao media
    porque alguns candles de noticia distorcem a media e fariam o stop parecer
    mais folgado do que e.
    """
    amostras = [
        (maximas[i] - minimas[i]) / fechamentos[i] * 100.0
        for i in range(len(fechamentos))
        if fechamentos[i] > 0
    ]
    if not amostras:
        return 0.0
    amostras.sort()
    meio = len(amostras) // 2
    if len(amostras) % 2:
        return amostras[meio]
    return (amostras[meio - 1] + amostras[meio]) / 2.0
