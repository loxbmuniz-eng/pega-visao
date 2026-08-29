"""Motor de backtest.

A decisão de projeto que sustenta o resto: **o sinal da barra i é executado na
abertura da barra i+1**. Não há como uma estratégia enxergar o fechamento do
dia em que ela decide.

POR QUE isso é o coração e não um detalhe: quase todo backtest caseiro compra
no fechamento do mesmo dia em que o sinal apareceu. A curva fica linda e é
impossível de repetir com dinheiro, porque na hora em que o fechamento existe
o pregão acabou. Aqui a defesa é estrutural — a estratégia recebe uma fatia
que TERMINA na barra i, então não existe o fechamento de i+1 para ela olhar.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .serie import Serie


@dataclass(frozen=True)
class Negocio:
    entrada: date
    saida: date | None
    preco_entrada: float
    preco_saida: float | None
    posicao: int              # +1 comprado, -1 vendido
    quantidade: float
    resultado: float = 0.0    # em dinheiro, já com custo
    retorno: float = 0.0      # fração sobre o capital empregado


@dataclass
class Resultado:
    papel: str
    estrategia: str
    datas: list[date]
    patrimonio: list[float]
    negocios: list[Negocio]
    capital_inicial: float
    exposicao: list[int] = field(default_factory=list)
    custo_total: float = 0.0

    @property
    def patrimonio_final(self) -> float:
        return self.patrimonio[-1] if self.patrimonio else self.capital_inicial


class Backtest:
    def __init__(
        self,
        serie: Serie,
        estrategia,
        capital: float = 10_000.0,
        corretagem: float = 0.0005,     # 0,05% por ordem
        deslize_bps: float = 5.0,       # 5 pontos-base de slippage por ordem
        permitir_venda: bool = False,
    ):
        if capital <= 0:
            raise ValueError("capital precisa ser positivo")
        self.serie = serie
        self.estrategia = estrategia
        self.capital = capital
        self.corretagem = corretagem
        self.deslize = deslize_bps / 10_000
        self.permitir_venda = permitir_venda

    def _preco_execucao(self, preco: float, lado: int) -> float:
        """Slippage sempre CONTRA quem executa — comprando paga mais, vendendo
        recebe menos. Modelar a favor é como o backtest mente."""
        return preco * (1 + self.deslize * lado)

    def rodar(self) -> Resultado:
        barras = self.serie.barras
        caixa = self.capital
        posicao = 0            # -1, 0, +1
        quantidade = 0.0
        preco_entrada = 0.0
        data_entrada = None
        custo_acumulado = 0.0

        patrimonio: list[float] = []
        datas: list[date] = []
        exposicao: list[int] = []
        negocios: list[Negocio] = []

        self.estrategia.iniciar(self.serie)
        alvo_pendente = 0

        for i, barra in enumerate(barras):
            # 1) Executa na ABERTURA o que foi decidido no fechamento anterior.
            if alvo_pendente != posicao:
                preco_ordem = barra.abertura

                if posicao != 0:                       # fecha o que está aberto
                    p = self._preco_execucao(preco_ordem, -posicao)
                    bruto = (p - preco_entrada) * quantidade * posicao
                    custo = abs(p * quantidade) * self.corretagem
                    custo_acumulado += custo
                    caixa += bruto - custo
                    empregado = abs(preco_entrada * quantidade)
                    negocios.append(Negocio(
                        entrada=data_entrada, saida=barra.data,
                        preco_entrada=preco_entrada, preco_saida=p,
                        posicao=posicao, quantidade=quantidade,
                        resultado=bruto - custo,
                        retorno=(bruto - custo) / empregado if empregado else 0.0,
                    ))
                    posicao, quantidade, preco_entrada, data_entrada = 0, 0.0, 0.0, None

                if alvo_pendente != 0:                 # abre a nova
                    p = self._preco_execucao(preco_ordem, alvo_pendente)
                    quantidade = caixa / p if p > 0 else 0.0
                    custo = abs(p * quantidade) * self.corretagem
                    custo_acumulado += custo
                    caixa -= custo
                    posicao, preco_entrada, data_entrada = alvo_pendente, p, barra.data

            # 2) Marca a mercado no fechamento.
            if posicao == 0:
                valor = caixa
            else:
                valor = caixa + (barra.fechamento - preco_entrada) * quantidade * posicao
            patrimonio.append(valor)
            datas.append(barra.data)
            exposicao.append(posicao)

            # 3) Decide para a PRÓXIMA barra, vendo só até i.
            alvo = self.estrategia.sinal(self.serie, i)
            if alvo not in (-1, 0, 1):
                raise ValueError(f"{self.estrategia.nome}: sinal precisa ser -1, 0 ou 1; veio {alvo!r}")
            if alvo == -1 and not self.permitir_venda:
                alvo = 0
            alvo_pendente = alvo

        # Posição aberta no fim é liquidada no último fechamento, senão o
        # resultado do backtest depende de o pregão ter acabado ou não.
        if posicao != 0:
            ultima = barras[-1]
            p = self._preco_execucao(ultima.fechamento, -posicao)
            bruto = (p - preco_entrada) * quantidade * posicao
            custo = abs(p * quantidade) * self.corretagem
            custo_acumulado += custo
            caixa += bruto - custo
            empregado = abs(preco_entrada * quantidade)
            negocios.append(Negocio(
                entrada=data_entrada, saida=ultima.data,
                preco_entrada=preco_entrada, preco_saida=p,
                posicao=posicao, quantidade=quantidade,
                resultado=bruto - custo,
                retorno=(bruto - custo) / empregado if empregado else 0.0,
            ))
            patrimonio[-1] = caixa

        return Resultado(
            papel=self.serie.papel, estrategia=self.estrategia.nome,
            datas=datas, patrimonio=patrimonio, negocios=negocios,
            capital_inicial=self.capital, exposicao=exposicao,
            custo_total=custo_acumulado,
        )


def comprar_e_segurar(serie: Serie, capital: float = 10_000.0) -> Resultado:
    """A régua honesta. Estratégia que não bate isto não justifica o trabalho
    nem o risco — e a maioria não bate."""
    p0 = serie[0].abertura
    qtd = capital / p0
    patrimonio = [b.fechamento * qtd for b in serie.barras]
    return Resultado(
        papel=serie.papel, estrategia="comprar e segurar",
        datas=[b.data for b in serie.barras], patrimonio=patrimonio,
        negocios=[Negocio(serie[0].data, serie[-1].data, p0, serie[-1].fechamento, 1, qtd,
                          patrimonio[-1] - capital, (patrimonio[-1] - capital) / capital)],
        capital_inicial=capital, exposicao=[1] * len(serie),
    )
