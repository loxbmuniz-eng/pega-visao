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
8. placar               — acerto x ganho - erro x perda = resultado por operacao
9. bateria              — varios ativos e periodos de uma vez, caderno de
                          experimentos, historico inteiro cortado por ano
10. vigia               — ao vivo, candle a candle, fecha EXATAMENTE as mesmas
                          operacoes que o backtest; desligar e religar nao
                          muda o placar
11. arena               — IA consultada so em candle de interesse, ao vivo e
                          sem ver o futuro; resposta ruim, recusa, erro ou teto
                          viram NADA; decisao guardada nunca e repetida; a IA
                          opera pela mesma regra do backtest; o custo e medido
12. pionex e telegram   — candles da Pionex no formato oficial, paginados sem
                          buraco, sem o candle em formacao; fontes nunca se
                          misturam; conferencia avisa divergencia; o robo do
                          Telegram so responde ao dono
13. dados reais         — a bateria nao toca em dados_vigia/ de quem roda
14. comando unico       — vibe.py chama a ferramenta certa em cada subcomando
15. regra de saida      — stop, alvo, empate, liquidacao e prazo contra a conta
                          feita a mao (a paridade nao pega erro dentro da regra)
16. livro de ofertas    — Pionex, Binance e Hyperliquid no formato oficial;
                          desequilibrio contado a mao; so gravacao
17. fluxo agressor      — compra agressora da Binance, saldo contado a mao,
                          filtro so a favor, sem a coluna nao ha sinal
18. montagens de mesa   — caca de stops, reteste, compressao, sessao e VWAP do
                          dia disparam so no desenho delas (candles feitos a mao)
19. prova contra sorte  — Sharpe deflacionado contra os valores do artigo; o
                          veredito da bateria exige 95% de chance de nao ser sorte
20. smart money         — estrutura (BOS, CHoCH), vao de valor justo, bloco de
                          ordens, desconto e premio, em candles feitos a mao
21. scalping            — acerto minimo para empatar bate com o simulador; 5 min
22. fase 2 honesta      — julga uma vez em pontos fixos, sem candles do vigia
                          desligado, com prova contra sorte; parametro mudou,
                          placar recomeca; alerta com projecao em USDT
"""

from __future__ import annotations

import dataclasses
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
    # compra agressora com outro sorteio (nao muda os precos dos testes antigos):
    # candle de alta tende a ter mais compra agressora, como no mercado
    rnd2 = random.Random(semente + 99_991)
    for o, f, v in zip(s.abertura, s.fechamento, s.volume):
        fracao = 0.5 + (0.15 if f > o else -0.15) + rnd2.gauss(0, 0.12)
        s.agressora.append(v * min(0.95, max(0.05, fracao)))
    return s


class RelogioFalso:
    """Relogio de mentira: dormir avanca o relogio sem esperar de verdade. anotando()
    embrulha um pedidor e guarda o momento de cada pedido."""

    def __init__(self):
        self.t, self.momentos = 1000.0, []

    def agora(self) -> float:
        return self.t

    def dormir(self, x: float) -> None:
        self.t += max(0.0, x)

    def anotando(self, pedir):
        def embrulho(*a, **k):
            self.momentos.append(self.t)
            return pedir(*a, **k)
        return embrulho

    def menor_intervalo(self) -> float:
        return min((b - a for a, b in zip(self.momentos, self.momentos[1:])), default=float("inf"))


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

    MS = {"5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "12h": 43_200_000, "1d": 86_400_000}

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
                           str(self.serie.fechamento[i]), str(self.serie.volume[i]), t + ms - 1,
                           "0", 0, str(self.serie.agressora[i]), "0", "0"])  # 12 campos, como a Binance
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
    tmp = tempfile.mkdtemp()
    caderno = os.path.join(tmp, "caderno.jsonl")
    sys.argv = ["backtest.py", "--robustez", "--estrategia", "confl3", "--alav", "24", "--caderno", caderno]
    saida = io.StringIO()
    try:
        with contextlib.redirect_stdout(saida):
            bt.main()
        texto = saida.getvalue()
        registros = [json.loads(l) for l in open(caderno, encoding="utf-8")]
        checar(len(registros) == 5 and all("|90d_6janelas|" in r["hipotese"] and "taxa" in r["hipotese"] for r in registros),
               "o --robustez tambem registra cada tentativa no caderno, com todos os parametros na identidade")
        checar(texto.count(">>> ") == 5, "rodou os 5 periodos")
        checar(texto.count("bateu") == 5, "veredito de robustez em todos os 5")
        checar(texto.count("resultado por operacao") == 5, "placar com resultado por operacao nos 5 periodos")
        checar("candles, de " in texto, "mostra quantos candles e de que data a que data")
        print("        trecho:", next(l for l in texto.splitlines() if ">>> 4h" in l).strip())
    except SystemExit as e:
        checar(False, f"comando saiu com erro {e.code}")
    finally:
        bt._pedir, sys.argv = original, argv
        shutil.rmtree(tmp, ignore_errors=True)


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


def teste_placar() -> None:
    print("\n[8] placar: acerto, ganho medio, perda media e resultado por operacao")
    s = serie_sintetica(3000, 5, True)
    for nome in ("confl3", "moeda", "engolfo"):
        r = bt.simular(s, est.gerar(nome, s), bt.Params(alav=24, stop=0.5))
        a = r.acerto / 100
        identidade = a * r.ganho_medio - (1 - a) * r.perda_media
        checar(r.operacoes > 0 and abs(identidade - r.por_operacao) < 1e-9,
               f"{nome}: acerto x ganho - erro x perda = resultado por operacao ({r.por_operacao:+.4f})")
        checar(abs(r.por_operacao * r.operacoes - r.pnl) < 1e-6 and len(r.resultados) == r.operacoes,
               f"{nome}: resultado por operacao x {r.operacoes} operacoes = pnl total")
    # o exemplo da pagina: 80% de acerto pode perder, 35% pode ganhar
    alto = bt.Resultado(resultados=[1.0] * 8 + [-5.0] * 2)
    baixo = bt.Resultado(resultados=[3.0] * 7 + [-1.0] * 13)
    checar(alto.acerto == 80 and alto.por_operacao < 0, f"80% de acerto, ganho 1 e perda 5: {alto.por_operacao:+.2f} por operacao")
    checar(baixo.acerto == 35 and baixo.por_operacao > 0, f"35% de acerto, ganho 3 e perda 1: {baixo.por_operacao:+.2f} por operacao")


def teste_bateria() -> None:
    print("\n[9] bateria: varios ativos, caderno de experimentos e historico por ano")
    import contextlib
    import io
    import bateria

    # corte por ano: cobre a serie sem buraco, anos em ordem
    s = serie_sintetica(3000, 5, True)
    s.t = [i * est.H4 for i in range(len(s))]  # 4 h por candle: ~500 dias, 2 anos
    cortes = bt.cortes_por_ano(s)
    contiguo = all(cortes[k][1] == cortes[k + 1][0] for k in range(len(cortes) - 1))
    checar(len(cortes) == 2 and cortes[0][2] == "1970" and cortes[1][2] == "1971" and contiguo,
           f"corte por ano: {[c[2] for c in cortes]}, sem buraco entre os anos")
    a = bt.avaliar_robustez(s, "confl3", bt.Params(alav=24, stop=0.5), cortes=cortes)
    checar(a is not None and a["janelas"] == 2 and [l["janela"] for l in a["linhas"]] == ["1970", "1971"],
           "robustez por ano: uma janela por ano, rotulada com o ano")

    original, argv = bt._pedir, sys.argv
    with tempfile.TemporaryDirectory() as tmp:
        caderno = os.path.join(tmp, "caderno.jsonl")
        try:
            bt._pedir = BinanceFalsa(total=3500)
            sys.argv = ["bateria.py", "--ativos", "BTCUSDT,ETHUSDT", "--estrategias", "confl3,engolfo",
                        "--caderno", caderno]
            saida = io.StringIO()
            with contextlib.redirect_stdout(saida):
                bateria.main()
            texto = saida.getvalue()
            checar(all(f">>> {tf}" in texto for tf in ("5m", "15m", "1h", "4h")), "modo normal: os 4 periodos (5 min entrou no padrao)")
            checar("PASSARAM NA FASE 1" in texto or "NENHUMA ESTRATEGIA PASSOU" in texto, "modo normal: veredito da fase 1")
            linhas = open(caderno, encoding="utf-8").read().splitlines()
            checar(len(linhas) == 16, f"caderno: 2 estrategias x 2 ativos x 4 periodos = {len(linhas)} registros")
            checar("Tentativas registradas no caderno: 8" in texto,
                   "caderno conta 8 hipoteses (o ativo nao muda a hipotese)")

            bt._pedir = BinanceFalsa(total=3500)
            sys.argv = ["bateria.py", "--historico", "--ativos", "BTCUSDT", "--estrategias", "confl3,engolfo",
                        "--caderno", caderno]
            saida = io.StringIO()
            with contextlib.redirect_stdout(saida):
                bateria.main()
            texto = saida.getvalue()
            checar("ANO A ANO" in texto and ">>> 4h" in texto and ">>> 1d" in texto and ">>> 15m" not in texto,
                   "modo historico: 4 h e 24 h, tabela ano a ano")
            ultimo = json.loads(open(caderno, encoding="utf-8").read().splitlines()[-1])
            checar(ultimo["modo"] == "historico_por_ano" and ultimo["janelas"] >= 2,
                   f"caderno registra o modo historico ({ultimo['janelas']} anos no ultimo registro)")
        except SystemExit as e:
            checar(False, f"bateria saiu com erro {e.code}")
        finally:
            bt._pedir, sys.argv = original, argv


def _replay(s, cfg, pasta, inicio, pausa=None, juiz=None):
    """Passa a serie pelo vigia candle a candle. `pausa=(de, ate)` simula o vigia
    desligado: os candles de `de` a `ate` chegam todos de uma vez, ao religar."""
    import vigia
    ms = est.MIN15
    ponteiro = {"fim": inicio}

    def buscador(par, tf, n):
        f = ponteiro["fim"]
        return bt.fatiar(s, max(0, f - n), f)

    estado = {"versao": 1, "trilhas": {}, "ultimo_resumo": None}
    vigia.ciclo(estado, cfg, "BTCUSDT", "15m", buscador, s.t[inicio - 1] + ms + 1000, pasta, None, juiz)
    k = inicio
    while k < len(s):
        if pausa and k == pausa[0]:
            estado = json.loads(json.dumps(estado))  # religar: o estado volta do disco
            k = pausa[1]
        ponteiro["fim"] = k + 1
        vigia.ciclo(estado, cfg, "BTCUSDT", "15m", buscador, s.t[k] + ms + 1000, pasta, None, juiz)
        k += 1
    diario = [json.loads(l) for l in open(os.path.join(pasta, "diario.jsonl"), encoding="utf-8")]
    return estado, diario


def _esperado_backtest(s, sinais, p):
    """As operacoes que o backtest fecha com estes sinais, no formato do diario do vigia."""
    esperado, i = [], 0
    while i < len(s) - 1:
        if sinais[i] == 0:
            i += 1
            continue
        pnl, desfecho, j = bt._perna(s, i, 1 if sinais[i] > 0 else -1, p)
        cortado = desfecho == "expirou" and i + p.max_barras > len(s) - 1  # o fim da serie fechou, nao a regra
        if not cortado:
            esperado.append((round(s.fechamento[i], 6), s.t[j], desfecho, round(pnl, 6)))
        i = max(j, i) + 1
    return esperado


def teste_vigia() -> None:
    print("\n[10] vigia: replay candle a candle contra o backtest")
    import vigia
    s = serie_sintetica(3000, 5, True)
    cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
    cfg["historico_inicial_dias"] = 7  # 672 candles: o cache comeca no candle 0, como o backtest
    inicio = 600
    p = bt.Params(**cfg["params"])

    with tempfile.TemporaryDirectory() as tmp:
        estado, diario = _replay(s, cfg, tmp, inicio)

    for nome in ("confl3", "engolfo"):
        sinais = [x if i >= inicio else 0 for i, x in enumerate(est.sinais(nome, s))]
        esperado = _esperado_backtest(s, sinais, p)
        obtido = [(round(r["entrada"], 6), r["saida_t"], r["desfecho"], r["pnl"]) for r in diario if r["estrategia"] == nome]
        checar(len(esperado) > 5 and obtido == esperado,
               f"{nome}: vigia ao vivo fechou {len(obtido)} operacoes, backtest {len(esperado)}; identicas: {obtido == esperado}")

    with tempfile.TemporaryDirectory() as tmp:
        estado2, diario2 = _replay(s, cfg, tmp, inicio, pausa=(1500, 1530))
    sem = [(r["trilha"], r["entrada"], r["saida_t"], r["desfecho"], r["pnl"]) for r in diario]
    com = [(r["trilha"], r["entrada"], r["saida_t"], r["desfecho"], r["pnl"]) for r in diario2]
    checar(sem == com, f"desligado 30 candles e religado: mesmas {len(com)} operacoes")
    moedas1 = {tid: [round(m["soma"], 6) for m in tr["moedas"]] for tid, tr in estado["trilhas"].items()}
    moedas2 = {tid: [round(m["soma"], 6) for m in tr["moedas"]] for tid, tr in estado2["trilhas"].items()}
    checar(moedas1 == moedas2 and len(moedas1) == 2, "as 20 moedas de cada trilha tambem saem iguais depois da pausa")
    checar(any(r["recuperado"] for r in diario2), "operacoes fechadas durante a pausa ficam marcadas como recuperadas")

    pl = vigia.placar(estado)
    checar(len(pl) == 2 and all(l["operacoes"] == sum(1 for r in diario if r["trilha"] == l["trilha"]) for l in pl),
           "placar conta as mesmas operacoes do diario")
    l = pl[0]
    r = bt.Resultado(resultados=[x["pnl"] for x in diario if x["trilha"] == l["trilha"]])
    checar(abs(l["por_operacao"] - r.por_operacao) < 1e-5 and abs(l["acerto"] - r.acerto) < 1e-9,
           f"placar do vigia bate com a conta do backtest ({l['trilha'].split('|')[0]}: por op {l['por_operacao']:+.4f})")


def teste_paridade() -> None:
    print("\n[3] paridade Python x monitor.html")
    node = shutil.which("node")
    if not node:
        if os.environ.get("VIBE_SERVIDOR") == "1":
            # no VPS o monitor nao roda (ele abre no navegador); a paridade ja foi
            # verificada antes do envio. Fica declarado, nao escondido.
            print("  aviso node nao encontrado no servidor: paridade Python x monitor NAO verificada aqui")
            return
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
        # 300 s: no servidor a atualizacao roda com prioridade minima e teto de processador
        saida = subprocess.run([node, "-e", script, motor, dados], capture_output=True, text=True, timeout=300)
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


# --------------------------------------------------------------------------- #
# [11] arena: IAs falsas, deterministicas, sem rede e sem gastar chamada
# --------------------------------------------------------------------------- #

def _dados_da_pergunta(usuario: str) -> dict:
    corpo = usuario.split("\n", 1)[1]
    for corte in ("\nResponda", "\nProposta"):
        corpo = corpo.split(corte)[0]
    return json.loads(corpo)


class QwenFalsa:
    """Segue o rompimento do canal (ou vai contra ele, com contra=True: e o DeepSeek
    simulado). Responde com cerca de codigo, como modelos costumam fazer."""

    def __init__(self, sempre=None, erro=False, contra=False):
        self.chamadas, self.uso, self.preco, self.sempre, self.erro = 0, None, (1.0, 4.0), sempre, erro
        self.contra = contra

    def perguntar(self, sistema, usuario):
        self.chamadas += 1
        self.uso = (1000, 50)
        if self.erro:
            raise TimeoutError("rede caiu")
        ev = _dados_da_pergunta(usuario)["eventos_no_ultimo_candle"]
        alta, baixa = ("venda", "compra") if self.contra else ("compra", "venda")
        lado = self.sempre or (alta if ev["rompeu_maxima_20"] else baixa if ev["rompeu_minima_20"] else "nada")
        return '```json\n{"lado": "%s", "motivo": "canal"}\n```' % lado


class ClaudeFalso:
    """So entra a favor da EMA 50; no veto, aprova so a proposta a favor da EMA 50."""

    def __init__(self, recusar=False):
        self.chamadas, self.vetos, self.uso, self.preco, self.recusar = 0, 0, None, (4.0, 20.0), recusar

    def perguntar_formatado(self, sistema, usuario, esquema):
        import arena
        self.chamadas += 1
        self.uso = (1200, 300)
        if self.recusar:
            raise arena.Recusou("recusou")
        d = _dados_da_pergunta(usuario)
        acima = (d["indicadores_no_ultimo_candle"]["ema50_vs_preco_%"] or 0) < 0
        ev = d["eventos_no_ultimo_candle"]
        if esquema is arena.ESQUEMA_VETO:
            self.vetos += 1
            compra = "Proposta da outra IA: compra" in usuario
            return json.dumps({"veredito": "aprova" if compra == acima else "veta", "motivo": "ema50"})
        lado = ("compra" if ev["rompeu_maxima_20"] and acima else
                "venda" if ev["rompeu_minima_20"] and not acima else "nada")
        return json.dumps({"lado": lado, "motivo": "ema50 e canal"})


class _ClienteSDKFalso:
    """Imita client.beta.messages.create do SDK da Anthropic e guarda o que foi pedido."""

    def __init__(self, texto, stop_reason="end_turn"):
        import types
        self.pedidos = []
        bloco = types.SimpleNamespace(type="text", text=texto)
        self.resp = types.SimpleNamespace(stop_reason=stop_reason, content=[bloco] if texto else [],
                                          usage=types.SimpleNamespace(input_tokens=900, output_tokens=120))
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.pedidos.append(kw)
        return self.resp


def teste_arena() -> None:
    print("\n[11] arena: Qwen e Claude como competidores, com IAs simuladas")
    import arena
    import vigia

    # leitura das respostas: so o formato exato vale; o resto vira NADA / VETO
    casos = [('{"lado": "compra", "motivo": "x"}', 1), ('texto antes {"lado": "venda", "motivo": "y"} depois', -1),
             ('{"lado": "nada", "motivo": "z"}', 0), ('{"lado": "COMPRA"}', 0), ("compra!", 0), ("", 0),
             ('{"motivo": "sem lado"}', 0)]
    checar(all(arena.ler_decisao(t)[0] == v for t, v in casos),
           "resposta fora do formato (texto solto, caixa alta, sem lado, vazia) vira NADA")
    checar(arena.ler_veto('{"veredito": "aprova", "motivo": "ok"}')[0] is True
           and arena.ler_veto('{"veredito": "talvez"}')[0] is False and arena.ler_veto("")[0] is False,
           "no veto, so 'aprova' exato aprova; o resto veta")

    # a chamada ao Claude: formato fixo, fallback do servidor, sem parametro proibido no Opus 5.5
    cli = _ClienteSDKFalso('{"lado": "venda", "motivo": "teste"}')
    cl = arena.Claude(cli, "claude-opus-5-5", "low")
    texto = cl.perguntar_formatado("sis", "usr", arena.ESQUEMA_DECISAO)
    kw = cli.pedidos[0]
    checar(kw["model"] == "claude-opus-5-5" and kw["fallbacks"] == "default"
           and kw["betas"] == ["server-side-fallback-2026-07-01"]
           and kw["output_config"] == {"effort": "low", "format": {"type": "json_schema", "schema": arena.ESQUEMA_DECISAO}}
           and not {"thinking", "temperature", "top_p", "tool_choice"} & set(kw),
           "Claude: SDK oficial, resposta em formato fixo, fallback do servidor, sem thinking/temperature")
    checar(arena.ler_decisao(texto)[0] == -1 and cl.uso == (900, 120) and cl.preco == (4.0, 20.0),
           "Claude: le a resposta e guarda os tokens gastos")
    recusa = arena.Claude(_ClienteSDKFalso("", "refusal"), "claude-opus-5-5", "low")
    try:
        recusa.perguntar_formatado("sis", "usr", arena.ESQUEMA_DECISAO)
        checar(False, "recusa do Claude deveria virar erro tratado")
    except arena.Recusou:
        checar(True, "recusa do Claude (stop_reason refusal) nao passa como resposta")

    # sem ver o futuro: os dados do candle i sao os mesmos com ou sem os candles depois dele
    s = serie_sintetica(1800, 5, True)
    p = bt.Params(alav=24)
    marca = arena.candles_de_interesse(s)
    pontos = [i for i in range(300, 1790, 61)]
    iguais = all(arena.montar_dados(s, i, p) == arena.montar_dados(bt.fatiar(s, 0, i + 1), i, p) for i in pontos)
    marca_iguais = all(arena.candles_de_interesse(bt.fatiar(s, 0, i + 1))[i] == marca[i] for i in pontos)
    checar(iguais and marca_iguais, f"dados e candles de interesse nao veem o futuro ({len(pontos)} cortes)")
    dados = json.loads(arena.montar_dados(s, 1000, p))
    linhas = dados["candles_ate_agora_mais_antigo_primeiro"]["linhas"]
    precos = [v for l in linhas for v in l[:4]] + [v for k, v in dados["indicadores_no_ultimo_candle"].items()
                                                   if k.endswith("_%") and v is not None]
    checar(len(linhas) == 48 and max(abs(v) for v in precos) < 50 and linhas[-1][3] == 0.0,
           f"a IA recebe so numeros relativos ao preco atual ({len(linhas)} candles), nao o nivel do preco")

    # o juiz: erro, recusa e teto viram NADA; a decisao guardada nao e repetida
    i0 = next(i for i in range(300, len(s)) if marca[i])
    logs = []
    j = arena.Juiz(QwenFalsa(erro=True), ClaudeFalso(recusar=True), 5, logs.append)
    mem = {}
    d = j.decidir(mem, "k1", s, i0, p)
    checar(d == {"ia:qwen": (0, d["ia:qwen"][1]), "ia:claude": (0, d["ia:claude"][1]),
                 "ia:qwen+claude": (0, "a Qwen ficou de fora")} and len(logs) == 2,
           f"erro de rede na Qwen e recusa do Claude: as tres viram NADA e ficam no log ({len(logs)} linhas)")
    q, c = QwenFalsa(sempre="compra"), ClaudeFalso()
    j = arena.Juiz(q, c, 3, logs.append)
    mem = {}
    for k in range(5):
        j.decidir(mem, f"c{k}", s, i0 + k, p)
    hoje = list(mem["chamadas"].values())[0]
    checar(q.chamadas == 3 and c.chamadas == 3 and hoje == {"qwen": 3, "claude": 3},
           f"teto de 3 por dia: a Qwen foi chamada {q.chamadas} vezes e o Claude {c.chamadas} em 5 candles")
    checar(mem["decisoes"]["c4"]["ia:qwen"][0] == 0 and "teto" in mem["decisoes"]["c4"]["ia:qwen"][1],
           "depois do teto, NADA sem chamar ninguem")
    antes = (q.chamadas, c.chamadas)
    de_novo = j.decidir(json.loads(json.dumps(mem)), "c0", s, i0, p)
    checar((q.chamadas, c.chamadas) == antes and de_novo == {k: tuple(v) for k, v in mem["decisoes"]["c0"].items()},
           "candle ja decidido (mesmo depois de gravar e ler do disco): devolve a mesma decisao, sem chamar")
    custo = mem["custo"]
    checar(custo["qwen"]["chamadas"] == 3 and abs(custo["qwen"]["usd"] - 3 * (1000 * 1.0 + 50 * 4.0) / 1e6) < 1e-12
           and custo["claude"]["entrada"] == 1200 * c.chamadas,
           f"custo medido pelos tokens de cada resposta (Qwen US$ {custo['qwen']['usd']:.4f})")

    # no vigia, candle a candle
    cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
    cfg["historico_inicial_dias"] = 7
    cfg["arena"]["ligada"] = True
    inicio = 600
    pv = bt.Params(**cfg["params"])
    with tempfile.TemporaryDirectory() as tmp:
        _, diario_sem = _replay(s, cfg, tmp, inicio)
    q, c, dsk = QwenFalsa(), ClaudeFalso(), QwenFalsa(contra=True)
    with tempfile.TemporaryDirectory() as tmp:
        juiz = arena.Juiz(q, c, 10_000, logs.append, deepseek=dsk)
        estado, diario = _replay(s, cfg, tmp, inicio, juiz=juiz)
        registros = [json.loads(l) for l in open(os.path.join(tmp, "arena.jsonl"), encoding="utf-8")]
    # a operacao em si (a assinatura da corrente depende de quem gravou antes, IAs incluidas)
    sem_corrente = lambda r: {k: v for k, v in r.items() if k not in ("hash", "hash_anterior")}
    estrategias_sem = [sem_corrente(r) for r in diario_sem]
    estrategias_com = [sem_corrente(r) for r in diario if not r["estrategia"].startswith("ia:")]
    checar(estrategias_sem == estrategias_com, "ligar a arena nao muda nenhuma operacao das estrategias")
    ids = sorted(t for t in estado["trilhas"] if t.startswith("ia:"))
    checar(ids == ["ia:claude|ambos|livre|BTCUSDT|15m", "ia:deepseek|ambos|livre|BTCUSDT|15m",
                   "ia:qwen+claude|ambos|livre|BTCUSDT|15m", "ia:qwen|ambos|livre|BTCUSDT|15m"],
           "quatro trilhas de IA (Qwen, DeepSeek, Claude, Qwen com veto), no formato das estrategias")
    decisoes = estado["arena"]["decisoes"]
    pos_t = {t: i for i, t in enumerate(s.t)}
    idx = sorted(pos_t[int(k.split("|")[2])] for k in decisoes)
    checar(idx and all(marca[i] for i in idx) and min(idx) >= inicio,
           f"a IA so foi consultada em candle de interesse ({len(idx)} de {sum(marca[inicio:])} candles de interesse)")
    checar(q.chamadas == dsk.chamadas == len(decisoes) == len(registros),
           f"uma chamada por candle consultado, nunca repetida ({q.chamadas} chamadas), e cada uma gravada no arena.jsonl")
    opostos = sum(1 for v in decisoes.values() if v["ia:qwen"][0] != 0 and v["ia:deepseek"][0] == -v["ia:qwen"][0])
    checar(opostos > 0 and opostos == sum(1 for v in decisoes.values() if v["ia:qwen"][0] != 0),
           f"o DeepSeek simulado decide o oposto da Qwen nos {opostos} candles em que ela entra: cada trilha segue a sua IA")
    for nome in ("ia:qwen", "ia:deepseek", "ia:claude", "ia:qwen+claude"):
        sinais = [0] * len(s)
        for k, v in decisoes.items():
            sinais[pos_t[int(k.split("|")[2])]] = v[nome][0]
        esperado = _esperado_backtest(s, sinais, pv)
        obtido = [(round(r["entrada"], 6), r["saida_t"], r["desfecho"], r["pnl"]) for r in diario if r["estrategia"] == nome]
        checar(len(esperado) > 5 and obtido == esperado,
               f"{nome}: {len(obtido)} operacoes, identicas ao backtest com as decisoes dela: {obtido == esperado}")
    vetadas = sum(1 for v in decisoes.values() if v["ia:qwen"][0] != 0 and v["ia:qwen+claude"][0] == 0)
    checar(c.vetos > 0 and vetadas > 0 and all(v["ia:qwen+claude"][0] in (0, v["ia:qwen"][0]) for v in decisoes.values()),
           f"Qwen + veto do Claude: so entra no lado da Qwen, e o Claude vetou {vetadas} de {c.vetos} propostas")
    checar(all("motivo_entrada" in r for r in diario if r["estrategia"].startswith("ia:")),
           "cada operacao de IA guarda no diario o motivo que a IA deu na entrada")
    tr = estado["trilhas"]["ia:qwen|ambos|livre|BTCUSDT|15m"]
    checar(sum(m["n"] for m in tr["moedas"]) > 0, "as moedas pareadas da IA entram nos candles em que a IA entrou")

    # desligado e religado: candle que fechou com o vigia fora nao e consultado
    q2, c2 = QwenFalsa(), ClaudeFalso()
    with tempfile.TemporaryDirectory() as tmp:
        estado2, diario2 = _replay(s, cfg, tmp, inicio, pausa=(1200, 1230), juiz=arena.Juiz(q2, c2, 10_000, logs.append))
        n_antes = q2.chamadas
        buscar_igual = lambda par, tf, n: bt.fatiar(s, max(0, len(s) - n), len(s))  # noqa: E731
        vigia.ciclo(json.loads(json.dumps(estado2)), cfg, "BTCUSDT", "15m", buscar_igual,
                    s.t[-1] + est.MIN15 + 1000, tmp, None, arena.Juiz(q2, c2, 10_000, logs.append))
    t_dec = {int(k.split("|")[2]) for k in estado2["arena"]["decisoes"]}
    na_pausa = [t for t in t_dec if s.t[1200] <= t <= s.t[1228]]
    pausa_tinha = sum(1 for i in range(1200, 1229) if marca[i])
    checar(not na_pausa and pausa_tinha > 0 and any(t > s.t[1228] for t in t_dec),
           f"{pausa_tinha} candles de interesse fecharam com o vigia desligado: nenhum consultado "
           "(a IA nao decide o passado); depois de religar, volta a consultar")
    checar(q2.chamadas == n_antes, "religar sem candle novo: nenhuma chamada a mais")

    # IA que sempre fica de fora: nenhuma operacao, nenhuma moeda
    cfg_q = json.loads(json.dumps(cfg))
    with tempfile.TemporaryDirectory() as tmp:
        e3, _ = _replay(serie_sintetica(900, 9, True), cfg_q, tmp, 700,
                        juiz=arena.Juiz(QwenFalsa(sempre="nada"), None, 10_000, logs.append))
    tq = e3["trilhas"]["ia:qwen|ambos|livre|BTCUSDT|15m"]
    checar(not tq["resultados"] and all(m["n"] == 0 for m in tq["moedas"])
           and "ia:claude|ambos|livre|BTCUSDT|15m" not in e3["trilhas"],
           "IA que so diz NADA: zero operacoes e zero moedas; sem Claude, sem trilha do Claude")

    # placar e resumo mostram o custo medido
    import contextlib
    import io
    saida = io.StringIO()
    with contextlib.redirect_stdout(saida):
        vigia.imprimir_placar(estado)
    checar("ARENA" in saida.getvalue() and "qwen:" in saida.getvalue() and "ARENA" in vigia.texto_resumo(estado),
           "placar e resumo do Telegram mostram chamadas e custo da arena")

    # montar o juiz a partir do vigia.json e do segredos.json
    msgs = []
    sem = vigia.montar_juiz(cfg, {}, msgs.append)
    checar(sem is None and any("openrouter_key vazia" in m for m in msgs) and any("anthropic_api_key vazia" in m for m in msgs),
           "arena ligada sem chave: segue sem arena e diz o que falta")
    desligada = json.loads(json.dumps(cfg))
    desligada["arena"]["ligada"] = False
    checar(vigia.montar_juiz(desligada, {"openrouter_key": "x"}, msgs.append) is None, "arena desligada: nenhuma IA")
    msgs = []
    j = vigia.montar_juiz(cfg, {"openrouter_key": "x"}, msgs.append,
                          conferir=lambda m: ("nao_existe", None, ["qwen/qwen-a", "qwen/qwen-b"]))
    checar(j is None and any("qwen/qwen-a" in m and "nao existe" in m for m in msgs),
           "nome de modelo Qwen errado: nao gasta chamada e lista os que existem")
    j = vigia.montar_juiz(cfg, {"openrouter_key": "x"}, msgs.append,
                          conferir=lambda m: ("ok", (0.5, 2.0), []))
    checar(j is not None and j.competidores() == ["ia:qwen", "ia:deepseek"] and j.qwen.preco == (0.5, 2.0)
           and j.deepseek.modelo == cfg["arena"]["deepseek_modelo"],
           "so com a chave da OpenRouter: Qwen e DeepSeek, com o preco lido da lista")
    sem_dsk = json.loads(json.dumps(cfg))
    sem_dsk["arena"]["deepseek_modelo"] = ""
    j = vigia.montar_juiz(sem_dsk, {"openrouter_key": "x"}, msgs.append, conferir=lambda m: ("ok", None, []))
    checar(j is not None and j.competidores() == ["ia:qwen"], "deepseek_modelo vazio no vigia.json: DeepSeek fica de fora")
    so_dsk = json.loads(json.dumps(cfg))
    so_dsk["arena"]["qwen_modelo"] = ""
    j = vigia.montar_juiz(so_dsk, {"openrouter_key": "x"}, msgs.append, conferir=lambda m: ("ok", None, []))
    checar(j is not None and j.competidores() == ["ia:deepseek"] and "ia:qwen+claude" not in j.competidores(),
           "so o DeepSeek: sem Qwen nao existe a dupla Qwen com veto")
    msgs = []
    j = vigia.montar_juiz(cfg, {"anthropic_api_key": "x"}, msgs.append,
                          criar=lambda seg, mod, esf: (None, "pacote 'anthropic' nao instalado"))
    checar(j is None and any("anthropic" in m for m in msgs), "sem o pacote anthropic: diz como instalar")

    # vigia.json e segredos.json de versao anterior
    with tempfile.TemporaryDirectory() as tmp:
        arq = os.path.join(tmp, "vigia.json")
        velho = json.loads(json.dumps(vigia.CONFIG_PADRAO))
        del velho["arena"]
        velho["moedas"] = 7
        json.dump(velho, open(arq, "w"))
        cfg2 = vigia.carregar_config(arq)
        relido = json.load(open(arq))
        checar(cfg2["arena"]["ligada"] is False and relido["moedas"] == 7 and "arena" in relido,
               "vigia.json antigo: ganha a secao arena (desligada) sem perder o que ja estava")
        relido["arena"]["ligada"], relido["arena"]["periodo"] = True, "4h"
        json.dump(relido, open(arq, "w"))
        try:
            vigia.carregar_config(arq)
            checar(False, "arena num periodo que o vigia nao acompanha deveria parar com explicacao")
        except SystemExit as e:
            checar("arena" in str(e.code), "arena num periodo que o vigia nao acompanha: para e explica")
        seg = os.path.join(tmp, "segredos.json")
        vigia.carregar_segredos(seg)
        modo1 = os.stat(seg).st_mode & 0o777
        json.dump({"telegram_token": "abc", "openrouter_key": "def"}, open(seg, "w"))
        os.chmod(seg, 0o600)
        s2 = vigia.carregar_segredos(seg)
        modo2 = os.stat(seg).st_mode & 0o777
        checar(modo1 == 0o600 and modo2 == 0o600 and s2["telegram_token"] == "abc" and s2["openrouter_key"] == "def"
               and s2["anthropic_api_key"] == "",
               "segredos.json nasce com chmod 600 e ganha o campo novo sem perder chave nem permissao")


def teste_sdk_anthropic() -> None:
    """O pedido que o SDK oficial monta de verdade, contra um servidor local (sem chave real)."""
    print("\n[11b] arena: o SDK oficial da Anthropic, ponta a ponta contra um servidor local")
    try:
        import anthropic
    except ImportError:
        print("  aviso pacote 'anthropic' nao instalado neste python: verificacao do SDK NAO executada")
        return
    import http.server
    import threading
    import arena
    recebidos = []
    respostas = [
        {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
         "content": [{"type": "text", "text": '{"lado": "compra", "motivo": "teste"}'}],
         "stop_reason": "end_turn", "stop_sequence": None, "usage": {"input_tokens": 1500, "output_tokens": 210}},
        {"id": "msg_2", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [],
         "stop_reason": "refusal", "stop_sequence": None, "usage": {"input_tokens": 1500, "output_tokens": 0}},
    ]

    class Servidor(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            corpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            recebidos.append((self.path, dict(self.headers), corpo))
            dado = json.dumps(respostas[min(len(recebidos), len(respostas)) - 1]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(dado)))
            self.end_headers()
            self.wfile.write(dado)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Servidor)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    antigo = os.environ.get("NO_PROXY")
    os.environ["NO_PROXY"] = "127.0.0.1,localhost"
    try:
        cliente = anthropic.Anthropic(api_key="chave-de-teste", base_url=f"http://127.0.0.1:{srv.server_port}",
                                      max_retries=0)
        cl = arena.Claude(cliente, "claude-opus-5-5", "low")
        texto = cl.perguntar_formatado("sis", "usr", arena.ESQUEMA_DECISAO)
        caminho, cab, corpo = recebidos[0]
        cab = {k.lower(): v for k, v in cab.items()}
        checar(caminho.startswith("/v1/messages") and "server-side-fallback-2026-07-01" in cab.get("anthropic-beta", "")
               and corpo["fallbacks"] == "default" and corpo["model"] == "claude-opus-5-5"
               and corpo["output_config"]["format"]["type"] == "json_schema" and "thinking" not in corpo,
               f"SDK {anthropic.__version__}: pedido com fallback do servidor e formato fixo, sem thinking")
        checar(arena.ler_decisao(texto)[0] == 1 and cl.uso == (1500, 210), "SDK: resposta lida e tokens guardados")
        try:
            cl.perguntar_formatado("sis", "usr", arena.ESQUEMA_DECISAO)
            checar(False, "SDK: recusa deveria virar erro tratado")
        except arena.Recusou:
            checar(True, "SDK: recusa (stop_reason refusal) vira erro tratado, e o juiz poe NADA")
    finally:
        srv.shutdown()
        if antigo is None:
            os.environ.pop("NO_PROXY", None)
        else:
            os.environ["NO_PROXY"] = antigo


# --------------------------------------------------------------------------- #
# [12] Pionex e Telegram
# --------------------------------------------------------------------------- #

class PionexFalsa:
    """A API publica de klines da Pionex como a especificacao oficial descreve:
    ate 500 por pedido, do mais novo para o mais antigo, endTime inclusivo,
    o candle em formacao incluido, precos como texto."""

    def __init__(self, s, ms, formando: dict, recusar: str = ""):
        self.s, self.ms, self.formando, self.recusar = s, ms, formando, recusar
        self.pedidos = []

    def __call__(self, url):
        import urllib.parse as up
        q = dict(up.parse_qsl(up.urlparse(url).query))
        self.pedidos.append(q)
        if self.recusar:
            return {"result": False, "code": "TRADE_INVALID_SYMBOL", "message": self.recusar, "timestamp": 1}
        assert url.startswith("https://api.pionex.com/api/v1/market/klines?")
        lim = int(q.get("limit", 100))
        fim = int(q["endTime"]) if "endTime" in q else 10 ** 15
        linhas = [{"time": t, "open": f"{o}", "close": f"{c}", "high": f"{h}", "low": f"{l}", "volume": f"{v}"}
                  for t, o, h, l, c, v in zip(self.s.t, self.s.abertura, self.s.maxima, self.s.minima,
                                               self.s.fechamento, self.s.volume)] + [self.formando]
        linhas = [k for k in linhas if k["time"] <= fim]
        return {"result": True, "data": {"klines": list(reversed(linhas[-lim:]))}, "timestamp": 1}


def teste_pionex_telegram() -> None:
    print("\n[12] Pionex como fonte, conferencia entre fontes e comandos do Telegram")
    import time as tempo
    import vigia
    ms = est.MIN15
    agora = int(tempo.time() * 1000)
    inicio_formando = agora // ms * ms
    s = serie_sintetica(1300, 21, True, t0=inicio_formando - 1300 * ms)
    formando = {"time": inicio_formando, "open": "1", "close": "1", "high": "1", "low": "1", "volume": "1"}
    falsa = PionexFalsa(s, ms, formando)
    original, pausa, dormir, relogio_real = bt._pedir, bt.PIONEX_PAUSA, bt.time.sleep, bt.time.monotonic
    relogio = RelogioFalso()
    bt._pionex_ultimo[0] = None
    bt._pedir = relogio.anotando(falsa)
    bt.time.sleep, bt.time.monotonic = relogio.dormir, relogio.agora
    try:
        r = bt.buscar_pionex_ou_erro("BTCUSDT", "15m", 1200)
        checar(all(q["symbol"] == "BTC_USDT_PERP" and q["interval"] == "15M" and q["limit"] == "500"
                   for q in falsa.pedidos),
               f"pede o perpetuo BTC_USDT_PERP em 15M, de 500 em 500 ({len(falsa.pedidos)} paginas)")
        checar(len(r) == 1200 and r.t == s.t[-1200:] and r.fechamento == s.fechamento[-1200:]
               and r.volume == s.volume[-1200:],
               "1200 candles fechados, na ordem, sem buraco nem repetido, precos lidos do texto")
        checar(inicio_formando not in r.t, "o candle em formacao fica de fora")
        checar(len(relogio.momentos) == len(falsa.pedidos) > 1 and relogio.menor_intervalo() >= bt.PIONEX_PAUSA - 1e-9,
               f"no minimo {bt.PIONEX_PAUSA}s entre dois pedidos a Pionex (teto de 10 por segundo, peso 5)")
        bt._pedir = PionexFalsa(s, ms, formando, recusar="simbolo invalido")
        try:
            bt.buscar_pionex_ou_erro("BTCUSDT", "15m", 100)
            checar(False, "resposta recusada deveria virar ErroBusca")
        except bt.ErroBusca as e:
            checar("simbolo invalido" in e.erros[0], f"resposta recusada vira erro explicado: {e.erros[0]}")
    finally:
        bt._pedir, bt.PIONEX_PAUSA, bt.time.sleep, bt.time.monotonic = original, pausa, dormir, relogio_real
        bt._pionex_ultimo[0] = None  # o relogio falso nao pode atrasar o proximo pedido de verdade
    checar(bt.simbolo_pionex("ETHUSDT") == "ETH_USDT_PERP" and set(bt.PIONEX_INTERVALO) == set(bt.PERIODOS),
           "todos os periodos do projeto tem nome na Pionex")

    # fontes nunca se misturam: trilha e cache rotulados pela fonte
    cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
    cfg["historico_inicial_dias"] = 7
    with tempfile.TemporaryDirectory() as tmp:
        ponteiro = {"fim": 700}
        busca = lambda par, tf, n: bt.fatiar(s, max(0, ponteiro["fim"] - n), ponteiro["fim"])  # noqa: E731
        estado = {"versao": 1, "trilhas": {}, "ultimo_resumo": None}
        vigia.ciclo(estado, cfg, "BTCUSDT", "15m", busca, s.t[699] + ms + 1000, tmp, None, None, "pionex")
        ponteiro["fim"] = 701
        vigia.ciclo(estado, cfg, "BTCUSDT", "15m", busca, s.t[700] + ms + 1000, tmp, None, None, "pionex")
        vigia.ciclo(estado, cfg, "BTCUSDT", "15m", busca, s.t[700] + ms + 1000, tmp, None, None, "binance")
        arquivos = sorted(os.listdir(tmp))
    checar(sorted(estado["trilhas"]) == ["confl3|ambos|livre|BTCUSDT@pionex|15m", "confl3|ambos|livre|BTCUSDT|15m",
                                         "engolfo|ambos|livre|BTCUSDT@pionex|15m", "engolfo|ambos|livre|BTCUSDT|15m"]
           and "candles_BTCUSDT@pionex_15m.json" in arquivos and "candles_BTCUSDT_15m.json" in arquivos,
           "Pionex e Binance em trilhas e caches separados: candles de duas fontes nunca se misturam")

    # conferencia
    b = bt.fatiar(s, 0, 100)
    outra = bt.fatiar(s, 0, 100)
    outra.fechamento = list(outra.fechamento)
    outra.fechamento[-2] *= 1.004
    checar(abs(bt.divergencia(b, outra)[0] - 100 * (1 / 1.004 - 1) * -1) < 1e-9 and bt.divergencia(b, outra)[1] == 5,
           "divergencia: maior diferenca de fechamento nos ultimos 5 candles em comum")
    msgs, registro = [], []
    est_c = {}
    cfg_c = dict(cfg, conferir_com="binance", divergencia_max_pct=0.3)
    t0 = 10 ** 12
    vigia.conferir(est_c, cfg_c, "BTCUSDT", "15m", b, outra, t0, msgs.append, registro.append)
    vigia.conferir(est_c, cfg_c, "BTCUSDT", "15m", b, outra, t0 + 15 * 60_000, msgs.append, registro.append)
    vigia.conferir(est_c, cfg_c, "BTCUSDT", "15m", b, outra, t0 + 61 * 60_000, msgs.append, registro.append)
    vigia.conferir(est_c, cfg_c, "BTCUSDT", "15m", b, b, t0 + 200 * 60_000, msgs.append, registro.append)
    reg = est_c["conferencia"]["BTCUSDT|15m"]
    checar(len(msgs) == 2 and msgs == registro and "divergem 0.40%" in msgs[0] and reg["alertas"] == 3 and reg["pct"] == 0,
           "divergencia acima do limite avisa no maximo 1 vez por hora; fontes iguais nao avisam")

    # vigia.json antigo: a fonte continua a de antes
    with tempfile.TemporaryDirectory() as tmp:
        arq = os.path.join(tmp, "vigia.json")
        velho = json.loads(json.dumps(vigia.CONFIG_PADRAO))
        for k in ("fonte", "conferir_com", "divergencia_max_pct"):
            del velho[k]
        json.dump(velho, open(arq, "w"))
        c_velho = vigia.carregar_config(arq)
        c_novo = vigia.carregar_config(os.path.join(tmp, "novo.json"))
    checar(c_velho["fonte"] == "binance" and c_velho["conferir_com"] == "" and c_novo["fonte"] == "pionex"
           and c_novo["conferir_com"] == "binance",
           "vigia.json antigo continua na Binance (trocar no meio seria outra hipotese); instalacao nova ja nasce na Pionex")

    # telegram: so o dono e respondido, mensagens velhas nao
    import threading
    parar = threading.Event()
    offsets, enviados = [], []
    lotes = [
        [{"update_id": 10, "message": {"chat": {"id": 555}, "text": "/placar"}}],  # chegou com o vigia desligado
        [{"update_id": 11, "message": {"chat": {"id": 999}, "text": "/placar"}},  # um estranho
         {"update_id": 12, "message": {"chat": {"id": 555}, "text": "/placar"}},
         {"update_id": 13, "message": {"chat": {"id": 555}, "text": "/status"}},
         {"update_id": 14, "message": {"chat": {"id": 555}, "text": "oi"}},
         {"update_id": 15, "message": {"chat": {"id": 555}, "text": "/ajuda@MeuRoboBot"}}],
    ]

    def pedir(tok, offset, espera):
        offsets.append(offset)
        if not lotes:
            parar.set()
            return []
        return lotes.pop(0)

    with tempfile.TemporaryDirectory() as tmp:
        arq_estado = os.path.join(tmp, "estado.json")
        json.dump(estado, open(arq_estado, "w"))
        vigia.escutar_telegram({"telegram_token": "t", "telegram_chat_id": "555"}, dict(cfg, fonte="pionex"),
                               arq_estado, parar, pedir=pedir, enviar=enviados.append, espera=0)
    checar(offsets[:3] == [-1, 11, 16], f"pula o que chegou com o vigia desligado e avanca o offset ({offsets[:3]})")
    checar(len(enviados) == 3 and "Placar agora" in enviados[0] and "fonte pionex" in enviados[1]
           and "BTCUSDT 15m" in enviados[1] and "/placar" in enviados[2],
           "responde /placar, /status e /ajuda ao dono; ignora texto solto")
    # so o estranho manda mensagem: nenhuma resposta pode sair (medir o texto das respostas
    # nao serve: "999" aparece por acaso em "ha 8999 min")
    so_estranho = [[], [{"update_id": 20, "message": {"chat": {"id": 999}, "text": "/status"}},
                        {"update_id": 21, "message": {"chat": {"id": 999}, "text": "/analisar BTC"}},
                        {"update_id": 22, "message": {"chat": {"id": 999}, "text": "/resultado -1"}}]]
    parar2, enviados2 = threading.Event(), []
    def pedir2(tok, offset, espera):
        if not so_estranho:
            parar2.set()
            return []
        return so_estranho.pop(0)
    with tempfile.TemporaryDirectory() as tmp:
        arq_estado = os.path.join(tmp, "estado.json")
        json.dump(estado, open(arq_estado, "w"))
        vigia.escutar_telegram({"telegram_token": "t", "telegram_chat_id": "555"}, dict(cfg, fonte="pionex"),
                               arq_estado, parar2, pedir=pedir2, enviar=enviados2.append, espera=0)
    checar(enviados2 == [] and len(enviados) == 3,
           "mensagem de outra pessoa nao recebe resposta nenhuma (nem /status, /analisar ou /resultado)")

    # risco somado das posicoes abertas (varias ordens ao mesmo tempo)
    cfg_r = json.loads(json.dumps(vigia.CONFIG_PADRAO))   # banca 110, margem 15, 24x, stop 0,5%
    pos = {"direcao": 1, "entrada": 100.0, "px_stop": 99.5, "px_alvo": 101.0, "px_liq": 96.3,
           "liq_antes_do_stop": False, "barras": 1}
    est_r = {"trilhas": {f"t{k}": {"posicao": pos if k < 3 else None} for k in range(5)}}
    n, valor = vigia.risco_aberto(est_r, cfg_r)
    texto3 = vigia.texto_risco_aberto(est_r, cfg_r)
    est_r["trilhas"]["t3"]["posicao"] = pos
    texto4 = vigia.texto_risco_aberto(est_r, cfg_r)
    cfg_100x = json.loads(json.dumps(cfg_r))
    cfg_100x["params"]["alav"] = 100
    checar(n == 3 and abs(valor - 3 * (360 * 0.005 + 360 * 0.001)) < 1e-9 and "ACIMA" not in texto3
           and "ACIMA DO TETO" in texto4 and abs(vigia.risco_aberto(est_r, cfg_100x)[1] - 4 * (15 + 1500 * 0.0005)) < 1e-9,
           "risco aberto: 3 posicoes a 24x = 6,48 USDT (5,9%, dentro do teto de 6%); 4 passam do teto; a 100x cada uma perde a margem")

    # token errado ou sem internet: explica, nao despeja erro tecnico
    import contextlib
    import io
    import urllib.error
    original = vigia.urllib.request.urlopen
    respostas = []
    try:
        for erro in (urllib.error.HTTPError("u", 401, "Unauthorized", {}, None), urllib.error.URLError("sem rede")):
            def falso(*a, _e=erro, **k):
                raise _e
            vigia.urllib.request.urlopen = falso
            saida = io.StringIO()
            with contextlib.redirect_stdout(saida):
                r = vigia.telegram_descobrir({"telegram_token": "x"}, gravar=True, caminho=os.devnull)
            respostas.append((r, saida.getvalue()))
    finally:
        vigia.urllib.request.urlopen = original
    checar(respostas[0][0] is False and "token errado" in respostas[0][1]
           and respostas[1][0] is False and "internet" in respostas[1][1],
           "token errado ou sem internet: mensagem clara, sem erro tecnico na tela")


def teste_comando_unico() -> None:
    print("\n[14] vibe.py: um comando so, cada subcomando chama a ferramenta certa")
    import vibe
    chamadas = []
    original = vibe._rodar_main
    vibe._rodar_main = lambda modulo, args: chamadas.append((modulo, args))
    argv = sys.argv
    try:
        casos = {"bateria": ("bateria", []), "historico": ("bateria", ["--historico"]),
                 "vigia": ("vigia", []), "placar": ("vigia", ["--placar"]),
                 "backtest --listar": ("backtest", ["--listar"]), "arena ligar": ("vigia", ["--arena", "ligar"])}
        certos = 0
        for linha, esperado in casos.items():
            chamadas.clear()
            sys.argv = ["vibe.py"] + linha.split()
            vibe.main()
            certos += chamadas == [esperado]
        checar(certos == len(casos), f"{certos} de {len(casos)} subcomandos chamam a ferramenta certa")
        for linha in ("comando-que-nao-existe", "arena"):
            sys.argv = ["vibe.py"] + linha.split()
            try:
                vibe.main()
                checar(False, f"'{linha}' deveria ser recusado")
            except SystemExit as e:
                checar(e.code not in (0, None), f"'{linha}' e recusado com explicacao")
    finally:
        vibe._rodar_main, sys.argv = original, argv
    saida = subprocess.run([sys.executable, os.path.join(RAIZ, "vibe.py")], capture_output=True, text=True, timeout=30)
    checar(saida.returncode == 0 and "python3 vibe.py vigia" in saida.stdout, "sem argumento, mostra o menu")


def teste_regra_de_saida() -> None:
    """Backtest e vigia usam a mesma checar_barra, entao a paridade entre eles nao
    pega um erro DENTRO dela (inverter compra e venda passava em todas as guardas
    de paridade). Aqui a regra e conferida contra a conta feita a mao."""
    print("\n[15] regra de saida conferida contra a conta feita a mao")
    p = bt.Params(banca=100, margem=10, alav=20, taxa=0.05, mm=0.5, stop=0.5, rr=2, max_barras=3)
    taxa = 200 * 0.0005 * 2  # notional 200, duas pontas
    perda_stop, ganho_alvo = -(200 * 0.005) - taxa, 200 * 0.01 - taxa
    c = bt.abrir(100.0, 1, p)
    v = bt.abrir(100.0, -1, p)
    checar(abs(c.px_stop - 99.5) < 1e-9 and abs(c.px_alvo - 101.0) < 1e-9 and abs(c.px_liq - 95.5) < 1e-9
           and abs(v.px_stop - 100.5) < 1e-9 and abs(v.px_alvo - 99.0) < 1e-9 and abs(v.px_liq - 104.5) < 1e-9,
           "compra: stop 99,5 alvo 101 liquidacao 95,5; venda: stop 100,5 alvo 99 liquidacao 104,5 (20x, mm 0,5%)")
    casos = [
        ("compra, preco cai ao stop", c, 100.2, 99.4, (perda_stop, "stop")),
        ("compra, preco sobe ao alvo", c, 101.1, 99.9, (ganho_alvo, "alvo")),
        ("compra, stop e alvo no mesmo candle conta stop", c, 101.5, 99.0, (perda_stop, "stop")),
        ("compra, candle dentro da faixa segue aberta", c, 100.9, 99.6, None),
        ("venda, preco sobe ao stop", v, 100.6, 99.8, (perda_stop, "stop")),
        ("venda, preco cai ao alvo", v, 100.1, 98.9, (ganho_alvo, "alvo")),
        ("venda, stop e alvo no mesmo candle conta stop", v, 101.0, 98.5, (perda_stop, "stop")),
    ]
    certos = []
    for nome, pos, maxima, minima, esperado in casos:
        r = bt.checar_barra(pos, maxima, minima, p)
        bate = (r is None and esperado is None) or (r is not None and esperado is not None
                                                     and r[1] == esperado[1] and abs(r[0] - esperado[0]) < 1e-9)
        certos.append(bate)
        if not bate:
            print(f"        {nome}: veio {r}, esperado {esperado}")
    checar(all(certos), f"{sum(certos)} de {len(casos)} casos: stop, alvo, empate conta stop, compra e venda espelhadas")
    p100 = bt.Params(banca=100, margem=10, alav=100, taxa=0.05, mm=0.5, stop=0.5, rr=2)
    c100 = bt.abrir(100.0, 1, p100)
    r = bt.checar_barra(c100, 100.1, 99.4, p100)
    checar(c100.liq_antes_do_stop and r == (-10.5, "liquidado"),
           "a 100x com stop de 0,5% a liquidacao chega antes: perde a margem (10) e a taxa de entrada (0,50)")
    s = bt.Serie(abertura=[100] * 5, maxima=[100.2] * 5, minima=[99.8] * 5,
                 fechamento=[100.0, 100.1, 100.2, 100.3, 100.4], volume=[1] * 5, t=list(range(5)))
    pnl, desfecho, j = bt._perna(s, 0, 1, p)
    checar(desfecho == "expirou" and j == 3 and abs(pnl - (200 * 0.003 - taxa)) < 1e-9,
           "sem stop nem alvo em 3 candles: fecha a mercado no 3o candle, com a taxa")


def teste_livro() -> None:
    print("\n[16] livro de ofertas: leitura de 3 fontes e desequilibrio perto do preco (so gravacao)")
    import livro
    compras = [(99.95, 2), (99.9, 1), (99.6, 4), (99.0, 5)]
    vendas = [(100.05, 1), (100.1, 1), (101.0, 5)]
    r = livro.resumo(compras, vendas)
    checar(r["medio"] == 100.0 and r["deseq_0.1"] == 0.2 and r["deseq_0.5"] == round(5 / 9, 4)
           and r["usdt_0.1"] == 500.0 and r["alcance_pct"] == 1.0 and abs(r["spread_pct"] - 0.1) < 1e-9,
           "desequilibrio = (compra - venda) / (compra + venda) dentro de 0,1% e 0,5% do preco medio, contado a mao")
    try:
        livro.resumo([(100.2, 1)], [(100.1, 1)])
        checar(False, "livro cruzado deveria ser recusado")
    except ValueError:
        checar(True, "livro cruzado (compra acima da venda) e recusado, nao vira numero")

    pionex = {"result": True, "data": {"bids": [["99.95", "2"], ["99.9", "1"]], "asks": [["100.05", "1"]],
                                       "updateTime": 1}, "timestamp": 1}
    urls = []
    c, v = livro.livro_pionex("BTCUSDT", pedir=lambda u: (urls.append(u), pionex)[1])
    checar("symbol=BTC_USDT_PERP" in urls[0] and c == [(99.95, 2.0), (99.9, 1.0)] and v == [(100.05, 1.0)],
           "Pionex: perpetuo BTC_USDT_PERP, precos como texto lidos certo")
    c, v = livro.livro_binance("BTCUSDT", pedir=lambda u: {"lastUpdateId": 1, "bids": [["99.9", "3"]], "asks": [["100.1", "2"]]})
    checar(c == [(99.9, 3.0)] and v == [(100.1, 2.0)], "Binance: formato oficial de profundidade")
    lados = [[{"px": "100.1", "sz": "2", "n": 1}], [{"px": "99.9", "sz": "3", "n": 2}]]  # venda primeiro, de proposito
    corpos = []
    c, v = livro.livro_hyperliquid("BTCUSDT", postar=lambda u, corpo: (corpos.append(corpo), {"coin": "BTC", "levels": lados})[1])
    checar(corpos[0] == {"type": "l2Book", "coin": "BTC"} and c == [(99.9, 3.0)] and v == [(100.1, 2.0)],
           "Hyperliquid: pede l2Book do BTC e separa compra de venda pelo preco, nao pela ordem")

    def quebrada(par):
        raise TimeoutError("sem resposta")
    avisos = []
    with tempfile.TemporaryDirectory() as tmp:
        linha = livro.gravar(tmp, "BTCUSDT", 123, 456, registrar=avisos.append, fontes={
            "pionex": lambda par: (compras, vendas), "binance": quebrada})
        gravadas = open(os.path.join(tmp, "livro.jsonl"), encoding="utf-8").read().splitlines()
    checar(len(gravadas) == 1 and linha["pionex"]["deseq_0.1"] == 0.2 and "erro" in linha["binance"]
           and linha["t"] == 123 and avisos and "binance" in avisos[0],
           "uma linha por candle; fonte que falha entra com o erro, sem derrubar as outras")
    import vigia
    checar(vigia.CONFIG_PADRAO["gravar_livro"] is True and "livro" not in "".join(est.REGISTRO),
           "gravacao ligada por padrao, e nenhuma estrategia usa o livro para operar")


def teste_fluxo() -> None:
    print("\n[17] fluxo agressor: compra e venda que bateram no livro, do dado da Binance")
    d = ind.delta_agressao([10, 10, 0, 8], [7, 0, 0, 4])
    checar(d == [0.4, -1.0, None, 0.0] and ind.delta_agressao([10, 10], []) == [None, None],
           "saldo da agressao: 7 de 10 comprados agredindo = +0,4; sem volume ou sem coluna = sem valor")
    falsa = BinanceFalsa(total=1200)
    original = bt._pedir
    bt._pedir = falsa
    try:
        s = bt.buscar_ou_erro("BTCUSDT", "15m", 1100)
    finally:
        bt._pedir = original
    fatia = bt.fatiar(s, 100, 200)
    checar(len(s.agressora) == len(s) == 1100 and fatia.agressora == s.agressora[100:200]
           and s.agressora[-1] == float(f"{falsa.serie.agressora[-2]}"),
           "a busca na Binance traz a compra agressora (campo 9 do candle) e o corte a preserva")

    c = serie_sintetica(400, 3)
    sinais = [0] * 400
    sinais[100], sinais[200], sinais[300] = 1, -1, 1
    for i in range(98, 101):
        c.agressora[i] = c.volume[i] * 0.8   # compra agressora forte: compra mantida
    for i in range(198, 201):
        c.agressora[i] = c.volume[i] * 0.8   # compra agressora forte: venda cortada
    for i in range(298, 301):
        c.agressora[i] = c.volume[i] * 0.2   # venda agressora forte: compra cortada
    f = est.com_fluxo(c, sinais)
    checar(f[100] == 1 and f[200] == 0 and f[300] == 0 and sum(1 for x in f if x) == 1,
           "filtro: mantem a compra com compra agressora; corta venda contra compra agressora e compra contra venda")
    s5 = serie_sintetica(3000, 5, True)
    base, fl = est.confluencia_3(s5), est.confl3_fluxo(s5)
    checar(sum(1 for x in fl if x) > 0 and all(x == 0 or x == base[i] for i, x in enumerate(fl)),
           f"confl3_fluxo e um subconjunto da confl3 ({sum(1 for x in fl if x)} de {sum(1 for x in base if x)} sinais)")
    sem = bt.Serie(s5.abertura, s5.maxima, s5.minima, s5.fechamento, s5.volume, s5.t)
    checar(not any(est.confl3_fluxo(sem)) and not any(est.canal_fluxo(sem)),
           "sem a coluna de agressao (Pionex), nenhum sinal: nao inventa o dado")
    import vigia
    with tempfile.TemporaryDirectory() as tmp:
        arq = os.path.join(tmp, "vigia.json")
        cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
        cfg["estrategias"].append({"nome": "confl3_fluxo", "lado": "ambos", "alinhar": False})
        json.dump(cfg, open(arq, "w"))
        try:
            vigia.carregar_config(arq)
            checar(False, "vigia deveria recusar estrategia de fluxo")
        except SystemExit as e:
            checar("compra agressora" in str(e.code), "o vigia recusa estrategia de fluxo com explicacao (ainda nao guarda a coluna)")


def _serie_mao(candles, t0=0, passo=None):
    """candles = [(abertura, maxima, minima, fechamento), ...], volume 1, 15 min."""
    passo = passo or est.MIN15
    s = bt.Serie()
    for k, (o, h, l, f) in enumerate(candles):
        s.abertura.append(o); s.maxima.append(h); s.minima.append(l); s.fechamento.append(f)
        s.volume.append(1.0); s.t.append(t0 + k * passo)
    return s


def teste_montagens() -> None:
    print("\n[18] montagens de mesa: cada uma dispara so no desenho dela")
    base = [(100.0, 100.5, 99.5, 100.0)] * 25
    falso_alta = base + [(100.3, 101.0, 100.1, 100.2)]   # pavio acima de 100,5, fecha dentro, candle de baixa
    falso_baixa = base + [(99.6, 99.9, 99.0, 99.8)]      # pavio abaixo de 99,5, fecha dentro, candle de alta
    rompeu = base + [(100.2, 101.0, 100.1, 100.8)]       # rompimento de verdade: fecha fora
    c1, c2, c3 = (est.cacada_stops(_serie_mao(x)) for x in (falso_alta, falso_baixa, rompeu))
    checar(c1[25] == -1 and c2[25] == 1 and c3[25] == 0 and sum(map(abs, c1 + c2 + c3)) == 2,
           "caca de stops: vende o falso rompimento de alta, compra o de baixa, ignora rompimento de verdade")

    ret = base + [(100.2, 101.0, 100.1, 101.0),   # 25: rompe 100,5
                  (101.0, 101.2, 100.9, 101.1),   # 26: segue acima, sem tocar
                  (101.0, 101.1, 100.4, 100.8),   # 27: toca 100,5 e fecha acima -> compra
                  (100.8, 100.9, 100.4, 100.7)]   # 28: toca de novo: nao repete
    r = est.rompimento_reteste(_serie_mao(ret))
    falhou = base + [(100.2, 101.0, 100.1, 101.0), (100.9, 101.0, 100.2, 100.3), (100.3, 100.6, 100.2, 100.55)]
    r2 = est.rompimento_reteste(_serie_mao(falhou))
    checar(r[27] == 1 and sum(map(abs, r)) == 1 and sum(map(abs, r2)) == 0,
           "reteste: compra no toque que segura; um sinal por rompimento; fechar abaixo do nivel cancela")

    largo = [(100.0, 101.0, 99.0, 100.0 + (1.0 if k % 2 else -1.0)) for k in range(130)]
    apertado = [(100.0, 100.02, 99.98, 100.0 + (0.01 if k % 2 else -0.01)) for k in range(30)]
    saida = [(100.0, 100.6, 99.99, 100.5)]
    comp = est.compressao_expansao(_serie_mao(largo + apertado + saida))
    sem_aperto = est.compressao_expansao(_serie_mao(largo + [(100.0, 101.6, 99.9, 101.5)]))
    checar(comp[-1] == 1 and sum(map(abs, comp)) == 1 and sem_aperto[-1] == 0,
           "compressao: rompimento logo depois do aperto entra; o mesmo rompimento com volatilidade constante, nao")

    s5 = serie_sintetica(3000, 5, True)
    ses, c3s = est.confl3_sessao(s5), est.confluencia_3(s5)
    horas = {(s5.t[i] // 3_600_000) % 24 for i, x in enumerate(ses) if x}
    dias = {((s5.t[i] // 86_400_000) + 3) % 7 for i, x in enumerate(ses) if x}
    checar(any(ses) and horas <= set(range(12, 17)) and dias <= set(range(5))
           and all(x == 0 or x == c3s[i] for i, x in enumerate(ses)) and est.sessao_ativa(0) is False,
           f"sessao: so 12h-17h UTC de segunda a sexta ({sum(1 for x in ses if x)} de {sum(1 for x in c3s if x)} sinais da confl3)")

    dia = est.MIN15 * 96
    v = ind.vwap_diaria([10, 20, 30], [10, 20, 30], [10, 20, 30], [1, 1, 2], [0, est.MIN15, dia])
    checar(v == [10.0, 15.0, 30.0], "VWAP do dia: media ponderada pelo volume, recomecando a 00:00 UTC")
    d = [(100.0, 100.4, 99.9, 100.3)] * 4 + [(100.3, 100.5, 100.3, 100.4), (100.4, 100.45, 100.0, 100.4)]
    vd = est.vwap_do_dia(_serie_mao(d))
    vwap5 = ind.vwap_diaria(*[_serie_mao(d).__getattribute__(k) for k in ("maxima", "minima", "fechamento", "volume", "t")])[5]
    checar(vd[5] == 1 and sum(map(abs, vd)) == 1 and 100.0 <= vwap5 < 100.4,
           f"VWAP do dia: compra quando a minima toca a VWAP ({vwap5:.3f}) e fecha acima, ja do lado comprador")


def teste_prova_contra_sorte() -> None:
    print("\n[19] prova contra sorte: Sharpe deflacionado pelo numero de tentativas")
    import estatistica as st
    checar(abs(st.sharpe([2, -1, 2, -1]) - 0.5 / 3 ** 0.5) < 1e-12 and st.momentos([2, -1, 2, -1]) == (0.0, 1.0),
           "Sharpe por operacao e momentos contados a mao (media 0,5, desvio raiz de 3; assimetria 0, curtose 1)")
    checar(abs(st.sharpe_maximo_esperado(1000, 1.0) - 3.2551) < 1e-3 and abs(st.sharpe_maximo_esperado(100, 1.0) - 2.5306) < 1e-3
           and st.sharpe_maximo_esperado(1, 1.0) == 0.0,
           "melhor Sharpe da sorte: 1.000 tentativas dao 3,26 desvios (o valor do artigo), 100 dao 2,53, 1 da zero")
    r = [2, -1] * 50
    d1, d10, d1000 = (st.sharpe_deflacionado(r, n)["dsr"] for n in (1, 10, 1000))
    checar(abs(d1 - 0.99952) < 1e-4 and abs(d1000 - 0.5179) < 1e-3 and d1 > d10 > d1000,
           f"mesmo resultado, mais tentativas, menos prova: 1 tentativa {d1:.4f}, 10 {d10:.4f}, 1.000 {d1000:.4f}")
    checar(st.sharpe_deflacionado([1.0, -1.0], 5)["dsr"] == 0.0 and st.sharpe_deflacionado([], 5)["dsr"] == 0.0,
           "com menos de 3 operacoes nao ha prova nenhuma")
    import bateria as bat_mod
    forte, fraco = [2, -1] * 50, [1.05, -1] * 50
    pior = bat_mod.prova_por_ativo([forte, fraco], 10, None)
    checar(abs(pior["dsr"] - st.sharpe_deflacionado(fraco, 10)["dsr"]) < 1e-12 and pior["dsr"] < st.sharpe_deflacionado(forte, 10)["dsr"],
           f"ativos correlacionados nao somam prova: vale a pior nota ({pior['dsr']:.3f}), nao a das operacoes juntas")

    import contextlib
    import io
    import bateria
    original, argv = bt._pedir, sys.argv
    with tempfile.TemporaryDirectory() as tmp:
        caderno = os.path.join(tmp, "caderno.jsonl")
        try:
            bt._pedir = BinanceFalsa(total=3500)
            sys.argv = ["bateria.py", "--ativos", "BTCUSDT,ETHUSDT", "--periodos", "1h", "--estrategias", "confl3,cacada",
                        "--caderno", caderno]
            saida = io.StringIO()
            with contextlib.redirect_stdout(saida):
                bateria.main()
        finally:
            bt._pedir, sys.argv = original, argv
        registros = [json.loads(l) for l in open(caderno, encoding="utf-8")]
    texto = saida.getvalue()
    checar(all("sharpe_op" in x for x in registros) and "nao-sorte" in texto and "Sharpe deflacionado" in texto,
           "a bateria grava o Sharpe de cada tentativa e mostra a chance de nao ser sorte")
    linhas = [l for l in texto.splitlines() if l.strip().startswith(("confl3", "cacada")) and "%" in l]
    ok_regra = True
    for l in linhas:
        dsr = float(l.split("|")[-2].strip().rstrip("%"))
        if l.rstrip().split("|")[-1].strip().startswith("SIM") and dsr < 95:
            ok_regra = False
    checar(linhas and ok_regra, "nenhuma estrategia passa com menos de 95% de chance de nao ser sorte")


def teste_smc() -> None:
    print("\n[20] Smart Money Concepts: estrutura, vao de valor justo, bloco de ordens, desconto e premio")
    # (abertura, maxima, minima, fechamento); pivo com k=1
    seq = [(9.5, 10, 9, 9.5),       # 0
           (11.5, 12, 11, 11.5),    # 1  topo 12 (confirmado no 2)
           (10.5, 11, 10, 10.5),    # 2
           (10.0, 10, 8, 9.0),      # 3  fundo 8 (confirmado no 4); candle de BAIXA: o bloco de ordens
           (9.5, 11, 9, 10.0),      # 4
           (12.0, 13, 11, 12.5),    # 5  fecha acima de 12: quebra de estrutura de alta (BOS)
           (11.5, 12, 10, 10.2),    # 6  volta ao bloco (minima 10 <= 10) e fecha acima de 8; abaixo do meio 10,5
           (10.25, 11, 9.5, 10.25), # 7  fundo 9,5 (confirmado no 8)
           (11.0, 12, 10, 11.0),    # 8  topo 12 (confirmado no 9)
           (9.5, 10, 8.8, 9.0)]     # 9  fecha abaixo de 9,5 vindo de alta: mudanca de carater (CHoCH)
    s = _serie_mao(seq)
    ev, faixas, tend = est.estrutura_mercado(s, k=1)
    checar(ev == [0, 0, 0, 0, 0, 1, 0, 0, 0, -2] and tend[5] == 1 and tend[9] == -1 and faixas[6] == (8, 13),
           "estrutura: quebra de alta no candle 5 (BOS), mudanca de carater para baixa no 9 (CHoCH), faixa 8 a 13")
    checar(est.quebra_estrutura(s, k=1)[5] == 1 and sum(map(abs, est.quebra_estrutura(s, k=1))) == 1
           and est.mudanca_carater(s, k=1)[9] == -1 and sum(map(abs, est.mudanca_carater(s, k=1))) == 1,
           "BOS so entra na continuacao; CHoCH so na reversao")
    ob = est.bloco_de_ordens(s, k=1)
    smc = est.bloco_de_ordens(s, k=1, so_smc=True)
    premio = _serie_mao(seq[:6] + [(11.5, 12, 10, 11.0)] + seq[7:])  # mesmo toque, fechando acima do meio
    checar(ob[6] == 1 and smc[6] == 1 and est.bloco_de_ordens(premio, k=1, so_smc=True)[6] == 0
           and est.bloco_de_ordens(premio, k=1)[6] == 1,
           "bloco de ordens: compra na volta ao ultimo candle de baixa antes do impulso; a montagem SMC so aceita no desconto")

    fvg = [(99.5, 100, 99, 99.8), (100, 101.5, 100, 101.4), (101.4, 102, 100.5, 101.8),  # vao de 100 a 100,5
           (101.8, 102.5, 101, 102.2),                                                    # nao toca
           (102.0, 102.1, 100.3, 101.0)]                                                  # entra no vao e segura
    f = est.vao_valor_justo(_serie_mao(fvg))
    sem = est.vao_valor_justo(_serie_mao(fvg[:4] + [(102.0, 102.1, 99.5, 99.8)]))  # atravessa e fecha abaixo
    checar(f[4] == 1 and sum(map(abs, f)) == 1 and sum(map(abs, sem)) == 0,
           "vao de valor justo: compra quando volta ao vao e segura; atravessar e fechar abaixo cancela")


def teste_scalping() -> None:
    print("\n[21] scalping: acerto minimo para empatar e o periodo de 5 minutos")
    p = bt.Params(stop=0.5, rr=2, taxa=0.05)
    checar(abs(bt.acerto_minimo(p) - 40.0) < 1e-9 and abs(bt.acerto_minimo(bt.Params(stop=0.5, rr=1, taxa=0.05)) - 60.0) < 1e-9,
           "empate: stop 0,5% e alvo 1% pedem 40% de acerto; alvo 0,5% pede 60% (taxa 0,05% por lado)")
    pa = bt.Params(stop=0.5, rr=2, taxa=0.05, alav=24, margem=15)
    pos = bt.abrir(100.0, 1, pa)
    ganho, _ = bt.checar_barra(pos, 101.5, 100.0, pa)
    perda, _ = bt.checar_barra(pos, 100.0, 99.0, pa)
    checar(abs(100 * -perda / (-perda + ganho) - bt.acerto_minimo(pa)) < 1e-9,
           f"o acerto minimo bate com o ganho ({ganho:+.2f}) e a perda ({perda:+.2f}) que o simulador produz")
    checar("5m" in bt.PERIODOS and bt.PIONEX_INTERVALO["5m"] == "5M" and est.ACIMA[est.MIN5] == (est.MIN15, est.H1)
           and bt.candles_para("5m", 90) == 90 * 288,
           "5 minutos: 288 candles por dia, nome na Pionex (5M), periodos acima 15 min e 1 h")


def teste_fase2_honesta() -> None:
    print("\n[22] fase 2 honesta: julga uma vez em pontos fixos, sem o vigia desligado, com prova contra sorte")
    import vigia
    boa = [3.24] * 60 + [-2.16] * 40
    j = vigia.julgar(boa, [0.0] * 20, tentativas=5)
    fraca = [3.24] * 42 + [-2.16] * 58
    jf = vigia.julgar(fraca, [-50.0] * 20, tentativas=5)
    perde = vigia.julgar([-1.0] * 100, [-200.0] * 20, tentativas=1)
    checar(j["nivel"] == "aprovada" and jf["nivel"] in ("reprovada", "promissora") and jf["nao_sorte"] < 0.95
           and perde["nivel"] == "reprovada",
           f"60% de acerto em 100 operacoes: aprovada ({j['nao_sorte']:.3f}); 42%: nao aprova ({jf['nao_sorte']:.3f}); perdendo: reprovada")
    checar(vigia.julgar(boa, [1000.0] * 20, 5)["nivel"] == "reprovada",
           "positiva mas perdendo para as moedas: reprovada")

    s = serie_sintetica(3000, 5, True)
    cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
    cfg["historico_inicial_dias"] = 7
    cfg["julgar_em"] = [10, 20]
    with tempfile.TemporaryDirectory() as tmp:
        estado, diario = _replay(s, cfg, tmp, 600, pausa=(1500, 1530))
    tr = estado["trilhas"]["confl3|ambos|livre|BTCUSDT|15m"]
    rec = {tid: sum(1 for r in diario if r["trilha"] == tid and r["recuperado"]) for tid in estado["trilhas"]}
    checar(sum(rec.values()) > 0 and all(len(x.get("ao_vivo", [])) == len(x["resultados"]) - rec[tid]
                                         for tid, x in estado["trilhas"].items()),
           f"operacoes fechadas com o vigia desligado ({sum(rec.values())}) ficam fora do julgamento, em todas as trilhas")
    js = tr["julgamentos"]
    checar(set(js) == {"10", "20"} and js["10"]["operacoes"] == 10 and js["20"]["operacoes"] == 20
           and tr["julgamento"] == js["20"] and js["10"]["tentativas"] == len(estado["trilhas"]),
           "julga uma vez em cada ponto (10 e 20), vale o mais recente, e conta as trilhas como tentativas")
    with tempfile.TemporaryDirectory() as tmp:
        estado_b, _ = _replay(s, cfg, tmp, 600, pausa=(1500, 1530))
    checar(estado_b["trilhas"]["confl3|ambos|livre|BTCUSDT|15m"]["julgamentos"]["10"] == js["10"],
           "o julgamento fica congelado: rodar de novo da exatamente o mesmo")
    txt = "\n".join(l["fase2"] for l in vigia.placar(estado))
    checar(("APROVADA" in txt or "REPROVADA" in txt or "PROMISSORA" in txt) and "julgada com 20 operacoes" in txt,
           "o placar mostra o nivel e com quantas operacoes ao vivo foi julgada")

    p = bt.Params(**cfg["params"])
    pos = {"direcao": 1, "entrada": 100.0, "px_stop": 99.5, "px_alvo": 101.0, "px_liq": 96.3,
           "liq_antes_do_stop": False, "barras": 0}
    em_teste = vigia.texto_entrada("confl3", "BTCUSDT", "15m", pos, p)
    aprovada = vigia.texto_entrada("confl3", "BTCUSDT", "15m", pos, p, nivel="aprovada")
    promissora = vigia.texto_entrada("confl3", "BTCUSDT", "15m", pos, p, nivel="promissora")
    checar("EM TESTE" in em_teste and "EM TESTE" not in aprovada and "risco reduzido" in promissora
           and "lucro +3.24 USDT" in em_teste and "perda -2.16 USDT" in em_teste and "1.50" in em_teste,
           "todo alerta traz lucro (+3,24) e perda (-2,16) em USDT com taxa, e diz se a estrategia esta em teste")

    est_p = {"trilhas": {"x": {"resultados": [1.0]}}}
    msgs = []
    primeira = vigia.conferir_params(est_p, cfg, msgs.append)
    igual = vigia.conferir_params(est_p, cfg, msgs.append)
    mudou = json.loads(json.dumps(cfg))
    mudou["params"]["stop"] = 0.8
    recomecou = vigia.conferir_params(est_p, mudou, msgs.append)
    checar(not primeira and not igual and recomecou and est_p["trilhas"] == {} and len(est_p["arquivadas"]) == 1
           and list(est_p["arquivadas"].values())[0]["trilhas"]["x"]["resultados"] == [1.0] and len(msgs) == 1,
           "mudou o stop no vigia.json: o placar recomeca e o antigo fica guardado, sem se misturar")


# --------------------------------------------------------------------------- #
# ficha de cada operacao
# --------------------------------------------------------------------------- #

DIA_MS, HORA_MS = 86_400_000, 3_600_000
QUARTA = 20740 * DIA_MS            # 14/10/2026, quarta-feira, 00:00 UTC
AGORA_FICHA = QUARTA + 12 * HORA_MS  # 12:00 UTC


def _serie_plana(t0: int, ms: int, n: int, preco: float = 100.0, meia: float = 0.5, vol: float = 10.0) -> bt.Serie:
    s = bt.Serie()
    for k in range(n):
        s.t.append(t0 + k * ms)
        s.abertura.append(preco)
        s.fechamento.append(preco)
        s.maxima.append(preco + meia)
        s.minima.append(preco - meia)
        s.volume.append(vol)
    return s


def teste_ficha_calculo() -> None:
    print("\n[23] ficha: perfil de volume, niveis, perna, plano e alvos conferidos a mao")
    import ficha

    # perfil de volume: 10 candles pesados em 100,1-100,9 e 2 leves em 105-110
    pv = ind.perfil_volume([100.9] * 10 + [110.0] * 2, [100.1] * 10 + [105.0] * 2, [10.0] * 10 + [1.0] * 2)
    checar(pv is not None and 100.0 <= pv["poc"] <= 101.0 and 100.0 <= pv["val"] < pv["vah"] <= 101.0,
           f"perfil de volume: POC {pv and round(pv['poc'], 2)} e area de valor {pv and round(pv['val'], 2)}"
           f"-{pv and round(pv['vah'], 2)} onde o volume esta, nao nos candles leves")
    pv2 = ind.perfil_volume([101, 106, 101], [99, 105, 99], [1, 500, 1])
    degrau = (106 - 99) / 50
    checar(pv2 is not None and 105 - degrau <= pv2["poc"] <= 106,
           f"um candle de volume enorme (105-106) puxa o POC para ele ({pv2 and round(pv2['poc'], 2)}; "
           f"precisao de um degrau, {degrau:g})")
    checar(ind.perfil_volume([1, 1], [1, 1], [5, 5]) is None and ind.perfil_volume([2], [1], [0]) is None,
           "sem amplitude ou sem volume: sem perfil (nada inventado)")

    # niveis: dia e semana em UTC, semana de segunda a domingo
    t0 = QUARTA - 16 * DIA_MS
    h = _serie_plana(t0, HORA_MS, (AGORA_FICHA - t0) // HORA_MS)
    def marca(dia, hora, maxima=None, minima=None):
        i = h.t.index(dia * DIA_MS + hora * HORA_MS)
        if maxima is not None:
            h.maxima[i] = maxima
        if minima is not None:
            h.minima[i] = minima
    marca(20730, 9, maxima=120.0)      # domingo 04/10: semana retrasada (isca)
    marca(20733, 5, maxima=107.0)      # quarta 07/10: semana passada
    marca(20736, 14, minima=94.0)      # sabado 10/10: semana passada
    marca(20738, 10, maxima=109.0)     # segunda 12/10: esta semana (isca para "semana passada")
    marca(20739, 3, maxima=104.0)      # ontem
    marca(20739, 20, minima=97.0)      # ontem
    h.abertura[h.t.index(QUARTA)] = 100.2
    m = bt.Serie()
    for k in range(96):                # ontem em 15 min: o volume pesado perto de 98
        t = QUARTA - DIA_MS + k * 900_000
        pesado = k < 80
        m.t.append(t); m.abertura.append(98.0 if pesado else 103.0); m.fechamento.append(98.0 if pesado else 103.0)
        m.maxima.append(98.4 if pesado else 103.4); m.minima.append(97.6 if pesado else 102.6)
        m.volume.append(100.0 if pesado else 1.0)
    for k in range(48):                # hoje ate 11:45: preco tipico 100,2
        m.t.append(QUARTA + k * 900_000); m.abertura.append(100.0); m.fechamento.append(100.6)
        m.maxima.append(101.0); m.minima.append(99.0); m.volume.append(5.0 + k)
    nv = {}
    for n in ficha.niveis({"1h": h, "15m": m}, AGORA_FICHA, 100.0):
        nv.setdefault(n["nome"], []).append(n["preco"])
    checar(nv.get("topo de ontem") == [104.0] and nv.get("fundo de ontem") == [97.0],
           f"topo e fundo de ontem: {nv.get('topo de ontem')} e {nv.get('fundo de ontem')}")
    checar(nv.get("topo da semana passada") == [107.0] and nv.get("fundo da semana passada") == [94.0],
           f"semana passada de segunda a domingo: topo {nv.get('topo da semana passada')} (nem o 120 de antes "
           f"nem o 109 desta semana), fundo {nv.get('fundo da semana passada')}")
    checar(nv.get("abertura do dia") == [100.2], "abertura do dia: o primeiro candle de hoje em UTC")
    domingo = QUARTA + 4 * DIA_MS + 12 * HORA_MS    # domingo 18/10, ultimo dia da semana de 12/10
    h2 = _serie_plana(t0, HORA_MS, (domingo - t0) // HORA_MS)
    for i, t in enumerate(h.t):
        h2.maxima[i], h2.minima[i] = h.maxima[i], h.minima[i]
    nv2 = {}
    for n in ficha.niveis({"1h": h2}, domingo, 100.0):
        nv2.setdefault(n["nome"], []).append(n["preco"])
    checar(nv2.get("topo da semana passada") == [107.0],
           f"no domingo, a semana passada ainda e a de 05/10 a 11/10 (topo {nv2.get('topo da semana passada')}; "
           f"o 109 de segunda 12/10 e desta semana)")
    checar(nv.get("VWAP do dia") and abs(nv["VWAP do dia"][0] - 100.2) < 1e-9,
           "VWAP do dia so com os candles de hoje (preco tipico 100,2)")
    checar(nv.get("POC de ontem") and 97.6 <= nv["POC de ontem"][0] <= 98.4,
           f"POC de ontem onde o volume pesado esteve ({nv.get('POC de ontem')})")
    checar(sorted(nv.get("numero redondo", [])) == [100.0, 101.0] and ficha.passo_redondo(62000) == 1000
           and ficha.passo_redondo(3500) == 100 and ficha.passo_redondo(0.2) == 0.01,
           "numero redondo: 1.000 no BTC a 62 mil, 100 no ETH a 3.500, 0,01 numa moeda de 0,20")

    # vaos abertos: so o que o preco ainda nao tocou
    z = _serie_plana(0, HORA_MS, 12, 100.0, 0.1)
    z.minima[10] = 101.0; z.maxima[10] = 101.6; z.abertura[10] = 101.1; z.fechamento[10] = 101.5
    z.minima[11] = 101.2; z.maxima[11] = 101.7; z.abertura[11] = 101.5; z.fechamento[11] = 101.6
    vaos = [x for x in ficha.zonas_abertas(z) if x[0] == "vao"]
    checar(any(d == 1 and abs(b - 100.1) < 1e-9 and abs(a - 101.0) < 1e-9 for _, d, b, a, _ in vaos),
           "vao de alta 100,1-101,0 ainda nao tocado aparece como nivel")
    z.minima[11] = 100.9
    checar(not [x for x in ficha.zonas_abertas(z) if x[0] == "vao" and x[1] == 1 and abs(x[3] - 101.0) < 1e-9],
           "depois que o preco toca o vao, ele sai da lista")

    # perna atual: do ultimo fundo confirmado ate a maior maxima desde ele
    fech = [10, 9, 8, 7, 8, 9, 10, 11, 12, 13, 12, 11, 10]
    pz = bt.Serie(abertura=list(map(float, fech)), maxima=[x + 0.1 for x in fech], minima=[x - 0.1 for x in fech],
                  fechamento=list(map(float, fech)), volume=[1.0] * 13, t=list(range(13)))
    checar(est.perna_atual(pz, 1) == (6.9, 13.1) and est.perna_atual(pz, -1) == (9.9, 13.1),
           "perna da compra: fundo 6,9 ate 13,1; perna da venda: topo 13,1 ate 9,9")

    # plano conferido a mao: entrada 100, ATR 1, fundo do periodo de entrada em 97
    cfg = dict(ficha.FICHA_PADRAO)
    grupos = [{"preco": 100.3, "nomes": ["numero redondo"], "forte": True},      # a menos de meio ATR
              {"preco": 101.0, "nomes": ["vao de baixa aberto (1h)"], "forte": False},
              {"preco": 108.0, "nomes": ["topo de ontem"], "forte": True},
              {"preco": 112.0, "nomes": ["topo da semana passada"], "forte": True}]
    le = {"atr": 1.0, "fundo": 97.0, "topo": 103.0}
    p = ficha.plano(1, 100.0, le, grupos, "15m", cfg, 0.05, 100.0, 2.0, None, None, 0.5,
                    {"taxa": 0.0001, "intervalo_h": 8.0}, 24)
    checar(abs(p["stop"] - 96.75) < 1e-9 and abs(p["dist_pct"] - 3.25) < 1e-9,
           "stop 1/4 de ATR alem do fundo: 96,75 (3,25%)")
    checar(abs(p["alvos"][0]["preco"] - 107.9) < 1e-9 and abs(p["alvos"][1]["preco"] - 111.9) < 1e-9,
           "alvos so em nivel forte, a mais de meio ATR, 1/10 de ATR antes do nivel: 107,9 e 111,9")
    checar([c["preco"] for c in p["caminho"]] == [101.0] and abs(p["caminho"][0]["r"] - 1 / 3.25) < 1e-9,
           "o nivel fraco antes do alvo aparece 'no caminho', a 0,31x o risco")
    checar(abs(p["perda"] - 2.0) < 1e-9 and abs(p["tamanho"] - 2.0 / 0.0337) < 1e-9,
           "risco 2% de 100: perde exatamente 2,00 USDT no stop, com taxa nas duas pontas e deslize")
    checar(p["alav"] == 14 and p["liq_vezes"] >= 2.0,
           f"alavancagem {p['alav']}x: liquidacao a {p['liq_vezes']:.2f}x a distancia do stop (pelo menos 2x)")
    checar(abs(p["ganho1"] - p["tamanho"] * 0.078) < 1e-9 and abs(p["rr1"] - p["ganho1"] / 2.0) < 1e-12
           and abs(p["acerto_min"] - 200 / (2 + p["ganho1"])) < 1e-9,
           f"lucro no alvo 1 {p['ganho1']:.3f} USDT ({p['rr1']:.2f}x o risco); acerto minimo {p['acerto_min']:.1f}%")
    checar(abs(p["custo_funding"] - (-p["tamanho"] * 0.0001 * 3)) < 1e-12,
           "funding de 0,01% a cada 8 h, 24 h comprado: paga 3 cobrancas")
    faixas = [{"ate_usdt": 50.0, "alav_max": 100.0, "mm": 0.004}, {"ate_usdt": 1000.0, "alav_max": 20.0, "mm": 0.01}]
    moeda = {"passo_qtd": 0.1, "minimo_usdt": 5.0, "minimo_qtd": 0.1}
    p2 = ficha.plano(1, 100.0, le, grupos, "15m", cfg, 0.05, 100.0, 2.0, moeda, faixas, 0.5, None, 24)
    checar(p2["mm_pct"] == 1.0 and p2["alav"] == 13 and abs(p2["tamanho"] - 50.0) < 1e-9 and p2["perda"] <= 2.0,
           "faixa de risco da Pionex pelo tamanho (manutencao 1%, ate 20x); quantidade no passo, para baixo: "
           "nunca arrisca mais do que o pedido")
    p3 = ficha.plano(1, 100.0, le, grupos, "15m", cfg, 0.05, 100.0, 2.0, {"minimo_usdt": 60.0}, None, 0.5, None, 24)
    checar(p3["abaixo_do_minimo"] and abs(p3["risco_minimo_pct"] - 60 * 0.0337) < 1e-9,
           "abaixo do pedido minimo: diz o menor risco possivel (2,02%)")
    p4 = ficha.plano(-1, 100.0, le, grupos, "15m", cfg, 0.05, 100.0, 2.0, None, None, 0.5, None, 24)
    checar(abs(p4["stop"] - 103.25) < 1e-9 and p4["alvos"][0]["nivel"] is None
           and abs(p4["alvos"][0]["preco"] - (100 - 2 * 3.25)) < 1e-9,
           "venda: stop alem do topo (103,25); sem nivel forte abaixo, alvo de 2 vezes o risco")
    p5 = ficha.plano(1, 100.0, {"atr": 1.0, "fundo": 99.6, "topo": None}, grupos, "15m", cfg, 0.05, 100.0, 2.0,
                     None, None, 0.5, None, 24)
    checar(abs(p5["stop"] - 99.0) < 1e-9 and "1 ATR" in p5["stop_origem"],
           "fundo perto demais: o stop vai para 1 ATR, fora do ruido do candle")


def _dados_controlados(agora: int, preco: float = 96.0, **extra) -> dict:
    series = {}
    for tf in ("5m", "15m", "1h", "4h", "1d"):
        ms = bt.PERIODOS[tf] * 60_000
        fim = (agora // ms) * ms - ms   # ultimo candle fechado
        series[tf] = _serie_plana(fim - 79 * ms, ms, 80, preco)
    d = {"par": "BTCUSDT", "agora_ms": agora, "series": series, "erros": {},
         "moeda": {"negociando": True, "minimo_usdt": 5.0, "minimo_qtd": None, "passo_qtd": None},
         "indice": {"marca": preco, "funding": 0.0001}, "fundings": {"intervalo_h": 8.0, "media": 0.0001},
         "agenda_bls": []}
    d.update(extra)
    return d


def _com_leituras(leituras: dict, perna, niveis_falsos: list, chamar):
    """Roda `chamar` com a leitura de cada periodo, a perna e os niveis controlados."""
    import ficha
    originais = (ficha.leitura, ficha.niveis, est.perna_atual, ficha.gatilhos)
    def leitura_falsa(s, k=3):
        tf = next(tf for tf, ms in bt.PERIODOS.items() if len(s.t) > 1 and s.t[1] - s.t[0] == ms * 60_000)
        base = {"tendencia": 0, "evento": 0, "evento_ha": None, "fundo": None, "topo": None, "atr": 0.5,
                "ema200": None, "fechamento": s.fechamento[-1], "t": s.t[-1]}
        return {**base, **leituras.get(tf, {})}
    ficha.leitura, ficha.niveis = leitura_falsa, lambda series, agora, preco: list(niveis_falsos)
    est.perna_atual = lambda c, d, k=3: perna
    ficha.gatilhos = lambda s, tf, par, estado: []
    try:
        return chamar()
    finally:
        ficha.leitura, ficha.niveis, est.perna_atual, ficha.gatilhos = originais


def teste_ficha_veredito() -> None:
    print("\n[24] ficha: o veredito segue as regras escritas, motivo por motivo")
    import ficha
    alta = {"4h": {"tendencia": 1, "topo": 112.0, "fundo": 88.0}, "1h": {"tendencia": 1, "topo": 110.0, "fundo": 90.0},
            "15m": {"tendencia": 1, "topo": 99.0, "fundo": 94.0}}
    fracos = [{"preco": 100.0, "nome": "vao de baixa aberto (1h)"}]
    def rodar(leituras=alta, perna=(90.0, 110.0), niveis_=fracos, preco=96.0, horizonte="intraday", risco=2.0, **extra):
        d = _dados_controlados(AGORA_FICHA, preco, **extra)
        return _com_leituras(leituras, perna, niveis_, lambda: ficha.analisar(d, horizonte, risco, banca=100.0))

    f = rodar()
    p = f["plano"] or {}
    checar(f["veredito"] == "A FAVOR" and p.get("direcao") == 1 and abs(p["alvos"][0]["preco"] - 109.95) < 1e-9
           and [c["preco"] for c in p["caminho"]] == [99.0, 100.0],
           f"tudo alinhado, no desconto (30%), alvo no topo do 1h: A FAVOR ({f['veredito']}); "
           f"o topo do 15m e o vao ficam 'no caminho'")
    f = rodar(preco=108.0)
    checar(f["veredito"] == "ESPERAR" and any("premio" in m and "94,20" in m and "97,60" in m for m in f["esperar"]),
           "comprando no premio (90% da perna): ESPERAR, com a zona otima 94,20 a 97,60")
    f = rodar(leituras={**alta, "4h": {"tendencia": -1, "topo": 112.0, "fundo": 88.0}})
    checar(f["veredito"] == "ESPERAR" and f["plano"] is None
           and any("compra so se o 4h fechar acima de 112" in m for m in f["esperar"])
           and any("venda so se o 1h fechar abaixo de 90" in m for m in f["esperar"]),
           "4h e 1h discordam: ESPERAR sem plano, dizendo o que faria comprar e o que faria vender")
    f = rodar(leituras={**alta, "15m": {"tendencia": -1, "topo": 99.0, "fundo": 94.0}})
    checar(f["veredito"] == "ESPERAR" and any("15m ainda esta em baixa" in m and "acima de 99" in m for m in f["esperar"]),
           "periodo de entrada contra: ESPERAR ele virar (fechar acima do topo dele)")
    f = rodar(niveis_=fracos + [{"preco": 97.0, "nome": "numero redondo"}])
    checar(f["veredito"] == "ESPERAR" and any("espaco curto" in m for m in f["esperar"]),
           "nivel forte logo adiante (97): espaco curto, ESPERAR")
    f = rodar(risco=30.0)
    checar(f["veredito"] == "NAO OPERAR" and any("fora do aceito" in m for m in f["bloqueios"]),
           "risco de 30%: NAO OPERAR (erro de digitacao?)")
    f = rodar(moeda={"negociando": True, "minimo_usdt": 1000.0})
    checar(f["veredito"] == "NAO OPERAR" and any("abaixo do minimo" in m and "risco minimo possivel" in m
                                                   for m in f["bloqueios"]),
           "pedido abaixo do minimo da Pionex: NAO OPERAR, dizendo o risco minimo possivel")
    f = rodar(erros={"moeda": "LookupError: XYZ_USDT_PERP nao existe na Pionex"})
    checar(f["veredito"] == "NAO OPERAR" and "nao existe" in f["bloqueios"][0], "moeda que a Pionex nao tem: NAO OPERAR")
    d = _dados_controlados(AGORA_FICHA)
    d["agora_ms"] = AGORA_FICHA + 3 * 15 * 60_000
    f = _com_leituras(alta, (90.0, 110.0), fracos, lambda: ficha.analisar(d, "intraday", 2.0))
    checar(f["veredito"] == "NAO OPERAR" and any("atrasados" in m for m in f["bloqueios"]),
           "candles atrasados (45 min no 15m): NAO OPERAR com dado velho")
    cpi = [{"t_ms": AGORA_FICHA + 10 * 60_000, "nome": "CPI (inflacao ao consumidor, EUA)", "fonte": "teste"}]
    f = rodar(agenda_bls=cpi)
    checar(f["veredito"] == "ESPERAR" and any("CPI" in m for m in f["esperar"]),
           "CPI em 10 minutos: ESPERAR no intraday")
    f = rodar(agenda_bls=cpi, horizonte="swing",
              leituras={"1d": alta["4h"], "4h": alta["1h"], "1h": alta["15m"]})
    checar(f["veredito"] == "A FAVOR" and any("CPI" in a for a in f["avisos"]),
           "no swing, o CPI vira aviso e nao muda o veredito")
    f = rodar(indice={"marca": 96.0, "funding": 0.002})
    checar(any("funding extremo" in a and "comprado" in a for a in f["avisos"]),
           "funding de 0,2% por cobranca: aviso de lado comprado lotado")
    f = rodar(erros={"agenda_bls": "URLError: fora"})
    checar(any("agenda de CPI e payroll fora do ar" in a for a in f["avisos"]) and "agenda CPI/payroll" in ficha.texto(f),
           "agenda fora do ar: aviso e FORA DO AR no texto, nunca silencio")
    t = ficha.texto(rodar())
    checar(len(t) <= 4000 and "VEREDITO: A FAVOR" in t and "Nada aqui e ordem" in t and "no stop -2,00" in t,
           "o texto cabe numa mensagem do Telegram e mostra veredito, perda no stop e o aviso de que nao e ordem")


class RedeFalsa:
    """As fontes publicas como as especificacoes descrevem, para a ficha inteira."""

    def __init__(self, series: dict, formando_t: dict):
        self.series, self.formando_t = series, formando_t
        self.urls = []

    def __call__(self, url):
        import urllib.parse as up
        self.urls.append(url)
        u = up.urlparse(url)
        q = dict(up.parse_qsl(u.query))
        if u.path == "/api/v1/market/klines":
            tf = next(k for k, v in bt.PIONEX_INTERVALO.items() if v == q["interval"])
            s = self.series[tf]
            formando = {"time": self.formando_t[tf], "open": "1", "close": "1", "high": "1", "low": "1", "volume": "1"}
            return PionexFalsa(s, bt.PERIODOS[tf] * 60_000, formando)(url)
        if u.path == "/api/v1/common/symbols":
            return {"result": True, "data": {"symbols": [{"symbol": q["symbols"], "status": "TRADING",
                    "minNotional": "5", "minSizeMarket": "0.0001", "baseStep": "0.0001", "quoteStep": "0.1",
                    "liquidationFeeRate": "0.005"}]}}
        if u.path == "/api/v1/common/riskTable":
            return {"result": True, "data": {"symbols": [{"symbol": q["symbol"], "rows": [
                {"rowNum": 2, "notionalLimit": "1000000", "maxLeverage": "50", "maintMarginRatio": "0.01"},
                {"rowNum": 1, "notionalLimit": "200000", "maxLeverage": "100", "maintMarginRatio": "0.005"}]}]}}
        if u.path == "/api/v1/market/indexes":
            return {"result": True, "data": {"indexes": [{"symbol": q["symbol"], "indexPrice": "60000",
                    "markPrice": str(self.series["5m"].fechamento[-1]) if "5m" in self.series else "60000",
                    "nextFundingRate": "0.0001",
                    "nextFundingTime": 1}]}}
        if u.path == "/api/v1/market/fundingRates":
            return {"result": True, "data": {"symbol": q["symbol"], "rates": [
                {"fundingRate": "0.0001", "fundingTime": 1_000_000_000_000 - k * 8 * HORA_MS} for k in range(10)]}}
        if u.path == "/api/v1/market/depth":
            p = self.series["5m"].fechamento[-1] if "5m" in self.series else 60000.0
            return {"result": True, "data": {"bids": [[str(p * 0.9999), "2"]], "asks": [[str(p * 1.0001), "1"]]}}
        if u.path == "/api/v1/market/tickers":
            return {"result": True, "data": {"tickers": [
                {"symbol": "BTC_USDT_PERP", "open": "100", "close": "103", "high": "105", "low": "99", "amount": "9e8"},
                {"symbol": "PEPE_USDT_PERP", "open": "1", "close": "1.2", "high": "1.4", "low": "0.9", "amount": "8e6"},
                {"symbol": "XYZ_USDT_PERP", "open": "1", "close": "2", "high": "3", "low": "1", "amount": "1000"},
                {"symbol": "BTC_USDT", "open": "1", "close": "9", "high": "9", "low": "1", "amount": "9e9"}]}}
        raise OSError(f"fora do ar no teste: {u.netloc}")


def teste_ficha_fontes() -> None:
    print("\n[25] fontes da ficha: formato de cada uma, ritmo da Pionex, agenda em UTC e radar")
    import fatores
    import ficha
    import time as tempo

    # agenda: horario de Nova York -> UTC, com horario de verao dos EUA
    checar(fatores.nova_york_para_utc_ms(2026, 10, 28, 14) == 1_793_210_400_000
           and fatores.nova_york_para_utc_ms(2026, 12, 9, 14) == 1_796_842_800_000,
           "FOMC 28/10 as 14h de NY = 18h UTC (verao); 09/12 = 19h UTC (inverno)")
    checar(fatores.nova_york_para_utc_ms(2026, 3, 8, 3) - fatores.nova_york_para_utc_ms(2026, 3, 8, 1) == HORA_MS
           and fatores.nova_york_para_utc_ms(2026, 11, 1, 3) - fatores.nova_york_para_utc_ms(2026, 11, 1, 1) == 3 * HORA_MS,
           "virada do horario de verao: 08/03 e 01/11 de 2026")
    ics = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Consumer Price Index for October 20\r\n 26\r\n"
           "DTSTART;TZID=US-Eastern:20261112T083000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\n"
           "SUMMARY:Employment Situation for June 2026\r\nDTSTART:20260702T123000Z\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nSUMMARY:Producer Price Index\r\nDTSTART;VALUE=DATE:20261113\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nSUMMARY:Productivity and Costs\r\nDTSTART;TZID=US-Eastern:20261105T083000\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nSUMMARY:Consumer Price Index (sem fuso)\r\nDTSTART:20261210T083000\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nSUMMARY:Consumer Price Index (Londres)\r\nDTSTART;TZID=Europe/London:20261211T083000\r\nEND:VEVENT\r\n"
           "END:VCALENDAR\r\n")
    ev = fatores.ler_ics_bls(ics)
    checar([(e["nome"][:7], e["t_ms"]) for e in ev] == [("Payroll", 1_782_995_400_000), ("CPI (in", 1_794_490_200_000)],
           "BLS em iCal: CPI 12/11 08:30 NY = 13:30 UTC, payroll em UTC; dia sem hora, hora sem fuso ou de outro "
           "fuso e evento irrelevante ficam de fora (nao se chuta horario)")
    proximos = fatores.proximos_eventos(fatores.agenda_fomc(), AGORA_FICHA, 1, 24 * 15)
    checar([e["t_ms"] for e in proximos] == [1_793_210_400_000], "proximo FOMC a partir de 14/10/2026: 28/10")

    # cada fonte no formato da especificacao
    rede = RedeFalsa({}, {})
    m = fatores.moeda_pionex("BTCUSDT", rede)
    checar(m["negociando"] and m["minimo_usdt"] == 5.0 and m["passo_qtd"] == 0.0001, "regras da moeda lidas do texto")
    r = fatores.risco_pionex("BTCUSDT", rede)
    checar([x["ate_usdt"] for x in r] == [200000.0, 1000000.0] and r[0]["mm"] == 0.005 and r[1]["alav_max"] == 50.0,
           "tabela de risco em ordem de tamanho")
    errada = lambda url: {"result": True, "data": {"symbols": [{"symbol": "BTC_USDT_PERP", "rows": [
        {"notionalLimit": "1000", "maxLeverage": "100", "maintMarginRatio": "0.5"}]}]}}
    try:
        fatores.risco_pionex("BTCUSDT", errada)
        checar(False, "margem de manutencao em % (0,5) deveria ser recusada")
    except ValueError:
        checar(True, "margem de manutencao fora da faixa possivel (0,5 com 100x) e recusada, nao chutada")
    i = fatores.indice_pionex("BTCUSDT", rede)
    checar(i["funding"] == 0.0001, "funding como fracao, como no exemplo da especificacao ('0.0001')")
    fp = fatores.fundings_pionex("BTCUSDT", 10, rede)
    checar(fp["intervalo_h"] == 8.0 and abs(fp["media"] - 0.0001) < 1e-12, "intervalo do funding medido nas datas: 8 h")
    nao_tem = lambda url: {"result": True, "data": {"symbols": []}}
    try:
        fatores.moeda_pionex("XYZUSDT", nao_tem)
        checar(False, "moeda inexistente deveria virar erro")
    except LookupError as e:
        checar("nao existe" in str(e), "moeda que a Pionex nao lista: erro dizendo que nao existe")
    pos = fatores.posicoes_binance("BTCUSDT", lambda url: [
        {"timestamp": 3, "sumOpenInterestValue": "110"}, {"timestamp": 1, "sumOpenInterestValue": "100"}])
    checar(abs(pos["var_24h_pct"] - 10.0) < 1e-9, "posicoes abertas: variacao do mais antigo ao mais novo, em qualquer ordem")
    md = fatores.medo_ganancia(lambda url: {"data": [{"value": "71", "value_classification": "Greed"}, {"value": "65"}]})
    checar(md["valor"] == 71 and md["ontem"] == 65 and md["fonte"] == "alternative.me", "medo e ganancia com a fonte")
    try:
        fatores.dvol("SOLUSDT", AGORA_FICHA, rede)
        checar(False, "DVOL de SOL deveria ser recusado")
    except LookupError:
        checar(True, "DVOL so de BTC e ETH (a Deribit nao tem das outras)")
    giro = fatores.giro_24h(rede)
    top = ficha.radar(giro, 5_000_000, 10)
    checar([g["par"] for g in top] == ["PEPEUSDT", "BTCUSDT"] and abs(top[0]["amplitude_pct"] - 50.0) < 1e-9,
           "radar: so perpetuos em USDT com volume, ordenados pela oscilacao de 24 h")
    falha = fatores.conferir_fontes("BTCUSDT", AGORA_FICHA, lambda url: (_ for _ in ()).throw(OSError("sem rede")),
                                    lambda url: (_ for _ in ()).throw(OSError("sem rede")))
    checar(len(falha) == 12 and not any(ok for _, ok, _ in falha), "vibe.py fontes: fonte fora do ar vira FALHA, sem quebrar")
    csv = ("observation_date,DGS10\n2026-10-05,4.01\n2026-10-06,4.03\n2026-10-07,.\n2026-10-08,4.05\n"
           "2026-10-09,4.10\n2026-10-12,4.08\n2026-10-13,4.12\n")
    def fred(url):
        if "VIXCLS" in url:
            raise OSError("fora")
        return csv
    mac = fatores.macro_fred(fred, {"DGS10": "juros 10 anos EUA", "VIXCLS": "VIX"})
    x = mac["series"]["DGS10"]
    checar(x["data"] == "2026-10-13" and x["valor"] == 4.12 and abs(x["var_5"] - 0.11) < 1e-9
           and "VIXCLS" in mac["erros"] and "VIXCLS" not in mac["series"],
           "FRED: ultimo valor com a data dele, variacao em 5 dados, dia sem dado ('.') fora, serie que falha nao "
           "derruba as outras")

    # a ficha inteira pela rede simulada: ritmo da Pionex e conferencia
    agora = int(tempo.time() * 1000)
    series, formando = {}, {}
    for k, tf in enumerate(ficha.PERIODOS_FICHA):
        ms = bt.PERIODOS[tf] * 60_000
        formando[tf] = agora // ms * ms
        series[tf] = serie_sintetica(520, 40 + k, True, t0=formando[tf] - 520 * ms)
        series[tf].t = [formando[tf] - (520 - j) * ms for j in range(520)]
    rede = RedeFalsa(series, formando)
    original, dormir, relogio_real = bt._pedir, bt.time.sleep, bt.time.monotonic
    relogio = RelogioFalso()
    momentos = []  # so os pedidos a Pionex: o teto de pedidos e dela
    def anotada(url):
        if "api.pionex.com" in url:
            momentos.append(relogio.t)
        return rede(url)
    bt._pionex_ultimo[0] = None
    bt._pedir = anotada
    bt.time.sleep, bt.time.monotonic = relogio.dormir, relogio.agora
    try:
        d = ficha.coletar("BTCUSDT", agora, conferir=None, pedir=bt._pedir,
                          pedir_texto=lambda url: (_ for _ in ()).throw(OSError("sem rede")))
    finally:
        bt._pedir, bt.time.sleep, bt.time.monotonic = original, dormir, relogio_real
        bt._pionex_ultimo[0] = None
    pionex = [u for u in rede.urls if "api.pionex.com" in u]
    menor = min((b - a for a, b in zip(momentos, momentos[1:])), default=0.0)
    checar(len(pionex) >= 10 and len(momentos) == len(pionex) and menor >= bt.PIONEX_PAUSA - 1e-9,
           f"{len(pionex)} pedidos a Pionex numa ficha, nenhum par a menos de {bt.PIONEX_PAUSA}s (bloqueio de 60 s)")
    checar(set(d["series"]) == set(ficha.PERIODOS_FICHA) and all(len(d["series"][tf]) == 500 for tf in d["series"])
           and all(formando[tf] not in d["series"][tf].t for tf in d["series"]),
           "os 5 periodos com 500 candles fechados cada (o em formacao fica de fora)")
    checar("agenda_bls" in d["erros"] and "posicoes" in d["erros"] and "moeda" not in d["erros"],
           "o que nao respondeu entra em erros com o motivo; o resto segue")
    f = ficha.analisar(d, "intraday", 2.0)
    checar(f["veredito"] in ficha.VEREDITOS and "FORA DO AR" in ficha.texto(f),
           f"a ficha sai inteira mesmo com fontes fora do ar (veredito {f['veredito']})")
    import threading
    import time as relogio
    trava, ativas, pico = threading.Lock(), [0], [0]
    def devagar():
        with trava:
            ativas[0] += 1
            pico[0] = max(pico[0], ativas[0])
        relogio.sleep(0.3)  # fonte lenta (ou travando ate o limite)
        with trava:
            ativas[0] -= 1
    def lenta(url):
        if "api.pionex.com" not in url:
            devagar()
        return rede(url)
    def texto_lento(url):
        devagar()
        raise OSError("lenta")
    pausa = bt.PIONEX_PAUSA
    bt.PIONEX_PAUSA, bt._pedir = 0.0, lenta
    try:
        ficha._CACHE_LENTO.clear()
        ficha.coletar("BTCUSDT", agora, conferir=lambda par, tf, n: devagar() or series["15m"],
                      pedir=lenta, pedir_texto=texto_lento)
    finally:
        bt.PIONEX_PAUSA, bt._pedir = pausa, original
        bt._pionex_ultimo[0] = None
    checar(pico[0] >= 5, f"as fontes de fora da Pionex vao em paralelo ({pico[0]} lentas ao mesmo tempo): "
                         f"uma que trava nao segura as outras")


def teste_ficha_comandos() -> None:
    print("\n[26] /analisar, /fichas e /radar: pedido, registro e placar das fichas pela regra do backtest")
    import ficha
    import vigia
    checar(ficha.par_de("btc") == "BTCUSDT" and ficha.par_de("SOLUSDT") == "SOLUSDT", "BTC e SOLUSDT viram o par certo")
    recusados = 0
    for ruim in ("BTC/../x", "BTC USDT", "btc&symbol=ETH", "", "A" * 16):
        try:
            ficha.par_de(ruim)
        except ValueError:
            recusados += 1
    checar(recusados == 5, "moeda com caractere fora de letra e numero e recusada (o nome vai dentro de um endereco)")
    p = ficha.interpretar_pedido(["sol", "10%", "Scalp"])
    checar(p == {"par": "SOLUSDT", "risco_pct": 10.0, "horizonte": "scalp"}, "/analisar sol 10% scalp")
    p = ficha.interpretar_pedido(["eth"])
    checar(p["risco_pct"] == 2.0 and p["horizonte"] == "intraday", "sem risco: 2% e intraday")

    vistos = []
    servicos = {"analisar": lambda a, c, e, t: vistos.append(a) or "FICHA", "fichas": lambda t: "PLACAR",
                "radar": lambda c: (_ for _ in ()).throw(OSError("sem rede"))}
    cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
    r1 = vigia.responder_comando("/analisar@robo BTC 2 swing", {}, cfg, 0, servicos)
    r2 = vigia.responder_comando("/radar", {}, cfg, 0, servicos)
    checar(r1 == "FICHA" and vistos == [["BTC", "2", "swing"]], "/analisar chega com os argumentos")
    checar(r2.startswith("Nao consegui responder /radar") and "sem rede" in r2,
           "falha de rede vira mensagem, nunca derruba quem escuta o Telegram")
    checar("/analisar" in vigia.responder_comando("/ajuda", {}, cfg, 0, servicos), "/ajuda mostra o /analisar")

    pasta = tempfile.mkdtemp(prefix="fichas_")
    try:
        d = _dados_controlados(AGORA_FICHA)
        alta = {"4h": {"tendencia": 1, "topo": 112.0, "fundo": 88.0}, "1h": {"tendencia": 1, "topo": 110.0, "fundo": 90.0},
                "15m": {"tendencia": 1, "topo": 99.0, "fundo": 94.0}}
        txt = _com_leituras(alta, (90.0, 110.0), [], lambda: vigia.fazer_ficha(["btc"], cfg, {}, AGORA_FICHA, pasta,
                                                                                 lambda par, agora: d))
        regs = ficha.ler_fichas(pasta)
        checar(len(regs) == 1 and regs[0]["veredito"] == "A FAVOR" and f"Ficha {regs[0]['id']} registrada" in txt,
               "a ficha com plano fica registrada para o placar")
        txt = vigia.fazer_ficha(["btc", "50"], cfg, {}, AGORA_FICHA, pasta, lambda par, agora: d)
        d_min = _dados_controlados(AGORA_FICHA, moeda={"negociando": True, "minimo_usdt": 1000.0})
        txt2 = _com_leituras(alta, (90.0, 110.0), [], lambda: vigia.fazer_ficha(
            ["btc"], cfg, {}, AGORA_FICHA, pasta, lambda par, agora: d_min))
        checar(len(ficha.ler_fichas(pasta)) == 1 and "NAO OPERAR" in txt and "NAO OPERAR" in txt2
               and "PLANO" in txt2, "NAO OPERAR nao entra no placar, nem quando ha plano (pedido abaixo do minimo)")

        # placar: alvo, stop, stop e alvo no mesmo candle (conta stop) e expirada
        base = {"par": "BTCUSDT", "tf": "15m", "horizonte": "intraday", "direcao": 1, "entrada": 100.0, "stop": 98.0,
                "alvo": 104.0, "rr": 1.8, "tamanho": 100.0, "perda": 2.2, "max_barras": 4, "risco_pct": 2}
        t0 = AGORA_FICHA - 10 * 900_000
        regs = [dict(base, id="alvo", quando_ms=t0, veredito="A FAVOR"),
                dict(base, id="stop", quando_ms=t0 + 900_000, veredito="A FAVOR"),
                dict(base, id="mesmo", quando_ms=t0 + 2 * 900_000, veredito="ESPERAR"),
                dict(base, id="expira", quando_ms=t0 + 5 * 900_000, veredito="ESPERAR")]
        with open(os.path.join(pasta, "fichas.jsonl"), "w") as arq:
            arq.write("\n".join(json.dumps(r) for r in regs) + "\n")
        s = _serie_plana(t0 - 900_000, 900_000, 11, 100.0, 0.5)
        s.maxima[1] = 104.5                            # 1o candle depois da 1a ficha: alvo
        s.minima[2] = 97.5                             # 1o depois da 2a: stop
        s.maxima[3], s.minima[3] = 104.5, 97.5         # 1o depois da 3a: os dois, conta stop
        s.fechamento[9] = 101.0                        # 4o candle depois da 4a: fecha a 101
        chamadas = []
        buscar = lambda par, tf, n: chamadas.append(n) or s
        feitas = ficha.conferir_fichas(pasta, AGORA_FICHA, buscar)
        checar(feitas["alvo"]["desfecho"] == "alvo" and feitas["alvo"]["r"] == 1.8
               and feitas["stop"]["desfecho"] == "stop" and feitas["stop"]["r"] == -1.0,
               "ficha conferida candle a candle: alvo = o R prometido, stop = -1 R")
        checar(feitas["mesmo"]["desfecho"] == "stop", "stop e alvo no mesmo candle: conta stop (como no backtest)")
        checar(feitas["expira"]["desfecho"] == "expirou" and abs(feitas["expira"]["r"] - (100 * (1.0 - 0.1) / 100) / 2.2) < 1e-3,
               "sem stop nem alvo no prazo: fecha no ultimo candle, com taxa")
        linhas = ficha.placar_fichas(pasta, feitas)
        a = next(l for l in linhas if l["veredito"] == "A FAVOR")
        e = next(l for l in linhas if l["veredito"] == "ESPERAR")
        checar(a["conferidas"] == 2 and a["acerto"] == 50.0 and abs(a["soma_r"] - 0.8) < 1e-9 and e["conferidas"] == 2,
               "placar separado por veredito: A FAVOR contra ESPERAR")
        ficha.conferir_fichas(pasta, AGORA_FICHA, buscar)
        checar(len(chamadas) == 1, "ficha ja conferida nao e buscada de novo")
        checar("meta e 100" in ficha.texto_placar_fichas(linhas), "o placar diz que ainda nao ha prova (meta de 100)")
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


def teste_alertas() -> None:
    print("\n[27] alertas de mercado: movimento brusco, topo e fundo da semana, mudanca de faixa")
    import alertas
    import vigia
    M15 = 900_000
    t0 = 20731 * DIA_MS                                    # segunda 05/10/2026
    def serie(fim_ms, preco=100.0, meia=0.5, semana_passada=None):
        x = _serie_plana(t0, M15, (fim_ms - t0) // M15, preco, meia)
        if semana_passada:  # (topo, fundo) da semana de 05/10 a 11/10
            x.maxima[x.t.index(20733 * DIA_MS)], x.minima[x.t.index(20734 * DIA_MS)] = semana_passada
        return x
    def ultimo(s, abertura, maxima, minima, fechamento):
        s.abertura[-1], s.maxima[-1], s.minima[-1], s.fechamento[-1] = abertura, maxima, minima, fechamento
    agora = AGORA_FICHA
    s = serie(agora)
    ultimo(s, 100.0, 102.0, 98.0, 100.0)                  # amplitude 4% com ruido normal de 1%
    mem = {}
    a1 = alertas.avaliar("BTCUSDT", "15m", s, agora, mem)
    a2 = alertas.avaliar("BTCUSDT", "15m", s, agora, mem)
    checar(len(a1) == 1 and "MOVIMENTO BRUSCO" in a1[0] and "4,00x o normal" in a1[0] and a2 == [],
           "candle de 4x o ruido: um alerta de movimento brusco, e o mesmo candle nao repete")
    s2 = serie(agora + M15); ultimo(s2, 100.0, 102.0, 98.0, 100.0)
    s3 = serie(agora + 5 * M15); ultimo(s3, 100.0, 102.0, 98.0, 100.0)
    checar(alertas.avaliar("BTCUSDT", "15m", s2, agora + M15, mem) == []
           and len(alertas.avaliar("BTCUSDT", "15m", s3, agora + 5 * M15, mem)) == 1,
           "outro brusco 15 min depois fica calado; passada 1 hora, avisa de novo")
    checar(alertas.avaliar("BTCUSDT", "15m", s, agora + 3 * HORA_MS, {}) == [],
           "candle velho (vigia voltando de pausa): nenhum alerta atrasado")

    s = serie(agora)
    s.maxima[s.t.index(20733 * DIA_MS + 10 * HORA_MS)] = 101.0   # topo da semana passada: 101
    s.fechamento[-2] = 100.6
    ultimo(s, 100.6, 101.4, 100.5, 101.2)
    mem = {}
    a = alertas.avaliar("BTCUSDT", "15m", s, agora, mem)
    checar(any("ROMPEU O TOPO DA SEMANA PASSADA" in x and "101,00" in x for x in a)
           and any("MUDOU DE FAIXA" in x and "subiu acima de 101" in x for x in a) and not any("BRUSCO" in x for x in a),
           "fechou acima do topo da semana passada (101): avisa o rompimento e a nova faixa")
    s2 = serie(agora + M15); s2.maxima[s2.t.index(20733 * DIA_MS + 10 * HORA_MS)] = 101.0
    s2.fechamento[-2] = 100.8
    ultimo(s2, 100.8, 101.3, 100.7, 101.1)
    checar(not any("TOPO DA SEMANA" in x for x in alertas.avaliar("BTCUSDT", "15m", s2, agora + M15, mem)),
           "o mesmo rompimento na mesma semana nao repete")

    larga = (62_000.0, 59_000.0)   # semana passada larga: so a faixa muda
    s = serie(agora, 60_900.0, 30.0, larga)
    s.fechamento[-2] = 60_900.0
    ultimo(s, 60_900.0, 61_060.0, 60_890.0, 61_050.0)
    mem = {}
    a = alertas.avaliar("BTCUSDT", "15m", s, agora, mem)
    checar(a == ["MUDOU DE FAIXA BTCUSDT: subiu acima de 61.000,00 (fechou 61.050,00)."],
           "BTC atravessou 61.000 para cima: mudou de faixa (sem brusco: 2,8x o ruido)")
    s2 = serie(agora + M15, 60_900.0, 30.0, larga); s2.fechamento[-2] = 61_050.0
    ultimo(s2, 61_050.0, 61_060.0, 60_940.0, 60_950.0)
    s3 = serie(agora + 2 * M15, 60_900.0, 30.0, larga); s3.fechamento[-2] = 60_950.0
    ultimo(s3, 60_950.0, 61_060.0, 60_940.0, 61_020.0)
    b = alertas.avaliar("BTCUSDT", "15m", s2, agora + M15, mem)
    c = alertas.avaliar("BTCUSDT", "15m", s3, agora + 2 * M15, mem)
    checar(b == ["MUDOU DE FAIXA BTCUSDT: caiu abaixo de 61.000,00 (fechou 60.950,00)."] and c == [],
           "a volta para baixo avisa; subir de novo em menos de 4 h fica calado")
    checar(alertas.avaliar("BTCUSDT", "15m", s, agora, {}, {"ligados": False}) == [], "desligados: nenhum alerta")

    pasta = tempfile.mkdtemp(prefix="alertas_")
    try:
        s = serie(agora); ultimo(s, 100.0, 102.0, 98.0, 100.0)
        cache = {"t": s.t, "abertura": s.abertura, "maxima": s.maxima, "minima": s.minima,
                 "fechamento": s.fechamento, "volume": s.volume}
        vigia.gravar_json(vigia.arquivo_cache(pasta, "BTCUSDT", "15m", "pionex"), cache)
        estado, enviados = {"trilhas": {}}, []
        cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
        registro = []  # nunca o vigia.log de verdade
        vigia.avisar_mercado(estado, cfg, "BTCUSDT", "15m", agora, "pionex", enviados.append, pasta, registro.append)
        vigia.avisar_mercado(estado, cfg, "BTCUSDT", "15m", agora, "pionex", enviados.append, pasta, registro.append)
        checar(len(enviados) == 1 and "BRUSCO" in enviados[0] and registro == enviados
               and estado["alertas"]["BTCUSDT"]["ultimo_t"] == s.t[-1],
               "no vigia: le o cache da fonte, avisa no Telegram, registra e guarda a memoria no estado")
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


def teste_ichimoku_spring() -> None:
    print("\n[28] Ichimoku e spring de Wyckoff: conta a mao e cada um so no desenho dele")
    n = 120
    mx, mn = [i + 1.0 for i in range(n)], [float(i) for i in range(n)]
    ich = ind.ichimoku(mx, mn)
    checar(ich["tenkan"][100] == 96.5 and ich["kijun"][100] == 88.0 and ich["nuvem_a"][100] == 66.25
           and ich["nuvem_b"][100] == 49.0 and ich["nuvem_b"][76] is None and ich["nuvem_b"][77] == 26.0,
           "Ichimoku conferido a mao: tenkan 96,5, kijun 88, nuvem 66,25 e 49 (calculada 26 barras antes)")
    curto = ind.ichimoku(mx[:90], mn[:90])
    checar(all(curto[k] == ich[k][:90] for k in curto), "Ichimoku nao muda ao cortar a serie: nada do futuro")
    sobe = bt.Serie(abertura=[float(i) for i in range(n)], maxima=[i + 1.2 for i in range(n)],
                    minima=[i - 0.2 for i in range(n)], fechamento=[i + 1.0 for i in range(n)],
                    volume=[1.0] * n, t=list(range(n)))
    desce = bt.Serie(abertura=[float(n - i) for i in range(n)], maxima=[n - i + 0.2 for i in range(n)],
                     minima=[n - i - 1.2 for i in range(n)], fechamento=[n - i - 1.0 for i in range(n)],
                     volume=[1.0] * n, t=list(range(n)))
    checar(-1 not in est.gerar("ichimoku", sobe) and 1 not in est.gerar("ichimoku", desce),
           "Ichimoku: nunca vende em alta continua nem compra em queda continua")

    def lateral(antes_de: float = 100.0):
        f = [antes_de] + [100.0] * 40
        return bt.Serie(abertura=list(f), maxima=[x + 0.5 for x in f], minima=[x - 0.5 for x in f],
                        fechamento=list(f), volume=[1.0] * 41, t=list(range(41)))
    s = lateral()
    s.abertura.append(99.8); s.minima.append(99.0); s.maxima.append(100.4); s.fechamento.append(100.2)
    s.volume.append(1.0); s.t.append(41)
    checar(est.gerar("spring", s)[-1] == 1, "spring: fura o fundo da faixa lateral e fecha dentro, de alta: compra")
    u = lateral()
    u.abertura.append(100.2); u.maxima.append(101.0); u.minima.append(99.6); u.fechamento.append(99.8)
    u.volume.append(1.0); u.t.append(41)
    checar(est.gerar("spring", u)[-1] == -1, "upthrust: fura o topo e fecha dentro, de baixa: venda")
    t = lateral(90.0)
    for k in range(1, 41):
        t.fechamento[k] = 90.0 + k * 0.25
        t.abertura[k], t.maxima[k], t.minima[k] = t.fechamento[k], t.fechamento[k] + 0.5, t.fechamento[k] - 0.5
    t.abertura.append(t.fechamento[-1] - 0.2); t.minima.append(t.minima[1] - 1.0)
    t.maxima.append(t.fechamento[-1] + 0.4); t.fechamento.append(t.fechamento[-1] + 0.2)
    t.volume.append(1.0); t.t.append(41)
    checar(est.gerar("spring", t)[-1] == 0, "em tendencia (faixa nao lateral) o mesmo desenho nao e spring")


def teste_disjuntor() -> None:
    print("\n[29] disjuntor do dia: resultados reais anotados, 3 perdas seguidas ou o dia no limite")
    import ficha
    import vigia
    cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
    cfg["params"]["banca"] = 100.0
    meio_dia = QUARTA + 15 * HORA_MS                     # 12:00 em Brasilia
    checar(vigia.dia_brasilia(QUARTA + 2 * HORA_MS) == vigia.dia_brasilia(QUARTA - 10 * HORA_MS)
           and vigia.dia_brasilia(QUARTA + 3 * HORA_MS) == vigia.dia_brasilia(meio_dia),
           "o dia e o de Brasilia: 02:00 UTC ainda e ontem; 03:00 UTC ja e hoje")
    r = lambda *vs: [{"quando_ms": meio_dia + k * 60_000, "valor": v} for k, v in enumerate(vs)]
    d1 = vigia.disjuntor(r(-1.0, -1.0, 0.5, -1.0, -1.0, -1.0), meio_dia + HORA_MS, 100.0)
    d2 = vigia.disjuntor(r(-1.0, 0.5, -1.0, 0.2, -1.0), meio_dia + HORA_MS, 100.0)
    d3 = vigia.disjuntor(r(-6.0), meio_dia + HORA_MS, 100.0)
    d4 = vigia.disjuntor(r(-1.0, -1.0, -1.0), meio_dia + DIA_MS, 100.0)
    checar(d1["armado"] and d1["seguidas"] == 3 and "3 perdas seguidas" in d1["motivo"],
           "3 perdas seguidas no fim do dia: arma")
    checar(not d2["armado"] and d2["seguidas"] == 1, "perdas intercaladas com ganho: nao arma")
    checar(d3["armado"] and "6% da banca" in d3["motivo"], "o dia em -6% da banca numa operacao so: arma")
    checar(not d4["armado"] and d4["n"] == 0, "no dia seguinte o disjuntor desarma")
    checar(not vigia.disjuntor(r(-1.0, -1.0, -1.0), meio_dia + HORA_MS, 100.0, {"ligado": False})["armado"],
           "desligado no vigia.json: nunca arma")

    pasta = tempfile.mkdtemp(prefix="disjuntor_")
    try:
        respostas = [vigia.anotar_resultado([v], cfg, meio_dia + k * 60_000, pasta)
                     for k, v in enumerate(("-1,5", "-2", "-1"))]
        checar("DISJUNTOR ARMADO" not in respostas[1] and "DISJUNTOR ARMADO" in respostas[2]
               and "-4,50" in respostas[2], "a 3a perda seguida avisa que o disjuntor armou (dia em -4,50)")
        quarta = vigia.anotar_resultado(["-1"], cfg, meio_dia + 5 * 60_000, pasta)
        checar("continua armado" in quarta and "DISJUNTOR ARMADO" not in quarta, "depois de armado, so lembra")
        ruins = [vigia.anotar_resultado([x], cfg, meio_dia, pasta) for x in ("abc", "500", "nan", "inf")]
        checar(ruins[0].startswith("Use:") and all("passa da banca" in x for x in ruins[1:])
               and len(vigia.ler_resultados(pasta)) == 4, "valor invalido ou maior que a banca nao e anotado")
        d = _dados_controlados(AGORA_FICHA)
        alta = {"4h": {"tendencia": 1, "topo": 112.0, "fundo": 88.0}, "1h": {"tendencia": 1, "topo": 110.0, "fundo": 90.0},
                "15m": {"tendencia": 1, "topo": 99.0, "fundo": 94.0}}
        txt = _com_leituras(alta, (90.0, 110.0), [], lambda: vigia.fazer_ficha(
            ["btc"], cfg, {}, meio_dia + 10 * 60_000, pasta, lambda par, agora: d))
        checar("VEREDITO: NAO OPERAR" in txt and "disjuntor do dia" in txt and "PLANO" in txt
               and not ficha.ler_fichas(pasta),
               "disjuntor armado: a ficha mostra a leitura inteira, mas o veredito e NAO OPERAR (e nao entra no placar)")
        hoje = vigia.responder_comando("/hoje", {}, cfg, meio_dia + 11 * 60_000,
                                       {"hoje": lambda c, a: vigia.texto_hoje(c, a, pasta)})
        checar("4 operacao" in hoje and "DISJUNTOR ARMADO" in hoje, "/hoje mostra o dia e o disjuntor")
        amanha = vigia.texto_hoje(cfg, meio_dia + DIA_MS, pasta)
        checar("0 operacao" in amanha and "desarmado" in amanha, "a meia-noite de Brasilia zera o dia")
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


def teste_surfe() -> None:
    print("\n[30] saida alvo + surfe: metade no alvo, o resto segue o preco (conta a mao e paridade com o vigia)")
    import vigia
    p = bt.Params(margem=10.0, alav=10.0, taxa=0.05, stop=1.0, rr=2.0, saida="surfe")  # tamanho 100 USDT
    def rodar(direcao, candles, fim=None):
        pos = bt.abrir(100.0, direcao, p)
        for mx, mn in candles:
            r = bt.checar_barra(pos, mx, mn, p)
            if r is not None:
                return round(r[0], 9), r[1]
        return (round(bt.encerrar_no_preco(pos, fim, p), 9), "expirou") if fim is not None else None
    checar(rodar(1, [(102.5, 100.2), (104.0, 101.8), (104.5, 102.9)]) == (2.4, "surfe"),
           "compra: metade no alvo (+0,95), o resto puxado ate 103 e sai la (+1,45): +2,40")
    checar(rodar(-1, [(99.8, 97.5), (98.2, 96.0), (97.1, 96.5)]) == (2.4, "surfe"),
           "venda: o espelho exato, +2,40")
    checar(rodar(1, [(102.5, 100.2), (104.0, 101.8), (106.0, 104.2), (106.5, 104.9)]) == (3.4, "surfe"),
           "o stop puxado usa o melhor preco ate o candle ANTERIOR: o candle que sobe a 104 e desce a 101,8 nao "
           "tira o resto; ele sai em 105 (+3,40), nao em 103")
    checar(rodar(1, [(102.5, 99.5)]) == (0.9, "alvo+zero"),
           "alvo e volta a entrada no mesmo candle: o resto sai no zero (+0,90), contra a estrategia")
    checar(rodar(1, [(102.5, 98.9)]) == (-1.1, "stop"), "alvo e stop original no mesmo candle: conta stop (-1,10)")
    checar(rodar(1, [(102.5, 100.2), (103.0, 102.6)], fim=103.5) == (2.65, "expirou"),
           "prazo vencido depois do alvo: metade +0,95 e o resto fecha a mercado em 103,5 (+1,70)")
    alvo = bt.Params(margem=10.0, alav=10.0, taxa=0.05, stop=1.0, rr=2.0)
    checar(round(bt.checar_barra(bt.abrir(100.0, 1, alvo), 102.5, 100.2, alvo)[0], 9) == 1.9,
           "saida 'alvo' (a de sempre) continua igual: +1,90 inteira no alvo")
    import caderno
    checar(caderno.chave_hipotese("x", "15m", "ambos", False, alvo).endswith("|binance")
           and caderno.chave_hipotese("x", "15m", "ambos", False, p).endswith("|saida_surfe"),
           "no caderno, surfe e outra hipotese; as chaves antigas continuam as mesmas")

    s = serie_sintetica(3000, 5, True)
    cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
    cfg["historico_inicial_dias"] = 7
    cfg["params"]["saida"] = "surfe"
    ps = bt.Params(**cfg["params"])
    inicio = 600
    with tempfile.TemporaryDirectory() as tmp:
        estado, diario = _replay(s, cfg, tmp, inicio)
    with tempfile.TemporaryDirectory() as tmp:
        _, diario2 = _replay(s, cfg, tmp, inicio, pausa=(1500, 1530))
    for nome in ("confl3", "engolfo"):
        sinais = [x if i >= inicio else 0 for i, x in enumerate(est.sinais(nome, s))]
        esperado = _esperado_backtest(s, sinais, ps)
        obtido = [(round(r["entrada"], 6), r["saida_t"], r["desfecho"], r["pnl"]) for r in diario if r["estrategia"] == nome]
        checar(len(esperado) > 5 and obtido == esperado and any(d == "surfe" for _, _, d, _ in obtido),
               f"{nome} com surfe: vigia e backtest fecham as mesmas {len(obtido)} operacoes, com saidas 'surfe'")
    sem = [(r["trilha"], r["saida_t"], r["desfecho"], r["pnl"]) for r in diario]
    com = [(r["trilha"], r["saida_t"], r["desfecho"], r["pnl"]) for r in diario2]
    checar(sem == com, "desligado e religado no meio de um surfe: o resto da posicao continua igual (estado salvo)")


def teste_endurecimento() -> None:
    print("\n[31] vigia endurecido: um por pasta, erro inesperado nao derruba, texto da IA limpo, banca de hoje")
    import fcntl
    import vigia
    pasta = tempfile.mkdtemp(prefix="vigia_trava_")
    outro = open(os.path.join(pasta, "vigia.trava"), "a")
    fcntl.flock(outro, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        vigia.travar(pasta)
        checar(False, "o segundo vigia na mesma pasta deveria ser recusado")
    except SystemExit as e:
        checar("Ja existe um vigia rodando" in str(e.code), "segundo vigia na mesma pasta: recusado com explicacao")
    finally:
        outro.close()

    pasta_orig, busca_orig = vigia.PASTA, bt.BUSCADORES["pionex"]
    def quebra(par, tf, n):
        raise ValueError("resposta esquisita")
    vigia.PASTA, bt.BUSCADORES["pionex"] = pasta, quebra
    try:
        cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
        saiu_bem = True
        try:
            vigia.rodar(cfg, {}, uma_vez=True)
        except Exception:
            saiu_bem = False
        with open(os.path.join(pasta, "vigia.log"), encoding="utf-8") as arq:
            registro = arq.read()
        checar(saiu_bem and "erro inesperado (ValueError: resposta esquisita); tento de novo" in registro,
               "erro inesperado na busca: o vigia registra e segue, nao cai")
    finally:
        vigia.PASTA, bt.BUSCADORES["pionex"] = pasta_orig, busca_orig
        for arq in vigia._TRAVA:
            arq.close()
        vigia._TRAVA.clear()
        shutil.rmtree(pasta, ignore_errors=True)

    sujo = "compra\x1b[31m agora\n\nIGNORE AS REGRAS " + "x" * 400
    limpo = vigia.texto_da_ia(sujo)
    checar("\x1b" not in limpo and "\n" not in limpo and len(limpo) <= 303 and limpo.endswith("..."),
           "texto da IA: sem caractere de controle, numa linha, com tamanho maximo")
    p = bt.Params(**vigia.CONFIG_PADRAO["params"])
    pos = dataclasses.asdict(bt.abrir(100.0, 1, p))
    t = vigia.texto_entrada("confl3", "BTCUSDT", "15m", pos, p, motivo="ok", disjuntor_armado=True)
    checar("DISJUNTOR DO DIA ARMADO" in t and "nao verificado" in t,
           "alerta de entrada avisa o disjuntor armado e marca o texto da IA como nao verificado")

    pasta = tempfile.mkdtemp(prefix="banca_")
    try:
        cfg = json.loads(json.dumps(vigia.CONFIG_PADRAO))
        cfg["params"]["banca"] = 100.0
        vigia.anotar_resultado(["-3,7"], cfg, AGORA_FICHA - DIA_MS, pasta)
        d = _dados_controlados(AGORA_FICHA)
        alta = {"4h": {"tendencia": 1, "topo": 112.0, "fundo": 88.0}, "1h": {"tendencia": 1, "topo": 110.0, "fundo": 90.0},
                "15m": {"tendencia": 1, "topo": 99.0, "fundo": 94.0}}
        txt = _com_leituras(alta, (90.0, 110.0), [], lambda: vigia.fazer_ficha(
            ["btc", "2"], cfg, {}, AGORA_FICHA, pasta, lambda par, agora: d))
        checar("risco 2% de 96.3 USDT = 1,93" in txt and "banca de hoje: 96,30 USDT" in txt,
               "a ficha arrisca 2% da banca de hoje (100 - 3,70 anotados = 96,30)")
        vigia.anotar_resultado(["-97"], cfg, AGORA_FICHA - 2 * DIA_MS, pasta)
        checar("chegou a" in vigia.fazer_ficha(["btc"], cfg, {}, AGORA_FICHA, pasta, lambda par, agora: d),
               "banca anotada zerada: a ficha pede para conferir, nao calcula tamanho com banca negativa")
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


def teste_nota_e_corrente() -> None:
    print("\n[32] nota de acerto das IAs (confianca) e corrente de assinaturas do diario")
    import arena
    import vigia
    checar(arena.ler_confianca('{"lado": "compra", "motivo": "x", "confianca": 0.7}') == 0.7
           and arena.ler_confianca('{"confianca": 70}') is None and arena.ler_confianca('{"confianca": "0.7"}') is None
           and arena.ler_confianca('{"confianca": true}') is None and arena.ler_confianca("lixo") is None,
           "confianca so como numero de 0 a 1; o resto fica fora da nota (a decisao continua valendo)")
    checar("confianca" in arena.ESQUEMA_DECISAO["required"], "o Claude e obrigado pelo formato a dar a confianca")

    class ComConfianca(QwenFalsa):
        def perguntar(self, sistema, usuario):
            r = json.loads(super().perguntar(sistema, usuario).strip("`").replace("json\n", "", 1))
            return json.dumps({**r, "confianca": 0.8})
    s = serie_sintetica(600, 5, True)
    marca = arena.candles_de_interesse(s)
    i0 = next(i for i in range(300, len(s)) if marca[i])
    j = arena.Juiz(ComConfianca(sempre="compra"), None, 10, lambda m: None)
    mem = {}
    j.decidir(mem, "k", s, i0, bt.Params())
    checar(mem["confiancas"]["k"] == {"ia:qwen": 0.8}, "a confianca de cada IA fica guardada com a decisao do candle")

    p = bt.Params(margem=10.0, alav=10.0, stop=1.0, rr=2.0)
    pasta = tempfile.mkdtemp(prefix="nota_")
    try:
        tr = vigia.trilha_nova(2)
        c = {"t": [0, 1, 2, 3, 4], "abertura": [100.0] * 5, "fechamento": [100.0] * 5,
             "maxima": [100.5, 102.5, 100.5, 100.5, 100.5], "minima": [99.5, 99.6, 99.5, 98.0, 99.5]}
        ok = lambda i, sinal, conf: vigia.processar_barra(tr, "ia:qwen|x", "ia:qwen", "BTCUSDT", "15m", sinal, i, c, p,
                                                          False, pasta, None, "m", (100,), 1, confianca=conf)
        ok(0, 1, 0.8)   # entra com 80% de confianca
        ok(1, 0, None)  # bate o alvo: acertou -> (0,8 - 1)^2 = 0,04
        ok(2, 1, 0.9)   # entra com 90%
        ok(3, 0, None)  # bate o stop: errou -> (0,9 - 0)^2 = 0,81
        checar(tr["brier"] == [0.04, 0.81], f"nota de acerto conferida a mao: {tr['brier']} (0,04 no acerto, 0,81 no erro)")
        linha = next(l for l in vigia.placar({"trilhas": {"ia:qwen|x": tr}}) if l["trilha"] == "ia:qwen|x")
        checar(abs(linha["nota"] - 0.425) < 1e-9
               and f"nota de acerto {linha['nota']:.2f} em 2" in vigia.texto_resumo({"trilhas": {"ia:qwen|x": tr}}),
               "o placar mostra a nota media (0,425): confianca alta que erra pesa contra")
        diario = os.path.join(pasta, "diario.jsonl")
        checar(vigia.conferir_diario(diario) == {"n": 2, "encadeadas": 2, "quebra": None},
               "diario das 2 operacoes com a corrente integra")
        for k in range(3):
            vigia.anexar_encadeado(diario, {"trilha": "x", "pnl": float(k)})
        with open(diario, encoding="utf-8") as f:
            linhas = f.readlines()
        def com(novas):
            with open(diario, "w", encoding="utf-8") as f:
                f.writelines(novas)
            return vigia.conferir_diario(diario)["quebra"]
        mexida = linhas[:]
        r = json.loads(mexida[2]); r["pnl"] = 99.0; mexida[2] = json.dumps(r) + "\n"
        checar(com(mexida) == 3, "resultado editado na linha 3: a corrente quebra exatamente ali")
        checar(com(linhas[:1] + linhas[2:]) == 2, "linha apagada: a corrente quebra na seguinte")
        checar(com(linhas[:3] + ['{"trilha": "x", "pnl": 5.0}\n'] + linhas[3:]) == 4,
               "linha sem assinatura inserida depois do inicio da corrente: quebra")
        checar(com(['{"trilha": "antiga", "pnl": 1.0}\n'] + linhas) is None,
               "linhas antigas, de antes da corrente, continuam aceitas no comeco")
        com(linhas)
        checar("corrente de assinaturas integra" in vigia.texto_diario(pasta) and
               "alterado na linha 3" in (com(mexida) and vigia.texto_diario(pasta)),
               "/status diz se o diario esta integro ou onde foi alterado")
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


def _pegada_real() -> dict:
    """Tamanho de cada arquivo de dado real (vigia e caderno de quem roda de verdade)."""
    pegada = {}
    pasta = os.path.join(RAIZ, "dados_vigia")
    if os.path.isdir(pasta):
        pegada.update({f: os.path.getsize(os.path.join(pasta, f)) for f in os.listdir(pasta)})
    for f in ("caderno.jsonl", "vigia.json", "segredos.json"):
        arq = os.path.join(RAIZ, f)
        pegada[f] = os.path.getsize(arq) if os.path.exists(arq) else None
    return pegada


if __name__ == "__main__":
    pegada = _pegada_real()
    teste_vazamento()
    teste_sobreposicao()
    teste_paridade()
    teste_gatilho_obrigatorio()
    teste_busca()
    teste_comando_ponta_a_ponta()
    teste_padroes_e_alinhamento()
    teste_placar()
    teste_bateria()
    teste_vigia()
    teste_arena()
    teste_sdk_anthropic()
    teste_pionex_telegram()
    teste_comando_unico()
    teste_regra_de_saida()
    teste_livro()
    teste_fluxo()
    teste_montagens()
    teste_prova_contra_sorte()
    teste_smc()
    teste_scalping()
    teste_fase2_honesta()
    teste_ficha_calculo()
    teste_ficha_veredito()
    teste_ficha_fontes()
    teste_ficha_comandos()
    teste_alertas()
    teste_ichimoku_spring()
    teste_disjuntor()
    teste_surfe()
    teste_endurecimento()
    teste_nota_e_corrente()
    print("\n[13] a bateria nao toca nos dados reais do vigia")
    checar(_pegada_real() == pegada, "dados_vigia/, caderno, vigia.json e segredos.json iguais antes e depois da bateria")
    print()
    if FALHAS:
        print(f"REPROVADO: {len(FALHAS)} falha(s)")
        sys.exit(1)
    print("APROVADO: todas as guardas passaram")
