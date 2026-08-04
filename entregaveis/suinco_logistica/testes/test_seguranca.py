#!/usr/bin/env python3
"""
AUDITORIA DE SEGURANÇA — exploração real, não checklist.

Premissa do atacante: alguém com permissão de escrita na Lista do SharePoint
(um usuário interno mal-intencionado, uma conta comprometida, ou um script que
alimente a Lista) consegue gravar conteúdo arbitrário nos campos. A pergunta é
o que isso causa nos NAVEGADORES dos outros operadores.

Isto importa porque a superfície mudou: antes o painel só lia o próprio
localStorage; agora ele renderiza dados vindos de uma fonte compartilhada.
"""
import asyncio, json, urllib.request
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/painel_suinco_completo.html'
GRAPH  = 'http://127.0.0.1:8899/v1.0'
SITE   = 'SITE_SEC'

achados = []
def vuln(sev, titulo, detalhe):
    achados.append((sev, titulo, detalhe))
    print(f"  [{sev}] {titulo}\n         {detalhe}")
def ok(titulo, detalhe=''):
    print(f"  [OK ] {titulo}{(' — ' + detalhe) if detalhe else ''}")

CFG = """({g, s})=>{
  SuincoSharePoint.SP_CONFIG.graphBaseUrl=g;
  SuincoSharePoint.SP_CONFIG.siteId=s;
  SuincoSharePoint.SP_CONFIG.modoSimulacao=true;
  SuincoSharePoint.SP_CONFIG.intervaloSincroniaMs=1500;
}"""

def gravar(lista, fields):
    req = urllib.request.Request(
        f"{GRAPH}/sites/{SITE}/lists/{lista}/items",
        data=json.dumps({"fields": fields}).encode(),
        headers={'Content-Type':'application/json'}, method='POST')
    return json.loads(urllib.request.urlopen(req).read())

async def main():
    urllib.request.urlopen('http://127.0.0.1:8899/__admin/limpar').read()

    # ---- payloads plantados por um atacante com escrita na Lista ----
    XSS = '"><img src=x onerror=window.__XSS_EXECUTOU=1>'
    gravar('fact_Viagens', {
        'Carga_ID': "id'); window.__XSS_ONCLICK=1; ('",     # quebra de onclick
        'Numero_Carga': XSS,
        'Placa': XSS,
        'Transportadora': XSS,
        'Cliente': XSS,
        'Destino': XSS,
        'Motorista': XSS,
        'Tipo_Veiculo': XSS,
        'Status_Atual': 'Aguardando Veículo',
        'Peso_Kg': 1, 'Sequencia': 1, 'Qtd_Ganchos': 0, 'Qtd_Entregas': 1,
        'Pra_Onde': 'FROTA PROPRIA', 'Rota_Codigo': '500',
        'Criado_Em': '2026-08-02T00:00:00.000Z',
        'Atualizado_Em': '2026-08-02T00:00:00.000Z',
        'Timestamp_Sincronia': '2026-08-02T00:00:00.000Z',
    })
    gravar('dim_Veiculos', {
        'Placa': 'ZZZ9Z99', 'Transportadora': XSS, 'Tipo_Veiculo': XSS,
        'Timestamp_Sincronia': '2026-08-02T00:00:00.000Z'})
    gravar('fact_StatusFrota', {
        'Movimentacao_ID': 'm-xss', 'Carga_ID': 'x', 'Placa': XSS,
        'Status_Novo': XSS, 'Setor': XSS, 'Operador_Nome': XSS,
        'Data_Evento': '2026-08-02T00:00:00.000Z',
        'Timestamp_Sincronia': '2026-08-02T00:00:00.000Z'})

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await b.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL, wait_until='domcontentloaded')
        await pg.wait_for_function("()=>typeof SuincoSharePoint!=='undefined'", timeout=30000)
        await pg.evaluate(CFG, {'g': GRAPH, 's': SITE})
        await pg.fill('#login-nome','Auditor'); await pg.click('button.btn-primary:has-text("Entrar")')
        await pg.wait_for_timeout(400)
        await pg.evaluate("()=>SuincoSharePoint.iniciar()")
        await pg.wait_for_timeout(3000)

        print('\n=== 1. XSS ARMAZENADO VINDO DA LISTA COMPARTILHADA ===')
        # percorre todas as abas, que é onde o dado é renderizado
        # navega por JS: algumas abas ficam ocultas conforme o setor logado,
        # mas o RENDER de todas roda igual — é o render que interessa auditar.
        await pg.evaluate("()=>{renderAll();}")
        for aba in ['torre','programacao','portaria','expedicao','faturamento','historico','cadastros','relatorios']:
            await pg.evaluate("(t)=>{try{irParaTab(t);}catch(e){}}", aba)
            await pg.wait_for_timeout(250)
        r = await pg.evaluate("()=>({xss:!!window.__XSS_EXECUTOU, onclick:!!window.__XSS_ONCLICK})")
        if r['xss']:
            vuln('ALTA','XSS armazenado executa via dado da Lista',
                 'Um payload gravado na Lista executa script no navegador de todos os setores.')
        else:
            ok('nenhum script executou a partir do dado da Lista')

        print('\n=== 2. QUEBRA DE ATRIBUTO onclick (Carga_ID) ===')
        quebrou = await pg.evaluate("""()=>{
          const bs=[...document.querySelectorAll('button[onclick]')];
          return bs.some(x=>/__XSS_ONCLICK/.test(x.getAttribute('onclick')||''));
        }""")
        if quebrou or r['onclick']:
            vuln('ALTA','Carga_ID não escapado dentro de onclick',
                 "Aspas no Carga_ID quebram o atributo e injetam código no manipulador.")
        else:
            ok('Carga_ID não quebrou o atributo onclick')

        print('\n=== 3. O PAYLOAD APARECE COMO TEXTO (esperado) ===')
        visivel = await pg.evaluate("()=>document.body.innerText.includes('onerror')")
        ok('payload renderizado como texto literal' if visivel else 'payload não chegou à tela',
           'texto inerte é o comportamento correto' if visivel else 'verificar se o dado foi lido')

        print('\n=== 4. POLUIÇÃO DE PROTÓTIPO VIA DADO REMOTO ===')
        gravar('fact_Viagens', {'Carga_ID':'pp1','__proto__':{'poluido':True},
                                'Status_Atual':'Aguardando Veículo','Numero_Carga':'PP',
                                'Timestamp_Sincronia':'2026-08-02T00:00:01.000Z'})
        await pg.evaluate("()=>SuincoSharePoint.sincronizarAgora(true)")
        await pg.wait_for_timeout(2000)
        poluido = await pg.evaluate("()=>({}).poluido===true || Object.prototype.poluido===true")
        if poluido:
            vuln('ALTA','Poluição de protótipo via campo da Lista','Object.prototype foi alterado.')
        else:
            ok('protótipo intacto após dado hostil')

        print('\n=== 5. TRAVA DO MODO DE SIMULAÇÃO ===')
        burla = await pg.evaluate("""()=>{
          const antes=SuincoSharePoint.SP_CONFIG.graphBaseUrl;
          SuincoSharePoint.SP_CONFIG.graphBaseUrl='https://graph.microsoft.com/v1.0';
          SuincoSharePoint.SP_CONFIG.modoSimulacao=true;
          const conf=SuincoSharePoint.estaConfigurado();
          SuincoSharePoint.SP_CONFIG.graphBaseUrl=antes;
          return conf;
        }""")
        if burla:
            vuln('ALTA','modoSimulacao dispensa autenticação contra o Graph real',
                 'Seria possível desligar o SSO em produção alterando uma chave.')
        else:
            ok('modoSimulacao ignorado fora de localhost — SSO não pode ser desligado por config')

        print('\n=== 6. SEGREDOS NO CÓDIGO ENTREGUE ===')
        conteudo = open('/home/user/pega-visao/entregaveis/suinco_logistica/painel_suinco_completo.html',
                        encoding='utf-8').read()
        if 'suinco2026' in conteudo:
            vuln('MÉDIA','Senha das abas em texto puro no arquivo entregue',
                 'Visível com Ctrl+U. É barreira de interface, não controle de acesso.')
        for chave in ['clientId','tenantId','siteId']:
            import re
            m = re.search(chave + r"\s*:\s*'([^']+)'", conteudo)
            if m and m.group(1) not in ('',):
                vuln('ALTA', f'{chave} preenchido no arquivo entregue', f'valor: {m.group(1)[:12]}...')
        ok('nenhum clientId/tenantId/siteId embutido no pacote')

        print('\n=== 7. INTEGRIDADE DO SCRIPT EXTERNO (MSAL) ===')
        if 'alcdn.msauth.net' in conteudo and 'integrity=' not in conteudo:
            vuln('MÉDIA','MSAL carregado de CDN sem atributo integrity',
                 'Comprometimento da CDN executaria código arbitrário com a sessão do usuário.')
        else:
            ok('script externo com integridade declarada ou servido localmente')

        print('\n=== 8. ADULTERAÇÃO DO ARMAZENAMENTO LOCAL ===')
        adulterou = await pg.evaluate("""()=>{
          const raw=JSON.parse(localStorage.getItem('suinco_painel_v1')||'{}');
          raw.operador={nome:'Invasor',setor:'Faturamento',turno:'X'};
          localStorage.setItem('suinco_painel_v1',JSON.stringify(raw));
          SuincoStore.load();
          return DB.operador && DB.operador.setor==='Faturamento';
        }""")
        if adulterou:
            vuln('MÉDIA','Setor do operador é definido pelo cliente',
                 'Editando o localStorage o usuário assume qualquer setor. A permissão por setor é '
                 'conveniência de interface; o controle real depende da permissão por Lista + SSO.')
        else:
            ok('setor não pôde ser forjado pelo cliente')

        print('\n=== 9. ERROS DE PÁGINA DURANTE O ATAQUE ===')
        reais = [e for e in erros if 'ERR_TUNNEL' not in e]
        ok('nenhum erro de página', '') if not reais else vuln('BAIXA','Erros durante dado hostil', reais[:2])
        await b.close()

    print('\n=== RESUMO DA AUDITORIA ===')
    if not achados:
        print('  Nenhum achado.')
    for sev, t, _ in achados:
        print(f'  {sev}: {t}')
    altas = [a for a in achados if a[0]=='ALTA']
    return 1 if altas else 0

raise SystemExit(asyncio.run(main()))
