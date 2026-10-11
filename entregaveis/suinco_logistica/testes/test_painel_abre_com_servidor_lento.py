#!/usr/bin/env python3
"""O painel abre e entra sem esperar o tempo real (11/10/2026).

O QUE FOI MEDIDO: com o servidor demorando 20 s para entregar o arquivo do
tempo real (`socket.io.js`), a tela de login só aparecia aos 21 s. O painel
inteiro (`init`) começa no DOMContentLoaded — e o navegador SEGURA esse
evento até baixar todo script `defer`. O `defer` evitava travar a leitura
do HTML, mas não evitava travar o começo do painel. Servidor lento de
manhã = porteiro olhando tela parada.

A REGRA: tempo real é conforto; abrir é obrigação (o comentário do próprio
index_suinco.html). O arquivo do tempo real chega quando chegar — e, quando
chegar, o tempo real liga sozinho, sem recarregar a página.

O CAMINHO, com a API de verdade:
  1. o socket.io.js pendurado 20 s: a tela de login aparece em menos de 5 s;
  2. a pessoa entra e o painel abre, ainda sem o socket.io.js;
  3. o socket.io.js chega atrasado: a conexão de tempo real abre sozinha.

REPROVA contra o publicado (login aos ~21 s):
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh painel_abre_com_servidor_lento

    bash testes/rodar_tudo.sh painel_abre_com_servidor_lento
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PAINEL = Path(os.environ.get('SUINCO_PAINEL_ARQUIVO', str(RAIZ / 'index.html')))
EMAIL = 'lento.socket@teste.local'
ATRASO = 20      # segundos que o servidor leva para entregar o socket.io.js
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


def limpar():
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")


async def main():
    limpar()
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{EMAIL}', 'Logística Lenta', 'Logística', '{h}', true);")
    # O cliente do tempo real de verdade, servido pela API local.
    with urllib.request.urlopen(f'{API}/socket.io/socket.io.js', timeout=20) as r:
        cliente_io = r.read().decode()

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context()
        pg = await ctx.new_page()
        await pg.set_viewport_size({'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        sockets = []
        pg.on('websocket', lambda ws: sockets.append(ws.url))
        html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        url = API + '/__painel_teste'
        await pg.route(url, lambda rota: asyncio.ensure_future(
            rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        chegou = {}

        async def socket_lento(rota):
            await asyncio.sleep(ATRASO)
            chegou['em'] = time.monotonic()
            try:
                await rota.fulfill(status=200, content_type='application/javascript', body=cliente_io)
            except Exception:
                pass
        await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(socket_lento(rota)))

        print(f'\n=== 1. O socket.io.js PENDURADO {ATRASO} s: A TELA DE LOGIN APARECE ===')
        t0 = time.monotonic()
        await pg.goto(url, wait_until='commit')
        try:
            await pg.wait_for_selector('#login-email', state='visible', timeout=(ATRASO + 10) * 1000)
            t_login = time.monotonic() - t0
        except Exception:
            t_login = None
        ck('a tela de login aparece em menos de 5 s', t_login is not None and t_login < 5,
           f'{t_login:.1f} s' if t_login is not None else 'não apareceu')

        print('\n=== 2. A PESSOA ENTRA, AINDA SEM O socket.io.js ===')
        await pg.fill('#login-email', EMAIL)
        await pg.fill('#login-senha', SENHA)
        t1 = time.monotonic()
        await pg.click('#btn-entrar')
        try:
            await pg.wait_for_function("() => typeof DB !== 'undefined' && DB.operador && DB.operador.setor === 'Logística'"
                                       " && !!document.querySelector('.nav-tab[data-tab=\"torre\"]:not([hidden])')",
                                       timeout=(ATRASO + 10) * 1000)
            t_dentro = time.monotonic() - t1
        except Exception:
            t_dentro = None
        ck('o painel abre em menos de 5 s depois de entrar', t_dentro is not None and t_dentro < 5,
           f'{t_dentro:.1f} s' if t_dentro is not None else 'não abriu')
        ck('e isso tudo ANTES de o socket.io.js chegar', 'em' not in chegou or (t_dentro is not None and chegou['em'] > t1 + t_dentro),
           'o arquivo chegou antes' if 'em' in chegou else '')

        print('\n=== 3. O socket.io.js CHEGA ATRASADO: O TEMPO REAL LIGA SOZINHO ===')
        restante = max(0, ATRASO - (time.monotonic() - t0)) + 8
        await pg.wait_for_timeout(int(restante * 1000))
        ck('o socket.io.js chegou', 'em' in chegou)
        ws = [s for s in sockets if '/socket.io/' in s]
        ck('a conexão de tempo real abriu sem recarregar a página', bool(ws), str(sockets[:2]))
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: o painel abre sem esperar o tempo real.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar()
