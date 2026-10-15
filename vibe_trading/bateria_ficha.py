#!/usr/bin/env python3
"""
Bateria da ficha: a regra do /analisar testada no historico, contra moedas sorteadas.

    python3 vibe.py bateria-ficha                      # BTC, ETH e SOL, 90 dias, 3 horizontes
    python3 bateria_ficha.py --dias 180 --horizontes intraday

A pergunta: quando a ficha diz A FAVOR, o resultado bate o acaso?

Como responde, sem atalho:
  - em cada candle fechado do periodo de entrada, monta exatamente o que a ficha ao
    vivo teria visto naquele instante: os ultimos 500 candles JA FECHADOS de cada
    periodo, nada depois. E chama a propria ficha.analisar (nao uma copia parecida);
  - A FAVOR, sem posicao aberta: entra no fechamento, com o stop e o alvo 1 do plano.
    O desfecho sai de ficha.desfecho, a mesma do placar das fichas ao vivo (stop e
    alvo no mesmo candle conta stop; resultado em multiplos do risco, R);
  - 30 moedas por operacao: mesmo candle, mesmas distancias de stop e alvo, lado
    sorteado (na mesma proporcao de compras e vendas da ficha). Se a ficha so ganha
    das moedas por acaso, o "bate" mostra;
  - ESPERAR (se tivesse entrado): as fichas com plano que a ficha mandou esperar, no
    mesmo esquema. Se o veredito vale alguma coisa, A FAVOR ganha de ESPERAR;
  - prova contra sorte: Sharpe deflacionado por ativo (vale o pior), contando as
    tentativas do caderno; cada horizonte e uma hipotese registrada.

O que fica de fora do historico (nao ha dado gratis): agenda (CPI, Fed), funding,
livro, pedido minimo e a tabela de risco da Pionex. Nao mudam o lado nem o alvo.
"""

from __future__ import annotations

import argparse
import random
import sys
import time

import backtest as bt
import bateria
import caderno as cad
import estatistica
import ficha

PADRAO_ATIVOS = "BTCUSDT,ETHUSDT,SOLUSDT"
JANELA = 500        # candles por periodo que a ficha ao vivo ve (uma pagina da Pionex)
MOEDAS = 30


def periodos_do(horizonte: str) -> list[str]:
    """Os periodos que a ficha usa nesse horizonte (os niveis de ontem e da semana vem do
    1h; VWAP do dia e POC de ontem, do 15m, que so contam no scalp e no intraday)."""
    H = ficha.HORIZONTES[horizonte]
    tfs = {H["entrada"], H["contexto"], H["maior"], "1h"}
    if horizonte != "swing":
        tfs.add("15m")
    return sorted(tfs, key=lambda tf: bt.PERIODOS[tf])


def candles_necessarios(tf: str, dias: int) -> int:
    return dias * 1440 // bt.PERIODOS[tf] + JANELA + 20


def fichas_no_historico(series: dict, par: str, horizonte: str, inicio_ms: int, risco: float = 2.0,
                        banca: float = 100.0, cfg: dict | None = None, taxa: float = 0.05):
    """Gera (indice do candle de entrada, ficha) para cada candle fechado do periodo de
    entrada a partir de inicio_ms. Cada ficha so ve candles fechados ate aquele instante."""
    H = ficha.HORIZONTES[horizonte]
    ent = series[H["entrada"]]
    ms_ent = bt.PERIODOS[H["entrada"]] * 60_000
    ms = {tf: bt.PERIODOS[tf] * 60_000 for tf in series}
    fechados = {tf: 0 for tf in series}  # quantos candles de cada periodo ja fecharam
    for i in range(len(ent)):
        agora = ent.t[i] + ms_ent  # o instante em que o candle i fechou
        for tf, s in series.items():
            k = fechados[tf]
            while k < len(s) and s.t[k] + ms[tf] <= agora:
                k += 1
            fechados[tf] = k
        if agora < inicio_ms:
            continue
        janela = {tf: bt.fatiar(s, max(0, fechados[tf] - JANELA), fechados[tf]) for tf, s in series.items()}
        dados = {"par": par, "agora_ms": agora, "series": janela, "erros": {}}
        yield i, ficha.analisar(dados, horizonte, risco, banca, cfg, taxa, com_gatilhos=False)


MODELOS = {
    "A FAVOR": "a ficha como esta: entra quando o veredito e A FAVOR (alvo no nivel forte mais proximo)",
    "ALVO NA PERNA": ("a mesma entrada da ficha (periodo maior, contexto e entrada alinhados, preco no lado certo "
                      "da perna), mas o alvo no extremo da perna: a liquidez do topo (ou fundo) anterior"),
    "GATILHO": ("Smart Money classico: o mesmo, mas so no candle em que o periodo de entrada quebra a "
                "estrutura a favor (BOS ou CHoCH)"),
}


def modelo_perna(f: dict, exige_virada: bool, cfg: dict | None = None, taxa: float = 0.05) -> dict | None:
    """O registro dos modelos ALVO NA PERNA e GATILHO a partir da propria ficha (mesmas
    leituras, mesma perna, mesmo stop): alvo 1/10 de ATR antes do extremo da perna, so com
    rr_min (1,5x o risco) ou mais. None quando o modelo nao entra neste candle."""
    cfg = {**ficha.FICHA_PADRAO, **(cfg or {})}
    p, fx = f.get("plano"), f.get("faixa")
    if not p or not fx or f["veredito"] == "NAO OPERAR":
        return None
    d = p["direcao"]
    ent = f["leituras"][f["tf_entrada"]]
    no_lado = 0 <= fx["pos"] <= 0.5 if d > 0 else 0.5 <= fx["pos"] <= 1  # a mesma regra da ficha
    a_favor = (ent["evento_ha"] == 0 and ent["evento"] * d > 0) if exige_virada else ent["tendencia"] == d
    if not (no_lado and a_favor):
        return None
    alvo = (fx["topo"] - 0.1 * ent["atr"]) if d > 0 else (fx["fundo"] + 0.1 * ent["atr"])
    entrada = p["entrada"]
    if (alvo - entrada) * d <= 0:
        return None
    perda_pct = p["dist_pct"] + bt.custo_pct_ida_volta(taxa, cfg["deslize_pct"], 1.0)
    rr = (abs(alvo - entrada) / entrada * 100 - bt.custo_pct_ida_volta(taxa, cfg["deslize_pct"], 0.0)) / perda_pct
    if rr < cfg["rr_min"]:
        return None
    nome = "GATILHO" if exige_virada else "ALVO NA PERNA"
    reg = ficha.registro_de({**f, "veredito": nome})
    return {**reg, "veredito": nome, "alvo": alvo, "rr": round(rr, 4)}


def espelho(reg: dict, direcao: int) -> dict:
    """O mesmo plano (distancias de stop e alvo) do outro lado, ou do mesmo."""
    if direcao == reg["direcao"]:
        return reg
    e = reg["entrada"]
    return {**reg, "direcao": direcao, "stop": 2 * e - reg["stop"], "alvo": 2 * e - reg["alvo"]}


def _moedas(regs: list[dict], ent, semente: int) -> list[float]:
    """Soma em R de cada moeda: mesmos candles e distancias, lado sorteado na mistura dos regs."""
    compras = sum(1 for r in regs if r["direcao"] > 0)
    frac = (compras + 1) / (len(regs) + 2)
    somas = []
    for k in range(MOEDAS):
        sorteio = random.Random(semente + k)
        soma = 0.0
        for reg in regs:
            res = ficha.desfecho(espelho(reg, 1 if sorteio.random() < frac else -1), ent)
            soma += res["r"] if res else 0.0
        somas.append(soma)
    return somas


def avaliar(series: dict, par: str, horizonte: str, inicio_ms: int, semente: int = 1000, **kw) -> dict:
    """As operacoes de cada modelo (A FAVOR, GATILHO) e de ESPERAR (se tivesse entrado),
    uma posicao por vez em cada, em R; e a soma de cada moeda sorteada nos mesmos candles
    das operacoes de cada modelo. Conta tambem por que a ficha mandou esperar."""
    H = ficha.HORIZONTES[horizonte]
    ent = series[H["entrada"]]
    classes = ("A FAVOR", "ALVO NA PERNA", "GATILHO", "ESPERAR")
    livre = {c: None for c in classes}   # quando a posicao aberta de cada classe fecha (ms)
    ops = {c: [] for c in classes}
    regs = {c: [] for c in classes}
    vistos = {"A FAVOR": 0, "ESPERAR": 0, "NAO OPERAR": 0}
    motivos: dict = {}
    for i, f in fichas_no_historico(series, par, horizonte, inicio_ms, **kw):
        vistos[f["veredito"]] = vistos.get(f["veredito"], 0) + 1
        for m in f["esperar"]:
            chave = m.split(":")[0].split("(")[0].strip()
            motivos[chave] = motivos.get(chave, 0) + 1
        candidatos = [(f["veredito"], ficha.registro_de(f)),
                      ("ALVO NA PERNA", modelo_perna(f, False, kw.get("cfg"), kw.get("taxa", 0.05))),
                      ("GATILHO", modelo_perna(f, True, kw.get("cfg"), kw.get("taxa", 0.05)))]
        for classe, reg in candidatos:
            if classe not in ops or reg is None:
                continue
            if livre[classe] is not None and reg["quando_ms"] < livre[classe]:
                continue
            res = ficha.desfecho(reg, ent)
            if res is None:
                continue  # o historico acabou com ela aberta
            ops[classe].append({"r": res["r"], "desfecho": res["desfecho"], "quando_ms": reg["quando_ms"],
                                "fim_ms": res["fim_ms"], "direcao": reg["direcao"]})
            regs[classe].append(reg)
            livre[classe] = res["fim_ms"] + 1
    return {"ops": {c: ops[c] for c in classes},
            "moedas": {c: _moedas(regs[c], ent, semente) for c in classes if c != "ESPERAR"},
            "vistos": vistos, "motivos": motivos}


def resumo(ops: list[dict]) -> dict:
    rs = [o["r"] for o in ops]
    return {"n": len(rs), "acerto": (sum(1 for x in rs if x > 0) / len(rs) * 100) if rs else 0.0,
            "media": (sum(rs) / len(rs)) if rs else 0.0, "soma": sum(rs)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ativos", default=PADRAO_ATIVOS)
    ap.add_argument("--horizontes", default="scalp,intraday,swing")
    ap.add_argument("--dias", type=int, default=90)
    ap.add_argument("--risco", type=float, default=2.0)
    ap.add_argument("--caderno", default=cad.CADERNO)
    args = ap.parse_args()
    ativos = [a.strip().upper() for a in args.ativos.split(",") if a.strip()]
    horizontes = [h.strip() for h in args.horizontes.split(",") if h.strip()]
    for h in horizontes:
        if h not in ficha.HORIZONTES:
            sys.exit(f"horizonte '{h}' nao existe. Use: {', '.join(ficha.HORIZONTES)}")

    print("=" * 100)
    print(f"  BATERIA DA FICHA — a regra do /analisar no historico, {len(ativos)} ativos, ~{args.dias} dias "
          f"(dado publico; nenhuma ordem real)")
    print("=" * 100)
    print("  em cada candle fechado, a ficha ve so o que existia naquele instante; A FAVOR entra no fechamento")
    print("  com o stop e o alvo 1 do plano; resultado em R (multiplos do risco: stop = -1 R)")
    print()
    agora = int(time.time() * 1000)
    inicio = agora - args.dias * 86_400_000
    quando = time.strftime("%Y-%m-%d %H:%M")
    dados: dict = {}
    for ativo in ativos:
        for tf in sorted({tf for h in horizontes for tf in periodos_do(h)}, key=lambda x: bt.PERIODOS[x]):
            dados[(ativo, tf)] = bt.buscar(ativo, tf, candles_necessarios(tf, args.dias))
    tentativas_antes = cad.tentativas_no_caderno(args.caderno)
    var_sorte = estatistica.variancia(cad.sharpes_no_caderno(args.caderno))
    passaram = []
    modelos = list(MODELOS)
    for h in horizontes:
        H = ficha.HORIZONTES[h]
        print(f"  >>> {h}: entrada {H['entrada']}, contexto {H['contexto']}, maior {H['maior']}; prazo {H['horas']} h")
        cab = f"  {'ativo':8s} | {'modelo':13s} | {'ops':>4s} {'acerto':>7s} {'media R':>8s} {'soma R':>7s} {'bate':>5s}"
        print(cab)
        print("  " + "-" * (len(cab) - 2))
        por_modelo = {m: {"ativos": [], "vantagens": 0} for m in modelos}
        motivos: dict = {}
        for ativo in ativos:
            t0 = time.time()
            series = {tf: dados[(ativo, tf)] for tf in periodos_do(h)}
            a = avaliar(series, ativo, h, inicio, risco=args.risco)
            for k, v in a["motivos"].items():
                motivos[k] = motivos.get(k, 0) + v
            for m in modelos + ["ESPERAR"]:
                r = resumo(a["ops"][m])
                bate = bt.fracao_batida(r["soma"], a["moedas"][m]) if m in a["moedas"] and r["n"] else None
                nome = "ESPERAR*" if m == "ESPERAR" else m
                print(f"  {ativo:8s} | {nome:13s} | {r['n']:4d} {r['acerto']:6.1f}% {r['media']:+8.2f} {r['soma']:+7.1f} "
                      f"{(f'{bate:4.0f}%' if bate is not None else '    -')}")
                if m in por_modelo:
                    por_modelo[m]["ativos"].append([o["r"] for o in a["ops"][m]])
                    por_modelo[m]["vantagens"] += r["n"] >= 30 and r["soma"] > 0 and (bate or 0) >= 75
                    cad.registrar(args.caderno, {
                        "quando": quando, "hipotese": f"ficha|{h}|{m}|risco{args.risco:g}|{args.dias}d|binance",
                        "estrategia": f"ficha_{h}_{m}", "periodo": H["entrada"], "ativo": ativo, "operacoes": r["n"],
                        "acerto": round(r["acerto"], 1), "por_operacao_r": round(r["media"], 4),
                        "bate_moedas": round(bate or 0.0, 1),
                        "sharpe_op": round(estatistica.sharpe([o["r"] for o in a["ops"][m]]), 5),
                        "modo": f"{args.dias}d"})
            print(f"  {'':8s}   ({time.time() - t0:.0f} s; fichas: {a['vistos'].get('A FAVOR', 0)} A FAVOR, "
                  f"{a['vistos'].get('ESPERAR', 0)} ESPERAR, {a['vistos'].get('NAO OPERAR', 0)} NAO OPERAR)", flush=True)
        tentativas = max(1, cad.tentativas_no_caderno(args.caderno))
        for m in modelos:
            prova = bateria.prova_por_ativo(por_modelo[m]["ativos"], tentativas, var_sorte)
            passa = por_modelo[m]["vantagens"] >= 2 and prova["dsr"] >= bateria.DSR_MINIMO
            if passa:
                passaram.append(f"{m} no {h}")
            print(f"  {m:13s}: nao-sorte (pior ativo) {prova['dsr'] * 100:5.1f}% · com vantagem em "
                  f"{por_modelo[m]['vantagens']} de {len(ativos)} -> {'PASSA' if passa else 'nao passa'}")
        top = sorted(motivos.items(), key=lambda x: -x[1])[:4]
        print("  por que a ficha mandou esperar (mais comuns): " + "; ".join(f"{k} ({v})" for k, v in top))
        print()
    print("  ESPERAR* = as fichas que mandaram esperar, como se tivesse entrado (so para comparar com A FAVOR).")
    print("  'bate' = de quantas das 30 moedas (mesmos candles, mesmas distancias, lado sorteado) o modelo ganhou.")
    print("  Vantagem num ativo: 30 ou mais operacoes, soma positiva e bater 75% das moedas.")
    print(f"  Passa: vantagem em 2 dos {len(ativos)} ativos E {bateria.DSR_MINIMO * 100:.0f}% ou mais de chance de nao "
          f"ser sorte, com {cad.tentativas_no_caderno(args.caderno)} tentativas no caderno (eram {tentativas_antes}).")
    print("  " + "=" * 60)
    if passaram:
        print(f"  PASSARAM: {', '.join(passaram)}. Proximo passo: o placar ao vivo, antes de dinheiro real.")
    else:
        print("  NENHUM MODELO DA FICHA PASSOU: o sinal dela, sozinho, nao bate o acaso nestes dados.")
        print("  Ela continua servindo de leitura (niveis, tamanho, liquidacao), nao de sinal de entrada.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\n\nBateria da ficha interrompida antes do fim. Rode de novo: python3 vibe.py bateria-ficha")
