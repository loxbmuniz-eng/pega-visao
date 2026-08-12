#!/usr/bin/env python3
"""Calendário nos campos de data: visível e clicável.

Pedido do usuário (11/08/2026): "quero que apareca um calendariozinho nas
abas de filtragem por data... como uma janelinha de calendario onde a
pessoa pode navegar por dia mes ano".

A janelinha sempre existiu — é o seletor nativo do <input type="date">,
com navegação por dia/mês/ano. O que faltava era CHEGAR até ela: o ícone
é desenhado em preto pelo navegador, e o painel é escuro por padrão, então
ele ficava invisível. Quem não sabia digitava a data à mão.

Este teste NÃO tenta abrir o calendário nativo (ele é do navegador, não do
DOM — nenhuma automação o enxerga). Ele prova o que é testável e o que de
fato estava quebrado: o estilo que torna o ícone visível existe nos dois
temas, e clicar no campo dispara showPicker().

    python3 testes/test_calendario_data.py
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
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(600)

        print('\n=== 1. O ÍCONE É DESENHADO DE FORMA VISÍVEL ===')
        css = open('/home/user/pega-visao/entregaveis/suinco_logistica/styles.css',
                   encoding='utf-8').read()
        ck('existe estilo para o ícone do calendário',
           '::-webkit-calendar-picker-indicator' in css)
        ck('color-scheme definido (é o que faz o ícone e o calendário virem claros)',
           'color-scheme:dark' in css.replace(' ', ''))
        ck('tema claro tem tratamento próprio',
           'color-scheme:light' in css.replace(' ', ''))

        print('\n=== 2. O CAMPO INTEIRO ABRE O CALENDÁRIO ===')
        # showPicker é substituído por um espião: o calendário nativo em si
        # não é acessível a nenhuma automação, mas a CHAMADA é.
        await pg.evaluate("""() => {
            window.__aberturas = [];
            const orig = HTMLInputElement.prototype.showPicker;
            HTMLInputElement.prototype.showPicker = function(){
                window.__aberturas.push(this.id || '(sem id)');
            };
        }""")
        await pg.evaluate("() => irParaTab('relatorios')")
        await pg.wait_for_timeout(500)
        await pg.click('#rel-data-de')
        await pg.wait_for_timeout(300)
        abriu = await pg.evaluate("() => window.__aberturas")
        ck('clicar no campo "De" dos Relatórios abre o calendário',
           'rel-data-de' in abriu, str(abriu))

        await pg.click('#rel-data-ate')
        await pg.wait_for_timeout(300)
        abriu = await pg.evaluate("() => window.__aberturas")
        ck('clicar no campo "Até" também abre', 'rel-data-ate' in abriu, str(abriu))

        print('\n=== 3. VALE NA VISÃO DO PÁTIO (Torre) ===')
        await pg.evaluate("() => { window.__aberturas = []; irParaTab('torre'); }")
        await pg.wait_for_timeout(500)
        await pg.click('#torre-vp-de')
        await pg.wait_for_timeout(300)
        abriu = await pg.evaluate("() => window.__aberturas")
        ck('campo de data da Visão do Pátio abre o calendário',
           'torre-vp-de' in abriu, str(abriu))

        print('\n=== 4. O CAMPO CONTINUA ACEITANDO DIGITAÇÃO ===')
        # O atalho não pode tirar de quem prefere digitar.
        await pg.fill('#torre-vp-de', '2026-08-05')
        ck('digitar a data continua funcionando',
           (await pg.input_value('#torre-vp-de')) == '2026-08-05')

        print('\n=== 5. TODOS OS CAMPOS DE DATA SÃO type=date ===')
        n = await pg.evaluate("() => document.querySelectorAll('input[type=\"date\"]').length")
        ck('há campos de data no painel', n >= 10, str(n))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    print('  NOTA: a janelinha em si é do navegador (não é DOM), então nenhuma')
    print('  automação consegue abri-la ou fotografá-la. O que dá para provar')
    print('  — o estilo que a torna alcançável e a chamada que a abre — está aqui.')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
