#!/usr/bin/env python3
"""
Backtest de scalping alavancado em perpetuos — SEM credencial, SEM ordem real.

Puxa candles publicos (nenhuma chave de API) e simula a estrategia: alavancagem,
margem fixa por operacao, stop curto, alvo por multiplo de risco. Reporta por
periodo de candle, com taxa das duas pontas, margem de manutencao e liquidacao
modeladas.

A pergunta que este script responde: a estrategia ganha dinheiro DEPOIS do custo,
ou ela so parece ganhar? E, principalmente: ela bate a moeda jogada ao ar?

Uso:
    python3 backtest.py --listar                   # estrategias disponiveis
    python3 backtest.py --estrategia ema           # testa uma
    python3 backtest.py --comparar                 # testa TODAS contra o controle
    python3 backtest.py --comparar --alav 24 --stop 0.5
    python3 backtest.py --ruido                    # mede o ruido real do ativo

Requer apenas a biblioteca padrao do Python 3.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field

import estrategias
import indicadores as ind

# Candles publicos. Nenhum destes endpoints exige chave nem conta.
FONTES = [
    ("binance", "https://api.binance.com/api/v3/klines?symbol={par}&interval={tf}&limit={n}"),
    ("binance-us", "https://api.binance.us/api/v3/klines?symbol={par}&interval={tf}&limit={n}"),
]

PERIODOS = {"15m": 15, "1h": 60, "4h": 240, "12h": 720, "1d": 1440}


# --------------------------------------------------------------------------- #
# dados
# --------------------------------------------------------------------------- #

@dataclass
class Serie:
    """Candles em colunas. Todas as listas tem o mesmo tamanho."""
    abertura: list[float] = field(default_factory=list)
    maxima: list[float] = field(default_factory=list)
    minima: list[float] = field(default_factory=list)
    fechamento: list[float] = field(default_factory=list)
    volume: list[float] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.fechamento)


def buscar(par: str, tf: str, n: int) -> Serie:
    erros = []
    for nome, molde in FONTES:
        url = molde.format(par=par, tf=tf, n=min(n, 1000))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "backtest/1.0"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                bruto = json.loads(resp.read().decode())
        except Exception as e:  # rede, http, json — o motivo vai no relatorio
            erros.append(f"{nome}: {type(e).__name__}: {e}")
            continue

        if not isinstance(bruto, list) or not bruto:
            erros.append(f"{nome}: nenhum candle devolvido")
            continue

        s = Serie()
        for k in bruto:
            s.abertura.append(float(k[1]))
            s.maxima.append(float(k[2]))
            s.minima.append(float(k[3]))
            s.fechamento.append(float(k[4]))
            s.volume.append(float(k[5]))
        return s

    print("Nao foi possivel buscar candles. Tentativas:", file=sys.stderr)
    for e in erros:
        print(f"  - {e}", file=sys.stderr)
    print(
        "\nEste script nao precisa de chave de API, mas precisa de internet aberta.\n"
        "Rode na sua maquina local, nao em container ou rede restrita.",
        file=sys.stderr,
    )
    sys.exit(1)


# --------------------------------------------------------------------------- #
# parametros e resultado
# --------------------------------------------------------------------------- #

@dataclass
class Params:
    banca: float = 110.0
    margem: float = 15.0
    alav: float = 100.0
    taxa: float = 0.05      # % por lado (taker)
    mm: float = 0.5         # margem de manutencao, %
    stop: float = 0.5       # % do preco
    rr: float = 2.0         # alvo = stop * rr
    max_barras: int = 48    # espera maxima antes de encerrar a mercado

    @property
    def notional(self) -> float:
        return self.margem * self.alav

    @property
    def liq_pct(self) -> float:
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
    sinais_vistos: int = 0

    @property
    def acerto(self) -> float:
        return (self.ganhos / self.operacoes * 100.0) if self.operacoes else 0.0


# --------------------------------------------------------------------------- #
# simulacao
# --------------------------------------------------------------------------- #

def _perna(s: Serie, i: int, direcao: int, p: Params) -> tuple[float, str]:
    """
    Simula UMA posicao aberta no fechamento do candle i.

    Regra conservadora: se stop e alvo cabem no mesmo candle, conta STOP.
    OHLC nao revela a ordem dentro da barra; supor o alvo inflaria o resultado.
    O erro de modelagem tem que cair contra a estrategia, nunca a favor.
    """
    entrada = s.fechamento[i]
    taxa_total = p.notional * (p.taxa / 100.0) * 2.0

    d_stop = p.stop / 100.0
    d_alvo = (p.stop * p.rr) / 100.0
    d_liq = p.liq_pct / 100.0

    if direcao > 0:
        px_stop, px_alvo, px_liq = (entrada * (1 - d_stop),
                                    entrada * (1 + d_alvo),
                                    entrada * (1 - d_liq))
    else:
        px_stop, px_alvo, px_liq = (entrada * (1 + d_stop),
                                    entrada * (1 - d_alvo),
                                    entrada * (1 + d_liq))

    liq_antes_do_stop = d_liq <= d_stop

    for j in range(i + 1, min(i + 1 + p.max_barras, len(s))):
        bateu_liq = (s.minima[j] <= px_liq) if direcao > 0 else (s.maxima[j] >= px_liq)
        bateu_stop = (s.minima[j] <= px_stop) if direcao > 0 else (s.maxima[j] >= px_stop)
        bateu_alvo = (s.maxima[j] >= px_alvo) if direcao > 0 else (s.minima[j] <= px_alvo)

        if liq_antes_do_stop and bateu_liq:
            return -p.margem, "liquidado"
        if bateu_stop:
            return -(p.notional * d_stop) - taxa_total, "stop"
        if bateu_alvo:
            return (p.notional * d_alvo) - taxa_total, "alvo"
        if bateu_liq:
            return -p.margem, "liquidado"

    saida = s.fechamento[min(i + p.max_barras, len(s) - 1)]
    var = (saida - entrada) / entrada * direcao
    return (p.notional * var) - taxa_total, "expirou"


def simular(s: Serie, sinais: list[int], p: Params) -> Resultado:
    """
    Percorre a serie abrindo uma operacao quando o sinal nao e zero.

    Uma posicao de cada vez: depois de abrir no candle i, so considera novo
    sinal apos o desfecho. Operacao sobreposta mascara o risco — duas posicoes
    abertas arriscam o dobro do que o sizing previu.
    """
    r = Resultado()
    equity = p.banca
    r.equity_min = equity
    r.sinais_vistos = sum(1 for x in sinais if x != 0)

    i = 0
    while i < len(s) - 1:
        if sinais[i] == 0:
            i += 1
            continue
        if equity < p.margem:
            r.quebrou = True
            break

        direcao = 1 if sinais[i] > 0 else -1
        pnl, desfecho = _perna(s, i, direcao, p)

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
            r.perdas += 1
        else:
            r.expiradas += 1
            r.ganhos += 1 if pnl > 0 else 0
            r.perdas += 1 if pnl <= 0 else 0

        r.equity_min = min(r.equity_min, equity)
        if equity <= 0:
            r.quebrou = True
            break

        # avanca para depois do desfecho; sem posicao sobreposta
        i += p.max_barras if desfecho == "expirou" else 1

    r.equity_final = max(0.0, equity)
    return r


# --------------------------------------------------------------------------- #
# relatorio
# --------------------------------------------------------------------------- #

def cabecalho(p: Params, par: str, dias: int) -> None:
    print("=" * 78)
    print(f"  BACKTEST — {par}   ~{dias} dias   (dado publico; nenhuma ordem real)")
    print("=" * 78)
    print(f"  banca {p.banca:.2f}   margem/op {p.margem:.2f}   alavancagem {p.alav:.0f}x")
    print(f"  notional {p.notional:.2f} USDT  ({p.notional / p.banca:.1f}x a banca)")
    taxa_rt = p.notional * p.taxa / 100 * 2
    print(f"  taxa {p.taxa:.3f}%/lado -> {taxa_rt:.2f} USDT ida e volta "
          f"({taxa_rt / p.margem * 100:.1f}% da margem)")
    print(f"  stop {p.stop:.2f}%   alvo {p.stop * p.rr:.2f}% ({p.rr:.1f}:1)", end="")
    print(f"   liquidacao {p.liq_pct:.2f}%", end="")
    if p.liq_pct <= p.stop:
        print("  <-- ANTES DO STOP: o stop nao executa")
    else:
        print(f"  (folga {p.liq_pct - p.stop:.2f}%)")
    print()


def tabela_abre(col1: str) -> None:
    print(f"  {col1:<12} | sinais | trades | acerto | liq | "
          f" taxa pg |      pnl  |   banca  | retorno |  pior dd")
    print("  " + "-" * 94)


def tabela_linha(rotulo: str, r: Resultado, p: Params) -> None:
    ret = (r.equity_final - p.banca) / p.banca * 100 if p.banca else 0.0
    dd = (r.equity_min - p.banca) / p.banca * 100 if p.banca else 0.0
    estado = "QUEBROU" if r.quebrou or r.equity_final <= 0 else f"{r.equity_final:8.2f}"
    print(f"  {rotulo:<12} | {r.sinais_vistos:6d} | {r.operacoes:6d} | "
          f"{r.acerto:5.1f}% | {r.liquidacoes:3d} | {r.taxa_paga:8.2f} | "
          f"{r.pnl:+9.2f} | {estado:>8} | {ret:+6.1f}% | {dd:+7.1f}%")


def medir_ruido(par: str, dias: int, periodos: list[str], p: Params) -> None:
    print("=" * 78)
    print(f"  RUIDO REAL — {par}   ~{dias} dias")
    print("=" * 78)
    print("  O stop so e executavel se for MAIOR que o ruido do periodo.")
    print(f"  Seu stop atual: {p.stop:.2f}%\n")
    print(f"  {'per':>4} | ruido mediano | ATR em % | stop executavel?")
    print("  " + "-" * 56)
    for tf in periodos:
        if tf not in PERIODOS:
            continue
        n = max(60, int(dias * 24 * 60 / PERIODOS[tf]))
        s = buscar(par, tf, n)
        ruido = ind.ruido_tipico(s.maxima, s.minima, s.fechamento)
        a = ind.atr(s.maxima, s.minima, s.fechamento, 14)
        validos = [x for x in a if x is not None]
        atr_pct = (validos[-1] / s.fechamento[-1] * 100.0) if validos else 0.0
        ok = "sim" if p.stop > ruido else "NAO — stop dentro do ruido"
        print(f"  {tf:>4} | {ruido:11.3f}% | {atr_pct:7.3f}% | {ok}")
    print("\n  Use o ruido mediano no campo 'ruido tipico' da Banda de Liquidacao.")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--par", default="BTCUSDT")
    ap.add_argument("--banca", type=float, default=110.0)
    ap.add_argument("--margem", type=float, default=15.0)
    ap.add_argument("--alav", type=float, default=100.0)
    ap.add_argument("--taxa", type=float, default=0.05, help="%% por lado")
    ap.add_argument("--mm", type=float, default=0.5, help="margem de manutencao %%")
    ap.add_argument("--stop", type=float, default=0.5, help="stop em %% do preco")
    ap.add_argument("--rr", type=float, default=2.0, help="alvo = stop * rr")
    ap.add_argument("--dias", type=int, default=30)
    ap.add_argument("--periodos", default="15m,1h,4h,12h,1d")
    ap.add_argument("--estrategia", default="moeda")
    ap.add_argument("--comparar", action="store_true",
                    help="roda TODAS as estrategias contra o controle")
    ap.add_argument("--ruido", action="store_true",
                    help="mede o ruido real do ativo e sai")
    ap.add_argument("--listar", action="store_true")
    args = ap.parse_args()

    if args.listar:
        print("Estrategias disponiveis:\n")
        print(estrategias.listar())
        return

    p = Params(banca=args.banca, margem=args.margem, alav=args.alav, taxa=args.taxa,
               mm=args.mm, stop=args.stop, rr=args.rr)
    periodos = [t.strip() for t in args.periodos.split(",") if t.strip()]

    if args.ruido:
        medir_ruido(args.par, args.dias, periodos, p)
        return

    cabecalho(p, args.par, args.dias)

    if args.comparar:
        for tf in periodos:
            if tf not in PERIODOS:
                print(f"  periodo desconhecido: {tf}")
                continue
            n = max(60, int(args.dias * 24 * 60 / PERIODOS[tf]))
            s = buscar(args.par, tf, n)
            ruido = ind.ruido_tipico(s.maxima, s.minima, s.fechamento)
            print(f"  >>> {tf}  ({len(s)} candles, ruido mediano {ruido:.3f}%)")
            if p.stop <= ruido:
                print(f"      ATENCAO: stop de {p.stop:.2f}% esta DENTRO do ruido "
                      f"de {ruido:.3f}% — tudo abaixo e stop por oscilacao normal.")
            tabela_abre("estrategia")
            linhas = []
            for nome in estrategias.REGISTRO:
                r = simular(s, estrategias.gerar(nome, s), p)
                linhas.append((nome, r))
                tabela_linha(nome, r, p)

            ctrl = dict(linhas).get("moeda")
            if ctrl:
                venceram = [n_ for n_, r in linhas
                            if n_ not in ("moeda", "comprado")
                            and r.equity_final > ctrl.equity_final]
                print(f"      controle 'moeda' terminou em {ctrl.equity_final:.2f}. "
                      f"Bateram o controle: {', '.join(venceram) if venceram else 'NENHUMA'}")
            print()
    else:
        tabela_abre("periodo")
        for tf in periodos:
            if tf not in PERIODOS:
                print(f"  {tf:<12} | periodo desconhecido")
                continue
            n = max(60, int(args.dias * 24 * 60 / PERIODOS[tf]))
            s = buscar(args.par, tf, n)
            r = simular(s, estrategias.gerar(args.estrategia, s), p)
            tabela_linha(tf, r, p)
        print(f"\n  estrategia: {args.estrategia} — "
              f"{estrategias.REGISTRO[args.estrategia][1]}")

    print()
    print("  'liq' = operacoes mortas por liquidacao, nao por stop.")
    print("  'taxa pg' = custo acumulado so de abrir e fechar. Compare com o pnl.")
    print("  Regra conservadora: stop e alvo no mesmo candle contam como STOP.")
    print()
    print("  Uma estrategia que nao bate 'moeda' por margem folgada nao tem")
    print("  vantagem — tem sorte na amostra. Teste em varias janelas antes de crer.")
    print()
    print("  Este script NAO negocia: nao pede chave, nao acessa conta, nao envia ordem.")


if __name__ == "__main__":
    main()
