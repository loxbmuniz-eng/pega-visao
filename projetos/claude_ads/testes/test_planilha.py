import sys, unittest, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.planilha import ler, numero, detectar_decimal


def arquivo(texto):
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8")
    f.write(texto); f.close()
    return f.name


class TesteNumero(unittest.TestCase):
    def test_mil_e_quinhentos_em_arquivo_brasileiro(self):
        # "1.500" é 1500 em português e 1,5 em inglês. Num relatório de verba,
        # confundir os dois erra por mil vezes — e o número sai plausível.
        self.assertEqual(numero("1.500", ","), 1500.0)

    def test_um_e_meio_em_arquivo_ingles(self):
        self.assertEqual(numero("1.5", "."), 1.5)

    def test_detecta_a_convencao_pelo_arquivo_inteiro(self):
        self.assertEqual(detectar_decimal("gasto\nR$ 1.234,56\n"), ",")
        self.assertEqual(detectar_decimal("spend\n1,234.56\n"), ".")

    def test_traco_e_vazio_viram_zero(self):
        for t in ("", "—", "-", "N/A", None):
            self.assertEqual(numero(t), 0.0)

    def test_moeda_e_percentual_sao_removidos(self):
        self.assertEqual(numero("R$ 1.234,56", ","), 1234.56)
        self.assertEqual(numero("12,5%", ","), 12.5)


class TesteLer(unittest.TestCase):
    def test_reconhece_cabecalho_do_meta_em_portugues(self):
        linhas, col, _ = ler(arquivo(
            "Campanha;Valor gasto (BRL);Impressões;Cliques no link;Resultados\n"
            "Teste;R$ 100,00;5.000;120;10\n"))
        self.assertEqual(linhas[0].gasto, 100.0)
        self.assertEqual(linhas[0].impressoes, 5000)
        self.assertIn("conversoes", col)

    def test_reconhece_cabecalho_em_ingles(self):
        linhas, _, _ = ler(arquivo("Campaign,Cost,Impressions,Clicks,Conversions\nX,150.00,4000,90,7\n"))
        self.assertEqual(linhas[0].gasto, 150.0)

    def test_pula_linhas_de_titulo_antes_do_cabecalho(self):
        # O export do Google Ads vem com título e período antes do cabeçalho.
        linhas, _, _ = ler(arquivo(
            "Relatório de campanha\n"
            "01/08/2026 - 29/08/2026\n"
            "Campanha,Custo,Impressões,Cliques,Conversões\n"
            "Marca,900.00,50000,1500,80\n"))
        self.assertEqual(len(linhas), 1)
        self.assertEqual(linhas[0].campanha, "Marca")

    def test_ignora_o_rodape_de_total(self):
        linhas, _, _ = ler(arquivo(
            "Campanha,Custo,Cliques,Conversões\nA,100,50,5\nTotal: conta,100,50,5\n"))
        self.assertEqual(len(linhas), 1)

    def test_sem_coluna_de_gasto_falha_dizendo_o_que_leu(self):
        with self.assertRaisesRegex(ValueError, "gasto"):
            ler(arquivo("Campanha,Cliques\nA,10\n"))

    def test_metricas_derivadas(self):
        linhas, _, _ = ler(arquivo("Campanha,Custo,Impressões,Cliques,Conversões,Revenue\nA,100,10000,200,10,500\n"))
        l = linhas[0]
        self.assertAlmostEqual(l.ctr, 0.02)
        self.assertAlmostEqual(l.cpc, 0.5)
        self.assertAlmostEqual(l.cpa, 10.0)
        self.assertAlmostEqual(l.roas, 5.0)

    def test_divisao_por_zero_vira_none_e_nao_explode(self):
        linhas, _, _ = ler(arquivo("Campanha,Custo,Impressões,Cliques,Conversões\nA,100,0,0,0\n"))
        l = linhas[0]
        self.assertIsNone(l.ctr)
        self.assertIsNone(l.cpc)
        self.assertIsNone(l.cpa)


if __name__ == "__main__":
    unittest.main()
