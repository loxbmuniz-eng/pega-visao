#!/usr/bin/env python3
"""
Prova contra sorte: o Sharpe deflacionado (Bailey e Lopez de Prado, 2014).

Quanto mais estrategias se testa, maior o melhor resultado que aparece SO POR
SORTE. Com 1.000 tentativas sem vantagem nenhuma, o melhor Sharpe esperado ja e
cerca de 3,26 vezes o desvio dos Sharpes. O Sharpe deflacionado responde: dado o
numero de tentativas registradas no caderno, qual a chance de o Sharpe desta
estrategia ser maior que o melhor que a sorte daria? Abaixo de 95%, nao passa.

Aqui o Sharpe e POR OPERACAO (media / desvio dos resultados de cada operacao),
e o numero de observacoes e o numero de operacoes. So biblioteca padrao.
"""

from __future__ import annotations

import math
from statistics import NormalDist, fmean

EULER_MASCHERONI = 0.5772156649015329
_NORMAL = NormalDist()


def sharpe(retornos: list[float]) -> float:
    """Media sobre desvio padrao amostral. Menos de 2 valores ou desvio zero: 0."""
    n = len(retornos)
    if n < 2:
        return 0.0
    m = fmean(retornos)
    var = sum((x - m) ** 2 for x in retornos) / (n - 1)
    return m / math.sqrt(var) if var > 0 else 0.0


def momentos(retornos: list[float]) -> tuple[float, float]:
    """(assimetria, curtose) da amostra. Curtose NAO em excesso: a normal da 3."""
    n = len(retornos)
    if n < 2:
        return 0.0, 3.0
    m = fmean(retornos)
    s2 = sum((x - m) ** 2 for x in retornos) / n
    if s2 == 0:
        return 0.0, 3.0
    s3 = sum((x - m) ** 3 for x in retornos) / n
    s4 = sum((x - m) ** 4 for x in retornos) / n
    return s3 / s2 ** 1.5, s4 / s2 ** 2


def sharpe_maximo_esperado(n_tentativas: int, variancia_sharpe: float) -> float:
    """O melhor Sharpe que N tentativas SEM vantagem dariam, em media."""
    if n_tentativas <= 1 or variancia_sharpe <= 0:
        return 0.0
    z = _NORMAL.inv_cdf
    return math.sqrt(variancia_sharpe) * ((1 - EULER_MASCHERONI) * z(1 - 1 / n_tentativas)
                                          + EULER_MASCHERONI * z(1 - 1 / (n_tentativas * math.e)))


def sharpe_deflacionado(retornos: list[float], n_tentativas: int,
                        variancia_entre_tentativas: float | None = None) -> dict:
    """
    Chance (0 a 1) de o Sharpe verdadeiro superar o que a sorte daria em
    `n_tentativas`. Sem a variancia dos Sharpes entre as tentativas, usa a
    variancia do proprio estimador do Sharpe (mais conservador com poucas operacoes).
    """
    t = len(retornos)
    sr = sharpe(retornos)
    assim, curt = momentos(retornos)
    base = {"sharpe": sr, "operacoes": t, "tentativas": n_tentativas, "assimetria": assim, "curtose": curt}
    denominador = 1 - assim * sr + (curt - 1) / 4 * sr ** 2
    if t < 3 or denominador <= 0:
        return {**base, "sharpe_sorte": 0.0, "dsr": 0.0}
    var = variancia_entre_tentativas if variancia_entre_tentativas and variancia_entre_tentativas > 0 \
        else denominador / (t - 1)
    sr0 = sharpe_maximo_esperado(n_tentativas, var)
    z = (sr - sr0) * math.sqrt(t - 1) / math.sqrt(denominador)
    return {**base, "sharpe_sorte": sr0, "dsr": _NORMAL.cdf(z)}


def variancia(valores: list[float]) -> float | None:
    """Variancia amostral; None com menos de 2 valores."""
    if len(valores) < 2:
        return None
    m = fmean(valores)
    return sum((x - m) ** 2 for x in valores) / (len(valores) - 1)
