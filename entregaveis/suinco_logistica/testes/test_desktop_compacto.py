#!/usr/bin/env python3
"""Desktop também precisa ser compacto — não só o celular.

Pedido do usuário (08/08/2026), na sequência direta do refinamento mobile
desta mesma sessão: "a oimizacao de espaco agora quero que se aplique ao
desktop view tambem, ta tudo usando muito espaco ai, podem ser menores as
coisas, te que rolar muito pra ver tudo, em todas as abas, faca algo maasi
compacto". Confirmou em seguida: layout com menu/barra lateral também no
desktop, usando o hPanel da Hostinger como referência.

Este teste trava os dois pedidos:
1. A barra de navegação virou coluna fixa à esquerda no desktop (não mais
   barra horizontal) — cobertura principal fica em test_menu_gaveta_mobile.py
   (seções 5 e 6); aqui só confirma que ela está de fato mais estreita que
   o conteúdo, coexistindo com o resto do layout.
2. Espaçamento (padding de card, de célula de tabela, tamanho de número de
   indicador) ficou objetivamente menor do que estava antes desta correção
   — não é comparação com o passado, é limite absoluto que qualquer
   regressão futura pra "solta tudo de novo" vai estourar.

    python3 testes/test_desktop_compacto.py
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
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate("""() => {
            DB.operador = {nome:'Chefe', setor:'Administração'};
            document.getElementById('modal-operador')?.classList.remove('open');
            // Tela de entrada própria (16/08/2026): o painel só aparece
            // após um render com operador — como todo login real faz.
            renderAll();
        }""")
        await pg.wait_for_timeout(400)

        print('\n=== 1. BARRA LATERAL FIXA COEXISTE COM O CONTEÚDO ===')
        geo = await pg.evaluate("""() => {
            const navR = document.getElementById('nav').getBoundingClientRect();
            const mainR = document.getElementById('main').getBoundingClientRect();
            return { navWidth: navR.width, mainWidth: mainR.width };
        }""")
        ck('barra lateral é bem mais estreita que o conteúdo (não é 50/50)',
           geo['navWidth'] < geo['mainWidth'] * 0.3, str(geo))

        print('\n=== 2. CARD: PADDING E MARGEM MENORES DO QUE OS 18PX ANTIGOS ===')
        card = await pg.evaluate("""() => {
            const el = document.querySelector('.card');
            const cs = getComputedStyle(el);
            return { paddingTop: parseFloat(cs.paddingTop), marginBottom: parseFloat(cs.marginBottom) };
        }""")
        ck('padding do card <= 16px (era 18px)', card['paddingTop'] <= 16, f"{card['paddingTop']}px")
        ck('margem entre cards <= 14px (era 18px)', card['marginBottom'] <= 14, f"{card['marginBottom']}px")

        print('\n=== 3. TABELA: CÉLULAS MAIS BAIXAS ===')
        cel = await pg.evaluate("""() => {
            const th = document.querySelector('th');
            const cs = getComputedStyle(th);
            return { paddingTop: parseFloat(cs.paddingTop) };
        }""")
        ck('padding vertical do cabeçalho de tabela <= 9px (era 10px)',
           cel['paddingTop'] <= 9, f"{cel['paddingTop']}px")

        print('\n=== 4. INDICADORES: NÚMERO DE DESTAQUE MENOR ===')
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(300)
        num = await pg.evaluate("""() => {
            // O primeiro .stat-num pode ser de uma caixa .stat-destaque
            // (fonte maior de propósito, --fs-numero-grande) — pega uma
            // caixa comum pra testar o tamanho padrão (--fs-numero).
            const el = document.querySelector('.stat-box:not(.stat-destaque) .stat-num');
            return el ? parseFloat(getComputedStyle(el).fontSize) : null;
        }""")
        ck('fonte do número comum do indicador <= 27px (era 30px)', num is not None and num <= 27, f"{num}px")

        print('\n=== 5. A PÁGINA CABE COM MENOS ROLAGEM DO QUE ANTES (Torre) ===')
        altura = await pg.evaluate("() => document.body.scrollHeight")
        # Não é um número mágico — é uma bandeira alta o bastante pra pegar
        # regressão grosseira (voltar ao espaçamento antigo somaria mais de
        # 1000px extras só na Torre com 0 cargas).
        ck('altura da Torre (sem cargas) fica abaixo de 1400px', altura < 1400, f"{altura}px")

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
