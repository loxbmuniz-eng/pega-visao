#!/usr/bin/env python3
"""
Guardas do motor. Rodar:  python3 testes/test_motor.py

Cada teste trava um defeito que ja aconteceu ou uma garantia que o README
afirma. Correcao sem guarda e correcao que volta.

1. vazamento de futuro  — sinal em i so usa dados ate i
2. posicao sobreposta   — proxima entrada so depois da saida anterior
3. paridade Python x JS — monitor.html decide igual a estrategias.confluencia
4. gatilho obrigatorio  — confluencia nunca entra sem rompimento do canal
"""

from __future__ import annotations

import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, RAIZ)

import backtest as bt  # noqa: E402
import estrategias as est  # noqa: E402
import indicadores as ind  # noqa: E402


def serie_sintetica(n: int, semente: int, tendencia: bool = False) -> bt.Serie:
    rnd = random.Random(semente)
    px, drift = 60000.0, 0.0
    s = bt.Serie()
    for _ in range(n):
        if tendencia:
            drift = 0.97 * drift + rnd.gauss(0, 0.00012)
        nxt = px * (1 + drift + rnd.gauss(0, 0.0008))
        s.abertura.append(px)
        s.maxima.append(max(px, nxt) * (1 + abs(rnd.gauss(0, 0.0004))))
        s.minima.append(min(px, nxt) * (1 - abs(rnd.gauss(0, 0.0004))))
        s.fechamento.append(nxt)
        s.volume.append(abs(rnd.gauss(100, 30)) + 1)
        px = nxt
    return s


FALHAS: list[str] = []


def checar(cond: bool, msg: str) -> None:
    print(("  ok    " if cond else "  FALHA ") + msg)
    if not cond:
        FALHAS.append(msg)


def teste_vazamento() -> None:
    print("\n[1] vazamento de futuro")
    s = serie_sintetica(3000, 11)
    for nome in est.REGISTRO:
        if nome == "moeda":
            continue  # sorteio depende do tamanho da serie; e controle, nao sinal
        cheio = est.gerar(nome, s)
        limpo = all(est.gerar(nome, bt.fatiar(s, 0, c)) == cheio[:c] for c in (400, 1700, 2500))
        checar(limpo, f"{nome}: sinais antes do corte nao mudam ao truncar a serie")


def teste_sobreposicao() -> None:
    print("\n[2] posicao sobreposta")
    s = serie_sintetica(3000, 11)
    original = bt._perna
    registro: list[tuple[int, int]] = []

    def espia(serie, i, d, p):
        r = original(serie, i, d, p)
        registro.append((i, r[2]))
        return r

    bt._perna = espia
    try:
        for nome in ("confl3", "confl4", "moeda", "canal"):
            registro.clear()
            bt.simular(s, est.gerar(nome, s), bt.Params(alav=24, stop=0.5))
            sobre = sum(1 for k in range(1, len(registro)) if registro[k][0] <= registro[k - 1][1])
            checar(len(registro) > 0 and sobre == 0,
                   f"{nome}: {len(registro)} posicoes, {sobre} abertas antes da anterior fechar")
    finally:
        bt._perna = original


def teste_gatilho_obrigatorio() -> None:
    print("\n[4] confluencia nunca dispara sem rompimento")
    for semente, tend in ((11, False), (5, True)):
        s = serie_sintetica(2000, semente, tend)
        for nome in ("confl3", "confl4", "confl5"):
            sinais = est.gerar(nome, s)
            sem = [i for i, x in enumerate(sinais) if x and not (
                (x > 0 and s.fechamento[i] > max(s.maxima[i - 20:i])) or
                (x < 0 and s.fechamento[i] < min(s.minima[i - 20:i])))]
            checar(not sem, f"semente {semente} {nome}: {sum(1 for x in sinais if x)} sinais, {len(sem)} sem rompimento")


def teste_paridade() -> None:
    print("\n[3] paridade Python x monitor.html")
    node = shutil.which("node")
    if not node:
        checar(False, "node nao encontrado: paridade nao verificada")
        return

    html = open(os.path.join(RAIZ, "monitor.html"), encoding="utf-8").read()
    m = re.search(r'<script id="motor-confluencia">(.*?)</script>', html, re.S)
    if not m:
        checar(False, "bloco <script id=\"motor-confluencia\"> nao encontrado no monitor")
        return

    casos = {"sem_tendencia": serie_sintetica(1500, 11), "com_tendencia": serie_sintetica(1500, 5, True)}
    with tempfile.TemporaryDirectory() as tmp:
        motor = os.path.join(tmp, "motor.js")
        open(motor, "w", encoding="utf-8").write(m.group(1))
        dados = os.path.join(tmp, "dados.json")
        json.dump({k: {"abertura": v.abertura, "maxima": v.maxima, "minima": v.minima,
                       "fechamento": v.fechamento, "volume": v.volume} for k, v in casos.items()},
                  open(dados, "w"))
        script = (
            "const M=require(process.argv[1]);const d=require(process.argv[2]);const o={};"
            "for(const k in d){const c=d[k];o[k]={ruido:M.ruidoTipico(c.maxima,c.minima,c.fechamento),"
            "ema50:M.ema(c.fechamento,50),rsi:M.rsi(c.fechamento,14),atr:M.atr(c.maxima,c.minima,c.fechamento,14),"
            "volm:M.sma(c.volume,20)};for(const mi of [3,4,5])o[k]['c'+mi]=M.confluencia(c,{minimo:mi});}"
            "process.stdout.write(JSON.stringify(o));"
        )
        saida = subprocess.run([node, "-e", script, motor, dados], capture_output=True, text=True, timeout=60)
        if saida.returncode != 0:
            checar(False, "node falhou: " + saida.stderr.strip()[:300])
            return
        js = json.loads(saida.stdout)

    for nome, s in casos.items():
        j = js[nome]
        for mi in (3, 4, 5):
            py = est.confluencia(s, minimo=mi)
            difs = [i for i in range(len(py)) if py[i] != j[f"c{mi}"][i]]
            checar(not difs, f"{nome} confl{mi}: {sum(1 for x in py if x)} sinais, {len(difs)} divergencias")
        for rotulo, a, b in (("ema50", ind.ema(s.fechamento, 50), j["ema50"]),
                             ("rsi14", ind.rsi(s.fechamento, 14), j["rsi"]),
                             ("atr14", ind.atr(s.maxima, s.minima, s.fechamento, 14), j["atr"]),
                             ("sma20 volume", ind.sma(s.volume, 20), j["volm"])):
            iguais = all((x is None and y is None) or (x is not None and y is not None and x == y) for x, y in zip(a, b))
            checar(iguais and len(a) == len(b), f"{nome} {rotulo}: identico bit a bit")
        checar(ind.ruido_tipico(s.maxima, s.minima, s.fechamento) == j["ruido"], f"{nome} ruido mediano identico")


if __name__ == "__main__":
    teste_vazamento()
    teste_sobreposicao()
    teste_paridade()
    teste_gatilho_obrigatorio()
    print()
    if FALHAS:
        print(f"REPROVADO: {len(FALHAS)} falha(s)")
        sys.exit(1)
    print("APROVADO: todas as guardas passaram")
