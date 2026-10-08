#!/usr/bin/env python3
"""O KM aceita casas decimais, e a vírgula nunca multiplica o frete (28/09/2026).

RELATO DO DONO: "a quilometragem quando é colocada de forma exata precisa
poder ter quebra com vírgulas... pagou 36 mil reais, o valor do km foi
11,66, o número que precisa estar lá precisa ser o número exato e precisa
poder colocar ponto e vírgula".

REPRODUZIDO NO PAINEL PUBLICADO, antes de corrigir:
  KM "3087,48"  → gravado 308748   (a vírgula era jogada fora: 100 vezes)
  KM "3087.48"  → gravado 308748   no painel; 3087 no servidor
  tarifa "11,66" → recusada         (`Number('11,66')` não é número)

A REGRA QUE ESTE TESTE TRAVA — a MESMA tabela que o teste da API confere
em `kmValido()` do servidor (backend/testes/api.test.js, bloco do KM):
  "3087,48" e "3.087,48" e "3087.48" → 3087,48 km
  "1.250"  → 1250 km   (ponto com três dígitos é milhar, como sempre foi)
  duas casas no máximo; zero, vazio, letra e negativo não são KM.

E na tela: corrigir o KM com vírgula grava o número exato; a tarifa com
vírgula é aceita; os campos de KM abrem o teclado com vírgula no celular.

    python3 testes/test_km_com_casas_decimais.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file://' + os.path.join(os.path.dirname(AQUI), 'index.html')
falhas = []

# A tabela das duas pontas. Se mudar aqui, muda no teste da API.
TABELA = [
    ('3087,48', 3087.48), ('3.087,48', 3087.48), ('3087.48', 3087.48),
    ('1.250', 1250), ('12.500', 12500), ('3087', 3087), ('1,5', 1.5),
    ('3087,4786', 3087.48), ('310 km', 310),
    ('0', None), ('', None), ('abc', None), ('-40', None),
]


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context()
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(600)

        print('\n=== 1. A LEITURA DO KM DIGITADO ===')
        for digitado, esperado in TABELA:
            lido = await pg.evaluate('(v) => kmValidoLocal(v)', digitado)
            ck(f'"{digitado}" → {esperado}', lido == esperado, str(lido))

        print('\n=== 2. O KM VOLTA PARA A TELA COM VÍRGULA ===')
        txt = await pg.evaluate("() => [kmTexto(3087.48), kmTexto(1250), kmTexto(null)]")
        ck('3087.48 aparece como "3087,48", 1250 como "1250"', txt == ['3087,48', '1250', ''], str(txt))
        volta = await pg.evaluate("() => kmValidoLocal(kmTexto(3087.48))")
        ck('e o que aparece, relido, é o mesmo número', volta == 3087.48, str(volta))

        print('\n=== 3. CORRIGIR O KM COM VÍRGULA GRAVA O NÚMERO EXATO ===')
        cid = await pg.evaluate("""() => {
          const pl = DB.frota[0].placa;
          return criarCargaProgramada({freteObservacao:'TABELA', placa: pl, numeroCarga:'KMDEC', peso:12000, rota:'510',
            freteDestino:'GOIANIA', kmDeslocamento:3087, operador:'Ana'}).id;
        }""")
        # 3087 → 3087,48 é ajuste pequeno: não pergunta nada.
        await pg.evaluate("async (id) => { await corrigirKmDaCargaUI(id, '3087,48'); }", cid)
        km = await pg.evaluate("(id) => getCarga(id).kmDeslocamento", cid)
        ck('"3087,48" gravou 3087,48 — e não 308.748', km == 3087.48, str(km))
        alt = await pg.evaluate("""(id) => (DB.alteracoes||[]).filter(a => a.cargaId === id && /KM/i.test(a.campo))
            .map(a => [a.de, a.para])""", cid)
        ck('o Histórico registra "3087" → "3087,48"', alt == [['3087', '3087,48']], str(alt))
        nasce = await pg.evaluate("""() => criarCargaProgramada({freteObservacao:'TABELA', placa: DB.frota[1].placa, numeroCarga:'KMDEC2',
            peso:12000, rota:'510', kmDeslocamento:'3087,48', operador:'Ana'}).kmDeslocamento""")
        ck('carga que NASCE com "3087,48" também grava 3087,48', nasce == 3087.48, str(nasce))

        print('\n=== 4. A TARIFA COM VÍRGULA É ACEITA ===')
        enviado = await pg.evaluate("""async () => {
          let pedido = null;
          const orig = SuincoSharePoint.gravarTarifaFrete;
          SuincoSharePoint.gravarTarifaFrete = async (d) => { pedido = d; return {}; };
          const origRec = window.recarregarTabelaDeFrete;
          window.recarregarTabelaDeFrete = async () => {};
          try {
            document.getElementById('frete-tarifa-tipo').value = 'TIPO TESTE';
            document.getElementById('frete-tarifa-valor').value = '11,66';
            await addTarifaFreteUI();
          } finally { SuincoSharePoint.gravarTarifaFrete = orig; window.recarregarTabelaDeFrete = origRec; }
          return pedido && pedido.valorPorKm;
        }""")
        ck('"11,66" vai ao servidor como 11,66', enviado == 11.66, str(enviado))

        print('\n=== 5. O CELULAR MOSTRA A VÍRGULA NOS CAMPOS DE KM ===')
        modos = await pg.evaluate("""() => ['prog-km-deslocamento','completar-km-deslocamento','frete-destino-km']
            .map(id => (document.getElementById(id) || {}).inputMode)""")
        ck('os três campos de KM usam teclado decimal', modos == ['decimal'] * 3, str(modos))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
