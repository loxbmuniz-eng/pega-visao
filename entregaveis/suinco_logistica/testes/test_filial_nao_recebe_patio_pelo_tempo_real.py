#!/usr/bin/env python3
"""A filial não recebe o pátio pelo tempo real — só devolução (auditoria 06/10/2026).

A ocorrência #28 fechou a leitura HTTP: `/api/estado` devolve o pátio vazio
para a filial ("filial só devolução", regra do dono). Mas a conexão de tempo
real punha todo setor logado na mesma sala, e a auditoria provou a filial
recebendo, ao vivo, a carga criada pela Logística com placa, motorista e
cliente. Mesma família: a proteção escrita para um posto só.

A prova é pelo caminho de verdade: um navegador carrega o cliente de tempo
real servido pelo próprio servidor, conecta com o crachá da filial, e a
Logística cria uma carga e uma devolução pela API.

    bash testes/rodar_tudo.sh filial_nao_recebe_patio_pelo_tempo_real
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
RAIZ = '/home/user/pega-visao/entregaveis/suinco_logistica'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAILS = {'filial': 'tr.filial@teste.local', 'log': 'tr.logistica@teste.local'}
PLACA = 'TRF1A23'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    return subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q,
                          capture_output=True, text=True).stdout.strip()


def http(c, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
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
                       cwd=RAIZ + '/backend', capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';"
         f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} TR', '{setor}', '{h}', true);")
    return http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})[1].get('token')


async def main():
    tf = operador(EMAILS['filial'], 'Filial 105 BSB')
    tl = operador(EMAILS['log'], 'Logística')
    psql(f"INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('{PLACA}', 'Transp TR', 'Truck', 'teste') ON CONFLICT DO NOTHING;")
    numero = 'TR-' + str(int(time.time()))

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page()
        await pg.route(API + '/__tr', lambda r: asyncio.ensure_future(r.fulfill(
            status=200, content_type='text/html', body='<script src="/socket.io/socket.io.js"></script>')))
        await pg.goto(API + '/__tr')
        conectou = await pg.evaluate("""(t) => new Promise((ok) => {
            window.recebido = [];
            const s = io({ auth: { token: t }, transports: ['websocket'] });
            s.onAny((ev, d) => window.recebido.push([ev, JSON.stringify(d || {})]));
            s.on('connect', () => ok(true)); setTimeout(() => ok(false), 5000); })""", tf)
        ck('a filial conecta no tempo real', conectou)

        st, _ = http('/api/cargas', tl, 'POST', {'placa': PLACA, 'numeroCarga': numero, 'cliente': 'CLIENTE TR',
                                                 'motorista': 'MOTORISTA TR', 'freteObservacao': 'TABELA'})
        ck('a Logística criou uma carga', st == 201, str(st))
        st, dev = http('/api/devolucoes', tl, 'POST', {'dataDev': time.strftime('%Y-%m-%d'), 'regiao': 'Sobras', 'tipo': 'SOBRA', 'rotas': ['500']})
        ck('e uma devolução', st == 201, str(st))
        await pg.wait_for_timeout(2000)
        recebido = await pg.evaluate("() => window.recebido")
        eventos = [e for e, _ in recebido]
        carga = [d for e, d in recebido if numero in d or 'MOTORISTA TR' in d]
        ck('a filial NÃO recebe a carga do pátio (placa, motorista, cliente)', not carga, str(carga)[:200])
        ck('nem evento de carga nenhum', not any(e.startswith('carga:') or e.startswith('movimentacao') for e in eventos), str(eventos))
        ck('nem a presença de quem está no pátio', 'presenca:atualizada' not in eventos, str(eventos))
        ck('mas continua recebendo a devolução', 'devolucao:atualizada' in eventos, str(eventos))
        await nav.close()

    psql(f"DELETE FROM log_eventos WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga = '{numero}');"
         f"DELETE FROM fact_statusfrota WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga = '{numero}');"
         f"DELETE FROM fact_viagens WHERE numero_carga = '{numero}';")
    if dev and dev.get('id'):
        psql(f"DELETE FROM devolucoes WHERE id = '{dev['id']}';")
    for e in EMAILS.values():
        psql(f"DELETE FROM operadores WHERE email = '{e}';")
    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    psql(f"DELETE FROM dim_veiculos WHERE placa = '{PLACA}';")   # a Frota volta ao que era
    sys.exit(1 if falhas else 0)


asyncio.run(main())
