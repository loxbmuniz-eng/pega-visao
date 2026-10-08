#!/usr/bin/env python3
"""Indicadores: uma linha por transportadora, quatro números (07/10/2026, #49).

PEDIDO DO DONO ("que nota por transportadora"), com as recomendações
aprovadas: só Logística e Administração, sem pontualidade (ninguém registra
a hora combinada). Quatro números lado a lado, sem nota única:
cargas concluídas · tempo de pátio típico (mediana) · cargas com CT-e ou
canhoto pendente · % de frete combinado. DEVOLUÇÃO FICOU DE FORA, pelo dono:
"existem devoluções que nem voltam para a Suinco (...) esse dado não é
concreto integralmente" — a aba Devoluções só tem as que voltaram.

O QUE ESTE TESTE TRAVA, pela tela, no servidor de teste:
  1. a Portaria não vê o quadro; a Logística vê;
  2. a linha da transportadora plantada mostra: 3 cargas, pátio típico de
     2h00 (1h, 2h e 10h — a mediana não deixa o caminhão esquecido puxar a
     conta), NENHUMA coluna de devolução, 1 carga com documento pendente, 50% de frete combinado (1 de 2 com a
     observação);
  3. no celular a tabela rola dentro dela — a página não rola de lado.
Dados plantados e marcados (cargas 9057xx, transportadora TRANSP. QUADRO TELA).

    bash testes/rodar_tudo.sh test_nota_por_transportadora
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

RAIZ = Path(__file__).resolve().parent.parent
PAINEL = RAIZ / 'index.html'
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
T = 'TRANSP. QUADRO TELA'
# O dia de Brasília, como o sistema grava a consulta do frete — o current_date
# do banco é UTC e, entre 21h e meia-noite, já é amanhã.
HOJE_BR = "(now() AT TIME ZONE 'America/Sao_Paulo')::date"

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q, capture_output=True, text=True)
    if r.returncode != 0 or 'ERROR' in r.stderr:
        print('    [psql]', r.stderr.strip()[:200])
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


def limpar():
    psql("""
      DELETE FROM fact_statusfrota WHERE carga_id LIKE 'quadro-tela-%';
      DELETE FROM fact_viagens WHERE carga_id LIKE 'quadro-tela-%';
      DELETE FROM devolucao_itens WHERE devolucao_id LIKE 'quadro-tela-dev%';
      DELETE FROM devolucoes WHERE devolucao_id LIKE 'quadro-tela-dev%';
      DELETE FROM pgfrete_cargas WHERE numero_carga IN ('905711', '905712');
    """)


def plantar():
    # três cargas concluídas HOJE: 1h, 2h e 10h de pátio; observação do frete em duas
    sql = []
    for i, (horas, obs) in enumerate([(1, 'TABELA'), (2, 'COMBINADO'), (10, '')], start=1):
        cid = f'quadro-tela-{i}'
        sql.append(f"""INSERT INTO fact_viagens (carga_id, numero_carga, placa, status_atual, transportadora, frete_observacao, criado_em, programado_em)
                       VALUES ('{cid}', '90570{i}', 'TSQ570{i}', 'Seguiu Viagem', '{T}', {repr(obs) if obs else 'NULL'}, now() - interval '{horas + 1} hours', now() - interval '{horas + 1} hours');""")
        sql.append(f"""INSERT INTO fact_statusfrota (movimentacao_id, carga_id, placa, status_novo, setor, data_evento)
                       VALUES ('{cid}-a', '{cid}', 'TSQ570{i}', 'Aguardando Embarque', 'Portaria', now() - interval '{horas} hours 30 minutes'),
                              ('{cid}-s', '{cid}', 'TSQ570{i}', 'Seguiu Viagem', 'Portaria', now() - interval '30 minutes');""")
    sql.append(f"""INSERT INTO devolucoes (devolucao_id, data_dev, transportadora, tipo) VALUES ('quadro-tela-dev1', current_date, '{T}', 'DEVOLUCAO');
      INSERT INTO devolucao_itens (devolucao_id, nota, motivo, cx) VALUES
        ('quadro-tela-dev1', '1', '607 — Transporte/Avaria. Mercadoria chegou no cliente avariada, gerando a devolução do produto.', 1),
        ('quadro-tela-dev1', '2', '623 — Comercial/Cliente comprou de outro fornecedor.', 1);
      INSERT INTO pgfrete_cargas (numero_carga, data_consulta, primeira_consulta, transportadora, cte, canhoto_original)
        VALUES ('905711', {HOJE_BR}, {HOJE_BR}, '{T}', '', true), ('905712', {HOJE_BR}, {HOJE_BR}, '{T}', 'CT9', true);""")
    psql('\n'.join(sql))


async def abrir(nav, email, viewport):
    ctx = await nav.new_context(viewport=viewport)
    pg = await ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__nota_transp'
    await pg.route(url, lambda rota: asyncio.ensure_future(rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3500)
    if viewport['width'] < 821:
        await pg.click('#btn-menu')
        await pg.wait_for_timeout(400)
    if await pg.is_visible('.nav-tab[data-tab="indicadores"]'):
        await pg.click('.nav-tab[data-tab="indicadores"]')
        await pg.wait_for_timeout(2500)
    return ctx, pg, erros


LINHA = """(t) => {
  const tr = [...document.querySelectorAll('#nota-transp tr[data-transportadora]')].find(x => x.dataset.transportadora === t);
  if(!tr) return null;
  const v = (c) => (tr.querySelector(`[data-col="${c}"]`) || {}).textContent.trim().replace(/\\u00a0/g, ' ');
  const dev = tr.querySelector('[data-col="dev"]');
  return { cargas: v('cargas'), patio: v('patio'), dev: dev ? dev.textContent.trim() : null, doc: v('doc'), combinado: v('combinado'),
           cabecalho: [...document.querySelectorAll('#nota-transp thead th')].map(th => th.textContent.trim()) };
}"""


async def main():
    limpar()
    ok = operador('quadro.log@teste.local', 'Logística') and operador('quadro.port@teste.local', 'Portaria')
    ck('operadores Logística e Portaria criados', bool(ok))
    plantar()
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros_todos = []

        print('\n=== 1. QUEM VÊ ===')
        ctx, pg, erros = await abrir(nav, 'quadro.port@teste.local', {'width': 1366, 'height': 900})
        erros_todos += erros
        ck('a Portaria não vê o quadro', not await pg.is_visible('#card-nota-transportadoras'))
        await ctx.close()

        ctx, pg, erros = await abrir(nav, 'quadro.log@teste.local', {'width': 1366, 'height': 900})
        erros_todos += erros
        ck('a Logística vê o quadro', await pg.is_visible('#card-nota-transportadoras'))

        print('\n=== 2. OS CINCO NÚMEROS ===')
        l = await pg.evaluate(LINHA, T)
        ck('a transportadora tem a sua linha', l is not None, str(l))
        if l:
            ck('3 cargas concluídas', l['cargas'] == '3', str(l))
            ck('tempo de pátio típico 2h00 (a de 10h não puxa a conta)', l['patio'] == '2h00min', str(l))
            ck('devolução NÃO aparece: a aba Devoluções só tem as que voltaram à Suinco (decisão do dono)', l['dev'] is None, str(l))
            ck('1 carga com CT-e ou canhoto pendente', l['doc'] == '1', str(l))
            ck('50% de frete combinado (1 de 2 com a observação)', l['combinado'] == '50%', str(l))
        await ctx.close()

        print('\n=== 3. NO CELULAR ===')
        ctx, pg, erros = await abrir(nav, 'quadro.log@teste.local', {'width': 390, 'height': 844})
        erros_todos += erros
        rola = await pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")
        ck('a página não rola de lado no celular', rola)
        await ctx.close()

        ck('nenhum erro de JavaScript', not erros_todos, '; '.join(erros_todos[:2]))
        await nav.close()
    limpar()
    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
