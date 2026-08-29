"""Leitura do export de anúncios, com mapeamento de colunas.

Cada plataforma nomeia a mesma coisa de um jeito, e cada idioma de outro. Em
vez de exigir que você renomeie as colunas antes de usar, o mapa aceita os
nomes que realmente saem do Google Ads e do Meta Ads, em português e inglês.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path

APELIDOS = {
    "campanha": {"campanha", "campaign", "campaign name", "nome da campanha", "nome_da_campanha"},
    "conjunto": {"conjunto de anúncios", "conjunto", "ad set name", "ad set", "grupo de anúncios",
                 "ad group", "grupo de anuncios", "conjunto de anuncios"},
    "anuncio": {"anúncio", "anuncio", "ad name", "ad", "nome do anúncio", "criativo", "creative"},
    "gasto": {"gasto", "valor gasto (brl)", "amount spent", "amount spent (brl)", "cost", "custo",
              "spend", "investimento", "valor usado"},
    "impressoes": {"impressões", "impressoes", "impressions", "impr.", "impr"},
    "cliques": {"cliques", "clicks", "cliques no link", "link clicks", "cliques (todos)"},
    "conversoes": {"conversões", "conversoes", "conversions", "resultados", "results",
                   "compras", "purchases", "leads"},
    "receita": {"receita", "revenue", "valor de conversão", "conversion value", "purchase value",
                "valor de conversão da compra", "conv. value"},
    "alcance": {"alcance", "reach"},
}

# Colunas sem as quais não dá para auditar nada.
OBRIGATORIAS = {"gasto"}


@dataclass
class Linha:
    campanha: str
    conjunto: str
    anuncio: str
    gasto: float
    impressoes: float
    cliques: float
    conversoes: float
    receita: float

    @property
    def ctr(self) -> float | None:
        return self.cliques / self.impressoes if self.impressoes else None

    @property
    def cpc(self) -> float | None:
        return self.gasto / self.cliques if self.cliques else None

    @property
    def cpm(self) -> float | None:
        return self.gasto / self.impressoes * 1000 if self.impressoes else None

    @property
    def cpa(self) -> float | None:
        return self.gasto / self.conversoes if self.conversoes else None

    @property
    def roas(self) -> float | None:
        return self.receita / self.gasto if self.gasto else None

    @property
    def taxa_conversao(self) -> float | None:
        return self.conversoes / self.cliques if self.cliques else None

    def rotulo(self) -> str:
        partes = [p for p in (self.campanha, self.conjunto, self.anuncio) if p]
        return " › ".join(partes) or "(sem nome)"


def detectar_decimal(celulas) -> str:
    """Descobre a convenção decimal olhando as CÉLULAS já separadas.

    POR QUE isto não pode ser heurística por valor: "1.500" é 1,5 em inglês e
    1500 em português. Num relatório de verba, errar isso é errar por mil
    vezes — e o número sai plausível nas duas leituras.

    POR QUE olhar célula e não o texto cru: num CSV separado por vírgula, a
    vírgula de coluna é idêntica a uma vírgula decimal. "X,150.00,4000,90,7"
    contém ",90," e o texto cru parecia português — lendo 150.00 como 15000.
    Depois de separar as colunas a ambiguidade desaparece.

    Regra: se alguma célula tem vírgula seguida de exatamente duas casas
    (1.234,56 · 0,75), o decimal é a vírgula. Senão, é o ponto.
    """
    if isinstance(celulas, str):
        celulas = [celulas]
    padrao = re.compile(r"\d,\d{2}(?!\d)")
    return "," if any(padrao.search(str(c)) for c in celulas) else "."


def numero(texto: str, decimal: str = ",") -> float:
    """Aceita 'R$ 1.234,56', '1,234.56', '12%', '—', vazio."""
    if texto is None:
        return 0.0
    t = str(texto).strip()
    if not t or t in {"-", "--", "—", "N/A", "n/a", "‐"}:
        return 0.0
    t = re.sub(r"[R$\s%A-Za-z]", "", t).strip()
    if not t or t in {"-", ".", ","}:
        return 0.0
    negativo = t.startswith("-")
    t = t.lstrip("-")
    if decimal == ",":
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", "")
    try:
        v = float(t)
    except ValueError:
        return 0.0
    return -v if negativo else v


def _mapear(cabecalho: list[str]) -> dict[str, int]:
    achado: dict[str, int] = {}
    for i, nome in enumerate(cabecalho):
        limpo = nome.strip().lower().lstrip("﻿")
        for campo, nomes in APELIDOS.items():
            if campo in achado:
                continue
            if limpo in nomes or any(limpo.startswith(n) for n in nomes):
                achado[campo] = i
    return achado


def ler(caminho: str | Path) -> tuple[list[Linha], dict[str, int], list[str]]:
    """Devolve (linhas, colunas encontradas, colunas do arquivo)."""
    caminho = Path(caminho)
    bruto = caminho.read_text(encoding="utf-8-sig", errors="replace")

    # Export do Google Ads costuma vir com 2 linhas de título antes do
    # cabeçalho. Pular às cegas quebraria outros arquivos, então procuramos a
    # primeira linha que realmente parece um cabeçalho.
    linhas_texto = bruto.splitlines()
    sep = ";" if bruto.count(";") > bruto.count(",") else ","
    inicio = 0
    for i, linha in enumerate(linhas_texto[:10]):
        if _mapear(next(csv.reader([linha], delimiter=sep), [])):
            inicio = i
            break

    leitor = csv.reader(io.StringIO("\n".join(linhas_texto[inicio:])), delimiter=sep)
    cabecalho = next(leitor, [])
    col = _mapear(cabecalho)
    faltando = OBRIGATORIAS - col.keys()
    if faltando:
        raise ValueError(
            f"não achei a coluna de {', '.join(sorted(faltando))} em {caminho.name}.\n"
            f"    Cabeçalho lido: {cabecalho}\n"
            f"    Renomeie a coluna de gasto para 'gasto' (ou 'Amount spent', 'Cost')."
        )

    def campo(linha, chave, padrao=""):
        i = col.get(chave)
        return linha[i] if i is not None and i < len(linha) else padrao

    brutas = [b for b in leitor if any(c.strip() for c in b)]
    # Convenção decimal medida nas células numéricas já separadas.
    numericas = [campo(b, chave) for b in brutas
                 for chave in ("gasto", "impressoes", "cliques", "conversoes", "receita")]
    decimal = detectar_decimal(numericas)

    linhas: list[Linha] = []
    for bruta in brutas:
        if not any(c.strip() for c in bruta):
            continue
        # Rodapé de total do Google Ads ("Total: conta") não é uma campanha.
        primeiro = (bruta[0] or "").strip().lower()
        if primeiro.startswith("total"):
            continue
        linhas.append(Linha(
            campanha=campo(bruta, "campanha").strip(),
            conjunto=campo(bruta, "conjunto").strip(),
            anuncio=campo(bruta, "anuncio").strip(),
            gasto=numero(campo(bruta, "gasto"), decimal),
            impressoes=numero(campo(bruta, "impressoes"), decimal),
            cliques=numero(campo(bruta, "cliques"), decimal),
            conversoes=numero(campo(bruta, "conversoes"), decimal),
            receita=numero(campo(bruta, "receita"), decimal),
        ))
    if not linhas:
        raise ValueError(f"{caminho.name} não tem nenhuma linha de dados.")
    return linhas, col, cabecalho
