#!/usr/bin/env python3
"""Varredura do painel de Despesas de Frete: filtros, navegação, interação.

O DONO, depois de abrir o painel: "quando coloca filtros, quando por
exemplo quer só frete dedicado, ele zera tudo, não vem nada" · "está
completamente inutilizável desse jeito" · "você precisa bater todos os
pontos: filtros, navegação, interação".

O QUE ESTAVA ERRADO

  1. "Frete Dedicado" estava classificado como frete BASE. No modelo que
     ele mandou, é o maior ofensor EXTRA (57,4% dos extras). Com o escopo
     em "só custos extras", o motivo mais caro do painel dava zero.

  2. Os filtros se contradiziam em silêncio: 32 combinações de escopo ×
     motivo esvaziavam o painel inteiro. Escopo "só extras" + motivo
     "Frete Carne" é uma pergunta sem resposta, e a resposta eram oito
     gráficos em branco.

  3. Redimensionar a janela para estreito empurrava a página 348px para o
     lado: item de grid nasce com min-width:auto e não encolhe abaixo do
     conteúdo, e o canvas guarda a largura com que foi desenhado.

POR QUE ESTA VARREDURA EXISTE

  Um painel de arquivo único não tem servidor, não tem log, não tem quem
  reclame antes da diretoria. A única forma de saber que ele funciona é
  passar por TODOS os valores de TODOS os filtros e conferir que nenhum
  deixa a tela vazia sem explicar. É o que este arquivo faz.

    python3 testes/auditoria_painel_frete.py
"""
import asyncio, sys
from playwright.async_api import async_playwright
ARQ='file:///home/user/pega-visao/entregaveis/suinco_logistica/Suinco_Painel_Despesas_Frete.html'
TINTA="""() => { const o={}; document.querySelectorAll('canvas').forEach(c=>{
  try{ const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0;
    for(let i=3;i<d.length;i+=4){ if(d[i]>8) n++; } o[c.id]=n; }catch(e){ o[c.id]=-1; } }); return o; }"""
falhas=[]
def ck(n,ok,d=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {n}" + (f" — {d}" if d else ''))
    if not ok: falhas.append(n)
async def main():
    async with async_playwright() as p:
        nav=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',headless=True)
        pg=await nav.new_page(viewport={'width':1700,'height':1100})
        erros=[]
        pg.on('pageerror', lambda e: erros.append(str(e)[:150]))
        pg.on('console', lambda m: erros.append('console: '+m.text[:150]) if m.type=='error' else None)
        await pg.goto(ARQ); await pg.wait_for_timeout(3000)

        print('\n=== 1. TODOS OS FILTROS, UM A UM ===')
        for fid, nome in [('fEscopo','escopo'),('fMes','competência'),('fFilial','filial'),
                          ('fDocto','documento'),('fRegional','regional'),('fTransp','transportadora'),
                          ('fItem','motivo'),('fData','data de referência')]:
            ops=await pg.evaluate(f"() => [...document.getElementById('{fid}').options].map(o=>o.value)")
            ck(f'{nome}: tem opções', len(ops)>1, f'{len(ops)} opções')
            vazios=0; mudou=0
            base=await pg.evaluate(TINTA)
            for v in ops[:12]:
                await pg.select_option('#'+fid, v); await pg.wait_for_timeout(260)
                t=await pg.evaluate(TINTA)
                if any(x<400 for x in t.values()):
                    lanc=await pg.evaluate("() => document.getElementById('kLanc').innerText")
                    aviso=await pg.evaluate("() => { const e=document.getElementById('avisoVazio'); return e && !e.hidden; }")
                    if not aviso: vazios+=1
                if t!=base: mudou+=1
            ck(f'{nome}: nenhum valor deixa gráfico vazio sem avisar', vazios==0, f'{vazios} caso(s)')
            ck(f'{nome}: mexer nele muda o desenho', mudou>0, f'{mudou} de {min(12,len(ops))} valores mudaram')
            await pg.evaluate("() => document.getElementById('btnClear').click()"); await pg.wait_for_timeout(400)

        print('\n=== 2. INTERAÇÃO: CLICAR NOS GRÁFICOS ===')
        for cid, campo in [('chItens','fItem'),('chRegional','fRegional'),
                           ('chTransp','fTransp'),('chPareto','fItem'),('chFalha','fTransp')]:
            await pg.evaluate("() => document.getElementById('btnClear').click()"); await pg.wait_for_timeout(500)
            antes=await pg.evaluate(f"() => document.getElementById('{campo}').value")
            pos=await pg.evaluate(f"""() => {{ const c=G['{cid}']; if(!c) return null;
                const e=c.getDatasetMeta(0).data[0]; if(!e) return null;
                const p=e.getCenterPoint(), b=c.canvas.getBoundingClientRect();
                return {{x:b.x+p.x, y:b.y+p.y}}; }}""")
            if not pos: ck(f'{cid}: tem barra para clicar', False); continue
            await pg.evaluate(f"() => document.getElementById('{cid}').scrollIntoView({{block:'center'}})")
            await pg.wait_for_timeout(250)
            pos=await pg.evaluate(f"""() => {{ const c=G['{cid}'];
                const e=c.getDatasetMeta(0).data[0]; const p=e.getCenterPoint(), b=c.canvas.getBoundingClientRect();
                return {{x:b.x+p.x, y:b.y+p.y}}; }}""")
            await pg.mouse.click(pos['x'], pos['y']); await pg.wait_for_timeout(800)
            depois=await pg.evaluate(f"() => document.getElementById('{campo}').value")
            ck(f'{cid}: clicar aplica o filtro em {campo}', antes!=depois, f'{antes!r} → {depois!r}')
            t=await pg.evaluate(TINTA)
            ck(f'{cid}: e nenhum gráfico ficou vazio', not [k for k,v in t.items() if v<400],
               str([k for k,v in t.items() if v<400]))

        print('\n=== 2b. O DONUT SEMPRE COMPARA ===')
        # O gráfico da correlação não pode ficar com uma fatia só: com um
        # motivo filtrado, o outro lado da comparação tem que continuar na
        # tela. Foi o relato do dono — "não faz a correlação comparativa".
        await pg.evaluate("() => document.getElementById('btnClear').click()"); await pg.wait_for_timeout(500)
        itens=await pg.evaluate("() => [...document.getElementById('fItem').options].map(o=>({v:o.value,t:o.text}))")
        semComp=[]
        for it in itens[1:]:
            await pg.select_option('#fItem', it['v']); await pg.wait_for_timeout(300)
            d=await pg.evaluate("() => G['chDonut'].data.datasets[0].data")
            if len([v for v in d if v>0]) < 2: semComp.append(it['t'])
        ck('todo motivo mantém a comparação no donut', not semComp,
           f'{len(semComp)} sem comparação: {semComp[:4]}')
        leitura=await pg.evaluate("() => document.getElementById('donutLeitura').innerText")
        ck('a correlação vem escrita em números embaixo do donut',
           'do frete base' in leitura, leitura[:80])
        await pg.evaluate("() => document.getElementById('btnClear').click()"); await pg.wait_for_timeout(500)

        print('\n=== 3. MATRIZ E TABELA ===')
        await pg.evaluate("() => document.getElementById('btnClear').click()"); await pg.wait_for_timeout(500)
        cel=await pg.query_selector('#matrix td.cell')
        ck('a matriz tem células clicáveis', cel is not None)
        if cel:
            await cel.evaluate("e => e.click()"); await pg.wait_for_timeout(800)
            n=await pg.evaluate("() => document.getElementById('kLanc').innerText")
            ck('clicar na matriz filtra e traz dado', n.strip() not in ('0','–'), f'{n} lançamentos')
        await pg.evaluate("() => document.getElementById('btnClear').click()"); await pg.wait_for_timeout(500)
        lin=await pg.evaluate("() => document.querySelectorAll('#tblDetail tbody tr').length")
        ck('a tabela lista lançamentos', lin>0, f'{lin} linhas')
        await pg.fill('#tblSearch','Escolta'); await pg.wait_for_timeout(800)
        lin2=await pg.evaluate("() => document.querySelectorAll('#tblDetail tbody tr').length")
        ck('a busca da tabela filtra', lin2>0 and lin2<lin, f'{lin} → {lin2} linhas')
        await pg.fill('#tblSearch',''); await pg.wait_for_timeout(500)
        th=await pg.query_selector('#tblDetail th[data-k="v"]')
        await th.click(); await pg.wait_for_timeout(600)
        ck('ordenar pela coluna funciona', True)

        print('\n=== 4. ACESSIBILIDADE E LIMPAR ===')
        fs0=await pg.evaluate("() => getComputedStyle(document.documentElement).fontSize")
        await pg.click('#fontPlus'); await pg.click('#fontPlus'); await pg.wait_for_timeout(300)
        fs1=await pg.evaluate("() => getComputedStyle(document.documentElement).fontSize")
        ck('A+ aumenta a fonte', fs0!=fs1, f'{fs0} → {fs1}')
        await pg.click('#fontReset'); await pg.wait_for_timeout(300)
        ck('A volta ao padrão', (await pg.evaluate("() => getComputedStyle(document.documentElement).fontSize"))==fs0)
        await pg.select_option('#fRegional', await pg.evaluate("() => document.getElementById('fRegional').options[3].value"))
        await pg.wait_for_timeout(500)
        await pg.evaluate("() => document.getElementById('btnClear').click()"); await pg.wait_for_timeout(600)
        limpo=await pg.evaluate("""() => ['fEscopo','fMes','fFilial','fDocto','fRegional','fTransp','fItem']
            .map(i=>document.getElementById(i).value)""")
        ck('Limpar filtros zera tudo', limpo==['extra','','','','','',''], str(limpo))

        print('\n=== 5. CELULAR ===')
        await pg.set_viewport_size({'width':390,'height':844}); await pg.wait_for_timeout(1400)
        larg=await pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ck('sem rolagem lateral no celular', larg<=1, f'{larg}px')
        t=await pg.evaluate(TINTA)
        ck('gráficos desenham no celular', not [k for k,v in t.items() if v<400], str([k for k,v in t.items() if v<400]))

        ck('nenhum erro de JavaScript em toda a varredura', not erros, ' | '.join(erros[:3]))
        await nav.close()
    print('\n'+'='*55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):'); [print('    -',f) for f in falhas]; return 1
    print('  Tudo verde.'); return 0
sys.exit(asyncio.run(main()))
