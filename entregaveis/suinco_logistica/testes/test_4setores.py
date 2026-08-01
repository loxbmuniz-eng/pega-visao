#!/usr/bin/env python3
"""
Simulação do TURNO COMPLETO com os 4 setores em máquinas separadas.

Quatro navegadores independentes (Logística, Portaria, Expedição, Faturamento)
tocam a mesma carga pelo fluxo inteiro dos 6 status. Verifica que cada setor
enxerga o trabalho do anterior sem recarregar a página, e que o repositório
termina consistente.
"""
import asyncio, json, urllib.request
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/painel_suinco_completo.html'
GRAPH  = 'http://127.0.0.1:8899/v1.0'
CICLO  = 1500

falhas = []
def check(d, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {d}{(' — ' + str(extra)) if extra else ''}")
    if not ok: falhas.append(d)

CFG = """({g, ms})=>{
  SuincoSharePoint.SP_CONFIG.graphBaseUrl=g;
  SuincoSharePoint.SP_CONFIG.siteId='SITE_SUINCO';
  SuincoSharePoint.SP_CONFIG.modoSimulacao=true;
  SuincoSharePoint.SP_CONFIG.intervaloSincroniaMs=ms;
}"""

async def abrir(b, nome, setor):
    ctx = await b.new_context(viewport={'width':1280,'height':800})
    pg = await ctx.new_page()
    err = []
    pg.on('pageerror', lambda e: err.append(f'{setor}: {e}'))
    await pg.goto(PAINEL, wait_until='networkidle')
    await pg.wait_for_timeout(1100)
    await pg.evaluate(CFG, {'g': GRAPH, 'ms': CICLO})
    await pg.fill('#login-nome', nome)
    await pg.select_option('#login-setor', setor)
    await pg.click('button.btn-primary:has-text("Entrar")')
    await pg.wait_for_timeout(400)
    await pg.evaluate("()=>{DB.cargas=[];DB.movimentacoes=[];SuincoStore.save();}")
    await pg.evaluate("()=>SuincoSharePoint.iniciar()")
    await pg.wait_for_timeout(1200)
    return pg, err

async def esperar_status(pg, num, esperado, limite=12000):
    """Espera o setor enxergar o status, sem recarregar a página."""
    passo, t = 500, 0
    while t < limite:
        st = await pg.evaluate("""(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n);return c?c.status:null;}""", num)
        if st == esperado: return True, t
        await pg.wait_for_timeout(passo); t += passo
    return False, t

async def main():
    urllib.request.urlopen('http://127.0.0.1:8899/__admin/limpar').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        print('\n=== 4 SETORES, 4 MÁQUINAS, MESMA CARGA ===')
        LOG, e1 = await abrir(b, 'Ana',   'Logística')
        POR, e2 = await abrir(b, 'Bruno', 'Portaria')
        EXP, e3 = await abrir(b, 'Carla', 'Expedição')
        FAT, e4 = await abrir(b, 'Diego', 'Faturamento')

        NUM = '77001'
        await LOG.evaluate("""(n)=>{criarCargaProgramada({placa:'AFZ8792',transportadora:'Dorsum',
          tipoVeiculo:'Carreta',numeroCarga:n,cliente:'Cliente A',destino:'Salvador/BA',peso:28000,
          rota:'525',sequencia:1,praOnde:'RET FRIGO',qtdGanchos:30,qtdEntregas:2,motorista:'Joao',
          observacoes:'',operador:DB.operador});}""", NUM)

        etapas = [
            ('Portaria vê a carga programada',      POR, 'Aguardando Veículo',  None),
            ('Portaria registra chegada',           POR, 'Aguardando Embarque',
             "(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n); registrarChegadaPortaria(c.placa, DB.operador);}"),
            ('Expedição vê o veículo no pátio',     EXP, 'Aguardando Embarque', None),
            ('Expedição inicia o embarque',         EXP, 'Embarque Iniciado',
             "(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n); avancarStatusCarga(c.id,'Embarque Iniciado',DB.operador);}"),
            ('Expedição finaliza o embarque',       EXP, 'Embarque Finalizado',
             "(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n); avancarStatusCarga(c.id,'Embarque Finalizado',DB.operador);}"),
            ('Faturamento vê a carga carregada',    FAT, 'Embarque Finalizado', None),
            ('Faturamento fatura',                  FAT, 'Faturado',
             "(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n); avancarStatusCarga(c.id,'Faturado',DB.operador);}"),
            ('Portaria vê que já foi faturada',     POR, 'Faturado',            None),
            ('Portaria registra a saída',           POR, 'Seguiu Viagem',
             "(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n); registrarSaidaPortaria(c.placa, DB.operador);}"),
            ('Logística vê o ciclo encerrado',      LOG, 'Seguiu Viagem',       None),
        ]
        for desc, pg, alvo, acao in etapas:
            if acao:
                await pg.evaluate(acao, NUM)
                await pg.wait_for_timeout(900)
                st = await pg.evaluate("(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n);return c?c.status:null;}", NUM)
                check(desc, st == alvo, st)
            else:
                ok, ms = await esperar_status(pg, NUM, alvo)
                check(f'{desc} (propagou em {ms}ms)', ok)

        print('\n=== CONSISTÊNCIA DO REPOSITÓRIO ===')
        viagens = json.loads(urllib.request.urlopen(f"{GRAPH}/sites/SITE_SUINCO/lists/fact_Viagens/items").read())['value']
        linhas = [i for i in viagens if i['fields'].get('Numero_Carga') == NUM]
        check('fact_Viagens: 1 linha para a carga', len(linhas) == 1, f'{len(linhas)}')
        if linhas:
            check('   status final correto', linhas[0]['fields'].get('Status_Atual') == 'Seguiu Viagem',
                  linhas[0]['fields'].get('Status_Atual'))
            check('   campos de negócio preservados',
                  linhas[0]['fields'].get('Rota_Codigo') == '525' and linhas[0]['fields'].get('Qtd_Ganchos') == 30,
                  {k: linhas[0]['fields'].get(k) for k in ('Rota_Codigo','Qtd_Ganchos','Pra_Onde')})

        status = json.loads(urllib.request.urlopen(f"{GRAPH}/sites/SITE_SUINCO/lists/fact_StatusFrota/items").read())['value']
        transicoes = [i['fields'].get('Status_Novo') for i in status if i['fields'].get('Placa') == 'AFZ8792']
        check('fact_StatusFrota registrou as 6 etapas', len(transicoes) >= 6, transicoes)

        log = json.loads(urllib.request.urlopen(f"{GRAPH}/sites/SITE_SUINCO/lists/LOG_EVENTOS/items").read())['value']
        autores = {i['fields'].get('Operador_Nome') for i in log}
        check('auditoria com os 4 operadores', {'Ana','Bruno','Carla','Diego'} <= autores, autores)

        erros = e1+e2+e3+e4
        check('sem erros de página', not erros, erros[:3])
        await b.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', falhas if falhas else 'NENHUMA')
    return 1 if falhas else 0

raise SystemExit(asyncio.run(main()))
