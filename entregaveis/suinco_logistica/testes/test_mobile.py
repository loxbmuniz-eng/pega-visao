import asyncio, sys
from playwright.async_api import async_playwright
PAINEL='file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas=[]
def ck(n,ok,d=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {n}" + (f" — {d}" if d else ''))
    if not ok: falhas.append(n)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        iphone = {'width':390,'height':844}
        ctx = await b.new_context(viewport=iphone, is_mobile=True, has_touch=True,
                                  device_scale_factor=3)
        pg = await ctx.new_page(); erros=[]
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)

        print('\n=== 1. LOGIN NO CELULAR ===')
        cx = await pg.evaluate("""() => {
          const i = document.getElementById('login-email');
          const r = i.getBoundingClientRect();
          return {alt: Math.round(r.height), fonte: getComputedStyle(i).fontSize};
        }""")
        ck('campo de login com alvo de toque adequado', cx['alt'] >= 44, f"{cx['alt']}px")
        ck('fonte >= 16px (evita zoom automático do iOS)',
           float(cx['fonte'].replace('px','')) >= 16, cx['fonte'])

        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome','Bruno'); await pg.select_option('#login-setor','Portaria')
        await pg.click('button:has-text("Entrar sem servidor")'); await pg.wait_for_timeout(500)

        print('\n=== 2. SEM ROLAGEM HORIZONTAL NA PÁGINA ===')
        for aba in ['torre','portaria']:
            await pg.evaluate("a => abrirTab(a)", aba); await pg.wait_for_timeout(400)
            over = await pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            ck(f'aba {aba} sem estouro lateral', over <= 1, f'{over}px de estouro')

        print('\n=== 3. TABELA VIRA CARTÃO ===')
        await pg.evaluate("""() => {
          DB.operador = {nome:'Ana', setor:'Logística'};
          const p = DB.frota.slice(0,2).map(f=>f.placa);
          p.forEach((pl,i)=>criarCargaProgramada({placa:pl, numeroCarga:'M'+i, peso:9000, operador:'Ana'}));
          renderAll();
        }""")
        await pg.evaluate("() => abrirTab('torre')"); await pg.wait_for_timeout(400)
        info = await pg.evaluate("""() => {
          const td = document.querySelector('#torre-tbody td[data-rotulo]');
          const thead = document.querySelector('#tab-torre thead');
          return {
            rotulo: td && td.getAttribute('data-rotulo'),
            display: td && getComputedStyle(td).display,
            theadOculto: thead && getComputedStyle(thead).display === 'none',
            temClasse: !!document.querySelector('#tab-torre table.mobile-cartao')
          };
        }""")
        ck('tabela marcada como cartão', info['temClasse'])
        ck('cabeçalho vira rótulo da célula', bool(info['rotulo']), str(info['rotulo']))
        ck('thead escondido no celular', info['theadOculto'] is True)
        ck('célula empilhada', info['display'] == 'flex', str(info['display']))

        print('\n=== 4. PORTARIA: BOTÃO GRANDE ===')
        await pg.evaluate("() => { DB.operador={nome:'Bruno',setor:'Portaria'}; abrirTab('portaria'); }")
        await pg.wait_for_timeout(500)
        btn = await pg.evaluate("""() => {
          const b = document.querySelector('#tab-portaria button.btn');
          if(!b) return null;
          const r = b.getBoundingClientRect();
          return {alt: Math.round(r.height)};
        }""")
        ck('botão da Portaria com pelo menos 44px', btn and btn['alt'] >= 44,
           f"{btn['alt']}px" if btn else 'nenhum botão')
        campo = await pg.evaluate("""() => {
          const i = document.getElementById('portaria-placa');
          return i ? Math.round(i.getBoundingClientRect().height) : null;
        }""")
        ck('campo de placa grande na Portaria', campo and campo >= 52, f'{campo}px')

        print('\n=== 5. DESKTOP NÃO REGREDIU ===')
        pg2 = await (await b.new_context(viewport={'width':1440,'height':900})).new_page()
        e2=[]; pg2.on('pageerror', lambda e: e2.append(str(e)))
        await pg2.goto(PAINEL); await pg2.wait_for_timeout(900)
        await pg2.evaluate("() => mostrarLoginLocal()")
        await pg2.fill('#login-nome','Ana'); await pg2.select_option('#login-setor','Logística')
        await pg2.click('button:has-text("Entrar sem servidor")'); await pg2.wait_for_timeout(400)
        d = await pg2.evaluate("""() => {
          const thead = document.querySelector('#tab-torre thead');
          const td = document.querySelector('#torre-tbody td');
          return {
            theadVisivel: thead && getComputedStyle(thead).display !== 'none',
            celulaTabela: td ? getComputedStyle(td).display : 'sem linhas'
          };
        }""")
        ck('no desktop o cabeçalho continua visível', d['theadVisivel'] is True)
        ck('no desktop a célula continua table-cell',
           d['celulaTabela'] in ('table-cell','sem linhas'), d['celulaTabela'])
        ck('sem erros no desktop', not e2, str(e2))

        print('\n=== 6. PWA DECLARADO ===')
        man = await pg.evaluate("() => { const l=document.querySelector('link[rel=manifest]'); return l && l.getAttribute('href'); }")
        ck('manifest declarado', man == 'manifest.webmanifest', str(man))
        tc = await pg.evaluate("() => { const m=document.querySelector('meta[name=theme-color]'); return m && m.content; }")
        ck('theme-color definido', bool(tc), str(tc))

        print('\nERROS mobile:', erros or 'nenhum')
        if erros: falhas.append('erros de console')
        await b.close()
    print('\n  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0
sys.exit(asyncio.run(main()))
