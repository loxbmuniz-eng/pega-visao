"""Reversão à média por IFR, com filtro de tendência.

O filtro é o que separa isto de "comprar tudo que cai": só compra sobrevenda
QUANDO o papel está acima da média longa. Sem o filtro, a estratégia compra a
cada degrau de uma queda estrutural — e essa é a forma mais comum de zerar
uma conta com reversão à média.
"""
from __future__ import annotations

from ..indicadores import ifr, media_exponencial
from .base import Estrategia


class Reversao(Estrategia):
    nome = "reversão por IFR"

    def __init__(self, periodo: int = 14, compra: float = 30.0, venda: float = 55.0, filtro: int = 200):
        self.periodo, self.compra, self.venda, self.filtro = periodo, compra, venda, filtro
        self.parametros = {"periodo": periodo, "compra": compra, "venda": venda, "filtro": filtro}

    def iniciar(self, serie) -> None:
        f = serie.fechamentos
        self._ifr = ifr(f, self.periodo)
        self._tendencia = media_exponencial(f, self.filtro) if self.filtro else [0.0] * len(f)
        self._posicao = 0

    def sinal(self, serie, i: int) -> int:
        v = self._ifr[i]
        if v is None:
            return 0
        acima = True
        if self.filtro:
            m = self._tendencia[i]
            if m is None:
                return 0
            acima = serie[i].fechamento > m
        if self._posicao == 0 and v < self.compra and acima:
            self._posicao = 1
        elif self._posicao == 1 and v > self.venda:
            self._posicao = 0
        return self._posicao
