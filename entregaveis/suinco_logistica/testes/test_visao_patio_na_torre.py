#!/usr/bin/env python3
"""Visão do Pátio (linha do tempo das 6 etapas) também aparece na Torre.

Pedido do usuário (07/08/2026): "eu quero que a visao do patio apareca na
torre de controle nao ta aparecendo". Até aqui, renderVisaoPatio() só
alimentava Portaria/Expedição/Faturamento — a Torre tinha só a tabela de
status simples (renderTorre()). Como a própria Torre é liberada para
TODOS os setores (não só Logística), fazia sentido que a mesma linha do
tempo por etapa aparecesse ali também.

    python3 testes/test_visao_patio_na_torre.py
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
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const c1 = criarCargaProgramada({ placa: DB.frota[0].placa, numeroCarga: 'R1',
              peso: 9000, rota: '500', operador: 'Ana' });
            const c2 = criarCargaProgramada({ placa: DB.frota[1].placa, numeroCarga: 'R2',
              peso: 9000, rota: '500', operador: 'Ana' });
            avancarStatusCarga(c2.id, 'Aguardando Embarque', 'Ana', 'Logística');
            abrirTab('torre'); renderAll();
        }""")
        await pg.wait_for_timeout(300)

        print('\n=== 1. O BLOCO EXISTE NA TORRE ===')
        existe = await pg.evaluate("""() => ({
            de: !!document.getElementById('torre-vp-de'),
            tbody: !!document.getElementById('torre-vp-tbody'),
            thead: !!document.getElementById('torre-vp-thead'),
            resumo: !!document.getElementById('torre-vp-resumo'),
        })""")
        ck('elementos da Visão do Pátio existem em #tab-torre', all(existe.values()), str(existe))

        print('\n=== 2. CABEÇALHO TEM A LINHA DO TEMPO (não status único) ===')
        # As seis colunas de etapa viraram uma célula compacta só
        # (linhaDoTempoCompacta(), app.js, 08/08/2026 — pedido do usuário
        # depois de reportar a Visão do Pátio "sumindo" no celular por
        # causa da altura). O cabeçalho continua com uma coluna própria
        # pra isso, só que uma, não seis.
        info = await pg.evaluate("""() => {
            const ths = [...document.getElementById('torre-vp-thead').querySelectorAll('th')];
            return { total: ths.length, temLinhaDoTempo: ths.some(th => th.textContent.trim() === 'Linha do tempo') };
        }""")
        ck('cabeçalho tem a coluna "Linha do tempo"', info['temLinhaDoTempo'], info)
        ck('cabeçalho não voltou a ter uma coluna por etapa (Nº/Placa/Transp/Rota/LinhaDoTempo/Tempo = 6)',
           info['total'] == 6, info)

        print('\n=== 3. AS DUAS CARGAS APARECEM NA LISTA ===')
        linhas = await pg.evaluate(
            "() => document.getElementById('torre-vp-tbody').querySelectorAll('tr').length")
        ck('2 cargas em aberto aparecem na Visão do Pátio da Torre', linhas == 2, linhas)

        print('\n=== 4. RESUMO NO TOPO REFLETE O TOTAL ===')
        resumo = await pg.evaluate(
            "() => document.getElementById('torre-vp-resumo').textContent")
        ck('resumo cita "2 carga(s)"', '2 carga' in resumo, resumo)

        print('\n=== 5. FILTRO DE BUSCA FUNCIONA IGUAL AOS OUTROS SETORES ===')
        placa0 = await pg.evaluate("() => DB.frota[0].placa")
        await pg.fill('#torre-vp-busca', placa0)
        await pg.wait_for_timeout(150)
        linhas_filtradas = await pg.evaluate(
            "() => document.getElementById('torre-vp-tbody').querySelectorAll('tr').length")
        ck('filtro por placa reduz pra 1 linha', linhas_filtradas == 1, linhas_filtradas)

        print('\n=== 6. A TABELA DE STATUS ORIGINAL DA TORRE CONTINUA EXISTINDO ===')
        original = await pg.evaluate(
            "() => document.getElementById('torre-tbody').querySelectorAll('tr').length")
        ck('a tabela original (torre-tbody) não sumiu', original == 2, original)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
