#!/usr/bin/env python3
"""A transportadora que o painel oferece é a que o servidor aceita (09/10/2026, ocorrência #128).

RELATO DO DONO, com print da Daniela (Pagamento de Frete): ela escolheu
"AG Sestini Transporte e Logistica Ltda" na lista da carga 119072 e o
servidor recusou — "não está no cadastro da Frota. Cadastre em Cadastros e
escolha na lista." — e a AG Sestini JÁ ESTAVA na Frota.

A CAUSA, no código:
  · a lista da carga juntava DUAS fontes: as transportadoras da Frota (o
    servidor) e a lista "Transportadoras" do Cadastros, que mora só no
    navegador e nunca chega ao servidor;
  · o servidor só aceita nome de placa da Frota, letra por letra
    (dim_veiculos.transportadora = $1);
  · a recusa mandava "cadastrar em Cadastros" — e o quadro "Transportadoras"
    do Cadastros aceitava o nome, gravava no navegador e o oferecia de novo.
    Um nome escrito de outro jeito ("Transporte"/"Transportes",
    "Logistica"/"Logística") virava opção que o servidor nunca aceita.

O QUE ESTE TESTE TRAVA, pela tela, com o servidor e o banco de teste:
  1. o navegador da Daniela tem o nome antigo (como o quadro antigo gravava);
     a lista da carga só oferece nomes que estão numa placa da Frota;
  2. escolher o nome da Frota grava (o caminho certo continua certo);
  3. o quadro "Transportadoras" do Cadastros mostra as transportadoras da
     Frota, com quantas placas cada uma tem, e busca por nome;
  4. o nome que só existe neste navegador aparece SEPARADO, dito como tal;
  5. as sugestões ao digitar transportadora (Frota, Programação) vêm da Frota;
  6. se o servidor recusar mesmo assim (a placa mudou de transportadora
     depois que a tela carregou), a mensagem diz o caminho, dentro da janela;
  7. no celular, o quadro aberto não estica a página (a lista rola por dentro);
  8. TRANSPORTADORA SEM PLACA (#129, migração 066 — "nem toda transportadora
     tem placa vinculada"; a AG Sestini e a Versatto operam rota sem placa):
     a Daniela, do setor Pagamento de Frete, cadastra na própria janela da
     carga, a lista já a escolhe, e o servidor grava; um nome parecido com
     um existente é recusado e a lista escolhe o existente;
  9. no Cadastros, a sem placa aparece com o selo e o Excluir que pergunta; o
     nome antigo do navegador tenta ir ao servidor e, parecido com um
     existente, fica para excluir.

    bash testes/rodar_tudo.sh test_transportadora_que_o_servidor_aceita
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
PAINEL = Path(os.environ.get('SUINCO_PAINEL_ARQUIVO', str(RAIZ / 'index.html')))
PDFS = RAIZ / 'backend' / 'testes' / 'fixtures' / 'frete'
falhas = []

DA_FROTA = 'AG Sestini Teste Transportes e Logística Ltda.'      # como está na placa
DO_NAVEGADOR = 'AG Sestini Teste Transporte e Logistica Ltda'      # como foi digitado no quadro antigo
QUE_SAI = 'Transportadora Que Sai Teste'                           # a placa muda depois de a tela carregar


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


SEM_PLACA = 'AG Sestini Sem Placa Teste Transportes Ltda.'


def limpar():
    for t in ['pgfrete_eventos', 'pgfrete_leituras', 'pgfrete_pagamentos', 'pgfrete_pendencias', 'pgfrete_cargas']:
        psql(f'DELETE FROM {t};')
    psql("DELETE FROM dim_veiculos WHERE placa IN ('TST9B01','TST9B02');")
    psql("DELETE FROM transportadoras WHERE nome LIKE '%Teste%';")


async def abrir_painel(ctx, viewport=None):
    pagina = await ctx.new_page()
    await pagina.set_viewport_size(viewport or {'width': 1600, 'height': 1000})
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    # O NAVEGADOR DA DANIELA: o quadro antigo "Transportadoras" gravava o nome
    # digitado no armazenamento deste navegador (chave suinco_painel_v1). É o
    # estado com que ela abriu o painel — dado do navegador, não atalho da tela.
    await pagina.add_init_script(
        "try{ if(!localStorage.getItem('suinco_painel_v1')) localStorage.setItem('suinco_painel_v1', "
        + json.dumps(json.dumps({'transportadoras': [{'id': 'transp-legado-1', 'nome': DO_NAVEGADOR}]}))
        + "); }catch(e){}")
    await pagina.goto(url)
    await pagina.wait_for_timeout(1000)
    return pagina


async def opcoes_do_select(pg, sel):
    return await pg.eval_on_selector_all(f'{sel} option', 'os => os.map(o => o.value).filter(Boolean)')


async def main():
    limpar()
    psql(f"INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('TST9B01', '{DA_FROTA}', 'Carreta', 'teste');")
    psql(f"INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('TST9B02', '{QUE_SAI}', 'Truck', 'teste');")
    tok = operador('transp.adm@teste.local', 'Administração')
    ck('operador da Administração criado', bool(tok))
    if not tok:
        return 1

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        ctx = await nav.new_context()
        pg = await abrir_painel(ctx)
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.fill('#login-email', 'transp.adm@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(2500)

        print('\n=== 0. A CARGA NO PAGAMENTO DE FRETE ===')
        await pg.click('.nav-tab[data-tab="frete"]')
        await pg.wait_for_timeout(800)
        await pg.click('#frete-btn-importar')
        await pg.wait_for_selector('#frete-arquivos', state='attached')
        await pg.set_input_files('#frete-arquivos', [str(PDFS / 'b2b_900802.pdf'), str(PDFS / 'sist_900802.pdf')])
        await pg.wait_for_selector('#modal-frete .frete-prev-ok', timeout=60000)
        await pg.click('#frete-btn-gravar')
        await pg.wait_for_timeout(2500)
        ck('(a carga 900802 entrou no controle)', psql("SELECT count(*) FROM pgfrete_cargas WHERE numero_carga='900802';") == '1')
        ck('(a tela conhece a placa da Frota)', await pg.evaluate("(n) => DB.frota.some(f => f.transportadora === n)", DA_FROTA))

        print('\n=== 1. A LISTA DA CARGA SÓ OFERECE O QUE O SERVIDOR ACEITA ===')
        # o caminho da Daniela: o botão da transportadora na linha da carga
        await pg.locator('#frete-tbody tr.frete-carga-linha[data-carga="900802"] button.frete-transp').first.click()
        await pg.wait_for_timeout(500)
        ck('(abre a janela "Transportadora da carga")', 'Transportadora da carga 900802' in await pg.inner_text('#frete-modal-titulo'))
        ops = await opcoes_do_select(pg, '#frete-campo-valor')
        ck('a lista oferece a transportadora da Frota', DA_FROTA in ops, str(len(ops)))
        ck('a lista NÃO oferece o nome que só existe neste navegador', DO_NAVEGADOR not in ops)
        frota = set(psql("SELECT DISTINCT transportadora FROM dim_veiculos WHERE transportadora IS NOT NULL "
                         "UNION SELECT nome FROM transportadoras WHERE excluida_em IS NULL").split('\n'))
        fora = [o for o in ops if o not in frota]
        ck('toda opção da lista é transportadora cadastrada no banco (placa da Frota ou sem placa)', not fora, str(fora[:5]))

        print('\n=== 2. O CAMINHO CERTO GRAVA ===')
        await pg.select_option('#frete-campo-valor', DA_FROTA)
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(2000)
        ck('a transportadora da Frota foi gravada na carga',
           psql("SELECT transportadora FROM pgfrete_cargas WHERE numero_carga='900802'") == DA_FROTA)

        print('\n=== 6. A RECUSA DIZ O CAMINHO: A PLACA NA FROTA ===')
        # Depois de a tela carregar, a placa TST9B02 deixa de ser dessa
        # transportadora (alguém corrigiu a Frota em outro computador).
        psql(f"UPDATE dim_veiculos SET transportadora = 'Outra Teste' WHERE placa = 'TST9B02';")
        await pg.locator('#frete-tbody tr.frete-carga-linha[data-carga="900802"] button.frete-transp').first.click()
        await pg.wait_for_timeout(500)
        if QUE_SAI in await opcoes_do_select(pg, '#frete-campo-valor'):
            await pg.select_option('#frete-campo-valor', QUE_SAI)
            await pg.click('#modal-frete button:has-text("Salvar")')
            await pg.wait_for_timeout(2000)
            # Com três avisos já na tela, o quarto espera na fila — por isso a
            # recusa tem de aparecer DENTRO da janela, junto do campo.
            janela = await pg.evaluate("() => { const m = document.getElementById('modal-frete'); return m && m.classList.contains('open') ? m.innerText : ''; }")
            ck('a recusa aparece dentro da janela, junto do campo', 'não está' in janela, janela[:220])
            ck('e manda cadastrar a PLACA da transportadora na Frota (não "em Cadastros")',
               'placa' in janela.lower() and 'Frota' in janela, janela[:260])
            if await pg.locator('#modal-frete button:has-text("Cancelar")').count():
                await pg.click('#modal-frete button:has-text("Cancelar")')
                await pg.wait_for_timeout(300)
        else:
            ck('(a transportadora da placa TST9B02 estava na lista ao carregar)', False)

        print('\n=== 3, 4 e 5. O QUADRO "TRANSPORTADORAS" E AS SUGESTÕES ===')
        await pg.click('.nav-tab[data-tab="cadastros"]')
        await pg.wait_for_timeout(800)
        card = await pg.evaluate("() => document.getElementById('card-transportadoras').innerText")
        ck('o quadro mostra a transportadora da Frota', DA_FROTA in card, card[:200])
        ck('com quantas placas ela tem', f'{DA_FROTA}' in card and '1 placa' in card, card[:300])
        busca = await pg.locator('#cad-transp-busca').count()
        ck('o quadro tem busca por nome', busca == 1)
        if busca:
            await pg.fill('#cad-transp-busca', 'sestini teste')
            await pg.wait_for_timeout(400)
            visiveis = await pg.evaluate("""() => [...document.querySelectorAll('#cad-transp-lista .transp-item')]
                .filter(e => e.getClientRects().length).map(e => e.innerText)""")
            ck('a busca acha a AG Sestini da Frota (sem acento e sem maiúscula)',
               any(DA_FROTA in v for v in visiveis), str(visiveis)[:200])
        so_aqui = await pg.evaluate("""() => { const b = document.getElementById('cad-transp-so-aqui');
            return b && b.getClientRects().length ? b.innerText : ''; }""")
        ck('o nome que só existe neste navegador aparece separado, dito como tal',
           DO_NAVEGADOR in so_aqui and 'servidor' in so_aqui.lower(), so_aqui[:200])
        lista_dl = await pg.eval_on_selector_all('#lista-transportadoras option', 'os => os.map(o => o.value)')
        ck('as sugestões ao digitar transportadora vêm da Frota', DA_FROTA in lista_dl and DO_NAVEGADOR not in lista_dl,
           str([x for x in lista_dl if 'Sestini' in x]))

        print('\n=== 7. NO CELULAR, A LISTA ROLA POR DENTRO ===')
        cel = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pc = await abrir_painel(cel, {'width': 390, 'height': 844})
        await pc.fill('#login-email', 'transp.adm@teste.local')
        await pc.fill('#login-senha', SENHA)
        await pc.click('#btn-entrar')
        await pc.wait_for_timeout(2500)
        await pc.click('#btn-menu')
        await pc.wait_for_timeout(300)
        await pc.click('.nav-tab[data-tab="cadastros"]')
        await pc.wait_for_timeout(600)
        await pc.click('.ir-para[data-ir-para="cadastros"] .ir-para-item[data-alvo="card-transportadoras"]')
        await pc.wait_for_timeout(600)
        alto = await pc.evaluate("() => Math.round(document.getElementById('card-transportadoras').getBoundingClientRect().height)")
        ck('aberto no celular, o quadro não estica a página com as 134 transportadoras', alto < 1200, f'{alto} px')
        await cel.close()

        print('\n=== 8. A DANIELA CADASTRA A TRANSPORTADORA SEM PLACA NA JANELA DA CARGA ===')
        tok_d = operador('daniela.transp@teste.local', 'Pagamento de Frete')
        ck('(operadora do setor Pagamento de Frete criada)', bool(tok_d))
        cd = await nav.new_context()
        pd = await abrir_painel(cd)
        pd.on('pageerror', lambda e: erros.append(str(e)))
        await pd.fill('#login-email', 'daniela.transp@teste.local')
        await pd.fill('#login-senha', SENHA)
        await pd.click('#btn-entrar')
        await pd.wait_for_timeout(2500)
        await pd.click('.nav-tab[data-tab="frete"]')
        await pd.wait_for_timeout(1200)
        await pd.locator('#frete-tbody tr.frete-carga-linha[data-carga="900802"] button.frete-transp').first.click()
        await pd.wait_for_timeout(500)
        ck('a janela da carga oferece "Cadastrar transportadora sem placa"',
           await pd.locator('#modal-frete .frete-cad-rapido button.btn-link').count() == 1)
        if await pd.locator('#modal-frete .frete-cad-rapido button.btn-link').count():
            await pd.click('#modal-frete .frete-cad-rapido button.btn-link')
            await pd.fill('#modal-frete .frete-cad-rapido-nome', SEM_PLACA)
            await pd.click('#modal-frete .frete-cad-rapido-ok')
            await pd.wait_for_timeout(1500)
            ck('o servidor guardou a transportadora sem placa, com quem cadastrou',
               psql(f"SELECT criado_por FROM transportadoras WHERE nome = '{SEM_PLACA}' AND excluida_em IS NULL") == 'Pagamento de Frete Teste')
            ck('a lista da janela já a escolheu', await pd.input_value('#frete-campo-valor') == SEM_PLACA)
            await pd.click('#modal-frete button:has-text("Salvar")')
            await pd.wait_for_timeout(2000)
            ck('e o servidor aceitou na carga', psql("SELECT transportadora FROM pgfrete_cargas WHERE numero_carga='900802'") == SEM_PLACA)
            # nome parecido com um existente: recusa e escolhe o existente
            await pd.locator('#frete-tbody tr.frete-carga-linha[data-carga="900802"] button.frete-transp').first.click()
            await pd.wait_for_timeout(500)
            await pd.click('#modal-frete .frete-cad-rapido button.btn-link')
            await pd.fill('#modal-frete .frete-cad-rapido-nome', 'ag sestini sem placa teste transporte ltda')
            await pd.click('#modal-frete .frete-cad-rapido-ok')
            await pd.wait_for_timeout(1500)
            msg = await pd.inner_text('#modal-frete .frete-cad-rapido-msg')
            ck('nome parecido com um existente: a janela diz qual existe', 'Já existe' in msg and SEM_PLACA in msg, msg[:200])
            ck('e a lista escolhe o existente', await pd.input_value('#frete-campo-valor') == SEM_PLACA)
            ck('sem cadastrar o parecido', psql("SELECT count(*) FROM transportadoras WHERE nome ILIKE 'ag sestini sem placa teste transporte ltda'") == '0')
            await pd.click('#modal-frete button:has-text("Cancelar")')
        await cd.close()

        print('\n=== 9. NO CADASTROS: O SELO, O EXCLUIR, E O NOME ANTIGO ===')
        await pg.reload()
        await pg.wait_for_timeout(2500)
        await pg.click('.nav-tab[data-tab="cadastros"]')
        await pg.wait_for_timeout(1500)
        await pg.fill('#cad-transp-busca', 'sem placa teste')
        await pg.wait_for_timeout(500)
        item = pg.locator('#cad-transp-lista .transp-item', has_text=SEM_PLACA)
        ck('a sem placa aparece no quadro, com o selo "sem placa"', await item.count() == 1 and 'sem placa' in (await item.inner_text()).lower())
        so_aqui = pg.locator('#cad-transp-so-aqui .modal-list-item', has_text=DO_NAVEGADOR)
        if await so_aqui.count():
            await so_aqui.locator('button:has-text("Cadastrar no servidor")').click()
            await pg.wait_for_timeout(1500)
            aviso = await pg.evaluate("() => [...document.querySelectorAll('#notif *')].map(e => e.innerText).join(' | ')")
            ck('o nome antigo, parecido com o da Frota, NÃO vai ao servidor — e o aviso diz qual existe',
               psql(f"SELECT count(*) FROM transportadoras WHERE nome = '{DO_NAVEGADOR}'") == '0' and DA_FROTA in aviso, aviso[:200])
        else:
            ck('(o nome antigo aparece em "Só neste computador")', False)
        if await item.count():
            await item.locator('button:has-text("Excluir")').click()
            await pg.wait_for_timeout(400)
            ck('excluir a sem placa pergunta antes', 'Excluir a transportadora' in await pg.evaluate("() => (document.getElementById('pergunta-titulo')||{}).textContent || ''"))
            await pg.click('#pergunta-ok')
            await pg.wait_for_timeout(1500)
            ck('confirmado, sai da lista do servidor (a linha fica marcada)',
               psql(f"SELECT count(*) FROM transportadoras WHERE nome = '{SEM_PLACA}' AND excluida_em IS NOT NULL") == '1'
               and await pg.locator('#cad-transp-lista .transp-item', has_text=SEM_PLACA).count() == 0)
        psql("DELETE FROM operadores WHERE email = 'daniela.transp@teste.local';")

        ck('sem erro de JavaScript', not erros, ' | '.join(erros[:3]))
        await nav.close()

    limpar()
    psql("DELETE FROM operadores WHERE email = 'transp.adm@teste.local';")
    print(f"\n{len(falhas)} FALHA(S)" + (': ' + ', '.join(falhas) if falhas else ''))
    return 1 if falhas else 0


if __name__ == '__main__':
    # A LIMPEZA RODA MESMO SE A SUÍTE CAIR NO MEIO (#130). Rodada contra o
    # painel publicado (prova do vermelho), ela parava num botão que ainda não
    # existia e deixava as placas TST9B01/TST9B02 na Frota de teste — e o
    # test_adaptador_api, que conta 749 placas, reprovou no portão 75 sem
    # defeito nenhum.
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar()
        psql("DELETE FROM operadores WHERE email IN ('transp.adm@teste.local', 'daniela.transp@teste.local');")
