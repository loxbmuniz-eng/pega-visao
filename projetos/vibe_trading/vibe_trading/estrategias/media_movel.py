"""Cruzamento de médias — a mais velha do livro, e a régua de comparação."""
from __future__ import annotations

from ..indicadores import media_exponencial
from .base import Estrategia


class MediaMovel(Estrategia):
    nome = "cruzamento de médias"

    def __init__(self, curta: int = 20, longa: int = 60):
        if curta >= longa:
            raise ValueError("a média curta precisa ser menor que a longa")
        self.curta, self.longa = curta, longa
        self.parametros = {"curta": curta, "longa": longa}

    def iniciar(self, serie) -> None:
        f = serie.fechamentos
        self._curta = media_exponencial(f, self.curta)
        self._longa = media_exponencial(f, self.longa)

    def sinal(self, serie, i: int) -> int:
        c, l = self._curta[i], self._longa[i]
        if c is None or l is None:
            return 0
        return 1 if c > l else 0
