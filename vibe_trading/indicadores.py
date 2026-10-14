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


def delta_agressao(volume: list[float], agressora: list[float]) -> list[float | None]:
    """Saldo da agressao em cada candle, de -1 (so venda agressora) a +1 (so compra
    agressora): (compra - venda) / volume = (2 x compra agressora - volume) / volume.
    Sem a coluna de agressao (fonte que nao informa), tudo None."""
    if len(agressora) != len(volume):
        return [None] * len(volume)
    return [None if not v else (2 * a - v) / v for a, v in zip(agressora, volume)]


def vwap_diaria(maximas: list[float], minimas: list[float], fechamentos: list[float],
                volumes: list[float], t: list[int]) -> list[float | None]:
    """Preco medio do dia ponderado por volume, recomecando a 00:00 UTC. O valor do
    candle i inclui o proprio candle i (ja fechado) e nada depois dele."""
    saida: list[float | None] = [None] * len(fechamentos)
    dia_atual, pv, vol = None, 0.0, 0.0
    for k in range(len(fechamentos)):
        dia = t[k] // 86_400_000
        if dia != dia_atual:
            dia_atual, pv, vol = dia, 0.0, 0.0
        tipico = (maximas[k] + minimas[k] + fechamentos[k]) / 3.0
        pv += tipico * volumes[k]
        vol += volumes[k]
        saida[k] = pv / vol if vol else None
    return saida



def perfil_volume(maximas: list[float], minimas: list[float], volumes: list[float],
                  degraus: int = 50, area: float = 0.70) -> dict | None:
    """Perfil de volume da janela inteira: o volume de cada candle e espalhado por
    igual entre a minima e a maxima dele, em `degraus` faixas de preco. Devolve
      poc  o preco com mais volume negociado (o "preco justo" da janela);
      val, vah  a base e o topo da area de valor: as faixas em volta do POC que
                somam `area` (70%) do volume, crescendo para o lado de maior volume.
    Candle nao informa onde o volume aconteceu dentro dele; espalhar por igual e a
    aproximacao padrao. Sem amplitude ou sem volume: None."""
    if not maximas or len(maximas) != len(minimas) or len(maximas) != len(volumes):
        return None
    lo, hi = min(minimas), max(maximas)
    if hi <= lo or sum(volumes) <= 0:
        return None
    passo = (hi - lo) / degraus
    vol = [0.0] * degraus
    for h, l, v in zip(maximas, minimas, volumes):
        if v <= 0:
            continue
        a = min(degraus - 1, int((l - lo) / passo))
        b = min(degraus - 1, int((h - lo) / passo))
        parte = v / (b - a + 1)
        for k in range(a, b + 1):
            vol[k] += parte
    poc = max(range(degraus), key=lambda k: vol[k])  # empate: a faixa mais baixa
    total, dentro, baixo, alto = sum(vol), vol[poc], poc, poc
    while dentro < area * total and (baixo > 0 or alto < degraus - 1):
        acima = vol[alto + 1] if alto + 1 < degraus else -1.0
        abaixo = vol[baixo - 1] if baixo > 0 else -1.0
        if acima >= abaixo:
            alto += 1
            dentro += acima
        else:
            baixo -= 1
            dentro += abaixo
    return {"poc": lo + (poc + 0.5) * passo, "val": lo + baixo * passo, "vah": lo + (alto + 1) * passo}
