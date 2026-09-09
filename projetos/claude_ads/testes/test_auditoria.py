import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.auditoria import auditar, TETO_CRESCIMENTO
from motor.planilha import Linha


def linha(nome, gasto, impressoes=50_000, cliques=500, conversoes=20, receita=0.0):
    return Linha(nome, "", "", gasto, impressoes, cliques, conversoes, receita)


class TesteVolumeMinimo(unittest.TestCase):
    def test_linha_sem_amostra_nao_e_perdedora(self):
        # 3 cliques e nenhuma conversão não é um perdedor: é um desconhecido.
        a = auditar([linha("teste", 20, impressoes=200, cliques=3, conversoes=0),
                     linha("boa", 1000, conversoes=40)])
        self.assertEqual(len(a.desperdicio), 0)
        self.assertEqual(len(a.sem_volume), 1)

    def test_vencedor_exige_amostra_de_conversao(self):
        # CPA excelente com UMA conversão é sorte, não vencedor.
        a = auditar([linha("sorte", 50, cliques=40, conversoes=1),
                     linha("normal", 2000, conversoes=20),
                     linha("outra", 2000, conversoes=20)])
        self.assertNotIn("sorte", [v.rotulo for v in a.vencedores])

    def test_gasto_alto_sem_conversao_com_trafego_e_desperdicio(self):
        a = auditar([linha("queimando", 3000, cliques=400, conversoes=0),
                     linha("boa", 1000, conversoes=30)])
        tipos = [d.tipo for d in a.desperdicio]
        self.assertIn("sem_conversao", tipos)
        self.assertEqual(a.desperdicio_total, 3000)


class TesteReferencia(unittest.TestCase):
    def test_usa_mediana_e_nao_media(self):
        # Uma campanha gigante e ruim puxaria a MÉDIA e absolveria o resto.
        linhas = [linha(f"boa{i}", 100, conversoes=20) for i in range(5)]
        linhas.append(linha("gigante ruim", 100_000, cliques=5000, conversoes=20))
        a = auditar(linhas)
        self.assertIn("gigante ruim", [d.rotulo for d in a.desperdicio])

    def test_cpa_alvo_do_usuario_manda_na_mediana(self):
        linhas = [linha(f"x{i}", 1000, conversoes=10) for i in range(4)]   # CPA 100
        sem_alvo = auditar(linhas)
        com_alvo = auditar(linhas, cpa_alvo=20.0)
        self.assertEqual(len(sem_alvo.desperdicio), 0)
        self.assertEqual(len(com_alvo.desperdicio), 4, "todas ficam acima de 1,5x o alvo")


class TesteRealocacao(unittest.TestCase):
    def _cenario(self):
        # 3 linhas medianas (CPA 100) dão base de comparação; "vence" tem CPA 10.
        return [linha(f"media{i}", 1000, conversoes=10) for i in range(3)] + [
            linha("vence", 1000, conversoes=100),
            linha("queima", 50_000, cliques=2000, conversoes=0),
        ]

    def test_nao_sugere_mais_que_o_teto_de_crescimento(self):
        a = auditar(self._cenario())
        destinos = [p for p in a.realocacao if p["para"] != "(sem destino)"]
        for p in destinos:
            self.assertLessEqual(p["novo_gasto"], p["gasto_atual"] * TETO_CRESCIMENTO + 0.01)

    def test_sobra_vira_recomendacao_de_criativo_novo(self):
        a = auditar(self._cenario())
        sobra = [p for p in a.realocacao if p["para"] == "(sem destino)"]
        self.assertEqual(len(sobra), 1)
        self.assertIn("criativo novo", sobra[0]["porque"])

    def test_sem_vencedor_nao_inventa_destino(self):
        a = auditar([linha("queima", 5000, cliques=400, conversoes=0)])
        self.assertEqual(a.realocacao, [])


class TesteBaseDeComparacao(unittest.TestCase):
    def test_poucas_linhas_nao_geram_acusacao_por_mediana(self):
        # Com uma linha só, a mediana é ela mesma. Julgar aí é sortear.
        a = auditar([linha("unica", 1000, conversoes=10)])
        self.assertFalse(a.base_de_comparacao)
        self.assertEqual(a.desperdicio, [])
        self.assertEqual(a.vencedores, [])

    def test_com_alvo_informado_julga_mesmo_com_poucas_linhas(self):
        a = auditar([linha("unica", 1000, conversoes=10)], cpa_alvo=20.0)
        self.assertTrue(a.base_de_comparacao)
        self.assertEqual(len(a.desperdicio), 1)


class TesteRelatorioSemConversao(unittest.TestCase):
    def test_relatorio_de_alcance_nao_acusa_todo_mundo(self):
        # Campanha de alcance não tem conversão. Marcar tudo como desperdício
        # seria transformar a ausência de coluna em acusação.
        a = auditar([linha("alcance A", 1000, conversoes=0),
                     linha("alcance B", 800, conversoes=0)])
        self.assertFalse(a.tem_conversao)
        self.assertEqual([d for d in a.desperdicio if d.tipo == "sem_conversao"], [])


if __name__ == "__main__":
    unittest.main()
