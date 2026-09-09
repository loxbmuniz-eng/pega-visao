"""Série de preços: carregar de CSV ou gerar uma sintética reprodutível."""
from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

# Nomes que as corretoras e sites brasileiros e gringos usam para a mesma coisa.
APELIDOS = {
    "data": {"data", "date", "datetime", "dt", "day", "pregao"},
    "abertura": {"abertura", "open", "abre", "preco_abertura"},
    "maxima": {"maxima", "máxima", "high", "max"},
    "minima": {"minima", "mínima", "low", "min"},
    "fechamento": {"fechamento", "close", "fecha", "preco_fechamento", "adj close", "adj_close"},
    "volume": {"volume", "vol", "quantidade", "qtd"},
}


@dataclass(frozen=True)
class Barra:
    data: date
    abertura: float
    maxima: float
    minima: float
    fechamento: float
    volume: float = 0.0


class Serie:
    """Uma sequência de barras, em ordem crescente de data."""

    def __init__(self, papel: str, barras: list[Barra]):
        if len(barras) < 2:
            raise ValueError(f"{papel}: série precisa de pelo menos 2 barras, veio com {len(barras)}")
        ordenadas = sorted(barras, key=lambda b: b.data)
        if any(a.data == b.data for a, b in zip(ordenadas, ordenadas[1:])):
            raise ValueError(f"{papel}: há datas repetidas na série")
        self.papel = papel
        self.barras = ordenadas

    def __len__(self) -> int:
        return len(self.barras)

    def __getitem__(self, i):
        return self.barras[i]

    @property
    def fechamentos(self) -> list[float]:
        return [b.fechamento for b in self.barras]

    def fatia(self, inicio: date | None = None, fim: date | None = None) -> "Serie":
        sel = [b for b in self.barras if (inicio is None or b.data >= inicio) and (fim is None or b.data <= fim)]
        return Serie(self.papel, sel)

    def dividir(self, fracao: float) -> tuple["Serie", "Serie"]:
        """Corta em duas: treino e validação.

        Existe para conter o pecado original do backtest — ajustar parâmetro
        até o gráfico ficar bonito e chamar isso de estratégia. Se o resultado
        cai fora do treino, o que você tinha era memória, não sinal.
        """
        if not 0 < fracao < 1:
            raise ValueError("fracao precisa estar entre 0 e 1")
        corte = int(len(self.barras) * fracao)
        return Serie(self.papel, self.barras[:corte]), Serie(self.papel, self.barras[corte:])


def _mapear_colunas(cabecalho: list[str]) -> dict[str, int]:
    achado: dict[str, int] = {}
    for i, nome in enumerate(cabecalho):
        limpo = nome.strip().lower().lstrip("﻿")
        for campo, nomes in APELIDOS.items():
            if limpo in nomes and campo not in achado:
                achado[campo] = i
    faltando = {"data", "fechamento"} - achado.keys()
    if faltando:
        raise ValueError(
            f"faltam colunas no CSV: {', '.join(sorted(faltando))}. "
            f"Cabeçalho lido: {cabecalho}"
        )
    return achado


def _numero(texto: str) -> float:
    """Aceita 1.234,56 (Brasil) e 1234.56 (padrão internacional)."""
    t = texto.strip().replace("R$", "").replace("%", "").strip()
    if not t:
        return float("nan")
    if "," in t and "." in t:
        t = t.replace(".", "").replace(",", ".") if t.rfind(",") > t.rfind(".") else t.replace(",", "")
    elif "," in t:
        t = t.replace(",", ".")
    return float(t)


def _data(texto: str) -> date:
    t = texto.strip()[:10]
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            from datetime import datetime
            return datetime.strptime(t, formato).date()
        except ValueError:
            continue
    raise ValueError(f"data em formato desconhecido: {texto!r}")


def carregar_csv(caminho: str | Path, papel: str | None = None) -> Serie:
    caminho = Path(caminho)
    with caminho.open(encoding="utf-8-sig", newline="") as f:
        amostra = f.read(4096)
        f.seek(0)
        sep = ";" if amostra.count(";") > amostra.count(",") else ","
        leitor = csv.reader(f, delimiter=sep)
        cabecalho = next(leitor)
        col = _mapear_colunas(cabecalho)
        barras = []
        for n, linha in enumerate(leitor, start=2):
            if not any(c.strip() for c in linha):
                continue
            try:
                fech = _numero(linha[col["fechamento"]])
                barras.append(Barra(
                    data=_data(linha[col["data"]]),
                    abertura=_numero(linha[col["abertura"]]) if "abertura" in col else fech,
                    maxima=_numero(linha[col["maxima"]]) if "maxima" in col else fech,
                    minima=_numero(linha[col["minima"]]) if "minima" in col else fech,
                    fechamento=fech,
                    volume=_numero(linha[col["volume"]]) if "volume" in col else 0.0,
                ))
            except (ValueError, IndexError) as erro:
                raise ValueError(f"{caminho.name} linha {n}: {erro}") from erro
    return Serie(papel or caminho.stem.upper(), barras)


def serie_sintetica(
    papel: str = "TESTE", pregoes: int = 500, preco_inicial: float = 30.0,
    deriva_anual: float = 0.08, vol_anual: float = 0.28, semente: int = 42,
    inicio: date | None = None,
) -> Serie:
    """Série determinística por semente — para teste e demonstração.

    É dado FALSO e está aqui nomeado como tal. Serve para exercitar o motor
    sem depender de rede nem de uma assinatura de dados; não serve para
    concluir nada sobre estratégia nenhuma.
    """
    rnd = random.Random(semente)
    dt = 1 / 252
    mu, sigma = deriva_anual, vol_anual
    dia = inicio or date(2023, 1, 2)
    preco = preco_inicial
    barras = []
    while len(barras) < pregoes:
        if dia.weekday() < 5:  # só dia útil
            choque = rnd.gauss(0, 1)
            preco = preco * math.exp((mu - 0.5 * sigma**2) * dt + sigma * math.sqrt(dt) * choque)
            abertura = preco * (1 + rnd.gauss(0, 0.002))
            maxima = max(abertura, preco) * (1 + abs(rnd.gauss(0, 0.004)))
            minima = min(abertura, preco) * (1 - abs(rnd.gauss(0, 0.004)))
            barras.append(Barra(dia, round(abertura, 2), round(maxima, 2), round(minima, 2),
                                round(preco, 2), float(rnd.randint(1_000_000, 9_000_000))))
        dia += timedelta(days=1)
    return Serie(papel, barras)
