"""O teste que sustenta o projeto inteiro: não existe look-ahead."""
import sys, unittest
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vibe_trading.backtest import Backtest, comprar_e_segurar
from vibe_trading.estrategias.base import Estrategia
from vibe_trading.serie import Barra, Serie, serie_sintetica


def _serie(fechamentos, aberturas=None):
    d = date(2024, 1, 1)
    barras = []
    for i, f in enumerate(fechamentos):
        a = aberturas[i] if aberturas else f
        barras.append(Barra(d + timedelta(days=i), a, max(a, f), min(a, f), f, 1000))
    return Serie("TESTE", barras)


class CompraNaBarra(Estrategia):
    """Compra a partir da barra `quando` e segura."""
    nome = "compra fixa"

    def __init__(self, quando):
        self.quando = quando

    def sinal(self, serie, i):
        return 1 if i >= self.quando else 0


class TesteSemLookAhead(unittest.TestCase):
    def test_sinal_da_barra_i_executa_na_abertura_de_i_mais_1(self):
        # Barra 1 fecha em 10. Barra 2 ABRE em 20 (gap) e fecha em 21.
        # Quem decide no fechamento da barra 1 NÃO pode comprar a 10 — na hora
        # em que aquele fechamento existe, o pregão acabou. Tem que pagar 20.
        serie = _serie([10, 10, 21], aberturas=[10, 10, 20])
        r = Backtest(serie, CompraNaBarra(1), capital=1000,
                     corretagem=0.0, deslize_bps=0.0).rodar()
        self.assertEqual(len(r.negocios), 1)
        self.assertAlmostEqual(r.negocios[0].preco_entrada, 20.0,
                               msg="entrou na abertura seguinte, não no fechamento do sinal")

    def test_gap_contra_o_operador_e_absorvido_pelo_resultado(self):
        # Mesmo teste ao contrário: gap para BAIXO e a barra continua caindo.
        # (Abrir em 5 e fechar em 6 seria LUCRO — o primeiro rascunho deste
        # teste errava aqui, não o motor.)
        serie = _serie([10, 10, 4], aberturas=[10, 10, 5])
        r = Backtest(serie, CompraNaBarra(1), capital=1000,
                     corretagem=0.0, deslize_bps=0.0).rodar()
        self.assertAlmostEqual(r.negocios[0].preco_entrada, 5.0)
        self.assertLess(r.patrimonio_final, 1000)


class TesteCustos(unittest.TestCase):
    def test_slippage_sempre_contra_quem_executa(self):
        serie = _serie([10] * 6)
        r = Backtest(serie, CompraNaBarra(1), capital=1000,
                     corretagem=0.0, deslize_bps=100.0).rodar()   # 1%
        n = r.negocios[0]
        self.assertGreater(n.preco_entrada, 10.0, "comprando, paga mais")
        self.assertLess(n.preco_saida, 10.0, "vendendo, recebe menos")

    def test_corretagem_aparece_no_custo_total(self):
        serie = _serie([10] * 6)
        r = Backtest(serie, CompraNaBarra(1), capital=1000,
                     corretagem=0.01, deslize_bps=0.0).rodar()
        self.assertGreater(r.custo_total, 0)
        self.assertLess(r.patrimonio_final, 1000, "preço parado + custo = prejuízo")

    def test_sem_operar_o_patrimonio_nao_muda(self):
        class NuncaOpera(Estrategia):
            nome = "fora"
            def sinal(self, serie, i): return 0
        serie = _serie([10, 20, 5, 30])
        r = Backtest(serie, NuncaOpera(), capital=1000).rodar()
        self.assertEqual(r.patrimonio_final, 1000)
        self.assertEqual(r.negocios, [])


class TesteContrato(unittest.TestCase):
    def test_sinal_invalido_falha_dizendo_o_que_veio(self):
        class Maluca(Estrategia):
            nome = "maluca"
            def sinal(self, serie, i): return 7
        with self.assertRaisesRegex(ValueError, "-1, 0 ou 1"):
            Backtest(_serie([1, 2, 3]), Maluca()).rodar()

    def test_venda_bloqueada_por_padrao(self):
        class SempreVendida(Estrategia):
            nome = "vendida"
            def sinal(self, serie, i): return -1
        r = Backtest(_serie([10] * 5), SempreVendida()).rodar()
        self.assertTrue(all(e == 0 for e in r.exposicao))

    def test_posicao_aberta_no_fim_e_liquidada(self):
        serie = _serie([10, 11, 12, 13])
        r = Backtest(serie, CompraNaBarra(0), capital=1000).rodar()
        self.assertTrue(all(n.preco_saida is not None for n in r.negocios))

    def test_capital_invalido_falha(self):
        with self.assertRaises(ValueError):
            Backtest(_serie([1, 2]), CompraNaBarra(0), capital=0)


class TesteReferencia(unittest.TestCase):
    def test_comprar_e_segurar_acompanha_o_preco(self):
        serie = _serie([10, 12, 20])
        r = comprar_e_segurar(serie, capital=1000)
        self.assertAlmostEqual(r.patrimonio_final, 2000.0)   # 10 -> 20 dobra

    def test_backtest_e_reprodutivel(self):
        s = serie_sintetica(pregoes=200, semente=5)
        a = Backtest(s, CompraNaBarra(10)).rodar().patrimonio_final
        b = Backtest(s, CompraNaBarra(10)).rodar().patrimonio_final
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
