#!/usr/bin/env python3
"""
Caderno de experimentos: cada tentativa testada fica registrada, e o numero de
tentativas entra na prova contra sorte (estatistica.sharpe_deflacionado).

Uma tentativa e TUDO que muda o resultado: estrategia, periodo, lado, filtro,
alavancagem, stop, alvo, taxa, margem de manutencao, margem, prazo maximo,
janela de dados e fonte. Mudar qualquer um deles e outra hipotese. A bateria e
o --robustez do backtest registram pela mesma funcao.
"""

from __future__ import annotations

import json
import os
import time

import estatistica

CADERNO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "caderno.jsonl")


def chave_hipotese(nome: str, tf: str, lado: str, alinhar: bool, p, modo: str = "90d", fonte: str = "binance") -> str:
    """Identidade de uma tentativa: mudar qualquer peca e outra hipotese."""
    return (f"{nome}|{tf}|{lado}|{'alinhado' if alinhar else 'livre'}|alav{p.alav:g}|stop{p.stop:g}|rr{p.rr:g}"
            f"|taxa{p.taxa:g}|mm{p.mm:g}|margem{p.margem:g}|prazo{p.max_barras}|{modo}|{fonte}")


def registrar(caderno: str, registro: dict) -> None:
    with open(caderno, "a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False) + "\n")


def registrar_avaliacao(caderno: str, avaliacao: dict, nome: str, tf: str, ativo: str, lado: str, alinhar: bool,
                        p, modo: str, fonte: str, candles: int, quando: str | None = None) -> None:
    """Uma linha por (tentativa, ativo), com o Sharpe por operacao para a prova contra sorte."""
    t = avaliacao["placar"]
    registrar(caderno, {
        "quando": quando or time.strftime("%Y-%m-%d %H:%M"),
        "hipotese": chave_hipotese(nome, tf, lado, alinhar, p, modo, fonte),
        "estrategia": nome, "periodo": tf, "ativo": ativo, "candles": candles,
        "veredito": avaliacao["veredito"], "bate_moedas": round(avaliacao["media_bate"], 1),
        "janelas_positivas": avaliacao["positivas"], "janelas": avaliacao["janelas"],
        "modo": modo, "fonte": fonte, "operacoes": len(t.resultados),
        "acerto": round(t.acerto, 1), "por_operacao": round(t.por_operacao, 4),
        "sharpe_op": round(estatistica.sharpe(t.resultados), 5),
    })


def tentativas_no_caderno(caderno: str) -> int:
    if not os.path.exists(caderno):
        return 0
    vistas = set()
    with open(caderno, encoding="utf-8") as f:
        for linha in f:
            try:
                vistas.add(json.loads(linha)["hipotese"])
            except (ValueError, KeyError):
                continue
    return len(vistas)


def sharpes_no_caderno(caderno: str, maximo: int = 2000) -> list[float]:
    """O Sharpe por operacao de cada registro (ate os `maximo` mais recentes): a
    dispersao deles e a dispersao que a sorte produz nas tentativas."""
    if not os.path.exists(caderno):
        return []
    valores = []
    with open(caderno, encoding="utf-8") as f:
        for linha in f:
            try:
                v = json.loads(linha).get("sharpe_op")
            except ValueError:
                continue
            if isinstance(v, (int, float)):
                valores.append(float(v))
    return valores[-maximo:]
