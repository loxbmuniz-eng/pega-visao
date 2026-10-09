#!/usr/bin/env python3
"""A Logística trabalha na aba Pagamento de Frete (09/10/2026).

Pedido do dono, com as palavras dele: "vamo liberar o pagamento de frete pra
logistica pois as meninas precisam ter acesso pra poder fazer alteracao,
deixa o acesso liberado pra logistica". A permissão é por SETOR (decisão de
05/10: "os usuários permanecem na aba de usuários, e as permissões são
definidas lá") — então vale para todo o setor Logística, com tudo o que o
setor Pagamento de Frete faz.

O CAMINHO, com o painel inteiro e a API de verdade, como a pessoa da
Logística vê:
  1. quem é da Logística vê a aba Pagamento de Frete — e continua com todas
     as abas que já tinha; Portaria, Expedição, Faturamento e Comercial
     continuam SEM a aba; o setor Pagamento de Frete continua só com ela;
  2. a Logística importa os dois PDFs de uma carga e grava;
  3. muda a transportadora da carga pela janela e o servidor grava;
  4. registra um pagamento e o servidor grava, com o nome de quem pagou;
  5. com o SERVIDOR AINDA NÃO ATUALIZADO (ele recusa a Logística), a aba diz
     isso com todas as letras — e não "esta aba é de outro setor", que
     mandaria a pessoa procurar a Administração por um acesso que já tem.

REPROVA contra o publicado (a aba não aparece para a Logística):
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh logistica_no_pagamento_de_frete

    bash testes/rodar_tudo.sh logistica_no_pagamento_de_frete
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
DA_FROTA = 'Transp. Teste Logística no Frete'
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


def operador(email, setor, nome=None):
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';")
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{nome or setor + ' Teste'}', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


def limpar():
    for t in ['pgfrete_eventos', 'pgfrete_leituras', 'pgfrete_pagamentos', 'pgfrete_pendencias', 'pgfrete_cargas']:
        psql(f'DELETE FROM {t};')
    psql("DELETE FROM dim_veiculos WHERE placa = 'TST9C01';")


async def abrir_painel(ctx, servidor_antigo=False):
    pagina = await ctx.new_page()
    await pagina.set_viewport_size({'width': 1600, 'height': 1000})
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    if servidor_antigo:
        # O SERVIDOR DE ANTES DO atualizar_tudo.sh: a mesma resposta, letra por
        # letra, que rotas/pagamento_frete.js dava à Logística até 09/10/2026.
        corpo = json.dumps({'erro': 'Esta ação é do setor Pagamento de Frete.', 'codigo': 'SETOR_SEM_PERMISSAO'})
        await pagina.route('**/api/pagamento-frete**', lambda rota: asyncio.ensure_future(
            rota.fulfill(status=403, content_type='application/json', body=corpo)))
    await pagina.goto(url)
    await pagina.wait_for_timeout(1000)
    return pagina


async def main():
    limpar()
    psql(f"INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('TST9C01', '{DA_FROTA}', 'Truck', 'teste');")
    contas = {
        'Logística': ('logistica.frete@teste.local', 'Meninas da Logística Teste'),
        'Pagamento de Frete': ('pgfrete.log@teste.local', None),
        'Portaria': ('portaria.log@teste.local', None),
        'Expedição': ('expedicao.log@teste.local', None),
        'Faturamento': ('faturamento.log@teste.local', None),
        'Comercial': ('comercial.log@teste.local', None),
    }
    tokens = {s: operador(e, s, n) for s, (e, n) in contas.items()}
    ck('operadores de teste criados', all(tokens.values()), str([s for s, t in tokens.items() if not t]))
    if not all(tokens.values()):
        return 1

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        async def painel_de(setor, servidor_antigo=False):
            c = await nav.new_context()
            pg = await abrir_painel(c, servidor_antigo)
            pg.on('pageerror', lambda e: erros.append(str(e)))
            await pg.fill('#login-email', contas[setor][0])
            await pg.fill('#login-senha', SENHA)
            await pg.click('#btn-entrar')
            await pg.wait_for_timeout(2000)
            return pg

        async def abas(pg):
            return await pg.evaluate("() => [...document.querySelectorAll('.nav-tab')].filter(e => !e.hidden && e.offsetParent !== null).map(e => e.dataset.tab)")

        print('\n=== 1. QUEM VÊ A ABA ===')
        pg = await painel_de('Logística')
        vis = await abas(pg)
        ck('a Logística vê a aba Pagamento de Frete', 'frete' in vis, str(vis))
        ck('e continua com todas as abas que já tinha',
           all(a in vis for a in ['torre', 'patio', 'programacao', 'devolucoes', 'portaria', 'expedicao',
                                  'faturamento', 'indicadores', 'cadastros', 'historico', 'relatorios']), str(vis))
        for setor in ['Portaria', 'Expedição', 'Faturamento', 'Comercial']:
            outro = await painel_de(setor)
            ck(f'{setor} continua SEM a aba', 'frete' not in await abas(outro))
            await outro.context.close()
        outro = await painel_de('Pagamento de Frete')
        v2 = await abas(outro)
        ck('o setor Pagamento de Frete continua só com a aba dele (mais a Minha segurança)', sorted(v2) == ['frete', 'usuarios'], str(v2))
        await outro.context.close()

        print('\n=== 2. A LOGÍSTICA IMPORTA E GRAVA ===')
        if 'frete' not in vis:
            ck('(sem a aba, a Logística não chega ao resto do caminho)', False)
        else:
            await pg.click('.nav-tab[data-tab="frete"]')
            await pg.wait_for_timeout(1200)
            aviso = await pg.evaluate("() => { const a = document.getElementById('frete-aviso'); return a && !a.hidden ? a.textContent : ''; }")
            ck('a aba abre sem recusa do servidor', not aviso, aviso[:160])
            await pg.click('#frete-btn-importar')
            await pg.wait_for_selector('#frete-arquivos', state='attached')
            await pg.set_input_files('#frete-arquivos', [str(PDFS / 'b2b_900802.pdf'), str(PDFS / 'sist_900802.pdf')])
            try:
                await pg.wait_for_selector('#modal-frete .frete-prev-ok', timeout=60000)
            except Exception:
                print('   modal:', (await pg.inner_text('#modal-frete'))[:400])
            await pg.click('#frete-btn-gravar')
            await pg.wait_for_timeout(2500)
            ck('a carga 900802 entrou no controle, importada pela Logística',
               psql("SELECT count(*) FROM pgfrete_cargas WHERE numero_carga='900802';") == '1')

            print('\n=== 3. A LOGÍSTICA MUDA A TRANSPORTADORA ===')
            await pg.locator('#frete-tbody tr.frete-carga-linha[data-carga="900802"] button.frete-transp').first.click()
            await pg.wait_for_timeout(500)
            await pg.select_option('#frete-campo-valor', DA_FROTA)
            await pg.click('#modal-frete button:has-text("Salvar")')
            await pg.wait_for_timeout(2000)
            ck('a transportadora foi gravada no servidor',
               psql("SELECT transportadora FROM pgfrete_cargas WHERE numero_carga='900802'") == DA_FROTA)

            print('\n=== 4. A LOGÍSTICA REGISTRA UM PAGAMENTO ===')
            await pg.click('#frete-tbody tr.frete-carga-linha button:has-text("Pagar carga")')
            await pg.wait_for_selector('#frete-pg-pct')
            await pg.fill('#frete-pg-pct', '50')
            await pg.fill('#frete-pg-data', '2026-10-09')
            await pg.click('#frete-btn-registrar')
            await pg.wait_for_timeout(1800)
            quem = psql("SELECT pct || '|' || criado_por_nome FROM pgfrete_pagamentos WHERE numero_carga='900802' AND anulado_em IS NULL ORDER BY id DESC LIMIT 1;")
            ck('o pagamento de 50% foi gravado com o nome de quem pagou', quem.startswith('50') and 'Meninas da Logística Teste' in quem, quem)
        await pg.context.close()

        print('\n=== 5. SERVIDOR AINDA NÃO ATUALIZADO: A ABA DIZ ISSO ===')
        pg = await painel_de('Logística', servidor_antigo=True)
        if 'frete' in await abas(pg):
            await pg.click('.nav-tab[data-tab="frete"]')
            await pg.wait_for_timeout(1500)
            aviso = await pg.evaluate("() => { const a = document.getElementById('frete-aviso'); return a && !a.hidden ? a.textContent : ''; }")
            ck('a aba diz que o servidor ainda não liberou a Logística', 'servidor ainda não liberou' in aviso and 'Logística' in aviso, aviso[:200])
            ck('e NÃO manda a pessoa a outro setor ("Esta aba é do setor…")', 'Esta aba é do setor' not in aviso, aviso[:200])
        else:
            ck('(sem a aba, não há o que avisar)', False)
        await pg.context.close()

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: a Logística trabalha na aba Pagamento de Frete.')
    return 0


def limpar_tudo():
    limpar()
    psql("DELETE FROM operadores WHERE email LIKE '%.log@teste.local' OR email = 'logistica.frete@teste.local';")


if __name__ == '__main__':
    # A limpeza roda MESMO se a suíte cair no meio: suíte que cai e deixa placa
    # na Frota de teste reprova a suíte seguinte (portão 75, test_adaptador_api
    # contou 751 placas em vez de 749).
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar_tudo()
