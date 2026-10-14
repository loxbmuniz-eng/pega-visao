#!/usr/bin/env python3
"""
Bateria da fase 1: testa varias estrategias em varios ativos e periodos de uma
vez, contra a moeda pareada, e diz quais passam no criterio do plano.

Criterio da fase 1 (pagina "Do Agora ao Apice"): uma estrategia passa num
periodo quando da "sinal de vantagem" em pelo menos 2 dos 3 ativos.

Toda execucao fica registrada no caderno de experimentos (caderno.jsonl). O
numero de tentativas importa: quanto mais coisas se testam, mais provavel e que
a melhor delas seja so sorte. O caderno existe para essa conta nao se perder.

Modo --historico: puxa TODO o historico que a Binance tem de cada par (BTC e
ETH desde 2017, SOL desde 2020), corta por ano-calendario e mostra o resultado
ano a ano. Por padrao usa 4 h e 24 h: 15 min no historico inteiro sao centenas
de milhares de candles e levariam horas.

Uso:
    python3 bateria.py
    python3 bateria.py --historico
    python3 bateria.py --ativos BTCUSDT,ETHUSDT --periodos 1h,4h
    python3 bateria.py --estrategias confl3,engolfo --lado compra

Nenhuma ordem real: nao pede chave, nao acessa conta.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import backtest as bt
import estrategias

PADRAO_ESTRATEGIAS = "confl3,confl4,engolfo,divergencia,canal,ema,momento,rsi"
CADERNO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "caderno.jsonl")

CURTO = {"vantagem": "VANTAGEM", "inconclusivo": "inconcl.", "sem_vantagem": "sem"}


def chave_hipotese(nome: str, tf: str, lado: str, alinhar: bool, p: bt.Params) -> str:
    """Identidade de uma tentativa: mudar qualquer peca e outra hipotese."""
    return f"{nome}|{tf}|{lado}|{'alinhado' if alinhar else 'livre'}|alav{p.alav:g}|stop{p.stop:g}|rr{p.rr:g}"


def registrar(caderno: str, registro: dict) -> None:
    with open(caderno, "a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False) + "\n")


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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ativos", default="BTCUSDT,ETHUSDT,SOLUSDT")
    ap.add_argument("--periodos", default="15m,1h,4h")
    ap.add_argument("--estrategias", default=PADRAO_ESTRATEGIAS)
    ap.add_argument("--dias", type=int, default=90)
    ap.add_argument("--banca", type=float, default=110.0)
    ap.add_argument("--margem", type=float, default=15.0)
    ap.add_argument("--alav", type=float, default=24.0)
    ap.add_argument("--taxa", type=float, default=0.05)
    ap.add_argument("--mm", type=float, default=0.5)
    ap.add_argument("--stop", type=float, default=0.5)
    ap.add_argument("--rr", type=float, default=2.0)
    ap.add_argument("--lado", choices=("ambos", "compra", "venda"), default="ambos")
    ap.add_argument("--alinhar", action="store_true")
    ap.add_argument("--janelas", type=int, default=6)
    ap.add_argument("--caderno", default=CADERNO, help="arquivo do caderno de experimentos")
    ap.add_argument("--historico", action="store_true",
                    help="historico inteiro de cada par, cortado por ano")
    args = ap.parse_args()
    if args.historico:
        args.dias = 4000  # mais que a vida do par na Binance: a busca para quando o historico acaba
        if "--periodos" not in " ".join(sys.argv):
            args.periodos = "4h,1d"

    ativos = [a.strip().upper() for a in args.ativos.split(",") if a.strip()]
    periodos = [t.strip() for t in args.periodos.split(",") if t.strip()]
    nomes = [n.strip() for n in args.estrategias.split(",") if n.strip()]
    for n in nomes:
        if n not in estrategias.REGISTRO:
            sys.exit(f"estrategia '{n}' nao existe. Disponiveis: {', '.join(estrategias.REGISTRO)}")
    for tf in periodos:
        if tf not in bt.PERIODOS:
            sys.exit(f"periodo '{tf}' nao existe. Use: {', '.join(bt.PERIODOS)}")

    p = bt.Params(banca=args.banca, margem=args.margem, alav=args.alav, taxa=args.taxa,
                  mm=args.mm, stop=args.stop, rr=args.rr)
    minimo_ativos = 2 if len(ativos) >= 3 else len(ativos)

    print("=" * 96)
    print(f"  BATERIA DA FASE 1 — {len(nomes)} estrategias x {len(ativos)} ativos x {len(periodos)} periodos"
          f"   (dado publico; nenhuma ordem real)")
    print("=" * 96)
    print(f"  banca {p.banca:.0f}  margem {p.margem:.0f}  {p.alav:g}x  stop {p.stop:g}%  alvo {p.stop * p.rr:g}%"
          f"  lado={args.lado}{'  alinhado' if args.alinhar else ''}  ~{args.dias} dias")
    print(f"  passa no periodo: SINAL DE VANTAGEM em pelo menos {minimo_ativos} dos {len(ativos)} ativos")
    if args.historico:
        print("  modo HISTORICO: todo o historico de cada par, uma janela por ano-calendario")
    print()

    quando = time.strftime("%Y-%m-%d %H:%M")
    resultados: dict = {}  # (tf, nome) -> {ativo: avaliacao}
    anos: dict = {}        # (tf, ativo) -> [rotulos dos anos]
    for tf in periodos:
        for ativo in ativos:
            n = bt.candles_para(tf, args.dias, args.alinhar)
            serie = bt.buscar(ativo, tf, n)
            print(f"  {ativo} {tf}: {bt.periodo_txt(serie)} — testando {len(nomes)} estrategias...", flush=True)
            cortes = bt.cortes_por_ano(serie) if args.historico else None
            if cortes is not None:
                anos[(tf, ativo)] = [c[2] for c in cortes]
            for nome in nomes:
                a = bt.avaliar_robustez(serie, nome, p, args.janelas, 30, args.lado, args.alinhar, cortes)
                resultados.setdefault((tf, nome), {})[ativo] = a
                if a is not None:
                    t = a["placar"]
                    registrar(args.caderno, {
                        "quando": quando, "hipotese": chave_hipotese(nome, tf, args.lado, args.alinhar, p),
                        "estrategia": nome, "periodo": tf, "ativo": ativo, "candles": len(serie),
                        "veredito": a["veredito"], "bate_moedas": round(a["media_bate"], 1),
                        "janelas_positivas": a["positivas"], "janelas": a["janelas"],
                        "modo": "historico_por_ano" if args.historico else f"{args.dias}d",
                        "operacoes": len(t.resultados),
                        "acerto": round(t.acerto, 1), "por_operacao": round(t.por_operacao, 4),
                    })
    print()

    passaram = []
    for tf in periodos:
        print(f"  >>> {tf}")
        cab = f"  {'estrategia':<12}"
        for ativo in ativos:
            cab += f" | {ativo:<15}"
        cab += " |   ops | acerto |  por op | passa?"
        print(cab)
        print("  " + "-" * (len(cab) - 2))
        for nome in nomes:
            linha = f"  {nome:<12}"
            juntos = bt.Resultado()
            vantagens = 0
            for ativo in ativos:
                a = resultados[(tf, nome)].get(ativo)
                if a is None:
                    linha += f" | {'curta demais':<15}"
                    continue
                juntos.resultados.extend(a["placar"].resultados)
                vantagens += 1 if a["veredito"] == "vantagem" else 0
                linha += f" | {a['media_bate']:3.0f}% {CURTO[a['veredito']]:<10}"
            passa = vantagens >= minimo_ativos
            if passa:
                passaram.append((tf, nome, vantagens))
            linha += (f" | {len(juntos.resultados):5d} | {juntos.acerto:5.1f}% | {juntos.por_operacao:+7.2f}"
                      f" | {'SIM' if passa else 'nao'} ({vantagens}/{len(ativos)})")
            print(linha)
        print()

    if args.historico:
        print("  ANO A ANO — retorno da banca de papel em cada ano, e em quantos anos ficou positiva")
        print("  Estrategia que so ganha em 1 ou 2 anos teve sorte com aquele mercado, nao achou padrao.")
        for tf in periodos:
            for ativo in ativos:
                rot = anos.get((tf, ativo))
                if not rot:
                    continue
                cab = f"  {ativo} {tf:<4} {'estrategia':<12}" + "".join(f" | {r:>7}" for r in rot) + " | anos +"
                print(cab)
                print("  " + "-" * (len(cab) - 2))
                for nome in nomes:
                    a = resultados[(tf, nome)].get(ativo)
                    if a is None:
                        continue
                    por_rot = {l["janela"]: l for l in a["linhas"]}
                    linha = f"  {'':<14}{nome:<12}"
                    for r in rot:
                        l = por_rot.get(r)
                        linha += f" | {l['retorno']:+6.1f}%" if l else f" | {'—':>7}"
                    linha += f" | {a['positivas']}/{a['janelas']}"
                    print(linha)
                print()

    print("  " + "=" * 60)
    if passaram:
        print("  PASSARAM NA FASE 1 (candidatas para a fase 2, o vigia ao vivo):")
        for tf, nome, v in passaram:
            print(f"    - {nome} no {tf}  ({v} de {len(ativos)} ativos com sinal de vantagem)")
    else:
        print("  NENHUMA ESTRATEGIA PASSOU.")
        print("  Com estes dados, nenhuma bate a moeda de forma consistente em mais de um ativo.")
    print()
    print(f"  Tentativas registradas no caderno: {tentativas_no_caderno(args.caderno)}"
          f"  ({os.path.basename(args.caderno)})")
    print("  Quanto mais tentativas, mais provavel que a melhor seja sorte. Uma candidata so")
    print("  vira estrategia de verdade se repetir AO VIVO, no vigia, em candles que ela nunca viu.")
    print()
    print("  Leitura: a coluna de cada ativo mostra de quantas moedas pareadas a estrategia")
    print("  ganhou, em media, e o veredito. 'por op' e o resultado medio por operacao, em USDT,")
    print("  ja com a taxa — negativo quer dizer que perde dinheiro, por maior que seja o acerto.")


if __name__ == "__main__":
    main()
