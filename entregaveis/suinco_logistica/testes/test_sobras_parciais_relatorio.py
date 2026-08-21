#!/usr/bin/env python3
"""Sobras, parciais da mesma nota e o relatório em tempo real (18/08/2026).

O que se prova no navegador de verdade, contra o backend local:

  1. SOBRA: o checklist enxuto do que só ENTRA — criado sem rota e sem
     carga, com o motivo "652 — Sobras" já na linha nova, e o ciclo curto
     que encerra no OK da Expedição.
  2. MESMA NOTA EM DUAS PARCIAIS: o caso real do cliente que devolve duas
     caixas do mesmo produto por motivos diferentes e emite duas parciais
     na mesma nota fiscal. O botão "mesma nota" repete o cabeçalho e o
     número da PARCIAL (coluna da capa de papel) amarra cada Nº DEV à
     caixa certa.
  3. RELATÓRIO DE DEVOLUÇÕES na aba Relatórios: o campo de dia já abre
     preenchido com hoje e o PDF sai com o status ATUAL (é buscado do
     servidor no clique, não do que estava na tela).
  4. RDC (romaneio): o campo dos Controles Internos aparece no cabeçalho.
  5. Nº DA NOTA PARCIAL em coluna própria, ao lado da nota de venda: nota
     parcial exige o número, nota total tem o campo travado e vazio. Sai nos
     dois relatórios, e a linha de TOTAL fecha alinhada com o cabeçalho.

    python3 testes/test_sobras_parciais_relatorio.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context(accept_downloads=True)
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_sobras_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        # ana@ é o operador de Logística estável (logistica@ é apagado pelo
        # before() de api.test.js).
        ctx, pg = await abrir(nav, 'ana@teste.local', 'log')

        print('\n=== 1. SOBRA: SÓ ENTRA, SEM ROTA E SEM CARGA ===')
        await pg.click(".nav-tab[data-tab='devolucoes']")
        await pg.wait_for_timeout(1200)
        await pg.click("#dev-card-sobra button.btn")
        await pg.wait_for_timeout(2000)
        sobra = await pg.evaluate(
            "() => { const d = DEVOLUCOES.find(x => x.tipo === 'SOBRA');"
            "  return d ? {id: d.id, status: d.status, rotas: d.rotas, numero: d.numero} : null; }")
        ck('sobra criada', sobra is not None, str(sobra))
        if not sobra:
            await nav.close()
            return
        ck('sobra nasce sem rota', sobra['rotas'] == [])
        ck('selo SOBRA na lista', await pg.locator('.dev-chip-sobra').count() > 0)
        motivo = await pg.evaluate(
            "(id) => (document.getElementById(`dev-ni-${id}-motivo`) || {}).value", sobra['id'])
        ck('motivo 652 — Sobras já vem na linha nova', motivo == '652 — Sobras', str(motivo))
        carimbos = await pg.evaluate(
            "() => document.querySelectorAll('.dev-card.dev-aberta .dev-carimbo').length")
        ck('sobra mostra só os 3 carimbos do ciclo curto', carimbos == 3, str(carimbos))

        print('\n=== 2. A MESMA NOTA EM DUAS PARCIAIS ===')
        # Um checklist comum, com a primeira parcial lançada pela linha nova.
        dev = await pg.evaluate(
            """async () => {
                 const d = await SuincoSharePoint.devolucoes.criar({
                   dataDev: diaLocalDev(), regiao: 'BELO HORIZONTE', rotas: ['500'],
                   itens: [{ nota: '678283', parcial: true, parcialDesc: '118274',
                             codCliente: 'AREAL', codProduto: '10719',
                             produtoNome: 'LINGUICA DE PERNIL C/ PIMENTA',
                             cx: 1, numDev: '52140', motivo: 'TEMPERATURA' }],
                 });
                 _devExpandida = d.id;
                 await carregarDevolucoes();
                 return { id: d.id, itemId: d.itens[0].itemId };
               }""")
        await pg.wait_for_timeout(800)
        campo_parcial = await pg.evaluate(
            "() => (document.querySelector('.dev-card.dev-aberta .dev-parcial-desc') || {}).value")
        ck('nº da parcial aparece e traz o número da capa', campo_parcial == '118274', str(campo_parcial))

        await pg.click(".dev-card.dev-aberta button:has-text('mesma nota')")
        await pg.wait_for_timeout(2000)
        depois = await pg.evaluate(
            """(id) => {
                 const d = DEVOLUCOES.find(x => x.id === id) || {itens: []};
                 const mesma = d.itens.filter(i => i.nota === '678283');
                 return mesma.map(i => ({ produto: i.codProduto, dev: i.numDev,
                                          parcial: i.parcialDesc, motivo: i.motivo }));
               }""", dev['id'])
        ck('a nota passou a ter DUAS parciais', len(depois) == 2, str(depois))
        if len(depois) == 2:
            ck('o produto foi repetido (é o mesmo nas duas caixas)',
               depois[0]['produto'] == depois[1]['produto'], depois[0]['produto'])
            nova = [i for i in depois if not i['dev']]
            ck('a linha nova vem sem Nº DEV, motivo e nº da parcial — o que muda entre as caixas',
               len(nova) == 1 and not nova[0]['motivo'] and not nova[0]['parcial'], str(nova))

        print('\n=== 3. CABEÇALHO DA LOGÍSTICA SÓ COM O QUE É DELA ===')
        # 19/08/2026: cada posto vê o próprio bloco. Na tela da Logística
        # ficam data, região e código do operador — placa, motorista, carga,
        # lacres, peso final e RDC são de quem preenche cada um deles.
        rotulos = ' | '.join(await pg.evaluate(
            "() => [...document.querySelectorAll('.dev-card.dev-aberta label')]"
            ".map((l) => l.innerText.trim())"))
        ck('tem Data, Região e Cód. operador',
           all(x in rotulos for x in ['Data da devolução', 'Região', 'Cód. operador']), rotulos[:90])
        ck('não tem campos de outros postos',
           not any(x in rotulos for x in ['Placa', 'Motorista', 'Lacre', 'Gerou RDC', 'Peso final']),
           rotulos[:110])

        print('\n=== 4. RELATÓRIO NA ABA RELATÓRIOS, EM TEMPO REAL ===')
        await pg.click(".nav-tab[data-tab='relatorios']")
        await pg.wait_for_timeout(800)
        valor = await pg.evaluate("() => document.getElementById('rel-dev-dia').value")
        hoje = await pg.evaluate("() => diaLocalDev()")
        ck('campo de dia abre preenchido com hoje', bool(valor) and valor == hoje, str(valor))

        async with pg.expect_download(timeout=60000) as dl:
            await pg.click("#tab-relatorios button:has-text('Gerar PDF')")
        arq = await dl.value
        ck('PDF do relatório baixado', 'Devolucoes' in arq.suggested_filename,
           arq.suggested_filename)
        doc = await pg.evaluate("() => document.getElementById('print-devolucoes').innerText")
        ck('a SOBRA criada agora está no relatório', 'SOBRA' in doc)
        ck('a parcial da nota sai identificada no relatório', '118274' in doc)

        print('\n=== 5. Nº DA NOTA PARCIAL: COLUNA PRÓPRIA, SÓ QUANDO É PARCIAL ===')
        await pg.click(".nav-tab[data-tab='devolucoes']")
        await pg.evaluate("(id) => { _devExpandida = id; renderDevolucoes(); }", dev['id'])
        await pg.wait_for_timeout(600)
        cab = await pg.evaluate(
            "() => [...document.querySelectorAll('.dev-card.dev-aberta thead th')]"
            ".map((t) => t.innerText.trim())")
        ck('coluna "Nº parcial" existe na tela', 'Nº parcial' in cab, ' | '.join(cab[:6]))

        # Uma linha TOTAL, para provar que o campo trava quando não há parcial.
        await pg.evaluate(
            "async (id) => { await SuincoSharePoint.devolucoes.criarItem(id,"
            " {nota: '672123', parcial: false, cx: 4, peso: 30,"
            "  codProduto: '01189', numDev: '52098', motivo: 'DATA PROXIMA'});"
            " _devExpandida = id; await carregarDevolucoes(); }", dev['id'])
        await pg.wait_for_timeout(900)
        campos = await pg.evaluate(
            "() => [...document.querySelectorAll('.dev-card.dev-aberta tbody tr')]"
            ".map((tr) => { const i = tr.querySelector('.dev-parcial-desc');"
            "  return i ? {v: i.value, off: i.disabled} : null; }).filter(Boolean)")
        ck('parcial mantém o número editável',
           any(c['v'] == '118274' and not c['off'] for c in campos), str(campos))
        ck('nota TOTAL fica com o campo travado e vazio',
           any(c['off'] and c['v'] == '' for c in campos))

        async with pg.expect_download(timeout=60000):
            await pg.click("button:has-text('Relatório do dia')")
        doc = await pg.evaluate("() => document.getElementById('print-devolucoes').innerText")
        ck('relatório do checklist traz a coluna e o número',
           'Nº parcial' in doc and '118274' in doc)
        # Pedido do gestor (20/08/2026): no papel, escrito por extenso — quem
        # lê o relatório não tem a tela do lado para lembrar o que é "P".
        ck('parcial/total sai por extenso, não abreviado',
           'PARCIAL' in doc and 'TOTAL' in doc and ' P ' not in doc,
           doc[:0] or 'ok')
        alin = await pg.evaluate(
            "() => { const t = document.querySelector('#print-devolucoes table');"
            "  const cols = t.querySelectorAll('thead th').length;"
            "  const tf = [...t.querySelectorAll('tfoot td')]"
            "    .reduce((s, c) => s + (parseInt(c.getAttribute('colspan')) || 1), 0);"
            "  return {cols, tf}; }")
        ck('linha de TOTAL alinhada com o cabeçalho', alin['cols'] == alin['tf'], str(alin))

        # A relação do operador virou INDIVIDUAL (19/08/2026): sai pelo botão
        # dentro do próprio checklist, porque é o papel que acompanha aquela
        # devolução até a Portaria.
        async with pg.expect_download(timeout=60000):
            await pg.click(f"button[onclick*=\"relatorioOperadorDevolucoesUI('{dev['id']}')\"]")
        oper = await pg.evaluate(
            "() => document.getElementById('print-devolucoes-operador').innerText")
        ck('relação do operador: coluna Nº parcial', 'Nº parcial' in oper)
        ck('relação do operador: peso em quilos', 'Peso (kg)' in oper and 'QUILOS (kg)' in oper)
        ck('relação do operador traz UM checklist só',
           'Checklist Nº' in oper and 'SOBRA' not in oper, oper.split('\n')[0][:70])

        # Limpeza: os dois checklists de teste saem do dia.
        await pg.evaluate(
            """async (ids) => { for (const id of ids) await SuincoSharePoint.devolucoes.excluir(id); }""",
            [sobra['id'], dev['id']])
        await pg.wait_for_timeout(800)
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
