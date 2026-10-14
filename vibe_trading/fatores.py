#!/usr/bin/env python3
"""
Fatores de mercado para a ficha de cada operacao (docs/MAPA_DE_FATORES.md).

Cada leitor busca UMA fonte publica, sem chave, e devolve o dado ja convertido,
ou levanta excecao com o motivo. Quem chama (a ficha) mostra "fora do ar" com o
motivo: nunca se poe um valor inventado no lugar de dado que nao veio.

  pionex    especificacao oficial (github.com/pionex-official/pionex-open-api,
            openapi_futures.yaml): a moeda (pedido minimo, passos), a tabela de
            risco (alavancagem maxima e margem de manutencao por faixa de tamanho),
            marca, indice e funding, historico de funding, giro de 24 h.
  binance   futuros (fapi), para conferencia: funding, posicoes abertas, lotacao.
  alternative.me  indice de medo e ganancia (a fonte pede citacao ao exibir).
  deribit   DVOL: a volatilidade que as opcoes de BTC e ETH estao precificando.
  bls       agenda oficial de CPI, emprego (payroll) e PPI, em iCal.
  fed       datas das reunioes do FOMC (tabela abaixo, com a fonte).

Formato dos numeros: funding e margem de manutencao vem como FRACAO (0.0001 =
0,01%), como no exemplo da propria especificacao ("nextFundingRate": "0.0001").
Valor fora da faixa possivel vira erro, nao chute: o `vibe.py fontes` mostra o
dado cru para conferir.
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.request

import backtest as bt

PIONEX = "https://api.pionex.com"
BINANCE_FAPI = "https://fapi.binance.com"
URL_MEDO = "https://api.alternative.me/fng/?limit=2&format=json"
URL_DVOL = ("https://www.deribit.com/api/v2/public/get_volatility_index_data"
            "?currency={moeda}&start_timestamp={ini}&end_timestamp={fim}&resolution=3600")
URL_BLS = "https://www.bls.gov/schedule/news_release/bls.ics"


def _num(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _pedir_texto(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "vibe-trading/1.0 (leitura de agenda publica)"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", errors="replace")


# --------------------------------------------------------------------------- #
# Pionex
# --------------------------------------------------------------------------- #

def _pionex(caminho: str, pedir=None) -> dict:
    bt.ritmo_pionex()
    bruto = (pedir or bt._pedir)(PIONEX + caminho)
    if not isinstance(bruto, dict) or bruto.get("result") is not True:
        motivo = (bruto.get("message") or bruto.get("code")) if isinstance(bruto, dict) else "formato inesperado"
        raise ValueError(f"pionex recusou: {motivo}")
    return bruto.get("data") or {}


def moeda_pionex(par: str, pedir=None) -> dict:
    """Regras da moeda no perpetuo: se esta negociando, pedido minimo e passos."""
    simbolo = bt.simbolo_pionex(par)
    d = _pionex(f"/api/v1/common/symbols?symbols={simbolo}", pedir)
    s = next((x for x in d.get("symbols") or [] if x.get("symbol") == simbolo), None)
    if s is None:
        raise LookupError(f"{simbolo} nao existe na Pionex")
    return {"simbolo": simbolo, "negociando": s.get("status") == "TRADING",
            "minimo_usdt": _num(s.get("minNotional")), "minimo_qtd": _num(s.get("minSizeMarket")),
            "passo_qtd": _num(s.get("baseStep")), "passo_preco": _num(s.get("quoteStep")),
            "taxa_liquidacao": _num(s.get("liquidationFeeRate"))}


def risco_pionex(par: str, pedir=None) -> list[dict]:
    """Faixas de tamanho da posicao: ate quanto (USDT), alavancagem maxima e margem de
    manutencao (fracao). A margem de manutencao tem que ficar abaixo de 1/alavancagem
    maxima (senao a posicao nasceria liquidada): fora disso, o formato nao e o
    esperado e a faixa e recusada."""
    simbolo = bt.simbolo_pionex(par)
    d = _pionex(f"/api/v1/common/riskTable?symbol={simbolo}", pedir)
    e = next((x for x in d.get("symbols") or [] if x.get("symbol") == simbolo), None)
    if e is None or not e.get("rows"):
        raise LookupError(f"{simbolo} sem tabela de risco na Pionex")
    faixas = []
    for r in e["rows"]:
        ate, alav, mm = _num(r.get("notionalLimit")), _num(r.get("maxLeverage")), _num(r.get("maintMarginRatio"))
        if not ate or not alav or mm is None or not 0 < mm < 1 / alav:
            raise ValueError(f"tabela de risco em formato inesperado: {r}")
        faixas.append({"ate_usdt": ate, "alav_max": alav, "mm": mm})
    return sorted(faixas, key=lambda f: f["ate_usdt"])


def faixa_do_tamanho(faixas: list[dict], notional: float) -> dict | None:
    """A faixa de risco em que uma posicao desse tamanho cai (None: maior que todas)."""
    return next((f for f in faixas if notional <= f["ate_usdt"]), None)


def indice_pionex(par: str, pedir=None) -> dict:
    """Marca (o preco que dispara a liquidacao), indice e o proximo funding."""
    simbolo = bt.simbolo_pionex(par)
    d = _pionex(f"/api/v1/market/indexes?symbol={simbolo}", pedir)
    e = next((x for x in d.get("indexes") or [] if x.get("symbol") == simbolo), None)
    if e is None:
        raise LookupError(f"{simbolo} sem indice na Pionex")
    funding = _num(e.get("nextFundingRate"))
    if funding is not None and abs(funding) >= 0.05:
        raise ValueError(f"funding em formato inesperado: {e.get('nextFundingRate')}")
    return {"marca": _num(e.get("markPrice")), "indice": _num(e.get("indexPrice")), "funding": funding,
            "proximo_funding_ms": int(e["nextFundingTime"]) if e.get("nextFundingTime") else None}


def fundings_pionex(par: str, n: int = 30, pedir=None) -> dict:
    """Historico de funding: a media recente e o intervalo entre cobrancas (horas),
    medido nas datas, nao suposto."""
    simbolo = bt.simbolo_pionex(par)
    d = _pionex(f"/api/v1/market/fundingRates?symbol={simbolo}&limit={n}", pedir)
    taxas = sorted(((int(x["fundingTime"]), _num(x.get("fundingRate"))) for x in d.get("rates") or []
                    if x.get("fundingTime") is not None and _num(x.get("fundingRate")) is not None))
    if len(taxas) < 2:
        raise LookupError("historico de funding curto demais")
    if any(abs(r) >= 0.05 for _, r in taxas):
        raise ValueError("funding em formato inesperado no historico")
    passos = sorted(b[0] - a[0] for a, b in zip(taxas, taxas[1:]))
    return {"intervalo_h": passos[len(passos) // 2] / 3_600_000,
            "media": sum(r for _, r in taxas) / len(taxas), "ultima": taxas[-1][1], "n": len(taxas)}


def giro_24h(pedir=None) -> list[dict]:
    """Todos os perpetuos em USDT: variacao, amplitude e volume das ultimas 24 h."""
    d = _pionex("/api/v1/market/tickers?type=PERP", pedir)
    saida = []
    for x in d.get("tickers") or []:
        simbolo = x.get("symbol") or ""
        o, c, h, l, vol = (_num(x.get(k)) for k in ("open", "close", "high", "low", "amount"))
        if not simbolo.endswith("_USDT_PERP") or not o or c is None or h is None or l is None:
            continue
        saida.append({"par": simbolo[:-len("_USDT_PERP")].replace("_", "") + "USDT", "simbolo": simbolo,
                      "preco": c, "variacao_pct": (c / o - 1) * 100, "amplitude_pct": (h - l) / o * 100,
                      "volume_usdt": vol or 0.0})
    return saida


# --------------------------------------------------------------------------- #
# Binance (futuros), para conferencia
# --------------------------------------------------------------------------- #

def funding_binance(par: str, pedir=None) -> dict:
    e = (pedir or bt._pedir)(f"{BINANCE_FAPI}/fapi/v1/premiumIndex?symbol={par}")
    funding = _num(e.get("lastFundingRate"))
    if funding is None or abs(funding) >= 0.05:
        raise ValueError(f"funding da binance em formato inesperado: {e.get('lastFundingRate')}")
    return {"marca": _num(e.get("markPrice")), "funding": funding,
            "proximo_funding_ms": int(e["nextFundingTime"]) if e.get("nextFundingTime") else None}


def posicoes_binance(par: str, pedir=None) -> dict:
    """Valor das posicoes abertas (USDT) agora e a variacao em 24 h, de hora em hora."""
    lista = (pedir or bt._pedir)(f"{BINANCE_FAPI}/futures/data/openInterestHist?symbol={par}&period=1h&limit=25")
    pontos = sorted((int(x["timestamp"]), _num(x.get("sumOpenInterestValue"))) for x in lista or []
                    if _num(x.get("sumOpenInterestValue")))
    if len(pontos) < 2:
        raise LookupError("historico de posicoes abertas curto demais")
    return {"agora_usdt": pontos[-1][1], "var_24h_pct": (pontos[-1][1] / pontos[0][1] - 1) * 100,
            "horas": (pontos[-1][0] - pontos[0][0]) / 3_600_000}


def lotacao_binance(par: str, pedir=None) -> dict:
    """Proporcao de contas compradas nos futuros da Binance (a ultima hora)."""
    lista = (pedir or bt._pedir)(
        f"{BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol={par}&period=1h&limit=1")
    if not lista:
        raise LookupError("sem dado de lotacao")
    x = max(lista, key=lambda y: int(y["timestamp"]))
    compradas = _num(x.get("longAccount"))
    if compradas is None or not 0 <= compradas <= 1:
        raise ValueError(f"lotacao em formato inesperado: {x}")
    return {"compradas_pct": compradas * 100, "razao": _num(x.get("longShortRatio"))}


# --------------------------------------------------------------------------- #
# contexto: medo e ganancia, volatilidade implicita
# --------------------------------------------------------------------------- #

def medo_ganancia(pedir=None) -> dict:
    """Indice de 0 (medo extremo) a 100 (ganancia extrema). Fonte: alternative.me."""
    d = ((pedir or bt._pedir)(URL_MEDO) or {}).get("data") or []
    if not d:
        raise LookupError("medo e ganancia sem dado")
    hoje = d[0]
    valor = int(hoje["value"])
    ontem = int(d[1]["value"]) if len(d) > 1 else None
    return {"valor": valor, "classe": hoje.get("value_classification", ""), "ontem": ontem,
            "fonte": "alternative.me"}


def dvol(par: str, agora_ms: int, pedir=None) -> dict:
    """Volatilidade implicita anualizada (%) das opcoes na Deribit: so BTC e ETH."""
    moeda = par[:-4] if par.endswith("USDT") else par
    if moeda not in ("BTC", "ETH"):
        raise LookupError(f"a Deribit nao tem DVOL de {moeda}")
    url = URL_DVOL.format(moeda=moeda, ini=agora_ms - 2 * 86_400_000, fim=agora_ms)
    dados = (((pedir or bt._pedir)(url) or {}).get("result") or {}).get("data") or []
    pontos = sorted((int(x[0]), float(x[4])) for x in dados if len(x) >= 5)
    if not pontos:
        raise LookupError("DVOL sem dado")
    antes = [v for t, v in pontos if t <= pontos[-1][0] - 86_400_000]
    agora = pontos[-1][1]
    # ao ano -> por dia: divide pela raiz de 365 (o mercado de cripto nao fecha)
    return {"anual_pct": agora, "dia_pct": agora / 365 ** 0.5, "var_24h": agora - antes[-1] if antes else None}


# --------------------------------------------------------------------------- #
# regime macro (FRED): so contexto, com a data de cada dado
# --------------------------------------------------------------------------- #

URL_FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={serie}"
# o que entra na ficha: juros de 10 anos dos EUA, dolar amplo (semanal no FRED) e VIX
SERIES_FRED = {"DGS10": "juros 10 anos EUA", "DTWEXBGS": "dolar amplo", "VIXCLS": "VIX"}


def ler_csv_fred(texto: str) -> list[tuple[str, float]]:
    """CSV do FRED (data, valor) -> [(data, valor)] em ordem. Dia sem dado ('.') fica
    de fora. Cabecalho de qualquer nome na primeira linha."""
    linhas = [l.strip() for l in texto.strip().splitlines() if l.strip()]
    pontos = []
    for l in linhas[1:]:
        partes = l.split(",")
        if len(partes) != 2:
            continue
        try:
            pontos.append((partes[0], float(partes[1])))
        except ValueError:
            continue
    return pontos


def macro_fred(pedir_texto=None, series=None) -> dict:
    """Ultimo valor de cada serie, a data dele e a variacao em 5 observacoes. Serie que
    falha fica de fora com o motivo em 'erros' (as outras seguem)."""
    out: dict = {"series": {}, "erros": {}}
    for serie, nome in (series or SERIES_FRED).items():
        try:
            pontos = ler_csv_fred((pedir_texto or _pedir_texto)(URL_FRED.format(serie=serie)))
            if len(pontos) < 6:
                raise LookupError("historico curto")
            data, valor = pontos[-1]
            out["series"][serie] = {"nome": nome, "data": data, "valor": valor, "var_5": valor - pontos[-6][1]}
        except Exception as e:
            out["erros"][serie] = f"{type(e).__name__}: {str(e)[:100]}"
    if not out["series"]:
        raise LookupError("FRED sem nenhuma serie: " + "; ".join(out["erros"].values()))
    return out


# --------------------------------------------------------------------------- #
# agenda: FOMC (tabela) e BLS (iCal)
# --------------------------------------------------------------------------- #

# Segundo dia de cada reuniao do FOMC; a decisao sai as 14:00 de Nova York.
# Fonte: calendario oficial do Federal Reserve, conferido em 14/10/2026 pela
# pagina do Chicago Fed (2026) e pela MNI (2027, que o Fed marca como provisorio).
# Reuniao extraordinaria nao entra: ela nao e anunciada antes.
FOMC = {
    2026: ["01-28", "03-18", "04-29", "06-17", "07-29", "09-16", "10-28", "12-09"],
    2027: ["01-27", "03-17", "04-28", "06-09", "07-28", "09-15", "10-27", "12-08"],
}
FOMC_ULTIMO_ANO = max(FOMC)

# O que a BLS publica e mexe com o BTC (as 08:30 de Nova York).
EVENTOS_BLS = {
    "Consumer Price Index": "CPI (inflacao ao consumidor, EUA)",
    "Employment Situation": "Payroll (emprego, EUA)",
    "Producer Price Index": "PPI (inflacao ao produtor, EUA)",
}


def _domingo(ano: int, mes: int, n: int) -> int:
    """Dia do n-esimo domingo do mes."""
    primeiro = dt.date(ano, mes, 1)
    return 1 + (6 - primeiro.weekday()) % 7 + 7 * (n - 1)


def nova_york_para_utc_ms(ano: int, mes: int, dia: int, hora: int, minuto: int = 0) -> int:
    """Hora de Nova York -> instante UTC em ms. Horario de verao dos EUA: do 2o
    domingo de marco as 2h ao 1o domingo de novembro as 2h (UTC-4); fora, UTC-5."""
    local = dt.datetime(ano, mes, dia, hora, minuto)
    inicio = dt.datetime(ano, 3, _domingo(ano, 3, 2), 2)
    fim = dt.datetime(ano, 11, _domingo(ano, 11, 1), 2)
    deslocamento = 4 if inicio <= local < fim else 5
    utc = (local + dt.timedelta(hours=deslocamento)).replace(tzinfo=dt.timezone.utc)
    return int(utc.timestamp() * 1000)


def agenda_fomc() -> list[dict]:
    eventos = []
    for ano, datas in FOMC.items():
        for d in datas:
            mes, dia = (int(x) for x in d.split("-"))
            eventos.append({"t_ms": nova_york_para_utc_ms(ano, mes, dia, 14), "nome": "FOMC (decisao de juros, Fed)",
                            "fonte": "tabela FOMC (federalreserve.gov)"})
    return eventos


def _linhas_ics(texto: str) -> list[str]:
    """Desdobra as linhas do iCal (continuacao comeca com espaco ou tab)."""
    linhas: list[str] = []
    for bruta in texto.replace("\r\n", "\n").split("\n"):
        if bruta[:1] in (" ", "\t") and linhas:
            linhas[-1] += bruta[1:]
        else:
            linhas.append(bruta)
    return linhas


def ler_ics_bls(texto: str) -> list[dict]:
    """Os eventos da BLS que importam, em UTC. Hora com fuso de Nova York (TZID
    US-Eastern ou America/New_York) e convertida; 'Z' ja e UTC; dia sem hora ou
    fuso desconhecido fica de fora (nao se chuta horario)."""
    eventos, atual = [], None
    for linha in _linhas_ics(texto):
        if linha == "BEGIN:VEVENT":
            atual = {}
        elif linha == "END:VEVENT" and atual is not None:
            nome = next((rot for chave, rot in EVENTOS_BLS.items() if chave in atual.get("SUMMARY", "")), None)
            t = atual.get("t_ms")
            if nome and t is not None:
                eventos.append({"t_ms": t, "nome": nome, "fonte": "bls.gov (agenda oficial)"})
            atual = None
        elif atual is not None and ":" in linha:
            chave, valor = linha.split(":", 1)
            nome_chave, *params = chave.split(";")
            if nome_chave == "SUMMARY":
                atual["SUMMARY"] = valor
            elif nome_chave == "DTSTART" and len(valor) >= 15 and valor[8] == "T":
                ano, mes, dia = int(valor[0:4]), int(valor[4:6]), int(valor[6:8])
                hora, minuto = int(valor[9:11]), int(valor[11:13])
                if valor.endswith("Z"):
                    atual["t_ms"] = int(dt.datetime(ano, mes, dia, hora, minuto,
                                                    tzinfo=dt.timezone.utc).timestamp() * 1000)
                elif any(p.upper() in ("TZID=US-EASTERN", "TZID=AMERICA/NEW_YORK") for p in params):
                    atual["t_ms"] = nova_york_para_utc_ms(ano, mes, dia, hora, minuto)
    return sorted(eventos, key=lambda e: e["t_ms"])


def agenda_bls(pedir_texto=None) -> list[dict]:
    return ler_ics_bls((pedir_texto or _pedir_texto)(URL_BLS))


def proximos_eventos(eventos: list[dict], agora_ms: int, antes_h: float = 1.0, depois_h: float = 48.0) -> list[dict]:
    """Eventos de `antes_h` horas atras ate `depois_h` horas a frente, em ordem."""
    return sorted((e for e in eventos if agora_ms - antes_h * 3_600_000 <= e["t_ms"] <= agora_ms + depois_h * 3_600_000),
                  key=lambda e: e["t_ms"])


# --------------------------------------------------------------------------- #
# conferencia das fontes (vibe.py fontes)
# --------------------------------------------------------------------------- #

def conferir_fontes(par: str = "BTCUSDT", agora_ms: int | None = None, pedir=None, pedir_texto=None) -> list[tuple]:
    """Chama cada fonte uma vez e devolve (nome, ok, resumo ou erro). Para rodar na
    maquina de quem opera: e o teste de que cada endereco responde de verdade."""
    import time
    agora_ms = agora_ms or int(time.time() * 1000)
    testes = [
        ("pionex: moeda", lambda: moeda_pionex(par, pedir)),
        ("pionex: tabela de risco", lambda: risco_pionex(par, pedir)[:2]),
        ("pionex: marca e funding", lambda: indice_pionex(par, pedir)),
        ("pionex: historico de funding", lambda: fundings_pionex(par, 10, pedir)),
        ("pionex: giro 24h", lambda: f"{len(giro_24h(pedir))} perpetuos"),
        ("binance futuros: funding", lambda: funding_binance(par, pedir)),
        ("binance futuros: posicoes abertas", lambda: posicoes_binance(par, pedir)),
        ("binance futuros: lotacao", lambda: lotacao_binance(par, pedir)),
        ("alternative.me: medo e ganancia", lambda: medo_ganancia(pedir)),
        ("deribit: DVOL", lambda: dvol(par, agora_ms, pedir)),
        ("bls: agenda", lambda: proximos_eventos(agenda_bls(pedir_texto), agora_ms, 0, 24 * 45)[:3]),
        ("fred: juros, dolar e VIX", lambda: macro_fred(pedir_texto)),
    ]
    saida = []
    for nome, chamar in testes:
        try:
            saida.append((nome, True, json.dumps(chamar(), ensure_ascii=False, default=str)[:300]))
        except Exception as e:
            saida.append((nome, False, f"{type(e).__name__}: {str(e)[:200]}"))
    return saida
