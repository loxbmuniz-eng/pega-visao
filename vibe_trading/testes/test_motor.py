#!/usr/bin/env python3
"""
Guardas do motor. Rodar:  python3 testes/test_motor.py

Cada teste trava um defeito que ja aconteceu ou uma garantia que o README
afirma. Correcao sem guarda e correcao que volta.

1. vazamento de futuro  — sinal em i so usa dados ate i
2. posicao sobreposta   — proxima entrada so depois da saida anterior
3. paridade Python x JS — monitor.html decide igual a estrategias.confluencia
4. gatilho obrigatorio  — confluencia nunca entra sem rompimento do canal
5. busca de candles     — pagina alem de 1000, sem buraco nem duplicata,
                          descarta o candle aberto, cai para a fonte reserva
6. comando de ponta a ponta — o --robustez que o usuario roda, contra uma
                          Binance simulada, nos 5 periodos
7. padroes e alinhamento — engolfo pela definicao, divergencia so no candle
                          que confirma o pivo, reamostragem sem candle
                          inventado, alinhamento so com candle maior ja fechado
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


def serie_sintetica(n: int, semente: int, tendencia: bool = False, t0: int = 0) -> bt.Serie:
    """Serie de 15 min. t0=0 comeca numa fronteira de 4 h em UTC."""
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
        s.t.append(t0 + len(s.t) * est.MIN15)
        px = nxt
    return s


FALHAS: list[str] = []


def checar(cond: bool, msg: str) -> None:
    print(("  ok    " if cond else "  FALHA ") + msg)
    if not cond:
        FALHAS.append(msg)


def teste_vazamento() -> None:
    """
    Dois cortes. Os fixos pegam vazamento espalhado. O corte logo DEPOIS de cada
    sinal e a definicao exata: o sinal do candle i tem de existir com a serie
    terminando em i. Sem ele, um padrao raro que marca o sinal 3 candles antes da
    hora passa batido, porque quase nunca ha sinal colado num corte fixo.
    """
    print("\n[1] vazamento de futuro")
    s = serie_sintetica(3000, 11)
    for nome in est.REGISTRO:
        if nome == "moeda":
            continue  # sorteio depende do tamanho da serie; e controle, nao sinal
        cheio = est.gerar(nome, s)
        fixos = all(est.gerar(nome, bt.fatiar(s, 0, c)) == cheio[:c] for c in (400, 1700, 2500))
        com_sinal = [i for i, x in enumerate(cheio) if x][:: max(1, sum(1 for x in cheio if x) // 25)][:25]
        no_fim = all(est.gerar(nome, bt.fatiar(s, 0, i + 1))[i] == cheio[i] for i in com_sinal)
        checar(fixos and no_fim,
               f"{nome}: nada muda ao truncar, e {len(com_sinal)} sinais existem com a serie terminando neles")


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


class BinanceFalsa:
    """Responde como /api/v3/klines: no maximo `limit` candles, respeitando endTime."""

    MS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "12h": 43_200_000, "1d": 86_400_000}

    def __init__(self, total: int = 3500, falhar_primeira_fonte: bool = False):
        import time as _t
        self.agora = int(_t.time() * 1000)
        self.total = total
        self.falhar = falhar_primeira_fonte
        self.pedidos = 0
        self.serie = serie_sintetica(total, 5, True)

    def __call__(self, url: str):
        from urllib.parse import urlparse, parse_qs
        self.pedidos += 1
        if self.falhar and "api.binance.com" in url:
            raise OSError("fonte principal fora do ar (simulado)")
        q = parse_qs(urlparse(url).query)
        tf, limite = q["interval"][0], int(q["limit"][0])
        ms = self.MS[tf]
        # o ultimo candle ainda esta aberto: comecou ha meio periodo
        t0 = self.agora - ms // 2 - (self.total - 1) * ms
        fim = int(q["endTime"][0]) if "endTime" in q else None
        linhas = []
        for i in range(self.total):
            t = t0 + i * ms
            if fim is not None and t > fim:
                break
            linhas.append([t, str(self.serie.abertura[i]), str(self.serie.maxima[i]), str(self.serie.minima[i]),
                           str(self.serie.fechamento[i]), str(self.serie.volume[i]), t + ms - 1])
        return linhas[-limite:]


def teste_busca() -> None:
    print("\n[5] busca de candles")
    original = bt._pedir
    try:
        falsa = BinanceFalsa()
        bt._pedir = falsa
        s = bt.buscar("BTCUSDT", "15m", 2500)
        passos = {s.t[i] - s.t[i - 1] for i in range(1, len(s.t))}
        checar(len(s) == 2500, f"pediu 2500, veio {len(s)} ({falsa.pedidos} pedidos de no maximo 1000)")
        checar(passos == {900_000}, "candles contiguos, sem buraco nem duplicata")
        checar(s.t[-1] + 900_000 - 1 <= falsa.agora, "candle ainda aberto foi descartado")
        checar(s.fechamento[-1] == falsa.serie.fechamento[falsa.total - 2], "ultimo candle e o mais recente FECHADO")

        falsa = BinanceFalsa(falhar_primeira_fonte=True)
        bt._pedir = falsa
        s = bt.buscar("BTCUSDT", "1h", 1200)
        checar(len(s) == 1200, "fonte principal fora do ar: usou a reserva")

        falsa = BinanceFalsa(total=300)
        bt._pedir = falsa
        s = bt.buscar("BTCUSDT", "1d", 500)
        checar(len(s) == 299, f"historico curto: devolve o que existe ({len(s)}), sem travar em laco")
    finally:
        bt._pedir = original


def teste_comando_ponta_a_ponta() -> None:
    print("\n[6] comando --robustez de ponta a ponta, Binance simulada")
    import contextlib
    import io
    original, argv = bt._pedir, sys.argv
    bt._pedir = BinanceFalsa(total=3500)
    sys.argv = ["backtest.py", "--robustez", "--estrategia", "confl3", "--alav", "24"]
    saida = io.StringIO()
    try:
        with contextlib.redirect_stdout(saida):
            bt.main()
        texto = saida.getvalue()
        checar(texto.count(">>> ") == 5, "rodou os 5 periodos")
        checar(texto.count("bateu") == 5, "veredito de robustez em todos os 5")
        checar("candles, de " in texto, "mostra quantos candles e de que data a que data")
        print("        trecho:", next(l for l in texto.splitlines() if ">>> 4h" in l).strip())
    except SystemExit as e:
        checar(False, f"comando saiu com erro {e.code}")
    finally:
        bt._pedir, sys.argv = original, argv


def teste_padroes_e_alinhamento() -> None:
    print("\n[7] padroes e alinhamento")
    # engolfo pela definicao, em casos montados a mao
    def dois(o0, f0, o1, f1):
        return bt.Serie([o0, o1], [max(o0, f0), max(o1, f1)], [min(o0, f0), min(o1, f1)], [f0, f1], [1, 1])
    checar(est.engolfo(dois(10, 9, 9, 11))[1] == 1, "engolfo de alta: candle de baixa engolido por um de alta maior")
    checar(est.engolfo(dois(9, 10, 10, 8))[1] == -1, "engolfo de baixa: o espelho")
    checar(est.engolfo(dois(10, 8, 8, 9))[1] == 0, "corpo menor nao e engolfo")
    checar(est.engolfo(dois(9, 10, 10, 12))[1] == 0, "duas altas seguidas nao e engolfo")

    # divergencia: todo sinal sai no candle que CONFIRMA o pivo (3 depois dele)
    s = serie_sintetica(3000, 11)
    div = est.divergencia_rsi(s)
    erradas = 0
    for i, x in enumerate(div):
        if not x:
            continue
        j = i - 3
        v = s.minima if x > 0 else s.maxima
        janela = v[j - 3:i + 1]
        ok = v[j] == (min(janela) if x > 0 else max(janela))
        erradas += 0 if ok else 1
    checar(sum(1 for x in div if x) > 0 and erradas == 0,
           f"divergencia: {sum(1 for x in div if x)} sinais, todos no candle de confirmacao do pivo ({erradas} fora)")

    # vazamento de futuro com os filtros ligados (5000 candles: o 4 h precisa aquecer a EMA 200)
    longa = serie_sintetica(5000, 11)
    for nome in ("confl3", "engolfo", "divergencia"):
        cheio = est.sinais(nome, longa, "ambos", True)
        limpo = all(est.sinais(nome, bt.fatiar(longa, 0, c), "ambos", True) == cheio[:c] for c in (3800, 4500))
        checar(limpo and any(cheio), f"{nome} alinhado: {sum(1 for x in cheio if x)} sinais, nada muda ao truncar")

    # reamostragem
    t1h, f1h = est.reamostrar(s, est.H1, est.MIN15)
    checar(f1h[0] == s.fechamento[3] and f1h[5] == s.fechamento[23], "1 h fecha no fechamento do 4o candle de 15 min")
    torta = serie_sintetica(400, 3, t0=2 * est.MIN15)  # comeca 30 min depois da hora cheia
    t_t, _ = est.reamostrar(torta, est.H1, est.MIN15)
    checar(t_t[0] == est.H1, "comeco no meio da hora: o grupo incompleto e descartado")
    buraco = bt.fatiar(s, 0, 40)
    for col in ("abertura", "maxima", "minima", "fechamento", "volume", "t"):
        del getattr(buraco, col)[9]  # some um candle dentro da 3a hora
    t_b, _ = est.reamostrar(buraco, est.H1, est.MIN15)
    checar(2 * est.H1 not in t_b and len(t_b) == 9, "candle faltando: aquela hora nao vira candle de 1 h")

    # alinhamento so usa candle maior que ja fechou ate a abertura do candle menor
    t4, f4 = est.reamostrar(longa, est.H4, est.MIN15)
    ec, el = ind.ema(f4, 50), ind.ema(f4, 200)
    violou, usados, k = 0, 0, 0
    for i in range(len(longa)):
        tend, k = est.tendencia_em(t4, ec, el, est.H4, longa.t[i], k)
        if tend:
            usados += 1
            violou += 1 if t4[k] + est.H4 > longa.t[i] else 0
    checar(usados > 0 and violou == 0,
           f"tendencia do 4 h em {usados} candles, nunca com candle que fecha depois da abertura do 15 min")

    # filtro de lado
    base = est.gerar("confl3", s)
    so_compra = est.filtrar(s, base, "compra")
    so_venda = est.filtrar(s, base, "venda")
    checar(all(x >= 0 for x in so_compra) and sum(1 for x in so_compra if x) == sum(1 for x in base if x > 0),
           "so compra: fica exatamente com os sinais de compra")
    checar(all(x <= 0 for x in so_venda) and sum(1 for x in so_venda if x) == sum(1 for x in base if x < 0),
           "so venda: fica exatamente com os sinais de venda")


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

    # 5000 candles de 15 min = 312 de 4 h: a EMA 200 do 4 h precisa de 200 para existir
    casos = {"sem_tendencia": serie_sintetica(5000, 11), "com_tendencia": serie_sintetica(5000, 5, True)}
    with tempfile.TemporaryDirectory() as tmp:
        motor = os.path.join(tmp, "motor.js")
        open(motor, "w", encoding="utf-8").write(m.group(1))
        dados = os.path.join(tmp, "dados.json")
        htf = {}
        for k, v in casos.items():
            t4, f4 = est.reamostrar(v, est.H4, est.MIN15)
            htf[k] = {"t": t4, "eC": ind.ema(f4, 50), "eL": ind.ema(f4, 200)}
        json.dump({k: {"abertura": v.abertura, "maxima": v.maxima, "minima": v.minima,
                       "fechamento": v.fechamento, "volume": v.volume, "t": v.t, "htf": htf[k]}
                   for k, v in casos.items()}, open(dados, "w"))
        script = (
            "const M=require(process.argv[1]);const d=require(process.argv[2]);const o={};"
            "for(const k in d){const c=d[k];o[k]={ruido:M.ruidoTipico(c.maxima,c.minima,c.fechamento),"
            "ema50:M.ema(c.fechamento,50),rsi:M.rsi(c.fechamento,14),atr:M.atr(c.maxima,c.minima,c.fechamento,14),"
            "volm:M.sma(c.volume,20),eng:M.engolfo(c),div:M.divergenciaRsi(c),"
            "tend:c.t.map(tl=>M.tendenciaEm(c.htf.t,c.htf.eC,c.htf.eL,14400000,tl,0).tendencia)};"
            "for(const mi of [3,4,5])o[k]['c'+mi]=M.confluencia(c,{minimo:mi});}"
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
        for rotulo, py in (("engolfo", est.engolfo(s)), ("divergencia", est.divergencia_rsi(s))):
            chave = "eng" if rotulo == "engolfo" else "div"
            difs = sum(1 for a, b in zip(py, j[chave]) if a != b)
            checar(len(py) == len(j[chave]) and difs == 0, f"{nome} {rotulo}: {sum(1 for x in py if x)} sinais, {difs} divergencias")
        t4, f4 = est.reamostrar(s, est.H4, est.MIN15)
        ec, el = ind.ema(f4, 50), ind.ema(f4, 200)
        tend_py, k = [], 0
        for tl in s.t:
            x, k = est.tendencia_em(t4, ec, el, est.H4, tl, k)
            tend_py.append(x)
        difs = sum(1 for a, b in zip(tend_py, j["tend"]) if a != b)
        checar(difs == 0 and any(tend_py), f"{nome} tendencia do 4 h candle a candle: {difs} divergencias")


if __name__ == "__main__":
    teste_vazamento()
    teste_sobreposicao()
    teste_paridade()
    teste_gatilho_obrigatorio()
    teste_busca()
    teste_comando_ponta_a_ponta()
    teste_padroes_e_alinhamento()
    print()
    if FALHAS:
        print(f"REPROVADO: {len(FALHAS)} falha(s)")
        sys.exit(1)
    print("APROVADO: todas as guardas passaram")
