#!/usr/bin/env python3
"""Pagamento de Frete: os botões de ação ficam À VISTA em todo notebook (07/10/2026).

ACHADO olhando a tela como o usuário vê (foto da vitrine em 1366 px, o
notebook mais comum): a coluna Ações saía da área visível da tabela —
"Editar" cortado, "Excluir" quase sumido. Os botões viram ícone só até
1360 px; 1366 ficou de fora por 6 px. O teste antigo media "a tabela não
rola para o lado" em 1400 px — um atalho: não perguntava se o BOTÃO aparece.

O QUE ESTE TESTE TRAVA, em 1280, 1366, 1440, 1536, 1600 e 1920 px, com o
menu lateral aberto, na vitrine (a mesma tela, com as cargas de exemplo):
  1. todo botão da coluna Ações da primeira carga está inteiro dentro da
     área visível da tabela e da janela;
  2. a tabela não rola para o lado.

    bash testes/rodar_tudo.sh test_pagamento_frete_acoes_visiveis
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
VITRINE = 'file://' + os.path.join(os.path.dirname(AQUI), 'vitrine', 'vitrine.html')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


MEDIR = """() => {
  const wrap = document.querySelector('#tab-frete .frete-wrap');
  const linha = document.querySelector('#frete-tbody tr.frete-carga-linha');
  if (!wrap || !linha) return { semTabela: true };
  const caixa = wrap.getBoundingClientRect();
  const botoes = [...linha.querySelectorAll('td.frete-acoes .btn, td.frete-acoes button')]
    .filter(b => b.offsetParent !== null)
    .map(b => { const r = b.getBoundingClientRect();
      return { rotulo: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 20),
               esquerda: Math.round(r.left), direita: Math.round(r.right) }; });
  const limite = Math.min(caixa.right, window.innerWidth);
  return { botoes: botoes.length, rola: wrap.scrollWidth > wrap.clientWidth + 1,
           fora: botoes.filter(b => b.direita > limite + 0.5 || b.esquerda < caixa.left - 0.5),
           limite: Math.round(limite) };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        for largura in (1280, 1366, 1440, 1536, 1600, 1920):
            pg = await nav.new_page(viewport={'width': largura, 'height': 900})
            await pg.goto(VITRINE)
            await pg.wait_for_timeout(2000)
            await pg.evaluate("() => abrirTab('frete')")
            await pg.wait_for_timeout(1200)
            m = await pg.evaluate(MEDIR)
            print(f'\n=== {largura}px ===')
            if m.get('semTabela'):
                ck(f'{largura}: a tabela do frete aparece', False, str(m))
                await pg.close()
                continue
            ck(f'{largura}: há botões de ação na carga', m['botoes'] >= 3, str(m['botoes']))
            ck(f'{largura}: todo botão de ação inteiro à vista', not m['fora'], str(m['fora']) + f" (limite {m['limite']}px)")
            ck(f'{largura}: a tabela não rola para o lado', not m['rola'])
            await pg.close()
        await nav.close()

    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
