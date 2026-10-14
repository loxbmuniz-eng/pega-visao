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
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

import estrategias
import indicadores as ind

# Candles publicos. Nenhum destes endpoints exige chave nem conta.
FONTES = [
    ("binance", "https://api.binance.com/api/v3/klines?symbol={par}&interval={tf}&limit={n}"),
    ("binance-dados", "https://data-api.binance.vision/api/v3/klines?symbol={par}&interval={tf}&limit={n}"),
    ("binance-us", "https://api.binance.us/api/v3/klines?symbol={par}&interval={tf}&limit={n}"),
]

LIMITE_POR_PEDIDO = 1000   # maximo que a Binance devolve por pedido
MIN_CANDLES = 500          # EMA 200 precisa aquecer e ainda sobrar candle para operar


def candles_para(tf: str, dias: int, alinhar: bool = False) -> int:
    """
    Quantos candles pedir: os dias pedidos, nunca menos que MIN_CANDLES.

    Com alinhamento, o periodo mais alto acima precisa de ~260 candles proprios
    para a EMA 200 aquecer: no 4 h isso e 260 dias de candles de 4 h.
    """
    n = max(MIN_CANDLES, int(dias * 24 * 60 / PERIODOS[tf]))
    if alinhar:
        acima = estrategias.ACIMA.get(PERIODOS[tf] * 60_000)
        if acima:
            n = max(n, 260 * (max(acima) // (PERIODOS[tf] * 60_000)))
    return n

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
    t: list[int] = field(default_factory=list)  # abertura do candle, ms
    # Volume de compra AGRESSORA (quem comprou batendo na oferta de venda), quando a
    # fonte informa: a Binance manda no campo 9 de cada kline. Vazio = a fonte nao
    # informa (a Pionex nao informa). Venda agressora = volume - compra agressora.
    agressora: list[float] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.fechamento)


def _pedir(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "backtest/1.0"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode())


class ErroBusca(Exception):
    """Nenhuma fonte devolveu candles. `erros` diz o que cada uma respondeu."""

    def __init__(self, erros: list[str]):
        super().__init__("; ".join(erros))
        self.erros = erros


def buscar(par: str, tf: str, n: int) -> Serie:
    """Como buscar_ou_erro, mas encerra o programa com explicacao se a rede falhar."""
    try:
        return buscar_ou_erro(par, tf, n)
    except ErroBusca as e:
        print("Nao foi possivel buscar candles. Tentativas:", file=sys.stderr)
        for linha in e.erros:
            print(f"  - {linha}", file=sys.stderr)
        print(
            "\nEste script nao precisa de chave de API, mas precisa de internet aberta.\n"
            "Rode na sua maquina local, nao em container ou rede restrita.",
            file=sys.stderr,
        )
        sys.exit(1)


def buscar_ou_erro(par: str, tf: str, n: int) -> Serie:
    """
    Busca os ultimos `n` candles FECHADOS, paginando para tras de 1000 em 1000.

    Descarta o candle ainda em formacao: decidir em cima dele e usar um preco
    que ainda vai mudar. O monitor faz o mesmo, para backtest e tela decidirem
    sobre o mesmo dado.
    """
    erros = []
    for nome, molde in FONTES:
        base = molde.format(par=par, tf=tf, n=LIMITE_POR_PEDIDO)
        juntos: dict[int, list] = {}
        fim_ms = None
        try:
            while len(juntos) < n + 1:
                url = base + (f"&endTime={fim_ms}" if fim_ms is not None else "")
                bruto = _pedir(url)
                if not isinstance(bruto, list) or not bruto:
                    break
                for k in bruto:
                    juntos[int(k[0])] = k
                mais_antigo = min(int(k[0]) for k in bruto)
                if len(bruto) < LIMITE_POR_PEDIDO or (fim_ms is not None and mais_antigo >= fim_ms):
                    break  # acabou o historico
                fim_ms = mais_antigo - 1
        except Exception as e:  # rede, http, json — o motivo vai no relatorio
            if not juntos:
                erros.append(f"{nome}: {type(e).__name__}: {e}")
                continue
            print(f"  aviso: {nome} parou no meio ({type(e).__name__}); usando {len(juntos)} candles",
                  file=sys.stderr)

        if not juntos:
            erros.append(f"{nome}: nenhum candle devolvido")
            continue

        agora_ms = int(time.time() * 1000)
        ordem = [juntos[t] for t in sorted(juntos) if int(juntos[t][6]) <= agora_ms][-n:]
        s = Serie()
        for k in ordem:
            s.t.append(int(k[0]))
            s.abertura.append(float(k[1]))
            s.maxima.append(float(k[2]))
            s.minima.append(float(k[3]))
            s.fechamento.append(float(k[4]))
            s.volume.append(float(k[5]))
            if len(k) > 9:
                s.agressora.append(float(k[9]))
        if len(s.agressora) != len(s):
            s.agressora = []  # nunca meia coluna: ou todos os candles tem, ou nenhum
        return s

    raise ErroBusca(erros)


# Pionex: dados publicos de mercado, sem chave (especificacao oficial em
# github.com/pionex-official/pionex-open-api, openapi_futures.yaml).
# Ate 500 candles por pedido, do mais novo para o mais antigo, e o candle em
# formacao vem junto. Peso 5 por pedido num teto de 10 por segundo por IP:
# passar do teto da 60 s de bloqueio, por isso a pausa entre paginas.
PIONEX_URL = "https://api.pionex.com/api/v1/market/klines?symbol={simbolo}&interval={intervalo}&limit={n}"
PIONEX_INTERVALO = {"15m": "15M", "1h": "60M", "4h": "4H", "12h": "12H", "1d": "1D"}
PIONEX_LIMITE = 500
PIONEX_PAUSA = 0.6  # segundos entre paginas


def simbolo_pionex(par: str) -> str:
    """BTCUSDT -> BTC_USDT_PERP (o perpetuo, que e o que se opera alavancado)."""
    if not par.endswith("USDT") or len(par) <= 4:
        raise ValueError(f"par '{par}' nao segue o formato XXXUSDT")
    return f"{par[:-4]}_USDT_PERP"


def buscar_pionex_ou_erro(par: str, tf: str, n: int) -> Serie:
    """Os ultimos `n` candles FECHADOS do perpetuo na Pionex, paginando para tras."""
    simbolo, intervalo = simbolo_pionex(par), PIONEX_INTERVALO[tf]
    base = PIONEX_URL.format(simbolo=simbolo, intervalo=intervalo, n=PIONEX_LIMITE)
    ms = PERIODOS[tf] * 60_000
    juntos: dict[int, dict] = {}
    fim_ms = None
    try:
        while len(juntos) < n + 1:
            if fim_ms is not None:
                time.sleep(PIONEX_PAUSA)
            bruto = _pedir(base + (f"&endTime={fim_ms}" if fim_ms is not None else ""))
            if not isinstance(bruto, dict) or bruto.get("result") is not True:
                motivo = (bruto.get("message") or bruto.get("code")) if isinstance(bruto, dict) else "formato"
                raise ValueError(f"resposta recusada: {motivo}")
            klines = (bruto.get("data") or {}).get("klines") or []
            if not klines:
                break
            for k in klines:
                juntos[int(k["time"])] = k
            mais_antigo = min(int(k["time"]) for k in klines)
            if len(klines) < PIONEX_LIMITE or (fim_ms is not None and mais_antigo >= fim_ms):
                break  # acabou o historico que a Pionex entrega
            fim_ms = mais_antigo - 1
    except Exception as e:
        if not juntos:
            raise ErroBusca([f"pionex: {type(e).__name__}: {e}"]) from e
        print(f"  aviso: pionex parou no meio ({type(e).__name__}); usando {len(juntos)} candles", file=sys.stderr)
    if not juntos:
        raise ErroBusca(["pionex: nenhum candle devolvido"])

    agora_ms = int(time.time() * 1000)
    s = Serie()
    for t in [t for t in sorted(juntos) if t + ms <= agora_ms][-n:]:  # descarta o candle em formacao
        k = juntos[t]
        s.t.append(t)
        s.abertura.append(float(k["open"]))
        s.maxima.append(float(k["high"]))
        s.minima.append(float(k["low"]))
        s.fechamento.append(float(k["close"]))
        s.volume.append(float(k["volume"]))
    return s


BUSCADORES = {"binance": buscar_ou_erro, "pionex": buscar_pionex_ou_erro}


def divergencia(a: Serie, b: Serie, ultimos: int = 5) -> tuple[float, int]:
    """Maior diferenca de fechamento, em %, entre duas fontes nos ultimos candles que
    as duas tem em comum. Devolve (diferenca_pct, quantos_candles_comparados)."""
    pos_b = {t: i for i, t in enumerate(b.t)}
    comuns = [(i, pos_b[t]) for i, t in enumerate(a.t) if t in pos_b][-ultimos:]
    if not comuns:
        return 0.0, 0
    return max(abs(a.fechamento[i] / b.fechamento[j] - 1) * 100 for i, j in comuns), len(comuns)


def periodo_txt(s: Serie) -> str:
    if not s.t:
        return f"{len(s)} candles"
    fmt = "%d/%m/%Y"
    return (f"{len(s)} candles, de {time.strftime(fmt, time.localtime(s.t[0] / 1000))}"
            f" a {time.strftime(fmt, time.localtime(s.t[-1] / 1000))}")


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
    resultados: list[float] = field(default_factory=list)  # pnl de cada operacao, ja com taxa

    # O placar. Acerto sozinho engana: 80% de acerto com perda grande quebra a
    # conta. Por isso ele sempre aparece com ganho medio, perda media e o
    # resultado por operacao, que e o que diz se ha lucro. Identidade:
    #   por_operacao = acerto * ganho_medio - (1 - acerto) * perda_media
    @property
    def acerto(self) -> float:
        """% de operacoes que terminaram no lucro, depois da taxa."""
        if not self.resultados:
            return 0.0
        return sum(1 for x in self.resultados if x > 0) / len(self.resultados) * 100.0

    @property
    def ganho_medio(self) -> float:
        g = [x for x in self.resultados if x > 0]
        return sum(g) / len(g) if g else 0.0

    @property
    def perda_media(self) -> float:
        """Media das perdas, como numero positivo."""
        l = [-x for x in self.resultados if x <= 0]
        return sum(l) / len(l) if l else 0.0

    @property
    def por_operacao(self) -> float:
        return sum(self.resultados) / len(self.resultados) if self.resultados else 0.0


# --------------------------------------------------------------------------- #
# simulacao
# --------------------------------------------------------------------------- #

@dataclass
class Posicao:
    """Uma posicao aberta: o lado, o preco de entrada e os tres precos que a encerram."""
    direcao: int
    entrada: float
    px_stop: float
    px_alvo: float
    px_liq: float
    liq_antes_do_stop: bool
    barras: int = 0  # candles fechados desde a entrada


def abrir(entrada: float, direcao: int, p: Params) -> Posicao:
    """Abre no preco de fechamento do candle do sinal."""
    d_stop = p.stop / 100.0
    d_alvo = (p.stop * p.rr) / 100.0
    d_liq = p.liq_pct / 100.0
    if direcao > 0:
        return Posicao(direcao, entrada, entrada * (1 - d_stop), entrada * (1 + d_alvo),
                       entrada * (1 - d_liq), d_liq <= d_stop)
    return Posicao(direcao, entrada, entrada * (1 + d_stop), entrada * (1 - d_alvo),
                   entrada * (1 + d_liq), d_liq <= d_stop)


def checar_barra(pos: Posicao, maxima: float, minima: float, p: Params) -> tuple[float, str] | None:
    """
    O que um candle faz com a posicao aberta: (pnl ja com taxa, desfecho), ou
    None se ela segue aberta. E a MESMA regra no backtest e no vigia ao vivo —
    se as duas divergissem, o placar ao vivo nao provaria nada sobre o testado.

    Regra conservadora: se stop e alvo cabem no mesmo candle, conta STOP.
    OHLC nao revela a ordem dentro da barra; supor o alvo inflaria o resultado.
    O erro de modelagem tem que cair contra a estrategia, nunca a favor.
    """
    taxa_total = p.notional * (p.taxa / 100.0) * 2.0
    if pos.direcao > 0:
        bateu_liq, bateu_stop, bateu_alvo = minima <= pos.px_liq, minima <= pos.px_stop, maxima >= pos.px_alvo
    else:
        bateu_liq, bateu_stop, bateu_alvo = maxima >= pos.px_liq, maxima >= pos.px_stop, minima <= pos.px_alvo
    if pos.liq_antes_do_stop and bateu_liq:
        return -p.margem, "liquidado"
    if bateu_stop:
        return -(p.notional * (p.stop / 100.0)) - taxa_total, "stop"
    if bateu_alvo:
        return (p.notional * ((p.stop * p.rr) / 100.0)) - taxa_total, "alvo"
    if bateu_liq:
        return -p.margem, "liquidado"
    return None


def encerrar_no_preco(pos: Posicao, preco: float, p: Params) -> float:
    """Fecha a mercado (posicao que expirou sem bater stop nem alvo)."""
    taxa_total = p.notional * (p.taxa / 100.0) * 2.0
    var = (preco - pos.entrada) / pos.entrada * pos.direcao
    return (p.notional * var) - taxa_total


def _perna(s: Serie, i: int, direcao: int, p: Params) -> tuple[float, str, int]:
    """
    Simula UMA posicao aberta no fechamento do candle i, candle a candle.
    Devolve (pnl ja com taxa, desfecho, indice do candle em que a posicao fechou).
    """
    pos = abrir(s.fechamento[i], direcao, p)
    for j in range(i + 1, min(i + 1 + p.max_barras, len(s))):
        r = checar_barra(pos, s.maxima[j], s.minima[j], p)
        if r is not None:
            return r[0], r[1], j
    j_fim = min(i + p.max_barras, len(s) - 1)
    return encerrar_no_preco(pos, s.fechamento[j_fim], p), "expirou", j_fim


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
        pnl, desfecho, j_saida = _perna(s, i, direcao, p)

        equity += pnl
        r.pnl += pnl
        r.resultados.append(pnl)
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

        # proxima entrada so DEPOIS do candle em que esta fechou.
        # (versao anterior andava 1 candle a partir da ENTRADA e abria posicao
        # nova com a anterior ainda aberta — empilhava risco sem aviso.)
        i = max(j_saida, i) + 1

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
    print(f"  {col1:<12} | sinais | trades | acerto |  por op | liq | "
          f" taxa pg |      pnl  |   banca  | retorno |  pior dd")
    print("  " + "-" * 104)


def tabela_linha(rotulo: str, r: Resultado, p: Params) -> None:
    ret = (r.equity_final - p.banca) / p.banca * 100 if p.banca else 0.0
    dd = (r.equity_min - p.banca) / p.banca * 100 if p.banca else 0.0
    estado = "QUEBROU" if r.quebrou or r.equity_final <= 0 else f"{r.equity_final:8.2f}"
    print(f"  {rotulo:<12} | {r.sinais_vistos:6d} | {r.operacoes:6d} | "
          f"{r.acerto:5.1f}% | {r.por_operacao:+7.2f} | {r.liquidacoes:3d} | {r.taxa_paga:8.2f} | "
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
        n = candles_para(tf, dias)
        s = buscar(par, tf, n)
        ruido = ind.ruido_tipico(s.maxima, s.minima, s.fechamento)
        a = ind.atr(s.maxima, s.minima, s.fechamento, 14)
        validos = [x for x in a if x is not None]
        atr_pct = (validos[-1] / s.fechamento[-1] * 100.0) if validos else 0.0
        ok = "sim" if p.stop > ruido else "NAO — stop dentro do ruido"
        print(f"  {tf:>4} | {ruido:11.3f}% | {atr_pct:7.3f}% | {ok}")
    print("\n  Use o ruido mediano no campo 'ruido tipico' da Banda de Liquidacao.")


# --------------------------------------------------------------------------- #
# robustez — separa vantagem de sorte
# --------------------------------------------------------------------------- #

def fatiar(s: Serie, ini: int, fim: int) -> Serie:
    return Serie(s.abertura[ini:fim], s.maxima[ini:fim], s.minima[ini:fim],
                 s.fechamento[ini:fim], s.volume[ini:fim], s.t[ini:fim], s.agressora[ini:fim])


def cortes_por_ano(s: Serie, minimo: int = 60) -> list[tuple[int, int, str]]:
    """
    Fatias da serie por ano-calendario (UTC): [(inicio, fim, "2021"), ...].

    Cada ano do BTC foi um mercado diferente (a queda de 2018, a alta de 2021, a
    queda de 2022). Janela por ano responde a pergunta certa: a estrategia ganha
    em todo tipo de mercado, ou so num ano de sorte? Ano com menos de `minimo`
    candles (o comeco ou o fim da serie) fica de fora: amostra pequena demais.
    """
    cortes = []
    ini = 0
    for i in range(1, len(s.t) + 1):
        if i == len(s.t) or time.gmtime(s.t[i] / 1000).tm_year != time.gmtime(s.t[ini] / 1000).tm_year:
            if i - ini >= minimo:
                cortes.append((ini, i, str(time.gmtime(s.t[ini] / 1000).tm_year)))
            ini = i
    return cortes


def avaliar_robustez(s: Serie, nome: str, p: Params, janelas: int = 6,
                     sementes: int = 30, lado: str = "ambos", alinhar: bool = False,
                     cortes: list[tuple[int, int, str]] | None = None) -> dict | None:
    """
    Corta a serie em janelas e, em cada uma, compara a estrategia com
    `sementes` moedas sorteadas que entram nos MESMOS candles que ela.

    A pergunta deixa de ser "ganhou?" e passa a ser "ganhou de quantas moedas?".
    Estrategia com vantagem real bate a maioria das moedas na maioria das
    janelas. Estrategia com sorte bate em uma janela e perde nas outras.

    Os sinais sao gerados UMA vez, na serie inteira, e depois fatiados junto com
    os candles — assim indicador longo (EMA 200) nao perde aquecimento em cada
    janela. Isso so e legitimo porque o teste de vazamento prova que o sinal em
    i usa apenas dados ate i.

    Devolve o resultado em dados (None se a serie for curta demais). A
    impressao fica em `robustez`; a bateria usa os dados direto. Uma conta,
    dois chamadores.
    """
    sinais = estrategias.sinais(nome, s, lado, alinhar)
    if cortes is None:
        tam = len(s) // janelas
        if tam < 30:
            return None
        cortes = [(w * tam, (w + 1) * tam, str(w + 1)) for w in range(janelas)]
    if not cortes:
        return None
    janelas = len(cortes)

    linhas = []
    todas = Resultado()
    for ini, fim, rotulo in cortes:
        sub = fatiar(s, ini, fim)
        r = simular(sub, sinais[ini:fim], p)
        todas.resultados.extend(r.resultados)
        ret = (r.equity_final - p.banca) / p.banca * 100
        moedas = []
        for k in range(sementes):
            sorteio = random.Random(1000 + k)
            # controle justo: entra NOS MESMOS candles da estrategia e so sorteia
            # o lado. Assim a comparacao mede a direcao, nao a frequencia —
            # estrategia que opera pouco "ganharia" da moeda so por pagar menos taxa.
            cega = [sorteio.choice((1, -1)) if x else 0 for x in sinais[ini:fim]]
            rm = simular(sub, cega, p)
            moedas.append((rm.equity_final - p.banca) / p.banca * 100)
        moedas.sort()
        linhas.append({
            "janela": rotulo, "operacoes": r.operacoes, "acerto": r.acerto,
            "por_operacao": r.por_operacao, "retorno": ret,
            "moeda_mediana": moedas[len(moedas) // 2],
            "bate": sum(1 for m in moedas if ret > m) / len(moedas) * 100,
        })

    media = sum(l["bate"] for l in linhas) / len(linhas)
    positivas = sum(1 for l in linhas if l["retorno"] > 0)
    if media >= 75 and positivas >= janelas * 2 / 3:
        veredito = "vantagem"
    elif media >= 55:
        veredito = "inconclusivo"
    else:
        veredito = "sem_vantagem"
    return {"linhas": linhas, "placar": todas, "media_bate": media,
            "positivas": positivas, "janelas": janelas, "veredito": veredito}


VEREDITOS = {
    "vantagem": "SINAL DE VANTAGEM. Confirme em outro ativo e outra epoca antes de crer.",
    "inconclusivo": "INCONCLUSIVO. Pouco melhor que sorte; nao justifica dinheiro real.",
    "sem_vantagem": "SEM VANTAGEM. Nao se distingue de jogar moeda.",
}


def robustez(s: Serie, nome: str, p: Params, janelas: int = 6,
             sementes: int = 30, lado: str = "ambos", alinhar: bool = False,
             por_ano: bool = False) -> None:
    """Imprime a avaliacao de robustez (ver avaliar_robustez)."""
    a = avaliar_robustez(s, nome, p, janelas, sementes, lado, alinhar,
                         cortes_por_ano(s) if por_ano else None)
    if a is None:
        print(f"  serie curta demais para {janelas} janelas ({len(s)} candles)")
        return
    print(f"  {'janela':>6} | trades | acerto |  por op | retorno | moeda mediana | bate X% das moedas")
    print("  " + "-" * 84)
    for l in a["linhas"]:
        print(f"  {l['janela']:>6} | {l['operacoes']:6d} | {l['acerto']:5.1f}% | {l['por_operacao']:+7.2f} | "
              f"{l['retorno']:+6.1f}% | {l['moeda_mediana']:+12.1f}% | {l['bate']:5.0f}%")
    t = a["placar"]
    print()
    print(f"  placar das {len(t.resultados)} operacoes: acerto {t.acerto:.1f}%  |  "
          f"ganho medio +{t.ganho_medio:.2f}  |  perda media -{t.perda_media:.2f}  |  "
          f"resultado por operacao {t.por_operacao:+.2f} USDT")
    print(f"  janelas no positivo: {a['positivas']} de {a['janelas']}")
    print(f"  em media, bateu {a['media_bate']:.0f}% das moedas")
    print("  -> " + VEREDITOS[a["veredito"]])


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
    ap.add_argument("--dias", type=int, default=90)
    ap.add_argument("--periodos", default="15m,1h,4h,12h,1d")
    ap.add_argument("--estrategia", default="moeda")
    ap.add_argument("--comparar", action="store_true",
                    help="roda TODAS as estrategias contra o controle")
    ap.add_argument("--ruido", action="store_true",
                    help="mede o ruido real do ativo e sai")
    ap.add_argument("--listar", action="store_true")
    ap.add_argument("--robustez", action="store_true",
                    help="testa a estrategia em varias janelas contra 30 moedas")
    ap.add_argument("--janelas", type=int, default=6)
    ap.add_argument("--por-ano", action="store_true",
                    help="no --robustez, uma janela por ano-calendario em vez de janelas iguais")
    ap.add_argument("--lado", choices=("ambos", "compra", "venda"), default="ambos",
                    help="so long (compra), so short (venda) ou os dois")
    ap.add_argument("--alinhar", action="store_true",
                    help="so entra na direcao dos dois periodos acima")
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
    if args.lado != "ambos" or args.alinhar:
        print(f"  filtros: lado={args.lado}" + ("  +  alinhado aos 2 periodos acima" if args.alinhar else ""))
        print()

    if args.robustez:
        for tf in periodos:
            if tf not in PERIODOS:
                continue
            if args.alinhar and tf == "1d":
                print("  >>> 1d  alinhamento nao se aplica: nao ha periodo acima de 24 h. Pulado.\n")
                continue
            n = candles_para(tf, args.dias, args.alinhar)
            s = buscar(args.par, tf, n)
            print(f"  >>> {tf}  estrategia '{args.estrategia}'  ({periodo_txt(s)})")
            robustez(s, args.estrategia, p, args.janelas, lado=args.lado, alinhar=args.alinhar,
                     por_ano=args.por_ano)
            print()
        return

    if args.comparar:
        for tf in periodos:
            if tf not in PERIODOS:
                print(f"  periodo desconhecido: {tf}")
                continue
            n = candles_para(tf, args.dias, args.alinhar)
            s = buscar(args.par, tf, n)
            ruido = ind.ruido_tipico(s.maxima, s.minima, s.fechamento)
            print(f"  >>> {tf}  ({periodo_txt(s)}, ruido mediano {ruido:.3f}%)")
            if p.stop <= ruido:
                print(f"      ATENCAO: stop de {p.stop:.2f}% esta DENTRO do ruido "
                      f"de {ruido:.3f}% — tudo abaixo e stop por oscilacao normal.")
            tabela_abre("estrategia")
            linhas = []
            for nome in estrategias.REGISTRO:
                r = simular(s, estrategias.sinais(nome, s, args.lado, args.alinhar), p)
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
            n = candles_para(tf, args.dias, args.alinhar)
            s = buscar(args.par, tf, n)
            r = simular(s, estrategias.sinais(args.estrategia, s, args.lado, args.alinhar), p)
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
