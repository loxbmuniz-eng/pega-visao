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
import caderno as cad
import estatistica
import estrategias

chave_hipotese = cad.chave_hipotese
tentativas_no_caderno = cad.tentativas_no_caderno
sharpes_no_caderno = cad.sharpes_no_caderno

PADRAO_ESTRATEGIAS = ("confl3,confl4,engolfo,divergencia,canal,ema,momento,rsi,confl3_fluxo,canal_fluxo,"
                      "cacada,reteste,compressao,sessao,vwap_dia,bos,choch,fvg,ob,smc,ichimoku,spring")
CADERNO = cad.CADERNO

CURTO = {"vantagem": "VANTAGEM", "inconclusivo": "inconcl.", "sem_vantagem": "sem"}


DSR_MINIMO = 0.95
# Chance de a melhor ser sorte de selecao (PBO, estatistica.pbo): acima disto, a
# melhor do periodo no teste nao preve a melhor fora dele, e nenhuma do periodo passa.
PBO_MAX = 0.5
PBO_BLOCOS = 10
DIA_MS = 86_400_000


def matriz_diaria(colunas: list[list[tuple[int, float]]], ini_ms: int, fim_ms: int) -> list[list[float]]:
    """Uma linha por dia (UTC) de ini a fim e uma coluna por estrategia: a soma, em
    USDT, do que cada uma fechou naquele dia (zero no dia sem operacao)."""
    d0, d1 = ini_ms // DIA_MS, fim_ms // DIA_MS
    m = [[0.0] * len(colunas) for _ in range(d1 - d0 + 1)]
    for j, col in enumerate(colunas):
        for t, v in col:
            d = t // DIA_MS - d0
            if 0 <= d < len(m):
                m[d][j] += v
    return m


def pbo_de(resultados: dict, chaves: list, ativos: list[str], ini_ms: int, fim_ms: int) -> dict:
    """PBO das estrategias em `chaves` ((tf, nome) da bateria), cada uma somando os ativos."""
    colunas = []
    for k in chaves:
        col = []
        for ativo in ativos:
            a = (resultados.get(k) or {}).get(ativo)
            if a:
                col += list(zip(a["placar"].saidas_ms, a["placar"].resultados))
        colunas.append(col)
    return estatistica.pbo(matriz_diaria(colunas, ini_ms, fim_ms), PBO_BLOCOS)


def texto_pbo(rotulo: str, r: dict) -> str:
    if r.get("pbo") is None:
        return f"  chance de a melhor {rotulo} ser sorte de selecao (PBO): sem dias suficientes para medir"
    alerta = " — ACIMA DE 50%: escolher a melhor aqui nao preve a melhor fora do teste" if r["pbo"] > PBO_MAX else ""
    return (f"  chance de a melhor {rotulo} ser sorte de selecao (PBO): {r['pbo'] * 100:.0f}% "
            f"({r['combinacoes']} divisoes de {r['dias']} dias, {r['estrategias']} estrategias){alerta}")


def prova_por_ativo(resultados_por_ativo: list[list[float]], tentativas: int, var_sorte) -> dict:
    """BTC, ETH e SOL andam juntos: somar as operacoes dos tres como se fossem
    independentes infla a prova. Cada ativo e provado com as proprias operacoes e
    vale a pior nota (ativo com menos de 3 operacoes nao prova nada: nota zero)."""
    provas = [estatistica.sharpe_deflacionado(r, tentativas, var_sorte) for r in resultados_por_ativo]
    if not provas:
        return {"dsr": 0.0}
    return min(provas, key=lambda x: x["dsr"])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ativos", default="BTCUSDT,ETHUSDT,SOLUSDT")
    ap.add_argument("--periodos", default="5m,15m,1h,4h")
    ap.add_argument("--estrategias", default=PADRAO_ESTRATEGIAS)
    ap.add_argument("--dias", type=int, default=90)
    ap.add_argument("--banca", type=float, default=110.0)
    ap.add_argument("--margem", type=float, default=15.0)
    ap.add_argument("--alav", type=float, default=24.0)
    ap.add_argument("--taxa", type=float, default=0.05)
    ap.add_argument("--mm", type=float, default=0.5)
    ap.add_argument("--stop", type=float, default=0.5)
    ap.add_argument("--rr", type=float, default=2.0)
    ap.add_argument("--saida", choices=("alvo", "surfe"), default="alvo",
                    help="alvo: sai inteira no alvo; surfe: metade no alvo e o resto segue o preco")
    ap.add_argument("--deslize", type=float, default=bt.DESLIZE_PADRAO, help="%% por execucao a mercado")
    ap.add_argument("--funding", type=float, default=bt.FUNDING_PADRAO, help="%% a cada 8 h, contra a posicao")
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
                  mm=args.mm, stop=args.stop, rr=args.rr, saida=args.saida,
                  deslize=args.deslize, funding=args.funding)
    minimo_ativos = 2 if len(ativos) >= 3 else len(ativos)

    print("=" * 96)
    print(f"  BATERIA DA FASE 1 — {len(nomes)} estrategias x {len(ativos)} ativos x {len(periodos)} periodos"
          f"   (dado publico; nenhuma ordem real)")
    print("=" * 96)
    print(f"  banca {p.banca:.0f}  margem {p.margem:.0f}  {p.alav:g}x  stop {p.stop:g}%  alvo {p.stop * p.rr:g}%"
          f"  deslize {p.deslize:g}%  funding {p.funding:g}%/8h"
          f"  lado={args.lado}{'  alinhado' if args.alinhar else ''}  ~{args.dias} dias")
    print(f"  passa no periodo: SINAL DE VANTAGEM em pelo menos {minimo_ativos} dos {len(ativos)} ativos")
    print(f"  acerto minimo para empatar com estes parametros (taxa nas duas pontas): {bt.acerto_minimo(p):.1f}%")
    if args.historico:
        print("  modo HISTORICO: todo o historico de cada par, uma janela por ano-calendario")
    print()

    quando = time.strftime("%Y-%m-%d %H:%M")
    resultados: dict = {}  # (tf, nome) -> {ativo: avaliacao}
    anos: dict = {}        # (tf, ativo) -> [rotulos dos anos]
    faixa: dict = {}       # tf -> (primeiro, ultimo) candle, em ms, somando os ativos
    for tf in periodos:
        for ativo in ativos:
            n = bt.candles_para(tf, args.dias, args.alinhar)
            inicio = time.time()
            serie = bt.buscar(ativo, tf, n)
            if serie.t:
                ini, fim = faixa.get(tf, (serie.t[0], serie.t[-1]))
                faixa[tf] = (min(ini, serie.t[0]), max(fim, serie.t[-1]))
            print(f"  {ativo} {tf}: {bt.periodo_txt(serie)} — testando {len(nomes)} estrategias...", end="", flush=True)
            cortes = bt.cortes_por_ano(serie) if args.historico else None
            if cortes is not None:
                anos[(tf, ativo)] = [c[2] for c in cortes]
            for nome in nomes:
                a = bt.avaliar_robustez(serie, nome, p, args.janelas, 30, args.lado, args.alinhar, cortes)
                resultados.setdefault((tf, nome), {})[ativo] = a
                if a is not None:
                    modo = "historico_por_ano" if args.historico else f"{args.dias}d_{args.janelas}janelas"
                    cad.registrar_avaliacao(args.caderno, a, nome, tf, ativo, args.lado, args.alinhar, p,
                                            modo, "binance", len(serie), quando)
            print(f" ok ({time.time() - inicio:.0f} s)", flush=True)
    print()

    tentativas = tentativas_no_caderno(args.caderno)
    var_sorte = estatistica.variancia(sharpes_no_caderno(args.caderno))
    passaram = []
    pbos = {tf: pbo_de(resultados, [(tf, nome) for nome in nomes], ativos, *faixa[tf]) for tf in periodos if tf in faixa}
    for tf in periodos:
        print(f"  >>> {tf}")
        cab = f"  {'estrategia':<12}"
        for ativo in ativos:
            cab += f" | {ativo:<15}"
        cab += " |   ops | acerto | vs min |  por op | nao-sorte | passa?"
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
            prova = prova_por_ativo([a["placar"].resultados for a in resultados[(tf, nome)].values() if a],
                                    tentativas, var_sorte)
            pb = (pbos.get(tf) or {}).get("pbo")
            passa = vantagens >= minimo_ativos and prova["dsr"] >= DSR_MINIMO and (pb is None or pb <= PBO_MAX)
            if passa:
                passaram.append((tf, nome, vantagens))
            linha += (f" | {len(juntos.resultados):5d} | {juntos.acerto:5.1f}% | {juntos.acerto - bt.acerto_minimo(p):+6.1f}"
                      f" | {juntos.por_operacao:+7.2f}"
                      f" | {prova['dsr'] * 100:8.1f}% | {'SIM' if passa else 'nao'} ({vantagens}/{len(ativos)})")
            print(linha)
        if tf in pbos:
            print(texto_pbo(f"do {tf}", pbos[tf]))
        print()
    if faixa:
        geral = pbo_de(resultados, [(tf, nome) for tf in periodos if tf in faixa for nome in nomes], ativos,
                       min(a for a, _ in faixa.values()), max(b for _, b in faixa.values()))
        print(texto_pbo("da bateria inteira (todas as estrategias e periodos)", geral))
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

    print(f"  'nao-sorte' = Sharpe deflacionado: a chance de o resultado nao ser so sorte, dado que ja")
    print(f"  foram {tentativas} tentativas no caderno. Passa so com vantagem na moeda E {DSR_MINIMO * 100:.0f}% ou mais,")
    print(f"  E com o PBO do periodo em {PBO_MAX * 100:.0f}% ou menos (a escolha da melhor se sustenta fora do teste).")
    print()
    print("  " + "=" * 60)
    if passaram:
        print("  PASSARAM NA FASE 1 (candidatas para a fase 2, o vigia ao vivo):")
        for tf, nome, v in passaram:
            print(f"    - {nome} no {tf}  ({v} de {len(ativos)} ativos com sinal de vantagem)")
    else:
        print("  NENHUMA ESTRATEGIA PASSOU.")
        print("  Com estes dados, nenhuma bate a moeda de forma consistente em mais de um ativo")
        print(f"  com chance de {DSR_MINIMO * 100:.0f}% ou mais de nao ser sorte.")
    print()
    print(f"  Tentativas registradas no caderno: {tentativas}"
          f"  ({os.path.basename(args.caderno)})")
    print("  Quanto mais tentativas, mais provavel que a melhor seja sorte. Uma candidata so")
    print("  vira estrategia de verdade se repetir AO VIVO, no vigia, em candles que ela nunca viu.")
    print()
    print("  Leitura: a coluna de cada ativo mostra de quantas moedas pareadas a estrategia")
    print("  ganhou, em media, e o veredito. 'por op' e o resultado medio por operacao, em USDT,")
    print("  ja com a taxa — negativo quer dizer que perde dinheiro, por maior que seja o acerto.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\n\nBateria interrompida antes do fim (Ctrl+C ou o Terminal foi fechado). Nada foi perdido: "
                 "rode 'python3 vibe.py bateria' de novo e espere a linha 'PASSARAM NA FASE 1' ou "
                 "'NENHUMA ESTRATEGIA PASSOU'.")
