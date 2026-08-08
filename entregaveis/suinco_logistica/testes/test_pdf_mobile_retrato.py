#!/usr/bin/env python3
"""PDF em celular que sai na orientação errada não fica ilegível.

Pedido do usuário (07/08/2026): o relatório precisa "sair formatado da
mesma forma que se exportado pelo computador, seja android ou iphone".
Ele confirmou que o problema acontece nos dois sistemas.

O QUE ESTE TESTE PROVA, e o que NÃO prova
------------------------------------------
Alguns apps de PDF do celular ignoram `@page{size:landscape}` e imprimem
na orientação em pé que o próprio app escolheu — comportamento que varia
por navegador/OS e não é reproduzível num Chromium headless em Linux (não
existe um iPhone real neste ambiente). O que ESTE teste verifica é a parte
que É determinística e testável: SE a página de impressão acabar em pé
(`@media print and (orientation:portrait)`), a regra de encolhimento em
styles.css entra e evita que a tabela de 13 colunas quebre em várias
linhas/páginas — o pior caso vira "mesma tabela, menor", nunca corte de
coluna ou texto girado.

A confirmação de que isto realmente resolve num iPhone/Android de verdade
depende do usuário testar e mandar o resultado — deixado explícito no
relato, não fingido como validado aqui.

    python3 testes/test_pdf_mobile_retrato.py
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
        erros = []

        print('\n=== 1. FOLHA DEITADA (caminho normal, computador/Android que respeita @page) ===')
        pg = await nav.new_page(viewport={'width': 1200, 'height': 800})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)
        await pg.evaluate("""() => {
            criarCargaProgramada({ placa: DB.frota[0].placa, numeroCarga: 'R1',
              peso: 9000, rota: '500', operador: 'Ana' });
            window.print = () => {};
            exportarPdfOperacional();
        }""")
        await pg.wait_for_timeout(300)
        await pg.emulate_media(media='print')
        d1 = await pg.evaluate("""() => {
            const el = document.getElementById('print-operacional').querySelector('.print-page');
            const cs = getComputedStyle(el);
            return { transform: cs.transform };
        }""")
        ck('em folha deitada (viewport largo), NÃO encolhe — sai no tamanho normal',
           d1['transform'] in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), d1['transform'])

        print('\n=== 2. FOLHA EM PÉ (o caso que quebrava): encolhe em vez de quebrar linha ===')
        pg2 = await nav.new_page(viewport={'width': 700, 'height': 1100})
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(900)
        await pg2.evaluate("() => mostrarLoginLocal()")
        await pg2.fill('#login-nome', 'Ana')
        await pg2.select_option('#login-setor', 'Logística')
        await pg2.click('button:has-text("Entrar sem servidor")')
        await pg2.wait_for_timeout(400)
        await pg2.evaluate("""() => {
            criarCargaProgramada({ placa: DB.frota[0].placa, numeroCarga: 'R1',
              peso: 9000, rota: '500', operador: 'Ana' });
            window.print = () => {};
            exportarPdfOperacional();
        }""")
        await pg2.wait_for_timeout(300)
        await pg2.emulate_media(media='print')
        d2 = await pg2.evaluate("""() => {
            const el = document.getElementById('print-operacional').querySelector('.print-page');
            const cs = getComputedStyle(el);
            return {
                transform: cs.transform,
                width: cs.width,
                origin: cs.transformOrigin,
            };
        }""")
        ck('em folha em pé, a regra de encolhimento entra (transform != none)',
           d2['transform'] not in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), d2['transform'])
        # getComputedStyle resolve width em px (1mm = 96/25.4 px), não mm.
        ck('largura de referência continua a da folha deitada (287mm)',
           abs(_px_para_mm(d2['width']) - 287) < 1, d2['width'])
        ck('origem da transformação é o canto superior esquerdo (não distorce nem desloca fora da folha)',
           'left' in d2['origin'] and 'top' in d2['origin'] or d2['origin'].startswith('0px 0px'),
           d2['origin'])

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    print('  LEMBRETE: isto testa a regra CSS em isolamento, não substitui testar')
    print('  a exportação de verdade num iPhone/Android — pendente confirmação do usuário.')
    return 1 if falhas else 0


def _px_para_mm(css_len_px):
    try:
        px = float(css_len_px.replace('px', '').strip())
        return px / (96 / 25.4)
    except Exception:
        return -999


sys.exit(asyncio.run(main()))
