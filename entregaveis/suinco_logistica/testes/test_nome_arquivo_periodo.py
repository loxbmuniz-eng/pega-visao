#!/usr/bin/env python3
"""O nome do PDF carrega o PERÍODO FILTRADO, não a hora da emissão.

Pedido do usuário (11/08/2026): "os relatorios filtrados por data,
precisam sair com a data exata que foi filtrada no nome do arquivo, por
exemplo, se foi hoje, sai com data de hoje, se foi antes de ontem, sai
com data de antes de ontem, se foi do mes passado, preciso que saia com
data do mes passado no nome do arquivo".

O problema real que isso resolve: quem gerava hoje o relatório de julho
recebia um arquivo carimbado com a data de HOJE. Na pasta de downloads,
três relatórios de meses diferentes ficavam com nomes quase idênticos —
só dava para saber qual era qual abrindo um por um.

    python3 testes/test_nome_arquivo_periodo.py
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


async def nome_gerado(pg, de, ate, fn='exportarPdfOperacional'):
    """Preenche o filtro, exporta e devolve o nome que o navegador baixaria."""
    await pg.fill('#rel-data-de', de)
    await pg.fill('#rel-data-ate', ate)
    return await pg.evaluate(f"""async () => {{
        window.__nome = null;
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function(){{ window.__nome = this.download; }};
        SuincoSharePoint.estaConfigurado = () => true;
        SuincoSharePoint.gerarRelatorioPdf = async () =>
            new Blob(['%PDF-1.4'], {{type:'application/pdf'}});
        try{{ await {fn}(); }} finally {{ HTMLAnchorElement.prototype.click = orig; }}
        return window.__nome;
    }}""")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)
        await pg.evaluate("""() => {
            for(let i=0;i<3;i++){
                criarCargaProgramada({placa:DB.frota[i].placa, numeroCarga:'N'+i,
                    peso:9000, rota:'500', operador:'Ana'});
            }
        }""")
        await pg.evaluate("() => irParaTab('relatorios')")
        await pg.wait_for_timeout(500)

        hoje = await pg.evaluate("() => new Date().toISOString().slice(0,10)")
        anteontem = await pg.evaluate(
            "() => new Date(Date.now()-2*86400000).toISOString().slice(0,10)")

        print('\n=== 1. FILTRADO EM HOJE ===')
        n = await nome_gerado(pg, hoje, hoje)
        print(f'    {n}')
        ck('o nome traz a data de hoje', hoje in n, n)

        print('\n=== 2. FILTRADO EM ANTEONTEM ===')
        n = await nome_gerado(pg, anteontem, anteontem)
        print(f'    {n}')
        ck('o nome traz a data de anteontem', anteontem in n, n)
        ck('e NÃO traz a data de hoje (era esse o bug)', hoje not in n, n)

        print('\n=== 3. MÊS PASSADO (intervalo) ===')
        n = await nome_gerado(pg, '2026-07-01', '2026-07-31')
        print(f'    {n}')
        ck('o nome traz o mês passado', '2026-07-01' in n and '2026-07-31' in n, n)
        ck('mês passado não vira data de hoje', hoje not in n, n)

        print('\n=== 4. SÓ "DE" / SÓ "ATÉ" ===')
        n = await nome_gerado(pg, '2026-06-15', '')
        print(f'    {n}')
        ck('só "de" fica explícito no nome', 'desde_2026-06-15' in n, n)
        n = await nome_gerado(pg, '', '2026-06-20')
        print(f'    {n}')
        ck('só "até" fica explícito no nome', 'ate_2026-06-20' in n, n)

        print('\n=== 5. SEM FILTRO: EMISSÃO, MARCADA COMO TAL ===')
        n = await nome_gerado(pg, '', '')
        print(f'    {n}')
        ck('sem filtro o nome marca que é emissão', 'emitido-' in n, n)

        print('\n=== 6. VALE PARA OS TRÊS RELATÓRIOS ===')
        for fn, rot in [('exportarPdfOperacional','Operacional'),
                        ('exportarPdfExecutivo','Executivo'),
                        ('exportarPdfFretes','Fretes')]:
            n = await nome_gerado(pg, '2026-07-01', '2026-07-31', fn)
            ck(f'{rot} carimba o período filtrado',
               '2026-07-01' in n and '2026-07-31' in n, n)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
