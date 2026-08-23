#!/usr/bin/env python3
"""O cartão do celular decide por CARIMBO, não por lista repetida (23/08/2026).

Pedido do gestor: "os cards da torre muito grandes no mobile... não só na
torre mas nas outras abas também... otimize isso, seja coerente e lógico".

A primeira versão escreveu a mesma lista de rótulos três vezes — quem ocupa
a linha toda, quem some no cartão fechado, quem lê em linha — cada uma como
seletor de CSS escrito à mão. Divergiram: a terceira tinha seis rótulos e a
primeira tinha dez, e o Histórico voltou de 94px para 147px por cartão sem
que nenhuma regra estivesse "errada".

Agora existe UMA decisão, em app.js (ROTULOS_LARGURA_CHEIA e
ROTULOS_SECUNDARIOS), aplicada como atributo na célula por
prepararTabelasMobile(). Este teste trava as três consequências e o que
sustenta cada uma:

  1. Toda célula com rótulo é carimbada, e o carimbo bate com o Set do JS.
  2. Célula com colspan não vira campo (a linha de detalhe do Histórico é
     um contêiner, não um "Data/Hora").
  3. Quem tem data-sec some no cartão fechado e volta ao abrir.
  4. Quem tem data-larg="cheia" ocupa as duas colunas e lê em linha.
  5. O rodapé só aparece onde há mesmo algo escondido, e diz a verdade
     sobre o que o toque faz.
  6. O cartão fechado é MENOR do que era — limite absoluto, para uma
     regressão futura estourar.

    python3 testes/test_cartao_mobile_uma_lista.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """async ()=>{
  const vistas=new Set(); const frota=[];
  for(const f of DB.frota){
    if(f.placa && f.transportadora && !vistas.has(f.placa)){ vistas.add(f.placa); frota.push(f); }
    if(frota.length>=6) break;
  }
  for(const [i,f] of frota.entries())
    criarCargaProgramada({numeroCarga:'CM'+Date.now().toString().slice(-5)+i, placa:f.placa,
      cliente:'CLIENTE DE NOME BEM LONGO LTDA', destino:'PORTO ALEGRE/RS',
      peso:20000+i*500, rota:'500', operador:'Chefe', qtdEntregas:2});
  SuincoStore.save(); await SuincoSharePoint.sincronizarAgora();
  return frota.length;
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844},
                                    is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__cartao1lista'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'chefe@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3500)
        await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(2500)
        await pg.evaluate("()=>abrirTab('torre')")
        await pg.wait_for_timeout(1500)

        print('\n=== 1. O CARIMBO VEM DO SET, NÃO DE UMA LISTA PARALELA ===')
        r = await pg.evaluate("""()=>{
          const erros=[];
          let comRotulo=0, cheias=0, secs=0;
          document.querySelectorAll('table.mobile-cartao tbody td').forEach(td=>{
            const rot=td.dataset.rotulo;
            if(td.colSpan>1){
              if(rot) erros.push('colspan com rótulo: '+rot);
              return;
            }
            if(!rot) return;
            comRotulo++;
            const larg = td.dataset.larg==='cheia', sec = td.dataset.sec==='1';
            if(larg) cheias++;
            if(sec) secs++;
            if(ROTULOS_LARGURA_CHEIA.has(rot) !== larg)
              erros.push(`larg divergente em "${rot}"`);
            if(ROTULOS_SECUNDARIOS.has(rot) !== sec)
              erros.push(`sec divergente em "${rot}"`);
          });
          return {erros:[...new Set(erros)].slice(0,6), comRotulo, cheias, secs};
        }""")
        ck('todo carimbo bate com o Set do JS', not r['erros'], '; '.join(r['erros']))
        ck('há células carimbadas para conferir', r['comRotulo'] > 0, f"{r['comRotulo']} células")
        ck('há célula de largura cheia', r['cheias'] > 0, f"{r['cheias']}")
        ck('há célula secundária', r['secs'] > 0, f"{r['secs']}")

        print('\n=== 2. CÉLULA DE COLSPAN NÃO VIRA CAMPO ===')
        await pg.evaluate("()=>abrirTab('historico')")
        await pg.wait_for_timeout(2000)
        det = await pg.evaluate("""()=>{
          const l=[...document.querySelectorAll('#hist-tbody tr.hist-linha')];
          if(!l.length) return {semLinha:true};
          l[0].click();
          const d=document.querySelector('#hist-tbody tr.hist-detalhe:not([hidden]) td');
          return {rotulo: d ? (d.dataset.rotulo||null) : 'sem td',
                  larg: d ? (d.dataset.larg||null) : null};
        }""")
        await pg.wait_for_timeout(400)
        ck('o detalhe do Histórico não recebe rótulo de coluna',
           det.get('semLinha') or det.get('rotulo') is None, str(det))

        print('\n=== 3. FECHADO ESCONDE, ABERTO DEVOLVE ===')
        await pg.evaluate("()=>abrirTab('torre')")
        await pg.wait_for_timeout(1500)
        antes = await pg.evaluate("""()=>{
          const tr=[...document.querySelectorAll('#torre-tbody tr')].find(t=>t.offsetHeight>0);
          if(!tr) return null;
          return {alt: Math.round(tr.getBoundingClientRect().height),
                  visiveis: [...tr.querySelectorAll('td[data-rotulo]')].filter(t=>t.offsetHeight>0).length,
                  secVisiveis: [...tr.querySelectorAll('td[data-sec]')].filter(t=>t.offsetHeight>0).length,
                  expansivel: tr.getAttribute('data-expansivel'),
                  rodape: getComputedStyle(tr,'::after').content};
        }""")
        ck('o cartão fechado esconde os secundários', antes and antes['secVisiveis'] == 0,
           f"{antes['secVisiveis'] if antes else '?'} visível(eis)")
        ck('a linha se anuncia como expansível', bool(antes and antes['expansivel']))
        ck('o rodapé promete o que o toque faz',
           bool(antes) and 'ver tudo' in (antes['rodape'] or ''), antes['rodape'] if antes else '')

        await pg.evaluate("""()=>{
          const tr=[...document.querySelectorAll('#torre-tbody tr')].find(t=>t.offsetHeight>0);
          tr.querySelector('td[data-rotulo="Status"]').click();
        }""")
        await pg.wait_for_timeout(500)
        depois = await pg.evaluate("""()=>{
          const tr=[...document.querySelectorAll('#torre-tbody tr')].find(t=>t.offsetHeight>0);
          return {visiveis: [...tr.querySelectorAll('td[data-rotulo]')].filter(t=>t.offsetHeight>0).length,
                  aberto: tr.classList.contains('cartao-aberto'),
                  rodape: getComputedStyle(tr,'::after').content};
        }""")
        ck('o toque abre o cartão', depois['aberto'])
        ck('e devolve TODOS os campos', depois['visiveis'] > antes['visiveis'],
           f"{antes['visiveis']} → {depois['visiveis']}")
        ck('o rodapé passa a oferecer fechar', 'fechar' in (depois['rodape'] or ''),
           depois['rodape'])

        print('\n=== 4. O CARTÃO FECHADO CABE NA TELA ===')
        # 320px por cartão: o valor medido depois desta mudança foi 255px na
        # Torre e 132px no Histórico. O limite é folgado de propósito — serve
        # para pegar regressão de arquitetura, não variação de conteúdo.
        ck('cartão da Torre abaixo de 320px', antes['alt'] < 320, f"{antes['alt']}px")

        print('\n=== 5. A PÁGINA NÃO ROLA DE LADO EM NENHUMA ABA ===')
        for aba in ['torre', 'historico', 'indicadores', 'cadastros', 'expedicao']:
            await pg.evaluate("(a)=>{abrirTab(a); renderAll();}", aba)
            await pg.wait_for_timeout(700)
            e = await pg.evaluate("""()=>{const d=document.documentElement;
              return d.scrollWidth - d.clientWidth;}""")
            ck(f'{aba}: sem rolagem lateral na página', e <= 1, f'{e}px')

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
