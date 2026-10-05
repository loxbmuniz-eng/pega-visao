#!/usr/bin/env python3
"""A aba Pagamento de Frete: a planilha dentro do painel, de ponta a ponta (05/10/2026).

Pedido do dono: "na aba de pagamento de frete, as informações precisam
corresponder à planilha, como se o sistema utilizasse uma planilha no mesmo
formato". E o acesso: "os usuários permanecem na aba de usuários, e as
permissões são definidas lá" — um setor, escolhido no seletor de sempre.

O CAMINHO DA DANIELA, com o painel inteiro e a API de verdade:
  1. a aba só aparece para o setor Pagamento de Frete e a Administração; a
     Portaria não a vê, e o setor aparece no cadastro de usuário;
  2. importar os dois PDFs (B2B + Atak) de uma carga: prévia, confirmar;
  3. a grade tem as 22 colunas da planilha aprovada, na ordem dela, e a carga
     900802 sai em 4 linhas (uma por pendência), com as contagens só na primeira;
  4. mudar a tratativa de uma nota pela lista muda o % liberado na hora;
  5. registrar um pagamento pelo modal: a linha mostra % pago e PARCIAL;
  6. "Exportar planilha" baixa um .xlsx com as mesmas células da tela;
  7. nada da aba sai no celular com texto menor que 12px nem com rolagem
     da PÁGINA (a tabela rola dentro do quadro).

Exige o backend no ar (SUINCO_API) e o banco de teste.

    bash testes/rodar_tudo.sh pagamento_frete_aba
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PAINEL = RAIZ / 'index.html'
PDFS = RAIZ / 'backend' / 'testes' / 'fixtures' / 'frete'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:160])
    return r.stdout.strip()


def http(c, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode(); req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def operador(email, setor):
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';")
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} Teste', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


def limpar_frete():
    for t in ['pgfrete_eventos', 'pgfrete_leituras', 'pgfrete_pagamentos', 'pgfrete_pendencias', 'pgfrete_cargas']:
        psql(f'DELETE FROM {t};')


async def abrir_painel(ctx, viewport=None):
    pagina = await ctx.new_page()
    await pagina.set_viewport_size(viewport or {'width': 1400, 'height': 1000})
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pagina.goto(url)
    await pagina.wait_for_timeout(1000)
    return pagina


async def entrar(pg, email):
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(1500)


async def main():
    limpar_frete()
    # uma transportadora CADASTRADA na Frota: a transportadora da carga só sai dessa lista
    psql("DELETE FROM dim_veiculos WHERE placa = 'TST9A01';")
    psql("INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('TST9A01', 'Transp. Teste Tela', 'Truck', 'teste');")
    tok_frete = operador('frete.tela@teste.local', 'Pagamento de Frete')
    tok_port = operador('portaria.tela@teste.local', 'Portaria')
    tok_adm = operador('admin.tela@teste.local', 'Administração')
    ck('operadores de teste criados (o setor novo passa na CHECK do banco)', bool(tok_frete and tok_port and tok_adm))

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. QUEM VÊ A ABA ===')
        # UM CONTEXTO POR PESSOA: sair() + reload restaura a sessão local e não
        # mostra o login de novo — e o painel está certo em fazer isso.
        async def painel_de(email, viewport=None):
            c = await nav.new_context(accept_downloads=True)
            p_ = await abrir_painel(c, viewport)
            p_.on('pageerror', lambda e: erros.append(str(e)))
            await entrar(p_, email)
            return p_
        pg = await painel_de('portaria.tela@teste.local')
        ck('Portaria NÃO vê a aba', await pg.is_hidden('.nav-tab[data-tab="frete"]'))
        await pg.context.close()
        pg = await painel_de('admin.tela@teste.local')
        ck('Administração vê a aba', await pg.is_visible('.nav-tab[data-tab="frete"]'))
        opcoes = await pg.evaluate("() => [...document.querySelectorAll('#usr-setor option')].map(o => o.value)")
        ck('o setor "Pagamento de Frete" está no cadastro de usuário', 'Pagamento de Frete' in opcoes, str(opcoes[-4:]))
        await pg.context.close()
        pg = await painel_de('frete.tela@teste.local')
        ck('o setor Pagamento de Frete vê a aba', await pg.is_visible('.nav-tab[data-tab="frete"]'))
        visiveis = await pg.evaluate("() => [...document.querySelectorAll('.nav-tab')].filter(e => !e.hidden).map(e => e.dataset.tab)")
        ck('e só ela (mais a Minha segurança)', sorted(visiveis) == ['frete', 'usuarios'], str(visiveis))
        ck('cai direto nela ao entrar', await pg.evaluate("() => TAB_ATUAL") == 'frete')

        print('\n=== 2. IMPORTAR OS DOIS PDFs ===')
        await pg.wait_for_timeout(800)
        ck('aba vazia explica o que fazer', 'Importar' in (await pg.inner_text('#frete-empty')))
        await pg.click('#frete-btn-importar')
        await pg.wait_for_selector('#frete-arquivos', state='attached')
        await pg.set_input_files('#frete-arquivos', [str(PDFS / 'b2b_900802.pdf'), str(PDFS / 'sist_900802.pdf')])
        try:
            await pg.wait_for_selector('#modal-frete .frete-prev-ok', timeout=60000)
        except Exception:
            print('   modal:', (await pg.inner_text('#modal-frete'))[:600])
        prev = await pg.evaluate("""() => [...document.querySelectorAll('#modal-frete .frete-prev')].map(tr =>
            [...tr.querySelectorAll('td')].slice(1, 10).map(t => t.textContent.trim()))""")
        ck('a prévia mostra a carga 900802: 8/8, 4 finalizadas, PENDENTE',
           prev and prev[0][:9] == ['900802', '8', '8', '0', '4', '1', '1', '2', 'PENDENTE'], str(prev))
        ck('nada gravado antes de confirmar', psql('SELECT count(*) FROM pgfrete_cargas;') == '0')
        await pg.click('#frete-btn-gravar')
        await pg.wait_for_timeout(2500)
        ck('gravou a carga', psql("SELECT count(*) FROM pgfrete_cargas WHERE numero_carga='900802';") == '1')

        print('\n=== 3. A GRADE É A PLANILHA ===')
        cab = await pg.evaluate("() => [...document.querySelectorAll('#frete-thead th')].map(t => t.textContent.trim())")
        ck('as 24 colunas da planilha, na ordem dela (+ Ações)', cab[:16] == [
            'Data Consulta', 'Carga', 'Qtde SIST', 'Qtde B2B', 'Diferença', 'Finalizadas', 'Aguardando', 'Não Entregue',
            'Outros Status', 'Situação', 'Resumo Pendências', 'Status Pendência', 'Status p/ pagamento', 'Data Pagamento',
            'Transportadora', 'CT-E'] and cab[16:22] == ['% Entregue', '% Liberado', '% Pago', 'A pagar agora', 'Data Tratativa', 'Observação']
            and cab[22:24] == ['Canhoto original', 'Canhoto marcado em'] and cab[-1] == 'Ações', str(cab))
        linhas = await pg.evaluate("""() => [...document.querySelectorAll('#frete-tbody tr')].map(tr => ({
            primeira: tr.classList.contains('frete-primeira'),
            v: Object.fromEntries([...tr.querySelectorAll('td[data-col]')].map(td => [td.dataset.col, td.textContent.trim()])) }))""")
        ck('a carga 900802 ocupa 4 linhas: uma por pendência', len(linhas) == 4, str(len(linhas)))
        if len(linhas) == 4:
            p1 = linhas[0]['v']
            ck('a primeira linha traz as contagens 8 · 8 · 0 · 4 · 1 · 1 · 2 e PENDENTE',
               [p1['qtdSist'], p1['qtdB2b'], p1['diferenca'], p1['finalizadas'], p1['aguardando'], p1['naoEntregue'], p1['outros'], p1['situacao']]
               == ['8', '8', '0', '4', '1', '1', '2', 'PENDENTE'], str(p1))
            ck('as seguintes repetem só carga e situação', linhas[1]['v']['qtdSist'] == '' and linhas[1]['v']['situacao'] == 'PENDENTE' and linhas[1]['v']['carga'] == '900802')
            ck('entregue 50% e liberado 50%', p1['entregue'] == '50,0%' and p1['liberado'] == '50,0%', f"{p1['entregue']} {p1['liberado']}")
            resumos = sorted(l['v']['resumo'].split(' ', 1)[1] for l in linhas)
            ck('as pendências com o status do B2B, como na planilha', resumos == ['(A caminho)', '(Aguardando)', '(Cancelado)', '(Não entregue)'], str(resumos))
        stats = await pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('#frete-stats .stat-box')].map(b => [b.querySelector('.stat-label').textContent.trim(), b.querySelector('.stat-num').textContent.trim()]))")
        ck('as caixas do topo: 1 carga, 1 pendente, 4 pendências abertas',
           stats.get('Cargas no controle') == '1' and stats.get('Pendentes') == '1' and stats.get('Pendências abertas') == '4', str(stats))

        print('\n=== 3b. A CAIXINHA DO CANHOTO ORIGINAL ===')
        can = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"canhoto\"]').textContent.trim()")
        ck('a carga nasce com o canhoto NÃO', can == 'NÃO', can)
        ck('só a linha da carga tem a caixinha', await pg.evaluate("() => document.querySelectorAll('#frete-tbody td[data-col=\"canhoto\"] input[type=checkbox]').length") == 1)
        lib_antes = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"liberado\"]').textContent.trim()")
        await pg.click('#frete-tbody tr.frete-primeira td[data-col="canhoto"] input[type=checkbox]')
        await pg.wait_for_timeout(1500)
        can = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"canhoto\"]').textContent.trim()")
        em = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"canhotoEm\"]').textContent.trim()")
        ck('um clique: SIM, com a data de hoje ao lado', can == 'SIM' and len(em) == 10, f'{can} {em}')
        quem = psql("SELECT canhoto_original::text || '|' || canhoto_por FROM pgfrete_cargas WHERE numero_carga='900802';")
        ck('gravou no servidor, com quem marcou (a pessoa do setor, logada)', quem == 'true|Pagamento de Frete Teste', quem)
        lib_depois = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"liberado\"]').textContent.trim()")
        ck('o canhoto NÃO mexe no liberado (só acompanhamento)', lib_antes == lib_depois, f'{lib_antes} -> {lib_depois}')
        stats = await pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('#frete-stats .stat-box')].map(b => [b.querySelector('.stat-label').textContent.trim(), b.querySelector('.stat-num').textContent.trim()]))")
        ck('a caixa do topo diz 1 de 1', stats.get('Canhoto original') == '1 de 1', str(stats.get('Canhoto original')))
        await pg.click('.frete-chip:has-text("Sem canhoto original")')
        await pg.wait_for_timeout(400)
        ck('o filtro "Sem canhoto original" esconde a carga que já veio', await pg.evaluate("() => document.querySelectorAll('#frete-tbody tr').length") == 0)
        await pg.click('.frete-chip:has-text("Sem canhoto original")')
        await pg.wait_for_timeout(400)
        await pg.click('#frete-tbody tr.frete-primeira td[data-col="canhoto"] input[type=checkbox]')
        await pg.wait_for_timeout(1500)
        can = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"canhoto\"]').textContent.trim()")
        em = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"canhotoEm\"]').textContent.trim()")
        ck('desmarcar volta a NÃO e apaga a data', can == 'NÃO' and em == '', f'{can} {em!r}')

        print('\n=== 4. TRATATIVA PELA LISTA ===')
        await pg.select_option('#frete-tbody tr:nth-child(1) select.frete-sel', 'OK')
        await pg.wait_for_timeout(1500)
        lib = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"liberado\"]').textContent.trim()")
        trat = await pg.evaluate("() => document.querySelector('#frete-tbody tr:nth-child(1) select.frete-sel').value")
        ck('OK numa nota: liberado sobe para 62,5% (5 de 8) e a lista mostra OK', lib == '62,5%' and trat == 'OK', f'{lib} {trat}')
        dt = await pg.evaluate("() => document.querySelector('#frete-tbody tr:nth-child(1) td[data-col=\"dataTratativa\"]').textContent.trim()")
        ck('a data da tratativa é a de hoje', len(dt) == 10, dt)

        print('\n=== 5. PAGAMENTO PELO MODAL ===')
        await pg.click('#frete-tbody tr.frete-primeira button:has-text("Pagar")')
        await pg.wait_for_selector('#frete-pg-pct')
        sug = await pg.input_value('#frete-pg-pct')
        ck('o modal sugere o que está a pagar (62,5)', sug == '62.5', sug)
        await pg.fill('#frete-pg-pct', '50')
        await pg.fill('#frete-pg-data', '2026-10-09')
        await pg.click('#frete-btn-registrar')
        await pg.wait_for_timeout(1800)
        p1 = await pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('#frete-tbody tr.frete-primeira td[data-col]')].map(td => [td.dataset.col, td.textContent.trim()]))")
        ck('a linha mostra 50% pago, A PAGAR (ainda há 12,5% liberado sem pagar), data 09/10/2026',
           p1['pago'] == '50,0%' and p1['statusPagamento'] == 'A PAGAR' and p1['dataPagamento'] == '09/10/2026' and p1['aPagar'] == '12,5%', str(p1))
        await pg.click('#frete-tbody tr.frete-primeira button:has-text("Pagar")')
        await pg.wait_for_selector('#frete-pg-pct')
        await pg.fill('#frete-pg-pct', '30')
        await pg.click('#frete-btn-registrar')
        await pg.wait_for_timeout(1500)
        pergunta = await pg.inner_text('#frete-pergunta')
        ck('acima do liberado o painel PERGUNTA, dizendo os números', '62.5%' in pergunta and 'Registrar mesmo assim' in pergunta, pergunta[:120])
        await pg.click('#frete-pergunta button:has-text("Voltar")')
        await pg.click('#modal-frete button:has-text("Cancelar")')

        print('\n=== 5b. CAMPOS EDITÁVEIS: DATA DO PAGAMENTO, DATA DA TRATATIVA, TRANSPORTADORA ===')
        await pg.click('#frete-tbody tr.frete-primeira td[data-col="dataPagamento"] button')
        await pg.wait_for_selector('#frete-campo-data')
        await pg.fill('#frete-campo-data', '2026-10-10')
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(1500)
        dp = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"dataPagamento\"]').textContent.trim()")
        ck('a data do pagamento é editável: 09/10 → 10/10', dp == '10/10/2026', dp)
        ck('e mudou no último pagamento gravado', psql("SELECT to_char(data_pagamento,'YYYY-MM-DD') FROM pgfrete_pagamentos WHERE numero_carga='900802' AND anulado_em IS NULL ORDER BY id DESC LIMIT 1;") == '2026-10-10')
        await pg.click('#frete-tbody tr:nth-child(1) td[data-col="dataTratativa"] button')
        await pg.wait_for_selector('#frete-campo-data')
        await pg.fill('#frete-campo-data', '2026-10-01')
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(1500)
        dt2 = await pg.evaluate("() => document.querySelector('#frete-tbody tr:nth-child(1) td[data-col=\"dataTratativa\"]').textContent.trim()")
        ck('a data da tratativa é editável: hoje → 01/10/2026', dt2 == '01/10/2026', dt2)
        await pg.click('#frete-tbody tr.frete-primeira td[data-col="transportadora"] button')
        await pg.wait_for_selector('#frete-campo-valor')
        opcoes = await pg.evaluate("() => [...document.querySelectorAll('#frete-campo-valor option')].map(o => o.value)")
        ck('a transportadora é uma LISTA das cadastradas na Frota (não texto livre)', 'Transp. Teste Tela' in opcoes and await pg.evaluate("() => document.querySelector('#frete-campo-valor').tagName") == 'SELECT', str(opcoes[:6]))
        await pg.select_option('#frete-campo-valor', 'Transp. Teste Tela')
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(1500)
        tr = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"transportadora\"]').textContent.trim()")
        ck('escolhida da lista, gravou', tr == 'Transp. Teste Tela', tr)
        sp = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-primeira td[data-col=\"statusPagamento\"]').className")
        ck('o Status p/ pagamento A PAGAR vem destacado', 'frete-sp-apagar' in sp, sp)
        seg = await pg.evaluate("() => getComputedStyle(document.querySelector('#frete-tbody tr.frete-seg td[data-col=\"qtdSist\"]'), '::before').content")
        ck('a 2ª linha da carga diz que é uma nota pendente (não parece vazia)', 'nota pendente' in seg, seg)

        print('\n=== 6. EXPORTAR: O ARQUIVO É A TELA ===')
        async with pg.expect_download(timeout=30000) as dl:
            await pg.click('#frete-btn-exportar')
        download = await dl.value
        caminho = Path('/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad') / 'exportado_tela.xlsx'
        caminho.parent.mkdir(parents=True, exist_ok=True)
        await download.save_as(str(caminho))
        ck('o nome do arquivo é o do controle', download.suggested_filename.startswith('Controle_Pagamento_Frete_'), download.suggested_filename)
        comparacao = subprocess.run(['node', '--input-type=module', '-e', f"""
            import fs from 'node:fs';
            import {{ lerPlanilhaXlsx }} from '{RAIZ}/backend/src/servicos/planilha_xlsx.js';
            const {{ abas }} = lerPlanilhaXlsx(fs.readFileSync('{caminho}'));
            const l = abas[0].linhas;
            console.log(JSON.stringify({{ abas: abas.map(a => a.nome), cab: l[0].slice(0, 22), pago: l[1][18], sit: l[1][9], qtd: l.length - 1 }}));
        """], capture_output=True, text=True, cwd=str(RAIZ / 'backend'))
        try:
            x = json.loads(comparacao.stdout.strip())
            ck('o .xlsx tem as 3 abas e o mesmo cabeçalho da tela', x['abas'] == ['CONTROLE_CARGAS', 'RESUMO', 'LEIA-ME'] and x['cab'] == cab[:22], str(x['cab'])[:200])
            ck('a mesma carga: 4 linhas, PENDENTE, 50% pago', x['qtd'] == 4 and x['sit'] == 'PENDENTE' and abs(float(x['pago']) - 0.5) < 1e-9, str(x))
        except Exception as e:
            ck('o .xlsx abre', False, (comparacao.stderr or str(e))[:300])

        print('\n=== 7. CELULAR ===')
        cel = await painel_de('frete.tela@teste.local', viewport={'width': 390, 'height': 844})
        await cel.wait_for_timeout(1500)
        medidas = await cel.evaluate("""() => {
            const pequenos = [...document.querySelectorAll('#tab-frete *')].filter(el => {
                const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
                const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
                return txt.length > 1 && parseFloat(getComputedStyle(el).fontSize) < 12;
            }).map(el => el.textContent.trim().slice(0, 30));
            return { pequenos: pequenos.slice(0, 5), larguraPagina: document.documentElement.scrollWidth, janela: window.innerWidth,
                     tabelaRola: document.querySelector('.frete-wrap').scrollWidth > document.querySelector('.frete-wrap').clientWidth };
        }""")
        ck('nenhum texto da aba abaixo de 12px no celular', not medidas['pequenos'], str(medidas['pequenos']))
        ck('a PÁGINA não rola de lado (a tabela rola dentro do quadro)', medidas['larguraPagina'] <= medidas['janela'] + 1 and medidas['tabelaRola'], str(medidas))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    limpar_frete()
    psql("DELETE FROM dim_veiculos WHERE placa = 'TST9A01';")
    for e in ['frete.tela@teste.local', 'portaria.tela@teste.local', 'admin.tela@teste.local']:
        psql(f"DELETE FROM operadores WHERE email = '{e}';")
    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
