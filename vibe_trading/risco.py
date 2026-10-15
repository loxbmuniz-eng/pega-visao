#!/usr/bin/env python3
"""
Gestao de risco da conta real: o que mantem a banca viva enquanto a vantagem nao
aparece (e depois que aparece, porque sequencia ruim acontece com qualquer regra).

  ruina       quanto o risco por operacao derruba a banca numa sequencia ruim:
              simulacao de milhares de caminhos com o acerto e a relacao lucro/risco
  ajuste      o risco cai sozinho quando a banca cai do pico (metade a -10%, um
              quarto a -20%) e volta ao normal quando a banca volta a menos de 10%
              do pico
  semana      disjuntor da semana: -10% da banca na semana (Brasilia) e acabou a semana
  desempenho  o retrato dos resultados anotados: acerto, ganho e perda media,
              expectativa por operacao, fator de lucro, pior queda, pior sequencia

Tudo a partir dos /resultado anotados (o sistema nao ve a conta). So biblioteca padrao.
"""

from __future__ import annotations

import random

from ficha import _br, fmt_usdt

RISCO_PADRAO = {
    "ligado": True,             # false desliga o ajuste pela queda E o disjuntor da semana
    "queda_metade_pct": 10.0,   # banca 10% abaixo do pico: risco pela metade
    "queda_quarto_pct": 20.0,   # 20% abaixo do pico: um quarto do risco
    "semana_max_pct": 10.0,     # perda da semana (Brasilia) que encerra a semana
}
DIA = 86_400_000


# --------------------------------------------------------------------------- #
# ruina: o que a sequencia ruim faz
# --------------------------------------------------------------------------- #

def simular(acerto_pct: float, rr: float, risco_pct: float, operacoes: int = 100, caminhos: int = 5000,
            semente: int = 7, ajustar: bool = False, cfg: dict | None = None) -> dict:
    """Milhares de caminhos de `operacoes` operacoes: cada uma perde `risco_pct`% da banca
    do momento ou ganha `rr` vezes isso, com chance `acerto_pct`%. Devolve a chance de a
    pior queda passar de 20%, 30% e 50%, a mediana da banca final (banca inicial = 1) e a
    chance de terminar no lucro. Com ajustar=True, aplica a reducao de risco pela queda."""
    cfg = {**RISCO_PADRAO, **(cfg or {})}
    sorteio = random.Random(semente)
    p, r = acerto_pct / 100, risco_pct / 100
    finais, quedas = [], []
    for _ in range(caminhos):
        banca = pico = 1.0
        pior = 0.0
        for _ in range(operacoes):
            queda = (pico - banca) / pico * 100
            fator = multiplicador(queda, cfg) if ajustar else 1.0
            arriscado = banca * r * fator
            banca += arriscado * rr if sorteio.random() < p else -arriscado
            if banca <= 0:
                banca, pior = 0.0, 100.0
                break
            pico = max(pico, banca)
            pior = max(pior, (pico - banca) / pico * 100)
        finais.append(banca)
        quedas.append(pior)
    finais.sort()
    n = len(finais)
    return {"queda_20": sum(1 for q in quedas if q >= 20) / n * 100,
            "queda_30": sum(1 for q in quedas if q >= 30) / n * 100,
            "queda_50": sum(1 for q in quedas if q >= 50) / n * 100,
            "mediana_final": finais[n // 2], "lucro": sum(1 for f in finais if f > 1) / n * 100,
            "expectativa_r": acerto_pct / 100 * rr - (1 - acerto_pct / 100)}


def perdas_seguidas_provaveis(acerto_pct: float, operacoes: int = 100) -> int:
    """A maior sequencia de perdas que se espera ver em `operacoes` operacoes (regra
    pratica: log(operacoes) / -log(chance de perder)). Com 40% de acerto, em 100
    operacoes, ~9 perdas seguidas e o normal, nao azar."""
    import math
    q = 1 - acerto_pct / 100
    if q <= 0:
        return 0
    if q >= 1:
        return operacoes
    return round(math.log(operacoes) / -math.log(q))


# --------------------------------------------------------------------------- #
# ajuste pela queda e disjuntor da semana
# --------------------------------------------------------------------------- #

def multiplicador(queda_pct: float, cfg: dict | None = None) -> float:
    cfg = {**RISCO_PADRAO, **(cfg or {})}
    if not cfg["ligado"]:
        return 1.0
    if queda_pct >= cfg["queda_quarto_pct"]:
        return 0.25
    if queda_pct >= cfg["queda_metade_pct"]:
        return 0.5
    return 1.0


def curva(banca_inicial: float, resultados: list[dict]) -> list[float]:
    """A banca depois de cada resultado anotado, em ordem."""
    banca, saida = banca_inicial, []
    for r in sorted(resultados, key=lambda x: x["quando_ms"]):
        banca += r["valor"]
        saida.append(banca)
    return saida


def ajuste(banca_inicial: float, resultados: list[dict], cfg: dict | None = None) -> dict:
    """Pico, banca de hoje, queda desde o pico e o multiplicador do risco."""
    cfg = {**RISCO_PADRAO, **(cfg or {})}
    pontos = [banca_inicial] + curva(banca_inicial, resultados)
    pico, atual = max(pontos), pontos[-1]
    queda = (pico - atual) / pico * 100 if pico > 0 else 0.0
    m = multiplicador(queda, cfg)
    motivo = ""
    if m < 1:
        motivo = (f"banca {_br(queda, 1)}% abaixo do pico de {_br(pico, 2)} USDT: risco reduzido a "
                  f"{'metade' if m == 0.5 else 'um quarto'} ate a banca voltar a menos de "
                  f"{cfg['queda_metade_pct']:g}% do pico")
    return {"pico": pico, "atual": atual, "queda_pct": queda, "multiplicador": m, "motivo": motivo}


def semana_brasilia(ms: int) -> int:
    """Numero da semana de segunda a domingo no horario de Brasilia (UTC-3)."""
    dia = (ms - 3 * 3_600_000) // DIA
    return (dia + 3) // 7


def disjuntor_semana(resultados: list[dict], agora_ms: int, banca: float, cfg: dict | None = None) -> dict:
    cfg = {**RISCO_PADRAO, **(cfg or {})}
    semana = semana_brasilia(agora_ms)
    soma = sum(r["valor"] for r in resultados if semana_brasilia(r["quando_ms"]) == semana)
    limite = -banca * cfg["semana_max_pct"] / 100
    armado = bool(cfg["ligado"]) and soma <= limite
    return {"armado": armado, "soma": soma, "limite": limite,
            "motivo": (f"disjuntor da semana: a semana esta em {fmt_usdt(soma)} USDT, alem do limite "
                       f"de {cfg['semana_max_pct']:g}% da banca ({_br(limite, 2)}). Pare ate segunda") if armado else ""}


# --------------------------------------------------------------------------- #
# desempenho dos resultados anotados
# --------------------------------------------------------------------------- #

def desempenho(banca_inicial: float, resultados: list[dict]) -> dict:
    vs = [r["valor"] for r in sorted(resultados, key=lambda x: x["quando_ms"])]
    ganhos = [v for v in vs if v > 0]
    perdas = [-v for v in vs if v < 0]
    pontos = [banca_inicial] + curva(banca_inicial, resultados)
    pico, pior = pontos[0], 0.0
    for b in pontos:
        pico = max(pico, b)
        pior = max(pior, (pico - b) / pico * 100 if pico > 0 else 0.0)
    seq = maior = 0
    for v in vs:
        seq = seq + 1 if v < 0 else 0
        maior = max(maior, seq)
    n = len(vs)
    return {"n": n, "acerto": (len(ganhos) / n * 100) if n else 0.0, "empates": n - len(ganhos) - len(perdas),
            "ganho_medio": (sum(ganhos) / len(ganhos)) if ganhos else 0.0,
            "perda_media": (sum(perdas) / len(perdas)) if perdas else 0.0,
            "por_operacao": (sum(vs) / n) if n else 0.0, "total": sum(vs),
            "fator_lucro": (sum(ganhos) / sum(perdas)) if perdas else None,
            "pior_queda_pct": pior, "maior_sequencia_perdas": maior, "banca": pontos[-1]}


def texto_desempenho(d: dict, aj: dict) -> str:
    if not d["n"]:
        return "Nenhum resultado anotado ainda. Depois de cada operacao real fechada: /resultado -2,1 (ou +4)."
    fl = _br(d["fator_lucro"], 2) if d["fator_lucro"] is not None else "sem perdas ainda"
    L = [f"Desempenho real ({d['n']} operacoes anotadas"
         + (f", {d['empates']} no zero" if d["empates"] else "") + ")",
         f"acerto {d['acerto']:.0f}% · ganho medio {fmt_usdt(d['ganho_medio'])} · "
         f"perda media {fmt_usdt(-d['perda_media'])} USDT",
         f"por operacao {fmt_usdt(d['por_operacao'])} USDT · total {fmt_usdt(d['total'])} · fator de lucro {fl}",
         f"banca {_br(d['banca'], 2)} USDT · pior queda {_br(d['pior_queda_pct'], 1)}% · "
         f"maior sequencia de perdas {d['maior_sequencia_perdas']}"]
    if aj["multiplicador"] < 1:
        L.append(aj["motivo"].upper())
    if d["n"] < 30:
        L.append(f"Com {d['n']} operacoes isto ainda e mais sorte que habilidade: o retrato vale a partir de 30.")
    L.append("Fator de lucro = tudo que ganhou / tudo que perdeu. Abaixo de 1 perde dinheiro; "
             "profissional mira 1,5 ou mais.")
    return "\n".join(L)


def texto_ruina(acerto_pct: float = 40.0, rr: float = 2.0, operacoes: int = 100, caminhos: int = 5000) -> str:
    """A tabela que mostra por que o risco por operacao decide quem sobrevive, sem e com
    o ajuste pela queda (metade a -10% do pico, um quarto a -20%)."""
    exp = acerto_pct / 100 * rr - (1 - acerto_pct / 100)
    L = [f"{operacoes} operacoes com acerto de {acerto_pct:.0f}% e alvo {_br(rr, 1)}x o risco "
         f"({'SEM vantagem' if exp <= 0.005 else f'vantagem de {_br(exp, 2)}R por operacao'}); "
         f"{caminhos} sequencias sorteadas",
         "risco  | chance de cair 30% | chance de cair 50% | banca final (mediana)",
         "       |  sem ajuste · com  |  sem ajuste · com  |  sem ajuste · com"]
    for risco in (1, 2, 5, 10):
        a = simular(acerto_pct, rr, risco, operacoes, caminhos)
        b = simular(acerto_pct, rr, risco, operacoes, caminhos, ajustar=True)
        L.append(f"{risco:>4d}%  | {a['queda_30']:8.0f}% · {b['queda_30']:3.0f}%  | "
                 f"{a['queda_50']:8.0f}% · {b['queda_50']:3.0f}%  | "
                 f"{a['mediana_final'] * 100:7.0f}% · {b['mediana_final'] * 100:3.0f}%")
    L.append(f"Com {acerto_pct:.0f}% de acerto, {perdas_seguidas_provaveis(acerto_pct, operacoes)} perdas seguidas "
             f"em {operacoes} operacoes e o normal, nao azar.")
    return "\n".join(L)
