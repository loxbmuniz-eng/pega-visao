#!/usr/bin/env python3
"""Histórico no celular: a carga aberta cabe numa olhada (07/10/2026).

RELATO DO DONO: "no histórico pelo celular, quando abro uma carga pra ver,
ainda abre um negócio gigante no cartão que utiliza quase duas telas rolando
pra baixo (...) deixou padronizado, seguindo /apple-design".

MEDIDO a 390 × 844 (iPhone), na vitrine: a carga aberta media 776 px — 0,92
de tela — com uma carga de demonstração quase vazia. Já tinha sido compactada
em 23/08 (1.139 → 812 px), e voltou a crescer quando o piso de 12 px
alargou os rótulos: a coluna de 116 px passou a quebrar em duas linhas e os
dois botões voltaram a empilhar. E o cartão repetia o que a linha fechada já
mostra (data, etapa, operador), o id técnico ocupava três linhas e campo
vazio aparecia só para dizer "—".

O QUE ESTE TESTE TRAVA, pela tela, tocando a linha como a pessoa faz, em
cada uma das 8 primeiras linhas do Histórico:
  1. a carga aberta ocupa no máximo 60% da tela (506 px). Medido depois da
     correção: 485 px (era 787). Meia tela pediria juntar campos diferentes
     numa linha só — isso muda o conteúdo, não o arranjo, e foi levado ao
     dono como proposta; a guarda trava o ganho medido;
  2. nenhum campo vazio ("—") e nada repetido da linha fechada à vista;
  3. os dois botões lado a lado, com alvo de toque de 44 px;
  4. nenhuma letra abaixo de 12 px;
  5. no computador nada muda: o cartão continua com a seção "Este registro"
     e o id da carga.

    bash testes/rodar_tudo.sh test_historico_cartao_celular
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
VITRINE = 'file://' + os.path.join(os.path.dirname(AQUI), 'vitrine', 'vitrine.html')
ALTURA_TELA = 844

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


MEDIR = r"""(det) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const campos = [...det.querySelectorAll('.hist-campo')].filter(vis);
  const vazios = campos.filter(c => (c.querySelector('dd') || {}).textContent.trim() === '—').map(c => c.querySelector('dt').textContent.trim());
  const secoes = [...det.querySelectorAll('.hist-det-secao')].filter(vis).map(s => s.textContent.trim());
  const id = campos.some(c => /carga \(id\)/i.test(c.querySelector('dt').textContent));
  const botoes = [...det.querySelectorAll('.hist-det-acoes .btn')].filter(vis).map(b => b.getBoundingClientRect());
  const pequenos = [...det.querySelectorAll('*')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(f => f < 12);
  return { altura: Math.round(det.getBoundingClientRect().height), vazios, secoes, id,
           ladoALado: botoes.length === 2 && Math.abs(botoes[0].top - botoes[1].top) < 2,
           alvo: botoes.length ? Math.min(...botoes.map(b => b.height)) : 0, pequenos: pequenos.length };
}"""


async def abrir_historico(pg, celular):
    if celular:
        await pg.click('#btn-menu')
        await pg.wait_for_timeout(400)
    await pg.click('.nav-tab[data-tab="historico"]')
    await pg.wait_for_timeout(1200)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')

        print('\n=== CELULAR 390 × 844 ===')
        ctx = await nav.new_context(viewport={'width': 390, 'height': ALTURA_TELA}, is_mobile=True, has_touch=True, device_scale_factor=2)
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(VITRINE)
        await pg.wait_for_timeout(2500)
        await abrir_historico(pg, True)
        linhas = pg.locator('#hist-tbody tr.hist-linha')
        n = min(8, await linhas.count())
        ck('o Histórico tem linhas para abrir', n >= 3, str(n))
        maior, piores = 0, []
        for i in range(n):
            await linhas.nth(i).scroll_into_view_if_needed()
            await linhas.nth(i).tap()
            await pg.wait_for_timeout(400)
            det = pg.locator('#hist-tbody tr.hist-detalhe:not([hidden])').first
            m = await det.evaluate(MEDIR)
            maior = max(maior, m['altura'])
            if m['altura'] > ALTURA_TELA * .6 or m['vazios'] or 'Este registro' in m['secoes'] or m['id'] \
               or not m['ladoALado'] or m['alvo'] < 44 or m['pequenos']:
                piores.append(dict(m, linha=i))
            await linhas.nth(i).tap()            # fecha de novo, como a pessoa faz
            await pg.wait_for_timeout(250)
        ck(f'a carga aberta ocupa no máximo 60% da tela ({int(ALTURA_TELA * .6)} px)', maior <= ALTURA_TELA * .6, f'maior: {maior} px')
        ck('nenhum campo vazio ("—") à vista', not any(x['vazios'] for x in piores), str([x['vazios'] for x in piores][:2]))
        ck('nada repetido da linha fechada (sem "Este registro" nem o id técnico)',
           not any('Este registro' in x['secoes'] or x['id'] for x in piores), str([x['secoes'] for x in piores][:2]))
        ck('os dois botões lado a lado, com 44 px de alvo', not any(not x['ladoALado'] or x['alvo'] < 44 for x in piores),
           str([(x['ladoALado'], x['alvo']) for x in piores][:2]))
        ck('nenhuma letra abaixo de 12 px', not any(x['pequenos'] for x in piores), str([x['pequenos'] for x in piores][:2]))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await ctx.close()

        print('\n=== COMPUTADOR 1366 px: NADA MUDA ===')
        pg = await nav.new_page(viewport={'width': 1366, 'height': 900})
        await pg.goto(VITRINE)
        await pg.wait_for_timeout(2500)
        await abrir_historico(pg, False)
        await pg.locator('#hist-tbody tr.hist-linha').first.click()
        await pg.wait_for_timeout(400)
        m = await pg.locator('#hist-tbody tr.hist-detalhe:not([hidden])').first.evaluate(MEDIR)
        ck('no computador o cartão continua com "Este registro" e o id da carga', 'Este registro' in m['secoes'] and m['id'], str(m))
        await nav.close()

    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
