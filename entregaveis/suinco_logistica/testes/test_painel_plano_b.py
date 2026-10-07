#!/usr/bin/env python3
"""Plano B: o painel servido pelo próprio servidor, em /painel (07/10/2026).

O DONO: "hobby, não pode parar o site". O painel mora na Vercel, plano
grátis; uso acima do limite pode PAUSAR o site até o mês virar. O servidor
da Hostinger passa a entregar o mesmo painel em
https://api.embarquesuinco.com.br/painel — sem DNS, sem certificado, sem
Nginx.

O QUE ESTE TESTE TRAVA, pelo navegador, como a pessoa usaria no dia da pane:
  1. abrir <servidor>/painel mostra a tela de entrada do painel;
  2. entrar com usuário e senha funciona (o painel fala com o MESMO servidor);
  3. a Torre carrega a carga plantada no banco (dado de verdade, não vitrine);
  4. nenhum erro de "origem não autorizada" e nenhum erro de JavaScript.
Carga plantada e marcada (905801, placa TSB5801).

    bash testes/rodar_tudo.sh test_painel_plano_b
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


async def main():
    psql("DELETE FROM fact_viagens WHERE carga_id = 'planob-1';")
    psql("""INSERT INTO fact_viagens (carga_id, numero_carga, placa, status_atual, transportadora, criado_em, programado_em)
            VALUES ('planob-1', '905801', 'TSB5801', 'Aguardando Veículo', '', now(), now());""")
    ck('operador da Logística criado', bool(operador('planob.log@teste.local', 'Logística')))
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1366, 'height': 900})
        erros, recusas = [], []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.on('response', lambda r: recusas.append(r.url) if r.status == 403 else None)

        print('\n=== 1. ABRIR O ENDEREÇO RESERVA ===')
        resp = await pg.goto(API + '/painel')
        ck('o servidor entrega o painel', resp is not None and resp.status == 200, str(resp and resp.status))
        await pg.wait_for_selector('#login-email', timeout=25000)
        ck('a tela de entrada aparece', await pg.is_visible('#login-email'))

        print('\n=== 2. ENTRAR ===')
        await pg.fill('#login-email', 'planob.log@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(4000)
        ck('entrou (a tela de entrada sumiu)', not await pg.is_visible('#login-email'))
        base = await pg.evaluate("() => (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado()) ? 'ok' : 'sem servidor'")
        ck('o painel está ligado ao servidor', base == 'ok', base)

        print('\n=== 3. A TORRE COM O DADO DO BANCO ===')
        if await pg.is_visible('.nav-tab[data-tab="torre"]'):
            await pg.click('.nav-tab[data-tab="torre"]')
            await pg.wait_for_timeout(1500)
        tem = await pg.evaluate("() => [...document.querySelectorAll('#torre-tbody tr[data-carga]')].some(t => t.textContent.includes('905801') || t.dataset.carga === 'planob-1') || (DB.cargas || []).some(c => c.numeroCarga === '905801')")
        ck('a carga plantada no banco aparece', tem)

        print('\n=== 4. SEM RECUSA E SEM ERRO ===')
        ck('nenhuma chamada recusada (403)', not recusas, str(recusas[:3]))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()
    psql("DELETE FROM fact_viagens WHERE carga_id = 'planob-1';")
    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
