#!/usr/bin/env python3
"""O painel inteiro na linguagem do Pátio ao vivo (28/09/2026).

PEDIDO DO DONO: "EU PEDI UMA REFORMA COMPLETA UM REBRANDING DO UI DESIGN
MOTION COMPLETO DE TODAS AS ABAS" — com a regra dele por cima: "todos os
campos que são de edição precisam seguir firmes a mesma estrutura".

A camada é tema2027/80_sofisticado.css. Este teste trava as decisões dela
e, junto, as fronteiras que ela NÃO pode cruzar:

  1. no computador, título de cartão na letra condensada, caixa normal, cor
     do texto, sem a barrinha dourada (REPROVA contra o publicado, que tinha
     caixa alta miúda com barra);
  2. no celular, o título continua sendo o botão do acordeão: alvo ≥ 44px;
  3. `th` nunca em caixa alta, em nenhuma tabela, nas duas larguras;
  4. o cabeçalho da Torre continua na letra larga (10px condensado não se lê);
  5. botão na letra larga, e afunda no toque (scale), não sobe no hover;
  6. "reduzir movimento" desliga a entrada da aba e dos blocos;
  7. a Torre continua com as 12 colunas.

    python3 testes/test_painel_sofisticado.py
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


ENTRAR = """() => {
    DB.operador = {nome:'Chefe', setor:'Administração'};
    document.getElementById('modal-operador')?.classList.remove('open');
    renderAll();
}"""

MEDIR = """(aba) => {
    abrirTab(aba);
    const cs = (el, p) => el ? getComputedStyle(el)[p] : null;
    const tit = document.querySelector('.tab-page.active .card-title');
    const barra = tit ? getComputedStyle(tit, '::before') : null;
    // .vp-carga/.vp-placa (Visão do Pátio) já eram caixa alta na base,
    // antes desta camada, por regra de classe — não é o th que muda.
    const ths = [...document.querySelectorAll('th:not(.vp-carga):not(.vp-placa)')];
    const thTorre = document.querySelector('#torre-tabela th');
    const btn = document.querySelector('.tab-page.active .btn');
    const r = tit ? tit.getBoundingClientRect() : {height:0};
    return {
      titFamilia: cs(tit, 'fontFamily'), titCaixa: cs(tit, 'textTransform'),
      titCor: cs(tit, 'color'), textoCor: getComputedStyle(document.body).color,
      barra: barra ? barra.display : null, titAltura: r.height,
      thCaixaAlta: ths.filter(t => getComputedStyle(t).textTransform === 'uppercase').length,
      thTorreFamilia: cs(thTorre, 'fontFamily'),
      colunasTorre: document.querySelectorAll('#torre-tabela thead th').length,
      btnFamilia: cs(btn, 'fontFamily'),
      animAba: cs(document.querySelector('.tab-page.active'), 'animationName'),
    };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []

        print('\n=== 1. COMPUTADOR ===')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(ENTRAR)
        d = await pg.evaluate(MEDIR, 'torre')
        print('  ', d)
        ck('título de cartão na letra condensada', (d['titFamilia'] or '').startswith('"Barlow Condensed"'), d['titFamilia'])
        ck('título de cartão em caixa normal', d['titCaixa'] == 'none', d['titCaixa'])
        ck('título de cartão na cor do texto, não dourado', d['titCor'] == d['textoCor'], f"{d['titCor']} vs {d['textoCor']}")
        ck('a barrinha dourada do título saiu', d['barra'] == 'none', d['barra'])
        ck('nenhum th em caixa alta', d['thCaixaAlta'] == 0, str(d['thCaixaAlta']))
        ck('cabeçalho da Torre continua na letra larga', not (d['thTorreFamilia'] or '').startswith('"Barlow Condensed"'),
           d['thTorreFamilia'])
        ck('a Torre continua com 12 colunas', d['colunasTorre'] == 12, str(d['colunasTorre']))
        ck('botão na Barlow larga (era Arial: o navegador não passa a letra ao botão)',
           (d['btnFamilia'] or '').startswith('Barlow'), d['btnFamilia'])
        ck('a aba entra com movimento', d['animAba'] not in (None, 'none'), d['animAba'])

        toque = await pg.evaluate("""() => {
            const b = document.querySelector('.tab-page.active .btn');
            const regras = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch(e) { return [] } });
            const todas = [];
            const andar = rs => rs.forEach(r => { if(r.selectorText) todas.push(r); else if(r.cssRules) andar([...r.cssRules]); });
            andar(regras);
            const ativo = todas.filter(r => r.selectorText === '.btn:active').map(r => r.style.transform).filter(Boolean).pop();
            const hover = todas.filter(r => r.selectorText === '.btn:hover').map(r => r.style.transform).filter(Boolean).pop();
            return {ativo, hover};
        }""")
        ck('botão afunda no toque (scale)', 'scale' in (toque['ativo'] or ''), str(toque))
        ck('botão não sobe no hover', toque['hover'] in (None, 'none'), str(toque))
        await pg.close()

        print('\n=== 2. CELULAR: O TÍTULO É O BOTÃO DO ACORDEÃO ===')
        pg = await nav.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(ENTRAR)
        m = await pg.evaluate(MEDIR, 'portaria')
        print('  ', {k: m[k] for k in ('titFamilia', 'titAltura', 'thCaixaAlta')})
        ck('título na letra condensada também no celular', (m['titFamilia'] or '').startswith('"Barlow Condensed"'), m['titFamilia'])
        ck('alvo do título continua ≥ 44px', m['titAltura'] >= 44, f"{m['titAltura']:.1f}px")
        ck('nenhum th em caixa alta no celular', m['thCaixaAlta'] == 0, str(m['thCaixaAlta']))
        await pg.close()

        print('\n=== 3. REDUZIR MOVIMENTO DESLIGA A ENTRADA ===')
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        pg = await ctx.new_page()
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(ENTRAR)
        r = await pg.evaluate(MEDIR, 'historico')
        bloco = await pg.evaluate("() => getComputedStyle(document.querySelector('.tab-page.active > .card')).animationName")
        ck('aba sem animação', r['animAba'] == 'none', r['animAba'])
        ck('bloco sem animação', bloco == 'none', bloco)
        await ctx.close()

        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
