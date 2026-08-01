#!/usr/bin/env python3
"""
Verifica as FILAS VISÍVEIS NA TELA de cada setor durante o fluxo.

A pergunta que este teste responde não é "o dado chegou?", e sim: quando a
Expedição inicia o embarque, o caminhão SAI DA FILA DA PORTARIA na tela do
porteiro, e a Programação vê a mudança — sem ninguém recarregar a página?

Cada setor fica com a sua aba aberta o tempo todo, como aconteceria de verdade.
"""
import asyncio, urllib.request
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/painel_suinco_completo.html'
GRAPH  = 'http://127.0.0.1:8899/v1.0'
CICLO  = 1500
PLACA, NUM = 'AHG5900', '88001'

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

# Conta as linhas VISÍVEIS de uma fila e diz se a placa está lá.
CONTAR = """({sel, placa})=>{
  const tb=document.querySelector(sel);
  if(!tb) return {existe:false};
  const linhas=[...tb.querySelectorAll('tr')];
  return {
    existe:true,
    total:linhas.length,
    temPlaca:linhas.some(tr=>tr.textContent.includes(placa)),
    textoDaLinha:(linhas.find(tr=>tr.textContent.includes(placa))||{}).textContent||''
  };
}"""

async def abrir(b, nome, setor, aba):
    ctx = await b.new_context(viewport={'width':1400,'height':900})
    pg = await ctx.new_page()
    err=[]; pg.on('pageerror', lambda e: err.append(f'{setor}: {e}'))
    await pg.goto(PAINEL, wait_until='networkidle'); await pg.wait_for_timeout(1100)
    await pg.evaluate(CFG, {'g': GRAPH, 'ms': CICLO})
    await pg.fill('#login-nome', nome)
    await pg.select_option('#login-setor', setor)
    await pg.click('button.btn-primary:has-text("Entrar")'); await pg.wait_for_timeout(400)
    await pg.evaluate("()=>{DB.cargas=[];DB.movimentacoes=[];SuincoStore.save();}")
    await pg.evaluate("()=>SuincoSharePoint.iniciar()"); await pg.wait_for_timeout(1200)
    # deixa a aba do setor aberta, como o operador deixaria
    if aba:
        if await pg.evaluate(f"()=>ABAS_COM_SENHA.includes('{aba}')"):
            await pg.click(f'.nav-tab[data-tab="{aba}"]'); await pg.wait_for_timeout(300)
            if await pg.evaluate("()=>document.getElementById('modal-senha').classList.contains('open')"):
                await pg.fill('#senha-input','suinco2026'); await pg.keyboard.press('Enter')
        else:
            await pg.click(f'.nav-tab[data-tab="{aba}"]')
        await pg.wait_for_timeout(500)
    return pg, err

async def esperar(pg, sel, placa, presente, limite=14000):
    """Espera a placa aparecer (presente=True) ou sumir (False) da fila."""
    t, passo = 0, 500
    while t < limite:
        r = await pg.evaluate(CONTAR, {'sel': sel, 'placa': placa})
        if r.get('existe') and r.get('temPlaca') == presente:
            return True, t, r
        await pg.wait_for_timeout(passo); t += passo
    return False, t, r

async def main():
    urllib.request.urlopen('http://127.0.0.1:8899/__admin/limpar').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        print('\n=== CADA SETOR COM SUA ABA ABERTA ===')
        LOG,e1 = await abrir(b,'Ana','Logística','torre')       # Logística acompanha pela Torre
        POR,e2 = await abrir(b,'Bruno','Portaria','portaria')
        EXP,e3 = await abrir(b,'Carla','Expedição','expedicao')

        print('\n=== 1. LOGÍSTICA PROGRAMA A CARGA ===')
        # usa a tela de verdade: abre Programação, preenche e clica no botão
        await LOG.click('.nav-tab[data-tab="programacao"]'); await LOG.wait_for_timeout(400)
        if await LOG.evaluate("()=>document.getElementById('modal-senha').classList.contains('open')"):
            await LOG.fill('#senha-input','suinco2026'); await LOG.keyboard.press('Enter')
            await LOG.wait_for_timeout(500)
        await LOG.fill('#prog-placa', PLACA)
        await LOG.fill('#prog-numero-carga', NUM)
        await LOG.fill('#prog-cliente', 'Cliente A')
        await LOG.fill('#prog-destino', 'Patos de Minas/MG')
        await LOG.fill('#prog-peso', '9800')
        await LOG.select_option('#prog-rota', '500')
        await LOG.fill('#prog-sequencia', '1')
        await LOG.click('button:has-text("Criar Carga")')
        await LOG.wait_for_timeout(900)
        await LOG.click('.nav-tab[data-tab="torre"]'); await LOG.wait_for_timeout(500)
        ok,ms,r = await esperar(LOG,'#torre-tbody',PLACA,True)
        check(f'Torre da Logística mostra a carga ({ms}ms)', ok, r.get('total'))

        print('\n=== 2. CAMINHÃO CHEGA — PORTARIA REGISTRA ===')
        # antes de chegar, o pátio da Portaria está vazio
        r0 = await POR.evaluate(CONTAR, {'sel':'#portaria-patio-tbody','placa':PLACA})
        check('pátio da Portaria ainda não tem o caminhão', not r0.get('temPlaca'), r0.get('total'))

        await POR.fill('#portaria-placa', PLACA)
        await POR.click('button:has-text("Chegou")')
        await POR.wait_for_timeout(900)
        ok,ms,r = await esperar(POR,'#portaria-patio-tbody',PLACA,True)
        check(f'caminhão ENTRA na fila do pátio da Portaria ({ms}ms)', ok, r.get('total'))

        print('\n=== 3. A CHEGADA APARECE NOS OUTROS SETORES, SEM RECARREGAR ===')
        ok,ms,r = await esperar(EXP,'#exp-tbody',PLACA,True)
        check(f'Expedição vê o veículo disponível para embarque ({ms}ms)', ok, r.get('total'))
        stLog = await LOG.evaluate("(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n);return c?c.status:null;}", NUM)
        check('Logística vê o status atualizado na Torre', stLog=='Aguardando Embarque', stLog)

        print('\n=== 4. EXPEDIÇÃO INICIA O EMBARQUE ===')
        await EXP.fill('#exp-placa', PLACA)
        await EXP.click('button:has-text("Iniciar Embarque")')
        await EXP.wait_for_timeout(900)

        print('\n--- é ESTA a pergunta: o caminhão sai da fila da Portaria? ---')
        rAntes = await POR.evaluate(CONTAR, {'sel':'#portaria-patio-tbody','placa':PLACA})
        check('   (guarda) o caminhão ESTAVA na fila antes', rAntes.get('temPlaca'),
              'sem isso, "sumiu" seria falso positivo')
        # CORREÇÃO DA EXPECTATIVA: a lista da Portaria é "Veículos no Pátio
        # Agora" — quem está fisicamente dentro. Um caminhão em carregamento
        # CONTINUA no pátio, e o porteiro precisa vê-lo (é ele quem libera a
        # saída depois). O que muda na tela dele é o STATUS da linha.
        t=0; txt=''
        while t<14000:
            rr = await POR.evaluate(CONTAR, {'sel':'#portaria-patio-tbody','placa':PLACA})
            txt = rr.get('textoDaLinha','')
            if 'Embarque Iniciado' in txt: break
            await POR.wait_for_timeout(500); t+=500
        check(f'status na linha do porteiro vira "Embarque Iniciado" ({t}ms)',
              'Embarque Iniciado' in txt, txt.strip()[:90])
        rr = await POR.evaluate(CONTAR, {'sel':'#portaria-patio-tbody','placa':PLACA})
        check('   caminhão SEGUE no pátio (correto: ainda está fisicamente lá)',
              rr.get('temPlaca'))

        # e some da fila de quem AGUARDA embarque na Expedição
        t=0
        while t<14000:
            re_ = await EXP.evaluate(CONTAR, {'sel':'#exp-tbody','placa':PLACA})
            if 'Embarque Iniciado' in (re_.get('textoDaLinha') or ''): break
            await EXP.wait_for_timeout(500); t+=500
        check(f'Expedição vê a própria ação refletida ({t}ms)',
              'Embarque Iniciado' in (re_.get('textoDaLinha') or ''), (re_.get('textoDaLinha') or '').strip()[:80])

        t=0; stLog=None
        while t<14000:
            stLog = await LOG.evaluate("(n)=>{const c=DB.cargas.find(x=>x.numeroCarga===n);return c?c.status:null;}", NUM)
            if stLog=='Embarque Iniciado': break
            await LOG.wait_for_timeout(500); t+=500
        check(f'Logística vê "Embarque Iniciado" na Torre ({t}ms)', stLog=='Embarque Iniciado', stLog)
        rT = await LOG.evaluate(CONTAR, {'sel':'#torre-tbody','placa':PLACA})
        check('   e a carga segue visível na Torre (não some do acompanhamento)', rT.get('temPlaca'))

        print('\n=== 5. NINGUÉM RECARREGOU A PÁGINA ===')
        # se tivesse havido reload, o operador teria voltado para a tela de login
        for nome,pg in [('Logística',LOG),('Portaria',POR),('Expedição',EXP)]:
            logado = await pg.evaluate("()=>!!(DB.operador && DB.operador.nome)")
            check(f'{nome} seguiu logada o tempo todo', logado)

        erros = e1+e2+e3
        check('sem erros de página', not erros, erros[:3])
        await b.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', falhas if falhas else 'NENHUMA')
    return 1 if falhas else 0

raise SystemExit(asyncio.run(main()))
