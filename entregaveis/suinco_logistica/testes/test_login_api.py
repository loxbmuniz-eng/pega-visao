#!/usr/bin/env python3
"""Painel completo (index.html) conversando com a API de verdade.

Diferente do test_adaptador_api.py, que exercita só o adaptador solto, este
carrega o painel inteiro — HTML, CSS, data.js, app.js — e faz o caminho do
operador: abrir, logar com e-mail e senha, ver o setor vindo do servidor,
programar uma carga e conferir que ela chegou ao banco.

É o teste que responde "segunda-feira vai funcionar?".

Exige o backend rodando e os operadores de teste criados.
"""
import asyncio
import os
import sys
import uuid
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'

RODADA = uuid.uuid4().hex[:6]
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir_painel(ctx, api):
    """Serve o painel na MESMA origem da API.

    O Chrome bloqueia página http comum de alcançar loopback (Private Network
    Access), então servir de outra origem daria 'Failed to fetch' e o teste
    acusaria erro onde não há. Em produção os dois são https públicos.
    """
    pagina = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    # Aponta o adaptador para a API local antes de qualquer script rodar.
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{api}'")

    url = api + '/__painel_teste'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    # O <script> do socket.io aponta para o domínio de produção; sem rede ele
    # falharia com erro de console. Devolve vazio: o adaptador trata a
    # ausência caindo na consulta periódica, que é o comportamento esperado.
    await pagina.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pagina.goto(url)
    await pagina.wait_for_timeout(1200)
    return pagina


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await navegador.new_context()
        pagina = await abrir_painel(ctx, API)
        erros = []
        pagina.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 1. O PAINEL ABRE E PEDE LOGIN DE SERVIDOR ===')
        ck('modal de login aberto', await pagina.is_visible('#modal-operador'))
        ck('formulário de e-mail e senha visível', await pagina.is_visible('#login-email'))
        ck('modo local escondido atrás de um link',
           await pagina.is_hidden('#login-local'),
           'ninguém pode cair no modo local por acidente')
        # INVERTIDO em 16/08/2026: antes o painel carregava atrás do modal
        # de login e este teste documentava isso como normal. Virou tela de
        # entrada própria — quem não se identificou não vê NADA do painel
        # (terminal de pátio fica ligado o dia todo, exposto).
        ck('o painel NÃO aparece sem sessão', await pagina.is_hidden('#nav'))

        print('\n=== 2. CREDENCIAL ERRADA NÃO ENTRA ===')
        await pagina.fill('#login-email', 'ana@teste.local')
        await pagina.fill('#login-senha', 'senha-errada')
        await pagina.click('#btn-entrar')
        await pagina.wait_for_timeout(1200)
        ck('erro aparece dentro do modal', await pagina.is_visible('#login-erro'),
           (await pagina.inner_text('#login-erro')).strip() if await pagina.is_visible('#login-erro') else '')
        ck('continua no login', await pagina.is_visible('#modal-operador'))

        print('\n=== 3. LOGIN CERTO ===')
        await pagina.fill('#login-senha', SENHA)
        await pagina.click('#btn-entrar')
        await pagina.wait_for_timeout(2500)
        ck('modal fechou', not await pagina.is_visible('#modal-operador'))

        cab = (await pagina.inner_text('#operator-name')).strip()
        ck('cabeçalho mostra nome e setor', 'Logística' in cab, cab)

        setor = await pagina.evaluate("() => DB.operador && DB.operador.setor")
        ck('o setor veio do SERVIDOR', setor == 'Logística', str(setor))

        ck('a senha foi apagada do campo',
           await pagina.input_value('#login-senha') == '',
           'terminal de pátio é compartilhado')

        print('\n=== 4. AS ABAS DO SETOR ===')
        visiveis = await pagina.evaluate(
            "() => [...document.querySelectorAll('.nav-tab')].filter(t=>!t.hidden).map(t=>t.dataset.tab)")
        # A Logística passou a ter acesso total à operação (decisão do
        # gestor): cobre qualquer posto quando falta gente. O que ela NÃO
        # tem é CRIAR ACESSO — isso continua sendo da Administração.
        ck('Logística vê Programação', 'programacao' in visiveis, str(visiveis))
        ck('Logística vê Portaria (cobre o posto)', 'portaria' in visiveis, str(visiveis))
        ck('Logística vê Faturamento (cobre o posto)', 'faturamento' in visiveis, str(visiveis))
        # A aba Usuários abriu para todos os setores em 22/08/2026, com o
        # segundo fator: deixou de ser só a tela de administrar gente e passou
        # a ser onde cada pessoa protege a própria conta. Por isso a pergunta
        # mudou de "ele vê a aba?" para "o que ele encontra dentro dela?" — a
        # regra que interessa é a mesma de sempre, e agora é conferida onde
        # ela de fato vale.
        await pagina.evaluate("()=>abrirTab('usuarios')")
        await pagina.wait_for_timeout(1200)
        dentro = await pagina.evaluate("""()=>{
          const vis = el => !!el && el.offsetParent !== null;
          const aba = document.getElementById('tab-usuarios');
          return {
            cards: [...aba.querySelectorAll('.card')].filter(vis).map(c=>c.id||'(sem id)'),
            listaOperadores: vis(document.getElementById('usr-tbody')),
            aprovacoes: vis(document.getElementById('card-aprovacoes')),
            minhaSeguranca: vis(document.getElementById('card-minha-seguranca')),
          };
        }""")
        ck('Logística NÃO cria acesso: sem lista de operadores',
           not dentro['listaOperadores'], 'criar acesso é da Administração')
        ck('Logística NÃO vê os pedidos de aprovação', not dentro['aprovacoes'])
        ck('na aba Usuários ela vê só "Minha segurança"',
           dentro['cards'] == ['card-minha-seguranca'], str(dentro['cards']))
        ck('mas PODE ativar o próprio segundo fator', dentro['minhaSeguranca'])

        print('\n=== 5. A BASE DE FROTA VEIO DO SERVIDOR ===')
        await pagina.wait_for_timeout(1500)
        n = await pagina.evaluate("() => DB.frota.length")
        ck('749 placas carregadas', n == 749, f'{n} placas')

        print('\n=== 6. PROGRAMAR UMA CARGA E VER NO BANCO ===')
        numero = f'T{RODADA}'
        placa = await pagina.evaluate("() => DB.frota[3].placa")
        await pagina.evaluate("t => abrirTab(t)", 'programacao')
        await pagina.wait_for_timeout(400)
        await pagina.fill('#prog-placa', placa)
        await pagina.fill('#prog-numero-carga', numero)
        await pagina.fill('#prog-peso', '12000')
        await pagina.select_option('#prog-rota', '500')
        await pagina.click("button:has-text('Criar Carga')")
        await pagina.wait_for_timeout(2500)

        criada = await pagina.evaluate("n => DB.cargas.some(c=>c.numeroCarga===n)", numero)
        ck('carga criada no painel', criada)

        # A prova real: buscar no servidor, não no navegador.
        no_servidor = await pagina.evaluate("""async (n) => {
            const d = await SuincoSharePoint.pullTudo();
            return (d.cargas || []).some(c => c.Numero_Carga === n);
        }""", numero)
        ck('a carga chegou ao SERVIDOR', no_servidor,
           'sem isto, "funcionou" seria só o localStorage do navegador')

        print('\n=== 7. OUTRO SETOR VÊ A MESMA CARGA ===')
        pagina2 = await abrir_painel(await navegador.new_context(), API)
        erros2 = []
        pagina2.on('pageerror', lambda e: erros2.append(str(e)))
        await pagina2.fill('#login-email', 'bruno@teste.local')
        await pagina2.fill('#login-senha', SENHA)
        await pagina2.click('#btn-entrar')
        await pagina2.wait_for_timeout(3000)

        setor2 = await pagina2.evaluate("() => DB.operador && DB.operador.setor")
        ck('segundo operador entrou como Portaria', setor2 == 'Portaria', str(setor2))

        viu = await pagina2.evaluate("n => DB.cargas.some(c=>c.numeroCarga===n)", numero)
        ck('a Portaria enxerga a carga que a Logística criou', viu,
           'é o requisito central do projeto')

        abas2 = await pagina2.evaluate(
            "() => [...document.querySelectorAll('.nav-tab')].filter(t=>!t.hidden).map(t=>t.dataset.tab)")
        ck('Portaria vê a aba Portaria', 'portaria' in abas2, str(abas2))
        ck('Portaria NÃO vê Programação', 'programacao' not in abas2, str(abas2))

        print('\n=== 7b. FLUXO COMPLETO PELOS 4 SETORES ===')
        # Cada setor num navegador próprio, como aconteceria de verdade.
        # Substitui o antigo test_4setores, que exercitava o SharePoint.
        paginas = {'Logística': pagina, 'Portaria': pagina2}
        for email, setor in [('carla@teste.local', 'Expedição'),
                             ('diego@teste.local', 'Faturamento')]:
            pg = await abrir_painel(await navegador.new_context(), API)
            pg.on('pageerror', lambda e: erros2.append(str(e)))
            await pg.fill('#login-email', email)
            await pg.fill('#login-senha', SENHA)
            await pg.click('#btn-entrar')
            await pg.wait_for_timeout(2500)
            paginas[setor] = pg
            s = await pg.evaluate("() => DB.operador && DB.operador.setor")
            ck(f'{setor} entrou', s == setor, str(s))

        carga_id = await pagina.evaluate(
            "n => (DB.cargas.find(c=>c.numeroCarga===n)||{}).id", numero)
        ck('a carga do teste foi localizada', bool(carga_id), str(carga_id))

        passos = [
            ('Portaria', 'Aguardando Embarque'),
            ('Expedição', 'Embarque Iniciado'),
            ('Expedição', 'Embarque Finalizado'),
            ('Faturamento', 'Faturado'),
            ('Portaria', 'Seguiu Viagem'),
        ]
        for setor, status in passos:
            r = await paginas[setor].evaluate(
                "([id,st]) => SuincoSharePoint.mudarStatus(id, st)", [carga_id, status])
            ck(f'{setor} registra "{status}"',
               r.get('enfileirado') is False and not r.get('recusado'),
               str(r.get('erro') or ''))

        # A prova de propagação: a Logística, que não tocou em nada desde a
        # criação, tem que enxergar o ciclo fechado.
        visto = None
        for _ in range(12):
            await pagina.wait_for_timeout(1500)
            visto = await pagina.evaluate(
                "id => { const c = DB.cargas.find(x=>x.id===id); return c && c.status; }", carga_id)
            if visto == 'Seguiu Viagem':
                break
        ck('a Logística vê o ciclo encerrado sem recarregar a página',
           visto == 'Seguiu Viagem', str(visto))

        print('\n=== 7c. TELA DE USUÁRIOS (só Administração) ===')
        pg_admin = await abrir_painel(await navegador.new_context(), API)
        pg_admin.on('pageerror', lambda e: erros2.append(str(e)))
        await pg_admin.fill('#login-email', 'chefe@teste.local')
        await pg_admin.fill('#login-senha', SENHA)
        await pg_admin.click('#btn-entrar')
        await pg_admin.wait_for_timeout(2500)

        setor_admin = await pg_admin.evaluate("() => DB.operador && DB.operador.setor")
        ck('administrador entrou', setor_admin == 'Administração', str(setor_admin))

        abas_admin = await pg_admin.evaluate(
            "() => [...document.querySelectorAll('.nav-tab')].filter(t=>!t.hidden).map(t=>t.dataset.tab)")
        ck('Administração vê a aba Usuários', 'usuarios' in abas_admin, str(abas_admin))

        await pg_admin.evaluate("() => abrirTab('usuarios')")
        await pg_admin.wait_for_timeout(2000)
        linhas = await pg_admin.evaluate("() => document.querySelectorAll('#usr-tbody tr').length")
        ck('a lista de usuários carregou do servidor', linhas > 0, f'{linhas} linha(s)')

        marcado = await pg_admin.evaluate("() => !!document.querySelector('#usr-tbody .chip-voce')")
        ck('o próprio usuário aparece marcado como "você"', marcado,
           'evita bloquear a si mesmo por engano')

        # Criar pela tela, e provar que a pessoa consegue entrar depois.
        novo = f'tela_{RODADA}@teste.local'
        await pg_admin.fill('#usr-email', novo)
        await pg_admin.fill('#usr-nome', 'Criado Pela Tela')
        await pg_admin.select_option('#usr-setor', 'Expedição')
        await pg_admin.fill('#usr-senha', 'senha-da-tela-1')
        await pg_admin.click("button:has-text('Criar Usuário')")
        await pg_admin.wait_for_timeout(2500)

        ck('a senha foi apagada do campo depois de criar',
           await pg_admin.input_value('#usr-senha') == '',
           'terminal compartilhado não pode ficar com senha na tela')

        entrou = await pg_admin.evaluate(
            "async ([e,s,api]) => {"
            "  const r = await fetch(api + '/auth/login', {"
            "    method:'POST', headers:{'content-type':'application/json'},"
            "    body: JSON.stringify({email:e, senha:s}) });"
            "  const d = await r.json();"
            "  return r.ok ? d.operador.setor : null; }",
            [novo, 'senha-da-tela-1', API])
        ck('o usuário criado PELA TELA consegue entrar', entrou == 'Expedição',
           'de nada adianta cadastrar se a pessoa não entra')

        print('\n=== 7d. SESSÃO SE RENOVA SOZINHA EM TERMINAL EM USO ===')
        # O token vale 12 h. Terminal de pátio fica aberto o expediente
        # inteiro, e pedir senha no meio do turno — com caminhão na doca —
        # não é opção. A renovação segue o TRABALHO: só acontece se alguém
        # mexeu na tela dentro da janela de inatividade.
        r = await pagina.evaluate("() => SuincoSharePoint.renovarSessao()")
        ck('renovou com o terminal em uso', r.get('renovado') is True, str(r))
        ck('continua o mesmo operador',
           (r.get('operador') or {}).get('setor') == 'Logística', str(r))

        ainda = await pagina.evaluate("""async () => {
            const d = await SuincoSharePoint.pullTudo();
            return Array.isArray(d.cargas);
        }""")
        ck('o token novo continua valendo para ler dados', ainda)

        # Terminal esquecido aberto tem que vencer. Simula quatro horas sem
        # ninguém encostar: a renovação se recusa e a sessão morre no prazo.
        sem_uso = await pagina.evaluate("""async () => {
            const original = Date.now;
            Date.now = () => original() + 5 * 60 * 60 * 1000;   // 5 h à frente
            try { return await SuincoSharePoint.renovarSessao(); }
            finally { Date.now = original; }
        }""")
        ck('terminal sem uso NÃO renova', sem_uso.get('renovado') is False, str(sem_uso))
        ck('e diz o motivo', sem_uso.get('motivo') == 'sem uso', str(sem_uso))

        print('\n=== 8. TROCAR USUÁRIO ENCERRA A SESSÃO ===')
        await pagina2.evaluate("() => trocarUsuario()")
        await pagina2.wait_for_timeout(600)
        tem_token = await pagina2.evaluate("() => !!sessionStorage.getItem('suinco_token')")
        ck('o token foi apagado', not tem_token,
           'sem isso o próximo operador herdaria a sessão de quem saiu')
        ck('voltou para o login', await pagina2.is_visible('#modal-operador'))

        print('\n=== 9. CONSOLE ===')
        ck('sem erros de página', not erros and not erros2, str(erros + erros2))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
