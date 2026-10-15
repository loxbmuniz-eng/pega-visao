#!/usr/bin/env python3
"""
Ficha de cada operacao: a leitura completa de UMA moeda, agora, antes de clicar.

    python3 vibe.py analisar BTC               # risco 2% da banca, intraday
    python3 vibe.py analisar SOL 1 scalp       # risco 1% da banca, scalp
    no Telegram: /analisar BTC 2 swing

O que ela junta (cada numero com a fonte; o que nao veio aparece "fora do ar"):
  1. tendencia pela estrutura (topos e fundos) em tres periodos: o de entrada, o
     de contexto e o maior;
  2. onde o preco esta na faixa do contexto: desconto, premio, zona otima (62-79%);
  3. niveis: topo e fundo de ontem e da semana passada, abertura do dia, VWAP do
     dia, perfil de volume (POC e area de valor), vaos e blocos de ordens ainda
     nao tocados, topo e fundo da estrutura, numero redondo;
  4. o ruido do periodo (ATR) -> stop alem da estrutura e fora do ruido;
  5. alvos nos niveis, com a saida "alvo + surfe" (metade no 1o alvo, stop no
     zero, o resto no 2o);
  6. o tamanho pelo risco escolhido: quanto, com que alavancagem, onde liquida,
     pedido minimo e faixa de risco da Pionex, acerto minimo para empatar;
  7. funding, posicoes abertas, lotacao, livro de ofertas, agenda (FOMC, CPI,
     payroll), medo e ganancia, volatilidade implicita;
  8. as estrategias da bateria que disparam agora e o nivel delas na fase 2;
  9. o veredito: A FAVOR, ESPERAR ou NAO OPERAR, com cada motivo.

As regras da ficha ainda NAO passaram por prova. Por isso toda ficha com plano
fica registrada (dados_vigia/fichas.jsonl) e e conferida depois pela mesma regra
do backtest (backtest.checar_barra: stop e alvo no mesmo candle conta stop). O
placar das fichas mede se "A FAVOR" ganha de "ESPERAR".

Nada aqui envia ordem.
"""

from __future__ import annotations

import bisect
import hashlib
import json
import math
import os
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor

import backtest as bt
import estrategias as est
import fatores
import indicadores as ind
import livro

FICHA_PADRAO = {
    "risco_pct": 2.0,           # % da banca perdida se bater no stop (com taxa e deslize)
    "horizonte": "intraday",
    "alav_max": 50,             # teto proprio, abaixo do da corretora
    "liq_vezes_stop": 2.0,      # a liquidacao fica a pelo menos 2x a distancia do stop
    "margem_max_pct": 30,       # margem acima disso (% da banca): aviso de concentracao
    "deslize_pct": 0.02,        # deslizamento estimado na saida a mercado (% do tamanho)
    "rr_min": 1.5,              # o 1o alvo tem que pagar 1,5x o risco, ja com as taxas
    "funding_extremo": 0.001,   # 0,1% por cobranca: um lado lotado
    "agenda_antes_min": 30,     # nao entrar 30 min antes de anuncio forte...
    "agenda_depois_min": 15,    # ...nem 15 min depois
    "risco_max_pct": 25,        # acima disso a ficha recusa (erro de digitacao?)
}

HORIZONTES = {
    "scalp":    {"entrada": "5m",  "contexto": "15m", "maior": "1h", "horas": 3,
                 "rotulo": "scalp (minutos a 3 horas)"},
    "intraday": {"entrada": "15m", "contexto": "1h",  "maior": "4h", "horas": 24,
                 "rotulo": "intraday (ate 1 dia)"},
    "swing":    {"entrada": "1h",  "contexto": "4h",  "maior": "1d", "horas": 168,
                 "rotulo": "swing (1 dia a 1 semana)"},
}
PERIODOS_FICHA = ("5m", "15m", "1h", "4h", "1d")
CANDLES = 500       # uma pagina da Pionex por periodo
MIN_CANDLES = 60
DIA, HORA = 86_400_000, 3_600_000
CONTROLES = {"moeda", "comprado"}
VEREDITOS = ("A FAVOR", "ESPERAR", "NAO OPERAR")


# --------------------------------------------------------------------------- #
# formato
# --------------------------------------------------------------------------- #

def _br(v: float, casas: int) -> str:
    return f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fmt_preco(p: float | None) -> str:
    """Casas decimais pela grandeza: 62.910,50 / 3,5120 / 0,00001234."""
    if p is None:
        return "?"
    if p <= 0:
        return _br(p, 2)
    return _br(p, max(2, 4 - math.floor(math.log10(p))))


def fmt_usdt(v: float) -> str:
    return ("+" if v > 0 else "") + _br(v, 2)


def pct(v: float, casas: int = 2) -> str:
    return _br(v, casas) + "%"


def vezes(v: float) -> str:
    return _br(v, 2) + "x"


def hora_brasilia(ms: int) -> str:
    """Brasilia e UTC-3 o ano todo (sem horario de verao desde 2019)."""
    import datetime as dt
    t = dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc) - dt.timedelta(hours=3)
    return t.strftime("%d/%m %H:%M")


# --------------------------------------------------------------------------- #
# coleta (rede)
# --------------------------------------------------------------------------- #

def par_de(texto: str) -> str:
    """BTC, btc ou BTCUSDT -> BTCUSDT. So letras e numeros: o nome vai dentro de
    enderecos de internet, e nada alem disso pode passar."""
    t = (texto or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{1,15}", t):
        raise ValueError(f"moeda '{texto}' invalida: use so letras e numeros, como BTC ou SOL")
    return t if t.endswith("USDT") and len(t) > 4 else t + "USDT"


_CACHE_LENTO: dict = {}


def _lento(nome: str, buscar, agora_ms: int, renovar: bool = False):
    """Dado que muda devagar (agenda da BLS, FRED): uma busca a cada 6 horas basta."""
    quando, valor = _CACHE_LENTO.get(nome, (None, None))
    if quando is None or agora_ms - quando > 6 * HORA or renovar:
        valor = buscar()
        _CACHE_LENTO[nome] = (agora_ms, valor)
    return valor


def _agenda_bls(agora_ms: int, pedir_texto=None) -> list[dict]:
    """O iCal oficial; se a BLS recusar, a tabela de datas conferidas (fatores.BLS_TABELA)."""
    def buscar():
        try:
            return fatores.agenda_bls(pedir_texto)
        except Exception:
            return fatores.agenda_bls_tabela()
    return _lento("bls", buscar, agora_ms, pedir_texto is not None)


def coletar(par: str, agora_ms: int, buscar=None, pedir=None, pedir_texto=None, conferir="padrao") -> dict:
    """Busca tudo o que a ficha usa. Cada fonte e isolada: a que falha entra em
    'erros' com o motivo e nao derruba as outras."""
    buscar = buscar or bt.buscar_pionex_ou_erro
    conferir = bt.buscar_ou_erro if conferir == "padrao" else conferir
    d: dict = {"par": par, "agora_ms": agora_ms, "series": {}, "erros": {}}

    def tentar(nome, chamar):
        try:
            d[nome] = chamar()
        except Exception as e:
            d["erros"][nome] = f"{type(e).__name__}: {str(e)[:150]}"

    tentar("moeda", lambda: fatores.moeda_pionex(par, pedir))
    if "nao existe" in d["erros"].get("moeda", ""):
        return d  # moeda que a Pionex nao tem: nao busca mais nada
    # as fontes fora da Pionex vao em paralelo (uma que trava nao segura as outras);
    # os pedidos a Pionex seguem em fila, no ritmo do teto dela
    fora = [("posicoes", lambda: fatores.posicoes_binance(par, pedir)),
            ("lotacao", lambda: fatores.lotacao_binance(par, pedir)),
            ("medo", lambda: fatores.medo_ganancia(pedir)),
            ("agenda_bls", lambda: _agenda_bls(agora_ms, pedir_texto)),
            ("macro", lambda: _lento("fred", lambda: fatores.macro_fred(pedir_texto), agora_ms,
                                     pedir_texto is not None))]
    if conferir:
        fora.append(("binance", lambda: conferir(par, "15m", 100)))
    if par in ("BTCUSDT", "ETHUSDT"):
        fora.append(("dvol", lambda: fatores.dvol(par, agora_ms, pedir)))
    with ThreadPoolExecutor(max_workers=len(fora)) as grupo:
        for nome, chamar in fora:
            grupo.submit(tentar, nome, chamar)
        for tf in PERIODOS_FICHA:
            try:
                d["series"][tf] = buscar(par, tf, CANDLES)
            except Exception as e:
                d["erros"][f"candles {tf}"] = f"{type(e).__name__}: {str(e)[:150]}"
        tentar("risco", lambda: fatores.risco_pionex(par, pedir))
        tentar("indice", lambda: fatores.indice_pionex(par, pedir))
        tentar("fundings", lambda: fatores.fundings_pionex(par, 30, pedir))
        tentar("livro", lambda: livro.resumo(*livro.livro_pionex(par, pedir)))
    return d


# --------------------------------------------------------------------------- #
# leitura de um periodo e niveis
# --------------------------------------------------------------------------- #

def leitura(s: bt.Serie, k: int = 3) -> dict:
    """Tendencia pela estrutura, o ultimo evento (BOS/CHoCH) e ha quantos candles,
    o ultimo topo e fundo confirmados, o ATR 14 e a EMA 200 — no ultimo candle fechado."""
    ev, faixas, tend = est.estrutura_mercado(s, k)
    i = len(s) - 1
    ult = next((j for j in range(i, -1, -1) if ev[j]), None)
    fundo, topo = faixas[i]
    return {"tendencia": tend[i], "evento": ev[ult] if ult is not None else 0,
            "evento_ha": (i - ult) if ult is not None else None, "fundo": fundo, "topo": topo,
            "atr": ind.atr(s.maxima, s.minima, s.fechamento, 14)[i],
            "ema200": ind.ema(s.fechamento, 200)[i], "fechamento": s.fechamento[i], "t": s.t[i]}


def zonas_abertas(s: bt.Serie, ultimos: int = 200) -> list[tuple]:
    """Vaos de valor justo e blocos de ordens dos ultimos candles que o preco AINDA
    NAO tocou: (tipo, direcao, baixo, alto, indice). Mesmas funcoes das estrategias
    fvg e ob (estrategias.fvg_em e estrategias.ob_do_evento)."""
    n = len(s)
    ev, _, _ = est.estrutura_mercado(s)
    zonas = []
    for i in range(max(2, n - ultimos), n):
        for tipo, z in (("vao", est.fvg_em(s, i)), ("bloco", est.ob_do_evento(s, i, ev[i]))):
            if z is None:
                continue
            d, baixo, alto = z
            tocou = any((s.minima[j] <= alto) if d > 0 else (s.maxima[j] >= baixo) for j in range(i + 1, n))
            if not tocou:
                zonas.append((tipo, d, baixo, alto, i))
    return zonas


def passo_redondo(preco: float) -> float:
    """O degrau do 'numero redondo' que o mercado olha: 1.000 no BTC a 60 mil, 100 no
    ETH a 4 mil, 10 no SOL a 200, 0,01 numa moeda de 0,20 (entre 20 e 200 degraus)."""
    return 10 ** math.floor(math.log10(preco / 20))


def extremos_dia_semana(s: bt.Serie, agora_ms: int) -> dict:
    """Topo e fundo de ontem e da semana passada (segunda a domingo, UTC) e a
    abertura de hoje, de candles de qualquer periodo ate 1 dia. A ficha e os
    alertas do vigia usam esta mesma funcao."""
    hoje = agora_ms // DIA
    por_dia: dict[int, list[int]] = {}
    for i, t in enumerate(s.t):
        por_dia.setdefault(t // DIA, []).append(i)
    out = {}
    ontem = por_dia.get(hoje - 1)
    if ontem:
        out["topo de ontem"] = max(s.maxima[i] for i in ontem)
        out["fundo de ontem"] = min(s.minima[i] for i in ontem)
    semana = semana_de(hoje)
    passada = [i for dia, idx in por_dia.items() if semana_de(dia) == semana - 1 for i in idx]
    if passada:
        out["topo da semana passada"] = max(s.maxima[i] for i in passada)
        out["fundo da semana passada"] = min(s.minima[i] for i in passada)
    if hoje in por_dia:
        out["abertura do dia"] = s.abertura[por_dia[hoje][0]]
    return out


def semana_de(dia: int) -> int:
    """Numero da semana de segunda a domingo, em UTC (01/01/1970 foi quinta)."""
    return (dia + 3) // 7


def niveis(series: dict, agora_ms: int, preco: float) -> list[dict]:
    """Os niveis de preco que contam, cada um com o nome do que ele e."""
    out: list[dict] = []

    def add(p, nome):
        if p is not None and p > 0:
            out.append({"preco": p, "nome": nome})

    hoje = agora_ms // DIA
    h = series.get("1h")
    if h is not None and len(h):
        for nome, preco_ in extremos_dia_semana(h, agora_ms).items():
            add(preco_, nome)
        pv = ind.perfil_volume(h.maxima[-168:], h.minima[-168:], h.volume[-168:])
        if pv:
            add(pv["poc"], "POC de 7 dias")
            add(pv["val"], "base da area de valor de 7 dias")
            add(pv["vah"], "topo da area de valor de 7 dias")
    m = series.get("15m")
    if m is not None and len(m):
        ontem = [i for i, t in enumerate(m.t) if t // DIA == hoje - 1]
        if ontem:
            pv = ind.perfil_volume([m.maxima[i] for i in ontem], [m.minima[i] for i in ontem],
                                   [m.volume[i] for i in ontem])
            if pv:
                add(pv["poc"], "POC de ontem")
        if m.t[-1] // DIA == hoje:
            add(ind.vwap_diaria(m.maxima, m.minima, m.fechamento, m.volume, m.t)[-1], "VWAP do dia")
    for tf in ("1h", "4h"):
        s = series.get(tf)
        if s is None or len(s) < MIN_CANDLES:
            continue
        for tipo, d, baixo, alto, _ in zonas_abertas(s)[-6:]:
            nome = "vao" if tipo == "vao" else "bloco de ordens"
            add(alto if d > 0 else baixo, f"{nome} {'de alta' if d > 0 else 'de baixa'} aberto ({tf})")
    passo = passo_redondo(preco)
    abaixo = math.floor(preco / passo) * passo
    add(abaixo, "numero redondo")
    add(abaixo + passo, "numero redondo")
    return out


def fortes_do_horizonte(horizonte: str) -> set:
    """Os niveis que seguram o preco no prazo de cada horizonte: sao os que podem ser
    alvo. Os outros (vaos e blocos de 1 h, topo e fundo do periodo de entrada...)
    aparecem como "no caminho"."""
    ctx = HORIZONTES[horizonte]["contexto"]
    base = {"topo de ontem", "fundo de ontem", "numero redondo", f"topo do {ctx}", f"fundo do {ctx}"}
    if horizonte == "scalp":
        return base | {"VWAP do dia", "POC de ontem", "abertura do dia"}
    semana = {"topo da semana passada", "fundo da semana passada", "POC de 7 dias",
              "base da area de valor de 7 dias", "topo da area de valor de 7 dias"}
    if horizonte == "intraday":
        return base | semana | {"VWAP do dia", "POC de ontem"}
    return base | semana | {"vao de alta aberto (4h)", "vao de baixa aberto (4h)",
                            "bloco de ordens de alta aberto (4h)", "bloco de ordens de baixa aberto (4h)"}


def agrupar(lista: list[dict], tolerancia: float, fortes: set | None = None) -> list[dict]:
    """Niveis a menos de `tolerancia` um do outro viram um so (confluencia), no
    preco medio, com todos os nomes."""
    grupos: list[dict] = []
    for n in sorted(lista, key=lambda x: x["preco"]):
        if grupos and n["preco"] - grupos[-1]["ultimo"] <= tolerancia:
            g = grupos[-1]
            g["precos"].append(n["preco"])
            if n["nome"] not in g["nomes"]:
                g["nomes"].append(n["nome"])
            g["ultimo"] = n["preco"]
        else:
            grupos.append({"precos": [n["preco"]], "nomes": [n["nome"]], "ultimo": n["preco"]})
    return [{"preco": sum(g["precos"]) / len(g["precos"]), "nomes": g["nomes"],
             "forte": any(n in (fortes or set()) for n in g["nomes"])} for g in grupos]


# --------------------------------------------------------------------------- #
# plano
# --------------------------------------------------------------------------- #

def plano(direcao: int, entrada: float, le_entrada: dict, grupos: list[dict], tf: str, cfg: dict,
          taxa: float, banca: float, risco_pct: float, moeda: dict | None, faixas_risco: list | None,
          mm_padrao: float, funding: dict | None, horas: float) -> dict:
    """Stop, alvos, tamanho e projecao em USDT de uma entrada a mercado agora."""
    atr = le_entrada["atr"]
    lado = "fundo" if direcao > 0 else "topo"
    ref = le_entrada["fundo"] if direcao > 0 else le_entrada["topo"]
    if ref is not None and (ref - entrada) * direcao < 0:
        stop = ref - direcao * 0.25 * atr
        origem = f"alem do {lado} do {tf} ({fmt_preco(ref)}), com folga de 1/4 de ATR"
    else:
        stop = entrada - direcao * 1.5 * atr
        origem = f"1,5 ATR do {tf} (nao ha {lado} confirmado do lado certo)"
    if abs(entrada - stop) < atr:
        stop = entrada - direcao * atr
        origem += "; afastado para 1 ATR (mais perto, o ruido normal do candle bate nele)"
    dist_pct = abs(entrada - stop) / entrada * 100

    # alvo so em nivel forte e a pelo menos meio ATR (mais perto e ruido). O alvo fica
    # 1/10 de ATR ANTES do nivel: quem espera sair no nivel enche a fila nele.
    adiante = sorted((g for g in grupos if (g["preco"] - entrada) * direcao > 0.5 * atr),
                     key=lambda g: abs(g["preco"] - entrada))
    alvos = [{"preco": g["preco"] - direcao * 0.1 * atr, "nivel": g["preco"], "nomes": g["nomes"]}
             for g in adiante if g["forte"]][:2]
    if not alvos:
        alvos = [{"preco": entrada + direcao * 2 * abs(entrada - stop), "nivel": None,
                  "nomes": ["sem nivel forte adiante: 2 vezes o risco"]}]
    limite = abs(alvos[0]["preco"] - entrada)
    risco_px = abs(entrada - stop)
    # nivel a menos de 1/10 de ATR da entrada esta no preco, nao no caminho
    caminho = [{"preco": g["preco"], "nomes": g["nomes"], "r": abs(g["preco"] - entrada) / risco_px}
               for g in grupos if not g["forte"] and 0.1 * atr < (g["preco"] - entrada) * direcao < limite]

    custo_pct = dist_pct + 2 * taxa + cfg["deslize_pct"]
    risco_usdt = banca * risco_pct / 100
    tamanho = risco_usdt / (custo_pct / 100)
    faixa = fatores.faixa_do_tamanho(faixas_risco, tamanho) if faixas_risco else None
    mm_pct = faixa["mm"] * 100 if faixa else mm_padrao
    teto = min(cfg["alav_max"], faixa["alav_max"]) if faixa else cfg["alav_max"]
    alav = max(1, math.floor(min(100 / (cfg["liq_vezes_stop"] * dist_pct + mm_pct), teto)))
    qtd = tamanho / entrada
    passo = (moeda or {}).get("passo_qtd")
    if passo:
        qtd = math.floor(qtd / passo + 1e-9) * passo
    tamanho = qtd * entrada
    liq_pct = 100 / alav - mm_pct
    perda = tamanho * custo_pct / 100

    def ganho(px):
        return tamanho * (abs(px - entrada) / entrada * 100 - 2 * taxa) / 100

    g1 = ganho(alvos[0]["preco"])
    g2 = ganho(alvos[1]["preco"]) if len(alvos) > 1 else None
    min_usdt, min_qtd = (moeda or {}).get("minimo_usdt"), (moeda or {}).get("minimo_qtd")
    menor = max(min_usdt or 0.0, (min_qtd or 0.0) * entrada)
    custo_funding = None
    if funding and funding.get("taxa") is not None and funding.get("intervalo_h"):
        # funding positivo: comprado paga, vendido recebe
        custo_funding = -direcao * tamanho * funding["taxa"] * (horas / funding["intervalo_h"])
    return {
        "direcao": direcao, "entrada": entrada, "stop": stop, "stop_origem": origem, "dist_pct": dist_pct,
        "alvos": alvos, "caminho": caminho, "risco_usdt": risco_usdt, "tamanho": tamanho, "qtd": qtd, "alav": alav,
        "margem": tamanho / alav, "liq_pct": liq_pct, "px_liq": entrada * (1 - direcao * liq_pct / 100),
        "liq_vezes": liq_pct / dist_pct if dist_pct else None, "mm_pct": mm_pct,
        "mm_fonte": "tabela de risco da Pionex" if faixa else "padrao do vigia (tabela fora do ar)",
        "perda": perda, "ganho1": g1, "ganho2": g2, "rr1": g1 / perda if perda else 0.0,
        "surfe_melhor": (0.5 * g1 + 0.5 * g2) if g2 is not None else None,
        "surfe_pior": 0.5 * g1 - 0.5 * tamanho * (2 * taxa + cfg["deslize_pct"]) / 100,
        "acerto_min": 100 * perda / (perda + g1) if g1 > 0 else 100.0,
        "abaixo_do_minimo": qtd <= 0 or (min_usdt is not None and tamanho < min_usdt)
                            or (min_qtd is not None and qtd < min_qtd),
        "menor_pedido": menor or None,
        "risco_minimo_pct": (menor * custo_pct / 100 / banca * 100) if menor else None,
        "custo_funding": custo_funding, "horas": horas,
    }


# --------------------------------------------------------------------------- #
# a ficha
# --------------------------------------------------------------------------- #

def nivel_na_fase2(estado: dict | None, nome: str, par: str, tf: str) -> str:
    for tid, tr in ((estado or {}).get("trilhas") or {}).items():
        p = tid.split("|")
        if len(p) == 5 and p[0] == nome and p[3].split("@")[0] == par and p[4] == tf:
            return (tr.get("julgamento") or {}).get("nivel", "em teste")
    return "nao acompanhada pelo vigia"


def gatilhos(s: bt.Serie, tf: str, par: str, estado: dict | None) -> list[dict]:
    """As estrategias da bateria que disparam no ultimo candle fechado (sem os
    controles e sem as que precisam da compra agressora, que a Pionex nao informa)."""
    out = []
    for nome in est.REGISTRO:
        if nome in CONTROLES or nome in est.PRECISA_AGRESSORA:
            continue
        sinal = est.gerar(nome, s)[-1]
        if sinal:
            out.append({"nome": nome, "direcao": sinal, "nivel": nivel_na_fase2(estado, nome, par, tf)})
    return out


def _seta(t: int) -> str:
    return {1: "alta", -1: "baixa"}.get(t, "indefinida")


def analisar(dados: dict, horizonte: str = "intraday", risco_pct: float | None = None, banca: float = 100.0,
             cfg: dict | None = None, taxa: float = 0.05, mm_padrao: float = 0.5, estado: dict | None = None,
             divergencia_max: float = 0.3, bloqueios_externos: list[str] | None = None,
             com_gatilhos: bool = True, risco_fator: float = 1.0, risco_motivo: str = "") -> dict:
    """A ficha, so com calculo (nenhum acesso a rede): recebe o que `coletar` trouxe.
    `bloqueios_externos` (o disjuntor do dia, por exemplo) forcam NAO OPERAR, mas a
    leitura sai inteira. `risco_fator` < 1 (a banca abaixo do pico) reduz o risco pedido
    depois de conferir que o pedido esta dentro do aceito."""
    cfg = {**FICHA_PADRAO, **(cfg or {})}
    risco_pct = cfg["risco_pct"] if risco_pct is None else float(risco_pct)
    H = HORIZONTES[horizonte]
    par, agora = dados["par"], dados["agora_ms"]
    f: dict = {"par": par, "horizonte": horizonte, "rotulo": H["rotulo"], "agora_ms": agora,
               "tf_entrada": H["entrada"], "risco_pct": risco_pct, "banca": banca, "taxa": taxa,
               "bloqueios": [], "esperar": [], "a_favor": [], "avisos": [], "contexto": [],
               "erros": dict(dados.get("erros") or {}), "plano": None, "gatilhos": [], "niveis": []}

    def fim(veredito: str) -> dict:
        f["veredito"] = veredito
        return f

    f["bloqueios"] += list(bloqueios_externos or [])

    if "nao existe" in f["erros"].get("moeda", ""):
        f["bloqueios"].append(f"{par} nao existe como perpetuo na Pionex")
        return fim("NAO OPERAR")
    if not 0 < risco_pct <= cfg["risco_max_pct"]:
        f["bloqueios"].append(f"risco de {risco_pct:g}% fora do aceito (de 0 a {cfg['risco_max_pct']:g}% da banca)")
        return fim("NAO OPERAR")
    if 0 < risco_fator < 1:
        f["risco_pedido"], risco_pct = risco_pct, round(risco_pct * risco_fator, 4)
        f["risco_pct"] = risco_pct
        f["avisos"].insert(0, f"risco reduzido: pediu {f['risco_pedido']:g}%, a ficha usa {risco_pct:g}%"
                              + (f" ({risco_motivo})" if risco_motivo else ""))
    series = dados.get("series") or {}
    faltam = [tf for tf in (H["entrada"], H["contexto"], H["maior"])
              if series.get(tf) is None or len(series[tf]) < MIN_CANDLES]
    if faltam:
        f["bloqueios"].append(f"sem candles suficientes de {', '.join(faltam)}: nao da para ler a estrutura")
        return fim("NAO OPERAR")
    moeda = dados.get("moeda")
    if moeda and not moeda.get("negociando"):
        f["bloqueios"].append(f"{par} nao esta negociando na Pionex agora")
    s_ent = series[H["entrada"]]
    ms_ent = bt.PERIODOS[H["entrada"]] * 60_000
    atraso = agora - (s_ent.t[-1] + ms_ent)
    if atraso > 2 * ms_ent:
        f["bloqueios"].append(f"candles do {H['entrada']} atrasados ({atraso // 60_000} min): dado velho")

    le = {tf: leitura(series[tf]) for tf in (H["entrada"], H["contexto"], H["maior"])}
    ent, ctx, mai = (le[H[k]] for k in ("entrada", "contexto", "maior"))
    if not ent["atr"]:
        f["bloqueios"].append(f"sem ATR do {H['entrada']}: nao da para medir o ruido")
        return fim("NAO OPERAR")
    indice = dados.get("indice") or {}
    preco = indice.get("marca") or ent["fechamento"]
    f["preco"], f["preco_fonte"] = preco, ("marca da Pionex" if indice.get("marca") else
                                          f"ultimo fechamento do {H['entrada']}")
    f["leituras"] = {H[k]: le[H[k]] for k in ("maior", "contexto", "entrada")}

    # conferencia com a Binance (mesmos candles de 15 min)
    if dados.get("binance") is not None and series.get("15m") is not None:
        pct_div, n = bt.divergencia(series["15m"], dados["binance"], 5)
        f["divergencia"] = (pct_div, n)
        if n and pct_div > divergencia_max:
            f["avisos"].append(f"Pionex e Binance diferem {_br(pct_div, 2)}% nos ultimos candles: confira o preco no app")

    # niveis
    lista = niveis(series, agora, preco)
    for tf_n, l in ((H["contexto"], ctx), (H["entrada"], ent)):
        if l["topo"]:
            lista.append({"preco": l["topo"], "nome": f"topo do {tf_n}"})
        if l["fundo"]:
            lista.append({"preco": l["fundo"], "nome": f"fundo do {tf_n}"})
    grupos = agrupar(lista, 0.25 * ent["atr"], fortes_do_horizonte(horizonte))
    f["niveis"] = grupos

    # Ichimoku do contexto: so mostra (a estrategia "ichimoku" e que vai a prova na bateria)
    s_ctx = series[H["contexto"]]
    ich = ind.ichimoku(s_ctx.maxima, s_ctx.minima)
    na, nb = ich["nuvem_a"][-1], ich["nuvem_b"][-1]
    if na is not None and nb is not None:
        baixo, alto = min(na, nb), max(na, nb)
        onde = "acima da" if preco > alto else "abaixo da" if preco < baixo else "dentro da"
        f["contexto"].append(f"Ichimoku do {H['contexto']}: preco {onde} nuvem ({fmt_preco(baixo)} a {fmt_preco(alto)})")

    # agenda
    eventos = fatores.agenda_fomc() + list(dados.get("agenda_bls") or [])
    f["agenda"] = fatores.proximos_eventos(eventos, agora, cfg["agenda_depois_min"] / 60, 48)
    perto = [e for e in f["agenda"]
             if -cfg["agenda_depois_min"] * 60_000 <= e["t_ms"] - agora <= cfg["agenda_antes_min"] * 60_000]
    if "agenda_bls" in f["erros"]:
        f["avisos"].append("agenda de CPI e payroll fora do ar: confira o calendario antes de entrar")
    bls = list(dados.get("agenda_bls") or [])
    if bls and all(e.get("fonte") == fatores.FONTE_TABELA_BLS for e in bls) and agora > fatores.BLS_TABELA_ATE_MS:
        f["avisos"].append("a tabela da agenda da BLS (CPI, payroll) acabou em 15/12/2026: peca a atualizacao e "
                           "confira o calendario antes de entrar")

    # direcao: o contexto e o periodo maior precisam concordar
    direcao = 0
    if ctx["tendencia"] and ctx["tendencia"] == mai["tendencia"]:
        direcao = ctx["tendencia"]
        f["a_favor"].append(f"{H['maior']} e {H['contexto']} em {_seta(direcao)} pela estrutura")
    else:
        f["esperar"].append(f"sem direcao: o {H['maior']} esta em {_seta(mai['tendencia'])} e o "
                            f"{H['contexto']} em {_seta(ctx['tendencia'])}")
        # o que faria os dois concordarem: o periodo que discorda virar
        for d_ in (1, -1):
            gat = [(H[k], le_k["topo"] if d_ > 0 else le_k["fundo"]) for k, le_k in (("maior", mai), ("contexto", ctx))
                   if le_k["tendencia"] != d_]
            if all(px is not None for _, px in gat) and gat:
                f["esperar"].append(("compra so se " if d_ > 0 else "venda so se ") + " e ".join(
                    f"o {tf_} fechar {'acima' if d_ > 0 else 'abaixo'} de {fmt_preco(px)}" for tf_, px in gat))
    if direcao:
        if ent["tendencia"] == direcao:
            f["a_favor"].append(f"{H['entrada']} tambem em {_seta(direcao)}")
        else:
            gat = ent["topo"] if direcao > 0 else ent["fundo"]
            f["esperar"].append(f"o {H['entrada']} ainda esta em {_seta(ent['tendencia'])}: esperar ele "
                                f"{'fechar acima' if direcao > 0 else 'fechar abaixo'} de {fmt_preco(gat)}")
        perna = est.perna_atual(series[H["contexto"]], direcao)
        fundo, topo = perna if perna else (None, None)
        if fundo is not None and topo is not None and topo > fundo:
            pos = (preco - fundo) / (topo - fundo)
            faixa = topo - fundo
            ote = ((topo - 0.79 * faixa, topo - 0.62 * faixa) if direcao > 0
                   else (fundo + 0.62 * faixa, fundo + 0.79 * faixa))
            f["faixa"] = {"fundo": fundo, "topo": topo, "pos": pos, "ote": ote, "tf": H["contexto"]}
            no_lado_certo = 0 <= pos <= 0.5 if direcao > 0 else 0.5 <= pos <= 1
            furou = pos < 0 if direcao > 0 else pos > 1
            if furou:
                # passou da origem do impulso: e mudanca de carater a caminho, nao desconto
                f["esperar"].append(f"o preco passou da origem do impulso do {H['contexto']} "
                                    f"({fmt_preco(fundo if direcao > 0 else topo)}): a estrutura esta em duvida, "
                                    f"esperar ela se definir")
            elif no_lado_certo:
                f["a_favor"].append(f"preco no {'desconto' if direcao > 0 else 'premio'} da perna do "
                                    f"{H['contexto']} ({pos * 100:.0f}%)")
            else:
                f["esperar"].append(f"{'comprando no premio' if direcao > 0 else 'vendendo no desconto'} "
                                    f"({pos * 100:.0f}% da perna do {H['contexto']}): esperar o preco na zona "
                                    f"otima {fmt_preco(ote[0])} a {fmt_preco(ote[1])}")

        funding = None
        fp = dados.get("fundings")
        if indice.get("funding") is not None and fp:
            funding = {"taxa": indice["funding"], "intervalo_h": fp["intervalo_h"]}
        p = plano(direcao, preco, ent, grupos, H["entrada"], cfg, taxa, banca, risco_pct, moeda,
                  dados.get("risco"), mm_padrao, funding, H["horas"])
        f["plano"] = p
        if p["abaixo_do_minimo"]:
            minimo = (f"risco minimo possivel: {p['risco_minimo_pct']:.2f}% da banca"
                      if p["risco_minimo_pct"] else "pedido minimo desconhecido")
            f["bloqueios"].append(f"com risco de {risco_pct:g}% o pedido ({fmt_usdt(p['tamanho'])} USDT) "
                                  f"fica abaixo do minimo da Pionex; {minimo}")
        if not moeda:
            f["avisos"].append("regras da moeda fora do ar: confira o pedido minimo no app")
        if p["rr1"] < cfg["rr_min"]:
            f["esperar"].append(f"espaco curto: o 1o alvo ({fmt_preco(p['alvos'][0]['preco'])}, "
                                f"{p['alvos'][0]['nomes'][0]}) paga {vezes(p['rr1'])} o risco; o minimo e "
                                f"{vezes(cfg['rr_min'])}")
        else:
            f["a_favor"].append(f"o 1o alvo paga {vezes(p['rr1'])} o risco, ja com as taxas")
        if p["margem"] > banca * cfg["margem_max_pct"] / 100:
            f["avisos"].append(f"margem de {_br(p['margem'], 2)} USDT passa de {cfg['margem_max_pct']:g}% "
                               f"da banca: concentra demais")
        if funding and abs(funding["taxa"]) >= cfg["funding_extremo"]:
            lotado = "comprado" if funding["taxa"] > 0 else "vendido"
            f["avisos"].append(f"funding extremo ({pct(funding['taxa'] * 100, 3)} por cobranca): o lado "
                               f"{lotado} esta lotado, risco de varrida contra ele")
        if perto:
            e = perto[0]
            texto = f"{e['nome']} as {hora_brasilia(e['t_ms'])} (Brasilia): spread e deslizamento pioram"
            if horizonte == "swing":
                f["avisos"].append(texto)
            else:
                f["esperar"].append(texto)

    # as estrategias que disparam so mostram (nao mudam o veredito); a bateria da ficha pula
    f["gatilhos"] = gatilhos(s_ent, H["entrada"], par, estado) if com_gatilhos else []
    if not any(g["nivel"] in ("aprovada", "promissora") for g in f["gatilhos"]
               if g["direcao"] == direcao):
        f["avisos"].append("nenhuma estrategia aprovada na fase 2 dispara a favor agora: "
                           "se entrar, e leitura de mesa, nao regra provada")

    _contexto(f, dados)
    if f["bloqueios"]:
        return fim("NAO OPERAR")
    return fim("ESPERAR" if f["esperar"] or not direcao else "A FAVOR")


def _contexto(f: dict, dados: dict) -> None:
    """Linhas de contexto: mostram, nao decidem."""
    c = f["contexto"]
    ind_ = dados.get("indice") or {}
    fp = dados.get("fundings")
    if ind_.get("funding") is not None:
        cada = f" a cada {fp['intervalo_h']:g} h" if fp else ""
        c.append(f"funding Pionex {pct(ind_['funding'] * 100, 4)}{cada}"
                 + (f" (media recente {pct(fp['media'] * 100, 4)})" if fp else ""))
    pos = dados.get("posicoes")
    if pos:
        c.append(f"posicoes abertas na Binance: {_br(pos['agora_usdt'] / 1e6, 1)} mi USDT "
                 f"({'+' if pos['var_24h_pct'] > 0 else ''}{pct(pos['var_24h_pct'], 1)} em {pos['horas']:.0f} h)")
    lot = dados.get("lotacao")
    if lot:
        c.append(f"contas compradas na Binance: {lot['compradas_pct']:.0f}%")
    lv = dados.get("livro")
    if lv:
        d = lv.get("deseq_0.5")
        if d is not None:
            c.append(f"livro Pionex (+-0,5%): {(1 + d) / 2 * 100:.0f}% compra x {(1 - d) / 2 * 100:.0f}% venda, "
                     f"spread {pct(lv['spread_pct'], 4)}")
        if lv.get("spread_pct", 0) > 0.05:
            f["avisos"].append(f"spread largo ({pct(lv['spread_pct'], 3)}): entrada a mercado sai cara")
    medo = dados.get("medo")
    if medo:
        ontem = f", ontem {medo['ontem']}" if medo.get("ontem") is not None else ""
        c.append(f"medo e ganancia: {medo['valor']} ({medo['classe']}){ontem} - fonte alternative.me")
    dv = dados.get("dvol")
    if dv:
        c.append(f"volatilidade implicita (DVOL Deribit): {dv['anual_pct']:.0f}% ao ano, "
                 f"cerca de {pct(dv['dia_pct'], 1)} ao dia")
    for e in (f.get("agenda") or [])[:3]:
        c.append(f"agenda: {e['nome']} em {hora_brasilia(e['t_ms'])} (Brasilia)")
    mac = (dados.get("macro") or {}).get("series") or {}
    if mac:
        partes = []
        for x in mac.values():
            sinal = "+" if x["var_5"] > 0 else ""
            partes.append(f"{x['nome']} {_br(x['valor'], 2)} ({sinal}{_br(x['var_5'], 2)} em 5 dados, ate {x['data']})")
        c.append("macro (FRED): " + " · ".join(partes))


# --------------------------------------------------------------------------- #
# texto
# --------------------------------------------------------------------------- #

FONTES_NOMES = {"moeda": "regras da moeda", "risco": "tabela de risco", "indice": "marca e funding",
                "fundings": "historico de funding", "livro": "livro de ofertas", "binance": "conferencia Binance",
                "posicoes": "posicoes abertas", "lotacao": "lotacao", "medo": "medo e ganancia",
                "dvol": "DVOL", "agenda_bls": "agenda CPI/payroll", "macro": "macro FRED"}


def texto(f: dict, registro: str | None = None) -> str:
    L = [f"FICHA {f['par']} · {f['rotulo']} · {hora_brasilia(f['agora_ms'])} (Brasilia)",
         f"VEREDITO: {f['veredito']}"]
    for m in f["bloqueios"]:
        L.append(f"  x {m}")
    for m in f["esperar"]:
        L.append(f"  - {m}")
    for m in f["a_favor"]:
        L.append(f"  + {m}")
    if "preco" not in f:
        L += [f"! {a}" for a in f["avisos"]]
        fora = [FONTES_NOMES.get(k, k) for k in f["erros"]]
        if fora:
            L.append("FORA DO AR: " + ", ".join(fora))
            motivo = next(iter(f["erros"].values()))
            L.append(f"(primeiro motivo: {motivo[:120]})")
        L.append("Nada aqui e ordem.")
        return "\n".join(L)
    for a in f["avisos"]:
        L.append(f"! {a}")
    L.append("")
    div = f.get("divergencia")
    L.append(f"PRECO {fmt_preco(f['preco'])} ({f['preco_fonte']})"
             + (f" · Binance difere {pct(div[0])}" if div and div[1] else ""))
    partes = []
    for tf, l in f["leituras"].items():
        ev = {1: "BOS alta", 2: "CHoCH alta", -1: "BOS baixa", -2: "CHoCH baixa"}.get(l["evento"])
        partes.append(f"{tf} {_seta(l['tendencia'])}" + (f" ({ev} ha {l['evento_ha']})" if ev else ""))
    L.append("TENDENCIA " + " · ".join(partes))
    fx = f.get("faixa")
    if fx:
        L.append(f"PERNA do {fx['tf']}: fundo {fmt_preco(fx['fundo'])} · topo {fmt_preco(fx['topo'])} · "
                 f"preco em {fx['pos'] * 100:.0f}% · zona otima {fmt_preco(fx['ote'][0])} a {fmt_preco(fx['ote'][1])}")
    preco = f["preco"]
    acima = sorted((g for g in f["niveis"] if g["preco"] > preco), key=lambda g: g["preco"])[:4]
    abaixo = sorted((g for g in f["niveis"] if g["preco"] <= preco), key=lambda g: -g["preco"])[:4]
    L.append("NIVEIS acima: " + ("; ".join(f"{fmt_preco(g['preco'])} {' + '.join(g['nomes'])}" for g in acima) or "nenhum"))
    L.append("NIVEIS abaixo: " + ("; ".join(f"{fmt_preco(g['preco'])} {' + '.join(g['nomes'])}" for g in abaixo) or "nenhum"))
    p = f.get("plano")
    if p:
        lado = "COMPRA" if p["direcao"] > 0 else "VENDA"
        L += ["", f"PLANO {lado} (se entrar a mercado agora)",
              f"entrada {fmt_preco(p['entrada'])} · stop {fmt_preco(p['stop'])} (-{pct(p['dist_pct'])}): {p['stop_origem']}"]
        for k, a in enumerate(p["alvos"], 1):
            L.append(f"alvo {k} {fmt_preco(a['preco'])} ({' + '.join(a['nomes'])})")
        if p["caminho"]:
            L.append("no caminho ate o alvo 1: " + "; ".join(
                f"{fmt_preco(c['preco'])} {' + '.join(c['nomes'])} a {vezes(c['r'])} o risco" for c in p["caminho"][:3]))
        L.append(f"risco {_br(f['risco_pct'], 2).rstrip('0').rstrip(',')}% de {_br(f['banca'], 2)} USDT = "
                 f"{_br(p['risco_usdt'], 2)} USDT")
        L.append(f"tamanho {_br(p['tamanho'], 2)} USDT a {p['alav']}x · margem {_br(p['margem'], 2)} USDT · "
                 f"liquida em {fmt_preco(p['px_liq'])} ({vezes(p['liq_vezes'])} a distancia do stop; "
                 f"manutencao {pct(p['mm_pct'])}, {p['mm_fonte']})")
        L.append(f"no stop {fmt_usdt(-p['perda'])} USDT · no alvo 1 {fmt_usdt(p['ganho1'])} "
                 f"({vezes(p['rr1'])} o risco)"
                 + (f" · alvo + surfe: metade em cada, ate {fmt_usdt(p['surfe_melhor'])}; se voltar ao zero "
                    f"depois do 1o, {fmt_usdt(p['surfe_pior'])}" if p["surfe_melhor"] is not None else ""))
        L.append(f"acerto minimo para empatar: {p['acerto_min']:.0f}% (taxa de {pct(f['taxa'])} por lado e "
                 f"deslize ja nas contas)")
        if p["custo_funding"] is not None:
            if abs(p["custo_funding"]) < 0.01:
                L.append(f"funding em ate {p['horas']:g} h: desprezivel")
            else:
                L.append(f"funding em ate {p['horas']:g} h: {fmt_usdt(p['custo_funding'])} USDT "
                         f"({'recebe' if p['custo_funding'] > 0 else 'paga'})")
    if f["contexto"]:
        L += ["", "CONTEXTO (mostra, nao decide)"] + [f"  {c}" for c in f["contexto"]]
    if f["gatilhos"]:
        L.append("DISPARANDO no " + f["tf_entrada"] + ": " + ", ".join(
            f"{g['nome']} {'compra' if g['direcao'] > 0 else 'venda'} ({g['nivel']})" for g in f["gatilhos"]))
    fora = [FONTES_NOMES.get(k, k) for k in f["erros"]]
    if fora:
        L.append("FORA DO AR: " + ", ".join(fora))
    if registro:
        L.append(f"Ficha {registro} registrada: o placar das fichas confere o desfecho depois.")
    L.append("Nada aqui e ordem: o clique e seu.")
    return "\n".join(L)[:4000]


# --------------------------------------------------------------------------- #
# registro e placar das fichas
# --------------------------------------------------------------------------- #

def registro_de(f: dict) -> dict | None:
    """O que o placar das fichas confere de uma ficha (None: sem plano ou NAO OPERAR).
    O placar ao vivo e a bateria da ficha usam este mesmo registro."""
    p = f.get("plano")
    if not p or f["veredito"] == "NAO OPERAR":
        return None
    codigo = hashlib.sha256(f"{f['par']}|{f['agora_ms']}|{f['horizonte']}".encode()).hexdigest()[:8]
    return {"id": codigo, "quando_ms": f["agora_ms"], "par": f["par"], "horizonte": f["horizonte"],
            "tf": f["tf_entrada"], "veredito": f["veredito"], "direcao": p["direcao"],
            "entrada": p["entrada"], "stop": p["stop"], "alvo": p["alvos"][0]["preco"],
            "rr": round(p["rr1"], 4), "tamanho": round(p["tamanho"], 4), "perda": round(p["perda"], 6),
            "max_barras": int(HORIZONTES[f["horizonte"]]["horas"] * 60 // bt.PERIODOS[f["tf_entrada"]]),
            "risco_pct": f["risco_pct"], "motivos": f["esperar"][:3]}


def registrar(pasta: str, f: dict) -> str | None:
    """Uma linha em fichas.jsonl por ficha com plano. Devolve o codigo da ficha."""
    reg = registro_de(f)
    if reg is None:
        return None
    codigo = reg["id"]
    os.makedirs(pasta, exist_ok=True)
    with open(os.path.join(pasta, "fichas.jsonl"), "a", encoding="utf-8") as arq:
        arq.write(json.dumps(reg, ensure_ascii=False) + "\n")
    return codigo


def desfecho(reg: dict, s: bt.Serie, taxa: float = 0.05) -> dict | None:
    """O que aconteceu com a ficha, candle a candle desde o primeiro candle que ABRIU
    depois dela, pela regra do backtest (stop e alvo no mesmo candle conta stop).
    Resultado em multiplos do risco (R): alvo = o que o plano prometia, stop = -1.
    None: ainda aberta."""
    d = reg["direcao"]
    pos = bt.Posicao(d, reg["entrada"], reg["stop"], reg["alvo"], 0.0 if d > 0 else float("inf"), False)
    primeiro = bisect.bisect_left(s.t, reg["quando_ms"])  # s.t em ordem: o 1o candle que abriu depois
    depois = list(range(primeiro, min(len(s.t), primeiro + reg["max_barras"])))
    for i in depois:
        r = bt.checar_barra(pos, s.maxima[i], s.minima[i], bt.Params())
        if r is not None:
            return {"desfecho": r[1], "r": reg["rr"] if r[1] == "alvo" else -1.0, "fim_ms": s.t[i]}
    if len(depois) >= reg["max_barras"]:
        i = depois[-1]
        var = (s.fechamento[i] - reg["entrada"]) / reg["entrada"] * 100 * d
        pnl = reg["tamanho"] * (var - 2 * taxa) / 100
        return {"desfecho": "expirou", "r": round(pnl / reg["perda"], 4) if reg["perda"] else 0.0, "fim_ms": s.t[i]}
    return None


def ler_fichas(pasta: str) -> list[dict]:
    caminho = os.path.join(pasta, "fichas.jsonl")
    if not os.path.exists(caminho):
        return []
    saida = []
    with open(caminho, encoding="utf-8") as arq:
        for linha in arq:
            try:
                saida.append(json.loads(linha))
            except ValueError:
                continue
    return saida


def conferir_fichas(pasta: str, agora_ms: int, buscar=None, maximo_candles: int = 3000) -> dict:
    """Confere as fichas ainda abertas e grava o desfecho em fichas_placar.json.
    Busca cada par e periodo uma vez so."""
    buscar = buscar or bt.buscar_pionex_ou_erro
    caminho = os.path.join(pasta, "fichas_placar.json")
    try:
        with open(caminho, encoding="utf-8") as arq:
            feitas = json.load(arq)
    except (OSError, ValueError):
        feitas = {}
    abertas = [r for r in ler_fichas(pasta) if r["id"] not in feitas]
    por_serie: dict[tuple, list] = {}
    for r in abertas:
        por_serie.setdefault((r["par"], r["tf"]), []).append(r)
    mudou = False
    for (par, tf), regs in por_serie.items():
        ms = bt.PERIODOS[tf] * 60_000
        n = int((agora_ms - min(r["quando_ms"] for r in regs)) // ms) + 2
        if n > maximo_candles:
            for r in regs:
                if (agora_ms - r["quando_ms"]) // ms + 2 > maximo_candles:
                    feitas[r["id"]] = {"desfecho": "sem dados", "r": None, "fim_ms": None}
                    mudou = True
            n = maximo_candles
        try:
            s = buscar(par, tf, max(n, 2))
        except Exception:
            continue
        for r in regs:
            if r["id"] in feitas:
                continue
            res = desfecho(r, s)
            if res is not None:
                feitas[r["id"]] = res
                mudou = True
    if mudou:
        # temporario unico: o /fichas do Telegram e o resumo das 21 h podem conferir juntos
        os.makedirs(pasta, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=pasta, prefix=".fichas_placar_", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as arq:
            json.dump(feitas, arq)
        os.replace(tmp, caminho)
    return feitas


def placar_fichas(pasta: str, feitas: dict) -> list[dict]:
    """Por veredito: quantas conferidas, acerto, media e soma em R, quantas abertas."""
    fichas = ler_fichas(pasta)
    linhas = []
    for v in VEREDITOS[:2]:
        regs = [r for r in fichas if r["veredito"] == v]
        rs = [feitas[r["id"]]["r"] for r in regs if r["id"] in feitas and feitas[r["id"]]["r"] is not None]
        linhas.append({"veredito": v, "conferidas": len(rs), "abertas": sum(1 for r in regs if r["id"] not in feitas),
                       "acerto": (sum(1 for x in rs if x > 0) / len(rs) * 100) if rs else 0.0,
                       "media_r": (sum(rs) / len(rs)) if rs else 0.0, "soma_r": sum(rs)})
    return linhas


def texto_placar_fichas(linhas: list[dict]) -> str:
    L = ["Placar das fichas (conferidas pela regra do backtest; R = multiplos do risco)"]
    for l in linhas:
        nome = "A FAVOR" if l["veredito"] == "A FAVOR" else "ESPERAR (se tivesse entrado)"
        L.append(f"{nome}: {l['conferidas']} conferidas, {l['abertas']} abertas · acerto {l['acerto']:.0f}% · "
                 f"media {l['media_r']:+.2f} R · soma {l['soma_r']:+.1f} R")
    a = next((l for l in linhas if l["veredito"] == "A FAVOR"), None)
    if a and a["conferidas"] < 100:
        L.append(f"Com {a['conferidas']} fichas A FAVOR conferidas ainda nao ha prova: a meta e 100.")
    return "\n".join(L)


# --------------------------------------------------------------------------- #
# radar: o que mais se mexe agora na Pionex
# --------------------------------------------------------------------------- #

def radar(giro: list[dict], volume_min_usdt: float = 5_000_000, quantos: int = 10) -> list[dict]:
    """Os perpetuos que mais oscilaram em 24 h, so entre os com volume suficiente
    (moeda sem volume tem spread largo e preco que pula)."""
    liquidos = [g for g in giro if g["volume_usdt"] >= volume_min_usdt]
    return sorted(liquidos, key=lambda g: -g["amplitude_pct"])[:quantos]


def texto_radar(lista: list[dict], volume_min_usdt: float) -> str:
    L = [f"Radar Pionex (24 h, volume acima de {_br(volume_min_usdt / 1e6, 0)} mi USDT): mais oscilacao"]
    for g in lista:
        L.append(f"{g['par']}: amplitude {g['amplitude_pct']:.1f}% · variacao {g['variacao_pct']:+.1f}% · "
                 f"volume {_br(g['volume_usdt'] / 1e6, 1)} mi")
    L.append("Para ler uma: /analisar MOEDA [risco%] [scalp|intraday|swing]")
    L.append("Oscilacao alta = alvo rapido E stop rapido: o tamanho cai sozinho pelo risco.")
    return "\n".join(L)


def interpretar_pedido(argumentos: list[str], cfg: dict | None = None) -> dict:
    """'/analisar BTC 2 swing' -> {'par': 'BTCUSDT', 'risco_pct': 2.0, 'horizonte': 'swing'}."""
    cfg = {**FICHA_PADRAO, **(cfg or {})}
    if not argumentos:
        raise ValueError("diga a moeda: /analisar BTC [risco%] [scalp|intraday|swing]")
    pedido = {"par": par_de(argumentos[0]), "risco_pct": float(cfg["risco_pct"]), "horizonte": cfg["horizonte"]}
    for a in argumentos[1:]:
        a = a.strip().lower().rstrip("%").replace(",", ".")
        if a in HORIZONTES:
            pedido["horizonte"] = a
        else:
            try:
                pedido["risco_pct"] = float(a)
            except ValueError:
                raise ValueError(f"nao entendi '{a}': use um numero (risco em %) ou scalp, intraday, swing")
    return pedido
