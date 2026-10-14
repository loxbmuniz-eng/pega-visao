#!/usr/bin/env python3
"""
Livro de ofertas: o que o Bookmap desenha, lido direto das fontes publicas.

O Bookmap nao tem API aberta de dados: ele le o livro das corretoras. Aqui o
vigia le o mesmo livro, de tres lugares, sem chave:
  pionex       o perpetuo onde se opera (BTC_USDT_PERP)
  binance      o maior livro de BTC/USDT
  hyperliquid  o livro publico da Hyperliquid (BTC perpetuo)

E SO GRAVACAO. A cada candle fechado, uma linha em dados_vigia/livro.jsonl com
o desequilibrio entre compra e venda perto do preco. Nenhuma estrategia usa
isso para operar: nao existe historico gratuito do livro, entao nao da para
testar no passado. Primeiro junta-se o dado; depois mede-se se ele antecipa
alguma coisa; so entao, se medir que sim, vira filtro.

desequilibrio = (compra - venda) / (compra + venda), em quantidade, dentro da
faixa: +1 = so ha ordem de compra perto do preco, -1 = so de venda.
"""

from __future__ import annotations

import json
import os
import urllib.request

import backtest as bt

FAIXAS = (0.1, 0.5)  # % do preco medio, para cada lado

URL_PIONEX = "https://api.pionex.com/api/v1/market/depth?symbol={simbolo}&limit=500"
URL_BINANCE = "https://api.binance.com/api/v3/depth?symbol={par}&limit=1000"
URL_HYPERLIQUID = "https://api.hyperliquid.xyz/info"


def resumo(compras: list[tuple[float, float]], vendas: list[tuple[float, float]], faixas=FAIXAS) -> dict:
    """Desequilibrio e profundidade (em USDT) dentro de cada faixa em volta do preco medio."""
    compras = sorted(((p, q) for p, q in compras if q > 0), reverse=True)
    vendas = sorted((p, q) for p, q in vendas if q > 0)
    if not compras or not vendas:
        raise ValueError("livro vazio de um dos lados")
    melhor_c, melhor_v = compras[0][0], vendas[0][0]
    if melhor_c >= melhor_v:
        raise ValueError(f"livro cruzado: compra {melhor_c} >= venda {melhor_v}")
    medio = (melhor_c + melhor_v) / 2
    out = {"medio": round(medio, 6), "spread_pct": round((melhor_v - melhor_c) / medio * 100, 5)}
    for f in faixas:
        c = sum(q for p, q in compras if p >= medio * (1 - f / 100))
        v = sum(q for p, q in vendas if p <= medio * (1 + f / 100))
        out[f"deseq_{f:g}"] = round((c - v) / (c + v), 4) if c + v else None
        out[f"usdt_{f:g}"] = round((c + v) * medio, 2)
    # ate onde o livro devolvido alcanca: faixa maior que isso fica subestimada
    out["alcance_pct"] = round(min(medio - compras[-1][0], vendas[-1][0] - medio) / medio * 100, 4)
    return out


def _pares(lista) -> list[tuple[float, float]]:
    return [(float(p), float(q)) for p, q, *_ in lista]


def livro_pionex(par: str, pedir=None) -> tuple[list, list]:
    bt.ritmo_pionex()
    bruto = (pedir or bt._pedir)(URL_PIONEX.format(simbolo=bt.simbolo_pionex(par)))
    if not isinstance(bruto, dict) or bruto.get("result") is not True:
        raise ValueError("pionex recusou o pedido do livro")
    d = bruto.get("data") or {}
    return _pares(d.get("bids") or []), _pares(d.get("asks") or [])


def livro_binance(par: str, pedir=None) -> tuple[list, list]:
    bruto = (pedir or bt._pedir)(URL_BINANCE.format(par=par))
    return _pares(bruto.get("bids") or []), _pares(bruto.get("asks") or [])


def _post_json(url: str, corpo: dict):
    req = urllib.request.Request(url, data=json.dumps(corpo).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "vigia/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def livro_hyperliquid(par: str, postar=None) -> tuple[list, list]:
    """A Hyperliquid devolve dois lados sem dizer qual e qual: o lado de preco
    mais baixo e o de compra."""
    moeda = par[:-4] if par.endswith("USDT") else par
    bruto = (postar or _post_json)(URL_HYPERLIQUID, {"type": "l2Book", "coin": moeda})
    lados = [[(float(n["px"]), float(n["sz"])) for n in lado] for lado in (bruto.get("levels") or [])]
    if len(lados) != 2 or not lados[0] or not lados[1]:
        raise ValueError("hyperliquid devolveu livro incompleto")
    a, b = lados
    return (a, b) if max(p for p, _ in a) < min(p for p, _ in b) else (b, a)


FONTES_LIVRO = {"pionex": livro_pionex, "binance": livro_binance, "hyperliquid": livro_hyperliquid}


def gravar(pasta: str, ativo: str, t_candle: int, agora_ms: int, fontes=None, registrar=print) -> dict:
    """Le o livro de cada fonte e grava UMA linha em livro.jsonl. Fonte que falhar
    entra com o erro, sem derrubar as outras nem o vigia."""
    linha = {"t": t_candle, "lido_em": agora_ms, "ativo": ativo}
    for nome, ler in (fontes or FONTES_LIVRO).items():
        try:
            compras, vendas = ler(ativo)
            linha[nome] = resumo(compras, vendas)
        except Exception as e:
            linha[nome] = {"erro": f"{type(e).__name__}: {str(e)[:120]}"}
    os.makedirs(pasta, exist_ok=True)
    with open(os.path.join(pasta, "livro.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(linha, ensure_ascii=False) + "\n")
    falhas = [n for n, v in linha.items() if isinstance(v, dict) and "erro" in v]
    if falhas:
        registrar(f"livro de ofertas: sem leitura de {', '.join(falhas)} neste candle")
    return linha
