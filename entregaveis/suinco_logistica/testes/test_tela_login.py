#!/usr/bin/env python3
"""A tela de login é uma tela — o painel não aparece atrás dela.

PEDIDO DO DONO (16/08/2026): "quando abre a página do login mostra o fundo
do painel, isso não pode acontecer, faça uma apresentação melhor".

O login era um modal translúcido POR CIMA do painel já montado: quem ainda
não entrou enxergava cabeçalho, abas e dados de carga ao fundo. Além de
feio, mostrava informação de operação a quem ainda não se identificou —
num terminal de pátio compartilhado, é a tela que fica exposta o dia todo.

O que este teste garante:
  1. Antes de entrar, NADA do painel está visível (header, nav, rodapé).
  2. A tela de login está visível, com a marca e a versão do build.
  3. Depois de entrar, o painel aparece e a tela de login some.
  4. "Trocar usuário" volta a esconder o painel (privacidade no terminal
     compartilhado).
  5. Quem JÁ tem sessão salva não vê a tela de login ao recarregar.

    python3 testes/test_tela_login.py
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


async def visivel(pg, sel):
    return await pg.evaluate("""(sel) => {
        const el = document.querySelector(sel);
        if(!el) return false;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    }""", sel)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1000)

        print('\n=== 1. ANTES DE ENTRAR: O PAINEL NÃO EXISTE NA TELA ===')
        ck('cabeçalho do painel NÃO está visível', not await visivel(pg, '#header'))
        ck('abas de navegação NÃO estão visíveis', not await visivel(pg, '.nav-tab'))
        ck('rodapé de conexão NÃO está visível', not await visivel(pg, '#rodape-conexao'))
        ck('a tela de login ESTÁ visível', await visivel(pg, '#modal-operador'))

        print('\n=== 2. APRESENTAÇÃO: MARCA E VERSÃO NA TELA DE ENTRADA ===')
        ck('o nome do sistema aparece na tela de entrada',
           await visivel(pg, '#login-marca'))
        versao = await pg.evaluate(
            "() => (document.getElementById('login-versao')||{}).textContent || ''")
        ck('a versão do build aparece na entrada', len(versao.strip()) > 0, repr(versao))
        fundo_opaco = await pg.evaluate("""() => {
            const cs = getComputedStyle(document.getElementById('modal-operador'));
            // rgba com alfa < 1 deixaria o painel vazar por trás.
            const m = cs.backgroundColor.match(/rgba\\([^)]*,\\s*([\\d.]+)\\)/);
            return !m || Number(m[1]) >= 0.99;
        }""")
        ck('o fundo da tela de entrada é opaco (nada vaza por trás)', fundo_opaco)

        print('\n=== 3. ENTRAR MOSTRA O PAINEL E ESCONDE O LOGIN ===')
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(700)
        ck('cabeçalho visível após entrar', await visivel(pg, '#header'))
        ck('login sumiu após entrar', not await visivel(pg, '#modal-operador'))

        print('\n=== 4. TROCAR USUÁRIO ESCONDE O PAINEL DE NOVO ===')
        await pg.evaluate("() => trocarUsuario()")
        await pg.wait_for_timeout(500)
        ck('painel escondido ao trocar usuário', not await visivel(pg, '#header'))
        ck('tela de login voltou', await visivel(pg, '#modal-operador'))

        print('\n=== 5. SESSÃO SALVA: RECARREGAR NÃO MOSTRA LOGIN ===')
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)
        await pg.reload()
        await pg.wait_for_timeout(1000)
        ck('com sessão salva, painel aparece direto', await visivel(pg, '#header'))
        ck('com sessão salva, login não aparece', not await visivel(pg, '#modal-operador'))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
