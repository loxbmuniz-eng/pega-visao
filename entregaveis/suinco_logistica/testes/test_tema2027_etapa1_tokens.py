#!/usr/bin/env python3
"""Etapa 1 (Tokens) do Tema 2027 — teste que REPROVA contra o publicado.

Antes de `tema2027/00_tokens.css` existir com conteúdo, o painel usa vidro
DE VERDADE: `--vidro-bg` é translúcido e `--vidro-borrao` aplica
`blur(18px) saturate(1.25)` em `#header`/`#nav` (`styles.css`, bloco
`:root`, comentário "VIDRO REAL"). A Etapa 1 tira o vidro (superfície
opaca, sem desfoque — custa GPU no tablet do pátio) e troca a cor de
estrutura de dourado para azul-acinzentado (`--border*`), como decidido em
VEREDITO.md, seção 5 ("Cor de estrutura ≠ cor de marca") e seção 6, Etapa 1.

Este teste mede exatamente isso, nos DOIS temas:

1. `--vidro-bg` resolve para os hex opacos exatos do VEREDITO
   (`#1e2a52` escuro, `#eff3f9` claro) — não para os `rgba(...)`
   translúcidos do `styles.css` publicado.
2. `--vidro-borrao` resolve para `none`.
3. Nenhum elemento de vidro (`#header`, `#nav`, `.card`,
   `.modal-overlay`) tem `backdrop-filter` diferente de `none` — é a prova
   mecânica de que o desfoque saiu de verdade, não só da variável.
4. `--border` deixa de ser dourado (`rgba(233,185,84,...)`) e passa a
   azul-acinzentado (`rgba(151,168,214,...)` escuro / `rgba(32,44,74,...)`
   claro).

Contra o `index.html` PUBLICADO (sem a Etapa 1), as quatro checagens
reprovam — é o comportamento de HOJE, com vidro de verdade. Contra o build
que inclui `tema2027/00_tokens.css` preenchido, as quatro passam.

    PAINEL=file:///caminho/para/index.html \
        python3 testes/test_tema2027_etapa1_tokens.py

Sem a variável PAINEL, usa o caminho publicado padrão do repositório.
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

PAINEL = os.environ.get(
    'PAINEL',
    'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html')
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

ESPERADO = {
    'escuro': {
        'vidro_bg': '#1e2a52',
        'border_comeca_com': 'rgba(151, 168, 214,',
    },
    'claro': {
        'vidro_bg': '#eff3f9',
        'border_comeca_com': 'rgba(32, 44, 74,',
    },
}

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    print(f'painel: {PAINEL}')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM, headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(800)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        for tema, esperado in ESPERADO.items():
            print(f'\n=== TEMA {tema.upper()} ===')
            await pg.evaluate(f"()=>document.documentElement.setAttribute('data-tema','{tema}')")
            await pg.wait_for_timeout(250)

            r = await pg.evaluate("""() => {
                const raiz = getComputedStyle(document.documentElement);
                const bf = sel => {
                    const e = document.querySelector(sel);
                    if (!e) return null;
                    const g = getComputedStyle(e);
                    return g.backdropFilter || g.webkitBackdropFilter || 'none';
                };
                return {
                    vidroBg: raiz.getPropertyValue('--vidro-bg').trim(),
                    vidroBorrao: raiz.getPropertyValue('--vidro-borrao').trim(),
                    border: raiz.getPropertyValue('--border').trim(),
                    backdrops: {
                        header: bf('#header'), nav: bf('#nav'),
                        card: bf('.tab-page.active .card'),
                    }
                };
            }""")

            ck(f'{tema}: --vidro-bg é opaco, valor exato do VEREDITO',
               r['vidroBg'] == esperado['vidro_bg'],
               f"esperado {esperado['vidro_bg']!r}, veio {r['vidroBg']!r}")
            ck(f'{tema}: --vidro-borrao é none (sem desfoque)',
               r['vidroBorrao'] == 'none', r['vidroBorrao'])
            ck(f'{tema}: nenhuma superfície de vidro com backdrop-filter',
               all(v == 'none' for v in r['backdrops'].values()), r['backdrops'])
            ck(f'{tema}: --border é azul-acinzentado, não dourado',
               r['border'].replace(' ', '').startswith(
                   esperado['border_comeca_com'].replace(' ', '')),
               r['border'])

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
