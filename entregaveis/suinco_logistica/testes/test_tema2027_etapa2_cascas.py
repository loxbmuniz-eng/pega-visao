#!/usr/bin/env python3
"""Tema 2027, Etapa 2 (cascas) — teste que REPROVA contra o publicado e
PASSA com o build novo.

VEREDITO.md, seção 6, Etapa 2, dá o CSS exato de `tema2027/10_cascas.css`
(header/nav opacos sem vidro, `.card-title` em caixa alta e mais compacto,
`.badge-setor` deixa de ser pílula, `.modal-box` com raio maior, aba ativa
por preenchimento). Este teste mede, em navegador real (mesma técnica de
`test_tema2027_papel.py`, mas em mídia SCREEN — é exatamente o que muda na
TELA, não no papel), um conjunto de propriedades computadas que só fazem
sentido com a camada aplicada — e confirma que elas NÃO existem no estado
"publicado" (sem `tema2027/10_cascas.css`, que é como o Etapa 0 deixou o
arquivo: vazio).

Cobre também a GUARDA CONTRA O DEFEITO DO APPLE (VEREDITO.md, seção 3):
o competidor Apple foi eliminado por escrever `#nav{position:relative}` e
derrubar o `fixed` da base, empurrando a página inteira 484px. Aqui
`#header` e `#nav` têm que continuar `position:fixed` TANTO antes quanto
depois — isso não é uma diferença esperada, é uma invariante.

Uso:
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_tema2027_etapa2_cascas.py
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
CAMADA = BASE / 'tema2027' / '10_cascas.css'
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

# Mesma ideia de fixture do `test_tema2027_papel.py`: um recorte do DOM real
# com as classes/ids que a Etapa 2 é dona (ver cabeçalho de
# `tema2027/10_cascas.css`), não dado de operação nenhum.
HTML = """
<div id="header">
  <div id="logo-chip">SUINCO</div>
  <div id="header-mid">
    <span class="badge-setor">Logística</span>
  </div>
</div>
<div id="nav">
  <div class="nav-tab">Programação</div>
  <div class="nav-tab active">Torre de Controle</div>
  <div class="nav-tab">Indicadores</div>
</div>
<div id="main">
  <div class="card">
    <div class="card-title">Torre de Controle — todas as cargas em aberto</div>
    <div class="card-sub">resumo da aba</div>
  </div>
  <div class="funcao-aba">
    <div class="funcao-linha"><span class="funcao-chip">Logística</span></div>
  </div>
</div>
<div class="modal-overlay open">
  <div class="modal-box"><h2>Confirmar</h2></div>
</div>
"""

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f' — {detalhe}' if detalhe else ''))
    if not ok:
        falhas.append(nome)


MEDIR = """() => {
  const cs = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
  return {
    headerPos: cs('#header', 'position'),
    navPos: cs('#nav', 'position'),
    headerBackdrop: cs('#header', 'backdropFilter'),
    navBackdrop: cs('#nav', 'backdropFilter'),
    headerBgImage: cs('#header', 'backgroundImage'),
    badgeRadius: cs('.badge-setor', 'borderRadius'),
    cardTitleTransform: cs('.card-title', 'textTransform'),
    cardPadding: cs('.card', 'padding'),
    modalRadius: cs('.modal-box', 'borderRadius'),
    navActiveWeight: cs('.nav-tab.active', 'fontWeight'),
  };
}"""


async def renderizar(pg, css_extra):
    css_base = (BASE / 'styles.css').read_text(encoding='utf-8')
    doc = (
        '<!doctype html><html><head><meta charset="utf-8">'
        f'<style>{css_base}\n{css_extra}</style>'
        f'</head><body>{HTML}</body></html>'
    )
    await pg.set_content(doc)
    await pg.wait_for_timeout(150)
    return await pg.evaluate(MEDIR)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})

        publicado = await renderizar(pg, '')  # tema2027/10_cascas.css como a Etapa 0 deixou: vazio
        novo = await renderizar(pg, CAMADA.read_text(encoding='utf-8'))

        await nav.close()

    print('publicado:', publicado)
    print('novo:     ', novo)
    print()

    # Invariante: nunca deixa de ser fixed, nem antes nem depois (guarda Apple).
    ck('#header position:fixed no publicado', publicado['headerPos'] == 'fixed', publicado['headerPos'])
    ck('#header position:fixed no novo', novo['headerPos'] == 'fixed', novo['headerPos'])
    ck('#nav position:fixed no publicado', publicado['navPos'] == 'fixed', publicado['navPos'])
    ck('#nav position:fixed no novo', novo['navPos'] == 'fixed', novo['navPos'])

    # A partir daqui: cada par PRECISA diferir — se não diferir, o "novo" não
    # está aplicando a camada (e o teste não reprovaria o publicado de verdade).
    pares = [
        ('#header vidro sai (backdrop-filter)', 'headerBackdrop', 'none'),
        ('#nav vidro sai (backdrop-filter)', 'navBackdrop', 'none'),
        ('.badge-setor deixa de ser pílula (border-radius)', 'badgeRadius', '6px'),
        ('.card-title vira caixa alta (text-transform)', 'cardTitleTransform', 'uppercase'),
        ('.modal-box ganha --radius-lg (border-radius)', 'modalRadius', '14px'),
        ('.nav-tab.active ganha peso 700 (era 600, herdado de .nav-tab)', 'navActiveWeight', '700'),
    ]
    for nome, chave, esperado_novo in pares:
        ck(f'REPROVA contra o publicado: {nome} ainda não é "{esperado_novo}"',
           publicado[chave] != esperado_novo,
           f'publicado já teria {chave}={publicado[chave]!r} (o teste não discrimina)')
        ck(f'PASSA no novo: {nome} == "{esperado_novo}"',
           novo[chave] == esperado_novo, f'novo {chave}={novo[chave]!r}')

    print('\n=== RESULTADO ===')
    print('FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
