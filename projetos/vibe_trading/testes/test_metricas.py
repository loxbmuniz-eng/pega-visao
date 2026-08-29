import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vibe_trading.backtest import comprar_e_segurar
from vibe_trading.metricas import calcular, rebaixamento
from vibe_trading.serie import serie_sintetica


class TesteRebaixamento(unittest.TestCase):
    def test_medido_do_pico_historico_e_nao_do_inicio(self):
        # Sobe para 200 e cai para 100. Do início não perdeu nada; do PICO
        # perdeu metade — e é a metade que a pessoa sente na conta.
        pior, _ = rebaixamento([100, 200, 100])
        self.assertAlmostEqual(pior, -0.5)

    def test_curva_so_de_alta_nao_tem_rebaixamento(self):
        pior, _ = rebaixamento([100, 110, 120])
        self.assertEqual(pior, 0.0)


class TesteMetricas(unittest.TestCase):
    def test_taxa_livre_de_risco_entra_no_sharpe(self):
        # No Brasil isto muda o veredito: render 12% ao ano com o dobro da
        # volatilidade do CDI não é bom, e Sharpe com taxa zero diria que é.
        r = comprar_e_segurar(serie_sintetica(pregoes=500, semente=9))
        com_cdi = calcular(r, taxa_livre_risco=0.10).sharpe
        com_zero = calcular(r, taxa_livre_risco=0.0).sharpe
        self.assertLess(com_cdi, com_zero)

    def test_serie_curta_demais_falha_claro(self):
        class Falsa:
            patrimonio = [100]
            capital_inicial = 100
            negocios = []
            exposicao = []
            custo_total = 0.0
        with self.assertRaisesRegex(ValueError, "2 pontos"):
            calcular(Falsa())

    def test_exposicao_conta_so_barra_posicionada(self):
        r = comprar_e_segurar(serie_sintetica(pregoes=100))
        self.assertEqual(calcular(r).exposicao, 1.0)


if __name__ == "__main__":
    unittest.main()
