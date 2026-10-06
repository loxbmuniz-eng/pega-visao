#!/usr/bin/env python3
"""
Backtest de scalping alavancado em perpetuos — SEM credencial, SEM ordem real.

Puxa candles publicos (nenhuma chave de API) e simula a estrategia descrita:
alavancagem alta, margem fixa por operacao, stop curto, alvo por multiplo de
risco. Reporta o resultado por periodo de candle, com taxa e liquidacao
modeladas.

Objetivo: descobrir se a estrategia ganha ANTES de arriscar dinheiro.

Uso:
    python3 backtest.py                      # cenario padrao (banca 110, 100x)
    python3 backtest.py --alav 24 --stop 0.5 # sizing dentro de limite de risco
    python3 backtest.py --hedge              # long e short simultaneos
    python3 backtest.py --dias 60 --par ETHUSDT

Requer apenas a biblioteca padrao do Python 3.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field

# Candles publicos. Nenhum destes endpoints exige chave nem conta.
FONTES = [
    ("binance", "https://api.binance.com/api/v3/klines?symbol={par}&interval={tf}&limit={n}"),
    ("binance-us", "https://api.binance.us/api/v3/klines?symbol={par}&interval={tf}&limit={n}"),
]

# periodos pedidos -> codigo do endpoint e minutos por candle
PERIODOS = {
    "15m": 15,
    "1h": 60,
    "4h": 240,
    "12h": 720,
    "1d": 1440,
}


# --------------------------------------------------------------------------- #
# dados
# --------------------------------------------------------------------------- #

@dataclass
class Candle:
    abertura: float
    maxima: float
    minima: float
    fechamento: float


def buscar_candles(par: str, tf: str, n: int) -> list[Candle]:
    """Busca candles de uma fonte publica. Tenta as fontes em ordem."""
    erros = []
    for nome, molde in FONTES:
        url = molde.format(par=par, tf=tf, n=min(n, 1000))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "backtest/1.0"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                bruto = json.loads(resp.read().decode())
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            erros.append(f"{nome}: {e}")
            continue
        except json.JSONDecodeError as e:
            erros.append(f"{nome}: resposta invalida ({e})")
            continue

        if not isinstance(bruto, list) or not bruto:
            erros.append(f"{nome}: nenhum candle devolvido")
            continue

        return [
            Candle(float(k[1]), float(k[2]), float(k[3]), float(k[4]))
            for k in bruto
        ]

    print("Nao foi possivel buscar candles. Tentativas:", file=sys.stderr)
    for e in erros:
        print(f"  - {e}", file=sys.stderr)
    print(
        "\nSe voce esta atras de proxy ou numa rede restrita, rode este script\n"
        "na sua maquina local. Ele nao precisa de chave de API.",
        file=sys.stderr,
    )
    sys.exit(1)


# --------------------------------------------------------------------------- #
# parametros e resultado
# --------------------------------------------------------------------------- #

@dataclass
class Params:
    banca: float = 110.0
    margem: float = 15.0        # margem por operacao, em USDT
    alav: float = 100.0         # alavancagem
    taxa: float = 0.05          # % por lado (taker)
    mm: float = 0.5             # margem de manutencao, %
    stop: float = 0.5           # stop em % do preco
    rr: float = 2.0             # alvo = stop * rr
    hedge: bool = False         # abre long e short ao mesmo tempo
    max_barras: int = 48        # barras de espera antes de encerrar a mercado

    @property
    def notional(self) -> float:
        return self.margem * self.alav

    @property
    def liq_pct(self) -> float:
        """Movimento contrario, em % do preco, que liquida a posicao."""
        return max(0.0, (100.0 / self.alav) - self.mm)


@dataclass
class Resultado:
    operacoes: int = 0
    ganhos: int = 0
    perdas: int = 0
    liquidacoes: int = 0
    expiradas: int = 0
    taxa_paga: float = 0.0
    pnl: float = 0.0
    equity_min: float = 0.0
    equity_final: float = 0.0
    quebrou: bool = False
    curva: list[float] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# simulacao
# --------------------------------------------------------------------------- #

def _simular_perna(
    candles: list[Candle], i: int, direcao: int, p: Params
) -> tuple[float, str]:
    """
    Simula UMA posicao aberta no fechamento do candle i.

    direcao: +1 long, -1 short.
    Devolve (pnl_em_usdt_ja_com_taxa, desfecho).

    Regra conservadora: se stop e alvo cabem no mesmo candle, assume o STOP.
    Nao da para saber a ordem intrabarra com dado OHLC, e supor o alvo
    inflaria o resultado — o erro tem que cair contra a estrategia, nao a favor.
    """
    entrada = candles[i].fechamento
    taxa_total = p.notional * (p.taxa / 100.0) * 2.0

    d_stop = p.stop / 100.0
    d_alvo = (p.stop * p.rr) / 100.0
    d_liq = p.liq_pct / 100.0

    if direcao > 0:
        px_stop = entrada * (1 - d_stop)
        px_alvo = entrada * (1 + d_alvo)
        px_liq = entrada * (1 - d_liq)
    else:
        px_stop = entrada * (1 + d_stop)
        px_alvo = entrada * (1 - d_alvo)
        px_liq = entrada * (1 + d_liq)

    # liquidacao antes do stop: o stop nao existe de fato
    liq_primeiro = d_liq <= d_stop

    for j in range(i + 1, min(i + 1 + p.max_barras, len(candles))):
        c = candles[j]

        bateu_liq = (c.minima <= px_liq) if direcao > 0 else (c.maxima >= px_liq)
        bateu_stop = (c.minima <= px_stop) if direcao > 0 else (c.maxima >= px_stop)
        bateu_alvo = (c.maxima >= px_alvo) if direcao > 0 else (c.minima <= px_alvo)

        if liq_primeiro and bateu_liq:
            # perde a margem inteira; a taxa de saida ja esta embutida na liquidacao
            return -p.margem, "liquidado"
        if bateu_stop:
            return -(p.notional * d_stop) - taxa_total, "stop"
        if bateu_alvo:
            return (p.notional * d_alvo) - taxa_total, "alvo"
        if bateu_liq:
            return -p.margem, "liquidado"

    # expirou: encerra a mercado no fechamento do ultimo candle visto
    saida = candles[min(i + p.max_barras, len(candles) - 1)].fechamento
    var = (saida - entrada) / entrada * direcao
    return (p.notional * var) - taxa_total, "expirou"


def simular(candles: list[Candle], p: Params) -> Resultado:
    """
    Percorre a serie abrindo uma operacao por candle de sinal.

    O "sinal" aqui e deliberadamente neutro: alterna long e short (ou abre as
    duas pontas no modo hedge). Isso mede o que a ESTRUTURA da operacao faz —
    alavancagem, stop, taxa e liquidacao — sem o enfeite de um indicador.
    Se a estrutura perde dinheiro com entrada neutra, nenhum indicador em cima
    dela comeca no zero: ele comeca no prejuizo.
    """
    r = Resultado()
    equity = p.banca
    r.equity_min = equity
    r.curva.append(equity)

    i = 0
    alternado = 1
    passo = max(1, p.max_barras // 4)

    while i < len(candles) - 1:
        margem_necessaria = p.margem * (2 if p.hedge else 1)
        if equity < margem_necessaria:
            r.quebrou = True
            break

        pernas = [1, -1] if p.hedge else [alternado]
        for direcao in pernas:
            pnl, desfecho = _simular_perna(candles, i, direcao, p)
            equity += pnl
            r.pnl += pnl
            r.operacoes += 1
            r.taxa_paga += p.notional * (p.taxa / 100.0) * 2.0

            if desfecho == "alvo":
                r.ganhos += 1
            elif desfecho == "stop":
                r.perdas += 1
            elif desfecho == "liquidado":
                r.liquidacoes += 1
            else:
                r.expiradas += 1
                if pnl > 0:
                    r.ganhos += 1
                else:
                    r.perdas += 1

            r.equity_min = min(r.equity_min, equity)
            r.curva.append(equity)

            if equity <= 0:
                r.quebrou = True
                break

        if r.quebrou:
            break

        alternado *= -1
        i += passo

    r.equity_final = max(0.0, equity)
    return r


# --------------------------------------------------------------------------- #
# relatorio
# --------------------------------------------------------------------------- #

def cabecalho(p: Params, par: str, dias: int) -> None:
    print("=" * 74)
    print(f"  BACKTEST — {par}   ultimos ~{dias} dias   (dado publico, nenhuma ordem real)")
    print("=" * 74)
    print(f"  banca ............. {p.banca:.2f} USDT")
    print(f"  margem/operacao ... {p.margem:.2f} USDT      alavancagem: {p.alav:.0f}x")
    print(f"  notional .......... {p.notional:.2f} USDT   ({p.notional / p.banca:.1f}x a banca)")
    print(f"  taxa .............. {p.taxa:.3f}% por lado -> "
          f"{p.notional * p.taxa / 100 * 2:.2f} USDT ida e volta "
          f"({p.notional * p.taxa / 100 * 2 / p.margem * 100:.1f}% da margem)")
    print(f"  stop .............. {p.stop:.2f}%          alvo: {p.stop * p.rr:.2f}% ({p.rr:.1f}:1)")
    print(f"  liquidacao em ..... {p.liq_pct:.2f}%", end="")
    if p.liq_pct <= p.stop:
        print("   <-- ANTES DO STOP: o stop nao executa, a corretora liquida primeiro")
    else:
        print(f"   (folga de {p.liq_pct - p.stop:.2f}% depois do stop)")
    if p.hedge:
        print("  modo .............. HEDGE: long e short abertos ao mesmo tempo")
    print()


def linha_resultado(tf: str, r: Resultado, p: Params) -> None:
    ret = (r.equity_final - p.banca) / p.banca * 100 if p.banca else 0.0
    dd = (r.equity_min - p.banca) / p.banca * 100 if p.banca else 0.0
    wr = (r.ganhos / r.operacoes * 100) if r.operacoes else 0.0
    estado = "QUEBROU" if r.quebrou or r.equity_final <= 0 else f"{r.equity_final:8.2f}"
    print(
        f"  {tf:>4} | {r.operacoes:5d} | {wr:5.1f}% | {r.liquidacoes:4d} | "
        f"{r.taxa_paga:8.2f} | {r.pnl:+9.2f} | {estado:>9} | {ret:+7.1f}% | {dd:+7.1f}%"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--par", default="BTCUSDT")
    ap.add_argument("--banca", type=float, default=110.0)
    ap.add_argument("--margem", type=float, default=15.0)
    ap.add_argument("--alav", type=float, default=100.0)
    ap.add_argument("--taxa", type=float, default=0.05, help="%% por lado")
    ap.add_argument("--mm", type=float, default=0.5, help="margem de manutencao %%")
    ap.add_argument("--stop", type=float, default=0.5, help="stop em %% do preco")
    ap.add_argument("--rr", type=float, default=2.0, help="alvo = stop * rr")
    ap.add_argument("--hedge", action="store_true", help="long e short simultaneos")
    ap.add_argument("--dias", type=int, default=30)
    ap.add_argument("--periodos", default="15m,1h,4h,12h,1d")
    args = ap.parse_args()

    p = Params(banca=args.banca, margem=args.margem, alav=args.alav,
               taxa=args.taxa, mm=args.mm, stop=args.stop, rr=args.rr,
               hedge=args.hedge)

    cabecalho(p, args.par, args.dias)
    print("   per | trades |  acerto | liq | taxa pg |     pnl   |   banca   | retorno |  pior dd")
    print("  " + "-" * 86)

    for tf in [t.strip() for t in args.periodos.split(",") if t.strip()]:
        if tf not in PERIODOS:
            print(f"  {tf:>4} | periodo desconhecido (use: {', '.join(PERIODOS)})")
            continue
        n = max(50, int(args.dias * 24 * 60 / PERIODOS[tf]))
        candles = buscar_candles(args.par, tf, n)
        r = simular(candles, p)
        linha_resultado(tf, r, p)

    print()
    print("  Leitura: 'liq' e quantas operacoes morreram por liquidacao, nao por stop.")
    print("  'taxa pg' e o custo acumulado so de abrir e fechar — compare com o pnl.")
    print("  Regra conservadora: stop e alvo no mesmo candle contam como STOP.")
    print()
    print("  Este script NAO negocia. Nao pede chave, nao acessa conta, nao envia ordem.")


if __name__ == "__main__":
    main()
