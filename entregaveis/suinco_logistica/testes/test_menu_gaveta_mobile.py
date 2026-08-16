#!/usr/bin/env python3
"""No celular, a navegação vira gaveta lateral — não barra de rolagem.

Pedido do usuário (08/08/2026): "ao inves de ser uma barra de rolagem
pro lado na tela que seja um atalho na esquerda que abre um menu para ir
para cada pagina dentro do que cada setor propoe".

No desktop nada muda — a barra horizontal continua sempre visível, sem
gaveta. A regra abaixo prova as duas coisas: o comportamento mobile novo
e que o desktop não regrediu.

    python3 testes/test_menu_gaveta_mobile.py
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

        print('\n=== 1. CELULAR: BOTÃO DE MENU EXISTE, GAVETA ABRE E FECHA ===')
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append('mobile: ' + str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate("""() => {
            DB.operador = {nome:'Chefe', setor:'Administração'};
            document.getElementById('modal-operador')?.classList.remove('open');
            // Desde a tela de entrada própria (16/08/2026) o painel só
            // aparece depois de um render com operador — todo login real
            // passa por renderAll(). Definir DB.operador na mão sem
            // renderizar era um estado impossível na prática.
            renderAll();
        }""")
        await pg.wait_for_timeout(300)

        display_btn = await pg.evaluate("() => getComputedStyle(document.getElementById('btn-menu')).display")
        ck('botão hambúrguer visível no celular', display_btn != 'none', display_btn)

        alvo = await pg.evaluate("""() => {
            const el = document.getElementById('btn-menu');
            const r = el.getBoundingClientRect();
            return Math.min(r.width, r.height);
        }""")
        ck('alvo de toque do botão ≥ 44px', alvo >= 44, f'{alvo}px')

        await pg.click('#btn-menu')
        await pg.wait_for_timeout(300)
        aberto = await pg.evaluate("() => document.getElementById('nav').classList.contains('nav-aberto')")
        ck('clicar no botão abre a gaveta', aberto)
        overlay_visivel = await pg.evaluate(
            "() => document.getElementById('menu-overlay').classList.contains('visivel')")
        ck('fundo escurecido aparece atrás da gaveta', overlay_visivel)
        aria = await pg.get_attribute('#btn-menu', 'aria-expanded')
        ck('aria-expanded=true com a gaveta aberta', aria == 'true', aria)

        print('\n=== 2. TOCAR NUMA ABA NAVEGA E FECHA A GAVETA SOZINHA ===')
        await pg.click(".nav-tab[data-tab='historico']")
        await pg.wait_for_timeout(300)
        tab_atual = await pg.evaluate("() => TAB_ATUAL")
        ck('navegou para a aba tocada', tab_atual == 'historico', tab_atual)
        ainda_aberta = await pg.evaluate("() => document.getElementById('nav').classList.contains('nav-aberto')")
        ck('a gaveta fechou sozinha ao navegar', not ainda_aberta)

        print('\n=== 3. TOCAR FORA (NO FUNDO ESCURECIDO) FECHA A GAVETA ===')
        await pg.click('#btn-menu')
        await pg.wait_for_timeout(300)
        await pg.click('#menu-overlay', force=True, position={'x': 370, 'y': 400})
        await pg.wait_for_timeout(300)
        fechou = not await pg.evaluate("() => document.getElementById('nav').classList.contains('nav-aberto')")
        ck('tocar no fundo escurecido fecha a gaveta', fechou)

        print('\n=== 4. A GAVETA NÃO EMPURRA O CONTEÚDO PRA BAIXO ===')
        # Sem a barra horizontal ocupando altura fixa, o conteúdo começa logo
        # abaixo do cabeçalho — não sobra um vão vazio onde a barra estava.
        topo_conteudo = await pg.evaluate("""() => {
            const main = document.getElementById('main');
            return main.getBoundingClientRect().top;
        }""")
        altura_cabecalho = await pg.evaluate(
            "() => document.getElementById('header').getBoundingClientRect().height")
        ck('o conteúdo começa logo abaixo do cabeçalho, sem vão da barra antiga',
           topo_conteudo < altura_cabecalho + 30, f'topo={topo_conteudo}, cabeçalho={altura_cabecalho}')

        print('\n=== 5. DESKTOP: BARRA LATERAL FIXA (referência Hostinger), SEM GAVETA NEM HAMBÚRGUER ===')
        # Pedido do usuário (08/08/2026), depois de já ter a gaveta no
        # celular: "quero que se aplique ao desktop tambem... pode usar
        # como referencia o site da hostinger painel, pode usar o leyout
        # com o menu tambem no desktop". A barra horizontal antiga saiu do
        # desktop — mesmas divs .nav-tab, agora em coluna fixa à esquerda,
        # sempre visível (não é gaveta: não abre/fecha, não tem overlay).
        ctx2 = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append('desktop: ' + str(e)))
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(600)
        # Tela de entrada própria (16/08/2026): o painel só existe na tela
        # depois de logar — a medição da sidebar exige operador presente.
        await pg2.evaluate("""() => {
            DB.operador = {nome:'Chefe', setor:'Administração'};
            document.getElementById('modal-operador')?.classList.remove('open');
            renderAll();
        }""")
        await pg2.wait_for_timeout(300)
        display_btn_desktop = await pg2.evaluate(
            "() => getComputedStyle(document.getElementById('btn-menu')).display")
        ck('botão hambúrguer NÃO aparece no desktop', display_btn_desktop == 'none', display_btn_desktop)
        info = await pg2.evaluate("""() => {
            const navEl = document.getElementById('nav');
            const mainEl = document.getElementById('main');
            const navR = navEl.getBoundingClientRect();
            const mainR = mainEl.getBoundingClientRect();
            const cs = getComputedStyle(navEl);
            return {
                flexDirection: cs.flexDirection,
                transform: cs.transform,
                navLeft: navR.left, navWidth: navR.width, navHeight: navR.height,
                mainLeft: mainR.left,
                janelaAltura: window.innerHeight,
            };
        }""")
        ck('barra fica em COLUNA (sidebar), não mais em linha horizontal',
           info['flexDirection'] == 'column', info['flexDirection'])
        ck('barra sempre visível — sem transform de gaveta escondida',
           info['transform'] in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), info['transform'])
        ck('barra encostada na borda esquerda da tela', info['navLeft'] == 0, info['navLeft'])
        ck('barra ocupa a altura inteira abaixo do cabeçalho (não só uma faixa)',
           info['navHeight'] > info['janelaAltura'] * 0.7, f"{info['navHeight']}px de {info['janelaAltura']}px")
        ck('conteúdo (#main) começa depois da barra, sem sobrepor',
           info['mainLeft'] >= info['navLeft'] + info['navWidth'] - 1,
           f"main={info['mainLeft']}, nav termina em {info['navLeft']+info['navWidth']}")

        print('\n=== 6. DESKTOP: TROCAR DE ABA CLICANDO NA BARRA LATERAL FUNCIONA ===')
        await pg2.evaluate("() => abrirTab('historico')")
        aba_ativa = await pg2.evaluate("() => TAB_ATUAL")
        ck('abrirTab ainda funciona clicando/chamando a partir da barra lateral',
           aba_ativa == 'historico', aba_ativa)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
