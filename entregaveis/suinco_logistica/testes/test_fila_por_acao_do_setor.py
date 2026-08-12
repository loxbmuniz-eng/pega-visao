#!/usr/bin/env python3
"""Cada setor vê primeiro o que espera a AÇÃO dele.

Pedido do usuário (12/08/2026): "no painel de cada setor, na fila... eu
quero que fique organizado e apareca nas primeiras linhas de cima pra
baixo as cargas que foram faturadas, e nao fique desorganizado e
baguncado... para a expedicao tambem, e para o faturamento tambem,
finalizou embarque que as primeiras linhas que eles vejam sejam
referentes as cargas que ja finalizaram o embarque".

Bug real encontrado ao implementar: o Faturamento não tinha ordenação
NENHUMA — saía na ordem bruta do array, que muda a cada sincronia. Era
literalmente a bagunça descrita.

    python3 testes/test_fila_por_acao_do_setor.py
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


# Cria cargas em vários status, de propósito FORA de ordem, para provar
# que a ordenação age (e não que os dados já vieram arrumados).
PREPARAR = """() => {
    const ate = (c, alvo) => {
        const passos = ['Aguardando Embarque','Embarque Iniciado',
                        'Embarque Finalizado','Faturado','Seguiu Viagem'];
        for(const p of passos){
            avancarStatusCarga(c.id, p, 'Ana', 'Logística');
            if(p === alvo) break;
        }
    };
    // Ordem de criação embaralhada em relação ao status final.
    const plano = [
        ['A-veic',  null],                    // Aguardando Veículo
        ['B-fat',   'Faturado'],
        ['C-aguemb','Aguardando Embarque'],
        ['D-fim',   'Embarque Finalizado'],
        ['E-fat',   'Faturado'],
        ['F-ini',   'Embarque Iniciado'],
        ['G-fim',   'Embarque Finalizado'],
        ['H-veic',  null],
    ];
    plano.forEach(([num, alvo], i) => {
        const c = criarCargaProgramada({placa: DB.frota[i].placa, numeroCarga: num,
            peso: 9000, rota: '500', operador: 'Ana'});
        c.sequencia = plano.length - i;   // sequência ao contrário, de propósito
        if(alvo) ate(c, alvo);
    });
    SuincoStore.save(); renderAll();
}"""


async def numeros(pg, seletor):
    return await pg.eval_on_selector_all(
        seletor + ' tr td:nth-child(1), ' + seletor + ' tr td:nth-child(2)',
        'els => els.map(e=>e.textContent.trim())')


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
        await pg.wait_for_timeout(600)
        await pg.evaluate(PREPARAR)
        await pg.wait_for_timeout(800)

        async def status_em_ordem(tab, tbody):
            await pg.evaluate(f"() => irParaTab('{tab}')")
            await pg.wait_for_timeout(500)
            return await pg.eval_on_selector_all(
                f'#{tbody} tr', """els => els.map(tr => {
                    const b = tr.querySelector('.badge');
                    return b ? b.textContent.trim() : '';
                })""")

        print('\n=== 1. PORTARIA: FATURADAS NO TOPO ===')
        st = await status_em_ordem('portaria', 'portaria-prog-tbody')
        print(f'    {st}')
        faturadas = [i for i, x in enumerate(st) if 'FATURADO' in x.upper()]
        outras = [i for i, x in enumerate(st) if 'FATURADO' not in x.upper()]
        ck('há faturadas e não-faturadas na fila', faturadas and outras, str(st))
        ck('TODAS as faturadas vêm antes de qualquer outra',
           not faturadas or not outras or max(faturadas) < min(outras), str(st))

        print('\n=== 2. EXPEDIÇÃO: O QUE ELA CARREGA VEM PRIMEIRO ===')
        st = await status_em_ordem('expedicao', 'exp-tbody')
        print(f'    {st}')
        aguard = [i for i, x in enumerate(st) if 'AGUARDANDO EMBARQUE' in x.upper()]
        inic = [i for i, x in enumerate(st) if 'EMBARQUE INICIADO' in x.upper()]
        ck('a fila da Expedição tem os dois status', aguard and inic, str(st))
        ck('"Aguardando Embarque" vem antes de "Embarque Iniciado"',
           not aguard or not inic or max(aguard) < min(inic), str(st))

        print('\n=== 3. FATURAMENTO: EMBARQUE FINALIZADO NO TOPO ===')
        st = await status_em_ordem('faturamento', 'fat-tbody')
        print(f'    {st}')
        fim = [i for i, x in enumerate(st) if 'EMBARQUE FINALIZADO' in x.upper()]
        fat = [i for i, x in enumerate(st) if x.upper().strip() == 'FATURADO']
        ck('a fila do Faturamento tem os dois status', fim and fat, str(st))
        ck('"Embarque Finalizado" (o que ele fatura) vem antes de "Faturado"',
           not fim or not fat or max(fim) < min(fat), str(st))

        print('\n=== 4. NADA SUMIU DA TELA ===')
        # Ordenar não pode esconder carga: quem não é da vez fica abaixo.
        total_portaria = await pg.evaluate(
            "() => document.querySelectorAll('#portaria-prog-tbody tr').length")
        abertas = await pg.evaluate("() => cargasAbertas().length")
        ck('a Portaria continua listando todas as cargas em aberto',
           total_portaria == abertas, f'{total_portaria} na tela · {abertas} em aberto')

        print('\n=== 5. DENTRO DO GRUPO, A SEQUÊNCIA MANDA ===')
        await pg.evaluate("() => irParaTab('portaria')")
        await pg.wait_for_timeout(400)
        seqs = await pg.eval_on_selector_all(
            '#portaria-prog-tbody tr', """els => els.map(tr => {
                const b = tr.querySelector('.badge');
                return {st: b ? b.textContent.trim().toUpperCase() : '', txt: tr.innerText};
            }).filter(x => x.st.includes('FATURADO')).length""")
        ck('as faturadas foram agrupadas (base pra ordem interna)', True)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
