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

import itertools
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


# --------------------------------------------------------------------------- #
# chance de a melhor ser sorte de selecao (Bailey, Borwein, Lopez de Prado e Zhu)
# --------------------------------------------------------------------------- #

def _postos(valores: list[float]) -> list[float]:
    """Posto de cada valor (1 = menor); empates dividem o posto medio."""
    ordem = sorted(range(len(valores)), key=lambda k: valores[k])
    postos = [0.0] * len(valores)
    i = 0
    while i < len(ordem):
        j = i
        while j + 1 < len(ordem) and valores[ordem[j + 1]] == valores[ordem[i]]:
            j += 1
        for k in range(i, j + 1):
            postos[ordem[k]] = (i + j) / 2 + 1
        i = j + 1
    return postos


def pbo(matriz: list[list[float]], blocos: int = 10) -> dict:
    """
    PBO por validacao cruzada combinatoria simetrica (CSCV). `matriz` tem uma linha
    por dia e uma coluna por estrategia testada (o resultado de cada uma naquele
    dia). Corta os dias em `blocos` pedacos seguidos; para cada metade dos pedacos
    usada como teste, escolhe a estrategia de melhor Sharpe nela e ve em que posto
    essa campea fica na OUTRA metade. PBO = fracao das divisoes em que a campea
    fica na metade de baixo fora da amostra. Perto de 50%: escolher a melhor do
    teste nao preve nada; perto de 0: a escolha se sustenta.
    """
    if blocos < 2 or blocos % 2:
        raise ValueError("o numero de blocos precisa ser par e pelo menos 2")
    t = len(matriz)
    n = len(matriz[0]) if matriz else 0
    if n < 2 or t < 2 * blocos:
        return {"pbo": None, "combinacoes": 0, "estrategias": n, "dias": t}
    tam = t // blocos
    # soma, soma dos quadrados e contagem de cada estrategia em cada bloco
    est = []
    for b in range(blocos):
        linhas = matriz[b * tam:(b + 1) * tam] if b < blocos - 1 else matriz[b * tam:]
        est.append([(sum(l[j] for l in linhas), sum(l[j] ** 2 for l in linhas), len(linhas)) for j in range(n)])

    def sharpes(grupo):
        saida = []
        for j in range(n):
            s1 = sum(est[b][j][0] for b in grupo)
            s2 = sum(est[b][j][1] for b in grupo)
            c = sum(est[b][j][2] for b in grupo)
            m = s1 / c
            var = (s2 - c * m * m) / (c - 1) if c > 1 else 0.0
            saida.append(m / math.sqrt(var) if var > 1e-18 else 0.0)
        return saida

    logits = []
    todos = range(blocos)
    for dentro in itertools.combinations(todos, blocos // 2):
        fora = [b for b in todos if b not in dentro]
        r_dentro, r_fora = sharpes(dentro), sharpes(fora)
        campea = max(range(n), key=lambda j: r_dentro[j])
        w = _postos(r_fora)[campea] / (n + 1)
        logits.append(math.log(w / (1 - w)))
    return {"pbo": sum(1 for x in logits if x <= 0) / len(logits), "combinacoes": len(logits),
            "estrategias": n, "dias": t, "logits": logits}
