#!/usr/bin/env python3
"""Gera o PDF da apresentação a partir do HTML, em 16:9 de slide (13,33 x 7,5 pol).

POR QUE ESTE ARQUIVO EXISTE
---------------------------
O PDF já foi gerado à mão mais de uma vez, e cada vez foi preciso lembrar
das mesmas três coisas: o tamanho de página de slide, a altura fixa de cada
slide, e que `print_background` precisa estar ligado (senão sai tudo branco,
porque o fundo navy é background). Isso agora está aqui, não na memória de
ninguém.

USO
---
    python3 gerar_pdf.py

Regera Suinco_Apresentacao_Painel.pdf ao lado do HTML.
"""
import asyncio
import pathlib

from playwright.async_api import async_playwright

AQUI = pathlib.Path(__file__).resolve().parent
HTML = AQUI / 'Suinco_Apresentacao_Painel.html'
PDF = AQUI / 'Suinco_Apresentacao_Painel.pdf'
CHROMIUM = '/opt/pw-browsers/chromium'

# 13,33 x 7,5 polegadas é o 16:9 de slide (1280x720 a 96dpi) — o mesmo
# formato do PowerPoint. `margin:0` porque a moldura dourada já é a margem.
FOLHA = """
@page { size: 13.33in 7.5in; margin: 0; }
.slide { height: 7.5in !important; }
"""


async def principal():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM, headless=True)
        pag = await nav.new_page(viewport={'width': 1280, 'height': 720})
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        await pag.goto(HTML.as_uri())
        await pag.wait_for_timeout(1500)
        await pag.add_style_tag(content=FOLHA)
        await pag.pdf(path=str(PDF), width='13.33in', height='7.5in',
                      print_background=True, margin={'top': '0', 'bottom': '0',
                                                     'left': '0', 'right': '0'})
        n = await pag.evaluate("() => document.querySelectorAll('.slide').length")
        await nav.close()
    print(f'{PDF.name}: {n} slides, {PDF.stat().st_size/1_000_000:.1f} MB')
    if erros:
        print('ERROS DE PÁGINA:', erros)


asyncio.run(principal())
