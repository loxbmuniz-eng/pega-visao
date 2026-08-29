"""Rompimento de máxima (canal de Donchian).

Compra quando o fechamento supera a máxima dos últimos N pregões; sai quando
perde a mínima dos últimos M. Assimétrico de propósito: a saída é mais curta
que a entrada, senão devolve o lucro inteiro em cada correção.
"""
from __future__ import annotations

from ..indicadores import maxima_movel, minima_movel
from .base import Estrategia


class Rompimento(Estrategia):
    nome = "rompimento de canal"

    def __init__(self, entrada: int = 55, saida: int = 20):
        self.entrada, self.saida = entrada, saida
        self.parametros = {"entrada": entrada, "saida": saida}

    def iniciar(self, serie) -> None:
        f = serie.fechamentos
        # Deslocado em 1: o canal precisa ser o de ONTEM. Comparar o fechamento
        # de hoje com um canal que já inclui o fechamento de hoje é comparar o
        # número consigo mesmo — nunca rompe, ou rompe sempre.
        self._teto = [None] + maxima_movel(f, self.entrada)[:-1]
        self._piso = [None] + minima_movel(f, self.saida)[:-1]
        self._posicao = 0

    def sinal(self, serie, i: int) -> int:
        fech = serie[i].fechamento
        teto, piso = self._teto[i], self._piso[i]
        if teto is not None and fech > teto:
            self._posicao = 1
        elif piso is not None and fech < piso:
            self._posicao = 0
        return self._posicao
