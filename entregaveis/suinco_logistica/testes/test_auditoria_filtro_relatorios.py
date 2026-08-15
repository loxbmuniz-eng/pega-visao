#!/usr/bin/env python3
"""Auditoria: o filtro de período vale igual nos três relatórios?

Pedido do usuário (11/08/2026): "AUDITAR FILTRAGEM DOS RELATORIOS E
FORMATO".

O risco concreto que isto persegue não é o filtro "não funcionar" — é ele
funcionar DIFERENTE em cada relatório. Um gestor que recorta 05/08, gera
o Operacional e o Executivo, e recebe dois recortes distintos toma
decisão com número errado sem nunca desconfiar, porque os dois trazem o
mesmo carimbo de período no cabeçalho.

    python3 testes/test_auditoria_filtro_relatorios.py
"""
import asyncio
import re
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
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        # Cargas em três dias distintos: hoje, ontem e 10 dias atrás.
        await pg.evaluate("""() => {
            const dias = [0, 1, 10];
            let i = 0;
            dias.forEach(d => {
                for(let k=0;k<3;k++,i++){
                    const c = criarCargaProgramada({placa: DB.frota[i].placa,
                        numeroCarga: `D${d}-${k}`, peso: 9000, rota:'500',
                        operador:'Ana'});
                    const t = new Date(Date.now() - d*86400000).toISOString();
                    /* `programadoEm` entrou em 14/08/2026 e passou a ser o
                       campo que o relatório recorta. Antes disso a data de
                       programação ERA `criadoEm`, e este teste envelhecia só
                       ele — o que agora descreveria outra situação (carga
                       que chegou há dias e foi lançada hoje), não "carga
                       programada há dias" que é o cenário daqui. */
                    c.criadoEm = t; c.atualizadoEm = t; c.programadoEm = t;
                }
            });
            SuincoStore.save(); renderAll();
        }""")
        await pg.wait_for_timeout(600)
        await pg.evaluate("() => irParaTab('relatorios')")
        await pg.wait_for_timeout(400)

        def hoje_iso(offset=0):
            return f"() => new Date(Date.now() - {offset}*86400000).toISOString().slice(0,10)"

        print('\n=== 1. SEM FILTRO: OS TRÊS VEEM O MESMO CONJUNTO ===')
        base = await pg.evaluate("() => cargasDoRelatorio().map(c=>c.numeroCarga).sort()")
        ck('filtro vazio devolve todas as 9 cargas de teste',
           len([x for x in base if x.startswith('D')]) == 9, str(len(base)))

        print('\n=== 2. COM FILTRO: O CONJUNTO ENCOLHE COERENTEMENTE ===')
        hoje = await pg.evaluate(hoje_iso(0))
        ontem = await pg.evaluate(hoje_iso(1))
        await pg.fill('#rel-data-de', ontem)
        await pg.fill('#rel-data-ate', hoje)
        filtrado = await pg.evaluate("() => cargasDoRelatorio().map(c=>c.numeroCarga).sort()")
        so_teste = [x for x in filtrado if x.startswith('D')]
        ck('período ontem→hoje traz 6 cargas (3 de hoje + 3 de ontem)',
           len(so_teste) == 6, str(so_teste))
        ck('a carga de 10 dias atrás ficou de fora',
           not any(x.startswith('D10') for x in so_teste), str(so_teste))

        print('\n=== 3. OS TRÊS RELATÓRIOS USAM O MESMO RECORTE ===')
        # Gera os três e conta quantas cargas de teste aparecem em cada.
        await pg.evaluate("""() => {
            SuincoSharePoint.estaConfigurado = () => true;
            SuincoSharePoint.gerarRelatorioPdf = async () =>
                new Blob(['%PDF'], {type:'application/pdf'});
            HTMLAnchorElement.prototype.click = function(){};
        }""")
        htmls = {}
        for fn, nome in [('exportarPdfOperacional','operacional'),
                         ('exportarPdfExecutivo','executivo'),
                         ('exportarPdfFretes','fretes')]:
            await pg.evaluate(f"() => {fn}()")
            await pg.wait_for_timeout(500)
            htmls[nome] = await pg.evaluate(
                f"() => document.getElementById('print-{nome}').innerHTML")

        for nome, html in htmls.items():
            achadas = sorted(set(re.findall(r'D\d+-\d', html)))
            fora = [x for x in achadas if x.startswith('D10')]
            ck(f'{nome}: nenhuma carga fora do período aparece', not fora, str(fora))

        print('\n=== 4. O CARIMBO DE PERÍODO É O MESMO NOS TRÊS ===')
        periodos = {}
        for nome, html in htmls.items():
            m = re.search(r'Programadas[^<]*', html)
            periodos[nome] = m.group(0).strip() if m else '(sem carimbo)'
            print(f'    {nome:12} -> {periodos[nome]}')
        ck('os três carimbam exatamente o mesmo período',
           len(set(periodos.values())) == 1, str(periodos))

        print('\n=== 5. MUDAR O FILTRO MUDA OS TRÊS (sem PDF com recorte velho) ===')
        await pg.fill('#rel-data-de', hoje)
        await pg.fill('#rel-data-ate', hoje)
        for fn, nome in [('exportarPdfOperacional','operacional'),
                         ('exportarPdfExecutivo','executivo'),
                         ('exportarPdfFretes','fretes')]:
            await pg.evaluate(f"() => {fn}()")
            await pg.wait_for_timeout(500)
            html = await pg.evaluate(
                f"() => document.getElementById('print-{nome}').innerHTML")
            ontem_dentro = [x for x in set(re.findall(r'D1-\d', html))]
            ck(f'{nome}: reagiu ao novo filtro (não trouxe as de ontem)',
               not ontem_dentro, str(ontem_dentro))

        print('\n=== 6. ACHADO A REGISTRAR: "AGUARDANDO CARGA" FICA DE FORA ===')
        # cargasDoRelatorio() exclui c.aguardandoCarga. É intencional no
        # Operacional (não há o que sequenciar sem dados), mas vale saber
        # que o Executivo também não conta esses caminhões — eles ESTÃO no
        # pátio ocupando doca.
        await pg.evaluate("""() => {
            registrarChegadaPortaria(DB.frota[40].placa, 'Ana', 'Portaria');
            SuincoStore.save();
        }""")
        await pg.wait_for_timeout(500)
        await pg.fill('#rel-data-de', '')
        await pg.fill('#rel-data-ate', '')
        n_rel = await pg.evaluate("() => cargasDoRelatorio().length")
        n_aguardando = await pg.evaluate("() => DB.cargas.filter(c=>c.aguardandoCarga).length")
        print(f'    cargas no relatório: {n_rel} · aguardando dados: {n_aguardando}')
        ck('a auditoria criou caminhão aguardando dados para conferir',
           n_aguardando > 0, str(n_aguardando))

        # BUG REAL achado nesta auditoria (11/08/2026): o indicador
        # "Aguardando Dados da Carga" do Executivo era calculado sobre o
        # conjunto que JÁ exclui aguardandoCarga — dava zero sempre, por
        # construção. Pior que errado: tranquilizador. O gestor lia
        # "0 aguardando dados" com caminhão parado no pátio sem nota.
        await pg.evaluate("() => exportarPdfExecutivo()")
        await pg.wait_for_timeout(600)
        html_exec = await pg.evaluate(
            "() => document.getElementById('print-executivo').innerHTML")
        m = re.search(
            r'<div class="stat-num">(\d+)</div><div class="stat-label">Aguardando Dados da Carga',
            html_exec)
        lido = int(m.group(1)) if m else -1
        ck('o indicador "Aguardando Dados da Carga" reflete a realidade',
           lido == n_aguardando, f'relatório mostra {lido}, existem {n_aguardando}')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
