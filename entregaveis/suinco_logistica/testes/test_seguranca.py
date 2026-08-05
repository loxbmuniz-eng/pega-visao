#!/usr/bin/env python3
"""
AUDITORIA DE SEGURANÇA — exploração real, não checklist.

Premissa do atacante: um operador com credencial válida (insider, ou conta
comprometida) grava conteúdo hostil nos campos pela própria API. A pergunta
é o que isso causa nos NAVEGADORES dos outros setores.

É o modelo de ameaça certo para a arquitetura atual: todo mundo compartilha
a mesma base, e o painel renderiza dado que outra pessoa escreveu.
"""
import asyncio, json, os, urllib.request
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
API    = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA  = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

achados = []
def vuln(sev, titulo, detalhe):
    achados.append((sev, titulo, detalhe))
    print(f"  [{sev}] {titulo}\n         {detalhe}")
def ok(titulo, detalhe=''):
    print(f"  [OK ] {titulo}{(' — ' + detalhe) if detalhe else ''}")

CFG = """(api)=>{ SuincoSharePoint.SP_CONFIG.api = api; }"""


def _post(caminho, corpo, token=None):
    cab = {'Content-Type': 'application/json'}
    if token:
        cab['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(API + caminho, data=json.dumps(corpo).encode(),
                                 headers=cab, method='POST')
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b'{}')


def token_de(email):
    return _post('/auth/login', {'email': email, 'senha': SENHA}).get('token')


def gravar_carga(token, corpo):
    """Grava pela API, como um operador legítimo faria. Se o servidor
    recusar, o teste registra isso — recusa também é resultado."""
    return _post('/api/cargas', corpo, token)

async def main():
    token = token_de('ana@teste.local')
    if not token:
        print('ERRO: não consegui logar como ana@teste.local. O backend está no ar?')
        return 1

    # Placa real: a trava de frota recusa qualquer outra, e sem a carga
    # entrar no banco não há o que renderizar.
    placa = json.loads(urllib.request.urlopen(
        urllib.request.Request(API + '/api/frota',
                               headers={'Authorization': 'Bearer ' + token})).read())[0]['placa']

    XSS = '"><img src=x onerror=window.__XSS_EXECUTOU=1>'

    print('\n=== 0. O SERVIDOR ACEITA O DADO HOSTIL? ===')
    # Id com aspas: o servidor tem idSeguro() na borda e deve recusar.
    id_hostil = "id'); window.__XSS_ONCLICK=1; ('"
    r = gravar_carga(token, {'id': id_hostil, 'placa': placa, 'numeroCarga': XSS})
    # O certo NÃO é recusar a requisição: é descartar o id hostil e gerar um
    # seguro no lugar. Recusar faria a fila offline travar para sempre num
    # item que nunca seria aceito. O que não pode é o id hostil ser gravado.
    if r.get('id') == id_hostil:
        vuln('ALTA', 'Servidor gravou id fora do formato',
             'O id vai para dentro de onclick no render — é o vetor do XSS já corrigido antes.')
    elif r.get('id'):
        ok('id hostil descartado e substituído por um seguro', r.get('id')[:32])
    else:
        ok('gravação recusada', str(r.get('codigo') or r.get('erro'))[:60])

    # Agora o caso que INTERESSA: id válido, mas texto hostil nos campos
    # livres. É o que um operador legítimo consegue gravar de verdade.
    hostil = gravar_carga(token, {
        'id': 'carga_auditoria_xss',
        'placa': placa,
        'numeroCarga': XSS,
        'motorista': XSS,
        'cliente': XSS,
        'destino': XSS,
        'observacoes': XSS,
        'peso': 1, 'qtdGanchos': 0, 'qtdEntregas': 1,
    })
    ok('carga com texto hostil gravada pela API',
       'é assim que o dado de um setor chega à tela do outro'
       if hostil.get('id') else str(hostil)[:80])

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await b.new_context()
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        # O painel precisa ser servido da mesma origem da API (ver a nota em
        # test_login_api.py sobre Private Network Access).
        html = open('/home/user/pega-visao/entregaveis/suinco_logistica/index.html',
                    encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        url = API + '/__auditoria'
        await pg.route(url, lambda rota: asyncio.ensure_future(
            rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
            rota.fulfill(status=200, content_type='application/javascript', body='')))
        await pg.goto(url)
        await pg.wait_for_timeout(1200)

        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        print('\n=== 1. XSS ARMAZENADO VINDO DO DADO COMPARTILHADO ===')

        # GUARDA. Sem ela, "nenhum script executou" pode significar apenas
        # que o dado hostil nunca chegou a ser renderizado — e o teste
        # passaria sem testar nada. Já caímos nessa antes neste projeto.
        await pg.evaluate("()=>SuincoSharePoint.pullTudo()")
        await pg.wait_for_timeout(1500)
        chegou = await pg.evaluate(
            "()=>DB.cargas.some(c=>c.id==='carga_auditoria_xss')")
        if not chegou:
            vuln('TESTE INVÁLIDO', 'a carga hostil não chegou ao painel',
                 'as verificações de XSS abaixo não provariam nada — corrija o teste antes de confiar nelas')
        else:
            ok('a carga hostil está no painel', 'o render vai de fato processá-la')

        await pg.evaluate("()=>{renderAll();}")
        for aba in ['torre','programacao','portaria','expedicao','faturamento','historico','cadastros','relatorios']:
            await pg.evaluate("(t)=>{try{abrirTab(t);}catch(e){}}", aba)
            await pg.wait_for_timeout(250)
        r = await pg.evaluate("()=>({xss:!!window.__XSS_EXECUTOU, onclick:!!window.__XSS_ONCLICK})")
        if r['xss']:
            vuln('ALTA','XSS armazenado executa via dado da API',
                 'Um payload gravado por um operador executa script no navegador dos outros setores.')
        else:
            ok('nenhum script executou a partir do dado compartilhado')

        print('\n=== 2. QUEBRA DE ATRIBUTO onclick (id da carga) ===')
        quebrou = await pg.evaluate("""()=>{
          const bs=[...document.querySelectorAll('button[onclick]')];
          return bs.some(x=>/__XSS_ONCLICK/.test(x.getAttribute('onclick')||''));
        }""")
        if quebrou or r['onclick']:
            vuln('ALTA','id da carga não escapado dentro de onclick',
                 "Aspas no id quebram o atributo e injetam código no manipulador.")
        else:
            ok('id da carga não quebrou o atributo onclick')

        print('\n=== 3. O PAYLOAD APARECE COMO TEXTO (esperado) ===')
        # Olha a Torre, que é onde a carga aparece — não a aba que sobrou
        # aberta depois do laço acima (Relatórios, que não lista carga).
        await pg.evaluate("()=>abrirTab('torre')")
        await pg.wait_for_timeout(500)
        visivel = await pg.evaluate(
            "()=>(document.getElementById('torre-tbody')||{}).innerText||''")
        if 'onerror' in visivel:
            ok('payload renderizado como TEXTO literal',
               'inerte é o comportamento correto — o navegador não interpreta')
        else:
            vuln('TESTE INVÁLIDO', 'o payload não apareceu na Torre',
                 'ou o dado sumiu, ou o render mudou — reveja antes de confiar no resultado')

        print('\n=== 4. POLUIÇÃO DE PROTÓTIPO VIA DADO REMOTO ===')
        # __proto__ enviado como campo. O servidor sanea por lista de colunas
        # conhecidas, então nem deveria chegar — mas quem confirma é o teste.
        gravar_carga(token, {'id': 'carga_pp', 'placa': placa,
                             'numeroCarga': 'PP', '__proto__': {'poluido': True}})
        await pg.evaluate("()=>SuincoSharePoint.sincronizarAgora()")
        await pg.wait_for_timeout(2500)
        poluido = await pg.evaluate("()=>({}).poluido===true || Object.prototype.poluido===true")
        if poluido:
            vuln('ALTA','Poluição de protótipo via campo da API','Object.prototype foi alterado.')
        else:
            ok('protótipo intacto após dado hostil')

        print('\n=== 5. O TOKEN NÃO SOBREVIVE À TROCA DE OPERADOR ===')
        await pg.evaluate("()=>trocarUsuario()")
        await pg.wait_for_timeout(600)
        sobrou = await pg.evaluate("()=>!!sessionStorage.getItem('suinco_token')")
        if sobrou:
            vuln('ALTA','Sessão sobrevive à troca de usuário',
                 'Em terminal compartilhado o próximo operador herda a sessão do anterior.')
        else:
            ok('token apagado ao trocar de operador')

        print('\n=== 6. SEGREDOS NO CÓDIGO ENTREGUE ===')
        conteudo = open('/home/user/pega-visao/entregaveis/suinco_logistica/index.html',
                        encoding='utf-8').read()
        # A senha fixa de aba foi removida: era barreira de interface, ficava
        # em texto puro no arquivo entregue e o controle real passou a ser o
        # login individual com setor vindo do servidor. Se voltar, é achado.
        if 'suinco2026' in conteudo:
            vuln('MÉDIA','Senha das abas em texto puro no arquivo entregue',
                 'Visível com Ctrl+U. É barreira de interface, não controle de acesso.')
        else:
            ok('nenhuma senha fixa de aba no arquivo entregue')
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
            # Continua sendo possível NA TELA, e isso agora é aceitável: com a
            # API, o setor forjado no localStorage muda só o que o navegador
            # desenha. Toda gravação carrega o setor do TOKEN assinado, e o
            # servidor recusa a transição que não é daquele setor
            # (dominio/fluxo.js). Quem forjar Faturamento vê a aba e leva 403
            # ao tentar usá-la.
            #
            # Antes da migração isto era MÉDIA sem solução, porque não havia
            # servidor para validar. Agora é limitação cosmética da interface.
            vuln('BAIXA','Setor forjado no localStorage muda a interface',
                 'O usuário consegue exibir abas de outro setor editando o armazenamento local. '
                 'Não dá acesso: o setor que vale é o do token assinado, validado no servidor a '
                 'cada gravação. O que ele vê é uma tela que não obedece.')
        else:
            ok('setor não pôde ser forjado nem na interface')

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
