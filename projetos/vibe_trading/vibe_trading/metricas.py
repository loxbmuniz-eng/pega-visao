"""Métricas de desempenho, calculadas da curva de patrimônio e dos negócios.

Duas escolhas que mudam o número e que a maioria das ferramentas esconde:

1. **Drawdown é medido sobre o pico histórico**, barra a barra — não sobre o
   início. É o que a pessoa realmente sente na conta.
2. **Sharpe usa 252 pregões e taxa livre de risco explícita.** No Brasil isso
   importa muito: com CDI a 10%+, estratégia que rende 12%% ao ano com o dobro
   da volatilidade do CDI não é boa — e um Sharpe calculado com taxa zero
   diria que é.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

PREGOES_ANO = 252


@dataclass(frozen=True)
class Metricas:
    retorno_total: float
    retorno_anual: float
    volatilidade: float
    sharpe: float
    sortino: float
    rebaixamento_maximo: float
    calmar: float
    taxa_acerto: float
    fator_lucro: float
    negocios: int
    exposicao: float
    custo_total: float

    def como_texto(self, largura: int = 30) -> str:
        linhas = [
            ("Retorno total", f"{self.retorno_total:+.1%}"),
            ("Retorno anualizado", f"{self.retorno_anual:+.1%}"),
            ("Volatilidade anual", f"{self.volatilidade:.1%}"),
            ("Sharpe", f"{self.sharpe:.2f}"),
            ("Sortino", f"{self.sortino:.2f}"),
            ("Rebaixamento máximo", f"{self.rebaixamento_maximo:.1%}"),
            ("Calmar", f"{self.calmar:.2f}"),
            ("Taxa de acerto", f"{self.taxa_acerto:.0%}"),
            ("Fator de lucro", f"{self.fator_lucro:.2f}" if math.isfinite(self.fator_lucro) else "∞"),
            ("Negócios", str(self.negocios)),
            ("Tempo exposto", f"{self.exposicao:.0%}"),
            ("Custo total", f"R$ {self.custo_total:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")),
        ]
        return "\n".join(f"  {nome.ljust(largura)} {valor:>10}" for nome, valor in linhas)


def _retornos(patrimonio: list[float]) -> list[float]:
    return [
        (b / a) - 1
        for a, b in zip(patrimonio, patrimonio[1:])
        if a > 0
    ]


def rebaixamento(patrimonio: list[float]) -> tuple[float, list[float]]:
    """Devolve (pior rebaixamento, série de rebaixamento)."""
    pico = patrimonio[0] if patrimonio else 0.0
    serie = []
    pior = 0.0
    for v in patrimonio:
        pico = max(pico, v)
        queda = (v / pico) - 1 if pico > 0 else 0.0
        serie.append(queda)
        pior = min(pior, queda)
    return pior, serie


def calcular(resultado, taxa_livre_risco: float = 0.10) -> Metricas:
    """taxa_livre_risco: ao ano. O padrão de 10% é uma referência de CDI —
    troque pelo número do período que você está testando."""
    pat = resultado.patrimonio
    if len(pat) < 2:
        raise ValueError("preciso de pelo menos 2 pontos de patrimônio")

    capital = resultado.capital_inicial
    retorno_total = pat[-1] / capital - 1
    anos = len(pat) / PREGOES_ANO
    retorno_anual = (pat[-1] / capital) ** (1 / anos) - 1 if anos > 0 and pat[-1] > 0 else -1.0

    rets = _retornos(pat)
    if len(rets) > 1:
        media = sum(rets) / len(rets)
        var = sum((r - media) ** 2 for r in rets) / (len(rets) - 1)
        vol = math.sqrt(var) * math.sqrt(PREGOES_ANO)
        negativos = [r for r in rets if r < 0]
        vol_baixa = (
            math.sqrt(sum(r**2 for r in negativos) / len(negativos)) * math.sqrt(PREGOES_ANO)
            if negativos else 0.0
        )
    else:
        vol = vol_baixa = 0.0

    excedente = retorno_anual - taxa_livre_risco
    sharpe = excedente / vol if vol > 0 else 0.0
    sortino = excedente / vol_baixa if vol_baixa > 0 else 0.0

    pior, _ = rebaixamento(pat)
    calmar = retorno_anual / abs(pior) if pior < 0 else 0.0

    fechados = [n for n in resultado.negocios if n.preco_saida is not None]
    ganhos = [n.resultado for n in fechados if n.resultado > 0]
    perdas = [-n.resultado for n in fechados if n.resultado < 0]
    taxa_acerto = len(ganhos) / len(fechados) if fechados else 0.0
    fator_lucro = (sum(ganhos) / sum(perdas)) if perdas else (float("inf") if ganhos else 0.0)

    exposicao = (
        sum(1 for e in resultado.exposicao if e != 0) / len(resultado.exposicao)
        if resultado.exposicao else 0.0
    )

    return Metricas(
        retorno_total=retorno_total, retorno_anual=retorno_anual,
        volatilidade=vol, sharpe=sharpe, sortino=sortino,
        rebaixamento_maximo=pior, calmar=calmar,
        taxa_acerto=taxa_acerto, fator_lucro=fator_lucro,
        negocios=len(fechados), exposicao=exposicao,
        custo_total=resultado.custo_total,
    )
