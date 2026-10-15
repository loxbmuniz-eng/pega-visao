#!/usr/bin/env python3
"""
Tendencia diaria: a estrategia com a melhor prova publicada para cripto, replicada
para ser testada aqui, com os nossos custos e contra o nosso controle.

Fonte: Zarattini, Pagani e Barbon (2025), "Catching Crypto Trends; A Tactical
Approach for Bitcoin and Altcoins" (SSRN 5209907). Eles relatam Sharpe acima de
1,5 depois das taxas. A regra abaixo segue a descricao dos resumos publicados (o
PDF nao abriu daqui; os pontos que dependem dele estao marcados):

  - 9 canais de Donchian nos FECHAMENTOS: 5, 10, 20, 30, 60, 90, 150, 250 e 360 dias;
  - cada canal compra quando o fechamento passa do maior fechamento dos N dias
    anteriores, e sai quando o fechamento cai abaixo do stop, que comeca no meio
    do canal e so sobe (o maior entre o stop de ontem e o meio do canal de hoje).
    Com o canal feito de fechamentos, o meio ja nao desce enquanto se esta
    comprado; a trava fica pela fidelidade a regra descrita;
  - a exposicao e a media dos 9 canais (0 a 1). So comprado;
  - tamanho pela volatilidade: alvo de 25% ao ano sobre a volatilidade realizada
    de 90 dias, com teto de 2 vezes a banca;
  - rebalanceia todo dia no fechamento.

Aqui entram, alem do artigo: taxa e deslize sobre o que muda de posicao, funding
sobre o que fica aberto (a serie real da Binance quando houver), e o CONTROLE: a
mesma serie de exposicoes deslocada no tempo (mesma exposicao media, mesmo giro,
hora sorteada). Se a tendencia nao ganhar do proprio deslocamento, o que ela tem
e exposicao, nao acerto de hora. So biblioteca padrao.
"""

from __future__ import annotations

import argparse
import bisect
import math
import random
import sys
import time

import backtest as bt
import caderno as cad
import estatistica

CANAIS = (5, 10, 20, 30, 60, 90, 150, 250, 360)
ALVO_VOL = 0.25         # volatilidade-alvo ao ano
JANELA_VOL = 90         # dias da volatilidade realizada
TETO = 2.0              # exposicao maxima, em vezes a banca
DIAS_ANO = 365          # cripto opera todo dia
DIA_MS = 86_400_000
FUNDING_DIA_PADRAO = 3 * bt.FUNDING_PADRAO / 100   # sem a serie real: 3 cobrancas de 0,01%
# Depois desta data o teste e fora da amostra do artigo (publicado em maio de 2025).
FORA_DA_AMOSTRA_MS = 1_746_057_600_000   # 01/05/2025 00:00 UTC
DESLOCAMENTOS = 200
DESLOCAMENTO_MIN = 60   # dias: deslocamento menor que isso ainda carrega a tendencia
BATER_MIN = 0.75        # fracao dos deslocamentos que a estrategia precisa bater


# --------------------------------------------------------------------------- #
# sinal
# --------------------------------------------------------------------------- #

def canal(fech: list[float], n: int, i: int) -> tuple[float, float]:
    """Maior e menor fechamento dos n dias ANTERIORES a i (o dia i fica de fora)."""
    janela = fech[i - n:i]
    return max(janela), min(janela)


def exposicao_por_canal(fech: list[float], n: int) -> list[int]:
    """1 nos dias em que o canal de n dias termina comprado (decidido no fechamento)."""
    saida = [0] * len(fech)
    dentro, stop = False, 0.0
    for i in range(n, len(fech)):
        alto, baixo = canal(fech, n, i)
        meio = (alto + baixo) / 2
        if not dentro:
            if fech[i] > alto:
                dentro, stop = True, meio
        else:
            stop = max(stop, meio)
            if fech[i] < stop:
                dentro = False
        saida[i] = 1 if dentro else 0
    return saida


def exposicao(fech: list[float], canais=CANAIS) -> list[float]:
    """Media dos canais: 0 (nenhum comprado) a 1 (todos)."""
    por = [exposicao_por_canal(fech, n) for n in canais]
    return [sum(c[i] for c in por) / len(canais) for i in range(len(fech))]


def vol_anual(fech: list[float], i: int, janela: int = JANELA_VOL) -> float | None:
    """Volatilidade realizada (desvio dos retornos diarios em log) dos `janela` dias
    ate i, anualizada. None sem dias suficientes."""
    if i < janela:
        return None
    r = [math.log(fech[k] / fech[k - 1]) for k in range(i - janela + 1, i + 1)]
    m = sum(r) / len(r)
    var = sum((x - m) ** 2 for x in r) / (len(r) - 1)
    return math.sqrt(var * DIAS_ANO) if var > 0 else None


def pesos(fech: list[float], canais=CANAIS, alvo: float = ALVO_VOL, teto: float = TETO,
          janela: int = JANELA_VOL) -> list[float | None]:
    """Exposicao-alvo (vezes a banca) decidida no fechamento de cada dia. None antes de
    todos os canais e a volatilidade terem historia (nao opera aquecendo)."""
    exp = exposicao(fech, canais)
    inicio = max(max(canais), janela)
    saida: list[float | None] = []
    for i in range(len(fech)):
        v = vol_anual(fech, i, janela) if i >= inicio else None
        saida.append(None if v is None else exp[i] * min(alvo / v, teto))
    return saida


# --------------------------------------------------------------------------- #
# simulacao
# --------------------------------------------------------------------------- #

def funding_entre(taxas: list[tuple[int, float]] | None, de_ms: int, ate_ms: int) -> float:
    """Soma das taxas de funding cobradas em (de_ms, ate_ms]. Sem serie: 3 cobrancas
    de 0,01% por dia, contra o comprado (conservador). Serie real: a taxa positiva
    o comprado paga, a negativa ele recebe."""
    if taxas is None:
        return FUNDING_DIA_PADRAO * (ate_ms - de_ms) / DIA_MS
    tempos = [t for t, _ in taxas]
    a, b = bisect.bisect_right(tempos, de_ms), bisect.bisect_right(tempos, ate_ms)
    return sum(r for _, r in taxas[a:b])


def simular(s: bt.Serie, w: list[float | None], taxa: float = 0.05, deslize: float = bt.DESLIZE_PADRAO,
            taxas_funding: list[tuple[int, float]] | None = None) -> dict:
    """Banca rebalanceada todo dia no fechamento para a exposicao w[i]. Entre o
    fechamento de i e o de i+1 rende w x retorno do dia, menos o funding da
    posicao aberta; no rebalanceamento paga taxa + deslize sobre o que mudou
    (a partir do peso que o preco ja carregou). Devolve os retornos diarios."""
    custo = (taxa + deslize) / 100
    rets, dias, giro, pago_custo, pago_funding = [], [], 0.0, 0.0, 0.0
    atual = 0.0      # exposicao que a banca carrega agora (depois do preco andar)
    for i in range(len(s) - 1):
        alvo = w[i]
        if alvo is None:
            continue
        troca = abs(alvo - atual)
        r_ativo = s.fechamento[i + 1] / s.fechamento[i] - 1
        fim_i = s.t[i] + DIA_MS if s.t else 0
        f = funding_entre(taxas_funding, fim_i, fim_i + DIA_MS) if s.t else FUNDING_DIA_PADRAO
        r = alvo * r_ativo - troca * custo - alvo * f
        rets.append(r)
        dias.append(s.t[i + 1] if s.t else i + 1)
        giro += troca
        pago_custo += troca * custo
        pago_funding += alvo * f
        # o preco leva a exposicao: comprado que subiu fica com mais exposicao
        atual = alvo * (1 + r_ativo) / (1 + r) if 1 + r > 0 else 0.0
    return {"retornos": rets, "dias": dias, "giro": giro, "custo": pago_custo, "funding": pago_funding}


def metricas(rets: list[float]) -> dict:
    """CAGR, volatilidade, Sharpe (ao ano), pior queda e banca final (inicial = 1)."""
    if len(rets) < 2:
        return {"n": len(rets), "cagr": 0.0, "vol": 0.0, "sharpe": 0.0, "pior_queda": 0.0, "final": 1.0}
    banca = pico = 1.0
    pior = 0.0
    for r in rets:
        banca *= 1 + r
        pico = max(pico, banca)
        pior = max(pior, 1 - banca / pico)
    m = sum(rets) / len(rets)
    dp = math.sqrt(sum((x - m) ** 2 for x in rets) / (len(rets) - 1))
    anos = len(rets) / DIAS_ANO
    return {"n": len(rets), "cagr": banca ** (1 / anos) - 1 if banca > 0 else -1.0,
            "vol": dp * math.sqrt(DIAS_ANO), "sharpe": m / dp * math.sqrt(DIAS_ANO) if dp > 0 else 0.0,
            "pior_queda": pior, "final": banca}


def deslocamentos(w: list[float | None], n: int = DESLOCAMENTOS, minimo: int = DESLOCAMENTO_MIN,
                  semente: int = 7) -> list[list[float | None]]:
    """O controle: a mesma serie de exposicoes girada no tempo (o fim volta ao
    comeco). Mesma exposicao media e mesmo giro; a hora certa vira sorte."""
    validos = [k for k, x in enumerate(w) if x is not None]
    if len(validos) < 2 * minimo + 1:
        return []
    ini, vals = validos[0], [w[k] for k in validos]
    sorteio = random.Random(semente)
    saida = []
    for _ in range(n):
        d = sorteio.randrange(minimo, len(vals) - minimo)
        girado = vals[d:] + vals[:d]
        saida.append([None] * ini + girado + [None] * (len(w) - ini - len(girado)))
    return saida


def avaliar(s: bt.Serie, taxa: float = 0.05, deslize: float = bt.DESLIZE_PADRAO,
            taxas_funding: list[tuple[int, float]] | None = None, n_controle: int = DESLOCAMENTOS,
            corte_ms: int = FORA_DA_AMOSTRA_MS) -> dict:
    """A estrategia, o comprado e parado, e o controle: quantos deslocamentos ela bate
    no Sharpe. E o mesmo, so com os dias depois do artigo (fora da amostra)."""
    w = pesos(s.fechamento)
    est = simular(s, w, taxa, deslize, taxas_funding)
    parado = simular(s, [1.0 if x is not None else None for x in w], 0.0, 0.0, [])   # comprado, sem custo
    ctrl = [metricas(simular(s, wc, taxa, deslize, taxas_funding)["retornos"])["sharpe"]
            for wc in deslocamentos(w, n_controle)]
    m = metricas(est["retornos"])
    fora = [r for r, d in zip(est["retornos"], est["dias"]) if d >= corte_ms]
    validos = [x for x in w if x is not None]
    return {"estrategia": m, "parado": metricas(parado["retornos"]),
            "bate": (sum(1 for c in ctrl if m["sharpe"] > c) / len(ctrl)) if ctrl else 0.0,
            "controles": len(ctrl), "fora": metricas(fora), "retornos": est["retornos"],
            "exposicao_media": (sum(validos) / len(validos)) if validos else 0.0,
            "giro_ano": est["giro"] / (len(est["retornos"]) / DIAS_ANO) if est["retornos"] else 0.0,
            "custo": est["custo"], "funding": est["funding"],
            "agora": {"peso": w[-1] if w else None, "canais": round(exposicao(s.fechamento)[-1] * len(CANAIS)),
                      "vol": vol_anual(s.fechamento, len(s) - 1)}}


# --------------------------------------------------------------------------- #
# dados e relatorio
# --------------------------------------------------------------------------- #

def historico_funding_binance(par: str, desde_ms: int, pedir=None, agora_ms: int | None = None) -> list[tuple[int, float]]:
    """Todas as taxas de funding do perpetuo na Binance desde `desde_ms`, em ordem,
    paginando para a frente de 1000 em 1000."""
    pedir = pedir or bt._pedir
    agora_ms = agora_ms or int(time.time() * 1000)
    saida, inicio = [], desde_ms
    while inicio < agora_ms:
        lote = pedir(f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={par}&startTime={inicio}&limit=1000")
        if not isinstance(lote, list) or not lote:
            break
        for x in lote:
            r = float(x["fundingRate"])
            if abs(r) >= 0.05:
                raise ValueError(f"funding em formato inesperado: {x['fundingRate']}")
            saida.append((int(x["fundingTime"]), r))
        if len(lote) < 1000:
            break
        inicio = int(lote[-1]["fundingTime"]) + 1
    return sorted(set(saida))


def chave(taxa: float, deslize: float, funding_real: bool) -> str:
    """A identidade desta tentativa no caderno: mudar canais, alvo, teto ou custo e outra."""
    return (f"tendencia_diaria|1d|compra|canais{'-'.join(map(str, CANAIS))}|alvo{ALVO_VOL:g}|teto{TETO:g}"
            f"|vol{JANELA_VOL}|taxa{taxa:g}|deslize{deslize:g}|funding_{'real' if funding_real else 'fixo'}"
            f"|historico|binance")


def _pct(x: float, casas: int = 1) -> str:
    return f"{x * 100:+.{casas}f}%".replace(".", ",")


def _vol(x: float) -> str:
    return f"{x * 100:.1f}%".replace(".", ",")


def texto(par: str, a: dict, dsr: dict, banca: float = 100.0) -> str:
    e, p, f = a["estrategia"], a["parado"], a["fora"]
    ag = a["agora"]
    L = [f"  {par}: {e['n']} dias",
         f"    tendencia  CAGR {_pct(e['cagr'])}  vol {_vol(e['vol'])}  Sharpe {e['sharpe']:.2f}  "
         f"pior queda {_pct(-e['pior_queda'])}".replace(".", ","),
         f"    comprado   CAGR {_pct(p['cagr'])}  vol {_vol(p['vol'])}  Sharpe {p['sharpe']:.2f}  "
         f"pior queda {_pct(-p['pior_queda'])}  (parado, sem custo nem funding)".replace(".", ","),
         f"    bate {a['bate'] * 100:.0f}% dos {a['controles']} deslocamentos · nao-sorte {dsr['dsr'] * 100:.1f}% · "
         f"exposicao media {a['exposicao_media']:.2f}x · giro {a['giro_ano']:.1f}x ao ano".replace(".", ","),
         f"    custos: taxa e deslize {_pct(-a['custo'])}, funding {_pct(-a['funding'])} da banca, somados".replace(".", ","),
         f"    depois de maio de 2025 (fora da amostra do artigo): {f['n']} dias, CAGR {_pct(f['cagr'])}, "
         f"Sharpe {f['sharpe']:.2f}".replace(".", ",")]
    if ag["peso"] is not None:
        L.append(f"    hoje: {ag['canais']} de {len(CANAIS)} canais comprados, exposicao-alvo {ag['peso']:.2f}x a banca "
                 f"(com {banca:g} USDT: {ag['peso'] * banca:.0f} USDT comprado; volatilidade "
                 f"{_vol(ag['vol'] or 0)} ao ano)".replace(".", ","))
    return "\n".join(L)


def main() -> None:
    ap = argparse.ArgumentParser(description="Tendencia diaria (Donchian em conjunto, tamanho pela volatilidade)")
    ap.add_argument("--ativos", default="BTCUSDT,ETHUSDT")
    ap.add_argument("--taxa", type=float, default=0.05)
    ap.add_argument("--deslize", type=float, default=bt.DESLIZE_PADRAO)
    ap.add_argument("--sem-funding-real", action="store_true", help="usa 0,03%% ao dia contra o comprado")
    ap.add_argument("--caderno", default=cad.CADERNO)
    ap.add_argument("--banca", type=float, default=100.0, help="so para traduzir a exposicao de hoje em USDT")
    args = ap.parse_args()
    ativos = [a.strip().upper() for a in args.ativos.split(",") if a.strip()]
    print("=" * 96)
    print(f"  TENDENCIA DIARIA — {len(ativos)} ativo(s), historico inteiro (dado publico; nenhuma ordem real)")
    print(f"  9 canais de 5 a 360 dias, volatilidade-alvo {ALVO_VOL * 100:.0f}%, teto {TETO:g}x, "
          f"taxa {args.taxa:g}% + deslize {args.deslize:g}% por troca, funding "
          f"{'fixo 0,03%/dia' if args.sem_funding_real else 'real da Binance'}".replace(".", ","))
    print("=" * 96)
    avals = {}
    for par in ativos:
        t0 = time.time()
        try:
            s = bt.buscar(par, "1d", 4000)
        except SystemExit as e:
            print(f"  {par}: sem candles ({e})")
            continue
        taxas = None
        if not args.sem_funding_real:
            try:
                taxas = historico_funding_binance(par, s.t[0])
            except Exception as e:
                print(f"  {par}: funding real fora do ar ({type(e).__name__}); usando 0,03% ao dia contra o comprado")
        a = avaliar(s, args.taxa, args.deslize, taxas)
        avals[par] = a
        # sem "sharpe_op": o Sharpe diario nao e da mesma escala do Sharpe por operacao
        # das outras tentativas; a tentativa conta, a escala nao se mistura
        cad.registrar(args.caderno, {
            "quando": time.strftime("%Y-%m-%d %H:%M"), "hipotese": chave(args.taxa, args.deslize, taxas is not None),
            "estrategia": "tendencia_diaria", "periodo": "1d", "ativo": par, "dias": a["estrategia"]["n"],
            "sharpe_ano": round(a["estrategia"]["sharpe"], 4), "bate_deslocamentos": round(a["bate"] * 100, 1),
            "modo": "historico"})
        print(f"  {par}: {len(s)} dias de candles ({time.time() - t0:.0f} s)", flush=True)
    tentativas = max(1, cad.tentativas_no_caderno(args.caderno))
    passaram = []
    for par, a in avals.items():
        # variancia do proprio estimador do Sharpe (as outras tentativas sao de outra escala)
        dsr = estatistica.sharpe_deflacionado(a["retornos"], tentativas)
        print(texto(par, a, dsr, args.banca))
        print()
        if a["bate"] >= BATER_MIN and dsr["dsr"] >= 0.95:
            passaram.append(par)
    print(f"  Passa num ativo: bater {BATER_MIN * 100:.0f}% dos deslocamentos E 95% de chance de nao ser sorte "
          f"({tentativas} tentativas no caderno).")
    print("  'deslocamentos' = a mesma exposicao em outra hora: mostra se o ganho vem do momento certo ou so de "
          "estar comprado.")
    print("  " + "=" * 60)
    precisa = min(2, len(avals))
    if avals and len(passaram) >= precisa:
        print(f"  PASSOU: {', '.join(passaram)}. Proximo passo: o mesmo teste com moedas que morreram (arquivo da "
              f"Binance) e o placar ao vivo.")
    elif passaram:
        print(f"  NAO PASSOU: so {', '.join(passaram)} passou, e a regra pede {precisa} ativos (um so pode ser sorte "
              f"daquela moeda).")
    else:
        print("  NAO PASSOU: nestes dados, a tendencia diaria nao prova acerto de hora alem do acaso.")
    print("  Cesta escolhida hoje so tem moedas que sobreviveram: o resultado de varias moedas e otimista.")


if __name__ == "__main__":
    main()
