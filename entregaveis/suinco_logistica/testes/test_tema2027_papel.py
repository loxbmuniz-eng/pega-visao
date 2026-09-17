#!/usr/bin/env python3
"""A camada Tema 2027 não pode vazar para o relatório (papel).

`coletarCssDoPainel()` junta TODOS os `<style>` da página — `styles.css` +
qualquer coisa que a camada tenha anexado — e `gerarPdf()` manda isso para
`page.pdf()` do Playwright, que renderiza em mídia `print`. Uma regra do
Tema 2027 fora de `@media screen` chega ao papel mesmo que pareça inofensiva
na tela (ver VEREDITO.md, Stripe e Suíço eliminados pelo critério 4).

O que este teste faz (copiado de
`camp/juiz_print_leak.py`, adaptado para `tema2027/*.css` em vez de
`camada.css` de um competidor):

1. Monta um trecho de HTML com as MESMAS classes que `app.js` usa dentro de
   `.print-page` (`.stat-box/.stat-label/.stat-num`, `th/td`, `.c-placa/
   .c-carga/.c-peso`, `.badge`, `.et-mini`, `.btn`).
2. Renderiza esse trecho em `page.emulate_media(media='print')` com
   `styles.css` puro (referência) e com `styles.css + tema2027/*.css`
   (candidato), tira screenshot cheio dos dois.
3. Compara pixel a pixel com `ImageChops.difference(...).getbbox()`: tem
   de dar `None` — nenhum pixel diferente.
4. CASO DE CONTROLE: roda a MESMA comparação com `styles.css +
   stripe/camada.css` (uma camada que o juiz Fable 5.1 comprovou vazar para
   o papel). Esse caso TEM de reprovar (`getbbox()` != None). Se o caso de
   controle não reprovar, este teste está cego para vazamento e não serve
   de prova — o script para com erro nesse caso, não com "passou".

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_tema2027_papel.py
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright
from PIL import Image, ImageChops

BASE = pathlib.Path(__file__).parent.parent
CAMADA = BASE / 'tema2027'
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')
# Camada de um competidor eliminado pelo juiz por vazar para o papel
# (VEREDITO.md, seção 3 "Stripe — critérios 1, 2 e 4"). Usada só como caso
# de controle negativo — não é preenchida nem editada aqui. É uma CÓPIA
# gravada dentro do repositório (testes/fixtures/), e não um caminho de
# scratchpad de sessão: um controle que só existe na memória de quem rodou
# o teste uma vez deixa de provar nada na próxima sessão ou na Etapa 7.
STRIPE_CONTROLE = pathlib.Path(__file__).parent / 'fixtures' / 'controle_stripe_camada.css'

HTML = """
<div class="print-page doc-normal" style="display:block">
 <div class="print-header"><h1>Relatório Operacional</h1><div class="meta">16/09/2026</div></div>
 <div class="card">
  <div class="card-title">Indicadores</div><div class="card-sub">resumo</div>
  <div class="grid4">
   <div class="stat-box" style="--st-cor:var(--st-aguardando-veiculo-bg)"><div class="stat-num">4</div><div class="stat-label">Aguardando Veículo</div><div class="stat-note">25% do pátio</div></div>
   <div class="stat-box"><div class="stat-num">3</div><div class="stat-label">Aguardando Embarque</div></div>
   <div class="stat-box"><div class="stat-num">3</div><div class="stat-label">Embarque Iniciado</div></div>
   <div class="stat-box"><div class="stat-num">3</div><div class="stat-label">Faturado</div></div>
  </div>
 </div>
 <div class="print-secao">Cargas</div>
 <div class="table-wrap"><table class="tabela-patio">
  <thead><tr><th class="c-seq">Seq</th><th class="c-carga">Nº Carga</th><th class="c-placa">Placa</th><th class="c-transp">Transportadora</th><th class="c-peso">Peso (kg)</th><th class="c-status">Status</th></tr></thead>
  <tbody>
   <tr><td class="c-seq">1</td><td class="c-carga">118800</td><td class="c-placa">RNW7J50</td><td class="c-transp">BAIXOTES TRANSPORTE</td><td class="c-peso">2.952</td><td class="c-status"><span class="badge badge-aguardando-veiculo" style="background:var(--st-aguardando-veiculo-bg);color:var(--st-aguardando-veiculo-fg)">AGUARDANDO VEÍCULO</span></td></tr>
   <tr><td class="c-seq">2</td><td class="c-carga">118801</td><td class="c-placa">RNW7J51</td><td class="c-transp">AJB TRANSPORTES</td><td class="c-peso">3.089</td><td class="c-status"><span class="badge" style="background:var(--st-faturado-bg);color:var(--st-faturado-fg)">FATURADO</span></td></tr>
   <tr class="linha-total"><td colspan="4">Total</td><td class="tot-num">6.041</td><td></td></tr>
  </tbody></table></div>
 <div class="print-bloco-tit">Linha do tempo</div>
 <div class="et-mini et-ok">✓ 08:10</div> <div class="et-mini et-atual">● 09:00</div> <div class="et-mini et-pendente">· —</div>
 <button class="btn btn-primary">Botão</button>
</div>
"""

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def renderizar(pg, css_extra, caminho_saida):
    css_base = (BASE / 'styles.css').read_text(encoding='utf-8')
    doc = (
        '<!doctype html><html><head><meta charset="utf-8">'
        f'<style>{css_base}\n{css_extra}</style>'
        '<style>@page{size:A4 portrait;margin:5mm}</style>'
        f'</head><body>{HTML}</body></html>'
    )
    await pg.set_content(doc)
    await pg.wait_for_timeout(200)
    await pg.screenshot(path=str(caminho_saida), full_page=True)


def diferem(caminho_a, caminho_b):
    a = Image.open(caminho_a).convert('RGB')
    b = Image.open(caminho_b).convert('RGB')
    if a.size != b.size:
        return f'tamanho mudou {a.size}->{b.size}'
    bbox = ImageChops.difference(a, b).getbbox()
    return f'pixels diferentes na área {bbox}' if bbox else None


async def main():
    saida_dir = pathlib.Path('/tmp/claude-0/-home-user-pega-visao'
                              '/82f87c99-e223-5c72-91d0-65150266c838/scratchpad'
                              '/tema2027_papel')
    saida_dir.mkdir(parents=True, exist_ok=True)

    css_tema2027 = '\n'.join(
        p.read_text(encoding='utf-8') for p in sorted(CAMADA.glob('*.css'))
    )

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page(viewport={'width': 900, 'height': 900})
        await pg.emulate_media(media='print')

        ref = saida_dir / 'print_ref.png'
        await renderizar(pg, '', ref)

        t27 = saida_dir / 'print_t27.png'
        await renderizar(pg, css_tema2027, t27)

        diff_t27 = diferem(ref, t27)
        # O rótulo diz o TAMANHO do que foi medido, não um adjetivo fixo.
        # Ele nasceu escrito "(vazio)", quando as seis camadas ainda eram
        # arquivos em branco. Quando elas encheram, o teste continuou certo
        # (lê os arquivos na hora, logo acima) mas passou a IMPRIMIR uma
        # mentira — "vazio" sobre 285 linhas de CSS. Saída que mente é pior
        # que teste que falta: ela é lida como prova.
        quantos = len(list(CAMADA.glob('*.css')))
        ck(f'tema2027/*.css ({quantos} arquivos, {len(css_tema2027)} bytes) '
           f'não vaza para o papel', diff_t27 is None, diff_t27 or '')

        if STRIPE_CONTROLE.exists():
            stripe_css = STRIPE_CONTROLE.read_text(encoding='utf-8')
            stripe_png = saida_dir / 'print_stripe_controle.png'
            await renderizar(pg, stripe_css, stripe_png)
            diff_stripe = diferem(ref, stripe_png)
            ck('CASO DE CONTROLE: stripe/camada.css TEM de vazar (prova que o teste enxerga)',
               diff_stripe is not None, diff_stripe or 'nenhuma diferença — teste está CEGO')
        else:
            ck('CASO DE CONTROLE: stripe/camada.css encontrado', False,
               f'não encontrado em {STRIPE_CONTROLE}')

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
