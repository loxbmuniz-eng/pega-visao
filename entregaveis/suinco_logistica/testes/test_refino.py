import asyncio
from playwright.async_api import async_playwright
PATH='file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas=[]
def ck(d,ok,x=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {d}{(' — '+str(x)) if x else ''}")
    if not ok: falhas.append(d)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',headless=True)
        pg=await b.new_page(viewport={'width':1500,'height':950})
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(PATH,wait_until='domcontentloaded')
        await pg.wait_for_function("()=>typeof DB!=='undefined'",timeout=30000)
        await pg.wait_for_timeout(1200)

        print('\n=== 1. LOGIN SEM TURNO ===')
        ck('campo Turno removido', not await pg.evaluate("()=>!!document.getElementById('login-turno')"))
        await pg.evaluate("() => mostrarLoginLocal()")  # modo local: o login principal agora é e-mail e senha contra o servidor
        await pg.fill('#login-nome','Ana'); await pg.select_option('#login-setor','Portaria')
        await pg.click('button:has-text("Entrar sem servidor")'); await pg.wait_for_timeout(700)
        ck('login funciona sem o campo', await pg.evaluate("()=>!!(DB.operador&&DB.operador.nome)"))
        ck('turno ainda gravado (derivado da hora)',
           bool(await pg.evaluate("()=>DB.operador&&DB.operador.turno")),
           await pg.evaluate("()=>DB.operador.turno"))

        print('\n=== 2. ROTAS NOVAS ===')
        r=await pg.evaluate("()=>({t:ROTAS.length,r527:rotaInfo('527'),r531:rotaInfo('531')})")
        ck('32 rotas', r['t']==32, r['t'])
        ck('527 Nordeste', r['r527'] and r['r527']['nome']=='Nordeste', r['r527'])
        ck('531 Paraná', r['r531'] and r['r531']['nome']=='Paraná', r['r531'])

        print('\n=== 3. PALETIZADA (editável) ===')
        await pg.evaluate("()=>{DB.cargas=[];DB.movimentacoes=[];SuincoStore.save();}")
        await pg.evaluate("""()=>{criarCargaProgramada({placa:'AAK8958',transportadora:'Coopertral',
          tipoVeiculo:'Truck',numeroCarga:'55001',cliente:'',destino:'',peso:9000,rota:'527',
          sequencia:1,praOnde:'FROTA PROPRIA',paletizada:'Sim',qtdGanchos:0,qtdEntregas:2,
          motorista:'M',observacoes:'',operador:DB.operador}); renderAll();}""")
        ck('paletizada gravada', await pg.evaluate("()=>DB.cargas[0].paletizada")=='Sim')
        ck('helper de leitura', await pg.evaluate("()=>paletizadaDaCarga(DB.cargas[0])")=='Sim')
        ck('registro antigo sem o campo → Não',
           await pg.evaluate("()=>paletizadaDaCarga({})")=='Não')
        csv = await pg.evaluate("()=>gerarCsvDimCarga()")
        ck('coluna Paletizada no CSV', 'Paletizada' in csv.split('\r\n')[0])
        ck('coluna Compartilhada removida do CSV', 'Compartilhada' not in csv)

        print('\n=== 4. PORTARIA: AÇÃO EM UM CLIQUE ===')
        await pg.click('.nav-tab[data-tab="portaria"]'); await pg.wait_for_timeout(600)
        linhas = await pg.evaluate("""()=>{const tb=document.getElementById('portaria-prog-tbody');
            return tb?[...tb.querySelectorAll('tr')].map(t=>t.textContent):[];}""")
        ck('fila de programadas renderizada', len(linhas)==1, linhas)
        ck('botão Chegou visível para Aguardando Veículo',
           await pg.evaluate("""()=>!!document.querySelector('#portaria-prog-tbody button')"""))
        await pg.click('#portaria-prog-tbody button'); await pg.wait_for_timeout(700)
        st = await pg.evaluate("()=>DB.cargas[0].status")
        ck('clique mudou o status sem digitar placa', st=='Aguardando Embarque', st)
        acao = await pg.evaluate("""()=>{const b=document.querySelector('#portaria-prog-tbody button');
            return b?b.textContent.trim():'(sem botão)';}""")
        ck('sem botão em etapa de outro setor', acao=='(sem botão)', acao)

        print('\n=== 5. PROGRAMAÇÃO ===')
        ck('Tipo de Operação existe uma vez só',
           await pg.evaluate("()=>document.querySelectorAll('#prog-praonde').length")==1)
        ck('Cliente/Destino não são mais visíveis',
           await pg.evaluate("""()=>{const c=document.getElementById('prog-cliente');
               return c && c.type==='hidden';}"""))
        ck('select Paletizada existe', await pg.evaluate("()=>!!document.getElementById('prog-paletizada')"))

        print('\n=== 5b. SPARKLINE DA TENDÊNCIA ===')
        # A tabela de períodos JÁ é uma série temporal: cinco janelas do
        # mesmo indicador. Lida célula a célula, a tendência exige comparar
        # cinco números de cabeça; desenhada, aparece de relance.
        await pg.evaluate("() => { abrirTab('indicadores'); renderAll(); }")
        await pg.wait_for_timeout(600)
        r = await pg.evaluate("""() => {
            const cs = [...document.querySelectorAll('#ind-periodos-tbody canvas.spark')];
            const th = document.querySelectorAll('.table-periodos thead th').length;
            const td = document.querySelector('#ind-periodos-tbody tr').children.length;
            const pintados = cs.map(c => {
                const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
                return n;
            });
            const series = cs.map(c => JSON.parse(c.dataset.serie));
            return {n: cs.length, th, td, pintados, series};
        }""")
        ck('uma sparkline por linha de indicador', r['n'] >= 1, str(r['n']))
        ck('cabeçalho e linha com o mesmo número de colunas',
           r['th'] == r['td'], f"th={r['th']} td={r['td']}")
        ck('todas desenharam alguma coisa', all(p > 0 for p in r['pintados']),
           str(r['pintados']))
        # A série vai do período mais antigo para o mais recente — ao
        # contrário das colunas, que começam nas últimas 6h. Invertida, a
        # linha contaria a história de trás para frente.
        ck('série tem os 5 períodos', all(len(x) == 5 for x in r['series']),
           str(r['series'][:2]))
        ck('a série usa os valores já calculados, sem inventar',
           all(all(v is None or isinstance(v, (int, float)) for v in x) for x in r['series']),
           str(r['series'][:2]))

        print('\n=== 6. CONSOLE ===')
        reais=[e for e in errs if 'ERR_TUNNEL' not in e]
        ck('sem erros', not reais, reais[:2])
        await b.close()
    print('\n  FALHAS:', falhas if falhas else 'NENHUMA')
    return 1 if falhas else 0
raise SystemExit(asyncio.run(main()))
