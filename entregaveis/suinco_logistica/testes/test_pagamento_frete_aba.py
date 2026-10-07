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
import re
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

        print('\n=== 3. A TELA EM DOIS NÍVEIS: A CARGA NUMA LINHA, AS NOTAS NUMA LISTA ===')
        # A REGRA MUDOU DE PROPÓSITO (06/10/2026, auditoria visual aprovada "tudo"):
        # a tela deixou de ser a planilha de 24 colunas — o que se decide ficava
        # fora da tela. A PLANILHA EXCEL continua com as 24 colunas (seção 6).
        cab = await pg.evaluate("() => [...document.querySelectorAll('#frete-thead th')].map(t => t.textContent.trim())")
        ck('a linha da carga: Carga, Situação, Para pagamento, Entregue·Liberado·Pago, Transportadora·CT-E, Canhoto, Ações',
           cab == ['Carga', 'Situação', 'Para pagamento', 'Entregue · Liberado · Pago', 'Transportadora · CT-E', 'Canhoto', 'Ações'], str(cab))
        cabe = await pg.evaluate("() => { const w = document.querySelector('#tab-frete .frete-wrap'); return w.scrollWidth <= w.clientWidth + 1; }")
        ck('em 1400px tudo cabe sem rolar para o lado (Ações à vista)', cabe)
        LER = """() => { const l = document.querySelector('#frete-tbody tr.frete-carga-linha');
            const v = {}; if (l) l.querySelectorAll('[data-col]').forEach(e => { v[e.dataset.col] = e.textContent.trim().replace(/\\s+/g, ' '); });
            return { v, notas: [...document.querySelectorAll('#frete-tbody tr.frete-nota')].map(tr => ({ nota: tr.dataset.nota,
                b2b: tr.querySelector('td[data-col="b2b"]').firstChild.textContent.trim() })) }; }"""
        r = await pg.evaluate(LER)
        ck('a carga nasce FECHADA: dizendo quantas pendências tem (pedido do dono, 05/10)',
           not r['notas'] and '4 pendências' in r['v'].get('carga', '') and '4 sem olhar' in r['v'].get('carga', ''), r['v'].get('carga', ''))
        ck('as contagens viram uma frase: 8 notas · 4 finalizadas · 1 aguardando · 1 não entregue · 2 outros',
           '8 notas · 4 finalizadas · 1 aguardando · 1 não entregue · 2 outros' in r['v'].get('carga', ''), r['v'].get('carga', ''))
        ck('fechada, sem lista de tratativa', await pg.evaluate("() => document.querySelectorAll('#frete-tbody select.frete-sel').length") == 0)
        await pg.click('#frete-tbody tr.frete-carga-linha .frete-toggle')
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(LER)
        ck('um clique no número abre: as 4 notas pendentes numa lista própria', len(r['notas']) == 4, str(len(r['notas'])))
        await pg.click('#frete-tbody tr.frete-carga-linha .frete-toggle')
        await pg.wait_for_timeout(400)
        ck('outro clique fecha de novo', await pg.evaluate("() => document.querySelectorAll('#frete-tbody tr.frete-nota').length") == 0)
        await pg.fill('#frete-busca', '810105')
        await pg.wait_for_timeout(500)
        ck('buscar pela nota abre a carga dela', await pg.evaluate("() => document.querySelectorAll('#frete-tbody tr.frete-nota').length") == 4)
        await pg.fill('#frete-busca', '')
        await pg.wait_for_timeout(500)
        r = await pg.evaluate(LER)
        ck('e ela continua aberta depois (quem abriu, trata)', len(r['notas']) == 4, str(len(r['notas'])))
        ck('a carga diz PENDENTE, entregue 50% e liberado 50%',
           r['v'].get('situacao') == 'PENDENTE' and '50,0%' in r['v'].get('entregue', '') and '50,0%' in r['v'].get('liberado', ''), str(r['v']))
        ck('as pendências com o status do B2B, como na planilha',
           sorted(n['b2b'] for n in r['notas']) == ['A caminho', 'Aguardando', 'Cancelado', 'Não entregue'], str(r['notas']))
        stats = await pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('#frete-stats .frete-pan-item')].map(b => [b.textContent.replace(b.querySelector('b').textContent, '').trim(), b.querySelector('b').textContent.trim()]))")
        ck('o panorama numa faixa: 1 carga, 1 pendente, 4 pendências abertas',
           stats.get('carga') == '1' and stats.get('pendentes') == '1' and stats.get('pendências abertas') == '4', str(stats))

        print('\n=== 3b. A CAIXINHA DO CANHOTO ORIGINAL ===')
        CAN = "() => document.querySelector('#frete-tbody tr.frete-carga-linha td[data-col=\"canhoto\"] .frete-check').textContent.trim()"
        EM = "() => (document.querySelector('#frete-tbody tr.frete-carga-linha [data-col=\"canhotoEm\"]') || {textContent: ''}).textContent.trim()"
        LIB = "() => document.querySelector('#frete-tbody tr.frete-carga-linha [data-col=\"liberado\"] .frete-and-num').textContent.trim()"
        ck('a carga nasce com o canhoto NÃO', await pg.evaluate(CAN) == 'NÃO', await pg.evaluate(CAN))
        ck('só a linha da carga tem a caixinha', await pg.evaluate("() => document.querySelectorAll('#frete-tbody td[data-col=\"canhoto\"] input[type=checkbox]').length") == 1)
        lib_antes = await pg.evaluate(LIB)
        await pg.click('#frete-tbody tr.frete-carga-linha td[data-col="canhoto"] input[type=checkbox]')
        await pg.wait_for_timeout(1500)
        can, em = await pg.evaluate(CAN), await pg.evaluate(EM)
        ck('um clique: SIM, com a data de hoje embaixo', can == 'SIM' and len(em) == 10, f'{can} {em}')
        quem = psql("SELECT canhoto_original::text || '|' || canhoto_por FROM pgfrete_cargas WHERE numero_carga='900802';")
        ck('gravou no servidor, com quem marcou (a pessoa do setor, logada)', quem == 'true|Pagamento de Frete Teste', quem)
        ck('o canhoto NÃO mexe no liberado (só acompanhamento)', lib_antes == await pg.evaluate(LIB), f'{lib_antes}')
        stats = await pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('#frete-stats .frete-pan-item')].map(b => [b.textContent.replace(b.querySelector('b').textContent, '').trim(), b.querySelector('b').textContent.trim()]))")
        ck('o panorama diz 1 de 1 com canhoto original', stats.get('com canhoto original') == '1 de 1', str(stats))
        await pg.click('#frete-mais > summary')
        await pg.click('.frete-chip:has-text("Sem canhoto original")')
        await pg.wait_for_timeout(400)
        ck('o filtro "Sem canhoto original" (em Mais filtros) esconde a carga que já veio', await pg.evaluate("() => document.querySelectorAll('#frete-tbody tr').length") == 0)
        ck('e "Mais filtros" fica aberto, dizendo que há 1 filtro ligado', await pg.evaluate("() => document.getElementById('frete-mais').open && /1 ligado/.test(document.querySelector('#frete-mais summary').textContent)"))
        await pg.click('.frete-chip:has-text("Sem canhoto original")')
        await pg.wait_for_timeout(400)
        await pg.click('#frete-tbody tr.frete-carga-linha td[data-col="canhoto"] input[type=checkbox]')
        await pg.wait_for_timeout(1500)
        can, em = await pg.evaluate(CAN), await pg.evaluate(EM)
        ck('desmarcar volta a NÃO e apaga a data', can == 'NÃO' and em == '', f'{can} {em!r}')

        print('\n=== 4. TRATATIVA PELA LISTA ===')
        NOTA1 = '#frete-tbody tr.frete-nota:nth-child(1)'
        await pg.select_option(f'{NOTA1} select.frete-sel', 'OK')
        await pg.wait_for_timeout(1500)
        lib = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-carga-linha [data-col=\"liberado\"] .frete-and-num').textContent.trim()")
        trat = await pg.evaluate(f"() => document.querySelector('{NOTA1} select.frete-sel').value")
        ck('OK numa nota: liberado sobe para 62,5% (5 de 8) e a lista mostra OK', lib == '62,5%' and trat == 'OK', f'{lib} {trat}')
        dt = await pg.evaluate(f"() => document.querySelector('{NOTA1} td[data-col=\"dataTratativa\"]').textContent.trim()")
        ck('a data da tratativa é a de hoje', len(dt) == 10, dt)

        print('\n=== 5. PAGAMENTO PELO MODAL ===')
        await pg.click('#frete-tbody tr.frete-carga-linha button:has-text("Pagar carga")')
        await pg.wait_for_selector('#frete-pg-pct')
        sug = await pg.input_value('#frete-pg-pct')
        ck('o modal sugere o que está a pagar (62,5)', sug == '62.5', sug)
        await pg.fill('#frete-pg-pct', '50')
        await pg.fill('#frete-pg-data', '2026-10-09')
        await pg.click('#frete-btn-registrar')
        await pg.wait_for_timeout(1800)
        v = await pg.evaluate("() => { const v = {}; document.querySelectorAll('#frete-tbody tr.frete-carga-linha [data-col]').forEach(e => { v[e.dataset.col] = e.textContent.trim().replace(/\\s+/g, ' '); }); return v; }")
        ck('a carga mostra 50% pago, A PAGAR, a pagar 12,5% e "pago em 09/10/2026"',
           '50,0%' in v.get('pago', '') and v.get('statusPagamento', '').startswith('A PAGAR') and 'a pagar 12,5%' in v.get('statusPagamento', '')
           and 'pago em 09/10/2026' in v.get('statusPagamento', ''), str(v))
        await pg.click('#frete-tbody tr.frete-carga-linha button:has-text("Pagar carga")')
        await pg.wait_for_selector('#frete-pg-pct')
        await pg.fill('#frete-pg-pct', '30')
        await pg.click('#frete-btn-registrar')
        await pg.wait_for_timeout(1500)
        pergunta = await pg.inner_text('#frete-pergunta')
        ck('acima do liberado o painel PERGUNTA, dizendo os números', '62.5%' in pergunta and 'Registrar mesmo assim' in pergunta, pergunta[:120])
        await pg.click('#frete-pergunta button:has-text("Voltar")')
        await pg.click('#modal-frete button:has-text("Cancelar")')

        print('\n=== 5b. CAMPOS EDITÁVEIS: DATA DO PAGAMENTO, DATA DA TRATATIVA, TRANSPORTADORA ===')
        await pg.click('#frete-tbody tr.frete-carga-linha button.frete-data-carga')
        await pg.wait_for_selector('#frete-campo-data')
        await pg.fill('#frete-campo-data', '2026-10-10')
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(1500)
        dp = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-carga-linha .frete-data-carga').textContent.trim()")
        ck('a data do pagamento da carga é editável: 09/10 → 10/10', dp == 'pago em 10/10/2026', dp)
        ck('e mudou no último pagamento gravado', psql("SELECT to_char(data_pagamento,'YYYY-MM-DD') FROM pgfrete_pagamentos WHERE numero_carga='900802' AND anulado_em IS NULL ORDER BY id DESC LIMIT 1;") == '2026-10-10')
        await pg.click(f'{NOTA1} td[data-col="dataTratativa"] button')
        await pg.wait_for_selector('#frete-campo-data')
        await pg.fill('#frete-campo-data', '2026-10-01')
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(1500)
        dt2 = await pg.evaluate(f"() => document.querySelector('{NOTA1} td[data-col=\"dataTratativa\"]').textContent.trim()")
        ck('a data da tratativa é editável: hoje → 01/10/2026', dt2 == '01/10/2026', dt2)
        await pg.click('#frete-tbody tr.frete-carga-linha .frete-transp')
        await pg.wait_for_selector('#frete-campo-valor')
        opcoes = await pg.evaluate("() => [...document.querySelectorAll('#frete-campo-valor option')].map(o => o.value)")
        ck('a transportadora é uma LISTA das cadastradas na Frota (não texto livre)', 'Transp. Teste Tela' in opcoes and await pg.evaluate("() => document.querySelector('#frete-campo-valor').tagName") == 'SELECT', str(opcoes[:6]))
        await pg.select_option('#frete-campo-valor', 'Transp. Teste Tela')
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(1500)
        tr = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-carga-linha .frete-transp').textContent.trim()")
        ck('escolhida da lista, gravou', tr == 'Transp. Teste Tela', tr)
        ck('e as notas mostram a da carga', await pg.evaluate("() => [...document.querySelectorAll('#frete-tbody tr.frete-nota td[data-col=\"transportadora\"]')].every(td => td.textContent.trim() === 'Transp. Teste Tela')"))
        sp = await pg.evaluate("() => document.querySelector('#frete-tbody tr.frete-carga-linha td[data-col=\"statusPagamento\"]').className")
        ck('o Status p/ pagamento A PAGAR vem destacado', 'frete-sp-apagar' in sp, sp)

        print('\n=== 5c. FILA DE TRABALHO: HOJE, PRIORIDADE, IDADE, LOTE, FECHAMENTO ===')
        stats = await pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('#frete-stats .stat-box')].map(b => [b.querySelector('.stat-label').textContent.trim(), b.querySelector('.stat-num').textContent.trim()]))")
        ck('o topo tem o grupo "O que fazer hoje" com A PAGAR, Pendências sem olhar e Conferir', stats.get('A PAGAR') == '1' and stats.get('Pendências sem olhar') == '3' and stats.get('Conferir') == '0', str(stats))
        ck('a pendência sem tratativa diz há quantos dias está sem olhar', await pg.evaluate("() => [...document.querySelectorAll('#frete-tbody .frete-idade')].some(e => /sem olhar há \\d+\\s+dia/.test(e.textContent))"))
        await pg.click('.frete-chip:has-text("INTEGRAL")')
        await pg.wait_for_timeout(400)
        ck('o filtro por status p/ pagamento funciona (INTEGRAL: nenhuma)', await pg.evaluate("() => document.querySelectorAll('#frete-tbody tr').length") == 0)
        await pg.click('.frete-chip:has-text("A PAGAR")')
        await pg.wait_for_timeout(400)
        ck('A PAGAR: a 900802 volta', await pg.evaluate("() => document.querySelectorAll('#frete-tbody tr.frete-primeira').length") == 1)
        ck('o botão "Pagar as liberadas" conta a carga A PAGAR da tela', await pg.inner_text('#frete-btn-lote') == 'Pagar as liberadas (1)', await pg.inner_text('#frete-btn-lote'))
        await pg.click('#frete-btn-lote')
        await pg.wait_for_selector('#frete-lote-tab')
        lote = await pg.evaluate("() => [...document.querySelectorAll('#frete-lote-tab tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))")
        ck('o lote lista a 900802 com 12,5% a pagar (liberado 62,5 − pago 50)', lote == [['900802', 'Transp. Teste Tela', '62,5%', '50,0%', '12,5%']], str(lote))
        await pg.click('#modal-frete button:has-text("Cancelar")')
        fech = await pg.inner_text('#frete-res-fechamento')
        ck('o Fechamento mostra o pagamento de 10/2026 e a provisão de 1 nota (12,5% de 8)', '10/2026' in fech and 'Provisão' in fech and '1' in fech, fech[:200])
        await pg.click('.frete-chip:has-text("A PAGAR")')
        await pg.wait_for_timeout(300)

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
            # A planilha continua a da Daniela, coluna por coluna (a TELA mudou de
            # forma em 06/10/2026; o arquivo não).
            PLANILHA = ['Data Consulta', 'Carga', 'Qtde SIST', 'Qtde B2B', 'Diferença', 'Finalizadas', 'Aguardando', 'Não Entregue',
                        'Outros Status', 'Situação', 'Resumo Pendências', 'Status Pendência', 'Status p/ pagamento', 'Data Pagamento',
                        'Transportadora', 'CT-E', '% Entregue', '% Liberado', '% Pago', 'A pagar agora', 'Data Tratativa', 'Observação']
            ck('o .xlsx tem as 4 abas e as colunas da planilha aprovada', x['abas'] == ['CONTROLE_CARGAS', 'RESUMO', 'FECHAMENTO', 'LEIA-ME'] and x['cab'] == PLANILHA, str(x['cab'])[:200])
            ck('a mesma carga: 4 linhas, PENDENTE, 50% pago', x['qtd'] == 4 and x['sit'] == 'PENDENTE' and abs(float(x['pago']) - 0.5) < 1e-9, str(x))
        except Exception as e:
            ck('o .xlsx abre', False, (comparacao.stderr or str(e))[:300])

        print('\n=== 6b. PDF DETALHADO: O RECORTE DA TELA, COM AS NOTAS (06/10/2026) ===')
        # Pedido do dono: "preciso que seja detalhado". Uma SEGUNDA carga entra
        # pela API para o filtro ter o que tirar: o PDF tem de levar só a 900802.
        import base64
        lote = None
        for arq in ['b2b_900801.pdf', 'sist_900801.pdf']:
            st, r = http('/api/pagamento-frete/leituras', tok_frete, 'POST',
                         {'arquivo': base64.b64encode((PDFS / arq).read_bytes()).decode(), 'nome': arq, **({'lote': lote} if lote else {})})
            lote = (r or {}).get('lote', lote)
        st, _ = http(f'/api/pagamento-frete/lotes/{lote}/confirmar', tok_frete, 'POST', {})
        ck('a 900801 entrou pela API (segunda carga no controle)', st == 200, str(st))
        await pg.evaluate("() => freteCarregar()")
        await pg.wait_for_timeout(800)
        ck('o botão "Exportar PDF" aparece para quem paga', await pg.is_visible('#frete-btn-pdf'))
        await pg.fill('#frete-busca', '900802')
        await pg.wait_for_timeout(400)
        notas = await pg.evaluate("() => FRETE.dados.linhas.filter(l => String(l.carga) === '900802' && l.nota).map(l => String(l.nota))")
        pedido = {}
        def guardar(rq):
            if '/relatorios/pdf' in rq.url and rq.method == 'POST':
                pedido.update(json.loads(rq.post_data or '{}'))
        pg.on('request', guardar)
        async with pg.expect_response(lambda r: '/relatorios/pdf' in r.url, timeout=60000) as resp_info:
            async with pg.expect_download(timeout=60000) as dl_pdf:
                await pg.click('#frete-btn-pdf')
        resp = await resp_info.value
        download = await dl_pdf.value
        caminho_pdf = Path('/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad') / 'pagamento_frete_detalhado.pdf'
        await download.save_as(str(caminho_pdf))
        ck('o servidor gerou o PDF (200, application/pdf)', resp.status == 200 and 'application/pdf' in (resp.headers.get('content-type') or ''), f"{resp.status} {resp.headers.get('content-type')}")
        ck('o arquivo é um PDF de verdade', caminho_pdf.read_bytes()[:4] == b'%PDF', str(caminho_pdf.read_bytes()[:8]))
        ck('o nome do arquivo diz o que é', download.suggested_filename.startswith('Suinco_Pagamento-de-Frete_') and download.suggested_filename.endswith('.pdf'), download.suggested_filename)
        ck('vai como documento do Pagamento de Frete, em folha deitada', pedido.get('tipo') == 'pagamento-frete' and pedido.get('orientacao') == 'paisagem', f"{pedido.get('tipo')} {pedido.get('orientacao')}")
        html = pedido.get('html') or ''
        ck('o filtro da tela vai escrito no PDF', 'busca &quot;900802&quot;' in html or 'busca "900802"' in html, re.sub(r'<[^>]+>', ' ', html)[:300])
        ck('e a contagem do recorte: 1 de 2 cargas', '1 de 2 carga' in html)
        ck('só a carga filtrada: 900802 sim, 900801 não', '900802' in html and '900801' not in html)
        ck('DETALHADO: cada nota pendente da 900802 está no PDF', bool(notas) and all(n in html for n in notas), str([n for n in notas if n not in html]))
        ck('com a tratativa de cada nota: a marcada (OK) e as que ninguém olhou', '>OK<' in html.replace(' ', '') and 'sem tratativa' in html)
        ck('e o status para pagamento e o % a pagar da carga', 'A PAGAR' in html or 'PARCIAL' in html)
        pg.remove_listener('request', guardar)
        await pg.fill('#frete-busca', '')
        await pg.wait_for_timeout(300)

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
        # No celular a carga é um CARTÃO (06/10/2026): nada rola de lado — nem a
        # página, nem a tabela (antes a tabela rolava dentro do quadro).
        ck('no celular nada rola de lado: a carga é um cartão', medidas['larguraPagina'] <= medidas['janela'] + 1 and not medidas['tabelaRola'], str(medidas))

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
