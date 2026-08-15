#!/usr/bin/env python3
"""O relatório não imprime total errado calado: ele aponta o número duvidoso.

PEDIDO DO GESTOR (15/08/2026): "o relatório precisa considerar não somente
o status mas ser muito fiel aos números das cargas, não pode existir erro
nesse relatório e na filtragem".

O QUE A BASE DE PRODUÇÃO MOSTROU
  - `118176'` — sobrou uma aspa da digitação. `trim()` tira espaço, não
    aspa, então o número entrou torto e não casava em nenhuma busca.
  - `118713` no lugar de `118173` — dígitos trocados.
  - `118042`, `118105`, `118063`, `118011`, `118035`, `118111` repetidos em
    cargas diferentes — e `118105` em DUAS PLACAS.

Número repetido é o mais grave dos três: o rodapé soma a mesma carga duas
vezes, e a conferência de tonelagem não fecha. Foi assim que "faltaram 64
toneladas" — parte do buraco era carga contada em dobro, não carga sumida.

DUAS DEFESAS, e nenhuma delas bloqueia a digitação (o número é livre por
decisão registrada em docs/DECISOES_CONFIRMADAS.md item 2 — travar o
lançamento no meio do turno seria pior que o problema):

  1. LIMPEZA na origem: aspas e espaços saem sozinhos, então `118176'` não
     tem como nascer de novo.
  2. CONFERÊNCIA no relatório: o que continua duvidoso aparece impresso, ao
     lado do total. O sistema não adivinha qual `118105` é a certa — mas
     para de imprimir um total com cara de exato.

    python3 testes/test_numero_carga_confiavel.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Alysson')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== 1. A ASPA DA DIGITAÇÃO NÃO ENTRA MAIS ===')
        # Caso literal da produção: 118176'
        r = await pg.evaluate("""() => {
            const c = criarCargaProgramada({placa: DB.frota[30].placa,
                numeroCarga: "118176'", peso:9000, rota:'500', operador:'Ana'});
            return c.numeroCarga;
        }""")
        ck("número digitado como 118176' é gravado como 118176", r == '118176', repr(r))

        print('\n=== 2. EDITAR PELA TELA TAMBÉM LIMPA ===')
        r2 = await pg.evaluate("""() => {
            const c = DB.cargas.find(x => x.numeroCarga === '118176');
            atualizarNumeroCargaUI(c.id, "  118177''  ");
            return DB.cargas.find(x => x.id === c.id).numeroCarga;
        }""")
        ck('edição com aspas e espaços vira 118177', r2 == '118177', repr(r2))

        print('\n=== 3. NÚMERO REPETIDO É DETECTADO ===')
        p_ = await pg.evaluate("""() => {
            // Duas cargas diferentes com o mesmo número, como 118105 na base.
            criarCargaProgramada({placa: DB.frota[31].placa, numeroCarga:'118105',
                peso:10000, rota:'500', operador:'Ana'});
            criarCargaProgramada({placa: DB.frota[32].placa, numeroCarga:'118105',
                peso:12000, rota:'500', operador:'Ana'});
            const prob = problemasDeNumeracao(DB.cargas.filter(c=>!c.aguardandoCarga));
            const d = prob.duplicados.find(x => x.numero === '118105');
            return d ? {quantidade: d.quantidade, placas: d.placas.length,
                        peso: d.pesoSomado} : null;
        }""")
        ck('o repetido 118105 é encontrado', p_ is not None, str(p_))
        if p_:
            ck('conta as duas ocorrências', p_['quantidade'] == 2, str(p_))
            ck('mostra as duas placas diferentes', p_['placas'] == 2, str(p_))
            ck('soma o peso que está sendo contado em dobro',
               p_['peso'] == 22000, str(p_))

        print('\n=== 4. O RELATÓRIO IMPRIME O AVISO JUNTO DO TOTAL ===')
        html = await pg.evaluate(
            "() => avisoDeNumeracao(DB.cargas.filter(c => !c.aguardandoCarga))")
        ck('o aviso de conferência aparece', 'Conferir antes de usar' in html,
           html[:160])
        ck('o aviso cita o número repetido', '118105' in html, html[:160])
        ck('o aviso explica o efeito no total',
           'soma essas cargas mais de uma vez' in html, html[:200])

        print('\n=== 5. SEM PROBLEMA, SEM AVISO (não polui a folha) ===')
        limpo = await pg.evaluate("""() => {
            const so = [
                {numeroCarga:'900001', placa:'AAA1A11', peso:1000},
                {numeroCarga:'900002', placa:'BBB2B22', peso:2000},
            ];
            return avisoDeNumeracao(so);
        }""")
        ck('relatório sem número duvidoso não mostra aviso', limpo == '', repr(limpo))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
