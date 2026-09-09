"""Indicadores. Todos devolvem lista do MESMO tamanho da entrada, com None
onde ainda não há dado suficiente.

POR QUE None e não zero: zero é um valor válido de indicador. Preencher o
começo com zero faz a estratégia operar num período em que ela não sabia de
nada — e isso infla o backtest sem ninguém perceber.
"""
from __future__ import annotations


def media_simples(valores: list[float], periodo: int) -> list[float | None]:
    if periodo < 1:
        raise ValueError("periodo precisa ser >= 1")
    saida: list[float | None] = []
    soma = 0.0
    for i, v in enumerate(valores):
        soma += v
        if i >= periodo:
            soma -= valores[i - periodo]
        saida.append(soma / periodo if i >= periodo - 1 else None)
    return saida


def media_exponencial(valores: list[float], periodo: int) -> list[float | None]:
    if periodo < 1:
        raise ValueError("periodo precisa ser >= 1")
    k = 2 / (periodo + 1)
    saida: list[float | None] = [None] * len(valores)
    if len(valores) < periodo:
        return saida
    anterior = sum(valores[:periodo]) / periodo   # semeia com a média simples
    saida[periodo - 1] = anterior
    for i in range(periodo, len(valores)):
        anterior = valores[i] * k + anterior * (1 - k)
        saida[i] = anterior
    return saida


def ifr(valores: list[float], periodo: int = 14) -> list[float | None]:
    """Índice de Força Relativa (RSI), suavizado por Wilder."""
    saida: list[float | None] = [None] * len(valores)
    if len(valores) <= periodo:
        return saida
    ganhos = perdas = 0.0
    for i in range(1, periodo + 1):
        d = valores[i] - valores[i - 1]
        ganhos += max(d, 0.0)
        perdas += max(-d, 0.0)
    mg, mp = ganhos / periodo, perdas / periodo
    saida[periodo] = 100.0 if mp == 0 else 100 - 100 / (1 + mg / mp)
    for i in range(periodo + 1, len(valores)):
        d = valores[i] - valores[i - 1]
        mg = (mg * (periodo - 1) + max(d, 0.0)) / periodo
        mp = (mp * (periodo - 1) + max(-d, 0.0)) / periodo
        saida[i] = 100.0 if mp == 0 else 100 - 100 / (1 + mg / mp)
    return saida


def amplitude_media(barras, periodo: int = 14) -> list[float | None]:
    """ATR — serve para dimensionar stop em unidade de volatilidade."""
    if not barras:
        return []
    amplitudes = [barras[0].maxima - barras[0].minima]
    for i in range(1, len(barras)):
        f = barras[i - 1].fechamento
        amplitudes.append(max(
            barras[i].maxima - barras[i].minima,
            abs(barras[i].maxima - f),
            abs(barras[i].minima - f),
        ))
    return media_simples(amplitudes, periodo)


def desvio_padrao(valores: list[float], periodo: int) -> list[float | None]:
    saida: list[float | None] = [None] * len(valores)
    for i in range(periodo - 1, len(valores)):
        janela = valores[i - periodo + 1: i + 1]
        m = sum(janela) / periodo
        saida[i] = (sum((v - m) ** 2 for v in janela) / periodo) ** 0.5
    return saida


def maxima_movel(valores: list[float], periodo: int) -> list[float | None]:
    return [None if i < periodo - 1 else max(valores[i - periodo + 1: i + 1]) for i in range(len(valores))]


def minima_movel(valores: list[float], periodo: int) -> list[float | None]:
    return [None if i < periodo - 1 else min(valores[i - periodo + 1: i + 1]) for i in range(len(valores))]
