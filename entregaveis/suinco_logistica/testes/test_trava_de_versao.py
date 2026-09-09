#!/usr/bin/env python3
"""Dois terminais editando a mesma carga: o último NÃO grava por cima (09/09/2026).

Auditoria de arquitetura: o servidor tem bloqueio otimista por `versao`
(cargas.js, PATCH) e o painel nunca a mandava — nos três pontos de
sincronia (ida, volta, conversão) o campo simplesmente não existia. Dois
terminais online editando a mesma carga era "quem grava por último ganha",
sem aviso: a Expedição põe 33 ganchos, a Logística — com cópia de 20 s
atrás — altera o peso, e o PATCH dela leva ganchos = 0. A família das 62
toneladas que sumiram (ocorrência #16), entre terminais diferentes.

O que se prova, contra o servidor local:
  1. O PATCH que o painel manda carrega `versao`.
  2. Terminal com cópia VELHA (versão atrasada) tenta gravar → o servidor
     recusa com CONFLITO_DE_VERSAO, o painel recarrega a carga com o que
     está no servidor (os 33 ganchos ficam) e AVISA — nada é gravado por cima.
  3. Depois de recarregar, a mesma edição passa.

    python3 testes/test_trava_de_versao.py
"""
import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(ctx, rotulo):
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_versao_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', EMAIL)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context()
        pg = await abrir(ctx, 'a')
        patches = []
        pg.on('request', lambda r: patches.append(r.post_data) if r.method == 'PATCH' and '/api/cargas/' in r.url else None)

        print('\n=== 0. A CARGA E A VERSÃO DELA ===')
        num = await pg.evaluate("""() => {
            const n = 'VER' + Date.now().toString().slice(-6);
            criarCargaProgramada({placa: DB.frota[20].placa, numeroCarga:n, peso:9000, rota:'500',
                                  sequencia:1, qtdGanchos:0, operador:'Ana'});
            SuincoStore.save();
            return n;
        }""")
        await pg.wait_for_timeout(5000)
        v0 = await pg.evaluate("(n) => (DB.cargas.find(x=>x.numeroCarga===n)||{}).versao", num)
        ck('a carga chega do servidor com a versão dela', isinstance(v0, (int, float)), f"versao={v0!r}")

        print('\n=== 1. O PATCH LEVA A VERSÃO ===')
        patches.clear()
        await pg.evaluate("(n) => { const c = DB.cargas.find(x=>x.numeroCarga===n); atualizarGanchosUI(c.id, '33'); }", num)
        await pg.wait_for_timeout(5000)
        corpos = [json.loads(b) for b in patches if b]
        ck('o painel mandou PATCH', len(corpos) >= 1, f"{len(corpos)} PATCH")
        ck('o PATCH carrega `versao`', any('versao' in c for c in corpos), str(corpos[:1])[:200])
        v1 = await pg.evaluate("(n) => (DB.cargas.find(x=>x.numeroCarga===n)||{}).versao", num)
        ck('depois de gravar, a versão local acompanha a do servidor',
           isinstance(v1, (int, float)) and v1 > v0, f"{v0} → {v1}")

        print('\n=== 2. CÓPIA VELHA NÃO GRAVA POR CIMA ===')
        # Simula o terminal atrasado: a mesma carga, com a versão de antes.
        await pg.evaluate("(n) => { const c = DB.cargas.find(x=>x.numeroCarga===n); c.versao = c.versao - 1; }", num)
        avisos = []
        pg.on('console', lambda m: None)
        await pg.evaluate("""(n) => {
            window.__avisos = [];
            const _n = window.notify; window.notify = (msg, tipo, ms) => { window.__avisos.push(String(msg)); return _n(msg, tipo, ms); };
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            atualizarPesoUI(c.id, '7777');
        }""", num)
        await pg.wait_for_timeout(5000)
        estado = await pg.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return { ganchos: c.qtdGanchos, peso: c.peso, versao: c.versao, avisos: window.__avisos, pendente: !!c._pendente };
        }""", num)
        print('   PATCHes da 2ª edição:', [ {k: json.loads(b).get(k) for k in ('versao','peso','qtdGanchos')} for b in patches[len(corpos):] if b ])
        ck('o servidor recusou e o painel avisou (conflito de versão)',
           any('alterou' in a.lower() or 'vers' in a.lower() for a in estado['avisos']), str(estado['avisos'])[:240])
        ck('os 33 ganchos do outro terminal continuam (nada foi gravado por cima)',
           estado['ganchos'] == 33, str(estado))
        ck('a carga local foi recarregada com a versão do servidor',
           isinstance(estado['versao'], (int, float)) and estado['versao'] >= v1, str(estado))
        r = await pg.evaluate(f"""async () => {{
            const t = sessionStorage.getItem('suinco_token');
            const r = await fetch('{API}/api/estado', {{ headers: {{ authorization: 'Bearer ' + t }} }});
            const j = await r.json();
            const c = (j.cargas||[]).find(x => x.numeroCarga === '{num}');
            return c ? {{ peso: c.peso, ganchos: c.qtdGanchos }} : null;
        }}""")
        ck('no servidor, o peso da cópia velha NÃO entrou', r is not None and r['peso'] != 7777, str(r))

        print('\n=== 3. RECARREGADA, A EDIÇÃO PASSA ===')
        await pg.evaluate("(n) => { const c = DB.cargas.find(x=>x.numeroCarga===n); atualizarPesoUI(c.id, '8888'); }", num)
        await pg.wait_for_timeout(5000)
        r2 = await pg.evaluate(f"""async () => {{
            const t = sessionStorage.getItem('suinco_token');
            const r = await fetch('{API}/api/estado', {{ headers: {{ authorization: 'Bearer ' + t }} }});
            const j = await r.json();
            const c = (j.cargas||[]).find(x => x.numeroCarga === '{num}');
            return c ? {{ peso: c.peso, ganchos: c.qtdGanchos }} : null;
        }}""")
        ck('com a versão certa, o peso grava e os ganchos ficam',
           r2 is not None and r2['peso'] == 8888 and r2['ganchos'] == 33, str(r2))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
