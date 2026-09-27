#!/usr/bin/env python3
"""Indicadores atualizam no lugar, com a letra do painel embutida (26/09/2026).

PEDIDO DO DONO: a aba Indicadores com a qualidade da tela de demonstração
"Pátio ao vivo", e a letra Barlow "no painel inteiro".

A DIFERENÇA ENTRE AS DUAS TELAS NÃO ERA O DESENHO. A aba é redesenhada a
cada sincronia, e o motor de gráficos (graficos2027.js) apagava e recriava
tudo: a linha voltava a se desenhar, as barras nasciam do zero, a fila se
reabria — a cada poucos segundos, sem nada ter mudado. Movimento repetido
sem motivo vira tremedeira. Este teste trava o conserto:

  1. a letra é a Barlow, e vem EMBUTIDA no arquivo — nenhuma requisição a
     servidor de fonte, porque o painel precisa abrir sem internet;
  2. uma sincronia sem mudança NÃO recria o gráfico, o ranking nem a fila;
  3. quando a ordem do ranking muda, as linhas são as MESMAS, só trocam de
     lugar — é o que deixa a linha deslizar em vez de a lista piscar;
  4. o número do Pulso muda de valor sem o bloco ser refeito;
  5. tocar numa linha do ranking abre a gaveta com as cargas daquela rota,
     na mesma conta do ranking; Esc fecha e o foco volta para a linha;
  6. com movimento reduzido no sistema, a gaveta abre e fecha do mesmo jeito.

Não precisa do servidor: roda sobre o index.html com dados de exemplo.

    python3 testes/test_indicadores_atualizam_no_lugar.py
"""
import asyncio
import os
import re
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(os.path.dirname(AQUI), 'index.html')
PAINEL = 'file://' + INDEX
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Mesma base do teste da meta: cargas abertas com pátio longo em três rotas.
SEED = re.search(r'SEED = """(.*?)"""',
                 open(os.path.join(AQUI, 'test_meta_patio_fora_dos_indicadores.py'), encoding='utf-8').read(),
                 re.S).group(1)

GUARDAR = """() => {
  window._antes = {
    svg: document.querySelector('#pulso-hora svg'),
    fila: document.querySelector('#pulso-fila .graf-fila'),
    rank: [...document.querySelectorAll('#pulso-rank-rota .graf-rank-item')],
    num: document.querySelector('#pulso-numeros .pulso-num'),
  };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        erros, fontes_de_fora = [], []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.on('request', lambda r: fontes_de_fora.append(r.url)
              if ('font' in r.resource_type or r.url.endswith('.woff2')) and not r.url.startswith('data:') else None)
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        await pg.evaluate("() => abrirTab('indicadores')")
        await pg.wait_for_timeout(800)

        print('\n=== 1. A LETRA É A BARLOW, EMBUTIDA ===')
        ok_fonte = await pg.evaluate("""() => document.fonts.check('16px Barlow')
            && document.fonts.check('600 16px "Barlow Condensed"')""")
        ck('a Barlow e a Barlow Condensed estão carregadas', ok_fonte)
        familia = await pg.evaluate("() => getComputedStyle(document.body).fontFamily")
        ck('o corpo do painel usa a Barlow', familia.strip().startswith(('Barlow', '"Barlow"')), familia)
        ck('nenhuma fonte foi buscada fora do arquivo (painel abre sem internet)', not fontes_de_fora,
           ', '.join(fontes_de_fora[:3]))
        html = open(INDEX, encoding='utf-8').read()
        ck('o index.html não aponta para servidor de fonte', 'fonts.googleapis' not in html and 'fonts.gstatic' not in html)

        print('\n=== 2. SINCRONIA SEM MUDANÇA NÃO RECRIA NADA ===')
        # O gráfico de entradas por hora só existe com chegadas em DUAS horas
        # ou mais. A base de exemplo chega toda perto do mesmo horário, então
        # o gráfico às vezes nem nascia — e o teste passava ou reprovava
        # conforme a hora em que rodava. Espalha as chegadas por quatro horas.
        await pg.evaluate("""() => {
          cargasAbertas().forEach((c, k) => {
            const m = DB.movimentacoes.find(x => x.cargaId === c.id && x.statusNovo === 'Aguardando Embarque');
            if(m) m.timestamp = new Date(Date.now() - (3 + (k % 4)) * 3600000).toISOString();
          });
          renderIndicadores();
        }""")
        ck('o gráfico de entradas por hora existe (senão a comparação abaixo mediria o nada)',
           await pg.evaluate("() => !!document.querySelector('#pulso-hora svg')"))
        await pg.evaluate(GUARDAR)
        mesmos = await pg.evaluate("""() => { renderIndicadores(); const a = window._antes; return {
            svg: !!a.svg && a.svg === document.querySelector('#pulso-hora svg'),
            fila: !!a.fila && a.fila === document.querySelector('#pulso-fila .graf-fila'),
            rank: a.rank.length > 0 && a.rank.every(li => li.isConnected),
            num: !!a.num && a.num === document.querySelector('#pulso-numeros .pulso-num') }; }""")
        ck('o gráfico de entradas por hora é o MESMO elemento', mesmos['svg'])
        ck('a fila do pátio é a MESMA', mesmos['fila'])
        ck('as linhas do ranking são as MESMAS', mesmos['rank'])
        ck('os blocos de número do Pulso são os MESMOS', mesmos['num'])

        print('\n=== 3. A ORDEM MUDA, AS LINHAS SÃO AS MESMAS ===')
        # A rota da 3ª linha ganha uma carga paradíssima e vai para o topo.
        antes = await pg.evaluate("""() => [...document.querySelectorAll('#pulso-rank-rota .graf-rank-item')]
            .map(li => li.querySelector('.graf-rank-nome').textContent.trim())""")
        troca = await pg.evaluate("""() => {
          const linhas = [...document.querySelectorAll('#pulso-rank-rota .graf-rank-item')];
          const ultima = linhas[linhas.length - 1];
          const rota = ultima.querySelector('.graf-rank-nome').textContent.trim();
          const c = cargasAbertas().find(x => (x.rota || '').trim() === rota);
          const ent = DB.movimentacoes.find(m => m.cargaId === c.id && m.statusNovo === 'Aguardando Embarque');
          ent.timestamp = new Date(Date.now() - 20 * 3600000).toISOString();
          renderIndicadores();
          const depois = [...document.querySelectorAll('#pulso-rank-rota .graf-rank-item')];
          return { rota, primeira: depois[0].querySelector('.graf-rank-nome').textContent.trim(),
                   mesmoNo: depois[0] === ultima };
        }""")
        ck('a rota que mais parou foi para o topo', troca['primeira'] == troca['rota'], f"antes {antes} · topo {troca['primeira']}")
        ck('e é a MESMA linha, que trocou de lugar (é o que deixa ela deslizar)', troca['mesmoNo'])

        print('\n=== 4. O NÚMERO MUDA SEM REFAZER O BLOCO ===')
        num = await pg.evaluate("""() => {
          const box = document.querySelector('#pulso-numeros .pulso-num');
          const v0 = box.querySelector('.v').textContent;
          const c = cargasAbertas()[0];
          c.status = 'Seguiu Viagem';
          renderIndicadores();
          return { mesmo: box === document.querySelector('#pulso-numeros .pulso-num'),
                   v0, v1: box.querySelector('.v').textContent };
        }""")
        ck('o bloco "no pátio" é o mesmo e o valor mudou', num['mesmo'] and num['v0'] != num['v1'], str(num))

        print('\n=== 5. TOCAR NA LINHA ABRE AS CARGAS DELA ===')
        await pg.wait_for_timeout(500)
        linha = pg.locator('#pulso-rank-rota .graf-rank-item').first
        rota = (await linha.locator('.graf-rank-nome').text_content()).strip()
        await linha.click()
        await pg.wait_for_timeout(900)
        gv = await pg.evaluate("""(rota) => {
          const g = document.querySelector('.gv');
          return { aberta: !!g && !g.hidden, itens: document.querySelectorAll('.gv-carga').length,
                   esperado: cargasAbertas().filter(c => (c.rota || '').trim() === rota).length,
                   titulo: (document.getElementById('gv-titulo') || {}).textContent || '' };
        }""", rota)
        ck('a gaveta abriu', gv['aberta'])
        ck('com as cargas em aberto daquela rota — a mesma conta do ranking',
           gv['itens'] == gv['esperado'] and gv['itens'] > 0, str(gv))
        ck('o título diz qual rota é', rota in gv['titulo'], gv['titulo'])
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(900)
        fechou = await pg.evaluate("""() => ({ fechada: document.querySelector('.gv').hidden,
            foco: document.activeElement && document.activeElement.classList.contains('graf-rank-item') })""")
        ck('Esc fecha a gaveta', fechou['fechada'])
        ck('e o foco volta para a linha que a abriu', fechou['foco'])
        await ctx.close()

        print('\n=== 6. COM MOVIMENTO REDUZIDO, FUNCIONA IGUAL ===')
        ctx2 = await nav.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce',
                                     is_mobile=True, has_touch=True)
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(700)
        await pg2.evaluate(SEED)
        await pg2.evaluate("() => abrirTab('indicadores')")
        await pg2.wait_for_timeout(500)
        await pg2.locator('#pulso-rank-rota .graf-rank-item').first.tap()
        await pg2.wait_for_timeout(500)
        ab = await pg2.evaluate("() => !document.querySelector('.gv').hidden")
        ck('no celular com movimento reduzido, a gaveta abre', ab)
        await pg2.locator('.gv-fechar').tap()
        await pg2.wait_for_timeout(500)
        ck('e fecha', await pg2.evaluate("() => document.querySelector('.gv').hidden"))
        larg = await pg2.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
        ck('a página não rola para o lado no celular', larg)
        await ctx2.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
