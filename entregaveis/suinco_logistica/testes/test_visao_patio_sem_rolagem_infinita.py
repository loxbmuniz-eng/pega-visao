#!/usr/bin/env python3
"""Visão do Pátio (Torre/Portaria/Expedição/Faturamento) sem limite nenhum.

Achado na auditoria de tabas pedida pelo usuário (08/08/2026, "proximo
passo" -> continuar a auditoria de Portaria/Expedição/Faturamento/Usuários
com a mesma evidência já usada em Torre/Indicadores/Cadastros) — a
TERCEIRA lista sem teto encontrada na mesma sessão (depois de Frota e do
Log de Histórico): `renderVisaoPatio()` (compartilhada pelas quatro abas)
não tinha limite algum quando um período é escolhido — "revisitar carga
encerrada" é justamente o caso de uso do filtro.

Medido antes da correção: 400 cargas concluídas num período amplo geravam
400 linhas — 188.217px de altura de página no celular (cartão de 2
colunas). Mesmo padrão de bug, mesma correção: teto menor no celular (o
mesmo breakpoint que ativa o cartão), com aviso de quantas ficaram de
fora — a contagem e a distribuição por status no resumo continuam
respondendo pela busca INTEIRA, só a tabela é que corta.

    python3 testes/test_visao_patio_sem_rolagem_infinita.py
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


async def preparar(pg, n_cargas):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(700)
    await pg.evaluate("""() => {
        DB.operador = {nome:'Chefe', setor:'Administração'};
        document.getElementById('modal-operador')?.classList.remove('open');
            renderAll();  // tela de entrada própria (16/08): painel só aparece após render com operador
    }""")
    await pg.wait_for_timeout(300)
    await pg.evaluate("""(n) => {
        const placas = DB.frota.slice(0, 50).map(f=>f.placa);
        for(let i=0;i<n;i++){
            const p = placas[i % placas.length];
            const c = criarCargaProgramada({placa:p, numeroCarga:'H'+i, peso:9000,
              rota:'500', operador:'Chefe'});
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
              .forEach(st => avancarStatusCarga(c.id, st, 'Chefe', 'Logística'));
        }
    }""", n_cargas)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. CELULAR: TETO BAIXO, SEM ROLAGEM ABSURDA ===')
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg, 60)
        await pg.evaluate("() => abrirTab('portaria')")
        await pg.wait_for_timeout(300)
        await pg.fill('#portaria-vp-de', '2000-01-01')
        await pg.fill('#portaria-vp-ate', '2035-12-31')
        await pg.wait_for_timeout(500)
        info = await pg.evaluate("""() => {
            const tb = document.getElementById('portaria-vp-tbody');
            const resumo = document.getElementById('portaria-vp-resumo').textContent;
            return { linhas: tb.querySelectorAll('tr').length, resumo, altura: document.body.scrollHeight };
        }""")
        ck('mostra no máximo 40 linhas no celular', info['linhas'] <= 40, str(info['linhas']))
        ck('resumo continua com a contagem TOTAL (60), não só o que apareceu na tabela',
           '60 carga' in info['resumo'], info['resumo'])
        ck('avisa que cortou e mais cargas existem',
           'mostrando' in info['resumo'].lower() and 'refine' in info['resumo'].lower(), info['resumo'])
        ck('altura da página fica razoável (< 25000px) com 60 cargas no período',
           info['altura'] < 25000, f"{info['altura']}px")
        await ctx.close()

        print('\n=== 2. DESKTOP: TETO CONTINUA 300 (não regrediu pro valor do celular) ===')
        ctx2 = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg2, 60)
        await pg2.evaluate("() => abrirTab('expedicao')")
        await pg2.wait_for_timeout(300)
        await pg2.fill('#expedicao-vp-de', '2000-01-01')
        await pg2.fill('#expedicao-vp-ate', '2035-12-31')
        await pg2.wait_for_timeout(500)
        info2 = await pg2.evaluate("""() => {
            const tb = document.getElementById('expedicao-vp-tbody');
            return { linhas: tb.querySelectorAll('tr').length };
        }""")
        ck('desktop mostra as 60 (abaixo do teto de 300, sem cortar nada)',
           info2['linhas'] == 60, str(info2['linhas']))
        await ctx2.close()

        print('\n=== 3. AS QUATRO ABAS COMPARTILHAM A MESMA CORREÇÃO (Torre/Portaria/Expedição/Faturamento) ===')
        ctx3 = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg3 = await ctx3.new_page()
        pg3.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg3, 60)
        for prefixo, tab in [('torre', 'torre'), ('faturamento', 'faturamento')]:
            await pg3.evaluate(f"() => abrirTab('{tab}')")
            await pg3.wait_for_timeout(300)
            de = await pg3.query_selector(f'#{prefixo}-vp-de')
            if de:
                await pg3.fill(f'#{prefixo}-vp-de', '2000-01-01')
                await pg3.fill(f'#{prefixo}-vp-ate', '2035-12-31')
                await pg3.wait_for_timeout(400)
                linhas = await pg3.evaluate(
                    f"() => document.getElementById('{prefixo}-vp-tbody').querySelectorAll('tr').length")
                ck(f'{prefixo}: também respeita o teto de 40 no celular', linhas <= 40, str(linhas))

        print('\n=== 4. SEM PERÍODO (pátio de agora), COMPORTAMENTO NÃO MUDOU ===')
        await pg3.evaluate("() => abrirTab('portaria')")
        await pg3.wait_for_timeout(300)
        await pg3.evaluate("""() => {
            document.getElementById('portaria-vp-de').value = '';
            document.getElementById('portaria-vp-ate').value = '';
            renderVisaoPatio('portaria');
        }""")
        await pg3.wait_for_timeout(300)
        vazio_visivel = await pg3.evaluate(
            "() => document.getElementById('portaria-vp-empty').hidden")
        ck('sem período, continua mostrando o pátio aberto agora (0 cargas em aberto, já que todas concluíram)',
           vazio_visivel is False, str(vazio_visivel))
        await ctx3.close()

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
