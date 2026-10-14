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
    # compra agressora com outro sorteio (nao muda os precos dos testes antigos):
    # candle de alta tende a ter mais compra agressora, como no mercado
    rnd2 = random.Random(semente + 99_991)
    for o, f, v in zip(s.abertura, s.fechamento, s.volume):
        fracao = 0.5 + (0.15 if f > o else -0.15) + rnd2.gauss(0, 0.12)
        s.agressora.append(v * min(0.95, max(0.05, fracao)))
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
    sys.argv = ["backtest.py", "--robustez", "--estrategia", "confl3", "--alav", "24"]
    saida = io.StringIO()
    try:
        with contextlib.redirect_stdout(saida):
            bt.main()
        texto = saida.getvalue()
        checar(texto.count(">>> ") == 5, "rodou os 5 periodos")
        checar(texto.count("bateu") == 5, "veredito de robustez em todos os 5")
        checar(texto.count("resultado por operacao") == 5, "placar com resultado por operacao nos 5 periodos")
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
    estrategias_sem = [r for r in diario_sem]
    estrategias_com = [r for r in diario if not r["estrategia"].startswith("ia:")]
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
    original, pausa, dormir = bt._pedir, bt.PIONEX_PAUSA, bt.time.sleep
    pausas = []
    bt._pedir = falsa
    bt.time.sleep = lambda x: pausas.append(x)
    try:
        r = bt.buscar_pionex_ou_erro("BTCUSDT", "15m", 1200)
        checar(all(q["symbol"] == "BTC_USDT_PERP" and q["interval"] == "15M" and q["limit"] == "500"
                   for q in falsa.pedidos),
               f"pede o perpetuo BTC_USDT_PERP em 15M, de 500 em 500 ({len(falsa.pedidos)} paginas)")
        checar(len(r) == 1200 and r.t == s.t[-1200:] and r.fechamento == s.fechamento[-1200:]
               and r.volume == s.volume[-1200:],
               "1200 candles fechados, na ordem, sem buraco nem repetido, precos lidos do texto")
        checar(inicio_formando not in r.t, "o candle em formacao fica de fora")
        checar(pausas and all(x == bt.PIONEX_PAUSA for x in pausas) and len(pausas) == len(falsa.pedidos) - 1,
               f"pausa de {bt.PIONEX_PAUSA}s entre paginas (teto de pedidos da Pionex)")
        bt._pedir = PionexFalsa(s, ms, formando, recusar="simbolo invalido")
        try:
            bt.buscar_pionex_ou_erro("BTCUSDT", "15m", 100)
            checar(False, "resposta recusada deveria virar ErroBusca")
        except bt.ErroBusca as e:
            checar("simbolo invalido" in e.erros[0], f"resposta recusada vira erro explicado: {e.erros[0]}")
    finally:
        bt._pedir, bt.PIONEX_PAUSA, bt.time.sleep = original, pausa, dormir
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
    checar(not any("999" in str(e) for e in enviados) and len(enviados) == 3,
           "mensagem de outra pessoa nao recebe resposta nenhuma")

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
           and "ACIMA DO TETO" in texto4 and abs(vigia.risco_aberto(est_r, cfg_100x)[1] - 4 * 15) < 1e-9,
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
    checar(c100.liq_antes_do_stop and r == (-10, "liquidado"),
           "a 100x com stop de 0,5% a liquidacao chega antes: perde a margem inteira (10), nao o stop")
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


def _pegada_real() -> dict:
    """Tamanho de cada arquivo da pasta real do vigia (dados de quem roda de verdade)."""
    pasta = os.path.join(RAIZ, "dados_vigia")
    if not os.path.isdir(pasta):
        return {}
    return {f: os.path.getsize(os.path.join(pasta, f)) for f in os.listdir(pasta)}


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
    print("\n[13] a bateria nao toca nos dados reais do vigia")
    checar(_pegada_real() == pegada, "dados_vigia/ (diario, log, estado) igual antes e depois da bateria")
    print()
    if FALHAS:
        print(f"REPROVADO: {len(FALHAS)} falha(s)")
        sys.exit(1)
    print("APROVADO: todas as guardas passaram")
