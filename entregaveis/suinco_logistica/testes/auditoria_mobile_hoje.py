#!/usr/bin/env python3
"""AUDITORIA (não é teste de regressão) — paridade mobile das mudanças de hoje.

Fase 1 do systematic-debugging: gather evidence antes de propor qualquer
correção. Abre cada área nova/alterada num viewport de celular real
(390x844, is_mobile, has_touch — iPhone-ish) e mede: overflow horizontal,
tamanho de alvo de toque (mínimo 44px é a régua usada no resto do
projeto — ver test_mobile.py/test_auditoria_mobile.py), tamanho de fonte,
e tira screenshot de cada uma pra inspeção visual.

Não corrige nada. Só levanta evidência.
"""
import asyncio
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SHOTS = '/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad'
achados = []


def nota(area, texto, evidencia=''):
    print(f"  [{area}] {texto}" + (f" — {evidencia}" if evidencia else ''))
    achados.append((area, texto, evidencia))


async def main():
    import os
    os.makedirs(SHOTS, exist_ok=True)
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)
        await pg.evaluate("(s) => { DB.operador.setor = s; aplicarPermissoesSetor(); }", 'Administração')
        await pg.wait_for_timeout(150)

        # Dados de teste variados, pra cada área ter algo pra mostrar.
        await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota;
            const c1 = criarCargaProgramada({ placa: f[0].placa, numeroCarga: 'M1', peso: 9000, rota: '500', operador: 'Ana' });
            const c2 = criarCargaProgramada({ placa: f[1].placa, numeroCarga: 'M2', peso: 9000, rota: '500', operador: 'Ana' });
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
                .forEach(st => avancarStatusCarga(c2.id, st, 'Ana', 'Logística'));
        }""")

        print('\n=== 1. TORRE: CAIXAS CLICÁVEIS (alvo de toque + tap funciona) ===')
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(300)
        caixas = await pg.evaluate("""() => [...document.querySelectorAll('.stat-clicavel')].map(el => {
            const r = el.getBoundingClientRect();
            return { rotulo: el.querySelector('.stat-label').textContent.trim(), w: r.width, h: r.height };
        })""")
        pequenas = [c for c in caixas if c['h'] < 44]
        if pequenas:
            nota('TORRE', 'FALHA alvo de toque: caixa(s) com altura < 44px', str(pequenas))
        else:
            nota('TORRE', 'OK — todas as caixas clicáveis têm altura >= 44px', f'{len(caixas)} caixas')

        # Comparar contagem de linhas não serve: com poucos dados de teste, o
        # status tocado pode já ser o único visível na lista padrão ("abertas"),
        # e nesse caso o número de linhas legitimamente não muda. O que prova
        # que o tap() filtrou de verdade é o estado interno + toda linha
        # visível bater com o status tocado.
        await pg.tap('.stat-clicavel:has-text("Aguardando Veículo")')
        await pg.wait_for_timeout(150)
        filtro_aplicado = await pg.evaluate("() => _torreFiltroStatus")
        linhas_batem = await pg.evaluate("""() => [...document.querySelectorAll('#torre-tbody tr')]
            .every(tr => tr.querySelector('.badge')?.textContent.trim() === 'Aguardando Veículo')""")
        if filtro_aplicado == 'Aguardando Veículo' and linhas_batem:
            nota('TORRE', 'OK — tap() na caixa aplicou o filtro e toda linha visível bate com o status', filtro_aplicado)
        else:
            nota('TORRE', 'FALHA — tap() na caixa não aplicou o filtro esperado',
                 f'_torreFiltroStatus={filtro_aplicado!r} linhas_batem={linhas_batem}')
        await pg.tap('.stat-clicavel:has-text("Aguardando Veículo")')  # limpa pro resto do teste
        await pg.screenshot(path=f'{SHOTS}/mobile_torre.png')

        print('\n=== 2. TORRE: VISÃO DO PÁTIO (tabela com muitas colunas, tela de 390px) ===')
        vp = await pg.evaluate("""() => {
            const tbl = document.querySelector('#tab-torre .tabela-patio');
            const wrap = document.querySelector('#tab-torre .table-wrap');
            return {
                larguraTabela: tbl ? tbl.scrollWidth : null,
                larguraWrap: wrap ? wrap.clientWidth : null,
                temScrollHorizontal: wrap ? wrap.scrollWidth > wrap.clientWidth : null,
            };
        }""")
        nota('VISÃO DO PÁTIO', 'tabela de 11 colunas em tela de 390px', str(vp))
        if vp['temScrollHorizontal']:
            nota('VISÃO DO PÁTIO',
                 'esperado: scroll horizontal (não é erro — mesma tabela do desktop, contida em .table-wrap)',
                 '')

        print('\n=== 3. NÚMERO DA CARGA EDITÁVEL (Fila de Programados) ===')
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(300)
        campo = await pg.evaluate("""() => {
            const el = document.querySelector('.numero-carga-input');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { fonte: getComputedStyle(el).fontSize, altura: r.height };
        }""")
        if campo:
            fonte_px = float(campo['fonte'].replace('px', ''))
            if fonte_px < 16:
                nota('Nº CARGA', 'FALHA: fonte < 16px causa zoom automático do iOS ao focar', campo)
            else:
                nota('Nº CARGA', 'OK — fonte >= 16px (evita zoom do iOS)', campo)
        else:
            nota('Nº CARGA', 'campo não encontrado (sem carga em Aguardando Veículo na fila?)', '')

        print('\n=== 4. CADASTRAR ROTA (Administração) ===')
        await pg.evaluate("() => abrirTab('cadastros')")
        await pg.wait_for_timeout(300)
        rota_card = await pg.evaluate("""() => {
            const card = document.getElementById('card-cadastrar-rota');
            if (!card || card.hidden) return { visivel: false };
            const r = card.getBoundingClientRect();
            const btn = card.querySelector('button');
            const btnR = btn.getBoundingClientRect();
            return {
                visivel: true,
                estouraLargura: r.width > window.innerWidth,
                botaoAltura: btnR.height,
            };
        }""")
        nota('CADASTRAR ROTA', 'card visível pra Administração no mobile', str(rota_card))
        if rota_card.get('estouraLargura'):
            nota('CADASTRAR ROTA', 'FALHA: card estoura a largura da tela', str(rota_card))
        if rota_card.get('botaoAltura', 99) < 44:
            nota('CADASTRAR ROTA', 'FALHA: botão de cadastrar com alvo de toque < 44px', str(rota_card))
        await pg.screenshot(path=f'{SHOTS}/mobile_cadastrar_rota.png')

        print('\n=== 5. CANCELAR/EXCLUIR NO HISTÓRICO ===')
        await pg.evaluate("() => abrirTab('historico')")
        await pg.wait_for_timeout(300)
        placa_m1 = await pg.evaluate("() => DB.cargas.find(c=>c.numeroCarga==='M1').placa")
        await pg.fill('#hist-busca-carga', placa_m1)
        await pg.wait_for_timeout(200)
        hist = await pg.evaluate("""() => {
            const head = document.querySelector('#hist-timeline-wrap .timeline-head');
            if (!head) return null;
            const btn = head.querySelector('button');
            const overflow = head.scrollWidth > head.clientWidth;
            return {
                temBotao: !!btn,
                botaoAltura: btn ? btn.getBoundingClientRect().height : null,
                cabecalhoEstoura: overflow,
            };
        }""")
        nota('HISTÓRICO', 'cabeçalho da timeline com botão Cancelar, em 390px', str(hist))
        if hist and hist.get('botaoAltura') is not None and hist['botaoAltura'] < 44:
            nota('HISTÓRICO', 'FALHA: botão Cancelar/Excluir com alvo de toque < 44px', str(hist))
        await pg.screenshot(path=f'{SHOTS}/mobile_historico.png')

        print('\n=== 6. RELATÓRIO OPERACIONAL SEM A COLUNA Nº (export via mobile) ===')
        await pg.evaluate("() => abrirTab('relatorios')")
        await pg.wait_for_timeout(300)
        await pg.evaluate("() => { window.print = () => {}; }")
        await pg.evaluate("() => exportarPdfOperacional()")
        await pg.wait_for_timeout(400)
        cab = await pg.evaluate("""() => {
            const ths = [...document.querySelectorAll('#print-operacional thead th')].map(t=>t.textContent.trim());
            return ths;
        }""")
        nota('RELATÓRIO', 'cabeçalho renderiza igual no contexto mobile (a exportação em si é a mesma função)',
             str(cab))

        print('\n=== 7. ERROS DE PÁGINA NO PERCURSO INTEIRO ===')
        if erros:
            nota('CONSOLE', 'FALHA: erros de página', str(erros))
        else:
            nota('CONSOLE', 'OK — nenhum erro de página', '')

        await nav.close()

    print('\n=== RESUMO ===')
    falhas = [a for a in achados if 'FALHA' in a[1]]
    if falhas:
        print(f'  {len(falhas)} PROBLEMA(S) ENCONTRADO(S):')
        for area, texto, ev in falhas:
            print(f'    [{area}] {texto} — {ev}')
    else:
        print('  Nenhum problema encontrado nesta primeira passada.')
    print(f'\n  Screenshots em {SHOTS}/mobile_*.png')


asyncio.run(main())
