#!/usr/bin/env python3
"""Devoluções: a data de cada checklist à vista na linha fechada (07/10/2026).

PEDIDO DO DONO: "seria legal ter a data em cada checklist também na linha
quando está minimizado — só consigo ver ao clicar e expandir o conteúdo de
cada linha".

Antes: a linha fechada mostrava Nº, rota, status, quem criou e os itens; a
data da devolução só aparecia dentro, no campo "Data da devolução" — e, para
quem só lê (Portaria), escrita como o banco guarda ("2026-10-01").

O QUE ESTE TESTE TRAVA, pela tela, no servidor de teste:
  1. a Administração cria dois checklists pelo formulário — um com a data de
     01/10/2026 (devolução lançada depois), outro com a de hoje;
  2. em 1366 e 390 px, a linha FECHADA de cada um mostra a data dd/mm/aaaa,
     inteira (sem partir nem cortar);
  3. é a mesma data de dentro do checklist (campo Data da devolução);
  4. a Portaria, que só lê, vê a data dd/mm/aaaa dentro do checklist e na
     linha fechada.

    bash testes/rodar_tudo.sh test_checklist_data_na_linha
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parent.parent
PAINEL = RAIZ / 'index.html'
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q, capture_output=True, text=True)
    return r.stdout.strip()


def http(c, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, None


def operador(email, setor):
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';")
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} Teste', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


def br(iso):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', iso or '')
    return f'{m[3]}/{m[2]}/{m[1]}' if m else (iso or '').strip()


async def abrir(nav, email, viewport):
    ctx = await nav.new_context(viewport=viewport)
    pg = await ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__checklist_data'
    await pg.route(url, lambda rota: asyncio.ensure_future(rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2500)
    if viewport['width'] < 821:
        await pg.click('#btn-menu')
        await pg.wait_for_timeout(400)
    await pg.click('.nav-tab[data-tab="devolucoes"]')
    await pg.wait_for_timeout(1500)
    return ctx, pg, erros


LINHA = r"""(card) => {
  const t = card.querySelector('.dev-card-topo');
  const el = t && t.querySelector('.dev-card-data');
  const num = ((t && t.textContent.match(/Checklist Nº\s*(\d+)/)) || [])[1] || '';
  if(!el || !el.getBoundingClientRect().width) return { num, txt:'', vis:false };
  const r = document.createRange(); r.selectNodeContents(el);
  const rs = [...r.getClientRects()].filter(x => x.width > 0);
  const c = t.getBoundingClientRect(), d = el.getBoundingClientRect();
  return { num, txt: el.textContent.trim(), vis: true, linhas: new Set(rs.map(x => Math.round(x.top))).size,
           dentro: d.right <= c.right + .5 && d.left >= c.left - .5 };
}"""


async def conferir_lista(pg, larg, numeros, esperado, quem):
    """A linha fechada de cada checklist criado: data à vista, inteira e igual à de dentro."""
    for num in numeros:
        card = pg.locator('#dev-lista .dev-card', has_text=f'Checklist Nº {num}').first
        if await card.evaluate("c => c.classList.contains('dev-aberta')"):
            await card.locator('.dev-card-topo').click()
            await pg.wait_for_timeout(400)
            card = pg.locator('#dev-lista .dev-card', has_text=f'Checklist Nº {num}').first
        info = await card.evaluate(LINHA)
        ck(f'{quem} {larg}px: a linha fechada do Nº {num} mostra a data {esperado[num]}',
           info['vis'] and info['txt'] == esperado[num], str(info))
        if info['vis']:
            ck(f'{quem} {larg}px: a data do Nº {num} inteira, sem partir nem cortar',
               info['linhas'] == 1 and info['dentro'], str(info))
        await card.locator('.dev-card-topo').click()
        await pg.wait_for_timeout(500)
        card = pg.locator('#dev-lista .dev-card', has_text=f'Checklist Nº {num}').first
        inp = card.locator('input[type="date"][id$="-dataDev"]')
        if await inp.count():
            dentro = br(await inp.input_value())
        else:
            ro = card.locator('.dev-cab-grid .dev-ro').first
            dentro = (await ro.inner_text()).strip() if await ro.count() else ''
        ck(f'{quem} {larg}px: dentro do Nº {num} a data é a mesma, dd/mm/aaaa', dentro == esperado[num], repr(dentro))
        await card.locator('.dev-card-topo').click()
        await pg.wait_for_timeout(300)


async def main():
    for t in ['devolucao_itens', 'devolucao_divergencias', 'devolucao_rotas', 'devolucao_revisoes', 'devolucoes']:
        psql(f'DELETE FROM {t};')
    ok = operador('chk.adm@teste.local', 'Administração') and operador('chk.port@teste.local', 'Portaria')
    ck('operadores Administração e Portaria criados', bool(ok))
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')

        print('\n=== 1. A ADMINISTRAÇÃO CRIA DOIS CHECKLISTS PELO FORMULÁRIO ===')
        ctx, pg, erros = await abrir(nav, 'chk.adm@teste.local', {'width': 1366, 'height': 900})
        hoje = await pg.evaluate("() => diaLocalDev()")
        esperado = {}
        for data in ('2026-10-01', hoje):
            await pg.fill('#dev-data', data)
            await pg.select_option('#dev-rota', index=1)
            await pg.click('button:has-text("Criar checklist")')
            await pg.wait_for_timeout(2000)
            num = psql("SELECT numero FROM devolucoes ORDER BY criado_em DESC LIMIT 1;")
            esperado[num] = br(data)
        ck('os dois checklists estão no banco com as datas escolhidas',
           psql("SELECT string_agg(to_char(data_dev,'YYYY-MM-DD'), ',' ORDER BY numero) FROM devolucoes;") == f'2026-10-01,{hoje}'
           if hoje > '2026-10-01' else True, str(esperado))

        print('\n=== 2 e 3. LINHA FECHADA, EM 1366 E 390 PX ===')
        await conferir_lista(pg, 1366, list(esperado), esperado, 'Administração')
        await ctx.close()
        ctx, pg, erros2 = await abrir(nav, 'chk.adm@teste.local', {'width': 390, 'height': 844})
        await conferir_lista(pg, 390, list(esperado), esperado, 'Administração')
        await ctx.close()

        print('\n=== 4. A PORTARIA, QUE SÓ LÊ ===')
        ctx, pg, erros3 = await abrir(nav, 'chk.port@teste.local', {'width': 390, 'height': 844})
        await conferir_lista(pg, 390, list(esperado), esperado, 'Portaria')
        await ctx.close()
        ck('nenhum erro de JavaScript', not (erros + erros2 + erros3), '; '.join((erros + erros2 + erros3)[:2]))
        await nav.close()

    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
