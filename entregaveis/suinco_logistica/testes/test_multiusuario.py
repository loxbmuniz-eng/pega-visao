#!/usr/bin/env python3
"""
Simulação de OPERAÇÃO COMPARTILHADA — dois navegadores independentes.

Prova que o painel é multiusuário: dois contextos de navegador separados (sem
compartilhar localStorage nem sessão, como duas máquinas diferentes) apontando
para o mesmo servidor de Listas. O que a Logística cria, a Portaria enxerga.
"""
import asyncio, json, urllib.request
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
GRAPH  = 'http://127.0.0.1:8899/v1.0'
INTERVALO_MS = 2000            # acelera o ciclo para o teste não levar minutos

falhas = []
def check(desc, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {desc}{(' — ' + str(extra)) if extra else ''}")
    if not ok: falhas.append(desc)

CONFIG = """({g, ms})=>{
  SuincoSharePoint.SP_CONFIG.graphBaseUrl = g;
  SuincoSharePoint.SP_CONFIG.siteId = 'SITE_SUINCO';
  SuincoSharePoint.SP_CONFIG.modoSimulacao = true;
  SuincoSharePoint.SP_CONFIG.intervaloSincroniaMs = ms;
}"""

async def abrir(browser, nome, setor):
    ctx = await browser.new_context(viewport={'width':1400,'height':900})
    pg = await ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(f'{nome}: {e}'))
    await pg.goto(PAINEL, wait_until='networkidle')
    await pg.wait_for_timeout(1200)
    # configura ANTES do login, e reinicia a sincronia já apontada ao servidor
    await pg.evaluate(CONFIG, {'g': GRAPH, 'ms': INTERVALO_MS})
    await pg.fill('#login-nome', nome)
    await pg.select_option('#login-setor', setor)
    await pg.click('button.btn-primary:has-text("Entrar")')
    await pg.wait_for_timeout(500)
    await pg.evaluate("()=>SuincoSharePoint.iniciar()")
    await pg.wait_for_timeout(1500)
    return ctx, pg, erros

async def main():
    urllib.request.urlopen('http://127.0.0.1:8899/__admin/limpar').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)

        print('\n=== 1. DOIS USUÁRIOS EM MÁQUINAS SEPARADAS ===')
        ctxA, A, errA = await abrir(b, 'Ana (Logística)', 'Logística')
        ctxB, B, errB = await abrir(b, 'Bruno (Portaria)', 'Portaria')
        estA = await A.evaluate("()=>SuincoSharePoint.estado()")
        estB = await B.evaluate("()=>SuincoSharePoint.estado()")
        check('ambos conectados ao repositório compartilhado', estA=='online' and estB=='online', f'A={estA} B={estB}')

        # os dois começam sem carga alguma
        await A.evaluate("()=>{DB.cargas=[];DB.movimentacoes=[];SuincoStore.save();}")
        await B.evaluate("()=>{DB.cargas=[];DB.movimentacoes=[];SuincoStore.save();}")

        print('\n=== 2. LOGÍSTICA CRIA CARGA -> PORTARIA PRECISA ENXERGAR ===')
        await A.evaluate("""()=>{
          criarCargaProgramada({placa:'AAK8958', transportadora:'Coopertral', tipoVeiculo:'Truck',
            numeroCarga:'99001', cliente:'Cliente Teste', destino:'Belo Horizonte/MG', peso:12000,
            rota:'510', sequencia:1, praOnde:'FROTA PROPRIA', qtdGanchos:0, qtdEntregas:1,
            motorista:'Motorista X', observacoes:'', operador:DB.operador});
        }""")
        await A.wait_for_timeout(2500)          # deixa subir
        await B.wait_for_timeout(3500)          # e o ciclo de B buscar

        vistaB = await B.evaluate("""()=>{const c=DB.cargas.find(x=>x.numeroCarga==='99001');
            return c?{num:c.numeroCarga,placa:c.placa,status:c.status,rota:c.rota,transp:c.transportadora}:null;}""")
        check('Portaria enxergou a carga criada pela Logística', vistaB is not None, vistaB)
        if vistaB:
            check('   dados chegaram íntegros', vistaB['placa']=='AAK8958' and vistaB['rota']=='510'
                  and vistaB['status']=='Aguardando Veículo', vistaB)

        print('\n=== 3. PORTARIA REGISTRA CHEGADA -> LOGÍSTICA PRECISA VER ===')
        await B.evaluate("""()=>{
          const c=DB.cargas.find(x=>x.numeroCarga==='99001');
          registrarChegadaPortaria(c.placa, DB.operador);
        }""")
        await B.wait_for_timeout(2500)
        await A.wait_for_timeout(3500)
        stA = await A.evaluate("""()=>{const c=DB.cargas.find(x=>x.numeroCarga==='99001');return c?c.status:null;}""")
        check('Logística viu a mudança feita pela Portaria', stA=='Aguardando Embarque', f'status em A = {stA}')

        print('\n=== 4. UMA LINHA POR CARGA (sem duplicar no Power BI) ===')
        bruto = json.loads(urllib.request.urlopen(
            f"{GRAPH}/sites/SITE_SUINCO/lists/fact_Viagens/items?expand=fields").read())
        linhas = [i for i in bruto['value'] if i['fields'].get('Numero_Carga')=='99001']
        check('fact_Viagens tem 1 linha para a carga, não uma por status',
              len(linhas)==1, f'{len(linhas)} linha(s)')
        if linhas:
            check('   a linha reflete o status mais recente',
                  linhas[0]['fields'].get('Status_Atual')=='Aguardando Embarque',
                  linhas[0]['fields'].get('Status_Atual'))

        print('\n=== 5. TRILHA DE AUDITORIA COM OS DOIS OPERADORES ===')
        log = json.loads(urllib.request.urlopen(
            f"{GRAPH}/sites/SITE_SUINCO/lists/LOG_EVENTOS/items?expand=fields").read())
        autores = {i['fields'].get('Operador_Nome') for i in log['value']}
        check('log registra os dois operadores', 'Ana (Logística)' in autores and 'Bruno (Portaria)' in autores, autores)

        print('\n=== 6. ALTERAÇÃO LOCAL NÃO SINCRONIZADA NÃO É SOBRESCRITA ===')
        # simula rede caída em B, muda algo, e deixa a sincronia rodar
        await B.evaluate("()=>{SuincoSharePoint.SP_CONFIG.graphBaseUrl='http://127.0.0.1:9/v1.0';}")
        await B.evaluate("""()=>{
          const c=DB.cargas.find(x=>x.numeroCarga==='99001');
          c.observacoes='ALTERACAO LOCAL DE BRUNO'; c.atualizadoEm=new Date().toISOString();
          c._pendente=true; SuincoStore.save();
        }""")
        await B.wait_for_timeout(4500)
        preservado = await B.evaluate("""()=>{const c=DB.cargas.find(x=>x.numeroCarga==='99001');
            return c?c.observacoes:null;}""")
        check('mudança local pendente sobreviveu ao ciclo de sincronia',
              preservado=='ALTERACAO LOCAL DE BRUNO', preservado)

        print('\n=== 7. RECONEXÃO: A FILA SOBE ===')
        await B.evaluate(f"()=>{{SuincoSharePoint.SP_CONFIG.graphBaseUrl='{GRAPH}';}}")
        await B.evaluate("()=>SuincoSharePoint.sincronizarAgora(true)")
        await B.wait_for_timeout(2500)
        pend = await B.evaluate("()=>SuincoSharePoint.pendentes()")
        check('fila esvaziou após reconectar', pend==0, f'{pend} pendente(s)')

        print('\n=== 8. ERROS DE CONSOLE ===')
        todos = [e for e in (errA+errB)]
        check('sem erros de página', len(todos)==0, todos[:3] if todos else '')

        await b.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', falhas if falhas else 'NENHUMA')
    return 1 if falhas else 0

raise SystemExit(asyncio.run(main()))
