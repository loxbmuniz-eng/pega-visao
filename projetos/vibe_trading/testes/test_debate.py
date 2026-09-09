import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vibe_trading.debate import debater, dossie_markdown, montar_dossie
from vibe_trading.serie import serie_sintetica


class TesteDebate(unittest.TestCase):
    def test_o_placar_e_deterministico(self):
        s = serie_sintetica(pregoes=400, semente=3)
        a = debater(s)[2:]
        b = debater(s)[2:]
        self.assertEqual(a, b)

    def test_veredito_e_um_dos_tres(self):
        for semente in (1, 2, 3, 4, 5):
            s = serie_sintetica(pregoes=400, semente=semente)
            self.assertIn(debater(s)[2], {"comprar", "esperar", "reduzir"})

    def test_dossie_traz_os_numeros_junto_do_texto(self):
        # O ponto do módulo: o LLM argumenta sobre evidência medida. Se o
        # dossiê sair sem número, ele vira prompt vazio.
        s = serie_sintetica(pregoes=400, semente=8)
        d, t, v, c, p = debater(s)
        texto = dossie_markdown(s, d, t, v, c, p)
        self.assertIn("IFR (14)", texto)
        self.assertIn("Último fechamento", texto)
        self.assertIn("Não é recomendação", texto)

    def test_evidencia_sem_dado_nao_vira_zero(self):
        s = serie_sintetica(pregoes=30)      # curta demais para média de 200
        d = montar_dossie(s)
        self.assertIsNone(d["tendencia_longa"].valor)
        self.assertEqual(d["tendencia_longa"].formatado(), "sem dado")

    def test_analistas_podem_discordar(self):
        # Um comitê onde todos concordam sempre não é comitê, é eco.
        vistos = set()
        for semente in range(1, 25):
            s = serie_sintetica(pregoes=400, semente=semente)
            vistos.update(t.posicao for t in debater(s)[1])
        self.assertGreater(len(vistos), 1)


if __name__ == "__main__":
    unittest.main()
