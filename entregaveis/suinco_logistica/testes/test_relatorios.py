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
        pg = await b.new_page(); erros=[]
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome','Ana'); await pg.select_option('#login-setor','Logística')
        await pg.click('button:has-text("Entrar sem servidor")'); await pg.wait_for_timeout(500)

        # 3 cargas, uma percorrendo o fluxo inteiro para gerar tempos
        await pg.evaluate("""() => {
          const pl = DB.frota.slice(0,3).map(f=>f.placa);
          const ids = pl.map((p,i)=>criarCargaProgramada({placa:p, numeroCarga:'R'+i,
            peso:9000+i*1000, qtdEntregas:2, rota:'500', observacoes:'Frete '+i, operador:'Ana'}).id);
          ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
            .forEach(st => avancarStatusCarga(ids[0], st, 'Ana', 'Logística'));
        }""")
        await pg.evaluate("()=>{ window.print = ()=>{}; }")

        print('\n=== NOME DO ARQUIVO ===')
        titulos = {}
        for fn, rot in [('exportarPdfOperacional','Operacional'),
                        ('exportarPdfExecutivo','Executivo'),
                        ('exportarPdfFretes','Fretes')]:
            t = await pg.evaluate(f"""() => {{
              const antes = document.title;
              {fn}();
              const durante = document.title;
              window.dispatchEvent(new Event('afterprint'));
              return {{durante, depois: document.title, antes}};
            }}""")
            titulos[rot] = t
            print(f'  {rot:12} -> {t["durante"]}')
        ck('os três nomes são diferentes',
           len({v['durante'] for v in titulos.values()}) == 3)
        ck('o nome tem data', '2026-' in titulos['Operacional']['durante'])
        ck('o título da aba volta ao normal depois',
           titulos['Operacional']['depois'] == titulos['Operacional']['antes'],
           titulos['Operacional']['depois'])

        print('\n=== EXECUTIVO: LIMPEZA ===')
        await pg.evaluate("()=>exportarPdfExecutivo()")
        await pg.wait_for_timeout(400)
        r = await pg.evaluate("""() => {
          const t = document.getElementById('print-executivo').innerText;
          return {
            legenda: !!document.querySelector('#print-executivo .legenda-status'),
            menorMaior: /Menor e maior/.test(t),
            rankingTransp: /Ranking do dia|Ranking histórico/.test(t),
            tempoMedio: /Tempo Médio de Pátio/.test(t),
            atraso: /Veículos com Maior Atraso/.test(t),
            gargalos: /Gargalos/.test(t),
            secoes: [...document.querySelectorAll('#print-executivo .print-secao-tit')].map(e=>e.innerText)
          };
        }""")
        ck('legenda de status (parecia botão) removida', not r['legenda'])
        ck('"Menor e maior tempo" removido', not r['menorMaior'])
        ck('ranking de transportadoras removido', not r['rankingTransp'])
        ck('Tempo Médio de Pátio presente', r['tempoMedio'])
        ck('Ranking de Veículos com Maior Atraso presente', r['atraso'])
        ck('Gargalos e Pontos Críticos presente', r['gargalos'])
        print('  seções:', r['secoes'])

        print('\n=== CONCLUÍDAS: SEM STATUS ZERADO ===')
        z = await pg.evaluate("""() => {
          const secs = [...document.querySelectorAll('#print-executivo .print-secao-tit')];
          const alvo = secs.find(s => /Cargas concluídas/.test(s.innerText));
          if(!alvo) return {achou:false};
          let el = alvo.parentElement.nextElementSibling;
          while(el && el.tagName !== 'TABLE') el = el.nextElementSibling;
          if(!el) return {achou:true, tabela:false};
          const linhas = [...el.querySelectorAll('tbody tr')];
          return {achou:true, tabela:true, n: linhas.length,
                  zerados: linhas.filter(tr => /\\b0\\b/.test(tr.children[2].innerText)).length};
        }""")
        ck('bloco de concluídas existe', z.get('achou'))
        if z.get('tabela'):
            ck('nenhum status zerado listado', z['zerados'] == 0,
               f"{z['n']} linha(s), {z['zerados']} zerada(s)")

        print('\n=== FILTRO VALE PARA O EXECUTIVO ===')
        await pg.evaluate("() => abrirTab('relatorios')")
        # Relatórios não tem senha; o query_selector encontra o input do
        # modal fechado. Confere se está aberto de verdade.
        aberto = await pg.evaluate(
            "() => document.getElementById('modal-senha').classList.contains('open')")
        if aberto:
            await pg.fill('#senha-input', 'suinco2026')
            await pg.keyboard.press('Enter')
            await pg.wait_for_timeout(400)
        await pg.fill('#rel-data-de', '2020-01-01')
        await pg.fill('#rel-data-ate', '2020-01-02')
        await pg.evaluate("()=>exportarPdfExecutivo()")
        await pg.wait_for_timeout(400)
        vazio = await pg.evaluate("() => document.getElementById('print-executivo').innerText")
        ck('período sem cargas produz relatório vazio, não o de sempre',
           'Programadas de 01/01/2020' in vazio, 'o cabeçalho mostra o período')

        print('\n  erros:', erros or 'nenhum')
        if erros: falhas.append('console')
        await b.close()
    print('\n  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0
sys.exit(asyncio.run(main()))
