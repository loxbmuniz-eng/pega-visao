import sys, unittest, tempfile
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vibe_trading.serie import Serie, Barra, carregar_csv, serie_sintetica


class TesteCarregarCsv(unittest.TestCase):
    def _arquivo(self, texto):
        f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8")
        f.write(texto); f.close()
        return f.name

    def test_aceita_cabecalho_em_ingles(self):
        s = carregar_csv(self._arquivo("Date,Open,High,Low,Close\n2024-01-02,10,11,9,10.5\n2024-01-03,10.5,12,10,11.8\n"))
        self.assertEqual(len(s), 2)
        self.assertEqual(s[0].fechamento, 10.5)

    def test_aceita_numero_brasileiro_e_data_brasileira(self):
        s = carregar_csv(self._arquivo("data;abertura;maxima;minima;fechamento\n02/01/2024;1.234,50;1.300,00;1.200,00;1.280,75\n03/01/2024;1.280,75;1.350,00;1.270,00;1.340,00\n"))
        self.assertEqual(s[0].fechamento, 1280.75)
        self.assertEqual(s[0].data, date(2024, 1, 2))

    def test_coluna_faltando_falha_dizendo_qual(self):
        with self.assertRaisesRegex(ValueError, "fechamento"):
            carregar_csv(self._arquivo("data,abertura\n2024-01-02,10\n"))

    def test_linha_ruim_aponta_o_numero_da_linha(self):
        with self.assertRaisesRegex(ValueError, "linha 3"):
            carregar_csv(self._arquivo("data,fechamento\n2024-01-02,10\n2024-01-03,abc\n"))


class TesteSerie(unittest.TestCase):
    def test_recusa_datas_repetidas(self):
        b = [Barra(date(2024, 1, 2), 1, 1, 1, 1), Barra(date(2024, 1, 2), 1, 1, 1, 1)]
        with self.assertRaisesRegex(ValueError, "repetidas"):
            Serie("X", b)

    def test_ordena_por_data(self):
        b = [Barra(date(2024, 1, 3), 1, 1, 1, 2), Barra(date(2024, 1, 2), 1, 1, 1, 1)]
        self.assertEqual(Serie("X", b)[0].fechamento, 1)

    def test_dividir_nao_perde_nem_duplica_barra(self):
        s = serie_sintetica(pregoes=100)
        t, v = s.dividir(0.7)
        self.assertEqual(len(t) + len(v), len(s))
        self.assertLess(t[-1].data, v[0].data)

    def test_sintetica_e_reprodutivel_pela_semente(self):
        a = serie_sintetica(pregoes=50, semente=1).fechamentos
        b = serie_sintetica(pregoes=50, semente=1).fechamentos
        c = serie_sintetica(pregoes=50, semente=2).fechamentos
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)


if __name__ == "__main__":
    unittest.main()
