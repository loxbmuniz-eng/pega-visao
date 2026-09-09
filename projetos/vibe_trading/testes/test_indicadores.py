import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vibe_trading.indicadores import (
    media_simples, media_exponencial, ifr, maxima_movel, minima_movel, desvio_padrao,
)


class TesteIndicadores(unittest.TestCase):
    def test_media_simples_valores_conhecidos(self):
        self.assertEqual(media_simples([1, 2, 3, 4], 2), [None, 1.5, 2.5, 3.5])

    def test_periodo_incompleto_vira_none_e_nao_zero(self):
        # Zero é valor válido de indicador. Preencher o começo com zero faz a
        # estratégia operar num período em que ela não sabia de nada.
        saida = media_simples([5, 5, 5], 3)
        self.assertIsNone(saida[0])
        self.assertIsNone(saida[1])
        self.assertEqual(saida[2], 5)

    def test_saida_tem_o_mesmo_tamanho_da_entrada(self):
        v = list(range(1, 31))
        for f, p in ((media_simples, 5), (media_exponencial, 5), (ifr, 14),
                     (maxima_movel, 3), (minima_movel, 3), (desvio_padrao, 4)):
            self.assertEqual(len(f(v, p)), len(v), f.__name__)

    def test_ifr_satura_em_100_quando_so_sobe(self):
        self.assertEqual(ifr(list(range(1, 30)), 14)[-1], 100.0)

    def test_ifr_fica_baixo_quando_so_cai(self):
        self.assertLess(ifr(list(range(30, 1, -1)), 14)[-1], 1.0)

    def test_serie_curta_nao_estoura(self):
        self.assertEqual(ifr([1, 2], 14), [None, None])
        self.assertEqual(media_exponencial([1, 2], 14), [None, None])

    def test_periodo_invalido_falha(self):
        with self.assertRaises(ValueError):
            media_simples([1, 2, 3], 0)


if __name__ == "__main__":
    unittest.main()
