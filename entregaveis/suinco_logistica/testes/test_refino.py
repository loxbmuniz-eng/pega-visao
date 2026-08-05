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
        await pg.fill('#login-nome','Ana'); await pg.select_option('#login-setor','Portaria')
        await pg.click('button.btn-primary:has-text("Entrar")'); await pg.wait_for_timeout(700)
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

        print('\n=== 6. CONSOLE ===')
        reais=[e for e in errs if 'ERR_TUNNEL' not in e]
        ck('sem erros', not reais, reais[:2])
        await b.close()
    print('\n  FALHAS:', falhas if falhas else 'NENHUMA')
    return 1 if falhas else 0
raise SystemExit(asyncio.run(main()))
