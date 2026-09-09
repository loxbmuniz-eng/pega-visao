"""Contrato de uma estratégia.

A assinatura de `sinal` é o que protege o backtest: ela recebe a série INTEIRA
e o índice da barra atual, e a regra é olhar apenas até `i`. O motor executa o
que ela decidir na abertura da barra seguinte.
"""
from __future__ import annotations


class Estrategia:
    nome = "sem nome"
    parametros: dict = {}

    def iniciar(self, serie) -> None:
        """Pré-cálculo de indicadores. Chamado uma vez, antes do laço."""

    def sinal(self, serie, i: int) -> int:
        """-1 vendido, 0 fora, +1 comprado. Olhe apenas até serie[i]."""
        raise NotImplementedError

    def __repr__(self) -> str:
        if not self.parametros:
            return self.nome
        args = ", ".join(f"{k}={v}" for k, v in self.parametros.items())
        return f"{self.nome}({args})"
