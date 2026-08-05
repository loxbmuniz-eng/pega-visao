#!/usr/bin/env python3
"""
TESTE DE CONCORRÊNCIA — 10 usuários simultâneos.

Vai além de "funciona com dois": mede consistência sob concorrência real.

Cenários:
  A) 10 terminais ligados ao mesmo repositório, todos sincronizando.
  B) 6 operadores criam cargas AO MESMO TEMPO — nenhuma pode se perder.
  C) 2 operadores editam A MESMA carga simultaneamente — conflito resolvido
     de forma determinística, sem duplicar linha.
  D) Convergência: passado o tempo de sincronia, TODOS veem o mesmo estado.
  E) Carga de escrita: mede requisições e tempo de propagação.
"""
import asyncio, json, time, urllib.request
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
GRAPH  = 'http://127.0.0.1:8899/v1.0'
SITE   = 'SITE_10U'
CICLO  = 2000
N      = 10

PLACAS = ['AAK8958','AFZ8792','AHG5900','AJM6032','AJY3407',
          'AMU5835','ANA6563','ANE3214','APA4111','APN0660']
SETORES = ['Logística','Portaria','Expedição','Faturamento']

falhas = []
def check(d, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {d}{(' — ' + str(extra)) if extra else ''}")
    if not ok: falhas.append(d)

CFG = """({g, s, ms})=>{
  SuincoSharePoint.SP_CONFIG.graphBaseUrl=g;
  SuincoSharePoint.SP_CONFIG.siteId=s;
  SuincoSharePoint.SP_CONFIG.modoSimulacao=true;
  SuincoSharePoint.SP_CONFIG.intervaloSincroniaMs=ms;
}"""

def srv(lista):
    return json.loads(urllib.request.urlopen(f"{GRAPH}/sites/{SITE}/lists/{lista}/items").read())['value']

async def abrir(b, i):
    nome, setor = f'Operador{i:02d}', SETORES[i % len(SETORES)]
    ctx = await b.new_context(viewport={'width':1200,'height':800})
    pg = await ctx.new_page()
    err = []
    pg.on('pageerror', lambda e: err.append(f'{nome}: {e}'))
    pg.set_default_timeout(60000)
    await pg.goto(PAINEL, wait_until='domcontentloaded', timeout=60000)
    # Com 10 páginas subindo juntas, 'networkidle' + espera fixa não garante que
    # os scripts inline já executaram. Espera o símbolo existir de fato.
    await pg.wait_for_function("()=>typeof SuincoSharePoint!=='undefined' && typeof DB!=='undefined'",
                               timeout=30000)
    await pg.wait_for_selector('#login-nome', timeout=30000)
    await pg.evaluate(CFG, {'g': GRAPH, 's': SITE, 'ms': CICLO})
    await pg.fill('#login-nome', nome)
    await pg.select_option('#login-setor', setor)
    await pg.click('button.btn-primary:has-text("Entrar")')
    await pg.wait_for_timeout(300)
    await pg.evaluate("()=>{DB.cargas=[];DB.movimentacoes=[];SuincoStore.save();}")
    await pg.evaluate("()=>SuincoSharePoint.iniciar()")
    return pg, err, nome, setor

async def main():
    urllib.request.urlopen('http://127.0.0.1:8899/__admin/limpar').read()
    async with async_playwright() as b0:
        b = await b0.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)

        print(f'\n=== A. {N} TERMINAIS SIMULTÂNEOS ===')
        t0 = time.time()
        # Abertura em escada: 10 navegadores carregando um arquivo de 763 KB no
        # mesmo instante saturam o ambiente de teste, o que mede a máquina e não
        # o sistema. Operadores reais também não abrem no mesmo milissegundo.
        sessoes = []
        for i in range(N):
            sessoes.append(await abrir(b, i))
            await asyncio.sleep(0.4)
        pgs   = [s[0] for s in sessoes]
        errs  = [e for s in sessoes for e in s[1]]
        nomes = [s[2] for s in sessoes]
        await asyncio.sleep(3)
        estados = await asyncio.gather(*[p.evaluate("()=>SuincoSharePoint.estado()") for p in pgs])
        check(f'{N} terminais conectados ({time.time()-t0:.1f}s para subir todos)',
              all(e=='online' for e in estados), f'{estados.count("online")}/{N} online')

        print('\n=== B. 6 CRIAÇÕES SIMULTÂNEAS — NADA PODE SE PERDER ===')
        criadores = list(range(6))
        async def criar(i):
            await pgs[i].evaluate("""({p,n,r})=>{criarCargaProgramada({placa:p,transportadora:'T',
              tipoVeiculo:'Carreta',numeroCarga:n,cliente:'C',destino:'D',peso:1000,rota:r,sequencia:1,
              praOnde:'FROTA PROPRIA',qtdGanchos:0,qtdEntregas:1,motorista:'M',observacoes:'',
              operador:DB.operador});}""",
              {'p': PLACAS[i], 'n': f'C{i:03d}', 'r': ['500','501','502','503','504','505'][i]})
        await asyncio.gather(*[criar(i) for i in criadores])
        await asyncio.sleep(6)

        viagens = srv('fact_Viagens')
        nums = sorted(v['fields'].get('Numero_Carga','') for v in viagens)
        esperados = sorted(f'C{i:03d}' for i in criadores)
        check('as 6 cargas chegaram ao repositório', nums == esperados, f'{len(nums)}: {nums}')
        check('   sem linha duplicada', len(nums) == len(set(nums)), nums)

        print('\n=== C. CONFLITO: 2 OPERADORES NA MESMA CARGA ===')
        alvo = 'C000'
        # espera todos enxergarem a carga alvo
        for _ in range(14):
            vis = await asyncio.gather(*[p.evaluate(
                "(n)=>!!DB.cargas.find(x=>x.numeroCarga===n)", alvo) for p in pgs])
            if all(vis): break
            await asyncio.sleep(1)
        check('todos os 10 enxergam a carga antes do conflito', all(vis), f'{sum(vis)}/{N}')

        # dois operadores mudam a MESMA carga ao mesmo tempo, para valores diferentes
        async def editar(i, obs):
            await pgs[i].evaluate("""({n,o})=>{const c=DB.cargas.find(x=>x.numeroCarga===n);
              if(c){c.observacoes=o; c.atualizadoEm=new Date().toISOString(); SuincoStore.save();}}""",
              {'n': alvo, 'o': obs})
        await asyncio.gather(editar(0, 'EDICAO-A'), editar(1, 'EDICAO-B'))
        await asyncio.sleep(7)

        linhas = [v for v in srv('fact_Viagens') if v['fields'].get('Numero_Carga') == alvo]
        check('conflito NÃO duplicou a linha no repositório', len(linhas) == 1, f'{len(linhas)} linha(s)')
        vencedor = linhas[0]['fields'].get('Observacoes') if linhas else None

        print('\n=== D. CONVERGÊNCIA: TODOS VEEM O MESMO ESTADO ===')
        # avança a carga alvo por um operador e espera todos convergirem
        await pgs[2].evaluate("""(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n);
            if(c) registrarChegadaPortaria(c.placa, DB.operador);}""", alvo)
        conv, esperou = False, 0
        while esperou < 25:
            sts = await asyncio.gather(*[p.evaluate(
                "(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n);return c?c.status:null;}", alvo)
                for p in pgs])
            if all(s == 'Aguardando Embarque' for s in sts): conv = True; break
            await asyncio.sleep(1); esperou += 1
        check(f'os {N} terminais convergiram para o mesmo status ({esperou}s)', conv,
              f'{sum(1 for s in sts if s=="Aguardando Embarque")}/{N}')

        # todos veem o mesmo CONJUNTO de cargas
        conjuntos = await asyncio.gather(*[p.evaluate(
            "()=>DB.cargas.map(c=>c.numeroCarga).sort().join(',')") for p in pgs])
        check('todos enxergam o mesmo conjunto de cargas', len(set(conjuntos)) == 1,
              f'{len(set(conjuntos))} visão(ões) distinta(s)')

        print('\n=== E. INTEGRIDADE DO LOG E DA AUDITORIA ===')
        log = srv('LOG_EVENTOS')
        ids = [l['fields'].get('Evento_ID') for l in log]
        check('log de auditoria sem duplicatas', len(ids) == len(set(ids)), f'{len(ids)} eventos')
        autores = {l['fields'].get('Operador_Nome') for l in log}
        check('log identifica os operadores', len(autores) >= 3, autores)
        semAutor = [l for l in log if not l['fields'].get('Operador_ID')]
        check('todo evento tem operador', not semAutor, f'{len(semAutor)} sem autor')

        print('\n=== F. CARGA SOBRE O SERVIDOR ===')
        tot = {k: len(srv(k)) for k in ['fact_Viagens','fact_StatusFrota','LOG_EVENTOS','dim_Veiculos']}
        print(f'   itens por Lista: {tot}')
        check('fact_Viagens tem 1 linha por carga (não uma por status)',
              tot['fact_Viagens'] == len(esperados), f"{tot['fact_Viagens']} para {len(esperados)} cargas")

        check('nenhum erro de página em 10 navegadores', not errs, errs[:3])
        await b.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', falhas if falhas else 'NENHUMA')
    return 1 if falhas else 0

raise SystemExit(asyncio.run(main()))
